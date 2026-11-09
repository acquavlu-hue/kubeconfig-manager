import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { KubeconfigManager } from '../core/kubeconfig';
import { configPath, expandPath, readSettings, saveConfigPath, updateSettings } from '../core/settings';
import { ContextWorkspace } from '../core/workspace';
import { openIsolatedTerminal, prepareDesktopSession } from '../core/isolated-shell';
import { MAX_FILE_BYTES } from '../core/files';
import type { AddContextInput, Reply, ThemePreference } from '../shared/types';

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastSnapshot = '';
let refreshing = false;
let timer: NodeJS.Timeout;

const manager = async () => new KubeconfigManager(await configPath());
const workspace = new ContextWorkspace();
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#101714' : '#f7f8fa';
function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
function string(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Parametro non valido.');
  return value;
}
function openWindow(): void {
  if (!window) return;
  window.show(); window.focus();
}
function openAdd(): void { openWindow(); window?.webContents.send('kcm:add-requested'); }
function handle<T>(channel: string, callback: (...args: unknown[]) => Promise<T>): void {
  ipcMain.handle(`kcm:${channel}`, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Reply<T>> => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { error: 'Richiesta non autorizzata.' };
    try { return { data: await callback(...args) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Operazione non riuscita.' }; }
  });
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await workspace.snapshot();
    const serialized = JSON.stringify(state);
    if (lastSnapshot === serialized) return;
    lastSnapshot = serialized;
    window?.webContents.send('kcm:changed');
    if (!tray) return;
    const active = state.contexts.find(context => context.id === state.currentId);
    tray.setToolTip(`KubeContext · ${active ? `${active.folderName} / ${active.name}` : 'Nessun contesto attivo'}`);
    const sorted = [...state.contexts].sort((a, b) => Number(state.favorites.includes(b.id)) - Number(state.favorites.includes(a.id)) || a.name.localeCompare(b.name));
    const items: MenuItemConstructorOptions[] = [
      { label: 'KubeContext', enabled: false },
      { label: active ? `Attivo: ${active.folderName} / ${active.name}` : 'Nessun contesto attivo', enabled: false },
      { type: 'separator' },
      ...state.folders.map(folder => ({ label: `${folder.name} (${folder.contextCount})${folder.issues.length ? ' · attenzione' : ''}`, submenu: [
        ...(folder.issues.length ? [{ label: `${folder.issues.length} problemi di lettura · apri l’app`, click: openWindow }] : []),
        ...sorted.filter(context => context.folderId === folder.id).map(context => ({ label: `${context.id === state.currentId ? '● ' : ''}${state.favorites.includes(context.id) ? '★ ' : ''}${context.name}  ·  ${context.namespace}${folder.kind === 'filesystem' ? `  ·  ${context.relativePath}` : ''}`,
        click: async () => {
          try { await workspace.use({ id: context.id }); await refresh(); }
          catch (error) { dialog.showErrorBox('Cambio contesto non riuscito', error instanceof Error ? error.message : String(error)); }
        } })),
        ...(folder.contextCount === 0 ? [{ label: 'Nessun contesto disponibile', enabled: false }] : []),
      ] })),
      ...(sorted.length === 0 ? [{ label: 'Importa il tuo primo kubeconfig…', click: openAdd }] : []),
      { type: 'separator' },
      { label: 'Apri KubeContext', accelerator: 'CommandOrControl+Shift+K', click: openWindow },
      { label: 'Aggiungi contesti…', click: openAdd },
      { label: 'Esci', click: () => { quitting = true; app.quit(); } },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
  } catch {
    lastSnapshot = '';
    window?.webContents.send('kcm:changed');
    tray?.setToolTip('KubeContext · Controlla il kubeconfig');
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: 'Apri KubeContext per configurare il file', click: openWindow },
      { label: 'Esci', click: () => { quitting = true; app.quit(); } },
    ]));
  } finally { refreshing = false; }
}

function registerHandlers(): void {
  handle('get-theme', async () => nativeTheme.themeSource);
  handle('set-theme', async (theme: unknown) => {
    if (!isThemePreference(theme)) throw new Error('Tema non valido.');
    await updateSettings(settings => { settings.theme = theme; });
    nativeTheme.themeSource = theme;
    return theme;
  });
  handle('snapshot', async () => workspace.snapshot());
  handle('open-shell', async id => {
    const context = await workspace.find({ id: string(id, 10000) });
    const session = await prepareDesktopSession(context);
    await openIsolatedTerminal(session);
    return { label: session.label, shell: session.shell };
  });
  handle('use', async id => { const state = await workspace.use({ id: string(id, 10000) }); await refresh(); return state; });
  handle('favorite', async id => { const state = await workspace.favorite(string(id, 10000)); await refresh(); return state; });
  handle('namespace', async (id, namespace) => { const state = await workspace.namespace({ id: string(id, 10000) }, string(namespace, 63)); await refresh(); return state; });
  handle('import-file', async prefix => {
    const safePrefix = string(prefix, 80);
    const result = await dialog.showOpenDialog(window!, { title: 'Importa kubeconfig', properties: ['openFile'], filters: [{ name: 'Kubeconfig', extensions: ['yaml', 'yml', 'json', '*'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const imported = await (await manager()).importFile(result.filePaths[0], safePrefix); await refresh(); return imported;
  });
  handle('import-text', async (text, prefix) => { const result = await (await manager()).importText(string(text, MAX_FILE_BYTES), string(prefix, 80)); await refresh(); return result; });
  handle('add', async input => {
    if (!input || typeof input !== 'object') throw new Error('Contesto non valido.');
    const fields = input as Record<string, unknown>;
    const safe: AddContextInput = { name: string(fields.name, 200), server: string(fields.server, 2048) };
    for (const field of ['namespace', 'token', 'certificateAuthority'] as const) if (fields[field] !== undefined) safe[field] = string(fields[field], field === 'namespace' ? 63 : 1024 * 1024);
    const result = await (await manager()).add(safe); await refresh(); return result;
  });
  handle('choose-config', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Scegli il kubeconfig da gestire', properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const candidate = new KubeconfigManager(result.filePaths[0]);
    const override = process.env.KCM_KUBECONFIG;
    if (override && expandPath(override) !== candidate.path) throw new Error('KCM_KUBECONFIG fissa il file Standard. Rimuovi la variabile e riapri l’app per scegliere un altro file.');
    if (!(await candidate.snapshot()).exists) throw new Error('Il file selezionato non è più disponibile.');
    await saveConfigPath(candidate.path);
    await refresh(); return workspace.snapshot();
  });
  handle('reveal', async () => { const state = await (await manager()).snapshot(); if (state.exists) shell.showItemInFolder(state.path); else throw new Error('Il file verrà creato al primo import.'); });
  handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Collega la cartella kubeconfig del cliente', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle('add-folder', async (name, path, recursive) => {
    if (typeof recursive !== 'boolean') throw new Error('Opzione sottocartelle non valida.');
    await workspace.addFolder(string(name, 80), string(path, 10000), recursive); await refresh(); return workspace.snapshot();
  });
  handle('rename-folder', async (id, name) => { await workspace.renameFolder(string(id), string(name, 80)); await refresh(); return workspace.snapshot(); });
  handle('remove-folder', async id => { await workspace.removeFolder(string(id)); await refresh(); return workspace.snapshot(); });
  handle('reveal-folder', async id => {
    const folder = (await readSettings()).folders?.find(item => item.id === string(id));
    if (!folder) throw new Error('Cartella non trovata.');
    const error = await shell.openPath(folder.path); if (error) throw new Error(error);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', openWindow);
  app.whenReady().then(async () => {
    const settings = await readSettings().catch(() => undefined);
    nativeTheme.themeSource = isThemePreference(settings?.theme) ? settings.theme : 'system';
    registerHandlers();
    window = new BrowserWindow({ width: 1240, height: 820, minWidth: 960, minHeight: 680,
      title: 'KubeContext', backgroundColor: windowBackground(), titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 20 },
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window?.hide(); } });
    const updateBackground = () => window?.setBackgroundColor(windowBackground());
    nativeTheme.on('updated', updateBackground);
    window.on('closed', () => { nativeTheme.off('updated', updateBackground); window = null; });
    const menu: MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ label: 'KubeContext', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'quit' as const }] }] : []),
      { label: 'Modifica', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Finestra', submenu: [{ role: 'minimize' }, { label: 'Mostra KubeContext', click: openWindow }, ...(process.platform !== 'darwin' ? [{ role: 'quit' as const }] : [])] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    try {
      const image = nativeImage.createFromPath(join(__dirname, 'tray.png'));
      image.setTemplateImage(process.platform === 'darwin');
      tray = new Tray(image.resize({ width: process.platform === 'darwin' ? 22 : 24 }));
      tray.on('double-click', openWindow);
    } catch { tray = null; }
    if (process.env.KCM_DEV_URL && !app.isPackaged) await window.loadURL('http://127.0.0.1:5173');
    else await window.loadFile(join(__dirname, 'renderer', 'index.html'));
    globalShortcut.register('CommandOrControl+Shift+K', openWindow);
    await refresh();
    timer = setInterval(() => { void refresh(); }, 1500);
  }).catch(error => { dialog.showErrorBox('KubeContext', String(error)); app.quit(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { clearInterval(timer); globalShortcut.unregisterAll(); tray?.destroy(); });
  app.on('activate', openWindow);
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
