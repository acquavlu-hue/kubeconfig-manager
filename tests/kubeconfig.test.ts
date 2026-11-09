import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { KubeconfigManager } from '../src/core/kubeconfig';
import { MAX_FILE_BYTES } from '../src/core/files';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'kcm-tests-')); process.env.KCM_SETTINGS = join(root, 'settings.json'); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function fixture(name = 'dev', overrides: Record<string, unknown> = {}) {
  return { apiVersion: 'v1', kind: 'Config', clusters: [{ name, cluster: { server: `https://${name}.example.com:6443` } }],
    users: [{ name, user: { token: 'TEST-TOKEN-MUST-NOT-LEAK' } }],
    contexts: [{ name, context: { cluster: name, user: name, namespace: 'default' } }], 'current-context': name, ...overrides };
}
function manager(name: string) { return new KubeconfigManager(join(root, name, 'config')); }
async function seed(name: string, data = fixture()) {
  const instance = manager(name); await mkdir(join(root, name), { recursive: true });
  await writeFile(instance.path, stringify(data)); return instance;
}

test('missing kubeconfig starts empty and first import does not silently select a context', async () => {
  const instance = manager('empty');
  assert.equal((await instance.snapshot()).exists, false);
  const imported = await instance.importText(stringify(fixture()));
  assert.deepEqual(imported.added, ['dev']);
  const state = await instance.snapshot();
  assert.equal(state.current, ''); assert.equal(state.exists, true);
  assert.equal(JSON.stringify(state).includes('TEST-TOKEN'), false);
  await instance.use('dev'); assert.equal((await instance.snapshot()).current, 'dev');
});

test('switch preserves comments, credentials and extension fields; stores exact private backup', async () => {
  const instance = await seed('switch', fixture('dev', { extensions: [{ name: 'custom', extension: { keep: true } }] }));
  const original = `# My original configuration\n${await readFile(instance.path, 'utf8')}`;
  await writeFile(instance.path, original);
  await instance.use('dev');
  const updated = await readFile(instance.path, 'utf8');
  assert.ok(updated.includes('# My original configuration'));
  const config = parse(updated);
  assert.equal(config.users[0].user.token, 'TEST-TOKEN-MUST-NOT-LEAK');
  assert.equal(config.extensions[0].extension.keep, true);
  await instance.namespace('dev', 'new-namespace');
  const backups = (await readdir(join(root, 'switch'))).filter(name => name.includes('.backup-'));
  assert.ok(backups.length >= 1);
  assert.equal(await readFile(join(root, 'switch', backups[0]), 'utf8'), original);
  if (process.platform !== 'win32') {
    assert.equal((await stat(instance.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, 'switch', backups[0]))).mode & 0o777, 0o600);
  }
});

test('import preserves active context and credentials, idempotent imports skip existing names', async () => {
  const instance = await seed('import');
  assert.deepEqual((await instance.importText(stringify(fixture('stage')))).added, ['stage']);
  assert.equal((await instance.snapshot()).current, 'dev');
  assert.deepEqual((await instance.importText(stringify(fixture('stage')))).skipped, ['stage']);
  assert.equal((await instance.snapshot()).contexts.length, 2);
});

test('conflict is rejected atomically, prefix renames cluster, user and context references', async () => {
  const instance = await seed('conflict');
  const before = await readFile(instance.path, 'utf8');
  const changed = fixture(); changed.clusters[0].cluster.server = 'https://other.example.com';
  await assert.rejects(instance.importText(stringify(changed)), /Conflitto/);
  assert.equal(await readFile(instance.path, 'utf8'), before);
  assert.deepEqual((await instance.importText(stringify(changed), 'team')).added, ['team/dev']);
  const context = (await instance.snapshot()).contexts.find(item => item.name === 'team/dev')!;
  assert.equal(context.cluster, 'team/dev'); assert.equal(context.user, 'team/dev');
});

test('local imports resolve certificate, token and executable paths against the original file', async () => {
  const directory = join(root, 'source'); await mkdir(directory);
  const config: any = fixture('local');
  config.clusters[0].cluster['certificate-authority'] = 'certs/ca.pem';
  config.users[0].user.tokenFile = 'auth/token';
  config.users[0].user.exec = { command: './bin/auth', apiVersion: 'client.authentication.k8s.io/v1', interactiveMode: 'Never' };
  const path = join(directory, 'config'); await writeFile(path, stringify(config));
  const instance = manager('refs'); await instance.importFile(path);
  const result = parse(await readFile(instance.path, 'utf8'));
  assert.equal(result.clusters[0].cluster['certificate-authority'], resolve(directory, 'certs/ca.pem'));
  assert.equal(result.users[0].user.tokenFile, resolve(directory, 'auth/token'));
  assert.equal(result.users[0].user.exec.command, resolve(directory, 'bin/auth'));
  await assert.rejects(manager('textrefs').importText(stringify(config)), /file originale/);
});

test('rejects malformed configs without leaking credential excerpts in errors', async () => {
  const instance = manager('invalid');
  for (const raw of ['token: [SECRET-TOKEN', 'hello: world', 'apiVersion: v1\nkind: Config\ncontexts: nope', stringify(fixture('broken', { clusters: [] }))]) {
    await assert.rejects(instance.importText(raw), error => !String(error).includes('SECRET-TOKEN'));
  }
  assert.equal((await instance.snapshot()).exists, false);
});

test('rejects duplicate names, missing users and invalid namespace types', async () => {
  const data: any = fixture(); data.contexts.push(data.contexts[0]);
  await assert.rejects(manager('duplicates').importText(stringify(data)), /duplicato/);
  await assert.rejects(manager('nouser').importText(stringify(fixture('dev', { users: [] }))), /Utente mancante/);
  data.contexts.pop(); data.contexts[0].context.namespace = 42;
  await assert.rejects(manager('badns').importText(stringify(data)), /namespace non valido/);
});

test('serializes simultaneous imports from separate manager instances', async () => {
  const instance = await seed('concurrent');
  await Promise.all(['alpha', 'beta', 'gamma', 'delta'].map(name => new KubeconfigManager(instance.path).importText(stringify(fixture(name)))));
  assert.equal((await instance.snapshot()).contexts.length, 5);
  assert.equal((await instance.snapshot()).current, 'dev');
  assert.equal((await readdir(join(root, 'concurrent'))).some(name => name.includes('lock') || name.endsWith('.tmp')), false);
});

test('namespace and unknown-context failures never alter the original', async () => {
  const instance = await seed('namespace');
  const original = await readFile(instance.path, 'utf8');
  await assert.rejects(instance.namespace('dev', 'Invalid_NS'), /Namespace non valido/);
  await assert.rejects(instance.use('missing'), /non trovato/);
  await assert.rejects(instance.namespace('missing', 'valid'), /non trovato/);
  assert.equal(await readFile(instance.path, 'utf8'), original);
  await instance.namespace('dev', 'payments');
  assert.equal((await instance.snapshot()).contexts[0].namespace, 'payments');
});

test('manual context supports embedded CA and token without exposing secrets in snapshot', async () => {
  const instance = manager('manual');
  await instance.add({ name: 'new', server: 'https://example.com:6443', token: 'MY-SECRET', certificateAuthority: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----' });
  const config = parse(await readFile(instance.path, 'utf8'));
  assert.ok(config.clusters[0].cluster['certificate-authority-data']);
  assert.equal(config.users[0].user.token, 'MY-SECRET');
  assert.equal(JSON.stringify(await instance.snapshot()).includes('MY-SECRET'), false);
  await assert.rejects(instance.add({ name: 'bad', server: 'https://user:secret@example.com' }), /senza credenziali/);
  await assert.rejects(instance.add({ name: 'bad', server: 'file:///etc/passwd' }), /HTTP/);
});

test('snapshots redact URL credentials and query strings', async () => {
  const config = fixture(); config.clusters[0].cluster.server = 'https://admin:password@example.com:6443/api?token=secret#secret';
  const instance = await seed('redact', config);
  assert.equal((await instance.snapshot()).contexts[0].server, 'https://example.com:6443/api');
  assert.equal((await readFile(instance.path, 'utf8')).includes('password'), true);
});

test('writes through a symlink without replacing it', { skip: process.platform === 'win32' }, async () => {
  const instance = await seed('symlink-target');
  const link = join(root, 'config-link'); await symlink(instance.path, link);
  await new KubeconfigManager(link).namespace('dev', 'linked');
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal((await instance.snapshot()).contexts[0].namespace, 'linked');
});

const aliases = `apiVersion: v1
kind: Config
clusters:
  - name: shared
    cluster: &server
      server: https://shared.example.com # Keep this comment
      certificate-authority: ''
users: []
contexts:
  - name: one
    context: &common { cluster: shared, namespace: default }
  - name: two
    context: *common
extensions:
  - name: custom
    extension: *server
`;

test('imports preserve destination anchors and prefix each source context once', async () => {
  const instance = await seed('import-with-aliases');
  await writeFile(instance.path, aliases);
  await instance.importText(aliases, 'tenant');
  const updated = await readFile(instance.path, 'utf8');
  const data = parse(updated);
  assert.match(updated, /# Keep this comment/);
  assert.equal(data.extensions[0].extension.server, 'https://shared.example.com');
  assert.deepEqual(data.contexts.map((entry: { context: { cluster: string } }) => entry.context.cluster), ['shared', 'shared', 'tenant/shared', 'tenant/shared']);
  assert.equal(data.clusters[1].cluster['certificate-authority'], '');
  assert.equal((await instance.snapshot()).contexts.length, 4);
  assert.equal(parse(await instance.isolatedConfig('two')).clusters[0].cluster['certificate-authority'], '');
});

test('namespace edits detach an alias and leave a shared anchor intact', async () => {
  const instance = await seed('namespace-with-aliases');
  await writeFile(instance.path, aliases);
  await assert.rejects(instance.namespace('one', 'newns'), /ancora YAML condivisa/);
  assert.equal(await readFile(instance.path, 'utf8'), aliases);
  await instance.namespace('two', 'other');
  assert.deepEqual((await instance.snapshot()).contexts.map(context => context.namespace), ['default', 'other']);
  await instance.namespace('one', 'newns');
  assert.deepEqual((await instance.snapshot()).contexts.map(context => context.namespace), ['newns', 'other']);
});

test('rejects a merge exceeding the read limit before creating a backup', async () => {
  const destination = fixture('original');
  const incoming = fixture('incoming');
  for (const config of [destination, incoming]) config.users[0].user.token = 'x'.repeat(MAX_FILE_BYTES / 2);
  const instance = await seed('merge-limit', destination);
  const original = await readFile(instance.path, 'utf8');
  await assert.rejects(instance.importText(stringify(incoming)), /limite di 10 MB/);
  assert.deepEqual(await readdir(join(root, 'merge-limit')), ['config']);
  assert.ok(original === await readFile(instance.path, 'utf8'));
});
