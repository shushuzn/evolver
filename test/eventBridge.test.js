const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  parseNotepadEntries,
  parseEvolverEvents,
  omcToEvolverEvent,
  evolverToOmcEntry,
} = require('../src/gep/eventBridge');

describe('parseNotepadEntries', () => {
  it('parses evolver section entries from notepad markdown', () => {
    const content = [
      '# OMC Notepad',
      '',
      '### [Evolver] gene_gep_repair_from_errors | errsig:TypeError | 2026-04-20T10:00:00Z',
      '',
      'Repaired TypeError in test-signal.js',
      '',
    ].join('\n');
    const entries = parseNotepadEntries(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].geneId, 'gene_gep_repair_from_errors');
    assert.equal(entries[0].signal, 'errsig:TypeError');
  });

  it('returns empty array for content without evolver entries', () => {
    const content = '# OMC Notepad\n\nSome random note\n';
    assert.equal(parseNotepadEntries(content).length, 0);
  });
});

describe('parseEvolverEvents', () => {
  it('parses JSONL format events', () => {
    const content = [
      '{"type":"EvolutionEvent","geneId":"gene_repair","timestamp":"2026-04-20T10:00:00Z"}',
      '{"type":"EvolutionEvent","geneId":"gene_innovate","timestamp":"2026-04-20T11:00:00Z"}',
    ].join('\n');
    const events = parseEvolverEvents(content);
    assert.equal(events.length, 2);
    assert.equal(events[0].geneId, 'gene_repair');
    assert.equal(events[1].geneId, 'gene_innovate');
  });

  it('skips invalid JSON lines', () => {
    const content = [
      '{"type":"EvolutionEvent","geneId":"gene_repair"}',
      'not valid json',
      '{"type":"EvolutionEvent","geneId":"gene_innovate"}',
    ].join('\n');
    const events = parseEvolverEvents(content);
    assert.equal(events.length, 2);
  });

  it('returns empty array for empty content', () => {
    assert.equal(parseEvolverEvents('').length, 0);
    assert.equal(parseEvolverEvents(null).length, 0);
  });
});

describe('omcToEvolverEvent', () => {
  it('converts OMC entry to Evolver event format', () => {
    const omc = {
      geneId: 'gene_gep_repair_from_errors',
      signal: 'errsig:TypeError',
      date: '2026-04-20T10:00:00Z',
      body: 'Fixed TypeError in test.js',
    };
    const event = omcToEvolverEvent(omc);
    assert.equal(event.type, 'EvolutionEvent');
    assert.equal(event.geneId, 'gene_gep_repair_from_errors');
    assert.equal(event.signal, 'errsig:TypeError');
    assert.equal(event.timestamp, '2026-04-20T10:00:00Z');
    assert.equal(event.body, 'Fixed TypeError in test.js');
    assert.equal(event.source, 'omc_bridge');
  });
});

describe('evolverToOmcEntry', () => {
  it('converts Evolver event to OMC markdown entry', () => {
    const event = {
      geneId: 'gene_gep_repair_from_errors',
      signal: 'errsig:TypeError',
      timestamp: '2026-04-20T10:00:00Z',
      body: 'Repaired TypeError',
    };
    const entry = evolverToOmcEntry(event);
    assert.ok(entry.includes('[Evolver]'));
    assert.ok(entry.includes('gene_gep_repair_from_errors'));
    assert.ok(entry.includes('errsig:TypeError'));
    assert.ok(entry.includes('Repaired TypeError'));
  });
});
