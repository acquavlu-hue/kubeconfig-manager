import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { KubeconfigManager } from '../src/core/kubeconfig';
import { prepareIsolatedSession, runIsolatedSession, safeShellLabel, terminalPlan } from '../src/core/isolated-shell';
import { contextId } from '../src/core/workspace';
import type { WorkspaceContext } from '../src/shared/types';

let root: string;
const nativeShell = process.platform === 'win32' ? 'powershell' : 'bash';
before(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'kcm-isolation-tests-'))); });
after(async () => { await rm(root, { recursive: true, force: true }); });
async function fixture(name: string, contextName = 'production'): Promise<WorkspaceContext> {
  const filePath = join(root, `${name}.yaml`);
  await writeFile(filePath, stringify({ apiVersion: 'v1', kind: 'Config',
    clusters: [{ name: 'prod', cluster: { server: 'https://prod.example.com', 'certificate-authority': './certs/ca.pem' } }, { name: 'other', cluster: { server: 'https://other.example.com' } }],
    users: [{ name: 'prod-user', user: { token: 'SELECTED-SECRET', exec: { command: './bin/auth', apiVersion: 'client.authentication.k8s.io/v1', interactiveMode: 'Never' } } }, { name: 'other-user', user: { token: 'OTHER-SECRET' } }],
    contexts: [{ name: contextName, context: { cluster: 'prod', user: 'prod-user', namespace: 'payments' } }, { name: 'local', context: { cluster: 'other', user: 'other-user' } }],
    'current-context': 'local',
  }));
  return { id: contextId('tenant', filePath, contextName), name: contextName, folderId: 'tenant', folderName: 'Cliente Acme', filePath, relativePath: `${name}.yaml`, cluster: 'prod', user: 'prod-user', namespace: 'payments', server: 'https://prod.example.com' };
}

test('disposable kubeconfig contains only the selected context and dependencies; source and parent environment are untouched', async () => {
  const context = await fixture('copy');
  const original = await readFile(context.filePath, 'utf8');
  const environment = { ...process.env };
  const session = await prepareIsolatedSession(context, nativeShell);
  try {
    const isolated = parse(await readFile(session.configPath, 'utf8'));
    assert.equal(isolated['current-context'], 'production');
    assert.equal(isolated.contexts.length, 1); assert.equal(isolated.clusters.length, 1); assert.equal(isolated.users.length, 1);
    assert.equal(isolated.users[0].user.token, 'SELECTED-SECRET');
    assert.equal(JSON.stringify(isolated).includes('OTHER-SECRET'), false);
    assert.equal(isolated.clusters[0].cluster['certificate-authority'], join(root, 'certs', 'ca.pem'));
    assert.equal(isolated.users[0].user.exec.command, join(root, 'bin', 'auth'));
    assert.equal(session.env.KUBECONFIG, session.configPath);
    assert.equal(session.env.KCM_KUBECONFIG, session.configPath);
    assert.equal(dirname(session.env.KCM_SETTINGS!), session.directory);
    assert.equal((await readdir(root)).some(name => name.includes('.backup-')), false);
    assert.equal(await readFile(context.filePath, 'utf8'), original);
    assert.ok(Object.keys(process.env).length === Object.keys(environment).length && Object.entries(environment).every(([key, value]) => process.env[key] === value), 'Parent environment changed');
    if (process.platform !== 'win32') {
      assert.equal((await stat(session.directory)).mode & 0o777, 0o700);
      assert.equal((await stat(session.configPath)).mode & 0o777, 0o600);
      assert.equal((await stat(session.env.KCM_SETTINGS!)).mode & 0o777, 0o600);
    }
  } finally { await session.cleanup(); }
  await assert.rejects(access(session.directory));
});

test('simultaneous shells have independent configs and namespace changes never reach the source', async () => {
  const context = await fixture('parallel'); const original = await readFile(context.filePath, 'utf8');
  const [one, two] = await Promise.all([prepareIsolatedSession(context, nativeShell), prepareIsolatedSession(context, nativeShell)]);
  try {
    assert.notEqual(one.configPath, two.configPath);
    await new KubeconfigManager(one.configPath).namespace(context.name, 'temporary');
    assert.equal((await new KubeconfigManager(two.configPath).snapshot()).contexts[0].namespace, 'payments');
    assert.equal(await readFile(context.filePath, 'utf8'), original);
    await assert.rejects(new KubeconfigManager(one.configPath).use('local'), /non trovato/);
  } finally { await one.cleanup(); await two.cleanup(); }
});

test('runner propagates exit status and cleans up after exit and failed spawn', async () => {
  const context = await fixture('lifecycle');
  const session = await prepareIsolatedSession(context, nativeShell);
  const args = nativeShell === 'powershell'
    ? ['-NoProfile', '-NonInteractive', '-Command', 'exit 17']
    : ['--noprofile', '--rcfile', join(session.directory, 'bashrc'), '-i', '-c', 'exit 17'];
  assert.equal(await runIsolatedSession({ ...session, args }, 'ignore'), 17);
  await assert.rejects(access(session.directory));
  const failed = await prepareIsolatedSession(context, nativeShell);
  await assert.rejects(runIsolatedSession({ ...failed, executable: join(root, 'does-not-exist') }, 'ignore'));
  await assert.rejects(access(failed.directory));
});

test('bash prompt is labelled, inherited startup injection is cleared and isolation variables are private', { skip: process.platform === 'win32' }, async () => {
  const context = await fixture('bash');
  const session = await prepareIsolatedSession(context, 'bash');
  try {
    assert.equal(session.env.BASH_ENV, undefined); assert.equal(session.env.PROMPT_COMMAND, undefined);
    const input = `printf '\\nLABEL:%s\\n' "$PS1"\nprintf 'CONFIG:%s\\n' "$KUBECONFIG"\nKUBECONFIG=/not-allowed\nprintf 'AFTER:%s\\n' "$KUBECONFIG"\nexit\n`;
    const result = spawnSync(session.executable, session.args, { encoding: 'utf8', env: session.env, input, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('[KCM: Cliente Acme / production]'));
    assert.ok(result.stdout.includes(`CONFIG:${session.configPath}`));
    assert.ok(result.stdout.includes(`AFTER:${session.configPath}`));
    assert.ok(result.stderr.includes('readonly'));
  } finally { await session.cleanup(); }
});

test('zsh uses the private startup directory and context prompt', { skip: process.platform !== 'darwin' }, async () => {
  const context = await fixture('zsh');
  const session = await prepareIsolatedSession(context, 'zsh');
  try {
    const input = `print -r -- "LABEL:$PROMPT"\nprint -r -- "CONFIG:$KUBECONFIG"\nexit\n`;
    const result = spawnSync(session.executable, session.args, { encoding: 'utf8', env: session.env, input, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('[KCM: Cliente Acme / production]'));
    assert.ok(result.stdout.includes(`CONFIG:${session.configPath}`));
  } finally { await session.cleanup(); }
});

test('prompt labels cannot inject substitutions, terminal escapes or bidi controls', { skip: process.platform === 'win32' }, async () => {
  const marker = join(root, 'injected');
  const context = await fixture('injection', `prod$(touch ${marker})%n\x1b[31m`);
  context.folderName = '`touch marker`\u202e';
  const session = await prepareIsolatedSession(context, 'bash');
  try {
    assert.equal(/[\x00-\x1f$`%\\\u202e]/.test(session.label), false);
    const result = spawnSync(session.executable, session.args, { encoding: 'utf8', env: session.env, input: 'printf "%s\\n" "$PS1"\nexit\n', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(marker));
    assert.equal(safeShellLabel('Cliente %F{red}\n$(id)'), 'Cliente ?F?red????id?');
  } finally { await session.cleanup(); }
});

test('POSIX desktop launcher supervises cleanup without changing the original config', { skip: process.platform === 'win32' }, async () => {
  const context = await fixture('desktop'); const original = await readFile(context.filePath, 'utf8');
  const session = await prepareIsolatedSession(context, 'bash');
  const result = spawnSync('/bin/sh', [session.launcherPath], { encoding: 'utf8', input: 'exit 9\n', timeout: 10000 });
  assert.equal(result.status, 9, result.stderr);
  await assert.rejects(access(session.directory));
  assert.equal(await readFile(context.filePath, 'utf8'), original);
});

test('native terminal plans quote paths and report missing Linux terminals', async () => {
  const context = await fixture('plans'); const session = await prepareIsolatedSession(context, nativeShell);
  try {
    const mac = await terminalPlan(session, 'darwin');
    assert.deepEqual(mac.args, ['-a', 'Terminal', session.launcherPath]);
    assert.equal(mac.waitForExit, true);
    const windows = await terminalPlan({ ...session, shell: 'powershell', executable: 'powershell.exe' }, 'win32');
    assert.equal(windows.detached, true);
    const payload = Buffer.from(windows.args.at(-1)!, 'base64').toString('utf16le');
    assert.ok(payload.includes(session.directory));
    const previous = process.env.PATH; process.env.PATH = '';
    try { await assert.rejects(terminalPlan(session, 'linux'), /Nessun terminale/); }
    finally { process.env.PATH = previous; }
  } finally { await session.cleanup(); }
});

test('missing sources, unknown contexts and unsupported shells fail without modifying source files', async () => {
  const context = await fixture('invalid'); const original = await readFile(context.filePath, 'utf8');
  await assert.rejects(prepareIsolatedSession(context, 'unsupported'), /Shell isolate supportate/);
  await assert.rejects(prepareIsolatedSession({ ...context, name: 'missing' }, nativeShell), /non trovato/);
  await assert.rejects(prepareIsolatedSession({ ...context, filePath: join(root, 'missing') }, nativeShell), /non è più disponibile/);
  assert.equal(await readFile(context.filePath, 'utf8'), original);
});
