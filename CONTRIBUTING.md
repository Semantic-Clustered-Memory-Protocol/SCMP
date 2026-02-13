# Contributing to SCMP

Thank you for your interest in contributing to SCMP! We welcome contributions from the community.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Ollama (for embeddings generation)

### Setup

1. Fork the repository
2. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/scmp-core.git
cd scmp-core
```

3. Install dependencies:
```bash
npm install
```

4. Create a branch:
```bash
git checkout -b feature/your-feature-name
```

## 🎯 How to Contribute

### Reporting Bugs

- Use the GitHub issue tracker
- Include:
  - Browser version
  - Node.js version (if applicable)
  - Steps to reproduce
  - Expected vs actual behavior
  - Error messages/stack traces

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case
- Explain why this feature would be valuable
- Provide examples if possible

### Code Contributions

#### Areas We Need Help
- [ ] More examples (React, Vue, Svelte integrations)
- [ ] Performance optimizations
- [ ] Test coverage
- [ ] Documentation improvements
- [ ] Bug fixes
- [ ] New compression algorithms
- [ ] Multi-device sync features

#### Coding Standards

1. **Use ES Modules** - Pure modern JavaScript
2. **No External Dependencies** - Keep the core dependency-free (except edgevec)
3. **Comment Complex Logic** - Help others understand
4. **Follow Existing Patterns** - Consistency matters
5. **Add Tests** - For new features

#### Example Code Style

```javascript
/**
 * Brief description of function
 * 
 * @param {string} text - The text to process
 * @param {Object} options - Configuration options
 * @returns {Promise<Array>} - Results array
 */
async function example(text, options = {}) {
  // Validate inputs
  if (!text) throw new Error('Text is required');
  
  // Implementation
  const results = await processText(text);
  
  return results;
}
```

## 🧪 Testing

Run tests:
```bash
npm test
```

Add tests for new features in the `tests/` directory.

## 📝 Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for new APIs
- Update examples if behavior changes

## 🔄 Pull Request Process

1. Update the README.md with details of changes if needed
2. Update the version number in package.json following [SemVer](https://semver.org/)
3. Ensure all tests pass
4. Request review from maintainers

### PR Title Format
```
type(scope): Brief description

Examples:
feat(search): Add metadata filtering
fix(storage): Resolve IndexedDB corruption
docs(readme): Update installation instructions
perf(hnsw): Optimize neighbor search
```

### PR Description Template
```markdown
## What does this PR do?
Brief description

## Why is this needed?
Explain the motivation

## How was this tested?
Testing approach

## Related Issues
Fixes #123
```

## 🎨 Project Structure

```
scmp-core/
├── src/
│   └── scmp.js          # Main implementation
├── examples/
│   ├── basic-usage.js   # Simple example
│   ├── rag-app.js       # RAG example
│   └── chatbot.js       # Chatbot example
├── tests/
│   └── scmp.test.js     # Test suite
├── docs/
│   ├── API.md           # API documentation
│   └── ARCHITECTURE.md  # Technical details
└── types/
    └── index.d.ts       # TypeScript definitions
```

## ❓ Questions?

- Open a discussion on GitHub
- Join our Discord server
- Tag @maintainers in issues

## 📜 Code of Conduct

### Our Pledge
We are committed to providing a welcoming and inclusive environment for all contributors.

### Expected Behavior
- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

### Unacceptable Behavior
- Harassment or discriminatory language
- Trolling or insulting comments
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

## 🏆 Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Credited in release notes
- Mentioned in project documentation

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for making SCMP better! 🚀**
