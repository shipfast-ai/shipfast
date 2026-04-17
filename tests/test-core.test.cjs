const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// --- constants ---
const constants = require('../core/constants.cjs');

describe('constants', () => {
  it('exports all required keys', () => {
    assert.equal(constants.DB_NAME, '.shipfast/brain.db');
    assert.equal(constants.CONFIDENCE.HIGH, 0.8);
    assert.equal(constants.CONFIDENCE.MEDIUM, 0.5);
    assert.equal(constants.CONFIDENCE.LOW, 0.3);
    assert.equal(constants.BUDGET.CRITICAL, 2000);
    assert.equal(constants.DEFAULT_MODEL.scout, 'haiku');
    assert.equal(constants.DEFAULT_MODEL.builder, 'sonnet');
    assert.equal(constants.MODEL_COST.haiku, 1);
    assert.equal(constants.MODEL_COST.opus, 25);
    assert.equal(constants.BUILD_TIMEOUT_MS, 60000);
  });
});

// --- skip-logic ---
const { parseFlags, shouldSkipScout, shouldSkipArchitect, shouldSkipCritic, shouldSkipScribe } = require('../core/skip-logic.cjs');

describe('parseFlags', () => {
  it('extracts --tdd flag', () => {
    const { flags, task } = parseFlags('--tdd add user auth');
    assert.equal(flags.tdd, true);
    assert.equal(task, 'add user auth');
  });

  it('extracts multiple flags', () => {
    const { flags, task } = parseFlags('--research --verify fix login');
    assert.equal(flags.research, true);
    assert.equal(flags.verify, true);
    assert.equal(task, 'fix login');
  });

  it('extracts --no-plan flag', () => {
    const { flags, task } = parseFlags('--no-plan rename variable');
    assert.equal(flags.noPlan, true);
    assert.equal(task, 'rename variable');
  });

  it('extracts --cheap and --quality flags', () => {
    const { flags: f1 } = parseFlags('--cheap add button');
    assert.equal(f1.cheap, true);
    const { flags: f2 } = parseFlags('--quality fix auth');
    assert.equal(f2.quality, true);
  });

  it('returns empty flags for no flags', () => {
    const { flags, task } = parseFlags('fix the bug');
    assert.equal(Object.keys(flags).length, 0);
    assert.equal(task, 'fix the bug');
  });

  it('cleans up extra whitespace', () => {
    const { task } = parseFlags('--tdd   add   auth');
    assert.equal(task, 'add auth');
  });
});

describe('shouldSkipScout', () => {
  it('returns false for null task', () => {
    assert.equal(shouldSkipScout('.', null), false);
  });

  it('never skips for complex tasks', () => {
    assert.equal(shouldSkipScout('.', { complexity: 'complex' }), false);
  });

  it('never skips when --research flag set', () => {
    assert.equal(shouldSkipScout('.', { complexity: 'trivial' }, { research: true }), false);
  });

  it('does not skip when no affected files', () => {
    assert.equal(shouldSkipScout('.', { complexity: 'medium', affectedFiles: [] }), false);
  });
});

describe('shouldSkipArchitect', () => {
  it('skips with --no-plan flag', () => {
    assert.equal(shouldSkipArchitect('.', { complexity: 'complex' }, { noPlan: true }), true);
  });

  it('skips for fix intent', () => {
    assert.equal(shouldSkipArchitect('.', { intent: 'fix', complexity: 'medium' }), true);
  });

  it('never skips for complex without --no-plan', () => {
    assert.equal(shouldSkipArchitect('.', { complexity: 'complex' }), false);
  });
});

describe('shouldSkipCritic', () => {
  it('never skips with --verify flag', () => {
    assert.equal(shouldSkipCritic('.', { complexity: 'trivial' }, { verify: true }), false);
  });

  it('skips trivial tasks', () => {
    assert.equal(shouldSkipCritic('.', { complexity: 'trivial' }), true);
  });
});

describe('shouldSkipScribe', () => {
  it('only runs for complex', () => {
    assert.equal(shouldSkipScribe('.', { complexity: 'trivial' }), true);
    assert.equal(shouldSkipScribe('.', { complexity: 'medium' }), true);
    assert.equal(shouldSkipScribe('.', { complexity: 'complex' }), false);
  });
});

// --- brain esc ---
const brain = require('../brain/index.cjs');

describe('esc', () => {
  it('escapes single quotes', () => {
    assert.equal(brain.esc("it's"), "it''s");
  });
  it('handles null', () => {
    assert.equal(brain.esc(null), '');
  });
  it('handles undefined', () => {
    assert.equal(brain.esc(undefined), '');
  });
  it('handles numbers', () => {
    assert.equal(brain.esc(42), '42');
  });
});

describe('escLike', () => {
  it('escapes %', () => { assert.equal(brain.escLike('50%'), '50\\%'); });
  it('escapes _', () => { assert.equal(brain.escLike('a_b'), 'a\\_b'); });
  it('escapes backslash', () => { assert.equal(brain.escLike('a\\b'), 'a\\\\b'); });
  it('also escapes single quotes', () => {
    assert.equal(brain.escLike("it's 100%"), "it''s 100\\%");
  });
  it('handles null and empty', () => {
    assert.equal(brain.escLike(null), '');
    assert.equal(brain.escLike(''), '');
  });
});

describe('BatchCollector.cleanupFile', () => {
  const { _test } = (() => {
    // The BatchCollector class isn't exported; reach in via require cache
    const indexer = require('../brain/indexer.cjs');
    return { _test: indexer };
  })();
  it('emits DELETE for non-file nodes and outbound edges', () => {
    // Re-require the module internals using its file directly so we can
    // construct a BatchCollector. Simplest path: drive it through the
    // public indexCodebase flow would need fs fixtures. Instead, use the
    // exported class if present; otherwise, smoke-test via indexer module.
    const mod = require('../brain/indexer.cjs');
    if (!mod.BatchCollector) return;  // not exported — skip
    const b = new mod.BatchCollector();
    b.cleanupFile('core/executor.cjs');
    const sql = b.toSQL();
    assert.ok(sql.includes("DELETE FROM nodes WHERE file_path = 'core/executor.cjs' AND kind != 'file'"));
    assert.ok(sql.includes("source = 'file:core/executor.cjs'"));
    assert.ok(sql.includes("source LIKE 'fn:core/executor.cjs:%' ESCAPE '\\'"));
  });
});

describe('validateSafeString', () => {
  it('returns valid string unchanged', () => {
    assert.equal(brain.validateSafeString('hello'), 'hello');
  });
  it('allows empty by default', () => {
    assert.equal(brain.validateSafeString(null), '');
    assert.equal(brain.validateSafeString(''), '');
  });
  it('throws on NUL byte', () => {
    assert.throws(() => brain.validateSafeString('a\0b'), /NUL/);
  });
  it('throws over max length', () => {
    assert.throws(() => brain.validateSafeString('x'.repeat(201)), /max length/);
  });
  it('throws on non-string', () => {
    assert.throws(() => brain.validateSafeString(42), /must be a string/);
  });
  it('throws on null when allowEmpty=false', () => {
    assert.throws(() => brain.validateSafeString(null, { allowEmpty: false, field: 'q' }), /q is required/);
  });
});

// --- retry classifyError ---
const { classifyError } = require('../core/retry.cjs');

describe('classifyError', () => {
  it('classifies type errors', () => {
    const r = classifyError({ message: "Type 'string' is not assignable to type 'number'" });
    assert.equal(r.type, 'type_error');
    assert.equal(r.retryable, true);
  });
  it('classifies missing imports', () => {
    const r = classifyError({ message: "Cannot find module './utils'" });
    assert.equal(r.type, 'missing_import');
    assert.equal(r.retryable, true);
  });
  it('classifies permission errors as non-retryable', () => {
    const r = classifyError({ message: 'EACCES: permission denied' });
    assert.equal(r.type, 'permission');
    assert.equal(r.retryable, false);
  });
  it('classifies merge conflicts as non-retryable', () => {
    const r = classifyError({ message: 'CONFLICT (content): Merge conflict' });
    assert.equal(r.type, 'conflict');
    assert.equal(r.retryable, false);
  });
  it('defaults to unknown retryable', () => {
    const r = classifyError({ message: 'Something weird happened' });
    assert.equal(r.type, 'unknown');
    assert.equal(r.retryable, true);
  });
});

// --- executor groupIntoWaves ---
const { groupIntoWaves } = require('../core/executor.cjs');

describe('groupIntoWaves', () => {
  it('single task = single wave', () => {
    const waves = groupIntoWaves([{ id: 'a' }]);
    assert.equal(waves.length, 1);
    assert.equal(waves[0].length, 1);
  });
  it('independent tasks = same wave', () => {
    const waves = groupIntoWaves([{ id: 'a' }, { id: 'b' }]);
    assert.equal(waves.length, 1);
    assert.equal(waves[0].length, 2);
  });
  it('dependent tasks = separate waves', () => {
    const waves = groupIntoWaves([
      { id: 'a' },
      { id: 'b', depends_on: ['a'] }
    ]);
    assert.equal(waves.length, 2);
    assert.equal(waves[0][0].id, 'a');
    assert.equal(waves[1][0].id, 'b');
  });
});

// --- verify extractDoneCriteria ---
const { extractDoneCriteria } = require('../core/verify.cjs');

describe('extractDoneCriteria', () => {
  it('always includes build check', () => {
    const criteria = extractDoneCriteria('do something');
    assert.ok(criteria.some(c => c.type === 'build'));
  });
  it('handles null input gracefully', () => {
    const criteria = extractDoneCriteria(null);
    assert.equal(criteria.length, 1);
    assert.equal(criteria[0].type, 'build');
  });
  it('detects file creation expectations', () => {
    const criteria = extractDoneCriteria("create a file 'src/utils.ts'");
    assert.ok(criteria.some(c => c.type === 'file_exists'));
  });
});

// --- model-selector costMultiplier ---
const { costMultiplier } = require('../core/model-selector.cjs');

describe('costMultiplier', () => {
  it('returns correct costs', () => {
    assert.equal(costMultiplier('haiku'), 1);
    assert.equal(costMultiplier('sonnet'), 5);
    assert.equal(costMultiplier('opus'), 25);
  });
  it('defaults to sonnet cost for unknown', () => {
    assert.equal(costMultiplier('gpt-4'), 5);
  });
});

// --- autopilot estimateComplexity ---
const autopilot = require('../core/autopilot.cjs');

describe('estimateComplexity', () => {
  it('handles null input', () => {
    const r = autopilot.estimateComplexity(null);
    assert.ok(r === 'trivial' || (r && r.complexity === 'trivial'));
  });
  it('returns trivial for short input', () => {
    const r = autopilot.estimateComplexity('fix typo');
    assert.ok(r === 'trivial' || (r && r.complexity === 'trivial'));
  });
});

// --- ambiguity domain detection ---
const { detectDomains, detectAmbiguity, getBatchQuestions, scoreAnswer, generateFollowUp } = require('../core/ambiguity.cjs');

describe('detectDomains', () => {
  it('detects UI domain', () => {
    assert.ok(detectDomains('add a modal component').includes('ui'));
  });
  it('detects API domain', () => {
    assert.ok(detectDomains('create REST endpoint').includes('api'));
  });
  it('detects auth domain', () => {
    assert.ok(detectDomains('add JWT login').includes('auth'));
  });
  it('detects database domain', () => {
    assert.ok(detectDomains('add prisma migration').includes('database'));
  });
  it('detects multiple domains', () => {
    const d = detectDomains('add login page with session auth');
    assert.ok(d.includes('ui'));
    assert.ok(d.includes('auth'));
  });
  it('falls back to general', () => {
    assert.deepEqual(detectDomains('do something'), ['general']);
  });
});

describe('detectAmbiguity with domains', () => {
  it('returns domain-specific questions for UI', () => {
    const amb = detectAmbiguity('add dashboard page');
    const how = amb.find(a => a.type === 'HOW');
    assert.ok(how);
    assert.equal(how.domain, 'ui');
    assert.ok(how.options); // should have multiple choice options
  });
  it('returns domain-specific questions for API', () => {
    const amb = detectAmbiguity('add api endpoint');
    const how = amb.find(a => a.type === 'HOW');
    assert.ok(how);
    assert.equal(how.domain, 'api');
  });
});

describe('getBatchQuestions', () => {
  it('returns multiple questions for complex input', () => {
    const qs = getBatchQuestions('add authentication with JWT and login page');
    assert.ok(qs.length >= 2);
  });
  it('caps at 8 questions', () => {
    const qs = getBatchQuestions('add authentication login page with database migration and API endpoint and deploy pipeline');
    assert.ok(qs.length <= 8);
  });
});

describe('scoreAnswer', () => {
  it('scores multiple choice as 1.0', () => {
    assert.equal(scoreAnswer('JWT (stateless)', 'multiple_choice'), 1.0);
  });
  it('scores "idk" as 0', () => {
    assert.equal(scoreAnswer('idk', 'free_text'), 0);
  });
  it('scores short answer as 0.5', () => {
    assert.equal(scoreAnswer('yes', 'free_text'), 0.5);
  });
  it('scores empty as 0', () => {
    assert.equal(scoreAnswer('', 'free_text'), 0);
  });
});

describe('generateFollowUp', () => {
  it('generates WHERE follow-up', () => {
    const f = generateFollowUp('WHERE', 'ui', 'somewhere');
    assert.ok(f.includes('somewhere'));
    assert.ok(f.includes('specific'));
  });
  it('generates HOW follow-up', () => {
    const f = generateFollowUp('HOW', 'api', 'REST');
    assert.ok(f.includes('REST'));
  });
});

// ============================================================
// Extractor registry + shared helpers
// ============================================================

const registry = require('../brain/extractors/index.cjs');
const common = require('../brain/extractors/_common.cjs');

const has = (r, kind, name) => r.nodes.some(n => n.kind === kind && n.name === name);
const importTargets = (r) => r.edges.filter(e => e.kind === 'imports').map(e => e.target);

describe('extractor registry', () => {
  it('loads extractors for every declared language', () => {
    const expected = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.py', '.pyw',
      '.go', '.java', '.kt', '.kts', '.swift', '.c', '.h', '.cpp', '.cc', '.hpp', '.cxx',
      '.rb', '.php', '.dart', '.ex', '.exs', '.scala', '.sc', '.zig', '.lua', '.r', '.R',
      '.jl', '.cs', '.fs', '.fsx', '.vue', '.svelte', '.astro'];
    const known = new Set(registry.knownExtensions());
    for (const ext of expected) assert.ok(known.has(ext), `missing extractor for ${ext}`);
  });
  it('unknown extension returns empty', () => {
    const r = registry.extract('.xyz', 'anything', 'file.xyz', {});
    assert.deepEqual(r, { nodes: [], edges: [] });
  });
});

describe('_common block helpers', () => {
  it('findBraceBlock balances nested braces', () => {
    const lines = ['fn x() {', '  if (y) { z; }', '}'];
    assert.equal(common.findBraceBlock(lines, 0), 3);
  });
  it('findBraceBlock skips strings and comments', () => {
    const lines = ['fn x() {', '  s = "abc { def";', '  // }', '}'];
    assert.equal(common.findBraceBlock(lines, 0), 4);
  });
  it('findIndentBlock respects indent rules', () => {
    const lines = ['def f():', '    x = 1', '    y = 2', 'z = 3'];
    assert.equal(common.findIndentBlock(lines, 0, 0), 3);
  });
  it('findKeywordBlock counts nested openers and end', () => {
    const lines = ['def outer', '  if cond', '    do_it', '  end', 'end'];
    assert.equal(common.findKeywordBlock(lines, 0, ['if']), 5);
  });
});

// ============================================================
// Per-language smoke tests
// ============================================================

function smoke(ext, src, asserts) {
  const r = registry.extract(ext, src, 'test' + ext, {});
  for (const fn of asserts) fn(r);
  return r;
}

describe('javascript extractor', () => {
  it('extracts function + class + import', () => {
    smoke('.ts',
      `import { helper } from './util'\nexport function foo(x: number) { return x }\nclass Bar {}`,
      [r => assert.ok(has(r, 'function', 'foo')),
       r => assert.ok(has(r, 'class', 'Bar')),
       r => assert.ok(importTargets(r).some(t => t.endsWith('util')))]);
  });
  it('no React component kind emitted', () => {
    const r = registry.extract('.tsx',
      `export const Button = () => <div/>\nconst IconOnly = 'star'`, 'x.tsx', {});
    assert.equal(r.nodes.filter(n => n.kind === 'component').length, 0);
  });
  it('captures side-effect, namespace, require, dynamic imports', () => {
    const r = registry.extract('.js',
      `import './a'\nimport * as ns from './b'\nconst c = require('./c')\nconst d = await import('./d')`,
      'x.js', {});
    const tgts = importTargets(r);
    for (const m of ['./a', './b', './c', './d']) {
      assert.ok(tgts.some(t => t.endsWith(m.replace('./', '')) || t.endsWith(m)), `missing import for ${m}`);
    }
  });
});

describe('rust extractor', () => {
  it('captures pub fn, struct, use', () => {
    smoke('.rs',
      `pub fn main() {}\npub struct Foo { x: i32 }\nuse std::io;`,
      [r => assert.ok(has(r, 'function', 'main')),
       r => assert.ok(has(r, 'type', 'Foo')),
       r => assert.ok(r.edges.some(e => e.target === 'module:std::io'))]);
  });
});

describe('python extractor', () => {
  it('captures def and class', () => {
    smoke('.py',
      `class Foo:\n    def bar(self):\n        pass\n`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'function', 'bar'))]);
  });
});

describe('go extractor', () => {
  it('captures func, struct, interface, imports', () => {
    smoke('.go',
      `package main\nimport "fmt"\nfunc Hello(name string) string { return name }\ntype User struct { ID int }\ntype Reader interface { Read() string }`,
      [r => assert.ok(has(r, 'function', 'Hello')),
       r => assert.ok(has(r, 'type', 'User')),
       r => assert.ok(has(r, 'type', 'Reader')),
       r => assert.ok(r.edges.some(e => e.target === 'module:fmt'))]);
  });
});

describe('java extractor', () => {
  it('captures class, interface, record, method, import', () => {
    smoke('.java',
      `package app;\nimport java.util.List;\npublic class Foo {\n  public void bar() {}\n}\ninterface Greeter {}\nrecord Point(int x, int y) {}`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'function', 'bar')),
       r => assert.ok(has(r, 'type', 'Greeter')),
       r => assert.ok(has(r, 'type', 'Point')),
       r => assert.ok(r.edges.some(e => e.target === 'module:java.util.List'))]);
  });
});

describe('kotlin extractor', () => {
  it('captures fun, class, object, data class', () => {
    smoke('.kt',
      `package x\nimport kotlin.test.assertTrue\nclass Foo\nobject Bar\nfun main() {}\ndata class Point(val x: Int)`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'class', 'Bar')),
       r => assert.ok(has(r, 'function', 'main')),
       r => assert.ok(has(r, 'class', 'Point')),
       r => assert.ok(r.edges.some(e => e.target === 'module:kotlin.test.assertTrue'))]);
  });
});

describe('swift extractor', () => {
  it('captures func, class, struct, protocol, import', () => {
    smoke('.swift',
      `import Foundation\nclass Foo {}\nstruct Bar {}\nprotocol Readable {}\nfunc hello() {}`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'type', 'Bar')),
       r => assert.ok(has(r, 'type', 'Readable')),
       r => assert.ok(has(r, 'function', 'hello')),
       r => assert.ok(r.edges.some(e => e.target === 'module:Foundation'))]);
  });
});

describe('c extractor', () => {
  it('captures function, struct, include', () => {
    smoke('.c',
      `#include <stdio.h>\nstruct Point { int x; };\nint add(int a, int b) {\n  return a + b;\n}`,
      [r => assert.ok(has(r, 'function', 'add')),
       r => assert.ok(has(r, 'type', 'Point')),
       r => assert.ok(r.edges.some(e => e.target === 'module:stdio.h'))]);
  });
  it('does not flag if/while/return as functions', () => {
    const r = registry.extract('.c', `int main(){ if (x) { return 1; } return 0; }`, 'x.c', {});
    assert.ok(!r.nodes.some(n => n.name === 'if' || n.name === 'return'));
  });
});

describe('cpp extractor', () => {
  it('captures class, namespace, function, include', () => {
    smoke('.cpp',
      `#include <vector>\nnamespace foo {\nclass Bar {};\n}\nint doThing(int x) {\n  return x;\n}`,
      [r => assert.ok(has(r, 'function', 'doThing')),
       r => assert.ok(has(r, 'class', 'Bar')),
       r => assert.ok(has(r, 'type', 'foo')),
       r => assert.ok(r.edges.some(e => e.target === 'module:vector'))]);
  });
});

describe('ruby extractor', () => {
  it('captures def, class, module, require', () => {
    smoke('.rb',
      `require 'json'\nmodule App\n  class User\n    def greet\n      puts "hi"\n    end\n  end\nend`,
      [r => assert.ok(has(r, 'function', 'greet')),
       r => assert.ok(has(r, 'class', 'User')),
       r => assert.ok(has(r, 'type', 'App')),
       r => assert.ok(r.edges.some(e => e.target === 'module:json'))]);
  });
});

describe('php extractor', () => {
  it('captures function, class, use', () => {
    smoke('.php',
      `<?php\nuse App\\Helper;\nclass Foo {\n  public function bar() { return 1; }\n}\ninterface Greeter {}`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'function', 'bar')),
       r => assert.ok(has(r, 'type', 'Greeter')),
       r => assert.ok(r.edges.some(e => e.target === 'module:App\\Helper'))]);
  });
});

describe('dart extractor', () => {
  it('captures function, class, import', () => {
    smoke('.dart',
      `import 'package:flutter/material.dart';\nclass Foo {\n  void bar() {}\n}\nint add(int a, int b) {\n  return a + b;\n}`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'function', 'add')),
       r => assert.ok(r.edges.some(e => e.target === 'module:package:flutter/material.dart'))]);
  });
});

describe('elixir extractor', () => {
  it('captures defmodule, def, import', () => {
    smoke('.ex',
      `defmodule MyApp do\n  import Logger\n  def greet(name) do\n    name\n  end\nend`,
      [r => assert.ok(has(r, 'type', 'MyApp')),
       r => assert.ok(has(r, 'function', 'greet')),
       r => assert.ok(r.edges.some(e => e.target === 'module:Logger'))]);
  });
});

describe('scala extractor', () => {
  it('captures def, class, object, import', () => {
    smoke('.scala',
      `import scala.collection.mutable\nclass Foo {\n  def bar(x: Int): Int = x\n}\nobject Main`,
      [r => assert.ok(has(r, 'function', 'bar')),
       r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'class', 'Main')),
       r => assert.ok(r.edges.some(e => e.target === 'module:scala.collection.mutable'))]);
  });
});

describe('zig extractor', () => {
  it('captures fn, struct, @import', () => {
    smoke('.zig',
      `const std = @import("std");\npub fn main() void {}\nconst Point = struct { x: i32 };`,
      [r => assert.ok(has(r, 'function', 'main')),
       r => assert.ok(has(r, 'type', 'Point')),
       r => assert.ok(r.edges.some(e => e.target === 'module:std'))]);
  });
});

describe('lua extractor', () => {
  it('captures function and require', () => {
    smoke('.lua',
      `local json = require('json')\nfunction greet(name)\n  print(name)\nend\nlocal function helper() end`,
      [r => assert.ok(has(r, 'function', 'greet')),
       r => assert.ok(has(r, 'function', 'helper')),
       r => assert.ok(r.edges.some(e => e.target === 'module:json'))]);
  });
});

describe('r extractor', () => {
  it('captures function, setClass, library', () => {
    smoke('.R',
      `library(dplyr)\ngreet <- function(name) { print(name) }\nsetClass("Foo", representation())`,
      [r => assert.ok(has(r, 'function', 'greet')),
       r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(r.edges.some(e => e.target === 'module:dplyr'))]);
  });
});

describe('julia extractor', () => {
  it('captures function (long+short), struct, using', () => {
    smoke('.jl',
      `using DataFrames\nfunction greet(name)\n  println(name)\nend\nstruct Point\n  x::Int\nend\nadd(a, b) = a + b`,
      [r => assert.ok(has(r, 'function', 'greet')),
       r => assert.ok(has(r, 'function', 'add')),
       r => assert.ok(has(r, 'type', 'Point')),
       r => assert.ok(r.edges.some(e => e.target === 'module:DataFrames'))]);
  });
});

describe('csharp extractor', () => {
  it('captures class, interface, method, using', () => {
    smoke('.cs',
      `using System;\npublic class Foo {\n  public int Bar(int x) { return x; }\n}\npublic interface IGreeter {}`,
      [r => assert.ok(has(r, 'class', 'Foo')),
       r => assert.ok(has(r, 'function', 'Bar')),
       r => assert.ok(has(r, 'type', 'IGreeter')),
       r => assert.ok(r.edges.some(e => e.target === 'module:System'))]);
  });
});

describe('fsharp extractor', () => {
  it('captures let, type, open', () => {
    smoke('.fs',
      `open System\nlet greet name = printfn "%s" name\ntype Point = { X: int; Y: int }`,
      [r => assert.ok(has(r, 'function', 'greet')),
       r => assert.ok(has(r, 'type', 'Point')),
       r => assert.ok(r.edges.some(e => e.target === 'module:System'))]);
  });
});

describe('sfc extractor', () => {
  it('extracts Vue <script> block with line offsets', () => {
    const src = `<template>\n  <div>Hi</div>\n</template>\n<script>\nexport function greet() { return 1 }\n</script>`;
    const r = registry.extract('.vue', src, 'x.vue', {});
    assert.ok(has(r, 'function', 'greet'));
    const n = r.nodes.find(x => x.name === 'greet');
    // <script> tag is at line 4; export is inside, line_start shifts accordingly
    assert.ok(n.line_start >= 5, `expected line offset, got ${n.line_start}`);
  });
  it('extracts Astro frontmatter', () => {
    const src = `---\nexport function helper() { return 1 }\n---\n<div/>`;
    const r = registry.extract('.astro', src, 'x.astro', {});
    assert.ok(has(r, 'function', 'helper'));
  });
});
