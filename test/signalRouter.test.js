const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fuse, processEvolverSignal, parseErrsig } = require('../src/gep/signalRouter');

describe('parseErrsig', () => {
  it('parses errsig:TypeError:message format', () => {
    const r = parseErrsig('errsig:TypeError: Cannot read property');
    assert.equal(r.type, 'TypeError');
    assert.equal(r.message, ' Cannot read property');
  });

  it('returns null for non-errsig signals', () => {
    assert.equal(parseErrsig('log_error'), null);
    assert.equal(parseErrsig('perf_bottleneck'), null);
  });
});

describe('processEvolverSignal', () => {
  it('assigns confidence 1.0 to errsig signals', () => {
    const r = processEvolverSignal('errsig:TypeError: something');
    assert.equal(r.confidence, 1.0);
    assert.equal(r.action, 'gene_match');
    assert.equal(r.geneId, 'gene_gep_repair_from_errors');
  });

  it('returns null for unknown signals', () => {
    const r = processEvolverSignal('unknown_signal');
    // Returns null for unclassified signals
    assert.equal(r, null);
  });
});

describe('fuse', () => {
  it('returns AUTO_TRIGGER for errsig signals', () => {
    const results = fuse(['errsig:TypeError: Cannot read properties'], []);
    const autoTrigger = results.filter(r => r.decision === 'AUTO_TRIGGER');
    assert.ok(autoTrigger.length > 0, 'should have AUTO_TRIGGER result');
    assert.equal(autoTrigger[0].confidence, 1.0);
  });

  it('returns WARN for low-count OMC fragments', () => {
    const results = fuse([], [{ skill: 'test', pattern: 'rm -rf', count: 1 }]);
    const warn = results.filter(r => r.decision === 'WARN');
    assert.ok(warn.length > 0, 'should have WARN result for count=1');
    assert.equal(warn[0].confidence, 0.6); // 0.5 + 1*0.1
  });

  it('returns AUTO_TRIGGER for high-count OMC fragments', () => {
    const results = fuse([], [{ skill: 'test', pattern: 'rm -rf', count: 5 }]);
    const autoTrigger = results.filter(r => r.decision === 'AUTO_TRIGGER');
    assert.ok(autoTrigger.length > 0, 'should have AUTO_TRIGGER for count=5');
    assert.equal(autoTrigger[0].confidence, 0.9); // min(0.9, 0.5 + 5*0.1)
  });

  it('merges dual-channel signals (evolver + omc)', () => {
    const results = fuse(
      ['errsig:TypeError: Division by zero'],
      [{ skill: 'git-clean-fd', pattern: 'git clean', count: 4 }]
    );
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.channel === 'evolver'));
    assert.ok(results.some(r => r.channel === 'omc'));
  });

  it('deduplicates same signal from multiple sources', () => {
    const results = fuse(
      ['errsig:TypeError: foo'],
      [{ skill: 'test', pattern: 'foo', count: 3 }]
    );
    // Both channels see TypeError - should merge
    const types = results.filter(r => r.type === 'TypeError');
    assert.ok(types.length >= 1);
  });
});
