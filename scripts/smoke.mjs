import { _electron as electron } from 'playwright-core';
import { access, mkdtemp, writeFile, readFile, realpath, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const root = await realpath(await mkdtemp(join(tmpdir(), 'kcm-desktop-')));
const path = join(root, 'config');
const names = ['development-eu', 'production-eu', 'staging-us', 'local-kind'];
await writeFile(path, JSON.stringify({
  apiVersion: 'v1', kind: 'Config',
  clusters: names.map((name, index) => ({ name: `${name}-cluster`, cluster: { server: `https://${index === 3 ? '127.0.0.1:6443' : `api.${name}.example.com:6443`}` } })),
  users: [{ name: 'platform-user', user: { token: 'FAKE-SMOKE-TEST-TOKEN' } }],
  contexts: names.map((name, index) => ({ name, context: { cluster: `${name}-cluster`, user: 'platform-user', namespace: ['platform', 'payments', 'staging', 'default'][index] } })),
  'current-context': 'development-eu',
}));
const environment = { ...process.env, KCM_KUBECONFIG: path, KCM_SETTINGS: join(root, 'settings.json') };
const tenantDirectory = join(root, 'tenant-acme');
await mkdir(join(tenantDirectory, 'eu'), { recursive: true });
const tenantPath = join(tenantDirectory, 'eu', 'config.yaml');
const tenantConfig = {
  apiVersion: 'v1', kind: 'Config',
  clusters: [{ name: 'acme', cluster: { server: 'https://api.acme.example.com:6443' } }],
  users: [{ name: 'acme', user: { token: 'FAKE-TENANT-TOKEN' } }],
  contexts: ['development-eu', 'tenant-prod'].map(name => ({ name, context: { cluster: 'acme', user: 'acme', namespace: 'tenant-app' } })),
  'current-context': '',
};
await writeFile(tenantPath, JSON.stringify(tenantConfig));
delete environment.ELECTRON_RUN_AS_NODE;
const browserProfile = join(root, 'electron-profile');
await mkdir(browserProfile);
const desktop = await electron.launch({
  ...(process.env.KCM_EXECUTABLE ? { executablePath: process.env.KCM_EXECUTABLE } : {}),
  args: [...(process.env.KCM_EXECUTABLE ? [] : ['.']), `--user-data-dir=${browserProfile}`], cwd: resolve('.'), env: environment, timeout: 30000,
}).catch(async error => { await rm(root, { recursive: true, force: true }); throw error; });
try {
  const page = await desktop.firstWindow();
  await page.emulateMedia({ colorScheme: null });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'I tuoi contesti.' }).waitFor();
  await page.getByRole('button', { name: 'Aggiungi ai preferiti production-eu' }).click();
  await page.locator('.row-content').filter({ hasText: 'production-eu' }).click();
  await page.getByRole('button', { name: 'Attiva contesto', exact: true }).click();
  await page.locator('.current-info h2').filter({ hasText: 'production-eu' }).waitFor();
  assert.equal(parse(await readFile(path, 'utf8'))['current-context'], 'production-eu');

  // A real CLI invocation must become visible in the already-running desktop.
  execFileSync(process.execPath, ['dist/cli.mjs', 'use', 'staging-us'], { env: environment });
  await page.locator('.current-info h2').filter({ hasText: 'staging-us' }).waitFor();
  await page.getByRole('button', { name: 'Aggiungi contesto', exact: true }).click();
  await page.getByRole('tab', { name: 'Crea contesto' }).click();
  await page.getByLabel('Nome contesto', { exact: true }).fill('e2e-created');
  await page.getByLabel('API server', { exact: true }).fill('https://e2e.example.com:6443');
  await page.getByRole('button', { name: 'Crea contesto', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok(parse(await readFile(path, 'utf8')).contexts.some(context => context.name === 'e2e-created'));
  assert.equal(parse(await readFile(path, 'utf8'))['current-context'], 'staging-us');

  // Invalid pasted input gives a useful error and keeps the modal open.
  await page.getByRole('button', { name: 'Aggiungi contesto', exact: true }).click();
  await page.getByRole('tab', { name: 'Incolla YAML' }).click();
  await page.getByLabel('Contenuto kubeconfig').fill('apiVersion: [invalid');
  await page.getByRole('button', { name: 'Importa contesti', exact: true }).click();
  await page.locator('.modal-error').waitFor();
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();

  // Tray, sandbox, IPC boundaries and the global shortcut are real Electron surfaces.
  const native = await desktop.evaluate(({ app, BrowserWindow, globalShortcut }) => {
    const main = BrowserWindow.getAllWindows()[0];
    const prefs = main.webContents.getLastWebPreferences();
    // Closing is intercepted only while the actual tray instance is available.
    main.close();
    const trayKeepsWindow = !main.isDestroyed() && !main.isVisible();
    main.show();
    return { trayKeepsWindow, shortcut: globalShortcut.isRegistered('CommandOrControl+Shift+K'), sandbox: prefs.sandbox, isolated: prefs.contextIsolation, node: prefs.nodeIntegration, appName: app.name };
  });
  assert.equal(native.trayKeepsWindow, true); assert.equal(native.sandbox, true); assert.equal(native.isolated, true); assert.equal(native.node, false);
  const leaked = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process }));
  assert.deepEqual(leaked, { require: 'undefined', process: 'undefined' });

  await mkdir('artifacts', { recursive: true });
  await page.locator('.toast .icon-button').click();
  await page.locator('.row-content').filter({ hasText: 'staging-us' }).click();
  await page.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/desktop.png' });
  await page.getByRole('button', { name: 'Aggiungi contesto', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/add-context.png' });
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await page.getByRole('heading', { name: 'Connetteremo il tuo Vault.' }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/vault.png' });

  // Link a real client directory through the native dialog + folder form.
  await page.getByRole('button', { name: /^Contesti/ }).click();
  await desktop.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, tenantDirectory);
  await page.locator('.heading-actions').getByRole('button', { name: 'Collega cartella', exact: true }).click();
  await page.getByLabel('Nome cliente o tenant', { exact: true }).fill('Tenant Acme');
  await page.getByRole('button', { name: 'Sfoglia…', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Collega cartella', exact: true }).click();
  await page.getByRole('heading', { name: 'Tenant Acme.', exact: true }).waitFor();
  assert.equal(await page.locator('.context-row').count(), 2);
  const standardBefore = await readFile(path, 'utf8');
  await page.locator('.row-content').filter({ hasText: 'development-eu' }).click();
  if (process.platform === 'darwin') {
    // Exercise the actual desktop IPC and launcher. Replace only the OS handoff
    // with a headless run of that same launcher, so the test opens no extra window.
    const capture = join(root, 'shell-observed');
    const tenantBefore = await readFile(tenantPath, 'utf8');
    const settingsBefore = await readFile(environment.KCM_SETTINGS, 'utf8');
    await desktop.evaluate((_, capturePath) => {
      const childProcess = process.getBuiltinModule('node:child_process');
      const originalSpawn = childProcess.spawn;
      globalThis.restoreKcmSmokeSpawn = () => { childProcess.spawn = originalSpawn; delete globalThis.restoreKcmSmokeSpawn; };
      childProcess.spawn = (command, args, options) => {
        if (command !== '/usr/bin/open' || args[1] !== 'Terminal') return originalSpawn(command, args, options);
        const child = originalSpawn('/bin/sh', [args.at(-1)], { stdio: ['pipe', 'ignore', 'ignore'] });
        const quoted = `'${capturePath.replace(/'/g, "'\\''")}'`;
        child.stdin.end(`printf '%s\\n' "$KUBECONFIG" "$KCM_CONTEXT_LABEL" "$KCM_ISOLATED" > ${quoted}\nexit\n`);
        return child;
      };
    }, capture);
    try {
      await page.getByRole('button', { name: 'Apri shell isolata', exact: true }).click();
      await page.locator('.toast').filter({ hasText: 'Shell isolata aperta: Tenant Acme / development-eu' }).waitFor();
      const [temporaryPath, label, flag] = (await readFile(capture, 'utf8')).trim().split('\n');
      assert.notEqual(temporaryPath, tenantPath); assert.equal(label, 'Tenant Acme / development-eu'); assert.equal(flag, '1');
      await assert.rejects(access(temporaryPath));
      assert.equal(await readFile(tenantPath, 'utf8'), tenantBefore);
      assert.equal(await readFile(path, 'utf8'), standardBefore);
      assert.equal(await readFile(environment.KCM_SETTINGS, 'utf8'), settingsBefore);
      await page.locator('.current-info h2').filter({ hasText: 'staging-us' }).waitFor();
    } finally { await desktop.evaluate(() => globalThis.restoreKcmSmokeSpawn?.()); }
  }
  await page.getByRole('button', { name: 'Attiva contesto', exact: true }).click();
  await page.locator('.current-info h2').filter({ hasText: 'development-eu' }).waitFor();
  await page.locator('.shell-banner').waitFor();
  assert.equal(parse(await readFile(tenantPath, 'utf8'))['current-context'], 'development-eu');
  assert.equal(await readFile(path, 'utf8'), standardBefore);
  await page.getByRole('button', { name: 'Aggiungi ai preferiti development-eu', exact: true }).click();
  execFileSync(process.execPath, ['dist/cli.mjs', 'use', 'tenant-prod', '--folder', 'Tenant Acme'], { env: environment });
  await page.locator('.current-info h2').filter({ hasText: 'tenant-prod' }).waitFor();
  const exported = JSON.parse(execFileSync(process.execPath, ['dist/cli.mjs', 'env', '--json'], { env: environment, encoding: 'utf8' }));
  assert.equal(exported.path, tenantPath);
  assert.equal(await readFile(path, 'utf8'), standardBefore);

  // A newly created config is discovered without reconnecting the directory.
  const extra = { ...tenantConfig, contexts: [{ name: 'new-from-filesystem', context: { cluster: 'acme', user: 'acme' } }] };
  await writeFile(join(tenantDirectory, 'extra.json'), JSON.stringify(extra));
  await page.locator('.row-content').filter({ hasText: 'new-from-filesystem' }).waitFor();
  await page.getByRole('button', { name: 'Rinomina cartella', exact: true }).click();
  await page.getByLabel('Nuovo nome cartella', { exact: true }).fill('Acme EU');
  await page.getByRole('button', { name: 'Salva nome cartella', exact: true }).click();
  await page.getByRole('heading', { name: 'Acme EU.', exact: true }).waitFor();
  await page.locator('.row-content').filter({ hasText: 'tenant-prod' }).click();
  if (await page.locator('.toast').count()) await page.locator('.toast .icon-button').click();
  await page.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/client-folder.png' });

  await page.getByRole('button', { name: 'Scollega cartella', exact: true }).click();
  await page.getByRole('button', { name: 'Scollega cartella', exact: true }).click();
  await page.getByRole('heading', { name: 'I tuoi contesti.', exact: true }).waitFor();
  assert.ok(await readFile(tenantPath, 'utf8'));
  assert.equal(await readFile(path, 'utf8'), standardBefore);

  await page.getByRole('button', { name: 'Preferenze', exact: true }).click();
  const theme = page.getByLabel('Tema', { exact: true });
  assert.equal(await theme.inputValue(), 'system');
  await theme.selectOption('dark');
  await page.waitForFunction(() =>
    matchMedia('(prefers-color-scheme: dark)').matches &&
    getComputedStyle(document.documentElement).colorScheme === 'dark');
  assert.equal(JSON.parse(await readFile(environment.KCM_SETTINGS, 'utf8')).theme, 'dark');

  await page.getByRole('button', { name: /^Contesti/ }).click();
  await page.screenshot({ path: 'artifacts/dark-mode.png' });
  await page.getByRole('button', { name: 'Aggiungi contesto', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').evaluate(dialog => getComputedStyle(dialog).backgroundColor), 'rgb(25, 37, 31)');
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();

  await page.getByRole('button', { name: 'Preferenze', exact: true }).click();
  await theme.selectOption('light');
  await page.waitForFunction(() => matchMedia('(prefers-color-scheme: light)').matches);
  await theme.selectOption('system');
  await page.waitForFunction(() => !document.querySelector('.theme-field select')?.disabled);
  assert.equal(await desktop.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  assert.deepEqual(errors, []);
  console.log('Desktop smoke passed: theme preferences, existing flows, folder dialog, isolated shell, tenant switch, CLI sync, file separation, discovery, rename, disconnect, sandbox and tray.', native);
} finally {
  await desktop.close();
  await rm(root, { recursive: true, force: true });
}
