# Language Extractors

Each file in this directory is a regex-based symbol extractor for one language.

## Accuracy

Extractors are **approximations**, not parsers. Real-world recall is typically 80–90%. They will miss:

- Macro-generated symbols
- Heavy metaprogramming (runtime-defined methods, dynamic class creation)
- Syntax edge cases inside unusual string literals or raw-string delimiters
- Conditional-compilation regions (`#ifdef 0`)

An imperfect extractor still beats file-node-only indexing. The brain is a navigation aid for AI agents, not a compiler.

## Interface

```js
module.exports = {
  extensions: ['.ts', '.tsx'],
  extract(content, filePath, ctx) { return { nodes, edges }; },
  resolveImport(fromFile, importPath, ctx) { return resolvedRelPath; },
  loadConfig(cwd) { /* optional, e.g. read tsconfig */ },
};
```

`ctx` provides:
- `cwd` — project root
- `aliases` — language-specific config (e.g. tsconfig path aliases)

Node shape: `{ id, kind, name, file_path, line_start, line_end, signature, hash }`
Edge shape: `{ source, target, kind }`

## Adding a language

1. Create `brain/extractors/<lang>.cjs` exporting the interface above
2. Add it to `EXTRACTOR_FILES` in `brain/extractors/index.cjs`
3. Add the file extension(s) to `INDEXABLE` in `brain/indexer.cjs`
4. Write a smoke test in `tests/test-core.test.cjs`

No other edits required.
