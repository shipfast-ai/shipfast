/**
 * Single-File Component extractor.
 * Handles: .vue .svelte .astro
 *
 * Extracts the <script> block (or Astro frontmatter), delegates symbol
 * extraction to javascript.cjs, then shifts line_start/line_end so the
 * recorded positions match the original SFC file.
 *
 * Template content is ignored — regex-parsing HTML is fragile and template
 * expressions are mostly dataflow within the component's script.
 */

'use strict';

const js = require('./javascript.cjs');

const EXTENSIONS = ['.vue', '.svelte', '.astro'];

function extractScriptBlock(content, ext) {
  if (ext === '.astro') {
    // Astro frontmatter is between top-level --- ... ---
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const startLine = 2;  // first line after initial ---
    return { code: m[1], startLine };
  }
  // Vue and Svelte: <script> ... </script>, possibly with attributes
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/i;
  const m = content.match(re);
  if (!m) return null;
  const startIdx = m.index + m[0].indexOf(m[1]);
  const startLine = content.slice(0, startIdx).split('\n').length;
  return { code: m[1], startLine };
}

function extract(content, filePath, ctx) {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const block = extractScriptBlock(content, ext);
  if (!block) return { nodes: [], edges: [] };

  const inner = js.extract(block.code, filePath, ctx);
  const offset = block.startLine - 1;  // js extractor reports 1-based within the block
  const nodes = inner.nodes.map(n => ({
    ...n,
    line_start: n.line_start + offset,
    line_end: n.line_end + offset,
  }));
  return { nodes, edges: inner.edges };
}

function resolveImport(fromFile, importPath, ctx) {
  return js.resolveImport(fromFile, importPath, ctx);
}

function loadConfig(cwd) {
  return js.loadConfig(cwd);
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, loadConfig };
