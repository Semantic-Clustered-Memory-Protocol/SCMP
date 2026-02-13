# SCMP API Documentation

## Table of Contents
- [Initialization](#initialization)
- [Core Methods](#core-methods)
- [Configuration](#configuration)
- [Data Types](#data-types)
- [Utility Functions](#utility-functions)

## Initialization

### `new SCMP(config?)`

Creates a new SCMP instance.

**Parameters:**
- `config` (optional): Configuration object

**Example:**
```javascript
const scmp = new SCMP({
  ollamaUrl: 'http://localhost:11434',
  model: 'nomic-embed-text',
  embedDim: 768,
  hotCapacity: 10000
});
```

### `scmp.init()`

Initializes the SCMP instance. **Must be called before any other operations.**

**Returns:** `Promise<void>`

**Example:**
```javascript
await scmp.init();
```

## Core Methods

### `scmp.remember(text, metadata?)`

Stores a new memory.

**Parameters:**
- `text` (string): The text to remember
- `metadata` (object, optional): Additional metadata

**Returns:** `Promise<MemoryRecord>`

**Example:**
```javascript
const memory = await scmp.remember("Paris is the capital of France", {
  type: 'fact',
  category: 'geography',
  source: 'user-input'
});
```

### `scmp.recall(query, options?)`

Searches for relevant memories using semantic similarity.

**Parameters:**
- `query` (string): Search query
- `options` (object, optional):
  - `limit` (number): Max results (default: 10)
  - `threshold` (number): Min similarity 0-1 (default: 0.5)
  - `filter` (object): Metadata filters
  - `includeEmbeddings` (boolean): Include vectors in results

**Returns:** `Promise<RecallResult[]>`

**Example:**
```javascript
const results = await scmp.recall("capital of France", {
  limit: 5,
  threshold: 0.7,
  filter: { type: 'fact' }
});
```

### `scmp.forget(id)`

Deletes a memory by ID.

**Parameters:**
- `id` (string): Memory ID

**Returns:** `Promise<void>`

**Example:**
```javascript
await scmp.forget('memory-id-123');
```

### `scmp.update(id, updates)`

Updates a memory's metadata.

**Parameters:**
- `id` (string): Memory ID
- `updates` (object): Partial updates

**Returns:** `Promise<void>`

**Example:**
```javascript
await scmp.update('memory-id-123', {
  metadata: { verified: true }
});
```

### `scmp.batchRemember(items)`

Efficiently stores multiple memories.

**Parameters:**
- `items` (array): Array of `{text, metadata}` objects

**Returns:** `Promise<MemoryRecord[]>`

**Example:**
```javascript
const memories = await scmp.batchRemember([
  { text: "Fact 1", metadata: { type: 'fact' } },
  { text: "Fact 2", metadata: { type: 'fact' } }
]);
```

## Maintenance Methods

### `scmp.consolidate(simulate?)`

Merges journal entries into main storage tiers.

**Parameters:**
- `simulate` (boolean, optional): Dry run mode

**Returns:** `Promise<MemoryRecord[]>` - Consolidated records

**Example:**
```javascript
// Check what would be consolidated
const records = await scmp.consolidate(true);

// Actually consolidate
await scmp.consolidate(false);
```

### `scmp.prune(simulate?)`

Removes low-value memories based on effective weight and usage.

**Parameters:**
- `simulate` (boolean, optional): Dry run mode

**Returns:** `Promise<string[]>` - IDs of pruned memories

**Example:**
```javascript
// See what would be pruned
const pruned = await scmp.prune(true);

// Actually prune
await scmp.prune(false);
```

### `scmp.verifyIntegrity()`

Checks for corrupted records and quarantines them.

**Returns:** `Promise<string[]>` - IDs of corrupted records

**Example:**
```javascript
const corrupted = await scmp.verifyIntegrity();
if (corrupted.length > 0) {
  console.log(`Found ${corrupted.length} corrupted records`);
}
```

## Information Methods

### `scmp.getAllRecords()`

Retrieves all memory records across all tiers.

**Returns:** `Promise<MemoryRecord[]>`

**Example:**
```javascript
const records = await scmp.getAllRecords();
console.log(`Total memories: ${records.length}`);
```

### `scmp.getStats()`

Returns detailed statistics about SCMP state.

**Returns:** `Promise<SCMPStats>`

**Example:**
```javascript
const stats = await scmp.getStats();
console.log(`
  Total: ${stats.total}
  HOT: ${stats.hot}
  WARM: ${stats.warm}
  COLD: ${stats.cold}
  Memory: ${(stats.memory.estimatedBytes / 1024 / 1024).toFixed(2)} MB
`);
```

## Persistence Methods

### `scmp.save()`

Manually saves SCMP state to IndexedDB.

**Returns:** `Promise<void>`

**Note:** Auto-save is enabled by default every 5 minutes.

**Example:**
```javascript
await scmp.save();
```

### `scmp.export()`

Exports all data (without embeddings for size).

**Returns:** `Promise<ExportData>`

**Example:**
```javascript
const data = await scmp.export();
console.log(JSON.stringify(data, null, 2));
```

### `scmp.clear()`

Deletes all SCMP data. **Cannot be undone!**

**Returns:** `Promise<void>`

**Example:**
```javascript
if (confirm('Delete all data?')) {
  await scmp.clear();
}
```

### `scmp.shutdown()`

Gracefully shuts down SCMP, saving any pending changes.

**Returns:** `Promise<void>`

**Example:**
```javascript
await scmp.shutdown();
```

## Configuration

Default configuration values:

```javascript
{
  // Ollama Settings
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'nomic-embed-text',
  embedDim: 768,
  
  // Capacity Limits
  hotCapacity: 10000,
  warmCapacity: 100000,
  coldCapacity: 1000000,
  
  // Memory Management
  decayRate: 0.95,        // 5% decay per day
  epsilon: 0.01,          // Prune memories below this weight
  
  // Performance Tuning
  consolidateThreshold: 100,   // Records before consolidation
  compactionThreshold: 50,     // Deletions before compaction
  autoSaveInterval: 300000     // 5 minutes
}
```

## Data Types

### MemoryRecord

```typescript
interface MemoryRecord {
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
```

### RecallResult

```typescript
interface RecallResult {
  id: string;
  text: string;
  similarity: number;    // 0-1
  metadata: MemoryMetadata;
  currentTier: 'HOT' | 'WARM' | 'COLD';
  embedding?: number[];  // If includeEmbeddings: true
}
```

### SCMPStats

```typescript
interface SCMPStats {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  journal: number;
  memory: {
    estimatedBytes: number;
    quota: number;
    usage: number;
    pressure: number;
  };
  config: SCMPConfig;
}
```

## Utility Functions

These functions are exported for advanced use cases:

### `quantizeInt8(vec)`
8x compression for vectors.

### `dequantizeInt8(packed)`
Decompress int8 vectors.

### `quantizeFloat16(vec)`
2x compression for vectors.

### `dequantizeFloat16(packed)`
Decompress float16 vectors.

### `cosineSimilarity(a, b)`
Calculate similarity between two vectors.

### `hashEmbedding(embedding)`
Generate SHA-256 hash of an embedding.

### `sha256(text)`
Generate SHA-256 hash of text.

## Error Handling

SCMP throws errors for invalid operations:

```javascript
try {
  await scmp.remember(null);
} catch (error) {
  console.error('Error:', error.message);
}
```

Common errors:
- `"Store not open"` - Call `init()` first
- `"Vector dimension mismatch"` - Embeddings must match configured dimension
- `"Consolidation already in progress"` - Wait for current consolidation
- `"Pruning already in progress"` - Wait for current pruning

## Best Practices

1. **Always initialize**: Call `init()` before any operations
2. **Use batch operations**: More efficient for multiple items
3. **Monitor stats**: Check `getStats()` regularly
4. **Consolidate periodically**: Prevents journal bloat
5. **Prune low-value memories**: Keeps database size manageable
6. **Save before shutdown**: `shutdown()` handles this automatically
7. **Handle errors**: Wrap operations in try-catch
8. **Set appropriate thresholds**: Tune similarity thresholds for your use case

## Performance Tips

- Use smaller embeddings (384-dim) for faster search
- Increase `hotCapacity` if you have memory to spare
- Lower `consolidateThreshold` for write-heavy workloads
- Use `batchRemember` for bulk inserts
- Filter by metadata before similarity search when possible
