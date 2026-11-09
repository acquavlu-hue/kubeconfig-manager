import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const shared = { bundle: true, platform: 'node', target: 'node22', sourcemap: true, logLevel: 'info' };
await Promise.all([
  build({ ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', format: 'cjs', external: ['electron'] }),
  build({ ...shared, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', format: 'cjs', external: ['electron'] }),
  build({ ...shared, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.mjs', format: 'esm', banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } }),
]);
await chmod('dist/cli.mjs', 0o755);
await import('./icons.mjs');
