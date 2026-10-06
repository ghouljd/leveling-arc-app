import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
const root = git('rev-parse', '--show-toplevel').trim();
const patterns = [
  /\b[a-z0-9][a-z0-9.-]*\.(?:supabase\.co|workers\.dev|pages\.dev)\b/i,
  /\bsb_(?:publishable|secret)_[a-zA-Z0-9_-]{16,}/,
  /\beyJ[a-zA-Z0-9_-]{16,}\.[a-zA-Z0-9_-]{16,}\.[a-zA-Z0-9_-]{16,}/,
  /\b(?:gh[pousr]_[a-zA-Z0-9]{24,}|github_pat_[a-zA-Z0-9_]{24,}|AKIA[A-Z0-9]{16})\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const forbiddenPath = /(?:^|\/)(?:Docs|Entregas|\.private|node_modules|dist|\.wrangler)(?:\/|$)|(?:^|\/)\.env(?!\.example$)|\.(?:pem|key)$/;
const privateValues = [];
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_WORKER_NAME']) {
  const value = process.env[key];
  if (value && value.length >= 6) privateValues.push(value);
}
const localConfig = resolve(root, 'app/.env.local');
if (existsSync(localConfig)) {
  for (const value of Object.values(parseEnv(readFileSync(localConfig, 'utf8')))) {
    if (value.length >= 12) privateValues.push(value);
    try {const url = new URL(value); privateValues.push(url.hostname.split('.')[0]);} catch {}
  }
}
let issues = 0;
const report = (label, reason) => {console.error(`Revisión privada requerida: ${label} (${reason}).`); issues++;};
const check = (content, label) => {
  if (patterns.some(pattern => pattern.test(content)) || privateValues.some(value => content.includes(value))) report(label, 'valor sensible');
};
for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (forbiddenPath.test(path)) report(path, 'archivo privado versionado');
  const absolute = resolve(root, path);
  if (existsSync(absolute)) check(readFileSync(absolute, 'utf8'), path);
}
const seen = new Set();
for (const commit of git('rev-list', '--all').trim().split('\n').filter(Boolean)) {
  check(git('show', '-s', '--format=%B%n%an%n%ae%n%cn%n%ce', commit), `commit ${commit.slice(0, 8)}`);
  for (const entry of git('ls-tree', '-r', '-z', commit).split('\0').filter(Boolean)) {
    const [metadata, path] = entry.split('\t');
    const [, type, hash] = metadata.split(' ');
    if (forbiddenPath.test(path)) report(`${commit.slice(0, 8)}:${path}`, 'archivo privado en historial');
    if (type === 'blob' && !seen.has(hash)) {seen.add(hash); check(git('cat-file', 'blob', hash), `${commit.slice(0, 8)}:${path}`);}
  }
}
if (issues) process.exit(1);
console.log('Privacidad verificada en archivos e historial Git.');
