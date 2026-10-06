import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
export async function prepare(_config, {nextRelease}) {
  execFileSync('npm', ['run', 'build'], {
    stdio: 'inherit', env: {...process.env, APP_VERSION: nextRelease.version},
  });
  writeFileSync('dist/release.json', JSON.stringify({version: nextRelease.version, commit: nextRelease.gitHead, notes: nextRelease.notes}, null, 2));
}
