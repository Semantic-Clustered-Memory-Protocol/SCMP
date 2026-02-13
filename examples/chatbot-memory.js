/**
 * Chatbot with Episodic Memory Example
 * 
 * This example demonstrates:
 * - Building a chatbot that remembers conversations
 * - Using episodic memory for recent context
 * - Using semantic memory for long-term facts
 * - Retrieving relevant past conversations
 */

import { SCMP } from '../src/scmp.js';

class MemoryChatbot {
  constructor(scmp) {
    this.scmp = scmp;
    this.conversationId = Date.now();
  }
  
  async storeMessage(role, content, metadata = {}) {
    const memoryType = metadata.isFactual ? 'semantic' : 'episodic';
    
    await this.scmp.remember(content, {
      type: memoryType,
      role,
      conversationId: this.conversationId,
      timestamp: Date.now(),
      ...metadata
    });
  }
  
  async getRelevantContext(userMessage, options = {}) {
    const limit = options.limit || 5;
    const includeEpisodic = options.includeEpisodic !== false;
    const includeSemantic = options.includeSemantic !== false;
    
    // Retrieve relevant memories
    const memories = await this.scmp.recall(userMessage, {
      limit: limit * 2, // Get more to filter
      threshold: 0.5
    });
    
    // Filter by type
    const filtered = memories.filter(m => {
      if (m.metadata.type === 'episodic' && !includeEpisodic) return false;
      if (m.metadata.type === 'semantic' && !includeSemantic) return false;
      return true;
    });
    
    // Prioritize recent episodic memories
    const sorted = filtered.sort((a, b) => {
      // Episodic memories from current conversation get priority
      if (a.metadata.type === 'episodic' && b.metadata.type !== 'episodic') return -1;
      if (b.metadata.type === 'episodic' && a.metadata.type !== 'episodic') return 1;
      
      // Then by similarity
      return b.similarity - a.similarity;
    });
    
    return sorted.slice(0, limit);
  }
  
  async chat(userMessage) {
    console.log(`\n👤 User: ${userMessage}`);
    
    // Store user message
    await this.storeMessage('user', userMessage);
    
    // Get relevant context
    const context = await this.getRelevantContext(userMessage);
    
    if (context.length > 0) {
      console.log('\n🧠 Relevant Memories:');
      context.forEach((mem, i) => {
        const emoji = mem.metadata.type === 'episodic' ? '💬' : '📚';
        const role = mem.metadata.role || 'unknown';
        console.log(`  ${i + 1}. ${emoji} [${role}] ${mem.text.substring(0, 60)}...`);
      });
    }
    
    // Generate response (simplified - in real app, use LLM)
    const response = this.generateResponse(userMessage, context);
    
    console.log(`\n🤖 Assistant: ${response}`);
    
    // Store assistant response
    await this.storeMessage('assistant', response);
    
    return response;
  }
  
  generateResponse(userMessage, context) {
    // Simplified response generation
    // In a real application, send this to your LLM
    
    const hasRelevantContext = context.length > 0;
    
    if (userMessage.toLowerCase().includes('remember')) {
      return "I remember our previous conversations and can recall relevant information when needed.";
    }
    
    if (userMessage.toLowerCase().includes('who are you')) {
      return "I'm an AI assistant powered by SCMP, which gives me the ability to remember our conversations and learn from them.";
    }
    
    if (hasRelevantContext) {
      return `Based on what we discussed earlier: ${context[0].text.substring(0, 100)}... [This is where I'd generate a contextual response using an LLM]`;
    }
    
    return "I understand. Tell me more!";
  }
  
  async learnFact(fact, category) {
    await this.scmp.remember(fact, {
      type: 'semantic',
      role: 'system',
      category,
      isFactual: true,
      learned_at: Date.now()
    });
    
    console.log(`\n✅ Learned: ${fact}`);
  }
  
  async getStats() {
    const stats = await this.scmp.getStats();
    const allRecords = await this.scmp.getAllRecords();
    
    const episodic = allRecords.filter(r => r.metadata?.type === 'episodic').length;
    const semantic = allRecords.filter(r => r.metadata?.type === 'semantic').length;
    
    return {
      total: stats.total,
      episodic,
      semantic,
      tiers: {
        hot: stats.hot,
        warm: stats.warm,
        cold: stats.cold
      }
    };
  }
}

async function main() {
  console.log('🤖 Chatbot with Episodic Memory Example\n');
  
  // Initialize SCMP
  const scmp = new SCMP({
    ollamaUrl: 'http://localhost:11434',
    model: 'nomic-embed-text'
  });
  
  await scmp.init();
  console.log('✅ SCMP initialized!\n');
  
  // Create chatbot
  const bot = new MemoryChatbot(scmp);
  
  // Teach the bot some facts (semantic memory)
  console.log('📚 Teaching facts to the bot...');
  await bot.learnFact("SCMP is a browser-native vector database", "technology");
  await bot.learnFact("Vector databases enable semantic search using embeddings", "concepts");
  await bot.learnFact("Episodic memory stores recent conversations while semantic memory stores facts", "memory-types");
  
  // Have a conversation (episodic memory)
  console.log('\n💬 Starting conversation...');
  console.log('═'.repeat(80));
  
  await bot.chat("Hi! What can you help me with?");
  
  await bot.chat("Tell me about vector databases");
  
  await bot.chat("How do you remember things?");
  
  await bot.chat("What did I ask you about earlier?");
  
  // Show statistics
  console.log('\n═'.repeat(80));
  console.log('\n📊 Bot Memory Statistics:\n');
  const stats = await bot.getStats();
  console.log(`  Total memories: ${stats.total}`);
  console.log(`  Episodic (conversations): ${stats.episodic}`);
  console.log(`  Semantic (facts): ${stats.semantic}`);
  console.log(`  Storage: HOT=${stats.tiers.hot}, WARM=${stats.tiers.warm}, COLD=${stats.tiers.cold}`);
  
  console.log('\n✨ Chatbot example complete!');
  console.log('\n💡 Next steps:');
  console.log('  1. Integrate with Ollama or OpenAI for response generation');
  console.log('  2. Add conversation summarization');
  console.log('  3. Implement memory consolidation (episodic → semantic)');
  console.log('  4. Add user preferences and personalization');
  
  await scmp.shutdown();
}

main().catch(console.error);
