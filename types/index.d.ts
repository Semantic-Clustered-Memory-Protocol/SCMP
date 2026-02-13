/**
 * TypeScript definitions for SCMP v2.1.0
 */

export interface SCMPConfig {
  /** Ollama server URL (default: "http://127.0.0.1:11434") */
  ollamaUrl?: string;
  /** Embedding model name (default: "nomic-embed-text") */
  model?: string;
  /** Embedding dimension (default: 768) */
  embedDim?: number;
  /** Maximum vectors in HOT tier (default: 10000) */
  hotCapacity?: number;
  /** Maximum vectors in WARM tier (default: 100000) */
  warmCapacity?: number;
  /** Maximum vectors in COLD tier (default: 1000000) */
  coldCapacity?: number;
  /** Memory decay rate per day (default: 0.95) */
  decayRate?: number;
  /** Pruning threshold (default: 0.01) */
  epsilon?: number;
  /** Records before journal consolidation (default: 100) */
  consolidateThreshold?: number;
  /** Deletions before HNSW compaction (default: 50) */
  compactionThreshold?: number;
  /** Auto-save interval in ms (default: 300000) */
  autoSaveInterval?: number;
}

export interface MemoryMetadata {
  /** Memory type: 'episodic' or 'semantic' */
  type?: 'episodic' | 'semantic' | string;
  /** User-defined category */
  category?: string;
  /** Source of the memory */
  source?: string;
  /** Role in conversation */
  role?: 'user' | 'assistant' | 'system' | string;
  /** Conversation ID */
  conversationId?: number | string;
  /** Timestamp */
  timestamp?: number;
  /** Whether this is factual information */
  isFactual?: boolean;
  /** Any additional metadata */
  [key: string]: any;
}

export interface MemoryRecord {
  /** Unique identifier */
  id: string;
  /** Original text */
  text: string;
  /** Embedding vector */
  embedding: number[];
  /** User metadata */
  metadata: MemoryMetadata;
  /** Current storage tier */
  currentTier: 'HOT' | 'WARM' | 'COLD';
  /** Effective weight (with decay) */
  effective_weight: number;
  /** Access count */
  usage_count: number;
  /** Creation timestamp */
  created_at: number;
  /** Last accessed timestamp */
  last_accessed: number;
  /** Integrity hash */
  integrity_hash: string;
}

export interface RecallOptions {
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Minimum similarity threshold 0-1 (default: 0.5) */
  threshold?: number;
  /** Filter by metadata */
  filter?: Partial<MemoryMetadata>;
  /** Include embeddings in results */
  includeEmbeddings?: boolean;
}

export interface RecallResult {
  /** Unique identifier */
  id: string;
  /** Original text */
  text: string;
  /** Cosine similarity score 0-1 */
  similarity: number;
  /** User metadata */
  metadata: MemoryMetadata;
  /** Current storage tier */
  currentTier: 'HOT' | 'WARM' | 'COLD';
  /** Embedding vector (if includeEmbeddings: true) */
  embedding?: number[];
}

export interface SCMPStats {
  /** Total number of memories */
  total: number;
  /** Memories in HOT tier */
  hot: number;
  /** Memories in WARM tier */
  warm: number;
  /** Memories in COLD tier */
  cold: number;
  /** Journal entries */
  journal: number;
  /** Journal counter */
  journalCounter: number;
  /** Records since last consolidation */
  recordsSinceConsolidation: number;
  /** Deletions since last compaction */
  deletionsSinceCompaction: number;
  /** Mutations since last save */
  mutationsSinceLastSave: number;
  /** Memory usage statistics */
  memory: {
    estimatedBytes: number;
    quota: number;
    usage: number;
    pressure: number;
  };
  /** Current configuration */
  config: SCMPConfig;
}

export interface ExportData {
  /** SCMP version */
  version: string;
  /** Export timestamp */
  timestamp: number;
  /** Configuration */
  config: SCMPConfig;
  /** Statistics */
  stats: SCMPStats;
  /** All records (without embeddings) */
  records: Omit<MemoryRecord, 'embedding'>[];
}

export class SCMP {
  constructor(config?: SCMPConfig);
  
  /**
   * Initialize SCMP - must be called before use
   */
  init(): Promise<void>;
  
  /**
   * Store a new memory
   * @param text - The text to remember
   * @param metadata - Optional metadata
   * @returns The created memory record
   */
  remember(text: string, metadata?: MemoryMetadata): Promise<MemoryRecord>;
  
  /**
   * Search for relevant memories
   * @param query - The search query
   * @param options - Search options
   * @returns Array of matching memories
   */
  recall(query: string, options?: RecallOptions): Promise<RecallResult[]>;
  
  /**
   * Delete a memory by ID
   * @param id - Memory ID to delete
   */
  forget(id: string): Promise<void>;
  
  /**
   * Update a memory's metadata
   * @param id - Memory ID
   * @param updates - Partial updates
   */
  update(id: string, updates: Partial<MemoryRecord>): Promise<void>;
  
  /**
   * Batch remember multiple items
   * @param items - Array of {text, metadata} objects
   */
  batchRemember(items: Array<{text: string, metadata?: MemoryMetadata}>): Promise<MemoryRecord[]>;
  
  /**
   * Consolidate journal entries into main stores
   * @param simulate - Dry run without actual changes
   * @returns Array of consolidated records
   */
  consolidate(simulate?: boolean): Promise<MemoryRecord[]>;
  
  /**
   * Remove low-value memories
   * @param simulate - Dry run without actual deletion
   * @returns Array of pruned IDs
   */
  prune(simulate?: boolean): Promise<string[]>;
  
  /**
   * Verify data integrity
   * @returns Array of corrupted record IDs
   */
  verifyIntegrity(): Promise<string[]>;
  
  /**
   * Get all memory records
   * @returns All records across all tiers
   */
  getAllRecords(): Promise<MemoryRecord[]>;
  
  /**
   * Get SCMP statistics
   */
  getStats(): Promise<SCMPStats>;
  
  /**
   * Save SCMP state to storage
   */
  save(): Promise<void>;
  
  /**
   * Export all data
   */
  export(): Promise<ExportData>;
  
  /**
   * Clear all data
   */
  clear(): Promise<void>;
  
  /**
   * Shutdown SCMP gracefully
   */
  shutdown(): Promise<void>;
}

export class MemoryRecord {
  constructor(data: Partial<MemoryRecord>);
  id: string;
  text: string;
  embedding: number[];
  metadata: MemoryMetadata;
  currentTier: 'HOT' | 'WARM' | 'COLD';
  effective_weight: number;
  usage_count: number;
  created_at: number;
  last_accessed: number;
  integrity_hash: string;
}

export class OllamaBrowserSafe {
  constructor(config: {
    url?: string;
    model?: string;
    embedDim?: number;
  });
  
  embed(text: string): Promise<number[]>;
  batchEmbed(texts: string[]): Promise<number[][]>;
}

export class IndexedDBStore {
  constructor(dbName: string, storeName: string);
  
  open(): Promise<void>;
  put(record: any): Promise<void>;
  putBatch(records: any[]): Promise<void>;
  get(id: string): Promise<any>;
  getAll(): Promise<any[]>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * Quantize float32 array to int8 (8x compression)
 */
export function quantizeInt8(vec: number[]): number[];

/**
 * Dequantize int8 array back to float32
 */
export function dequantizeInt8(packed: number[]): number[];

/**
 * Quantize float32 array to float16 (2x compression)
 */
export function quantizeFloat16(vec: number[]): Uint16Array;

/**
 * Dequantize float16 array back to float32
 */
export function dequantizeFloat16(packed: Uint16Array | number[]): number[];

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number;

/**
 * Generate SHA-256 hash of an embedding
 */
export function hashEmbedding(embedding: number[]): Promise<string>;

/**
 * Generate SHA-256 hash of text
 */
export function sha256(text: string): Promise<string>;

/**
 * Default SCMP instance
 */
export const scmp: SCMP;
