import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { stringify, parse } from 'yaml';
import { ContextWorkspace } from '../src/core/workspace';
import { configPath, readSettings, saveConfigPath, updateSettings } from '../src/core/settings';
import { environmentCommand } from '../src/core/shell';

let root: string;
before(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'kcm-folders-'))); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function config(names = ['dev', 'prod'], current = 'dev') {
  return stringify({ apiVersion: 'v1', kind: 'Config',
    clusters: [{ name: 'shared-cluster', cluster: { server: 'https://api.example.com', 'certificate-authority': './ca.pem' } }],
    users: [{ name: 'shared-user', user: { token: 'PRIVATE-FOLDER-TOKEN' } }],
    contexts: names.map(name => ({ name, context: { cluster: 'shared-cluster', user: 'shared-user' } })), 'current-context': current });
}
async function setup(name: string) {
  const directory = join(root, name); await mkdir(directory);
  const standard = join(directory, 'standard-config');
  await writeFile(standard, config(['personal'], 'personal'));
  process.env.KCM_SETTINGS = join(directory, 'settings.json');
  process.env.KCM_KUBECONFIG = standard;
  return { directory, standard, workspace: new ContextWorkspace() };
}

test('folders discover separate files recursively without changing any kubeconfig', async () => {
  const { directory, standard, workspace } = await setup('discovery');
  const tenant = join(directory, 'tenant'); await mkdir(join(tenant, 'eu'), { recursive: true });
  await writeFile(join(tenant, 'dev.yaml'), config());
  await writeFile(join(tenant, 'eu', 'kubeconfig'), config(['prod'], 'prod'));
  await writeFile(join(tenant, 'ca.pem'), 'not a kubeconfig');
  await writeFile(join(tenant, '.hidden.yaml'), config());
  await writeFile(join(tenant, 'dev.yaml.backup-abc'), config());
  const original = await readFile(standard, 'utf8');
  const source = await readFile(join(tenant, 'dev.yaml'), 'utf8');
  const folder = await workspace.addFolder('Cliente Acme', tenant);
  const state = await workspace.snapshot();
  assert.equal(state.contexts.length, 4);
  assert.equal(state.folders.find(item => item.id === folder.id)!.fileCount, 2);
  assert.equal(state.folders.find(item => item.id === folder.id)!.issues.length, 0);
  assert.equal(await readFile(standard, 'utf8'), original);
  assert.equal(await readFile(join(tenant, 'dev.yaml'), 'utf8'), source);
  assert.equal(JSON.stringify(state).includes('PRIVATE-FOLDER-TOKEN'), false);
  assert.equal((await readdir(tenant)).some(name => name.includes('backup-') && name !== 'dev.yaml.backup-abc'), false);
});

test('duplicate context, cluster and user names remain distinct across tenants and files', async () => {
  const { directory, workspace } = await setup('duplicates');
  const alpha = join(directory, 'alpha'), beta = join(directory, 'beta');
  await mkdir(alpha); await mkdir(beta);
  await writeFile(join(alpha, 'one.yaml'), config());
  await writeFile(join(alpha, 'two.yaml'), config());
  await writeFile(join(beta, 'one.yaml'), config());
  const a = await workspace.addFolder('Alpha', alpha); await workspace.addFolder('Beta', beta);
  const contexts = (await workspace.snapshot()).contexts.filter(context => context.name === 'dev');
  assert.equal(contexts.length, 3); assert.equal(new Set(contexts.map(context => context.id)).size, 3);
  await assert.rejects(workspace.use('dev'), /ambiguo/);
  await assert.rejects(workspace.use('dev', 'Alpha'), /ambiguo/);
  await workspace.use('dev', a.id, join(alpha, 'two.yaml'));
  const state = await workspace.snapshot();
  assert.equal(state.activePath, join(alpha, 'two.yaml'));
  assert.equal(state.contexts.find(context => context.id === state.currentId)!.folderName, 'Alpha');
});

test('switch and namespace modify only the exact source with backup and preserve relative references', async () => {
  const { directory, standard, workspace } = await setup('switch');
  const tenant = join(directory, 'tenant'); await mkdir(tenant);
  const path = join(tenant, 'config.yaml'); const original = config(); await writeFile(path, original);
  const standardBefore = await readFile(standard, 'utf8');
  await workspace.addFolder('Tenant', tenant);
  const selected = (await workspace.snapshot()).contexts.find(context => context.folderName === 'Tenant' && context.name === 'prod')!;
  const state = await workspace.use(selected.id);
  assert.equal(state.currentId, selected.id); assert.equal(state.current, 'prod');
  assert.equal(await readFile(standard, 'utf8'), standardBefore);
  const source = parse(await readFile(path, 'utf8'));
  assert.equal(source['current-context'], 'prod');
  assert.equal(source.clusters[0].cluster['certificate-authority'], './ca.pem');
  assert.equal(source.users[0].user.token, 'PRIVATE-FOLDER-TOKEN');
  const backups = (await readdir(tenant)).filter(name => name.includes('.backup-'));
  assert.equal(await readFile(join(tenant, backups[0]), 'utf8'), original);
  await workspace.namespace(selected.id, 'payments');
  assert.equal(parse(await readFile(path, 'utf8')).contexts[1].context.namespace, 'payments');
  assert.equal(await readFile(standard, 'utf8'), standardBefore);
  await workspace.use('personal', 'standard');
  assert.equal((await workspace.snapshot()).activePath, standard);
});

test('rename keeps identity and favorites; disconnect never deletes or rewrites files', async () => {
  const { directory, workspace } = await setup('rename');
  const tenant = join(directory, 'tenant'); await mkdir(tenant);
  const path = join(tenant, 'config'); await writeFile(path, config());
  const folder = await workspace.addFolder('Original', tenant);
  const context = (await workspace.snapshot()).contexts.find(item => item.folderId === folder.id)!;
  await workspace.favorite(context.id); await workspace.use(context.id);
  await workspace.renameFolder(folder.id, 'Nuovo cliente');
  const renamed = await workspace.snapshot();
  assert.equal(renamed.contexts.find(item => item.id === context.id)!.folderName, 'Nuovo cliente');
  assert.ok(renamed.favorites.includes(context.id));
  const original = await readFile(path, 'utf8');
  await workspace.removeFolder(folder.id);
  const removed = await workspace.snapshot();
  assert.equal(removed.folders.length, 1); assert.equal(removed.activeFolderId, 'standard');
  assert.equal(await readFile(path, 'utf8'), original);
});

test('partial parse failures and missing active files do not hide healthy files or silently switch tenants', async () => {
  const { directory, workspace } = await setup('failures');
  const tenant = join(directory, 'tenant'); await mkdir(tenant);
  const source = join(tenant, 'healthy.yaml'); await writeFile(source, config());
  await writeFile(join(tenant, 'broken.yaml'), 'apiVersion: [SECRET-DO-NOT-EXPOSE');
  const folder = await workspace.addFolder('Cliente', tenant);
  let state = await workspace.snapshot();
  assert.equal(state.folders.find(item => item.id === folder.id)!.issues.length, 1);
  assert.equal(JSON.stringify(state).includes('SECRET-DO-NOT-EXPOSE'), false);
  await workspace.use('prod', folder.id);
  await rm(source);
  state = await workspace.snapshot();
  assert.equal(state.activePath, source); assert.equal(state.current, '');
  assert.ok(state.folders.find(item => item.id === folder.id)!.issues.some(issue => issue.message.includes('attivo')));
  await assert.rejects(workspace.use('prod', folder.id), /non trovato/);
});

test('flat scan excludes subdirectories and detects filesystem changes without registration changes', async () => {
  const { directory, workspace } = await setup('flat');
  const tenant = join(directory, 'tenant'); await mkdir(join(tenant, 'nested'), { recursive: true });
  await writeFile(join(tenant, 'nested', 'config'), config());
  const folder = await workspace.addFolder('Cliente', tenant, false);
  assert.equal((await workspace.snapshot()).folders.find(item => item.id === folder.id)!.contextCount, 0);
  const path = join(tenant, 'new.cfg'); await writeFile(path, config());
  assert.equal((await workspace.snapshot()).folders.find(item => item.id === folder.id)!.contextCount, 2);
  await rm(path);
  assert.equal((await workspace.snapshot()).folders.find(item => item.id === folder.id)!.contextCount, 0);
});

test('rejects duplicate names and paths, preserves standard path when shell exports a client', async () => {
  const { directory, standard, workspace } = await setup('validation');
  const tenant = join(directory, 'tenant'); await mkdir(tenant);
  await workspace.addFolder('Client', tenant);
  await assert.rejects(workspace.addFolder('client', directory), /nome/);
  await assert.rejects(workspace.addFolder('Other', tenant), /già collegata/);
  await assert.rejects(workspace.addFolder('Standard', directory), /nome cliente/);
  delete process.env.KCM_KUBECONFIG;
  const previous = process.env.KUBECONFIG;
  process.env.KUBECONFIG = join(tenant, 'config');
  try {
    assert.equal(await configPath(), standard);
    assert.equal((await readSettings()).kubeconfig, standard);
  } finally { if (previous === undefined) delete process.env.KUBECONFIG; else process.env.KUBECONFIG = previous; }
});

test('recursive discovery does not follow symbolic links', { skip: process.platform === 'win32' }, async () => {
  const { directory, workspace } = await setup('symlinks');
  const tenant = join(directory, 'tenant'); await mkdir(tenant);
  await symlink(tenant, join(tenant, 'loop'));
  await symlink(join(directory, 'standard-config'), join(tenant, 'config'));
  const folder = await workspace.addFolder('Cliente', tenant);
  assert.equal((await workspace.snapshot()).folders.find(item => item.id === folder.id)!.contextCount, 0);
  await writeFile(join(tenant, 'source.yaml'), config());
  const alias = join(directory, 'alias'); await symlink(tenant, alias);
  await workspace.use('prod', folder.id, join(alias, 'source.yaml'));
  assert.equal((await workspace.snapshot()).activePath, join(tenant, 'source.yaml'));
});

test('environment commands quote paths for bash, fish and PowerShell', () => {
  assert.equal(environmentCommand('/tmp/client config', 'bash'), "export KUBECONFIG='/tmp/client config'");
  assert.equal(environmentCommand("client's/config", 'powershell'), "$env:KUBECONFIG = 'client''s/config'");
  assert.equal(environmentCommand('client’s/config', 'powershell'), "$env:KUBECONFIG = 'client’’s/config'");
  assert.ok(environmentCommand("/tmp/client's/config", 'fish').includes("client\\'s"));
  assert.throws(() => environmentCommand('/tmp/config', 'invalid'), /Shell supportate/);
  assert.throws(() => environmentCommand(`/tmp/client${delimiter}config`, 'bash'), /separatore di KUBECONFIG/);
});

test('Standard is only shown once when it lies in a linked directory', async () => {
  const { directory, standard, workspace } = await setup('standard-in-folder');
  await writeFile(join(directory, 'tenant-config'), config(['client'], 'client'));
  const folder = await workspace.addFolder('Cliente', directory);
  const state = await workspace.snapshot();
  assert.deepEqual(state.contexts.filter(context => context.filePath === standard).map(context => context.folderId), ['standard']);
  assert.equal(state.folders.find(item => item.id === folder.id)?.contextCount, 1);
});

test('settings keep an explicit Standard and pin the effective path for legacy settings', async () => {
  const { directory, standard, workspace } = await setup('pin');
  const fallback = join(directory, 'from-environment');
  const tenant = join(directory, 'tenant');
  await mkdir(tenant);
  const previous = process.env.KUBECONFIG;
  delete process.env.KCM_KUBECONFIG;
  process.env.KUBECONFIG = fallback;
  try {
    await updateSettings(settings => { settings.kubeconfig = standard; });
    assert.equal(await configPath(), fallback);
    await workspace.addFolder('Cliente', tenant);
    assert.equal((await readSettings()).kubeconfig, fallback);
    await saveConfigPath(standard);
    assert.equal(await configPath(), standard);
    process.env.KCM_KUBECONFIG = fallback;
    assert.equal(await configPath(), fallback);
  } finally {
    if (previous === undefined) delete process.env.KUBECONFIG;
    else process.env.KUBECONFIG = previous;
  }
});

test('a switch after concurrent removal leaves the former collection file untouched', async () => {
  const { directory, workspace } = await setup('switch-after-remove');
  const tenant = join(directory, 'tenant');
  await mkdir(tenant);
  const source = join(tenant, 'config');
  const original = config();
  await writeFile(source, original);
  const folder = await workspace.addFolder('Cliente', tenant);
  const find = workspace.find.bind(workspace);
  workspace.find = async (...args) => {
    const context = await find(...args);
    await workspace.removeFolder(folder.id);
    return context;
  };
  await assert.rejects(workspace.use('prod', folder.id), /scollegata/);
  assert.equal(await readFile(source, 'utf8'), original);
});
