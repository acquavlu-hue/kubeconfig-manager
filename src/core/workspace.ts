import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KubeconfigManager } from './kubeconfig';
import { expandPath, readSettings, resolveConfigPath, toggleFavorite, updateSettings } from './settings';
import type { ContextFolder, FolderInfo, WorkspaceContext, WorkspaceSnapshot } from '../shared/types';

export const STANDARD_FOLDER = 'standard';
export function contextId(folderId: string, path: string, name: string): string {
  return JSON.stringify([folderId, resolve(path), name]);
}
function validName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || ['standard', 'all'].includes(name.toLowerCase())) {
    throw new Error('Usa un nome cliente di 1–80 caratteri, diverso da Standard e All.');
  }
  return name;
}
function uniqueName(folders: ContextFolder[], name: string, except?: string): void {
  if (folders.some(folder => folder.id !== except && folder.name.toLowerCase() === name.toLowerCase())) throw new Error('Esiste già una cartella con questo nome.');
}
function candidate(name: string): boolean {
  if (name.startsWith('.') || /\.backup-|\.tmp$|\.kcm-lock$/i.test(name)) return false;
  return ['', '.yaml', '.yml', '.json', '.conf', '.config', '.kubeconfig', '.kcfg', '.cfg'].includes(extname(name).toLowerCase());
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Impossibile leggere il file.'; }

/** Files remain independent. Mutations are routed only to the selected source. */
export class ContextWorkspace {
  constructor(private readonly explicitStandardPath?: string) {}

  async addFolder(nameInput: string, pathInput: string, recursive = true): Promise<ContextFolder> {
    const name = validName(nameInput);
    const path = await realpath(expandPath(pathInput));
    if (!(await stat(path)).isDirectory()) throw new Error('Seleziona una cartella del filesystem.');
    const folder = { id: randomUUID(), name, path, recursive };
    await updateSettings(settings => {
      const existing = settings.folders ?? [];
      uniqueName(existing, name);
      if (existing.some(item => item.path === path)) throw new Error('Questa cartella è già collegata.');
      settings.kubeconfig ??= resolveConfigPath(settings, this.explicitStandardPath);
      settings.folders = [...existing, folder];
    });
    return folder;
  }

  async renameFolder(id: string, nameInput: string): Promise<void> {
    const name = validName(nameInput);
    await updateSettings(settings => {
      const folders = settings.folders ?? [];
      uniqueName(folders, name, id);
      const folder = folders.find(item => item.id === id);
      if (!folder) throw new Error('Cartella non trovata.');
      folder.name = name;
    });
  }

  async removeFolder(id: string): Promise<void> {
    await updateSettings(settings => {
      if (!(settings.folders ?? []).some(folder => folder.id === id)) throw new Error('Cartella non trovata.');
      settings.folders = settings.folders!.filter(folder => folder.id !== id);
      if (settings.activeFile?.folderId === id) delete settings.activeFile;
    });
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const settings = await readSettings();
    const standard = resolveConfigPath(settings, this.explicitStandardPath);
    const canonicalStandard = await realpath(standard).catch(() => standard);
    const contexts: WorkspaceContext[] = [];
    const favorites: string[] = [];
    const fileStates = new Map<string, { current: string; exists: boolean }>();
    const folders: FolderInfo[] = [];
    const read = async (path: string, folder: FolderInfo): Promise<void> => {
      try {
        if (folder.kind === 'filesystem' && await realpath(path) === canonicalStandard) return;
        const snapshot = await new KubeconfigManager(path).snapshot(settings);
        if (folder.kind === 'filesystem' && !snapshot.exists) throw new Error('Il file non è più disponibile.');
        fileStates.set(contextId(folder.id, path, ''), { current: snapshot.current, exists: snapshot.exists });
        if (snapshot.exists) folder.fileCount++;
        for (const context of snapshot.contexts) {
          const id = contextId(folder.id, path, context.name);
          contexts.push({ ...context, id, folderId: folder.id, folderName: folder.name, filePath: path,
            relativePath: folder.kind === 'standard' ? basename(path) : relative(folder.path, path) });
          if (snapshot.favorites.includes(context.name)) favorites.push(id);
          folder.contextCount++;
        }
      } catch (error) { folder.issues.push({ path, message: message(error) }); }
    };

    const standardFolder: FolderInfo = { id: STANDARD_FOLDER, name: 'Standard', path: standard, recursive: false, kind: 'standard', contextCount: 0, fileCount: 0, issues: [] };
    folders.push(standardFolder);
    await read(standard, standardFolder);
    for (const source of settings.folders ?? []) {
      const folder: FolderInfo = { ...source, kind: 'filesystem', contextCount: 0, fileCount: 0, issues: [] };
      folders.push(folder);
      let visited = 0;
      const scan = async (directory: string, depth = 0): Promise<void> => {
        if (depth > 20) { folder.issues.push({ path: directory, message: 'Limite di 20 livelli di sottocartelle raggiunto.' }); return; }
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch (error) { folder.issues.push({ path: directory, message: message(error) }); return; }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (++visited > 5000) throw new Error('Limite di 5000 elementi raggiunto: collega una cartella più specifica.');
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.endsWith('.kcm-lock')) continue;
          const path = join(directory, entry.name);
          if (entry.isDirectory() && source.recursive) await scan(path, depth + 1);
          // Symlinks are intentionally not followed during recursive discovery.
          else if (entry.isFile() && candidate(entry.name)) await read(path, folder);
        }
      };
      try { await scan(source.path); }
      catch (error) { folder.issues.push({ path: source.path, message: message(error) }); }
    }
    const active = settings.activeFile ?? { folderId: STANDARD_FOLDER, path: standard };
    const activeFile = fileStates.get(contextId(active.folderId, active.path, ''));
    const current = activeFile?.current ?? '';
    const currentId = current ? contextId(active.folderId, active.path, current) : '';
    if (settings.activeFile && (!activeFile || !contexts.some(context => context.id === currentId))) {
      folders.find(folder => folder.id === active.folderId)?.issues.push({ path: active.path, message: 'Il file o il contesto attivo non è più disponibile. Seleziona esplicitamente un altro contesto.' });
    }
    return { path: standard, exists: fileStates.get(contextId(STANDARD_FOLDER, standard, ''))?.exists ?? false,
      contexts, folders, favorites, current, currentId, activePath: active.path, activeFolderId: active.folderId };
  }

  async find(selector: string, folderSelector?: string, file?: string): Promise<WorkspaceContext> {
    const state = await this.snapshot();
    const exact = state.contexts.find(context => context.id === selector);
    let candidates = exact ? [exact] : state.contexts.filter(context => context.name === selector);
    if (folderSelector) {
      const folder = state.folders.find(item => item.id === folderSelector || item.name.toLowerCase() === folderSelector.toLowerCase());
      if (!folder) throw new Error(`Cartella non trovata: ${folderSelector}`);
      candidates = candidates.filter(context => context.folderId === folder.id);
    }
    if (file) {
      const requested = await realpath(expandPath(file)).catch(() => expandPath(file));
      const paths = await Promise.all(candidates.map(context => realpath(context.filePath).catch(() => resolve(context.filePath))));
      candidates = candidates.filter((_, index) => paths[index] === requested);
    }
    if (!candidates.length) throw new Error(`Contesto non trovato: ${selector}`);
    if (candidates.length > 1) throw new Error(`Contesto ambiguo: ${selector}. Specifica --folder e, se necessario, --file.`);
    return candidates[0];
  }

  async use(selector: string, folder?: string, file?: string): Promise<WorkspaceSnapshot> {
    const context = await this.find(selector, folder, file);
    await updateSettings(async settings => {
      if (context.folderId !== STANDARD_FOLDER && !settings.folders?.some(item => item.id === context.folderId)) {
        throw new Error('La cartella è stata scollegata.');
      }
      if (context.folderId === STANDARD_FOLDER && context.filePath !== resolveConfigPath(settings, this.explicitStandardPath)) {
        throw new Error('Il kubeconfig standard è cambiato. Riprova.');
      }
      await new KubeconfigManager(context.filePath).use(context.name, settings);
      if (context.folderId === STANDARD_FOLDER) delete settings.activeFile;
      else settings.activeFile = { folderId: context.folderId, path: context.filePath };
    });
    return this.snapshot();
  }

  async namespace(selector: string, namespace: string, folder?: string, file?: string): Promise<WorkspaceSnapshot> {
    const context = await this.find(selector, folder, file);
    await stat(context.filePath);
    await new KubeconfigManager(context.filePath).namespace(context.name, namespace);
    return this.snapshot();
  }

  async favorite(id: string): Promise<WorkspaceSnapshot> {
    const context = await this.find(id);
    await toggleFavorite(context.filePath, context.name);
    return this.snapshot();
  }
}
