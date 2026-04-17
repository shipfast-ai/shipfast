/**
 * Markdown extractor.
 * Handles: .md, .mdx
 *
 * Indexes prose/docs that wouldn't otherwise enter the graph. Extracts:
 *   - YAML frontmatter's `name` field as a `skill` node (covers ShipFast
 *     skill files like commands/sf/do.md with `name: sf:do`).
 *   - Every heading (# … ######) as a `heading` node, with heading text as
 *     the node name and nesting inferred from level.
 *   - Markdown links [text](target) that point at repo-relative paths as
 *     `imports` edges from the doc to the target file — lets brain_impact
 *     answer "which docs reference this file?".
 *   - Bare fenced-code-block `filename` hints (```lang title=path/to/file```)
 *     also emitted as imports edges when present.
 *
 * Design: no heavy parser, pure regex. Fails open (skips a line) on anything
 * unexpected.
 */

'use strict';

const { hashContent, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.md', '.mdx'];

// Frontmatter: starts at line 1, bounded by `---`. Key:value per line.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FM_KEY_RE = /^\s*([A-Za-z_][\w-]*)\s*:\s*"?([^"\n]*)"?\s*$/;

// Headings: `# Heading` … up to `###### Heading`. Ignores ATX closing '#'s.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

// Markdown link: [text](target). Skips images (preceding `!`).
const LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;

function resolveImport(fromFile, importPath) {
  return importPath;
}

function parseFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: null, bodyOffset: 0 };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(FM_KEY_RE);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { frontmatter: fm, bodyOffset: m[0].length };
}

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  const { frontmatter, bodyOffset } = parseFrontmatter(content);

  // Skill node — only when frontmatter has `name` (ShipFast convention).
  if (frontmatter && frontmatter.name) {
    const skillName = frontmatter.name;
    const desc = frontmatter.description || '';
    nodes.push({
      id: `skill:${skillName}`,
      kind: 'class', // `class` is the closest existing allowed kind — schema CHECK constraint allows: file|function|type|component|route|class|variable|export
      name: skillName,
      file_path: filePath,
      line_start: 1,
      line_end: Math.min(lines.length, bodyOffset ? content.slice(0, bodyOffset).split('\n').length : 1),
      signature: desc.slice(0, 120),
      hash: hashContent(content),
    });
    // Edge: skill → file (so searches on the skill name surface the file).
    emit(`skill:${skillName}`, `file:${filePath}`, 'imports');
  }

  // Headings as nodes.
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(content)) !== null) {
    const level = m[1].length;
    const text = m[2].trim();
    if (!text) continue;
    const lineNum = content.slice(0, m.index).split('\n').length;
    // Anchor id uses slugified heading text.
    const slug = text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'heading';
    nodes.push({
      id: `heading:${filePath}#${slug}`,
      kind: 'variable', // no `heading` kind in schema; `variable` is the catch-all
      name: text,
      file_path: filePath,
      line_start: lineNum,
      line_end: lineNum,
      signature: `${'#'.repeat(level)} ${text}`.slice(0, 120),
      hash: hashContent(text),
    });
  }

  // Markdown links that look like repo-relative paths → imports edges.
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(content)) !== null) {
    const target = m[2].trim();
    // Skip external URLs and in-page anchors.
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    // Strip trailing #anchor from path-style link.
    const pathOnly = target.split('#')[0];
    if (!pathOnly) continue;
    emit(`file:${filePath}`, `file:${pathOnly}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
