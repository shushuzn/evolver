#!/usr/bin/env node
/**
 * tune-evolver.mjs — CLI runner for AutoTune
 * Usage: node scripts/tune-evolver.mjs [--stats]
 */
import { AutoTune } from '../src/ops/autotune.js';

const args = process.argv.slice(2);
const isStats = args.includes('--stats');

const tuner = new AutoTune();

if (isStats) {
  const s = tuner.stats();
  console.log(JSON.stringify(s, null, 2));
} else {
  const result = tuner.tune();
  console.log(JSON.stringify(result, null, 2));
}
