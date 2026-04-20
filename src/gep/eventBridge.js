#!/usr/bin/env node
/**
 * eventBridge.js
 * Evolver ↔ OMC 记忆格式双向桥接
 *
 * Evolver events.jsonl ←→ OMC notepad.md
 * Gene ←→ Skill Fragment
 *
 * 桥接格式:
 *   OMC entry:  ### [Evolver] {gene_id} | {signal} | {date}
 *   Evolver event: standard JSONL
 */

const fs = require('fs');
const path = require('path');

const NOTPAD_PATH = process.env.OMC_NOTEPAD || 'D:/OpenClaw/workspace/.omc/notepad.md';
const EVENTS_PATH = path.join(__dirname, '../../assets/gep/events.jsonl');

// 解析 OMC notepad 中的 evolver 条目
function parseNotepadEntries(content) {
  const entries = [];
  const regex = /### \[Evolver\] (.+?) \| (.+?) \| (.+?)\n([\s\S]*?)(?=### \[|$)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    entries.push({
      geneId: match[1].trim(),
      signal: match[2].trim(),
      date: match[3].trim(),
      body: match[4].trim(),
    });
  }
  return entries;
}

// 解析 evolver event JSONL
function parseEvolverEvents(content) {
  if (!content || !content.trim()) return [];
  return content.trim().split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// OMC entry → Evolver event
function omcToEvolverEvent(omcEntry) {
  return {
    type: 'EvolutionEvent',
    geneId: omcEntry.geneId,
    signal: omcEntry.signal,
    timestamp: omcEntry.date,
    source: 'omc_bridge',
    body: omcEntry.body,
  };
}

// Evolver event → OMC entry markdown
function evolverToOmcEntry(event) {
  const lines = [
    `### [Evolver] ${event.geneId || event.signal} | ${event.signal || event.geneId} | ${event.timestamp || new Date().toISOString()}`,
    '',
    event.body || JSON.stringify(event, null, 2),
    '',
  ].join('\n');
  return lines;
}

// 同步 OMC notepad → Evolver events
function syncOmcToEvolver() {
  try {
    if (!fs.existsSync(NOTPAD_PATH)) return { added: 0 };
    const content = fs.readFileSync(NOTPAD_PATH, 'utf8');
    const entries = parseNotepadEntries(content);

    if (!fs.existsSync(EVENTS_PATH)) {
      fs.writeFileSync(EVENTS_PATH, '');
    }
    const existing = fs.readFileSync(EVENTS_PATH, 'utf8');
    const existingIds = new Set(parseEvolverEvents(existing).map(e => `${e.geneId}:${e.signal}:${e.timestamp}`));

    let added = 0;
    for (const entry of entries) {
      const event = omcToEvolverEvent(entry);
      const key = `${event.geneId}:${event.signal}:${event.timestamp}`;
      if (!existingIds.has(key)) {
        fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n');
        added++;
      }
    }
    return { added, total: entries.length };
  } catch (e) {
    return { error: e.message };
  }
}

// 同步 Evolver events → OMC notepad
function syncEvolverToOmc() {
  try {
    if (!fs.existsSync(EVENTS_PATH)) return { added: 0 };
    const events = parseEvolverEvents(fs.readFileSync(EVENTS_PATH, 'utf8'));

    if (!fs.existsSync(NOTPAD_PATH)) {
      fs.writeFileSync(NOTPAD_PATH, '# OMC Notepad\n\n');
    }
    const content = fs.readFileSync(NOTPAD_PATH, 'utf8');

    const existingSignals = new Set(parseNotepadEntries(content).map(e => `${e.geneId}:${e.signal}`));
    let added = 0;

    for (const event of events) {
      const key = `${event.geneId || event.signal}:${event.signal || event.geneId}`;
      if (!existingSignals.has(key)) {
        const entry = evolverToOmcEntry(event);
        fs.appendFileSync(NOTPAD_PATH, entry);
        added++;
      }
    }
    return { added, total: events.length };
  } catch (e) {
    return { error: e.message };
  }
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2] || 'bidirectional';
  if (cmd === 'omc-to-evolver') {
    console.log(JSON.stringify(syncOmcToEvolver()));
  } else if (cmd === 'evolver-to-omc') {
    console.log(JSON.stringify(syncEvolverToOmc()));
  } else {
    const r1 = syncOmcToEvolver();
    const r2 = syncEvolverToOmc();
    console.log(JSON.stringify({ omcToEvolver: r1, evolverToOmc: r2 }));
  }
}

module.exports = {
  parseNotepadEntries,
  parseEvolverEvents,
  omcToEvolverEvent,
  evolverToOmcEntry,
  syncOmcToEvolver,
  syncEvolverToOmc,
};
