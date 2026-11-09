import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { version } from '../package.json';
import { KubeconfigManager } from './core/kubeconfig';
import { configPath, expandPath, saveConfigPath } from './core/settings';
import { ContextWorkspace, contextId, selectFolder, STANDARD_FOLDER } from './core/workspace';
import { environmentCommand } from './core/shell';
import { prepareIsolatedSession, runIsolatedSession } from './core/isolated-shell';
import { shellQuote } from './shared/shell-quote';
import type { Snapshot, WorkspaceContext, WorkspaceSnapshot } from './shared/types';
const isWorkspace = (state: Snapshot): state is WorkspaceSnapshot => Array.isArray((state as WorkspaceSnapshot).folders);
const defaultShell = process.platform === 'win32' ? 'powershell' : 'bash';

function activeContext(state: Snapshot) {
  if (isWorkspace(state)) return state.contexts.find(context => context.id === state.currentId);
  return state.contexts.find(context => context.name === state.current);
}

const help = `KubeContext · kcm

  kcm list [--json]                         Elenca i contesti
  kcm current                              Mostra il contesto attivo
  kcm use <nome>                           Cambia il contesto attivo
  kcm shell [<nome>] [--folder <cliente>]   Apre una shell isolata, senza switch locale
      [--file <kubeconfig>] [--shell bash|zsh|powershell]
  kcm import <file> [--prefix <prefisso>]    Importa un kubeconfig
  kcm add <nome> --server <url>             Aggiunge un contesto
      [--namespace <ns>] [--ca <file>] [--token-stdin]
  kcm namespace <ns> [--context <nome>]     Imposta il namespace
  kcm path [<file>]                        Mostra/salva il percorso condiviso
  kcm folder list                         Elenca le cartelle clienti
  kcm folder add <nome> <directory>        Collega una cartella (ricorsivo)
  kcm folder rename <id|nome> --name <nome> Rinomina un gruppo
  kcm folder remove <id|nome>              Scollega senza eliminare file
  kcm env [--shell bash|zsh|fish|powershell] Esporta il file attivo nella shell
  kcm completion <bash|zsh|fish>           Genera lo script di completamento

Opzioni: --folder <nome|id>, --file <kubeconfig>, --kubeconfig <file>, --json
Cartelle: --no-recursive per escludere le sottocartelle.
Token solo via stdin; import e modifiche creano backup con permessi privati.
Vault: integrazione prevista, nessun provider connesso in questa versione.
`;

// Escape terminal controls in untrusted names without changing the original YAML.
const display = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

async function run(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
      json: { type: 'boolean' }, kubeconfig: { type: 'string' }, prefix: { type: 'string' },
      server: { type: 'string' }, namespace: { type: 'string' }, context: { type: 'string' },
      ca: { type: 'string' }, 'token-stdin': { type: 'boolean' },
      names: { type: 'boolean' },
      folder: { type: 'string' }, file: { type: 'string' }, shell: { type: 'string' },
      name: { type: 'string' }, 'no-recursive': { type: 'boolean' },
    },
  });
  if (values.version) { console.log(version); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  const [command, argument] = positionals;
  const workspace = new ContextWorkspace(values.kubeconfig);
  if (command === 'folder') {
    const [, action, target, path] = positionals;
    if (positionals.length > 4) throw new Error('Troppi argomenti. Usa kcm --help.');
    if (action === 'add') {
      if (!target || !path) throw new Error('Usa kcm folder add <nome> <directory>.');
      const folder = await workspace.addFolder(target, path, !values['no-recursive']);
      console.log(values.json ? JSON.stringify(folder) : `Cartella collegata: ${display(folder.name)} (${folder.id})\n${display(folder.path)}`);
    } else if (action === 'list' && !target) {
      const folders = (await workspace.snapshot()).folders;
      if (values.json) console.log(JSON.stringify(folders, null, 2));
      else for (const folder of folders) console.log(`${display(folder.name)}\t${folder.contextCount} contesti\t${folder.id}\t${display(folder.path)}${folder.issues.length ? `\t${folder.issues.length} problemi` : ''}`);
    } else if (['remove', 'rename'].includes(action) && target && !path) {
      const folder = selectFolder((await workspace.snapshot()).folders, target);
      if (!folder || folder.kind === 'standard') throw new Error('Cartella cliente non trovata.');
      if (action === 'remove') await workspace.removeFolder(folder.id);
      else { if (!values.name) throw new Error('Specifica --name <nuovo nome>.'); await workspace.renameFolder(folder.id, values.name); }
      console.log(values.json ? JSON.stringify({ id: folder.id, action }) : action === 'remove' ? 'Cartella scollegata. Nessun file eliminato.' : 'Cartella rinominata.');
    } else throw new Error('Usa kcm folder list|add|rename|remove. Vedi kcm --help.');
    return;
  }
  if (positionals.length > 2) throw new Error('Troppi argomenti. Usa kcm --help.');
  const required = () => { if (!argument) throw new Error(`Argomento mancante per “${command}”. Usa kcm --help.`); return argument; };

  if (command === 'completion') {
    const shell = required();
    if (shell === 'zsh') console.log(`#compdef kcm
_kcm() {
  if (( CURRENT == 2 )); then
    compadd list current use shell import add namespace path folder env completion
  elif [[ $words[2] == use || $words[2] == shell ]]; then
    local -a contexts
    contexts=("\${(@f)$(kcm list --names)}")
    compadd -- "\${contexts[@]}"
  else
    _files
  fi
}
compdef _kcm kcm`);
    else if (shell === 'bash') console.log(`_kcm() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  if [[ $COMP_CWORD == 1 ]]; then
    COMPREPLY=( $(compgen -W 'list current use shell import add namespace path folder env completion' -- "$current") )
  elif [[ \${COMP_WORDS[1]} == use || \${COMP_WORDS[1]} == shell ]]; then
    local line
    COMPREPLY=()
    while IFS= read -r line; do [[ "$line" == "$current"* ]] && COMPREPLY+=("$line"); done < <(kcm list --names)
  fi
}
complete -F _kcm kcm`);
    else if (shell === 'fish') console.log(`complete -c kcm -f
complete -c kcm -n '__fish_use_subcommand' -a 'list current use shell import add namespace path folder env completion'
complete -c kcm -n '__fish_seen_subcommand_from use shell' -a '(kcm list --names)'`);
    else throw new Error('Shell supportate: bash, zsh, fish.');
    return;
  }

  if (command === 'path' && argument) {
    const path = expandPath(argument);
    await saveConfigPath(path);
    console.log(values.json ? JSON.stringify({ path }) : path);
    return;
  }
  const direct = values.kubeconfig ? new KubeconfigManager(expandPath(values.kubeconfig)) : undefined;
  if (direct && (values.folder || values.file)) throw new Error('Usa --folder e --file senza --kubeconfig.');
  const snapshot = () => direct?.snapshot() ?? workspace.snapshot();
  const standard = async () => direct ?? new KubeconfigManager(await configPath());
  switch (command) {
    case 'path': {
      const { path } = await standard();
      console.log(values.json ? JSON.stringify({ path }) : path);
      break;
    }
    case 'list': {
      const state = await snapshot();
      if (isWorkspace(state) && values.folder) {
        const folder = selectFolder(state.folders, values.folder);
        if (!folder) throw new Error(`Cartella non trovata: ${values.folder}`);
        state.contexts = state.contexts.filter(context => context.folderId === folder.id);
      }
      if (isWorkspace(state) && !values.names) {
        for (const folder of state.folders) for (const issue of folder.issues) console.error(`kcm: ${display(folder.name)} · ${display(issue.path)} · ${display(issue.message)}`);
        if (!state.contexts.length && state.folders.some(folder => folder.issues.length)) process.exitCode = 1;
      }
      if (values.json) console.log(JSON.stringify(state, null, 2));
      else if (values.names) console.log(state.contexts.map(context => display(context.name)).join('\n'));
      else if (state.contexts.length === 0) console.log('Nessun contesto. Usa kcm import <file> oppure kcm add <nome> --server <url>.');
      else {
        const width = Math.max(8, ...state.contexts.map(context => display(context.name).length));
        console.log(`  ${'CONTESTO'.padEnd(width)}  NAMESPACE         CLUSTER / CARTELLA / FILE`);
        for (const context of state.contexts) {
          const active = 'id' in context && 'currentId' in state ? context.id === state.currentId : state.current === context.name;
          const source = 'folderName' in context && 'relativePath' in context ? `  ·  ${display(String(context.folderName))}  ·  ${display(String(context.relativePath))}` : '';
          console.log(`${active ? '●' : ' '} ${display(context.name).padEnd(width)}  ${display(context.namespace).padEnd(16)}  ${display(context.cluster)}${source}`);
        }
      }
      break;
    }
    case 'current': {
      const state = await snapshot();
      const current = activeContext(state)?.name ?? '';
      console.log(values.json ? JSON.stringify({ current, ...(isWorkspace(state) ? { path: state.activePath, folderId: state.activeFolderId } : { path: state.path }) }) : display(current));
      if (!current) process.exitCode = 1;
      break;
    }
    case 'use': {
      const state = direct ? await direct.use(required()) : await workspace.use(required(), values.folder, values.file);
      console.log(values.json ? JSON.stringify(state) : `Contesto attivo: ${display(state.current)}`);
      break;
    }
    case 'shell': {
      if (values.json) throw new Error('kcm shell apre una sessione interattiva e non supporta --json.');
      let context: WorkspaceContext;
      if (direct) {
        const state = await direct.snapshot();
        const name = argument || state.current;
        const found = state.contexts.find(item => item.name === name);
        if (!found) throw new Error('Contesto non trovato nel file specificato. Indica il nome dopo kcm shell.');
        context = { ...found, id: contextId(STANDARD_FOLDER, direct.path, name), folderId: STANDARD_FOLDER, folderName: 'Standard', filePath: direct.path, relativePath: basename(direct.path) };
      } else {
        const selected = argument || (await workspace.snapshot()).currentId;
        if (!selected) throw new Error('Indica un contesto: kcm shell <nome> [--folder <cliente>].');
        context = await workspace.find(argument ? selected : { id: selected }, values.folder, values.file);
      }
      const session = await prepareIsolatedSession(context, values.shell);
      process.exitCode = await runIsolatedSession(session);
      break;
    }
    case 'import': {
      const result = await (await standard()).importFile(expandPath(required()), values.prefix);
      console.log(values.json ? JSON.stringify(result) : `Importati ${result.added.length} contesti; ${result.skipped.length} già presenti.${result.backup ? `\nBackup: ${result.backup}` : ''}`);
      break;
    }
    case 'add': {
      const name = required();
      if (!values.server) throw new Error('Specifica --server https://api.example.com:6443');
      if (values['token-stdin'] && process.stdin.isTTY) throw new Error('Passa il token tramite pipe a stdin.');
      let token: string | undefined;
      if (values['token-stdin']) {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of process.stdin) {
          const buffer = Buffer.from(chunk); length += buffer.length;
          if (length > 1024 * 1024) throw new Error('Token troppo lungo.');
          chunks.push(buffer);
        }
        token = Buffer.concat(chunks).toString('utf8').trim();
        if (!token) throw new Error('Token vuoto.');
      }
      const result = await (await standard()).add({ name, server: values.server, namespace: values.namespace, token,
        certificateAuthority: values.ca ? await readFile(expandPath(values.ca), 'utf8') : undefined });
      const hint = direct ? '' : ` Attivalo con kcm use --folder standard -- ${shellQuote(name.trim(), defaultShell)}`;
      console.log(values.json ? JSON.stringify(result) : `Contesto aggiunto: ${display(name)}.${hint}`);
      break;
    }
    case 'namespace': {
      const ns = required();
      const current = values.context ? undefined : await snapshot();
      const name = values.context || (current && activeContext(current)?.name);
      if (!name) throw new Error('Nessun contesto attivo. Specifica --context oppure usa kcm use.');
      const selector = current && isWorkspace(current) ? { id: current.currentId } : name;
      const state = direct ? await direct.namespace(name, ns) : await workspace.namespace(selector, ns, values.folder, values.file);
      console.log(values.json ? JSON.stringify(state) : `Namespace di ${display(name)}: ${display(ns)}`);
      break;
    }
    case 'env': {
      if (argument) throw new Error('Usa kcm env [--shell bash|zsh|fish|powershell].');
      const state = await snapshot();
      const path = isWorkspace(state) ? state.activePath : state.path;
      if (!activeContext(state)) throw new Error('Nessun contesto attivo disponibile. Usa kcm use prima di kcm env.');
      console.log(values.json ? JSON.stringify({ path }) : environmentCommand(path, values.shell || defaultShell));
      break;
    }
    default: throw new Error(`Comando sconosciuto: ${command}. Usa kcm --help.`);
  }
}

run().catch(error => { console.error(`kcm: ${display(error instanceof Error ? error.message : String(error))}`); process.exitCode = 1; });
