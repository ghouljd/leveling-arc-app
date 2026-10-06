import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import semanticRelease from 'semantic-release';


  const base = mkdtempSync(join(tmpdir(), 'winter-release-test-'));
  const remote = join(base, 'remote.git');
  const cwd = join(base, 'work');
  const git = (args, path = base) => execFileSync('git', args, {
    cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  try {
    git(['init', '--bare', '--initial-branch=main', remote]); git(['init', '-b', 'main', cwd]);
    git(['config', 'user.name', 'Release Test'], cwd);
    git(['config', 'user.email', 'release@example.invalid'], cwd);
    git(['commit', '--allow-empty', '-m', 'chore: baseline'], cwd);
    git(['tag', 'v1.0.0'], cwd); git(['remote', 'add', 'origin', remote], cwd);
    git(['push', '-u', 'origin', 'main', '--tags'], cwd);
    git(['commit', '--allow-empty', '-m', 'feat: release pipeline'], cwd);
    git(['push'], cwd);
    let prepared = '';
    const options = {
      branches: ['main'], tagFormat: 'v${version}', ci: false,
      repositoryUrl: pathToFileURL(remote).href,
      plugins: [
        [join(process.cwd(), 'node_modules/@semantic-release/commit-analyzer/index.js'), {preset: 'conventionalcommits'}],
        [join(process.cwd(), 'node_modules/@semantic-release/release-notes-generator/index.js'), {preset: 'conventionalcommits'}],
        {prepare(_config, context) {prepared = context.nextRelease.version;}},
      ],
    };
    const context = {cwd, env: {...process.env, GITHUB_ACTIONS: '', CI: '', GITHUB_TOKEN: '', GH_TOKEN: ''}};
    const result = await semanticRelease(options, context);
    assert.equal(result.nextRelease.version, '1.1.0');
    assert.equal(prepared, '1.1.0');
    assert.equal(git(['tag', '--list', 'v1.1.0'], cwd), 'v1.1.0');
    assert.equal(git(['tag', '--list', 'v1.1.0'], remote), 'v1.1.0');
    assert.equal(await semanticRelease(options, context), false);
  } finally {rmSync(base, {recursive: true, force: true});}
