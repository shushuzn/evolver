#!/usr/bin/env node
/**
 * signalRouter.js
 * 双通道信号路由: Evolver errsig ↔ OMC Fragment consensus
 *
 * 通道A (Evolver): errsig:TypeError, log_error, recurring_error 等结构化信号
 * 通道B (OMC):     fragment × N → consensus 置信度
 *
 * 融合公式: F = max(signal_confidence, consensus_confidence)
 *   F >= 0.85 → auto-trigger
 *   F >= 0.5  → warn + log
 *   F < 0.5   → silent log
 */

const fs = require('fs');
const path = require('path');

// Evolver 标准信号 (来自 genes.json signals_match)
const GEP_SIGNALS = [
  'error', 'exception', 'failed', 'unstable',           // gene_gep_repair_from_errors
  'protocol', 'gep', 'prompt', 'audit', 'reusable',     // gene_gep_optimize_prompt_and_assets
  'user_feature_request', 'user_improvement_suggestion', // gene_gep_innovate_from_opportunity
  'perf_bottleneck', 'capability_gap', 'stable_success_plateau', 'external_opportunity',
];

// errsig 解析
function parseErrsig(signal) {
  if (!signal.startsWith('errsig:')) return null;
  const parts = signal.slice(7).split(':');
  return { type: parts[0] || 'Unknown', message: parts.slice(1).join(':') || '' };
}

// 通道A: Evolver 信号处理 (confidence = 1.0)
function processEvolverSignal(signal) {
  if (signal.startsWith('errsig:')) {
    const err = parseErrsig(signal);
    return {
      channel: 'evolver',
      signal,
      type: err?.type || 'Unknown',
      message: err?.message || '',
      confidence: 1.0,
      action: 'gene_match',
      geneId: 'gene_gep_repair_from_errors',
    };
  }
  if (GEP_SIGNALS.includes(signal)) {
    return {
      channel: 'evolver',
      signal,
      confidence: 1.0,
      action: 'gene_match',
    };
  }
  return null;
}

// 通道B: OMC Fragment 处理 (confidence = f(entries))
// OMC fragment 格式: { skill: string, pattern: string, count: number, lastSeen: timestamp }
function processOmcFragment(fragment) {
  const { skill, pattern, count = 1 } = fragment;
  // OMC consensus 公式近似
  const confidence = Math.min(0.9, 0.5 + count * 0.1);
  return {
    channel: 'omc',
    skill,
    pattern,
    count,
    confidence,
    action: confidence >= 0.85 ? 'auto_approve' : 'warn',
  };
}

// 融合路由
function fuse(signals, fragments) {
  const results = [];
  const seen = new Set();

  // 通道A 结果
  for (const sig of signals) {
    const r = processEvolverSignal(sig);
    if (r) {
      const key = r.signal || r.type;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(r);
      }
    }
  }

  // 通道B 结果
  for (const frag of fragments) {
    const r = processOmcFragment(frag);
    results.push(r);
  }

  // 融合置信度
  const fused = {};
  for (const r of results) {
    const key = r.signal || r.skill || r.type;
    if (!fused[key]) {
      fused[key] = { ...r, sources: [r.channel] };
    } else {
      fused[key].confidence = Math.max(fused[key].confidence, r.confidence);
      fused[key].sources.push(r.channel);
    }
  }

  // 触发决策
  for (const [key, item] of Object.entries(fused)) {
    if (item.confidence >= 0.85) {
      item.decision = 'AUTO_TRIGGER';
    } else if (item.confidence >= 0.5) {
      item.decision = 'WARN';
    } else {
      item.decision = 'LOG';
    }
  }

  return Object.values(fused);
}

// 写入 candidates.jsonl
function appendCandidate(signal, fusedResult) {
  const candidate = {
    type: 'CapabilityCandidate',
    id: `cand_${Date.now().toString(16)}`,
    title: signal,
    source: 'signalRouter',
    created_at: new Date().toISOString(),
    signals: [signal],
    fused: fusedResult,
    decision: fusedResult.decision,
  };
  const dir = path.join(__dirname, '../../assets/gep');
  const file = path.join(dir, 'candidates.jsonl');
  fs.appendFileSync(file, JSON.stringify(candidate) + '\n');
  return candidate;
}

// CLI 模式: 接收 stdin JSON
if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { inputData += chunk; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(inputData.trim() || '{}');
      const signals = input.signals || [];
      const fragments = input.fragments || [];
      const results = fuse(signals, fragments);

      // 自动触发高置信度
      for (const r of results) {
        if (r.decision === 'AUTO_TRIGGER' && r.channel === 'evolver') {
          appendCandidate(r.signal, r);
        }
      }

      process.stdout.write(JSON.stringify({ results, fusedCount: results.length }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ error: e.message }));
    }
  });
}

module.exports = { fuse, processEvolverSignal, processOmcFragment, parseErrsig };
