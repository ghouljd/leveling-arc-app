# Winter Arc

PWA con React, Vite y TypeScript. Persistencia local con Dexie y sincronización con Supabase. Requiere Node.js 24.

```sh
npm ci
cp .env.example .env.local
# Configurar URL y clave publicable propias en .env.local.
npm run dev
npm test
npm run build
```

## Versionado

Único trunk `main`, MVP base `v1.0.0`. Conventional Commits y semantic-release:

| Commit | Incremento |
| --- | --- |
| `feat:` | minor |
| `fix:` / `perf:` | patch |
| `feat!:` / `BREAKING CHANGE:` | major |
| `docs:` / `test:` / `chore:` sin BC | ninguno |

Los tags son la fuente de verdad. No editar package.json para cada release. El menú More incorpora la versión calculada al construir. Los builds locales muestran además la distancia al tag y el hash.

## Despliegue

GitHub Actions verifica cada PR. En main ejecuta pruebas, calcula release, construye, publica el tag y despliega los activos con Wrangler. Configurar todos estos valores como **Actions secrets**, nunca variables públicas ni archivos versionados:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_WORKER_NAME`
- `APP_RULES_CONTENT`: contenido de reglas de la aplicación en inglés; se incorpora únicamente al build desplegado. En desarrollo local se puede leer desde la documentación operativa excluida de Git.

Permitir al workflow escribir tags; proteger main contra force-push y borrado. El token de Cloudflare necesita Workers Scripts: Edit limitado a la cuenta correspondiente. Desactivar cualquier otro publicador automático para evitar despliegues concurrentes.

La verificación de PR usa configuración ficticia sin secrets. La publicación no sube dist ni artifacts de producción al repositorio ni expone la salida de Wrangler en logs públicos. `npm run privacy` revisa todos los archivos e historial versionados y bloquea patrones de credenciales u orígenes de infraestructura.

Alternativa local con origin configurado, main limpia y sincronizada, `.env.local` y credenciales exportadas:

```sh
npm run pipeline
```

No ejecutar el publicador local en paralelo con Actions. `npm run release -- --local --dry-run` calcula el incremento sin publicar. Si Cloudflare falla después de crear el tag, repetir el workflow antes de agregar commits: reconstruye la misma versión y reintenta sin incrementar. Para rollback usar el panel privado de Cloudflare, sin mover tags publicados. Las migraciones de `supabase/migrations` se aplican explícitamente antes de las entregas que las requieran.

## Privacidad

El repositorio contiene código y pruebas con datos sintéticos. Configuraciones reales, documentación operativa, capturas, entregas y registros se conservan localmente y quedan fuera de Git. La recuperación de contraseña usa el origen actual; configurar la allowlist de redirecciones en el servicio de autenticación.

Una PWA conectada directamente a Supabase incorpora su URL y clave publicable al JavaScript de producción para poder funcionar. Mantenerlas fuera del repositorio no las oculta a quienes acceden a la app. Nunca configurar una clave administrativa en el frontend. Los datos requieren autenticación y políticas de acceso del backend.

Las herramientas de desarrollo reportan advisories transitivos que `npm audit fix` no resuelve sin cambios incompatibles; esos paquetes no forman parte del frontend publicado. No se aplicó `npm audit fix --force`.
