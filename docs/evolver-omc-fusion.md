# Evolver × OMC 融合架构设计

## 现状对比

| 维度 | Evolver | OMC |
|------|---------|-----|
| 决策机制 | Protocol-driven (GEP) | Consensus-driven (碎片聚合) |
| 信号类型 | errsig:TypeError, log_error 等结构化标签 | PreToolUse warn → PostToolUse reflect 碎片 |
| 知识单元 | Gene / Capsule | SKILL.md / hook 文件 |
| 演化触发 | 固定阈值 + 重复次数检测 | 动态 consensus (entries × 0.1 + 5%) |
| 修复验证 | validate-modules.js + validate-suite.js | 手动验证 |
| 记忆 | events.jsonl + candidates.jsonl | notepad.md + wiki |

## 融合方案

### 核心思路
Evolver 的 **errsig 信号层** + OMC 的 **碎片 consensus 机制** = 更早检测 + 更准判断

### 融合模块: SignalRouter

```
UserAction
    ↓
[Evolver errsig 检测]          [OMC Fragment 检测]
    ↓                              ↓
signal:errsig:XXX           fragment × N → consensus
    ↓                              ↓
Gene match                    Skill auto-approve
    ↓                              ↓
┌─────────────┬──────────────────────────────┐
│  signal     │  consensus                   │
│  priority   │  confidence                  │
│  (certain)  │  (uncertain → 需要更多碎片)  │
└─────────────┴──────────────────────────────┘
    ↓
融合决策
```

### 关键设计

#### 1. 双通道信号输入
- **通道A (Evolver)**: `errsig:TypeError`, `log_error`, `recurring_error`
  → 直接触发 gene match，confidence = 1.0
- **通道B (OMC)**: PreToolUse warn fragments
  → 走 consensus 聚合，confidence = f(entries)

#### 2. Confidence 融合公式
```
F = max(signal_confidence, consensus_confidence)
if (F >= 0.85) → auto-trigger
else if (F >= 0.5) → warn + log
else → silent log
```

#### 3. 知识单元统一
- **Gene** → 映射为 OMC skill 文件
- **Capsule** → 映射为 skill 的 metadata
- **EvolutionEvent** → 映射为 notepad.md 条目

#### 4. OMC Skill 文件扩展
```yaml
# OMC skill (已有)
---
name: xxx
triggers: [bash:rm -rf, git:push --force]
---

# 扩展: 添加 evolver 基因
evolution:
  gene_id: gene_gep_repair_from_errors
  signals_match: [error, exception]
  validation: node scripts/validate-modules.js ./src/gep/
```

### 实施步骤

| 阶段 | 状态 | 内容 | 难度 |
|------|------|------|------|
| ① | ✅ | SignalRouter 模块（src/gep/signalRouter.js）+ 融合 hook（evolver-signal-router.js） | 中 |
| ② | ✅ | settings.json PostToolUse 链已注册 evolver-signal-router.js | 易 |
| ③ | ✅ | OMC skill fragment 添加 `evolution:` 字段（rm-rf, git-clean-fd 已更新） | 易 |
| ④ | ✅ | confidence 融合公式 + 双通道触发逻辑 | 中 |
| ⑤ | ✅ | eventBridge.js 双向同步（Evolver events.jsonl ↔ OMC notepad.md） | 中 |
| ⑥ | 待做 | 端到端测试：用 TypeError 触发修复，验证双通道协同 | 难 |

### 已验证
- `errsig:TypeError` → confidence=1.0 → AUTO_TRIGGER
- OMC fragment count=4 → confidence=0.9 → AUTO_TRIGGER
- 双通道同时触发 → 融合结果写入 candidates.jsonl

## 参考文件
- Evolver: `src/gep/signals.js`, `src/gep/learningSignals.js`
- OMC hooks: `~/.claude/hooks/evolver-*.js`
- OMC consensus: `hook-self-improve` skill
