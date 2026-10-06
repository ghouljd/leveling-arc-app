import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const run = (cmd, args, options = {}) => execFileSync(cmd, args, {stdio: 'inherit', ...options});
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
if (git('branch', '--show-current') !== 'main') throw new Error('El pipeline solo publica main.');
if (git('status', '--porcelain')) throw new Error('Guarda todos los cambios en un commit antes de publicar.');
for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_WORKER_NAME']) {
  if (!process.env[key]) throw new Error(`Configura ${key} en el entorno antes de ejecutar el pipeline.`);
}
git('remote', 'get-url', 'origin');
run('git', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '--tags']);
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new Error('HEAD debe coincidir con origin/main. Haz push primero.');
run('npm', ['run', 'privacy']);
run('npm', ['test']);
run('node', ['scripts/release.mjs', '--local']);
const result = JSON.parse(readFileSync('release-result.json', 'utf8'));
if (!result.version) {
  // Reintentar un despliegue fallido sin crear otro tag ni incrementar versión.
  let tag;
  try { tag = git('describe', '--exact-match', '--tags', '--match', 'v[0-9]*'); } catch {
    console.log('Sin cambios publicables: no se despliega.'); process.exit(0);
  }
  run('npm', ['run', 'build'], {env: {...process.env, APP_VERSION: tag.slice(1)}});
}
run('npm', ['run', 'deploy']);
