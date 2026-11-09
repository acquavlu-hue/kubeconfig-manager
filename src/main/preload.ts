import { contextBridge, ipcRenderer } from 'electron';
import type { AddContextInput, DesktopAPI } from '../shared/types';

const api: DesktopAPI = {
  getTheme: () => ipcRenderer.invoke('kcm:get-theme'),
  setTheme: theme => ipcRenderer.invoke('kcm:set-theme', theme),
  snapshot: () => ipcRenderer.invoke('kcm:snapshot'),
  switchContext: (name: string) => ipcRenderer.invoke('kcm:use', name),
  favorite: (name: string) => ipcRenderer.invoke('kcm:favorite', name),
  importFile: (prefix: string) => ipcRenderer.invoke('kcm:import-file', prefix),
  importText: (text: string, prefix: string) => ipcRenderer.invoke('kcm:import-text', text, prefix),
  addContext: (input: AddContextInput) => ipcRenderer.invoke('kcm:add', input),
  setNamespace: (context: string, namespace: string) => ipcRenderer.invoke('kcm:namespace', context, namespace),
  chooseConfig: () => ipcRenderer.invoke('kcm:choose-config'),
  revealConfig: () => ipcRenderer.invoke('kcm:reveal'),
  pickFolder: () => ipcRenderer.invoke('kcm:pick-folder'),
  addFolder: (name, path, recursive) => ipcRenderer.invoke('kcm:add-folder', name, path, recursive),
  renameFolder: (id, name) => ipcRenderer.invoke('kcm:rename-folder', id, name),
  removeFolder: id => ipcRenderer.invoke('kcm:remove-folder', id),
  revealFolder: id => ipcRenderer.invoke('kcm:reveal-folder', id),
  openShell: id => ipcRenderer.invoke('kcm:open-shell', id),
  onChanged: callback => {
    const listener = () => callback(); ipcRenderer.on('kcm:changed', listener);
    return () => ipcRenderer.removeListener('kcm:changed', listener);
  },
  onAddRequested: callback => {
    const listener = () => callback(); ipcRenderer.on('kcm:add-requested', listener);
    return () => ipcRenderer.removeListener('kcm:add-requested', listener);
  },
};
contextBridge.exposeInMainWorld('kcm', api);
