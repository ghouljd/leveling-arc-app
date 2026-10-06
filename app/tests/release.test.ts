import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {analyzeCommits} from '@semantic-release/commit-analyzer';

test('Conventional Commits decide minor, patch y major, incluido !', async () => {
  for (const [message, expected] of [
    ['feat: nueva función', 'minor'], ['fix: corregir fecha', 'patch'],
    ['feat!: cambiar contrato', 'major'],
    ['fix: cambiar contrato\n\nBREAKING CHANGE: contrato incompatible', 'major'],
    ['docs: actualizar guía', null],
  ]) {
    assert.equal(await analyzeCommits({preset: 'conventionalcommits'}, {
      cwd: process.cwd(), commits: [{hash: 'test', message}], logger: {log() {}},
    }), expected);
  }
});

test('release publica el tag y un reintento no incrementa la versión', () => {
  execFileSync(process.execPath, ['tests/fixtures/release-simulation.mjs'], {stdio: 'pipe'});
});
