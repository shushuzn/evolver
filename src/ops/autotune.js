/**
 * AutoTune Engine — Evolver Skill 闭环 Parameter Optimizer
 * Learns keyword weights, thresholds, and boost params from warn + outcome history.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
// Resolve to workspace root .omc/ (same as PreToolUse Hook looks for)
function resolveWorkspaceOmc(...segments) {
  // __dirname = evolver/src/ops/  → go up to evolver/ root
  const root = path.resolve(__dirname, '../../');
  return path.join(root, '.omc', ...segments);
}

const CONFIG = {
  // evolver/src/ops/ → evolver/ → 80-PROJECTS/ → workspace/
  dataDir: path.resolve(__dirname, '../../../../.omc/state'),
  outputPath: path.resolve(__dirname, '../../../../.omc/state/evolver-autotune.json'),
  windowSize: 50,
  emaAlpha: 0.3,
  minWeight: 0.1,
  maxWeight: 5.0,
  maxDelta: 0.2,
  prior: 0.5,
  priorStrength: 10,
  minSamples: 5,
  f1Target: 0.80,
  rollbackLimit: 5,
};

// ── Signal Keywords (unchanged reference) ─────────────────────────────────────
const SIGNAL_KEYWORDS = {
  log_error: ['error:', 'exception:', 'typeerror', 'referenceerror', 'syntaxerror', 'failed'],
  perf_bottleneck: ['timeout', 'slow', 'latency', 'bottleneck', 'oom', 'out of memory'],
  deployment_issue: ['deploy failed', 'build failed', 'ci failed', 'pipeline', 'rollback'],
  recurring_error: ['same error', 'still failing', 'not fixed', 'keeps failing', 'repeatedly'],
  test_failure: ['test failed', 'test failure', 'assertion', 'expect(', 'assert.'],
  capability_gap: ['not supported', 'unsupported', 'not implemented', 'missing feature', 'not available'],
  user_feature_request: ['add feature', 'implement', 'new function', 'new module', 'please add'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function saveJson(data, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Core AutoTune Class ───────────────────────────────────────────────────────
class AutoTune {
  constructor(opts = {}) {
    Object.assign(CONFIG, opts);
    this.weights = {};
    this.thresholds = { AUTO_TRIGGER: 0.85, WARN: 0.50 };
    this.boosts = { consensusBoost: 0.15, warnBoost: 0.15 };
    this.tunedAt = null;
    this.sampleSize = 0;
    this.version = 1;
    this.rollbackQueue = [];
  }

  // ── Load existing state ──────────────────────────────────────────────────
  load() {
    if (fs.existsSync(CONFIG.outputPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(CONFIG.outputPath, 'utf8'));
        this.weights = data.keyword_weights || {};
        this.thresholds = { ...this.thresholds, ...data.signal_thresholds };
        this.boosts = { ...this.boosts, ...data.boost_params };
        this.tunedAt = data.tuned_at;
        this.sampleSize = data.sample_size || 0;
        this.version = (data.version || 0) + 1;
      } catch (e) {
        // corrupted file — start fresh
      }
    }
    // Initialize default weights if not present
    for (const [signal, keywords] of Object.entries(SIGNAL_KEYWORDS)) {
      if (!this.weights[signal]) {
        this.weights[signal] = {};
        for (const kw of keywords) {
          this.weights[signal][kw] = 1.0;
        }
      }
    }
  }

  // ── Compute TP/FP/FN/TN for a keyword ───────────────────────────────────
  // Join warn history with outcomes on session_id
  _computeKeywordEvidence(signal, keyword) {
    const warns = loadJsonl(path.join(CONFIG.dataDir, 'pretool-warn-history.jsonl'));
    const outcomes = loadJsonl(path.join(CONFIG.dataDir, 'evolver-outcomes.jsonl'));

    // Build outcome index by session_id
    const outcomesBySession = {};
    for (const o of outcomes) {
      const sid = o.session_id || (o.ts && o.ts.split('T')[0]);
      if (!sid) continue;
      if (!outcomesBySession[sid]) outcomesBySession[sid] = [];
      outcomesBySession[sid].push(o);
    }

    // For each warn matching this signal + keyword, determine TP/FP
    const evidence = [];
    for (const warn of warns) {
      if (!warn.session_id) continue;
      const sessionOutcomes = outcomesBySession[warn.session_id] || [];
      const kwLower = keyword.toLowerCase();
      const warnText = (warn.pattern + ' ' + (warn.command || '')).toLowerCase();

      if (!warnText.includes(kwLower)) continue;

      // Check if any outcome confirms this signal
      const hasOutcome = sessionOutcomes.some(o => {
        const sigs = o.signals || [];
        return sigs.includes(signal) ||
               (o.preview && o.preview.toLowerCase().includes(kwLower));
      });

      evidence.push({ occurred: true, true_positive: hasOutcome });
    }

    return evidence;
  }

  // ── Bayesian Keyword Weight ────────────────────────────────────────────────
  _computeKeywordWeight(signal, keyword) {
    const evidence = this._computeKeywordEvidence(signal, keyword);
    if (evidence.length < CONFIG.minSamples) {
      return this.weights[signal]?.[keyword] ?? 1.0;
    }

    const hits = evidence.filter(e => e.true_positive).length;
    const total = evidence.length;

    // Bayesian posterior
    const posterior = (hits + CONFIG.prior * CONFIG.priorStrength) /
                      (total + CONFIG.priorStrength);

    // Weight = base * (1 + adjustment)
    const adjustment = (posterior - CONFIG.prior) / CONFIG.prior;
    let weight = Math.max(CONFIG.minWeight,
                   Math.min(CONFIG.maxWeight, 1.0 + adjustment));

    // EMA smoothing with previous weight
    const prevWeight = this.weights[signal]?.[keyword] ?? 1.0;
    weight = CONFIG.emaAlpha * weight + (1 - CONFIG.emaAlpha) * prevWeight;

    // Change clamping
    const delta = weight - prevWeight;
    if (delta > CONFIG.maxDelta) weight = prevWeight + CONFIG.maxDelta;
    if (delta < -CONFIG.maxDelta) weight = prevWeight - CONFIG.maxDelta;

    return Math.round(weight * 1000) / 1000;
  }

  // ── Tune All Keyword Weights ─────────────────────────────────────────────
  tuneKeywordWeights() {
    for (const [signal, keywords] of Object.entries(SIGNAL_KEYWORDS)) {
      if (!this.weights[signal]) this.weights[signal] = {};
      for (const kw of keywords) {
        this.weights[signal][kw] = this._computeKeywordWeight(signal, kw);
      }
    }
  }

  // ── Threshold Tuning (Binary Search for F1) ───────────────────────────────
  tuneThresholds() {
    // Load all outcomes to build score history per signal
    const outcomes = loadJsonl(path.join(CONFIG.dataDir, 'evolver-outcomes.jsonl'));
    const warns = loadJsonl(path.join(CONFIG.dataDir, 'pretool-warn-history.jsonl'));

    for (const signal of Object.keys(SIGNAL_KEYWORDS)) {
      // Build (score, label) pairs from outcomes
      const pairs = [];
      for (const o of outcomes) {
        const sigs = o.signals || [];
        if (sigs.includes(signal)) {
          pairs.push({ score: o.score || 0.5, label: 1 });
        }
      }
      // Add negative examples (warns without matching outcome)
      for (const w of warns) {
        const warnSigs = [];
        // Infer signal from pattern
        if (w.pattern) warnSigs.push(w.pattern);
        if (warnSigs.includes(signal)) {
          // Check if there's an outcome for this session
          const hasOutcome = outcomes.some(o =>
            (o.session_id || '') === (w.session_id || '') &&
            (o.signals || []).includes(signal)
          );
          if (!hasOutcome) {
            pairs.push({ score: 0.3, label: 0 });
          }
        }
      }

      if (pairs.length < CONFIG.minSamples * 2) continue;

      // Binary search for best threshold
      let lo = 0.3, hi = 0.95;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const { precision, recall } = this._prAtThreshold(pairs, mid);
        const f1 = 2 * precision * recall / (precision + recall + 0.0001);
        const { precision: pHi } = this._prAtThreshold(pairs, mid + 0.01);
        const f1Hi = 2 * pHi * recall / (pHi + recall + 0.0001);
        if (f1Hi > f1) lo = mid;
        else hi = mid;
      }

      const best = Math.round((lo + hi) / 2 * 1000) / 1000;
      const signalKey = signal.replace(/_/g, '_');
      this.thresholds[signalKey] = best;
    }
  }

  _prAtThreshold(pairs, threshold) {
    const tp = pairs.filter(p => p.score >= threshold && p.label === 1).length;
    const fp = pairs.filter(p => p.score >= threshold && p.label === 0).length;
    const fn = pairs.filter(p => p.score < threshold && p.label === 1).length;
    const precision = tp / (tp + fp + 0.0001);
    const recall = tp / (tp + fn + 0.0001);
    return { precision, recall };
  }

  // ── Boost Parameter Tuning ────────────────────────────────────────────────
  tuneBoosts() {
    // Learn optimal consensus boost based on recurrence patterns
    const warns = loadJsonl(path.join(CONFIG.dataDir, 'pretool-warn-history.jsonl'));
    const outcomes = loadJsonl(path.join(CONFIG.dataDir, 'evolver-outcomes.jsonl'));

    // Count how often same pattern appears across sessions
    const patternSessions = {};
    for (const w of warns) {
      const p = w.pattern || 'unknown';
      if (!patternSessions[p]) patternSessions[p] = new Set();
      if (w.session_id) patternSessions[p].add(w.session_id);
    }

    // If same pattern appears in multiple sessions → higher consensus boost
    const multiSessionPatterns = Object.values(patternSessions)
      .filter(s => s.size >= 2).length;
    const totalPatterns = Object.keys(patternSessions).length;

    if (totalPatterns > 0) {
      const consensusRatio = multiSessionPatterns / totalPatterns;
      // Tune consensusBoost: base 0.15, scale with consensusRatio
      const targetBoost = Math.min(0.25, 0.10 + consensusRatio * 0.15);
      const prev = this.boosts.consensusBoost;
      this.boosts.consensusBoost = Math.round(
        CONFIG.emaAlpha * targetBoost + (1 - CONFIG.emaAlpha) * prev * 1000
      ) / 1000;
    }

    // Tune warnBoost based on repeated warnings in same session
    const sessionWarnCount = {};
    for (const w of warns) {
      if (!w.session_id) continue;
      sessionWarnCount[w.session_id] = (sessionWarnCount[w.session_id] || 0) + 1;
    }
    const avgWarns = Object.values(sessionWarnCount).reduce((a, b) => a + b, 0) /
                     Object.keys(sessionWarnCount).length || 1;

    if (avgWarns >= 2) {
      this.boosts.warnBoost = Math.min(0.25, 0.10 + avgWarns * 0.03);
    }
  }

  // ── Rollback Safety ───────────────────────────────────────────────────────
  _saveRollback() {
    this.rollbackQueue.push({
      weights: JSON.parse(JSON.stringify(this.weights)),
      thresholds: { ...this.thresholds },
      boosts: { ...this.boosts },
      version: this.version,
    });
    if (this.rollbackQueue.length > CONFIG.rollbackLimit) {
      this.rollbackQueue.shift();
    }
  }

  rollback() {
    const snapshot = this.rollbackQueue.pop();
    if (snapshot) {
      this.weights = snapshot.weights;
      this.thresholds = snapshot.thresholds;
      this.boosts = snapshot.boosts;
      this.version = snapshot.version;
    }
  }

  // ── Main Tune ────────────────────────────────────────────────────────────
  tune() {
    this.load();
    this._saveRollback();

    this.tuneKeywordWeights();
    this.tuneThresholds();
    this.tuneBoosts();

    // Count total samples
    const warns = loadJsonl(path.join(CONFIG.dataDir, 'pretool-warn-history.jsonl'));
    this.sampleSize = warns.length;

    this.tunedAt = new Date().toISOString();

    const result = {
      keyword_weights: this.weights,
      signal_thresholds: this.thresholds,
      boost_params: this.boosts,
      tuned_at: this.tunedAt,
      sample_size: this.sampleSize,
      version: this.version,
    };

    // Ensure output dir exists
    const dir = path.dirname(CONFIG.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    saveJson(result, CONFIG.outputPath);
    return result;
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  stats() {
    this.load();
    const warns = loadJsonl(path.join(CONFIG.dataDir, 'pretool-warn-history.jsonl'));
    const outcomes = loadJsonl(path.join(CONFIG.dataDir, 'evolver-outcomes.jsonl'));

    return {
      warnCount: warns.length,
      outcomeCount: outcomes.length,
      lastTuned: this.tunedAt,
      version: this.version,
      sampleSize: this.sampleSize,
      weights: this.weights,
      thresholds: this.thresholds,
      boosts: this.boosts,
    };
  }
}

export { AutoTune, CONFIG, SIGNAL_KEYWORDS };
export default AutoTune;
