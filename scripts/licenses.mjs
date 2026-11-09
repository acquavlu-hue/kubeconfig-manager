import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const { packages } = JSON.parse(await readFile('package-lock.json', 'utf8'));
const reviewedBundled = new Set(['MIT', 'ISC']);
// Build tools can contribute helpers to the bundles even though npm marks them dev-only.
const helpers = new Set(['node_modules/esbuild', 'node_modules/vite', 'node_modules/rolldown']);
const inventory = Object.entries(packages).filter(([path]) => path).map(([path, entry]) => {
  if (typeof entry.license !== 'string' || !entry.license.trim() || /UNLICENSED|SEE LICENSE IN/i.test(entry.license)) {
    throw new Error(`Licenza da verificare nel lockfile: ${path}`);
  }
  const name = entry.name ?? path.split('node_modules/').at(-1);
  const shipped = !entry.dev || helpers.has(path) || path === 'node_modules/electron';
  if (shipped && !reviewedBundled.has(entry.license)) throw new Error(`Licenza da rivedere per ${name}: ${entry.license}`);
  return { path, name, version: entry.version, license: entry.license, scope: shipped ? 'distribution' : 'build' };
});

const electron = packages['node_modules/electron'].version;
const output = 'dist/licenses';
await mkdir(output, { recursive: true });
const notices = ['KubeContext — Third-party notices',
  'See DEPENDENCIES.json for the npm lockfile inventory.',
  'Electron embeds Chromium and Node.js, including FFmpeg (see LICENSES.chromium.html).',
  `Electron source tree and build configuration: https://github.com/electron/electron/tree/v${electron}`,
  'Corresponding source information and distribution notes: https://github.com/acquavlu-hue/kubeconfig-manager/blob/main/docs/licenze.md'];

for (const entry of inventory.filter(item => item.scope === 'distribution')) {
  const manifest = JSON.parse(await readFile(join(entry.path, 'package.json'), 'utf8'));
  if (manifest.version !== entry.version || manifest.license !== entry.license) {
    throw new Error(`Il pacchetto installato non corrisponde al lockfile: ${entry.path}. Esegui npm ci.`);
  }
  const files = (await readdir(entry.path, { withFileTypes: true }))
    .filter(file => file.isFile() && /^(?:licen[cs]es?|copying|notice|copyright|third[-_]party[-_]licen[cs]es?)(?:[._-]|$)/i.test(file.name))
    .map(file => join(entry.path, file.name)).sort();
  if (!files.length) throw new Error(`Testo di licenza assente in ${entry.path}.`);
  notices.push(`${entry.name} ${entry.version} (${entry.license})`);
  for (const file of files) notices.push(`--- ${basename(file)} ---\n${(await readFile(file, 'utf8')).trimEnd()}`);
}

const runtime = 'node_modules/electron/dist';
if ((await readFile(join(runtime, 'version'), 'utf8')).trim() !== electron) {
  throw new Error(`Runtime Electron diverso dal lockfile (${electron}).`);
}
await copyFile(join(runtime, 'LICENSE'), join(output, 'LICENSE.electron.txt'));
await copyFile(join(runtime, 'LICENSES.chromium.html'), join(output, 'LICENSES.chromium.html'));
const projectLicense = join(output, 'LICENSE.KubeContext.txt');
try { await copyFile('LICENSE', projectLicense); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await rm(projectLicense, { force: true });
}
await writeFile(join(output, 'THIRD-PARTY-NOTICES.txt'), `${notices.join('\n\n')}\n`);
await writeFile(join(output, 'DEPENDENCIES.json'), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Licenze npm: ${inventory.length} voci, ${inventory.filter(item => item.scope === 'distribution').length} avvisi di distribuzione. Electron ${electron}.`);
