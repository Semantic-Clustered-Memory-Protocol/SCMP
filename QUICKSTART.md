# Quick Setup Guide

Get SCMP running in 5 minutes!

## Prerequisites

1. **Node.js 18+** - [Download here](https://nodejs.org/)
2. **Ollama** - [Download here](https://ollama.ai/download)

## Step 1: Install Ollama

### macOS/Linux
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Windows
Download installer from https://ollama.ai/download

## Step 2: Pull Embedding Model

```bash
ollama pull nomic-embed-text
```

This downloads a 274MB model for generating embeddings.

## Step 3: Install SCMP

### Option A: npm
```bash
npm install @scmp/core edgevec
```

### Option B: Clone from GitHub
```bash
git clone https://github.com/yourusername/scmp-core.git
cd scmp-core
npm install
```

## Step 4: Your First SCMP App

Create `index.js`:

```javascript
import { SCMP } from '@scmp/core';

async function main() {
  // Initialize
  const scmp = new SCMP({
    ollamaUrl: 'http://localhost:11434',
    model: 'nomic-embed-text'
  });
  
  await scmp.init();
  console.log('✅ SCMP ready!');
  
  // Add some memories
  await scmp.remember("The sky is blue");
  await scmp.remember("Grass is green");
  await scmp.remember("Oceans are vast and deep");
  
  // Search
  const results = await scmp.recall("What color is the sky?");
  console.log('Top result:', results[0].text);
  // Output: "The sky is blue"
  
  await scmp.shutdown();
}

main();
```

Run it:
```bash
node index.js
```

## Step 5: Verify It Works

You should see:
```
✅ SCMP ready!
Top result: The sky is blue
```

## Next Steps

### Run Examples
```bash
npm run example:basic
npm run example:rag
```

### Read Documentation
- [API Reference](./docs/API.md)
- [Architecture](./docs/ARCHITECTURE.md)

### Build Something Cool
- Personal AI assistant
- Document Q&A system
- Semantic note-taking app
- Chatbot with memory

## Troubleshooting

### "Cannot connect to Ollama"
- Make sure Ollama is running: `ollama serve`
- Check it's accessible: `curl http://localhost:11434`

### "Model not found"
- Pull the model: `ollama pull nomic-embed-text`
- List available models: `ollama list`

### "Out of memory"
- Reduce `hotCapacity` in config
- Use smaller embedding model (384-dim instead of 768)
- Enable aggressive pruning

### "IndexedDB errors"
- Check browser compatibility (Chrome 90+, Firefox 88+)
- Clear browser storage
- Try incognito mode

## Configuration Tips

### For Development (Fast)
```javascript
new SCMP({
  hotCapacity: 1000,     // Small cache
  embedDim: 384,         // Smaller embeddings
  model: 'all-minilm'    // Faster model
})
```

### For Production (Accurate)
```javascript
new SCMP({
  hotCapacity: 50000,    // Large cache
  embedDim: 768,         // Full embeddings
  model: 'nomic-embed-text'
})
```

### For Memory-Constrained
```javascript
new SCMP({
  hotCapacity: 5000,
  warmCapacity: 20000,
  coldCapacity: 100000,
  autoSaveInterval: 60000  // Save more frequently
})
```

## Getting Help

- 📖 [Documentation](./docs/)
- 💬 [GitHub Discussions](https://github.com/yourusername/scmp-core/discussions)
- 🐛 [Issue Tracker](https://github.com/yourusername/scmp-core/issues)
- 💬 [Discord](https://discord.gg/scmp)

## What's Next?

Once you're comfortable with the basics:

1. **Build a RAG app** - Use SCMP for context retrieval
2. **Add persistence** - Your memories survive browser restarts
3. **Implement clustering** - Group related memories
4. **Try compression** - Reduce storage with quantization
5. **Monitor performance** - Use `getStats()` to optimize

Happy building! 🚀
