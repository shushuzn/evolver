/**
 * AutoTune Unit Tests
 * Validates Bayesian keyword weight computation and F1 threshold search.
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOTUNE = path.join(__dirname, '../src/ops/autotune.js');
const AUTOTUNE_URL = 'file://' + path.join(__dirname, '../src/ops/autotune.js').replace(/\\/g, '/');

// ── Test helpers ────────────────────────────────────────────────────────────────
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotune-test-'));
  return dir;
}

function writeJsonl(dir, name, records) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n'), 'utf8');
  return file;
}

// ── Mock AutoTune with tmp data dir ───────────────────────────────────────────
async function makeTuner(tmpDir) {
  const { AutoTune } = await import(AUTOTUNE_URL);
  const tuner = new AutoTune({
    dataDir: tmpDir,
    outputPath: path.join(tmpDir, 'evolver-autotune.json'),
    minSamples: 3,
    priorStrength: 10,
  });
  return tuner;
}

describe('AutoTune.keyword_weights', () => {

  it('initializes all keywords with weight 1.0', async () => {
    const tmp = makeTmpDir();
    const tuner = await makeTuner(tmp);
    tuner.load();
    assert.strictEqual(tuner.weights.log_error['error:'], 1.0);
    assert.strictEqual(tuner.weights.perf_bottleneck['bottleneck'], 1.0);
    fs.rmSync(tmp, { recursive: true });
  });

  it('raises weight for high TP-rate keyword', async () => {
    const tmp = makeTmpDir();
    // 9 TP, 1 FP → posterior = (9+5)/(10+10) = 14/20 = 0.7
    writeJsonl(tmp, 'pretool-warn-history.jsonl', [
      { pattern: 'log_error', command: 'ReferenceError foo', session_id: 's1' },
      { pattern: 'log_error', command: 'ReferenceError bar', session_id: 's2' },
      { pattern: 'log_error', command: 'ReferenceError baz', session_id: 's3' },
      { pattern: 'log_error', command: 'ReferenceError qux', session_id: 's4' },
      { pattern: 'log_error', command: 'ReferenceError quux', session_id: 's5' },
      { pattern: 'log_error', command: 'ReferenceError corge', session_id: 's6' },
      { pattern: 'log_error', command: 'ReferenceError grault', session_id: 's7' },
      { pattern: 'log_error', command: 'ReferenceError garply', session_id: 's8' },
      { pattern: 'log_error', command: 'ReferenceError waldo', session_id: 's9' },
      { pattern: 'log_error', command: 'ReferenceError fred', session_id: 's10' },  // FP
    ]);
    writeJsonl(tmp, 'evolver-outcomes.jsonl', [
      { session_id: 's1', signals: ['log_error'], preview: 'ReferenceError foo' },
      { session_id: 's2', signals: ['log_error'], preview: 'ReferenceError bar' },
      { session_id: 's3', signals: ['log_error'], preview: 'ReferenceError baz' },
      { session_id: 's4', signals: ['log_error'], preview: 'ReferenceError qux' },
      { session_id: 's5', signals: ['log_error'], preview: 'ReferenceError quux' },
      { session_id: 's6', signals: ['log_error'], preview: 'ReferenceError corge' },
      { session_id: 's7', signals: ['log_error'], preview: 'ReferenceError grault' },
      { session_id: 's8', signals: ['log_error'], preview: 'ReferenceError garply' },
      { session_id: 's9', signals: ['log_error'], preview: 'ReferenceError waldo' },
      // s10 is NOT in outcomes → FP
    ]);

    const tuner = await makeTuner(tmp);
    tuner.load();
    const w = tuner._computeKeywordWeight('log_error', 'referenceerror');

    // Bayesian posterior: (9 + 5) / (10 + 10) = 0.7
    // adjustment = (0.7-0.5)/0.5 = 0.4
    // weight = 1.0 + 0.4 = 1.4 (EMA smoothed with prev 1.0, alpha=0.3)
    // → 0.3*1.4 + 0.7*1.0 = 1.12
    assert.ok(w > 1.0, `weight ${w} should be > 1.0 for high TP keyword`);
    fs.rmSync(tmp, { recursive: true });
  });

  it('lowers weight for high FP-rate keyword', async () => {
    const tmp = makeTmpDir();
    // 1 TP, 9 FP → posterior = (1+5)/(10+10) = 6/20 = 0.3
    writeJsonl(tmp, 'pretool-warn-history.jsonl', [
      { pattern: 'log_error', command: 'error: foo', session_id: 's1' },
      { pattern: 'log_error', command: 'error: bar', session_id: 's2' },
      { pattern: 'log_error', command: 'error: baz', session_id: 's3' },
      { pattern: 'log_error', command: 'error: qux', session_id: 's4' },
      { pattern: 'log_error', command: 'error: quux', session_id: 's5' },
      { pattern: 'log_error', command: 'error: corge', session_id: 's6' },
      { pattern: 'log_error', command: 'error: grault', session_id: 's7' },
      { pattern: 'log_error', command: 'error: garply', session_id: 's8' },
      { pattern: 'log_error', command: 'error: waldo', session_id: 's9' },
      { pattern: 'log_error', command: 'error: fred', session_id: 's10' },
    ]);
    // Only s1 has an outcome (TP), rest are FP
    writeJsonl(tmp, 'evolver-outcomes.jsonl', [
      { session_id: 's1', signals: ['log_error'], preview: 'error: foo' },
    ]);

    const tuner = await makeTuner(tmp);
    tuner.load();
    const w = tuner._computeKeywordWeight('log_error', 'error:');

    // posterior = (1+5)/(10+10) = 0.3
    // adjustment = (0.3-0.5)/0.5 = -0.4
    // weight = 1.0 - 0.4 = 0.6
    // EMA: 0.3*0.6 + 0.7*1.0 = 0.88
    assert.ok(w < 1.0, `weight ${w} should be < 1.0 for high FP keyword`);
    fs.rmSync(tmp, { recursive: true });
  });

  it('respects minWeight / maxWeight bounds', async () => {
    const tmp = makeTmpDir();
    // 100% FP → posterior near 0 → weight → min
    writeJsonl(tmp, 'pretool-warn-history.jsonl', [
      { pattern: 'log_error', command: 'error: x', session_id: 's1' },
      { pattern: 'log_error', command: 'error: x', session_id: 's2' },
      { pattern: 'log_error', command: 'error: x', session_id: 's3' },
    ]);
    // no outcomes → all FP
    writeJsonl(tmp, 'evolver-outcomes.jsonl', []);

    const tuner = await makeTuner(tmp);
    tuner.load();
    const w = tuner._computeKeywordWeight('log_error', 'error:');
    assert.ok(w >= 0.1, `weight ${w} should be >= minWeight 0.1`);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('AutoTune.tune()', () => {
  it('writes valid evolver-autotune.json', async () => {
    const tmp = makeTmpDir();
    writeJsonl(tmp, 'pretool-warn-history.jsonl', []);
    writeJsonl(tmp, 'evolver-outcomes.jsonl', []);

    const tuner = await makeTuner(tmp);
    const result = tuner.tune();

    assert.ok(fs.existsSync(path.join(tmp, 'evolver-autotune.json')));
    assert.ok(result.keyword_weights);
    assert.ok(result.signal_thresholds);
    assert.ok(result.boost_params);
    assert.ok(result.tuned_at);
    fs.rmSync(tmp, { recursive: true });
  });

  it('clamps boost_params in valid range [0.05, 0.3]', async () => {
    const tmp = makeTmpDir();
    writeJsonl(tmp, 'pretool-warn-history.jsonl', [
      { pattern: 'git-clean-fd', command: 'git clean -fd', session_id: 's1' },
      { pattern: 'git-clean-fd', command: 'git clean -fd', session_id: 's2' },
      { pattern: 'git-clean-fd', command: 'git clean -fd', session_id: 's3' },
    ]);
    writeJsonl(tmp, 'evolver-outcomes.jsonl', [
      { session_id: 's1', signals: ['log_error'], preview: 'git clean' },
      { session_id: 's2', signals: ['log_error'], preview: 'git clean' },
      { session_id: 's3', signals: ['log_error'], preview: 'git clean' },
    ]);

    const tuner = await makeTuner(tmp);
    const result = tuner.tune();

    assert.ok(result.boost_params.consensusBoost >= 0.05);
    assert.ok(result.boost_params.consensusBoost <= 0.3);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('AutoTune.stats()', () => {
  it('reports warnCount and outcomeCount', async () => {
    const tmp = makeTmpDir();
    writeJsonl(tmp, 'pretool-warn-history.jsonl', [
      { pattern: 'rm-rf', command: 'rm -rf /', session_id: 's1' },
      { pattern: 'rm-rf', command: 'rm -rf /tmp', session_id: 's2' },
    ]);
    writeJsonl(tmp, 'evolver-outcomes.jsonl', [
      { session_id: 's1', signals: ['log_error'], preview: 'rm -rf' },
    ]);

    const tuner = await makeTuner(tmp);
    const stats = tuner.stats();

    assert.strictEqual(stats.warnCount, 2);
    assert.strictEqual(stats.outcomeCount, 1);
    fs.rmSync(tmp, { recursive: true });
  });
});
