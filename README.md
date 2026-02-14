
# SCMP - Semantic Clustered Memory Protocol

## The world’s first browser-native vector database


⸻

### 🚀 What is SCMP?

SCMP is a vector database that runs entirely in your browser. No servers, no cloud, no API calls. Think Pinecone or Weaviate—but browser-native with zero infrastructure costs.

This repository contains the core SCMP system. Advanced features and private extensions are available separately for trusted collaborators or strategic partners.

⸻

### Why SCMP?
	•	🔒 Privacy First – Your embeddings never leave your device. Ideal for GDPR/CCPA-compliant applications, healthcare, legal, and finance.
	•	💰 Zero Cost – No cloud bills, no API rate limits, no egress fees. Scales with your users—each browser is the infrastructure.
	•	⚡ Lightning Fast – HNSW indexing enables sub-millisecond queries for 100K+ vectors.
	•	📴 Offline Ready – Works fully offline, perfect for mobile apps, field work, and edge computing.
	•	🎯 Production Ready – 2,000+ lines of battle-tested code with multi-tier storage, crash recovery, and memory management.

⸻

## ✨ Features

### Core Vector Database
	•	HNSW approximate nearest neighbor search
	•	Cosine similarity search
	•	Batch insert/update/delete
	•	Metadata filtering
	•	Persistence via IndexedDB with crash recovery

### Advanced Memory Management
	•	Multi-tier storage: HOT (memory) / WARM (IndexedDB) / COLD (compressed)
	•	LRU-based automatic tiering
	•	Vector quantization (int8/float16)
	•	Smart memory compaction
	•	Automatic memory cleanup under pressure

### Semantic & Episodic Memory
	•	Semantic clustering for related memories
	•	Short-term vs long-term memory management
	•	Temporal decay configurable per memory
	•	Intelligent pruning of low-value memories

### Developer Experience
	•	Local embeddings generation (Ollama integration)
	•	Pure ES Modules and TypeScript support
	•	Zero dependencies (except edgevec)
	•	Ready-to-use examples for RAG, semantic search, chatbots

⸻

📦 Installation

npm install soon

Or via CDN:

<script type="module">
  import { SCMP } from 'soon';
</script>


⸻

🎯 Quick Start

import { SCMP } from 'soon';

const scmp = new SCMP({
  ollamaUrl: 'http://localhost:11434',
  model: 'nomic-embed-text'
});

await scmp.init();

// Remember memories
await scmp.remember("Paris is the capital of France", { type: 'fact' });
await scmp.remember("The Eiffel Tower is in Paris", { type: 'fact' });

// Semantic search
const results = await scmp.recall("What's the capital of France?", { limit: 5 });
console.log(results[0].text); // Paris is the capital of France

See full examples for RAG, chatbot memory, and document Q&A in examples/usage-examples.js.

⸻

🏗️ Architecture

Multi-Tier Storage

HOT (In-memory HNSW)  →  WARM (IndexedDB)  →  COLD (Compressed Storage)

	•	HOT: Sub-millisecond search, ~10K vectors
	•	WARM: IndexedDB, moderate capacity ~100K
	•	COLD: Compressed, int8 quantization, 1M+ vectors

⸻

🔧 Configuration
```js
const scmp = new SCMP({
  ollamaUrl: 'http://localhost:11434',
  model: 'nomic-embed-text',
  embedDim: 768,
  hotCapacity: 10000,
  warmCapacity: 100000,
  coldCapacity: 1000000,
  decayRate: 0.95,
  epsilon: 0.01,
  consolidateThreshold: 100,
  compactionThreshold: 50,
  autoSaveInterval: 300000
});
```

⸻

### 📚 API Reference
	•	init(), remember(text, metadata), recall(query, options)
	•	forget(id), update(id, updates)
	•	batchRemember(items), consolidate(), prune(), verifyIntegrity()
	•	getStats(), getAllRecords(), export(), clear(), shutdown()





### 🎨 Use Cases
	1.	Personal AI assistant
	2.	Document semantic search
	3.	Knowledge base / Notion competitor
	4.	Codebase AI assistant
	5.	HIPAA-compliant healthcare records
	6.	Legal research with local-only storage
	7.	Game NPC memory
	8.	Educational AI tutors

⸻

### 🔐 Private / Advanced Features

### SCMP core is fully functional, but additional modules exist privately. These include:
	•	Decentralized P2P sync
	•	Advanced encrypted storage and policy-based access
	•	Dynamic private data marketplace
	•	Additional memory and computation layers

Private modules are available for strategic collaborations or barter arrangements. Contact directly for access.

⸻

### 🤝 Contributing

Contributions welcome. See CONTRIBUTING.md￼.

⸻

📄 License

MIT License - see LICENSE￼

⸻

# Built for the local-first, privacy-conscious AI community
