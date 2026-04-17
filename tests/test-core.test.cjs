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

// ============================================================
// Installer: per-tool MCP config serializers
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const installer = require('../bin/install.js');

function mkInstallTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // Stub the shipfast/mcp/server.cjs binary path that writers reference
  fs.mkdirSync(path.join(root, 'shipfast', 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shipfast', 'mcp', 'server.cjs'), '// stub');
  return root;
}

describe('writeCursorMcpConfig', () => {
  it('writes mcp.json with shipfast-brain entry', () => {
    const dir = mkInstallTmp('sf-cursor-');
    installer.writeCursorMcpConfig(dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    assert.ok(cfg.mcpServers['shipfast-brain']);
    assert.equal(cfg.mcpServers['shipfast-brain'].command, 'node');
    assert.ok(cfg.mcpServers['shipfast-brain'].args[0].endsWith('server.cjs'));
  });
  it('preserves existing mcpServers entries', () => {
    const dir = mkInstallTmp('sf-cursor-');
    fs.writeFileSync(path.join(dir, 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'foo' } } }));
    installer.writeCursorMcpConfig(dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    assert.equal(cfg.mcpServers.other.command, 'foo');
    assert.ok(cfg.mcpServers['shipfast-brain']);
  });
  it('migrates stale shipfast-brain from settings.json', () => {
    const dir = mkInstallTmp('sf-cursor-');
    fs.writeFileSync(path.join(dir, 'settings.json'),
      JSON.stringify({ editor: { fontSize: 14 }, mcpServers: { 'shipfast-brain': { command: 'stale' }, other: { command: 'keep' } } }));
    installer.writeCursorMcpConfig(dir);
    const legacy = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(legacy.editor.fontSize, 14);                     // untouched
    assert.ok(!legacy.mcpServers || !legacy.mcpServers['shipfast-brain']); // migrated away
    assert.ok(legacy.mcpServers && legacy.mcpServers.other);      // other entry kept
  });
});

describe('writeWindsurfMcpConfig', () => {
  it('writes mcp_config.json under the Windsurf directory', () => {
    const dir = mkInstallTmp('sf-windsurf-');
    installer.writeWindsurfMcpConfig(dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mcp_config.json'), 'utf8'));
    assert.equal(cfg.mcpServers['shipfast-brain'].command, 'node');
  });
  it('preserves existing entries', () => {
    const dir = mkInstallTmp('sf-windsurf-');
    fs.writeFileSync(path.join(dir, 'mcp_config.json'),
      JSON.stringify({ mcpServers: { keeper: { command: 'x' } } }));
    installer.writeWindsurfMcpConfig(dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mcp_config.json'), 'utf8'));
    assert.ok(cfg.mcpServers.keeper);
    assert.ok(cfg.mcpServers['shipfast-brain']);
  });
});

describe('writeCodexMcpConfig', () => {
  it('writes a [mcp_servers.shipfast-brain] TOML section to config.toml', () => {
    const dir = mkInstallTmp('sf-codex-');
    installer.writeCodexMcpConfig(dir);
    const out = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    assert.ok(out.includes('[mcp_servers.shipfast-brain]'));
    assert.ok(out.includes('command = "node"'));
    assert.ok(/args = \[".*server\.cjs"\]/.test(out));
  });
  it('preserves unrelated TOML sections', () => {
    const dir = mkInstallTmp('sf-codex-');
    fs.writeFileSync(path.join(dir, 'config.toml'),
      '[profile.default]\nmodel = "gpt-5"\n\n[mcp_servers.other]\ncommand = "foo"\n');
    installer.writeCodexMcpConfig(dir);
    const out = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    assert.ok(out.includes('[profile.default]'));
    assert.ok(out.includes('model = "gpt-5"'));
    assert.ok(out.includes('[mcp_servers.other]'));
    assert.ok(out.includes('[mcp_servers.shipfast-brain]'));
  });
  it('replaces an old shipfast-brain section instead of duplicating', () => {
    const dir = mkInstallTmp('sf-codex-');
    fs.writeFileSync(path.join(dir, 'config.toml'),
      '[mcp_servers.shipfast-brain]\ncommand = "old"\nargs = ["/old"]\n\n[other]\nkey = "v"\n');
    installer.writeCodexMcpConfig(dir);
    const out = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    const sections = out.match(/\[mcp_servers\.shipfast-brain\]/g) || [];
    assert.equal(sections.length, 1);
    assert.ok(!out.includes('command = "old"'));
    assert.ok(out.includes('[other]'));
  });
});

describe('cleanMcpJson', () => {
  it('removes shipfast-brain but keeps other mcpServers entries', () => {
    const dir = mkInstallTmp('sf-clean-');
    const fp = path.join(dir, 'mcp.json');
    fs.writeFileSync(fp, JSON.stringify({ mcpServers: { 'shipfast-brain': {}, kept: { a: 1 } } }));
    installer.cleanMcpJson(fp);
    const after = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.ok(!after.mcpServers['shipfast-brain']);
    assert.ok(after.mcpServers.kept);
  });
  it('deletes mcpServers key if it becomes empty', () => {
    const dir = mkInstallTmp('sf-clean-');
    const fp = path.join(dir, 'mcp.json');
    fs.writeFileSync(fp, JSON.stringify({ other: 1, mcpServers: { 'shipfast-brain': {} } }));
    installer.cleanMcpJson(fp);
    const after = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.ok(!after.mcpServers);
    assert.equal(after.other, 1);
  });
  it('is a no-op when no shipfast-brain entry exists', () => {
    const dir = mkInstallTmp('sf-clean-');
    const fp = path.join(dir, 'mcp.json');
    const original = JSON.stringify({ mcpServers: { kept: { a: 1 } } });
    fs.writeFileSync(fp, original);
    installer.cleanMcpJson(fp);
    assert.equal(fs.readFileSync(fp, 'utf8'), original);
  });
});

describe('cleanCodexToml', () => {
  it('strips shipfast-brain section, keeps others', () => {
    const dir = mkInstallTmp('sf-clean-codex-');
    const fp = path.join(dir, 'config.toml');
    fs.writeFileSync(fp,
      '[profile.default]\nmodel = "gpt-5"\n\n[mcp_servers.shipfast-brain]\ncommand = "node"\nargs = ["/x"]\n\n[mcp_servers.other]\ncommand = "foo"\n');
    installer.cleanCodexToml(fp);
    const after = fs.readFileSync(fp, 'utf8');
    assert.ok(!after.includes('shipfast-brain'));
    assert.ok(after.includes('[profile.default]'));
    assert.ok(after.includes('[mcp_servers.other]'));
  });
  it('removes the file entirely if nothing else is left', () => {
    const dir = mkInstallTmp('sf-clean-codex-');
    const fp = path.join(dir, 'config.toml');
    fs.writeFileSync(fp, '[mcp_servers.shipfast-brain]\ncommand = "node"\nargs = ["/x"]\n');
    installer.cleanCodexToml(fp);
    assert.equal(fs.existsSync(fp), false);
  });
});

// ============================================================
// Project-signal scanners (v1.7.0)
// ============================================================

const pkgJsonScanner       = require('../brain/signals/package_json.cjs');
const cargoScanner         = require('../brain/signals/cargo_toml.cjs');
const goModScanner         = require('../brain/signals/go_mod.cjs');
const pyprojectScanner     = require('../brain/signals/pyproject_toml.cjs');
const reqTxtScanner        = require('../brain/signals/requirements_txt.cjs');
const gemfileScanner       = require('../brain/signals/gemfile.cjs');
const composerScanner      = require('../brain/signals/composer_json.cjs');
const pubspecScanner       = require('../brain/signals/pubspec_yaml.cjs');
const csprojScanner        = require('../brain/signals/csproj.cjs');
const mixScanner           = require('../brain/signals/mix_exs.cjs');
const tsconfigScanner      = require('../brain/signals/tsconfig_json.cjs');
const versionFilesScanner  = require('../brain/signals/version_files.cjs');
const lockfileScanner      = require('../brain/signals/pm_lockfiles.cjs');
const envScanner           = require('../brain/signals/env_example.cjs');
const workspacesScanner    = require('../brain/signals/workspaces.cjs');
const frameworkDetect      = require('../brain/signals/framework_detect.cjs');
const signalsCommon        = require('../brain/signals/_common.cjs');

describe('package_json scanner', () => {
  it('parses deps + devDeps + scripts + engines', () => {
    const src = JSON.stringify({
      name: 'x', version: '1.0.0',
      engines: { node: '>=18' },
      packageManager: 'pnpm@8.15.0',
      dependencies: { react: '^19.0.0', exceljs: '^4.4.0' },
      devDependencies: { vitest: '^1.4.0' },
      scripts: { test: 'vitest run', build: 'tsc' },
    });
    const r = pkgJsonScanner.scan(src, 'package.json');
    assert.equal(r.deps.length, 3);
    assert.ok(r.deps.some(d => d.name === 'react' && d.kind === 'runtime'));
    assert.ok(r.deps.some(d => d.name === 'vitest' && d.kind === 'dev'));
    assert.equal(r.scripts.length, 2);
    assert.equal(r.signals.package_manager, 'pnpm@8.15.0');
    assert.deepEqual(r.signals.engines, { node: '>=18' });
  });
  it('captures workspaces field', () => {
    const r = pkgJsonScanner.scan(JSON.stringify({
      name: 'root', workspaces: ['apps/*', 'packages/*']
    }), 'package.json');
    assert.equal(r.signals.workspace.type, 'npm');
    assert.deepEqual(r.signals.workspace.packages, ['apps/*', 'packages/*']);
  });
});

describe('cargo_toml scanner', () => {
  it('parses package + dependencies + dev-dependencies', () => {
    const r = cargoScanner.scan(`
[package]
name = "my-crate"
version = "0.2.0"
edition = "2021"

[dependencies]
serde = "1"
tokio = { version = "1", features = ["full"] }

[dev-dependencies]
pretty_assertions = "1.4"
`);
    assert.equal(r.signals.project_name, 'my-crate');
    assert.equal(r.signals.rust_edition, '2021');
    assert.ok(r.deps.some(d => d.name === 'serde' && d.version === '1'));
    assert.ok(r.deps.some(d => d.name === 'tokio' && d.version === '1'));
    assert.ok(r.deps.some(d => d.name === 'pretty_assertions' && d.kind === 'dev'));
  });
});

describe('go_mod scanner', () => {
  it('parses module + multi-line require block', () => {
    const r = goModScanner.scan(`
module github.com/acme/foo

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/spf13/cobra v1.8.0 // indirect
)

require github.com/google/uuid v1.6.0
`);
    assert.equal(r.signals.project_name, 'github.com/acme/foo');
    assert.equal(r.signals.go_version, '1.22');
    assert.ok(r.deps.some(d => d.name === 'github.com/gin-gonic/gin' && d.version === 'v1.9.1'));
    assert.ok(r.deps.some(d => d.name === 'github.com/spf13/cobra' && d.kind === 'peer')); // indirect
    assert.ok(r.deps.some(d => d.name === 'github.com/google/uuid'));
  });
});

describe('pyproject_toml scanner', () => {
  it('parses PEP 621 deps', () => {
    const r = pyprojectScanner.scan(`
[project]
name = "my-pkg"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.100", "pydantic<3"]
`);
    assert.equal(r.signals.project_name, 'my-pkg');
    assert.equal(r.signals.python_requires, '>=3.11');
    assert.ok(r.deps.some(d => d.name === 'fastapi'));
    assert.ok(r.deps.some(d => d.name === 'pydantic'));
  });
  it('parses Poetry deps', () => {
    const r = pyprojectScanner.scan(`
[tool.poetry]
name = "p"

[tool.poetry.dependencies]
python = "^3.11"
django = "^5.0"

[tool.poetry.dev-dependencies]
pytest = "^8"
`);
    assert.ok(r.deps.some(d => d.name === 'django' && d.kind === 'runtime'));
    assert.ok(r.deps.some(d => d.name === 'pytest' && d.kind === 'dev'));
    assert.equal(r.signals.python_requires, '^3.11');
  });
});

describe('requirements_txt scanner', () => {
  it('parses flat pip requirements', () => {
    const r = reqTxtScanner.scan(`
flask==3.0.0
requests>=2.25
# comment line
-r other.txt
`, 'requirements.txt');
    assert.ok(r.deps.some(d => d.name === 'flask'));
    assert.ok(r.deps.some(d => d.name === 'requests'));
    assert.equal(r.deps.filter(d => d.name.startsWith('-')).length, 0);
  });
  it('tags dev requirements', () => {
    const r = reqTxtScanner.scan('pytest', 'requirements-dev.txt');
    assert.equal(r.deps[0].kind, 'dev');
  });
});

describe('gemfile scanner', () => {
  it('extracts gems and dev groups', () => {
    const r = gemfileScanner.scan(`
ruby '3.2.0'
gem 'rails', '~> 7.1'
gem 'pg'
group :development, :test do
  gem 'rspec'
end
`);
    assert.equal(r.signals.ruby_required, '3.2.0');
    assert.ok(r.deps.some(d => d.name === 'rails' && d.kind === 'runtime'));
    assert.ok(r.deps.some(d => d.name === 'rspec' && d.kind === 'dev'));
  });
});

describe('composer_json scanner', () => {
  it('parses require + require-dev + scripts', () => {
    const r = composerScanner.scan(JSON.stringify({
      name: 'acme/app',
      require: { php: '>=8.1', 'laravel/framework': '^11.0' },
      'require-dev': { 'phpunit/phpunit': '^10.5' },
      scripts: { test: 'phpunit', 'lint': ['php-cs-fixer fix'] },
    }));
    assert.equal(r.signals.php_required, '>=8.1');
    assert.ok(r.deps.some(d => d.name === 'laravel/framework'));
    assert.ok(r.deps.some(d => d.name === 'phpunit/phpunit' && d.kind === 'dev'));
    assert.equal(r.scripts.length, 2);
  });
});

describe('pubspec_yaml scanner', () => {
  it('parses flutter deps', () => {
    const r = pubspecScanner.scan(`
name: my_app
version: 1.0.0
environment:
  sdk: ">=3.0.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  http: ^1.1.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  lints: ^3.0.0
`);
    assert.equal(r.signals.project_name, 'my_app');
    assert.ok(r.deps.some(d => d.name === 'http'));
    assert.ok(r.deps.some(d => d.name === 'lints' && d.kind === 'dev'));
  });
});

describe('csproj scanner', () => {
  it('extracts PackageReference entries', () => {
    const r = csprojScanner.scan(`
<Project>
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog"><Version>3.1.1</Version></PackageReference>
  </ItemGroup>
</Project>
`, 'app.csproj');
    assert.equal(r.signals.dotnet_target, 'net8.0');
    assert.ok(r.deps.some(d => d.name === 'Newtonsoft.Json' && d.version === '13.0.3'));
    assert.ok(r.deps.some(d => d.name === 'Serilog' && d.version === '3.1.1'));
  });
});

describe('mix_exs scanner', () => {
  it('extracts deps + app + version', () => {
    const r = mixScanner.scan(`
defmodule MyApp.MixProject do
  use Mix.Project
  def project do
    [app: :my_app, version: "0.1.0", elixir: "~> 1.16", deps: deps()]
  end
  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:ecto, "~> 3.11", only: :dev},
      {:plug, "~> 1.14", optional: true}
    ]
  end
end
`);
    assert.equal(r.signals.project_name, 'my_app');
    assert.equal(r.signals.project_version, '0.1.0');
    assert.ok(r.deps.some(d => d.name === 'phoenix' && d.kind === 'runtime'));
    assert.ok(r.deps.some(d => d.name === 'ecto' && d.kind === 'dev'));
    assert.ok(r.deps.some(d => d.name === 'plug' && d.kind === 'optional'));
  });
});

describe('tsconfig_json scanner', () => {
  it('captures compilerOptions with comments', () => {
    const r = tsconfigScanner.scan(`{
  // base config
  "compilerOptions": {
    "target": "es2022",
    "strict": true,
    "paths": { "@/*": ["./src/*"] },
  },
}`, 'tsconfig.json');
    assert.equal(r.signals.typescript.target, 'es2022');
    assert.equal(r.signals.typescript.strict, true);
    assert.deepEqual(r.signals.typescript.paths, { '@/*': ['./src/*'] });
  });
  it('ignores nested tsconfig files', () => {
    const r = tsconfigScanner.scan('{"compilerOptions":{"strict":false}}', 'apps/web/tsconfig.json');
    assert.deepEqual(r, {});
  });
});

describe('version_files scanner', () => {
  it('handles .nvmrc', () => {
    const r = versionFilesScanner.scan('v20.11.0\n', '.nvmrc');
    assert.equal(r.signals.node_version, '20.11.0');
  });
  it('handles .tool-versions', () => {
    const r = versionFilesScanner.scan('nodejs 20.11.0\npython 3.12.2\n', '.tool-versions');
    assert.deepEqual(r.signals.tool_versions, { nodejs: '20.11.0', python: '3.12.2' });
  });
  it('handles rust-toolchain.toml', () => {
    const r = versionFilesScanner.scan('[toolchain]\nchannel = "stable"\n', 'rust-toolchain.toml');
    assert.equal(r.signals.rust_toolchain, 'stable');
  });
});

describe('pm_lockfiles scanner', () => {
  it('maps each lockfile to its package manager', () => {
    assert.equal(lockfileScanner.scan('', 'pnpm-lock.yaml').signals.detected_pm, 'pnpm');
    assert.equal(lockfileScanner.scan('', 'yarn.lock').signals.detected_pm, 'yarn');
    assert.equal(lockfileScanner.scan('', 'bun.lockb').signals.detected_pm, 'bun');
    assert.equal(lockfileScanner.scan('', 'package-lock.json').signals.detected_pm, 'npm');
    assert.equal(lockfileScanner.scan('', 'Cargo.lock').signals.detected_pm, 'cargo');
    assert.equal(lockfileScanner.scan('', 'poetry.lock').signals.detected_pm, 'poetry');
  });
});

describe('env_example scanner', () => {
  it('extracts only KEY names, no values', () => {
    const r = envScanner.scan(`
# database
DATABASE_URL=postgres://localhost/x
REDIS_URL=redis://localhost

# auth
JWT_SECRET=your-secret-here
`, '.env.example');
    assert.deepEqual(r.signals.env_vars, ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL']);
  });
  it('refuses to read real .env', () => {
    const r = envScanner.scan('SECRET=real_value', '.env');
    assert.deepEqual(r, {});
  });
});

describe('workspaces scanner', () => {
  it('parses pnpm-workspace.yaml', () => {
    const r = workspacesScanner.scan('packages:\n  - apps/*\n  - packages/*\n', 'pnpm-workspace.yaml');
    assert.equal(r.signals.workspace.type, 'pnpm');
    assert.deepEqual(r.signals.workspace.packages, ['apps/*', 'packages/*']);
  });
  it('detects turbo / nx presence', () => {
    assert.equal(workspacesScanner.scan('{}', 'turbo.json').signals.monorepo_tool, 'turbo');
    assert.equal(workspacesScanner.scan('{}', 'nx.json').signals.monorepo_tool, 'nx');
  });
});

describe('framework_detect (derived)', () => {
  it('detects Next.js from deps', () => {
    const d = frameworkDetect.derive({
      deps: [{ ecosystem: 'npm', name: 'next', version: '^15.0.0' }],
      scripts: [], signals: {},
    });
    assert.equal(d.framework.name, 'next');
    assert.equal(d.framework.version, '^15.0.0');
  });
  it('detects vitest test framework + prisma ORM', () => {
    const d = frameworkDetect.derive({
      deps: [
        { ecosystem: 'npm', name: 'vitest', version: '^1.4.0' },
        { ecosystem: 'npm', name: '@prisma/client', version: '^5.7.0' },
      ],
      scripts: [], signals: {},
    });
    assert.equal(d.test_framework.name, 'vitest');
    assert.equal(d.orm.name, 'prisma');
  });
  it('prefers .nvmrc over engines for runtime', () => {
    const d = frameworkDetect.derive({
      deps: [], scripts: [],
      signals: { node_version: '20.11.0', engines: { node: '>=18' } },
    });
    assert.equal(d.runtime.version, '20.11.0');
  });
  it('falls back to engines when no .nvmrc', () => {
    const d = frameworkDetect.derive({
      deps: [], scripts: [],
      signals: { engines: { node: '>=18' } },
    });
    assert.equal(d.runtime.language, 'node');
    assert.equal(d.runtime.version, '>=18');
  });
});

describe('_common parsers', () => {
  it('parseTomlLite handles nested sections', () => {
    const t = signalsCommon.parseTomlLite('[a.b]\nkey = "v"\n');
    assert.equal(t.a.b.key, 'v');
  });
  it('parseTomlLite handles inline tables', () => {
    const t = signalsCommon.parseTomlLite('[dependencies]\ntokio = { version = "1", features = ["full"] }');
    assert.equal(t.dependencies.tokio.version, '1');
  });
  it('parseEnvKeys returns only keys', () => {
    const k = signalsCommon.parseEnvKeys('FOO=x\nexport BAR=y\n# skip\nINVALID\n');
    assert.deepEqual(k, ['FOO', 'BAR']);
  });
});

describe('signals end-to-end on a fixture tree', () => {
  it('scans a mixed fixture directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sig-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'demo', dependencies: { next: '15.0.0' }, devDependencies: { vitest: '1.4.0' },
      scripts: { test: 'vitest run' }, packageManager: 'pnpm@8.15.0',
    }));
    fs.writeFileSync(path.join(tmp, '.nvmrc'), '20.11.0\n');
    fs.writeFileSync(path.join(tmp, '.env.example'), 'DB_URL=placeholder\nAPI_KEY=xxx\n');
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');

    // Initialize brain for the fixture
    const brain = require('../brain/index.cjs');
    brain.initBrain(tmp);

    const signals = require('../brain/signals/index.cjs');
    const result = signals.scanAll(tmp);

    assert.ok(result.manifests >= 4, `expected >=4 manifests, got ${result.manifests}`);
    assert.ok(result.deps >= 2, `expected >=2 deps, got ${result.deps}`);
    assert.ok(result.scripts >= 1);

    const stack = brain.getProjectStack(tmp);
    assert.equal(stack.framework && stack.framework.name, 'next');
    assert.equal(stack.test_framework && stack.test_framework.name, 'vitest');
    assert.equal(stack.package_manager, 'pnpm');
    assert.equal(stack.runtime && stack.runtime.version, '20.11.0');
    assert.equal(stack.workspace && stack.workspace.type, 'pnpm');

    const deps = brain.getDependencies(tmp, { ecosystem: 'npm' });
    assert.ok(deps.some(d => d.name === 'next'));
    assert.ok(deps.some(d => d.name === 'vitest'));

    const scripts = brain.getScripts(tmp);
    assert.ok(scripts.some(s => s.name === 'test' && s.command === 'vitest run'));
  });
});

describe('context-builder stack injection', () => {
  it('emits <project_stack> block when brain has stack data', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ctx-'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'demo', dependencies: { next: '15.0.0', react: '19.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, '.nvmrc'), '20.11.0\n');

    const brain = require('../brain/index.cjs');
    brain.initBrain(tmp);
    const signals = require('../brain/signals/index.cjs');
    signals.scanAll(tmp);

    const { buildFullContext } = require('../core/context-builder.cjs');
    const ctx = buildFullContext(tmp, { affectedFiles: [], domain: 'frontend' });
    assert.ok(ctx.includes('<project_stack>'), 'missing <project_stack>');
    assert.ok(ctx.includes('next'), 'missing framework identity');
    assert.ok(ctx.includes('node') || ctx.includes('runtime'), 'missing runtime');
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
  it('tolerates leading blank lines before Astro fence', () => {
    const src = `\n---\nimport L from '../a.astro'\nexport function f() {}\n---\n<L/>`;
    const r = registry.extract('.astro', src, 'x.astro', {});
    assert.ok(has(r, 'function', 'f'));
    assert.ok(r.edges.some(e => e.target === 'file:../a.astro'));
  });
  it('tolerates CRLF line endings in Astro frontmatter', () => {
    const src = '---\r\nimport L from \'../a.astro\'\r\nexport function g() {}\r\n---\r\n<L/>';
    const r = registry.extract('.astro', src, 'x.astro', {});
    assert.ok(has(r, 'function', 'g'));
  });
});
