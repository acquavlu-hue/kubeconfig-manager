import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import { homedir, tmpdir, constants as osConstants } from 'node:os';
import { spawn } from 'node:child_process';
import type { StdioOptions } from 'node:child_process';
import { KubeconfigManager } from './kubeconfig';
import { shellQuote } from '../shared/shell-quote';
import type { WorkspaceContext } from '../shared/types';

export type IsolatedShellKind = 'bash' | 'zsh' | 'powershell';
export interface IsolatedSession {
  directory: string;
  configPath: string;
  launcherPath: string;
  label: string;
  shell: IsolatedShellKind;
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

export function safeShellLabel(value: string): string {
  // A prompt is code in several shells. Keep substitutions, prompt escapes,
  // terminal controls and bidi controls out of labels derived from kubeconfigs.
  return value.replace(/[^\p{L}\p{N} ._/@:-]/gu, '?').slice(0, 120);
}

export async function findExecutable(names: string[], extraDirectories: string[] = []): Promise<string | undefined> {
  const directories = [...(process.env.PATH || '').split(delimiter).filter(Boolean), ...extraDirectories];
  for (const name of names) {
    const candidates = /[\\/]/.test(name) ? [name] : directories.map(directory => join(directory, name));
    for (const path of candidates) {
      try { await access(path, constants.X_OK); return path; } catch { /* Try the next executable. */ }
    }
  }
  return undefined;
}

async function resolveShell(requested?: string): Promise<{ kind: IsolatedShellKind; executable: string }> {
  const defaultName = basename(process.env.SHELL || '').replace(/\.exe$/i, '');
  const kind = requested || (process.platform === 'win32' ? 'powershell' : ['bash', 'zsh'].includes(defaultName) ? defaultName : process.platform === 'darwin' ? 'zsh' : 'bash');
  if (!['bash', 'zsh', 'powershell'].includes(kind)) throw new Error('Shell isolate supportate: bash, zsh, powershell.');
  if (process.platform === 'win32' && kind !== 'powershell') throw new Error('Su Windows usa --shell powershell.');
  const names = kind === 'powershell' ? ['pwsh', 'pwsh.exe', 'powershell.exe'] : [kind];
  if (kind === 'powershell' && process.platform === 'win32') names.push(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  const executable = await findExecutable(names, ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']);
  if (!executable) throw new Error(`Shell ${kind} non trovata. Specifica --shell bash, zsh oppure powershell disponibile sul computer.`);
  return { kind: kind as IsolatedShellKind, executable };
}

/** Creates only private temporary files. Never calls use(), or saves workspace preferences. */
export async function prepareIsolatedSession(context: WorkspaceContext, requestedShell?: string, cwd = process.cwd()): Promise<IsolatedSession> {
  const temporaryRoot = tmpdir();
  if (temporaryRoot.includes(delimiter)) throw new Error('La directory temporanea contiene il separatore di KUBECONFIG. Scegli una directory temporanea diversa.');
  const { kind, executable } = await resolveShell(requestedShell);
  const config = await new KubeconfigManager(context.filePath).isolatedConfig(context.name);
  const directory = await mkdtemp(join(temporaryRoot, 'kcm-shell-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await chmod(directory, 0o700);
    const configPath = join(directory, 'config');
    const settingsPath = join(directory, 'settings.json');
    const historyPath = join(directory, 'history');
    const label = safeShellLabel(`${context.folderName} / ${context.name}`);
    const variables: Record<string, string> = {
      KUBECONFIG: configPath, KCM_KUBECONFIG: configPath, KCM_SETTINGS: settingsPath,
      KCM_ISOLATED: '1', KCM_CONTEXT_LABEL: label,
    };
    const privateWrite = (name: string, content: string, mode = 0o600) => writeFile(join(directory, name), content, { mode, flag: 'wx' });
    await privateWrite('config', config);
    await privateWrite('settings.json', JSON.stringify({ kubeconfig: configPath }));
    const env: NodeJS.ProcessEnv = { ...process.env, ...variables, ZDOTDIR: directory, HISTFILE: historyPath };
    for (const name of ['BASH_ENV', 'ENV', 'PROMPT_COMMAND', 'PS1', 'PS2']) delete env[name];
    const assignments = Object.entries(variables).map(([key, value]) => `export ${key}=${shellQuote(value)}`).join('\n');
    const readonly = 'readonly KUBECONFIG KCM_KUBECONFIG KCM_SETTINGS';
    const banner = `Shell isolata [KCM: ${label}] — exit per chiudere. Il kubeconfig originale resta invariato.`;
    let args: string[];
    let launcherPath: string;
    if (kind === 'bash') {
      await privateWrite('bashrc', `${assignments}\n${readonly}\nunset PROMPT_COMMAND\nHISTFILE=${shellQuote(historyPath)}\nPS1='\\[\\e[1;36m\\][KCM: ${label}]\\[\\e[0m\\] \\w \\$ '\nprintf '%s\\n' ${shellQuote(banner)}\n`);
      args = ['--noprofile', '--rcfile', join(directory, 'bashrc'), '-i'];
    } else if (kind === 'zsh') {
      await privateWrite('.zshenv', `unsetopt GLOBAL_RCS\n${assignments}\n`);
      await privateWrite('.zshrc', `${assignments}\n${readonly}\nunsetopt PROMPT_SUBST\nHISTFILE=${shellQuote(historyPath)}\nPROMPT='%F{cyan}[KCM: ${label}]%f %~ %# '\nprintf '%s\\n' ${shellQuote(banner)}\n`);
      args = ['-d', '-i'];
    } else {
      const psAssignments = Object.entries(variables).map(([key, value]) => `$env:${key} = ${shellQuote(value, 'powershell')}`).join('\n');
      const init = `${psAssignments}\nfunction global:prompt { Write-Host -NoNewline -ForegroundColor Cyan ${shellQuote(`[KCM: ${label}] `, 'powershell')}; return "$($executionContext.SessionState.Path.CurrentLocation)> " }\nif (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) { Set-PSReadLineOption -HistorySavePath ${shellQuote(historyPath, 'powershell')} -HistorySaveStyle SaveNothing }\nWrite-Host ${shellQuote(banner, 'powershell')}\n`;
      args = ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', Buffer.from(init, 'utf16le').toString('base64')];
    }

    if (process.platform === 'win32') {
      // The hidden supervisor owns cleanup even when the interactive child exits.
      const argumentString = args.join(' '); // All variable content is inside EncodedCommand.
      const script = `$ErrorActionPreference = 'Stop'\ntry { $child = Start-Process -FilePath ${shellQuote(executable, 'powershell')} -ArgumentList ${shellQuote(argumentString, 'powershell')} -WorkingDirectory ${shellQuote(cwd, 'powershell')} -PassThru; $child.WaitForExit() } finally { [System.IO.Directory]::Delete(${shellQuote(directory, 'powershell')}, $true) }`;
      await privateWrite('launch.ps1', script);
      launcherPath = join(directory, 'launch.ps1');
    } else {
      const command = [executable, ...args].map(value => shellQuote(value)).join(' ');
      const script = `#!/bin/sh\nkcm_session_directory=${shellQuote(directory)}\ntrap '/bin/rm -rf -- "$kcm_session_directory"' EXIT\ntrap 'exit 129' HUP\ntrap ':' INT\ntrap 'exit 143' TERM\nunset BASH_ENV ENV PROMPT_COMMAND\n${assignments}\nexport ZDOTDIR=${shellQuote(directory)}\nexport HISTFILE=${shellQuote(historyPath)}\ncd ${shellQuote(cwd)} || exit 1\n${command}\nkcm_exit_status=$?\nexit "$kcm_exit_status"\n`;
      const name = process.platform === 'darwin' ? 'launch.command' : 'launch.sh';
      await privateWrite(name, script, 0o700);
      launcherPath = join(directory, name);
    }
    return { directory, configPath, launcherPath, label, shell: kind, executable, args, env, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function runIsolatedSession(session: IsolatedSession, stdio: StdioOptions = 'inherit'): Promise<number> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(session.executable, session.args, { env: session.env, stdio, shell: false });
      const interrupt = () => { /* The foreground terminal also sends SIGINT to the child. */ };
      let killTimer: NodeJS.Timeout | undefined;
      const stop = () => {
        child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGHUP');
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2500).unref();
      };
      process.on('SIGINT', interrupt); process.on('SIGTERM', stop); process.on('SIGHUP', stop);
      const removeListeners = () => { clearTimeout(killTimer); process.off('SIGINT', interrupt); process.off('SIGTERM', stop); process.off('SIGHUP', stop); };
      child.once('error', error => { removeListeners(); reject(error); });
      child.once('exit', (code, signal) => {
        removeListeners();
        resolve(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 1) : 1));
      });
    });
  } finally { await session.cleanup(); }
}

export interface TerminalPlan { executable: string; args: string[]; waitForExit: boolean; detached: boolean }
export async function terminalPlan(session: IsolatedSession, platform: NodeJS.Platform = process.platform): Promise<TerminalPlan> {
  if (platform === 'darwin') return { executable: '/usr/bin/open', args: ['-a', 'Terminal', session.launcherPath], waitForExit: true, detached: false };
  if (platform === 'win32') {
    const code = Buffer.from(await readFile(session.launcherPath, 'utf8'), 'utf16le').toString('base64');
    return { executable: session.executable, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', code], waitForExit: false, detached: true };
  }
  for (const [name, args] of [
    ['x-terminal-emulator', ['-e', '/bin/sh', session.launcherPath]],
    ['gnome-terminal', ['--', '/bin/sh', session.launcherPath]],
    ['konsole', ['-e', '/bin/sh', session.launcherPath]],
    ['xfce4-terminal', ['--execute', '/bin/sh', session.launcherPath]],
    ['xterm', ['-e', '/bin/sh', session.launcherPath]],
  ] as const) {
    const executable = await findExecutable([name]);
    if (executable) return { executable, args: [...args], waitForExit: false, detached: true };
  }
  throw new Error('Nessun terminale supportato trovato. Installa un terminale desktop oppure usa kcm shell dalla CLI.');
}

/** Native terminal handoff; the private launcher supervises session cleanup. */
export async function openIsolatedTerminal(session: IsolatedSession): Promise<void> {
  try {
    const plan = await terminalPlan(session);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(plan.executable, plan.args, { stdio: 'ignore', shell: false, detached: plan.detached, windowsHide: true });
      child.once('error', reject);
      if (plan.waitForExit) child.once('exit', code => code === 0 ? resolve() : reject(new Error('Impossibile aprire Terminale.')));
      else child.once('spawn', () => { child.unref(); resolve(); });
    });
  } catch (error) { await session.cleanup(); throw error; }
}

export async function prepareDesktopSession(context: WorkspaceContext): Promise<IsolatedSession> {
  return prepareIsolatedSession(context, undefined, homedir());
}
