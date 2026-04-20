const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateInnovationIdeas } = require('../src/ops/innovation');

describe('innovation', () => {
  const savedEnv = {};
  const envKeys = ['SKILLS_DIR', 'OPENCLAW_WORKSPACE', 'EVOLVER_REPO_ROOT'];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('returns meta idea when skills dir does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovation-test-'));
    process.env.OPENCLAW_WORKSPACE = tmpDir;
    process.env.EVOLVER_REPO_ROOT = tmpDir;
    delete require.cache[require.resolve('../src/gep/paths')];
    delete require.cache[require.resolve('../src/ops/innovation')];
    const { generateInnovationIdeas: freshGenerate } = require('../src/ops/innovation');
    const ideas = freshGenerate();
    assert.ok(Array.isArray(ideas));
    assert.ok(ideas.length >= 1);
    assert.ok(ideas.some(i => i.includes('Meta')));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates ideas based on skill categories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovation-test-'));
    const skillsDir = path.join(tmpDir, 'workspace', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    // Create some skills in different categories
    fs.writeFileSync(path.join(skillsDir, 'git-sync.js'), '');
    fs.writeFileSync(path.join(skillsDir, 'security-audit.js'), '');
    fs.writeFileSync(path.join(skillsDir, 'image-resize.js'), '');
    process.env.OPENCLAW_WORKSPACE = tmpDir;
    process.env.EVOLVER_REPO_ROOT = tmpDir;
    delete require.cache[require.resolve('../src/gep/paths')];
    delete require.cache[require.resolve('../src/ops/innovation')];
    const { generateInnovationIdeas: freshGenerate } = require('../src/ops/innovation');
    const ideas = freshGenerate();
    assert.ok(Array.isArray(ideas));
    assert.ok(ideas.length <= 3);
    // Should include ideas for under-represented categories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns meta idea when no skills exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'innovation-test-'));
    const skillsDir = path.join(tmpDir, 'workspace', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    process.env.OPENCLAW_WORKSPACE = tmpDir;
    process.env.EVOLVER_REPO_ROOT = tmpDir;
    delete require.cache[require.resolve('../src/gep/paths')];
    delete require.cache[require.resolve('../src/ops/innovation')];
    const { generateInnovationIdeas: freshGenerate } = require('../src/ops/innovation');
    const ideas = freshGenerate();
    assert.ok(ideas.some(i => i.includes('Meta') || i.includes('performance')));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
