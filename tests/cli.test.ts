import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { shellQuote } from '../src/shared/shell-quote';

let root: string;
before(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'kcm-cli-'))); });
after(async () => { await rm(root, { recursive: true, force: true }); });
function cli(args: string[], input?: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), ...args], {
    encoding: 'utf8', input,
    env: { ...process.env, KCM_KUBECONFIG: join(root, 'config'), KCM_SETTINGS: join(root, 'settings.json'), ...extraEnv },
  });
}
test('CLI lifecycle: add through stdin, list, use, namespace and no token in output', async () => {
  const added = cli(['add', 'test with spaces', '--server', 'https://example.com', '--token-stdin', '--json'], 'SECRET-STDIN\n');
  assert.equal(added.status, 0, added.stderr); assert.equal(added.stdout.includes('SECRET-STDIN'), false);
  assert.deepEqual(JSON.parse(added.stdout).added, ['test with spaces']);
  const listed = cli(['list', '--json']); assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).current, '');
  assert.equal(listed.stdout.includes('SECRET-STDIN'), false);
  const used = cli(['use', 'test with spaces']); assert.equal(used.status, 0, used.stderr);
  assert.equal(cli(['current']).stdout.trim(), 'test with spaces');
  assert.equal(cli(['namespace', 'payments']).status, 0);
  assert.equal(parse(await readFile(join(root, 'config'), 'utf8')).users[0].user.token, 'SECRET-STDIN');
  assert.equal(JSON.parse(cli(['list', '--json']).stdout).contexts[0].namespace, 'payments');
});
test('CLI errors use nonzero exit codes and --kubeconfig overrides environment', () => {
  assert.equal(cli(['use', 'missing']).status, 1);
  assert.equal(cli(['invalid']).status, 1);
  assert.equal(cli(['path', '--kubeconfig', join(root, 'explicit')]).stdout.trim(), join(root, 'explicit'));
  assert.equal(cli(['list'], undefined, { KCM_KUBECONFIG: '', KUBECONFIG: `first${delimiter}second` }).status, 1);
});

test('CLI current fails for a context removed from the selected file', async () => {
  const path = join(root, 'stale-current');
  await writeFile(path, 'apiVersion: v1\nkind: Config\ncurrent-context: removed\n');
  const current = cli(['current', '--kubeconfig', path, '--json']);
  assert.equal(current.status, 1);
  assert.deepEqual(JSON.parse(current.stdout), { current: '', path });
  const shared = cli(['current', '--json'], undefined, { KCM_KUBECONFIG: path });
  assert.equal(shared.status, 1);
  assert.equal(JSON.parse(shared.stdout).current, '');
});

test('CLI shell rejects a temporary root that kubectl would split into several files', { skip: process.platform === 'win32' }, async () => {
  const temporary = join(root, `wrong${delimiter}temporary`);
  const path = join(root, 'shell-config');
  await mkdir(temporary);
  const added = cli(['add', 'isolated', '--server', 'https://example.com', '--kubeconfig', path]);
  assert.equal(added.status, 0, added.stderr);
  const result = cli(['shell', 'isolated', '--kubeconfig', path, '--shell', 'bash'], 'exit\n', { TMPDIR: temporary });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /separatore di KUBECONFIG/);
});
test('CLI imports and completion commands work', async () => {
  await writeFile(join(root, 'source'), 'apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://c.example.com\nusers: []\ncontexts:\n- name: c\n  context:\n    cluster: c\n');
  const imported = cli(['import', join(root, 'source'), '--prefix', 'team', '--json']);
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(JSON.parse(imported.stdout).added, ['team/c']);
  assert.ok(cli(['list', '--names']).stdout.includes('team/c'));
  for (const shell of ['zsh', 'bash', 'fish']) assert.equal(cli(['completion', shell]).status, 0);
  assert.equal(cli(['completion', 'nope']).status, 1);
});

test('CLI folder registration, disambiguation, source switch, environment and disconnect', async () => {
  const tenant = join(root, 'client folder'); await mkdir(tenant);
  const path = join(tenant, 'config.yaml');
  await writeFile(path, 'apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://tenant.example.com\nusers: []\ncontexts:\n- name: tenant-dev\n  context:\n    cluster: c\ncurrent-context: ""\n');
  const standardBefore = await readFile(join(root, 'config'), 'utf8');
  const added = cli(['folder', 'add', 'Acme', tenant, '--json']);
  assert.equal(added.status, 0, added.stderr);
  const folder = JSON.parse(added.stdout);
  const listed = cli(['list', '--folder', 'Acme', '--json']);
  assert.equal(listed.status, 0, listed.stderr); assert.equal(JSON.parse(listed.stdout).contexts.length, 1);
  const used = cli(['use', 'tenant-dev', '--folder', folder.id]);
  assert.equal(used.status, 0, used.stderr);
  assert.equal(parse(await readFile(path, 'utf8'))['current-context'], 'tenant-dev');
  assert.equal(await readFile(join(root, 'config'), 'utf8'), standardBefore);
  assert.equal(JSON.parse(cli(['current', '--json']).stdout).path, path);
  assert.equal(JSON.parse(cli(['env', '--json']).stdout).path, path);
  assert.ok(cli(['env', '--shell', 'powershell']).stdout.startsWith('$env:KUBECONFIG'));
  assert.equal(cli(['folder', 'rename', 'Acme', '--name', 'Acme EU']).status, 0);
  assert.ok(JSON.parse(cli(['folder', 'list', '--json']).stdout).some((item: { name: string }) => item.name === 'Acme EU'));
  assert.equal(cli(['folder', 'remove', folder.id]).status, 0);
  assert.ok(await readFile(path, 'utf8'));
});

test('kcm shell resolves a tenant context without changing the original files or the global selection', { skip: process.platform === 'win32' }, async () => {
  const tenant = join(root, "client's isolated shell"); await mkdir(tenant);
  const path = join(tenant, 'config.yaml');
  await writeFile(path, 'apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://tenant.example.com\nusers: []\ncontexts:\n- name: tenant-dev\n  context:\n    cluster: c\n- name: other\n  context:\n    cluster: c\ncurrent-context: other\n');
  const added = cli(['folder', 'add', 'Cliente Shell', tenant, '--json']);
  assert.equal(added.status, 0, added.stderr);
  const sourceBefore = await readFile(path, 'utf8');
  const standardBefore = await readFile(join(root, 'config'), 'utf8');
  const settingsBefore = await readFile(join(root, 'settings.json'), 'utf8');
  const kcm = [process.execPath, '--import', 'tsx', resolve('src/cli.ts')].map(value => shellQuote(value)).join(' ');
  const commands = `printf 'KCM_FILE:%s\\n' "$KUBECONFIG"\n${kcm} current\n${kcm} namespace disposable\nexit 23\n`;
  const result = cli(['shell', 'tenant-dev', '--folder', 'Cliente Shell', '--file', path, '--shell', 'bash'], commands);
  assert.equal(result.status, 23, result.stderr);
  assert.ok(result.stdout.includes('[KCM: Cliente Shell / tenant-dev]'));
  assert.ok(result.stdout.split('\n').includes('tenant-dev'));
  assert.ok(result.stdout.includes('disposable'));
  const sessionPath = result.stdout.split('\n').find(line => line.startsWith('KCM_FILE:'))?.slice('KCM_FILE:'.length);
  assert.ok(sessionPath && sessionPath !== path);
  await assert.rejects(access(sessionPath));
  assert.equal(await readFile(path, 'utf8'), sourceBefore);
  assert.equal(await readFile(join(root, 'config'), 'utf8'), standardBefore);
  assert.equal(await readFile(join(root, 'settings.json'), 'utf8'), settingsBefore);
});
