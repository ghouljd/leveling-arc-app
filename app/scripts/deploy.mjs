import {execFileSync} from 'node:child_process';
const dryRun = process.argv.includes('--dry-run');
const name = process.env.CLOUDFLARE_WORKER_NAME;
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Configura CLOUDFLARE_WORKER_NAME en el entorno.');
if (!dryRun && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) {
  throw new Error('Configura las credenciales de Cloudflare en el entorno.');
}
try {
  // Wrangler imprime el origen y datos de cuenta. No trasladar su salida a logs públicos.
  execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--name', name, ...(dryRun ? ['--dry-run'] : [])], {
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024,
    env: {...process.env, WRANGLER_SEND_METRICS: 'false'},
  });
  console.log(dryRun ? 'Configuración de despliegue validada.' : 'Despliegue completado.');
} catch {
  console.error('Cloudflare no pudo completar el despliegue. Revisa permisos y configuración desde su panel privado.');
  process.exitCode = 1;
}
