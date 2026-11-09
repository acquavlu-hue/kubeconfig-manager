import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { atomicWrite, optionalRead, withFileLock } from './files';
import type { ContextFolder, ThemePreference } from '../shared/types';

export interface Settings {
  theme?: ThemePreference;
  kubeconfig?: string;
  standardPinned?: true;
  favorites?: Record<string, string[]>;
  folders?: ContextFolder[];
  activeFile?: { folderId: string; path: string };
}
export function settingsPath(): string {
  if (process.env.KCM_SETTINGS) return resolve(process.env.KCM_SETTINGS);
  const base = process.platform === 'win32'
    ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'kubecontext', 'settings.json');
}
export async function readSettings(): Promise<Settings> {
  const raw = await optionalRead(settingsPath());
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error(`Preferenze non valide: ${settingsPath()}`); }
}
export function expandPath(path: string): string {
  return resolve(path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
}
export async function configPath(): Promise<string> {
  return resolveConfigPath(await readSettings());
}
export function resolveConfigPath(settings: Settings, explicit?: string): string {
  if (explicit) return expandPath(explicit);
  if (process.env.KCM_KUBECONFIG) return expandPath(process.env.KCM_KUBECONFIG);
  // A shell may export a client's KUBECONFIG using `kcm env`. Pin the standard
  // file on selection or folder registration, including legacy folder settings.
  if (settings.kubeconfig && (settings.standardPinned || settings.folders)) return expandPath(settings.kubeconfig);
  const environment = process.env.KUBECONFIG;
  if (environment) {
    const paths = environment.split(delimiter).filter(Boolean);
    if (paths.length !== 1) throw new Error('KUBECONFIG contiene più file. Scegli il file da gestire con --kubeconfig oppure KCM_KUBECONFIG.');
    return expandPath(paths[0]);
  }
  return expandPath(settings.kubeconfig || join(homedir(), '.kube', 'config'));
}
export async function updateSettings(edit: (settings: Settings) => void | Promise<void>): Promise<void> {
  await withFileLock(settingsPath(), async path => {
    const settings = await readSettings();
    await edit(settings);
    await atomicWrite(path, JSON.stringify(settings, null, 2));
  });
}
export async function saveConfigPath(path: string): Promise<void> {
  await updateSettings(settings => {
    settings.kubeconfig = expandPath(path);
    settings.standardPinned = true;
    delete settings.activeFile;
  });
}
export function favoritesFor(settings: Settings, path: string): string[] {
  const value = settings.favorites?.[path];
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}
export async function toggleFavorite(path: string, name: string): Promise<void> {
  await updateSettings(settings => {
    const names = new Set(favoritesFor(settings, path));
    if (names.has(name)) names.delete(name); else names.add(name);
    settings.favorites = { ...settings.favorites, [path]: [...names] };
  });
}
