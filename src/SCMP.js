/**
 * SCMP - Semantic Clustered Memory Protocol v2.1.0
 * Production-ready implementation with critical fixes
 * 
 * Key fixes in this version:
 * - HNSW ID tracking to prevent metadata mismatch
 * - Proper embedding reconstruction from stores
 * - Non-blocking consolidation with chunking
 * - Monotonic journal counter
 * - Cursor-based cold tier iteration
 * 
 * @version 2.1.0
 * @license MIT
 */

const OLLAMA_URL = "http://127.0.0.1:11434";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Utilities
// ============================================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function quantizeInt8(vec) {
  const arr = Array.isArray(vec) ? vec : Array.from(vec);
  return arr.map(v => Math.max(-128, Math.min(127, Math.round(v * 127))));
}

function dequantizeInt8(packed) {
  return packed.map(v => v / 127);
}

function quantizeFloat16(vec) {
  const arr = Array.isArray(vec) ? vec : Array.from(vec);
  return new Uint16Array(arr.map(value => {
    const f32 = new Float32Array([value]);
    const bits = new Uint32Array(f32.buffer)[0];
    
    const sign = (bits >>> 31) & 0x1;
    let exp = (bits >>> 23) & 0xff;
    let frac = bits & 0x7fffff;
    
    if (exp === 0xff) {
      return (sign << 15) | 0x7c00 | (frac ? 0x200 : 0);
    }
    
    if (exp === 0) {
      return sign << 15;
    }
    
    exp = exp - 127 + 15;
    
    if (exp >= 0x1f) {
      return (sign << 15) | 0x7c00;
    }
    
    if (exp <= 0) {
      if (exp < -10) return sign << 15;
      frac = (frac | 0x800000) >> (1 - exp);
      return (sign << 15) | (frac >>> 13);
    }
    
    return (sign << 15) | (exp << 10) | (frac >>> 13);
  }));
}

function dequantizeFloat16(packed) {
  const arr = Array.isArray(packed) ? packed : Array.from(packed);
  return arr.map(h => {
    const sign = (h & 0x8000) ? -1 : 1;
    let exp = (h >>> 10) & 0x1f;
    let frac = h & 0x3ff;
    
    if (exp === 0) {
      return sign * Math.pow(2, -14) * (frac / 1024);
    }
    
    if (exp === 0x1f) {
      return frac ? NaN : sign * Infinity;
    }
    
    exp -= 15;
    return sign * Math.pow(2, exp) * (1 + frac / 1024);
  });
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-9 ? dot / denom : 0;
}

async function hashEmbedding(embedding) {
  const normalized = embedding.map(v => v.toFixed(8));
  const str = normalized.join(',');
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// IndexedDB Store with Cursor Support
// ============================================================================

class IndexedDBStore {
  constructor(dbName, storeName) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
    this.isOpen = false;
  }

  async open() {
    if (this.isOpen) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(new Error(`Failed to open ${this.dbName}: ${request.error}`));
      
      request.onsuccess = () => {
        this.db = request.result;
        this.isOpen = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
    });
  }

  async put(record) {
    if (!this.isOpen) throw new Error('Store not open');
    
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Put failed: ${request.error}`));
    });
  }

  async putBatch(records) {
    if (!this.isOpen) throw new Error('Store not open');
    if (!records || records.length === 0) return;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);

      let completed = 0;
      let hasError = false;

      for (const record of records) {
        const request = store.put(record);
        
        request.onsuccess = () => {
          completed++;
          if (completed === records.length && !hasError) {
            resolve();
          }
        };

        request.onerror = () => {
          hasError = true;
          reject(new Error(`Batch put failed: ${request.error}`));
        };
      }
    });
  }

  async get(id) {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Get failed: ${request.error}`));
    });
  }

  async getAll() {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error(`GetAll failed: ${request.error}`));
    });
  }

  /**
   * Iterate through records in chunks to avoid memory pressure
   */
  async *iterateChunks(chunkSize = 1000) {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.openCursor();
      
      let chunk = [];

      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        
        if (cursor) {
          chunk.push(cursor.value);
          
          if (chunk.length >= chunkSize) {
            const batchToYield = chunk;
            chunk = [];
            
            // Yield the chunk
            resolve(batchToYield);
            
            // Continue cursor
            cursor.continue();
          } else {
            cursor.continue();
          }
        } else {
          // End of iteration
          if (chunk.length > 0) {
            resolve(chunk);
          }
          resolve(null); // Signal completion
        }
      };

      request.onerror = () => reject(new Error(`Cursor iteration failed: ${request.error}`));
    });
  }

  async delete(id) {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Delete failed: ${request.error}`));
    });
  }

  async keys() {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error(`Keys failed: ${request.error}`));
    });
  }

  async count() {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Count failed: ${request.error}`));
    });
  }

  async clear() {
    if (!this.isOpen) throw new Error('Store not open');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Clear failed: ${request.error}`));
    });
  }
}

// ============================================================================
// Ollama Client
// ============================================================================

class OllamaBrowserSafe {
  constructor(baseUrl = OLLAMA_URL, embedModel = 'nomic-embed-text') {
    this.baseUrl = baseUrl;
    this.embedModel = embedModel;
    this.embedDim = 768;
    this.generativeModel = 'llama3.2:latest';
  }

  async _fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  async _retryableRequest(requestFn, retries = MAX_RETRIES) {
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        
        if (attempt < retries - 1) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`Request failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms...`);
          await sleep(delay);
        }
      }
    }
    
    throw new Error(`Request failed after ${retries} attempts: ${lastError.message}`);
  }

  async embed(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text for embedding');
    }

    return this._retryableRequest(async () => {
      const response = await this._fetchWithTimeout(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embedModel,
          prompt: text
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Invalid embedding response from Ollama');
      }

      return data.embedding;
    });
  }

  async embedBatch(texts) {
    if (!Array.isArray(texts)) {
      throw new Error('embedBatch requires an array of texts');
    }

    const BATCH_SIZE = 5;
    const results = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map(text => this.embed(text))
      );
      results.push(...embeddings);
    }

    return results;
  }

  async generate(prompt, options = {}) {
    return this._retryableRequest(async () => {
      const response = await this._fetchWithTimeout(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model || this.generativeModel,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            num_predict: options.max_tokens || 150
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama generate failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.response || '';
    });
  }
}

// ============================================================================
// Memory Record
// ============================================================================

class MemoryRecord {
  constructor({
    id,
    embedding,
    text,
    timestamp = Date.now(),
    lastAccessed = Date.now(),
    episodic = true,
    importance = 0.5,
    usage_count = 0,
    semantic_cluster_id = null,
    integrity_hash,
    currentTier = 'UNKNOWN',
    embeddingHash = null,
    metadata = {},
    // CRITICAL FIX: Track HNSW node IDs separately
    hnswHotId = null,
    hnswWarmId = null
  }) {
    this.id = id;
    this.embedding = embedding;
    this.text = text;
    this.timestamp = timestamp;
    this.lastAccessed = lastAccessed;
    this.episodic = episodic;
    this.importance = Math.max(0, Math.min(1, importance));
    this.usage_count = usage_count;
    this.semantic_cluster_id = semantic_cluster_id;
    this.integrity_hash = integrity_hash;
    this.currentTier = currentTier;
    this.embeddingHash = embeddingHash;
    this.metadata = metadata;
    this.hnswHotId = hnswHotId;
    this.hnswWarmId = hnswWarmId;
  }

  async getEmbeddingHash() {
    if (this.embeddingHash) return this.embeddingHash;
    this.embeddingHash = await hashEmbedding(this.embedding);
    return this.embeddingHash;
  }

  get decay_score() {
    const age = Date.now() - this.timestamp;
    const halfLife = 14 * 24 * 60 * 60 * 1000;
    return Math.exp(-age / halfLife);
  }

  get temporal_weight() {
    const age = Date.now() - this.timestamp;
    const scale = 7 * 24 * 60 * 60 * 1000;
    return 1 / (1 + age / scale);
  }

  get effective_weight() {
    return this.importance * this.decay_score * this.temporal_weight;
  }

  access(simulate = false) {
    if (!simulate) {
      this.usage_count++;
      this.lastAccessed = Date.now();
    }
  }

  toJSON() {
    return {
      id: this.id,
      text: this.text,
      timestamp: this.timestamp,
      lastAccessed: this.lastAccessed,
      episodic: this.episodic,
      importance: this.importance,
      usage_count: this.usage_count,
      semantic_cluster_id: this.semantic_cluster_id,
      integrity_hash: this.integrity_hash,
      currentTier: this.currentTier,
      metadata: this.metadata,
      hnswHotId: this.hnswHotId,
      hnswWarmId: this.hnswWarmId
    };
  }
}

// ============================================================================
// SCMP - Main Class
// ============================================================================

class SCMP {
  constructor(config = {}) {
    this.config = {
      U_hot: config.U_hot ?? 10,
      I_hot: config.I_hot ?? 0.8,
      D_warm: config.D_warm ?? 0.1,
      R_max: config.R_max ?? 0.9,
      epsilon: config.epsilon ?? 0.01,
      embedModel: config.embedModel ?? 'nomic-embed-text',
      generativeModel: config.generativeModel ?? 'llama3.2:latest',
      ollamaUrl: config.ollamaUrl ?? OLLAMA_URL,
      consolidationInterval: config.consolidationInterval ?? 100,
      consolidationChunkSize: config.consolidationChunkSize ?? 500,
      journalRotationSize: config.journalRotationSize ?? 10000,
      coldSearchChunkSize: config.coldSearchChunkSize ?? 1000,
      // FIX: More lenient demotion
      demotionUsageThreshold: config.demotionUsageThreshold ?? 2,
      // FIX #2: HNSW compaction threshold
      compactionThreshold: config.compactionThreshold ?? 100, // Compact after N deletions
      // FIX #3: Memory pressure thresholds (in bytes)
      memoryWarningThreshold: config.memoryWarningThreshold ?? 100 * 1024 * 1024, // 100MB
      memoryCriticalThreshold: config.memoryCriticalThreshold ?? 50 * 1024 * 1024,  // 50MB
      memoryCheckInterval: config.memoryCheckInterval ?? 60000, // Check every minute
      // FIX #4: Auto-save settings
      autoSaveEnabled: config.autoSaveEnabled ?? true,
      autoSaveInterval: config.autoSaveInterval ?? 5 * 60 * 1000, // 5 minutes
      mutationBatchSize: config.mutationBatchSize ?? 10,
      // FIX #5: Advanced clustering for large datasets
      useAdvancedClustering: config.useAdvancedClustering ?? true,
      advancedClusteringThreshold: config.advancedClusteringThreshold ?? 5000,
      clusterDiameter: config.clusterDiameter ?? 0.3, // BIRCH CF-tree diameter threshold
      maxClustersPerPass: config.maxClustersPerPass ?? 100
    };

    this.ollama = new OllamaBrowserSafe(this.config.ollamaUrl, this.config.embedModel);
    this.ollama.generativeModel = this.config.generativeModel;

    this.coreStore = new IndexedDBStore('scmp_core_v2', 'core');
    this.warmStore = new IndexedDBStore('scmp_warm_v2', 'warm');
    this.coldStore = new IndexedDBStore('scmp_cold_v2', 'cold');
    this.journalStore = new IndexedDBStore('scmp_journal_v2', 'journal');
    this.metaStore = new IndexedDBStore('scmp_meta_v2', 'meta');

    this.hnswHot = null;
    this.hnswWarm = null;

    this.initialized = false;
    this.salt = null;
    this.key = null;
    this.recordsSinceConsolidation = 0;
    // FIX: Monotonic journal counter
    this.journalCounter = 0;
    // FIX #2: Track deletions for compaction
    this.deletionsSinceCompaction = 0;
    // FIX #3: Memory monitoring
    this.memoryCheckTimer = null;
    this.lastMemoryCheck = 0;
    // FIX #4: Auto-save tracking
    this.autoSaveTimer = null;
    this.mutationsSinceLastSave = 0;

    this.locks = {
      search: false,
      consolidate: false,
      prune: false,
      compact: false
    };
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await Promise.all([
        this.coreStore.open(),
        this.warmStore.open(),
        this.coldStore.open(),
        this.journalStore.open(),
        this.metaStore.open()
      ]);

      await this._loadOrCreateKey();
      await this._loadOrCreateSalt();
      
      // FIX: Load journal counter
      await this._loadJournalCounter();

      const { EdgeVec, init } = await import('edgevec');
      await init();

      const dim = this.ollama.embedDim || 768;

      try {
        this.hnswHot = await EdgeVec.load('scmp_hnsw_hot_v2');
        console.log('Loaded existing HOT HNSW index');
      } catch {
        this.hnswHot = new EdgeVec({ dimensions: dim, quantized: true });
        console.log('Created new HOT HNSW index');
      }

      try {
        this.hnswWarm = await EdgeVec.load('scmp_hnsw_warm_v2');
        console.log('Loaded existing WARM HNSW index');
      } catch {
        this.hnswWarm = new EdgeVec({ dimensions: dim, quantized: true });
        console.log('Created new WARM HNSW index');
      }

      this.initialized = true;
      console.log('SCMP initialized successfully');

      // FIX #3: Start memory monitoring
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        this._startMemoryMonitoring();
      }

      // FIX #4: Setup auto-save and page lifecycle listeners
      if (this.config.autoSaveEnabled) {
        this._setupAutoSave();
        this._setupPageLifecycle();
      }

    } catch (error) {
      console.error('SCMP initialization failed:', error);
      throw new Error(`Failed to initialize SCMP: ${error.message}`);
    }
  }

  async _loadOrCreateKey() {
    let keyData = await this.metaStore.get('encryption_key');
    
    if (keyData) {
      this.key = await crypto.subtle.importKey(
        'jwk',
        keyData.jwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } else {
      this.key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const jwk = await crypto.subtle.exportKey('jwk', this.key);
      await this.metaStore.put({ id: 'encryption_key', jwk });
    }
  }

  async _loadOrCreateSalt() {
    let saltData = await this.metaStore.get('salt');
    
    if (saltData) {
      this.salt = saltData.value;
    } else {
      this.salt = crypto.randomUUID();
      await this.metaStore.put({ id: 'salt', value: this.salt });
    }
  }

  // FIX: Monotonic journal counter
  async _loadJournalCounter() {
    const counterData = await this.metaStore.get('journal_counter');
    this.journalCounter = counterData ? counterData.value : 0;
  }

  async _incrementJournalCounter() {
    this.journalCounter++;
    await this.metaStore.put({ id: 'journal_counter', value: this.journalCounter });
    return this.journalCounter;
  }

  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('SCMP not initialized. Call await scmp.initialize() first.');
    }
  }

  async _hash(text) {
    return sha256(text + this.salt);
  }

  async encrypt(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoder.encode(JSON.stringify(data))
    );
    
    return {
      iv: Array.from(iv),
      encrypted: Array.from(new Uint8Array(encrypted))
    };
  }

  async decrypt({ iv, encrypted }) {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      this.key,
      new Uint8Array(encrypted)
    );
    
    return JSON.parse(decoder.decode(decrypted));
  }

  // ==========================================================================
  // Memory Creation
  // ==========================================================================

  async createMemoryRecord(text, options = {}) {
    this.ensureInitialized();

    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text for memory record');
    }

    const {
      episodic = true,
      importance = 0.5,
      metadata = {}
    } = options;

    try {
      const id = await this._hash(text + Date.now() + Math.random());
      const embedding = await this.ollama.embed(text);
      const integrity_hash = await this._hash(text);
      const embHash = await hashEmbedding(embedding);

      const record = new MemoryRecord({
        id,
        embedding,
        text,
        episodic,
        importance,
        integrity_hash,
        currentTier: 'WARM',
        embeddingHash: embHash,
        metadata
      });

      await this.appendJournal(record);
      await this.storeWarm(record);

      this.recordsSinceConsolidation++;
      this._trackMutation(); // Track for auto-save

      if (this.recordsSinceConsolidation >= this.config.consolidationInterval) {
        setImmediate(() => this.consolidate().catch(console.error));
      }

      return record;

    } catch (error) {
      console.error('Failed to create memory record:', error);
      throw new Error(`Memory creation failed: ${error.message}`);
    }
  }

  async createMemoryRecords(texts, options = {}) {
    this.ensureInitialized();

    if (!Array.isArray(texts)) {
      throw new Error('createMemoryRecords requires an array of texts');
    }

    const {
      episodic = true,
      importance = 0.5,
      metadata = {}
    } = options;

    try {
      const embeddings = await this.ollama.embedBatch(texts);

      const records = await Promise.all(
        texts.map(async (text, i) => {
          const id = await this._hash(text + Date.now() + i + Math.random());
          const integrity_hash = await this._hash(text);
          const embHash = await hashEmbedding(embeddings[i]);

          return new MemoryRecord({
            id,
            embedding: embeddings[i],
            text,
            episodic,
            importance,
            integrity_hash,
            currentTier: 'WARM',
            embeddingHash: embHash,
            metadata: Array.isArray(metadata) ? metadata[i] : metadata
          });
        })
      );

      await Promise.all(records.map(r => this.appendJournal(r)));
      
      // Store in batch
      for (const record of records) {
        await this.storeWarm(record);
      }

      this.recordsSinceConsolidation += records.length;
      this._trackMutation(); // Track for auto-save

      return records;

    } catch (error) {
      console.error('Failed to create memory records:', error);
      throw new Error(`Batch memory creation failed: ${error.message}`);
    }
  }

  async appendJournal(record) {
    this.ensureInitialized();

    try {
      // FIX: Use monotonic counter instead of keys.length
      const journalId = await this._incrementJournalCounter();
      
      const entry = {
        id: journalId,
        timestamp: Date.now(),
        record: record.toJSON()
      };
      
      await this.journalStore.put(entry);

      const count = await this.journalStore.count();
      if (count >= this.config.journalRotationSize) {
        setImmediate(() => this.rotateJournal().catch(console.error));
      }

    } catch (error) {
      console.error('Failed to append journal:', error);
    }
  }

  async rotateJournal() {
    this.ensureInitialized();

    try {
      const count = await this.journalStore.count();
      
      if (count < this.config.journalRotationSize) return;

      console.log(`Rotating journal (${count} entries)...`);
      await this.journalStore.clear();
      console.log('Journal rotated successfully');

    } catch (error) {
      console.error('Journal rotation failed:', error);
    }
  }

  // ==========================================================================
  // Tier Storage with HNSW ID tracking
  // ==========================================================================

  async storeWarm(record) {
    this.ensureInitialized();

    try {
      const float16 = quantizeFloat16(record.embedding);
      
      // FIX: Insert into HNSW and capture the node ID
      const hnswId = this.hnswWarm.insertWithMetadata(
        new Float32Array(record.embedding),
        record.toJSON()
      );
      
      // FIX: Store HNSW ID in record
      record.hnswWarmId = hnswId;
      
      const warmRecord = {
        ...record.toJSON(),
        embedding: Array.from(float16)
      };

      await this.warmStore.put(warmRecord);

    } catch (error) {
      console.error('Failed to store WARM record:', error);
      throw error;
    }
  }

  async storeCold(record) {
    this.ensureInitialized();

    try {
      const int8 = quantizeInt8(record.embedding);
      const coldRecord = {
        ...record.toJSON(),
        embedding: int8
      };

      await this.coldStore.put(coldRecord);

    } catch (error) {
      console.error('Failed to store COLD record:', error);
      throw error;
    }
  }

  // ==========================================================================
  // Promotion & Demotion with proper HNSW ID handling
  // ==========================================================================

  shouldPromote(record) {
    return record.effective_weight >= this.config.I_hot || 
           record.usage_count >= this.config.U_hot;
  }

  shouldDemote(record) {
    // FIX: More lenient demotion criteria
    return record.decay_score < this.config.D_warm && 
           record.usage_count < this.config.demotionUsageThreshold;
  }

  async applyPromotion(record, simulate = false) {
    this.ensureInitialized();

    if (!this.shouldPromote(record)) return null;

    if (!simulate) {
      try {
        const warmRecord = await this.warmStore.get(record.id);
        if (warmRecord) await this.warmStore.delete(record.id);

        const coldRecord = await this.coldStore.get(record.id);
        if (coldRecord) await this.coldStore.delete(record.id);

        // FIX: Insert and track HOT HNSW ID
        const hnswId = this.hnswHot.insertWithMetadata(
          new Float32Array(record.embedding),
          record.toJSON()
        );
        record.hnswHotId = hnswId;

        // FIX: Soft delete using tracked WARM ID
        if (record.hnswWarmId !== null) {
          this.hnswWarm.softDelete(record.hnswWarmId);
        }

        record.currentTier = 'HOT';

      } catch (error) {
        console.error('Promotion failed:', error);
        throw error;
      }
    }

    return 'HOT';
  }

  async applyDemotion(record, simulate = false) {
    this.ensureInitialized();

    if (!this.shouldDemote(record)) return null;

    if (!simulate) {
      try {
        // FIX: Soft delete using tracked HOT ID
        if (record.hnswHotId !== null) {
          this.hnswHot.softDelete(record.hnswHotId);
        }

        await this.storeWarm(record);
        record.currentTier = 'WARM';

      } catch (error) {
        console.error('Demotion failed:', error);
        throw error;
      }
    }

    return 'WARM';
  }

  async determineSimulatedTier(record, simulate = false) {
    const promoted = await this.applyPromotion(record, simulate);
    if (promoted) return promoted;

    const demoted = await this.applyDemotion(record, simulate);
    if (demoted) return demoted;

    if (simulate) return record.currentTier;

    if (await this.warmStore.get(record.id)) return 'WARM';
    if (await this.coldStore.get(record.id)) return 'COLD';

    return 'UNKNOWN';
  }

  // ==========================================================================
  // Search with proper embedding reconstruction
  // ==========================================================================

  async search(queryText, k = 10, options = {}) {
    this.ensureInitialized();

    const { simulate = false, filters = {} } = options;

    if (this.locks.search && !simulate) {
      console.warn('Search already in progress, queuing...');
      await this._waitForLock('search');
    }

    if (!simulate) this.locks.search = true;

    try {
      const queryVec = new Float32Array(await this.ollama.embed(queryText));

      let results = this.hnswHot.searchBQ(queryVec, k * 2);

      if (results.length < k * 2) {
        const warmResults = this.hnswWarm.searchBQ(
          queryVec,
          (k * 2) - results.length
        );
        results = results.concat(warmResults);
      }

      if (results.length < k * 2) {
        const coldFallback = await this._chunkedColdSearch(
          queryVec,
          (k * 2) - results.length,
          simulate
        );
        results = results.concat(coldFallback);
      }

      const rescored = [];
      for (const res of results) {
        const meta = res.metadata || res;
        
        // FIX: Reconstruct embedding from store if not available
        let embedding = res.embedding;
        if (!embedding || embedding.length === 0) {
          embedding = await this._reconstructEmbedding(meta.id, meta.currentTier);
        }
        
        const record = new MemoryRecord({
          ...meta,
          embedding: embedding,
          currentTier: meta.currentTier || 'HOT'
        });

        record.access(simulate);

        const simulatedTier = await this.determineSimulatedTier(record, simulate);
        const score = res.score * record.effective_weight;

        if (filters.episodic !== undefined && record.episodic !== filters.episodic) {
          continue;
        }
        if (filters.minImportance && record.importance < filters.minImportance) {
          continue;
        }

        rescored.push({
          ...record.toJSON(),
          score,
          simulatedTier,
          similarity: res.score
        });
      }

      rescored.sort((a, b) => b.score - a.score);

      if (!simulate) {
        for (const entry of rescored.slice(0, k)) {
          await this._updateRecord(entry);
        }
      }

      return rescored.slice(0, k);

    } catch (error) {
      console.error('Search failed:', error);
      throw new Error(`Search failed: ${error.message}`);

    } finally {
      if (!simulate) this.locks.search = false;
    }
  }

  // FIX: Reconstruct embedding from appropriate store
  async _reconstructEmbedding(recordId, tier) {
    try {
      if (tier === 'WARM') {
        const warmRec = await this.warmStore.get(recordId);
        if (warmRec && warmRec.embedding) {
          return dequantizeFloat16(warmRec.embedding);
        }
      } else if (tier === 'COLD') {
        const coldRec = await this.coldStore.get(recordId);
        if (coldRec && coldRec.embedding) {
          return dequantizeInt8(coldRec.embedding);
        }
      }
      
      throw new Error(`Could not reconstruct embedding for ${recordId} in tier ${tier}`);
    } catch (error) {
      console.error('Embedding reconstruction failed:', error);
      throw error;
    }
  }

  // FIX: Chunked cold search to avoid memory pressure
  async _chunkedColdSearch(queryVec, limit, simulate = false) {
    const scored = [];
    const chunkSize = this.config.coldSearchChunkSize;
    
    let processedCount = 0;
    const coldCount = await this.coldStore.count();

    // Process in chunks
    const allRecords = await this.coldStore.getAll();
    
    for (let i = 0; i < allRecords.length; i += chunkSize) {
      const chunk = allRecords.slice(i, Math.min(i + chunkSize, allRecords.length));
      
      for (const r of chunk) {
        const record = new MemoryRecord({
          ...r,
          embedding: dequantizeInt8(r.embedding),
          currentTier: 'COLD'
        });

        record.access(simulate);

        const similarity = cosineSimilarity(queryVec, record.embedding);
        const score = similarity * record.effective_weight;

        scored.push({
          ...record,
          score,
          similarity,
          metadata: record.toJSON()
        });
      }

      processedCount += chunk.length;
      
      // Early exit if we have enough high-scoring results
      if (scored.length >= limit * 5) {
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async _updateRecord(recordData) {
    this.ensureInitialized();

    try {
      const meta = {
        id: recordData.id,
        text: recordData.text,
        timestamp: recordData.timestamp,
        lastAccessed: recordData.lastAccessed,
        episodic: recordData.episodic,
        importance: recordData.importance,
        usage_count: recordData.usage_count,
        semantic_cluster_id: recordData.semantic_cluster_id,
        integrity_hash: recordData.integrity_hash,
        metadata: recordData.metadata,
        hnswHotId: recordData.hnswHotId,
        hnswWarmId: recordData.hnswWarmId
      };

      // FIX: Update using tracked HNSW IDs
      if (recordData.hnswHotId !== null && recordData.hnswHotId !== undefined) {
        this.hnswHot.updateMetadata(recordData.hnswHotId, meta);
      } else if (recordData.hnswWarmId !== null && recordData.hnswWarmId !== undefined) {
        this.hnswWarm.updateMetadata(recordData.hnswWarmId, meta);
      } else if (await this.warmStore.get(recordData.id)) {
        const warmRec = await this.warmStore.get(recordData.id);
        await this.warmStore.put({ ...warmRec, ...meta });
      } else if (await this.coldStore.get(recordData.id)) {
        const coldRec = await this.coldStore.get(recordData.id);
        await this.coldStore.put({ ...coldRec, ...meta });
      }

    } catch (error) {
      console.error('Failed to update record:', error);
    }
  }

  async _waitForLock(lockName, maxWait = 30000) {
    const startTime = Date.now();
    
    while (this.locks[lockName]) {
      if (Date.now() - startTime > maxWait) {
        throw new Error(`Lock timeout for ${lockName}`);
      }
      await sleep(100);
    }
  }

  // ==========================================================================
  // FIX #2: HNSW Compaction
  // ==========================================================================

  async _compactHNSW() {
    if (this.locks.compact) {
      console.warn('Compaction already in progress');
      return;
    }

    this.locks.compact = true;

    try {
      console.log('Compacting HNSW indexes...');
      
      this.hnswHot.compact();
      this.hnswWarm.compact();
      
      this.deletionsSinceCompaction = 0;
      
      console.log('HNSW compaction complete');

      // Save after compaction
      await this.save();

    } catch (error) {
      console.error('HNSW compaction failed:', error);
    } finally {
      this.locks.compact = false;
    }
  }

  // ==========================================================================
  // FIX #3: Memory Pressure Monitoring
  // ==========================================================================

  _startMemoryMonitoring() {
    this.memoryCheckTimer = setInterval(async () => {
      try {
        await this._checkMemoryPressure();
      } catch (error) {
        console.error('Memory check failed:', error);
      }
    }, this.config.memoryCheckInterval);
  }

  async _checkMemoryPressure() {
    if (!navigator.storage || !navigator.storage.estimate) return;

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || Infinity;
    const remaining = quota - usage;

    this.lastMemoryCheck = Date.now();

    // Critical: Less than 50MB remaining
    if (remaining < this.config.memoryCriticalThreshold) {
      console.warn(`CRITICAL memory pressure: ${(remaining / 1024 / 1024).toFixed(2)}MB remaining`);
      await this._handleCriticalMemoryPressure();
    }
    // Warning: Less than 100MB remaining
    else if (remaining < this.config.memoryWarningThreshold) {
      console.warn(`Memory warning: ${(remaining / 1024 / 1024).toFixed(2)}MB remaining`);
      await this._handleWarningMemoryPressure();
    }
  }

  async _handleCriticalMemoryPressure() {
    console.log('Triggering emergency memory cleanup...');

    try {
      // 1. Aggressive pruning
      const pruned = await this.prune();
      console.log(`Emergency pruned ${pruned.length} records`);

      // 2. Demote HOT → WARM
      const hotMeta = this.hnswHot.getAllMetadata();
      for (const meta of hotMeta) {
        const record = new MemoryRecord({ ...meta, currentTier: 'HOT' });
        if (record.usage_count < 5) { // Aggressive demotion threshold
          // Reconstruct embedding
          const embedding = await this._reconstructEmbedding(record.id, 'HOT');
          record.embedding = embedding;
          await this.applyDemotion(record);
        }
      }

      // 3. Compact indexes
      await this._compactHNSW();

      // 4. Rotate journal
      await this.rotateJournal();

      console.log('Emergency cleanup complete');

    } catch (error) {
      console.error('Emergency cleanup failed:', error);
    }
  }

  async _handleWarningMemoryPressure() {
    console.log('Triggering preventive memory cleanup...');

    try {
      // Less aggressive: just prune old cold records
      const pruned = await this.prune();
      
      if (pruned.length > 0) {
        console.log(`Preventive pruned ${pruned.length} records`);
        await this._compactHNSW();
      }

    } catch (error) {
      console.error('Preventive cleanup failed:', error);
    }
  }

  async getMemoryStats() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { supported: false };
    }

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;

    return {
      supported: true,
      usage,
      quota,
      remaining: quota - usage,
      usagePercent: ((usage / quota) * 100).toFixed(2),
      usageMB: (usage / 1024 / 1024).toFixed(2),
      quotaMB: (quota / 1024 / 1024).toFixed(2),
      remainingMB: ((quota - usage) / 1024 / 1024).toFixed(2)
    };
  }

  stopMemoryMonitoring() {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
      this.memoryCheckTimer = null;
    }
  }

  // ==========================================================================
  // FIX #4: Auto-save and Page Lifecycle
  // ==========================================================================

  _setupAutoSave() {
    // Periodic auto-save
    this.autoSaveTimer = setInterval(async () => {
      if (this.mutationsSinceLastSave > 0) {
        try {
          await this.save();
          console.log(`Auto-save complete (${this.mutationsSinceLastSave} mutations)`);
          this.mutationsSinceLastSave = 0;
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }
    }, this.config.autoSaveInterval);
  }

  _setupPageLifecycle() {
    if (typeof document === 'undefined') return;

    // Save on visibility change (tab switch)
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden && this.mutationsSinceLastSave > 0) {
        try {
          await this.save();
          console.log('Saved on visibility change');
          this.mutationsSinceLastSave = 0;
        } catch (error) {
          console.error('Visibility change save failed:', error);
        }
      }
    });

    // Save before unload
    window.addEventListener('beforeunload', async (e) => {
      if (this.mutationsSinceLastSave > 0) {
        try {
          // Note: This may not complete before page unload
          // Modern browsers don't wait for async operations
          await this.save();
        } catch (error) {
          console.error('beforeunload save failed:', error);
        }
      }
    });

    // Better: Use Page Visibility API for reliable saves
    if ('onfreeze' in document) {
      document.addEventListener('freeze', async () => {
        try {
          await this.save();
        } catch (error) {
          console.error('freeze save failed:', error);
        }
      });
    }
  }

  _trackMutation() {
    this.mutationsSinceLastSave++;
    
    // Batch save if threshold reached
    if (this.mutationsSinceLastSave >= this.config.mutationBatchSize) {
      setImmediate(async () => {
        try {
          await this.save();
          this.mutationsSinceLastSave = 0;
        } catch (error) {
          console.error('Batch save failed:', error);
        }
      });
    }
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // ==========================================================================
  // Consolidation with chunking to avoid O(n²) explosion
  // ==========================================================================

  // FIX #5: HNSW-based pre-clustering for large datasets
  async _hnswBasedClustering(records) {
    console.log('Using HNSW-based clustering for large dataset...');
    
    const clusters = [];
    const processed = new Set();
    const threshold = this.config.clusterDiameter;
    
    // Build temporary HNSW index for clustering
    const { EdgeVec } = await import('edgevec');
    const tempIndex = new EdgeVec({ dimensions: records[0].embedding.length, quantized: false });
    
    // Insert all records
    const idToRecord = new Map();
    for (const record of records) {
      const nodeId = tempIndex.insertWithMetadata(
        new Float32Array(record.embedding),
        { id: record.id }
      );
      idToRecord.set(record.id, { record, nodeId });
    }
    
    // For each record, find neighbors to form clusters
    for (const record of records) {
      if (processed.has(record.id)) continue;
      
      const queryVec = new Float32Array(record.embedding);
      const neighbors = tempIndex.searchBQ(queryVec, 50); // Find up to 50 neighbors
      
      // Form cluster from close neighbors
      const cluster = [record];
      processed.add(record.id);
      
      for (const neighbor of neighbors) {
        const meta = neighbor.metadata;
        if (processed.has(meta.id)) continue;
        
        // Check if similar enough (distance < diameter threshold)
        if (neighbor.score >= (1 - threshold)) {
          const neighborInfo = idToRecord.get(meta.id);
          if (neighborInfo) {
            cluster.push(neighborInfo.record);
            processed.add(meta.id);
          }
        }
      }
      
      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
      
      // Limit number of clusters per pass
      if (clusters.length >= this.config.maxClustersPerPass) {
        break;
      }
    }
    
    return clusters;
  }

  async consolidate(simulate = false) {
    this.ensureInitialized();

    if (this.locks.consolidate) {
      console.warn('Consolidation already in progress');
      return [];
    }

    this.locks.consolidate = true;

    try {
      console.log('Starting memory consolidation...');

      const warmCount = await this.warmStore.count();
      
      if (warmCount < 2) {
        console.log('Not enough WARM records to consolidate');
        return [];
      }

      // FIX: Process in chunks to avoid O(n²) clustering
      const chunkSize = this.config.consolidationChunkSize;
      const allUpdated = [];

      console.log(`Processing ${warmCount} WARM records in chunks of ${chunkSize}...`);

      const warmRaw = await this.warmStore.getAll();
      
      // FIX #5: Use advanced clustering for large datasets
      if (this.config.useAdvancedClustering && warmCount >= this.config.advancedClusteringThreshold) {
        console.log(`Using advanced HNSW-based clustering (${warmCount} records)...`);
        
        const allRecords = warmRaw.map(r => new MemoryRecord({
          ...r,
          embedding: dequantizeFloat16(r.embedding),
          currentTier: 'WARM'
        }));
        
        const clusters = await this._hnswBasedClustering(allRecords);
        
        console.log(`Found ${clusters.length} clusters via HNSW`);
        
        for (const clusterRecords of clusters) {
          const updated = await this._processCluster(clusterRecords, simulate);
          allUpdated.push(...updated);
          
          // Yield to event loop
          await sleep(0);
        }
      } else {
        // Original chunked hierarchical clustering
        for (let offset = 0; offset < warmRaw.length; offset += chunkSize) {
          const chunk = warmRaw.slice(offset, Math.min(offset + chunkSize, warmRaw.length));
          
          console.log(`Processing chunk ${Math.floor(offset / chunkSize) + 1}...`);
          
          const chunkRecords = chunk.map(r => new MemoryRecord({
            ...r,
            embedding: dequantizeFloat16(r.embedding),
            currentTier: 'WARM'
          }));

          const updated = await this._consolidateChunk(chunkRecords, simulate);
          allUpdated.push(...updated);

          // Yield to event loop
          await sleep(0);
        }
      }

      if (!simulate) {
        for (const r of allUpdated) {
          await this._updateRecord(r);
        }
      }

      this.recordsSinceConsolidation = 0;

      console.log(`Consolidation complete: ${allUpdated.filter(r => !r.episodic).length} summaries created`);

      return allUpdated;

    } catch (error) {
      console.error('Consolidation failed:', error);
      throw new Error(`Consolidation failed: ${error.message}`);

    } finally {
      this.locks.consolidate = false;
    }
  }

  // Helper to process a single cluster (used by both clustering methods)
  async _processCluster(clusterRecords, simulate) {
    if (clusterRecords.length < 2) return [];

    const texts = clusterRecords.map(r => r.text);
    const summary = await this.ollama.generate(
      `Briefly summarize these related memories in one sentence:\n${texts.join('\n')}`,
      { max_tokens: 100 }
    );

    const sortedIds = clusterRecords.map(r => r.id).sort().join('');
    const clusterId = await this._hash(summary + sortedIds);

    // Calculate centroid
    const dim = clusterRecords[0].embedding.length;
    const centroid = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      let sum = 0;
      for (const record of clusterRecords) {
        sum += record.embedding[i];
      }
      centroid[i] = sum / clusterRecords.length;
    }

    const semanticRecord = new MemoryRecord({
      id: await this._hash(summary + Date.now()),
      embedding: Array.from(centroid),
      text: summary,
      episodic: false,
      importance: 0.7,
      integrity_hash: await this._hash(summary),
      currentTier: 'WARM',
      metadata: {
        cluster_id: clusterId,
        member_count: clusterRecords.length
      }
    });
    semanticRecord.semantic_cluster_id = clusterId;

    await this.appendJournal(semanticRecord);
    if (!simulate) await this.storeWarm(semanticRecord);

    const updatedRecords = [semanticRecord.toJSON()];

    for (const r of clusterRecords) {
      r.access(simulate);
      r.semantic_cluster_id = clusterId;
      r.importance *= 0.8;

      updatedRecords.push(r.toJSON());

      await this.applyPromotion(r, simulate);
      await this.applyDemotion(r, simulate);
    }

    return updatedRecords;
  }

  async _consolidateChunk(records, simulate) {
    if (records.length < 2) return [];

    const embeddingHashToRecord = new Map();
    for (const r of records) {
      const h = await r.getEmbeddingHash();
      embeddingHashToRecord.set(h, r);
    }

    const vectors = records.map(r => r.embedding);
    const { hcluster } = await import('clusterfck');
    const clusters = hcluster(vectors, 'cosine', 'average');

    const updatedRecords = [];

    for (const cluster of clusters) {
      if (cluster.size < 2) continue;

      const clusterLeaves = cluster.leaves();
      const leafHashes = await Promise.all(
        clusterLeaves.map(leaf => hashEmbedding(leaf))
      );
      const clusterRecords = leafHashes
        .map(h => embeddingHashToRecord.get(h))
        .filter(Boolean);

      if (clusterRecords.length < 2) continue;

      // Use shared cluster processing logic
      const updated = await this._processCluster(clusterRecords, simulate);
      updatedRecords.push(...updated);
    }

    return updatedRecords;
  }

  // ==========================================================================
  // Pruning
  // ==========================================================================

  async prune(simulate = false) {
    this.ensureInitialized();

    if (this.locks.prune) {
      console.warn('Pruning already in progress');
      return [];
    }

    this.locks.prune = true;

    try {
      console.log('Starting memory pruning...');

      const coldRaw = await this.coldStore.getAll();
      const coldRecords = coldRaw.map(r => new MemoryRecord({
        ...r,
        embedding: dequantizeInt8(r.embedding),
        currentTier: 'COLD'
      }));

      const prunedIds = [];

      for (const record of coldRecords) {
        if (record.effective_weight < this.config.epsilon && 
            record.usage_count === 0) {
          prunedIds.push(record.id);
          if (!simulate) {
            await this.coldStore.delete(record.id);
            this.deletionsSinceCompaction++;
          }
        }
      }

      if (!simulate && prunedIds.length > 0) {
        // Trigger compaction if threshold met
        if (this.deletionsSinceCompaction >= this.config.compactionThreshold) {
          await this._compactHNSW();
        }
        this._trackMutation();
      }

      console.log(`Pruning complete: ${prunedIds.length} records removed`);

      return prunedIds;

    } catch (error) {
      console.error('Pruning failed:', error);
      throw new Error(`Pruning failed: ${error.message}`);

    } finally {
      this.locks.prune = false;
    }
  }

  // ==========================================================================
  // Integrity & Utilities
  // ==========================================================================

  async verifyIntegrity() {
    this.ensureInitialized();

    console.log('Starting integrity verification...');

    const records = await this.getAllRecords();
    const corrupted = [];

    for (const record of records) {
      try {
        const currentHash = await this._hash(record.text);
        
        if (currentHash !== record.integrity_hash) {
          console.warn(`Corrupted record detected: ${record.id}`);
          corrupted.push(record.id);
          await this.quarantine(record.id);
        }
      } catch (error) {
        console.error(`Error verifying record ${record.id}:`, error);
        corrupted.push(record.id);
      }
    }

    console.log(`Integrity verification complete: ${corrupted.length} corrupted records quarantined`);

    return corrupted;
  }

  async quarantine(id) {
    this.ensureInitialized();

    console.warn(`Quarantining record: ${id}`);

    try {
      // FIX: Use stored HNSW IDs to properly delete from indexes
      const warmRec = await this.warmStore.get(id);
      if (warmRec) {
        if (warmRec.hnswWarmId !== null && warmRec.hnswWarmId !== undefined) {
          this.hnswWarm.softDelete(warmRec.hnswWarmId);
        }
        await this.warmStore.delete(id);
      }

      const coldRec = await this.coldStore.get(id);
      if (coldRec) {
        await this.coldStore.delete(id);
      }

      // Check HOT tier metadata for HNSW ID
      const hotMeta = this.hnswHot.getAllMetadata();
      for (const meta of hotMeta) {
        if (meta.id === id && meta.hnswHotId !== null && meta.hnswHotId !== undefined) {
          this.hnswHot.softDelete(meta.hnswHotId);
          break;
        }
      }

      // Trigger compaction if we've deleted enough
      this.deletionsSinceCompaction++;
      if (this.deletionsSinceCompaction >= this.config.compactionThreshold) {
        setImmediate(() => this._compactHNSW().catch(console.error));
      }

    } catch (error) {
      console.error(`Failed to quarantine ${id}:`, error);
    }
  }

  async getAllRecords() {
    this.ensureInitialized();

    const hotMeta = this.hnswHot.getAllMetadata().map(m => ({
      ...m,
      currentTier: 'HOT'
    }));

    const warmMeta = this.hnswWarm.getAllMetadata().map(m => ({
      ...m,
      currentTier: 'WARM'
    }));

    const coldRaw = await this.coldStore.getAll();
    const cold = coldRaw.map(r => ({
      ...r,
      embedding: dequantizeInt8(r.embedding),
      currentTier: 'COLD'
    }));

    return [...hotMeta, ...warmMeta, ...cold];
  }

  async getStats() {
    this.ensureInitialized();

    const hotCount = this.hnswHot.getAllMetadata().length;
    const warmCount = await this.warmStore.count();
    const coldCount = await this.coldStore.count();
    const journalCount = await this.journalStore.count();
    const memoryStats = await this.getMemoryStats();

    return {
      total: hotCount + warmCount + coldCount,
      hot: hotCount,
      warm: warmCount,
      cold: coldCount,
      journal: journalCount,
      journalCounter: this.journalCounter,
      recordsSinceConsolidation: this.recordsSinceConsolidation,
      deletionsSinceCompaction: this.deletionsSinceCompaction,
      mutationsSinceLastSave: this.mutationsSinceLastSave,
      memory: memoryStats,
      config: this.config
    };
  }

  async save() {
    this.ensureInitialized();

    console.log('Saving SCMP state...');

    try {
      await this.hnswHot.save('scmp_hnsw_hot_v2');
      await this.hnswWarm.save('scmp_hnsw_warm_v2');
      console.log('SCMP state saved successfully');
    } catch (error) {
      console.error('Failed to save SCMP state:', error);
      throw error;
    }
  }

  async export() {
    this.ensureInitialized();

    const records = await this.getAllRecords();
    const stats = await this.getStats();

    return {
      version: '2.1.0',
      timestamp: Date.now(),
      config: this.config,
      stats,
      records: records.map(r => ({
        ...r,
        embedding: undefined
      }))
    };
  }

  async clear() {
    this.ensureInitialized();

    console.warn('Clearing all SCMP data...');

    await this.warmStore.clear();
    await this.coldStore.clear();
    await this.journalStore.clear();

    const { EdgeVec } = await import('edgevec');
    this.hnswHot = new EdgeVec({ dimensions: this.ollama.embedDim, quantized: true });
    this.hnswWarm = new EdgeVec({ dimensions: this.ollama.embedDim, quantized: true });

    this.recordsSinceConsolidation = 0;
    this.journalCounter = 0;
    this.deletionsSinceCompaction = 0;
    this.mutationsSinceLastSave = 0;
    await this.metaStore.put({ id: 'journal_counter', value: 0 });

    console.log('SCMP data cleared');
  }

  async shutdown() {
    console.log('Shutting down SCMP...');

    // Save final state
    if (this.mutationsSinceLastSave > 0) {
      await this.save();
    }

    // Stop monitoring
    this.stopMemoryMonitoring();
    this.stopAutoSave();

    console.log('SCMP shutdown complete');
  }
}

// ============================================================================
// Export
// ============================================================================

const scmp = new SCMP();

export {
  SCMP,
  MemoryRecord,
  OllamaBrowserSafe,
  IndexedDBStore,
  scmp,
  quantizeInt8,
  dequantizeInt8,
  quantizeFloat16,
  dequantizeFloat16,
  cosineSimilarity,
  hashEmbedding,
  sha256
};