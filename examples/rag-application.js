/**
 * RAG (Retrieval-Augmented Generation) Example
 * 
 * This example demonstrates:
 * - Building a knowledge base from documents
 * - Retrieving relevant context for queries
 * - Generating responses using context
 */

import { SCMP } from '../src/scmp.js';

// Sample documentation to index
const documents = [
  {
    text: "SCMP is a browser-native vector database that enables semantic search and memory management entirely in the client browser.",
    category: "overview"
  },
  {
    text: "SCMP uses HNSW (Hierarchical Navigable Small World) indexing for fast approximate nearest neighbor search with sub-millisecond query times.",
    category: "performance"
  },
  {
    text: "The multi-tier storage architecture consists of HOT (in-memory), WARM (IndexedDB), and COLD (compressed) tiers for intelligent memory management.",
    category: "architecture"
  },
  {
    text: "Vector quantization in SCMP supports both int8 (8x compression) and float16 (2x compression) to reduce storage requirements while maintaining accuracy.",
    category: "compression"
  },
  {
    text: "SCMP integrates with Ollama for local embeddings generation, ensuring data privacy by keeping all processing on the user's device.",
    category: "privacy"
  },
  {
    text: "Automatic memory pressure monitoring prevents browser crashes by cleaning up low-priority data when storage limits are approached.",
    category: "memory"
  },
  {
    text: "SCMP supports semantic clustering to group related memories and episodic/semantic memory separation for different retention strategies.",
    category: "features"
  },
  {
    text: "The journal-based crash recovery system ensures data integrity even if the browser crashes during write operations.",
    category: "reliability"
  }
];

async function indexDocuments(scmp) {
  console.log('📚 Indexing documents...\n');
  
  for (const doc of documents) {
    await scmp.remember(doc.text, {
      type: 'documentation',
      category: doc.category,
      indexed_at: Date.now()
    });
    console.log(`  ✓ Indexed: ${doc.category}`);
  }
  
  console.log('\n✅ All documents indexed!\n');
}

async function answerQuestion(scmp, question) {
  console.log(`\n❓ Question: "${question}"\n`);
  
  // Retrieve relevant context
  const context = await scmp.recall(question, {
    limit: 3,
    threshold: 0.6
  });
  
  console.log('📖 Retrieved Context:\n');
  context.forEach((item, i) => {
    console.log(`  ${i + 1}. [${(item.similarity * 100).toFixed(1)}%] ${item.text}`);
  });
  
  // Build prompt with context
  const prompt = buildPrompt(question, context);
  
  console.log('\n📝 Generated Prompt:\n');
  console.log(prompt);
  console.log('\n' + '─'.repeat(80));
  
  return context;
}

function buildPrompt(question, context) {
  const contextText = context.map(c => c.text).join('\n\n');
  
  return `You are a helpful assistant answering questions about SCMP.

Context from documentation:
${contextText}

Question: ${question}

Answer: Based on the context above, `;
}

async function main() {
  console.log('🚀 RAG Example - Building a Q&A system with SCMP\n');
  
  // Initialize SCMP
  const scmp = new SCMP({
    ollamaUrl: 'http://localhost:11434',
    model: 'nomic-embed-text'
  });
  
  await scmp.init();
  console.log('✅ SCMP initialized!\n');
  
  // Index documents
  await indexDocuments(scmp);
  
  // Answer questions
  const questions = [
    "How does SCMP handle memory?",
    "What indexing algorithm does SCMP use?",
    "How does SCMP ensure privacy?",
    "What compression methods are available?"
  ];
  
  for (const question of questions) {
    await answerQuestion(scmp, question);
  }
  
  // Statistics
  console.log('\n\n📊 Knowledge Base Statistics:\n');
  const stats = await scmp.getStats();
  console.log(`  Total documents: ${stats.total}`);
  console.log(`  Storage tiers: HOT=${stats.hot}, WARM=${stats.warm}, COLD=${stats.cold}`);
  
  console.log('\n✨ RAG example complete!');
  console.log('\n💡 Next steps:');
  console.log('  1. Connect this to an LLM (Ollama, OpenAI, etc.)');
  console.log('  2. Stream responses to users');
  console.log('  3. Add more documents to your knowledge base');
  console.log('  4. Implement follow-up question handling');
  
  await scmp.shutdown();
}

main().catch(console.error);
