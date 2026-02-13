/**
 * Basic SCMP Usage Example
 * 
 * This example demonstrates:
 * - Initializing SCMP
 * - Adding memories
 * - Searching with semantic similarity
 * - Retrieving statistics
 */

import { SCMP } from '../src/scmp.js';

async function main() {
  console.log('🚀 Initializing SCMP...\n');
  
  const scmp = new SCMP({
    ollamaUrl: 'http://localhost:11434',
    model: 'nomic-embed-text',
    embedDim: 768
  });
  
  await scmp.init();
  console.log('✅ SCMP initialized!\n');
  
  // Add some sample memories
  console.log('📝 Adding memories...\n');
  
  const facts = [
    "Paris is the capital of France and its largest city.",
    "The Eiffel Tower was built in 1889 for the World's Fair.",
    "The Louvre Museum is the world's largest art museum.",
    "France is known for its wine, cheese, and cuisine.",
    "The Seine River flows through Paris."
  ];
  
  for (const fact of facts) {
    await scmp.remember(fact, {
      type: 'fact',
      category: 'geography',
      source: 'example',
      timestamp: Date.now()
    });
    console.log(`  ✓ Added: ${fact.substring(0, 50)}...`);
  }
  
  console.log('\n🔍 Searching for relevant memories...\n');
  
  // Semantic search
  const queries = [
    "What is the capital of France?",
    "Tell me about famous landmarks",
    "What river is in Paris?"
  ];
  
  for (const query of queries) {
    console.log(`Query: "${query}"`);
    
    const results = await scmp.recall(query, {
      limit: 2,
      threshold: 0.5
    });
    
    results.forEach((result, i) => {
      console.log(`  ${i + 1}. [${(result.similarity * 100).toFixed(1)}%] ${result.text}`);
    });
    console.log();
  }
  
  // Get statistics
  console.log('📊 SCMP Statistics:\n');
  const stats = await scmp.getStats();
  console.log(`  Total memories: ${stats.total}`);
  console.log(`  HOT tier: ${stats.hot}`);
  console.log(`  WARM tier: ${stats.warm}`);
  console.log(`  COLD tier: ${stats.cold}`);
  console.log(`  Memory usage: ${(stats.memory.estimatedBytes / 1024 / 1024).toFixed(2)} MB`);
  
  console.log('\n✨ Example complete!');
  
  await scmp.shutdown();
}

main().catch(console.error);
