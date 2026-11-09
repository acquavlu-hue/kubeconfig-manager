export interface ContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace: string;
  server: string;
}
export interface Snapshot {
  path: string;
  current: string;
  contexts: ContextInfo[];
  favorites: string[];
  exists: boolean;
}
export interface ContextFolder {
  id: string;
  name: string;
  path: string;
  recursive: boolean;
}
export interface FolderInfo extends ContextFolder {
  kind: 'standard' | 'filesystem';
  contextCount: number;
  fileCount: number;
  issues: { path: string; message: string }[];
}
export interface WorkspaceContext extends ContextInfo {
  id: string;
  folderId: string;
  folderName: string;
  filePath: string;
  relativePath: string;
}
export interface WorkspaceSnapshot extends Snapshot {
  contexts: WorkspaceContext[];
  folders: FolderInfo[];
  currentId: string;
  activePath: string;
  activeFolderId: string;
}
export interface AddContextInput {
  name: string;
  server: string;
  namespace?: string;
  token?: string;
  certificateAuthority?: string;
}
export interface ImportResult { added: string[]; skipped: string[]; backup?: string }
export type Reply<T> = { data: T } | { error: string };
export type ThemePreference = 'system' | 'light' | 'dark';
export interface DesktopAPI {
  getTheme(): Promise<Reply<ThemePreference>>;
  setTheme(theme: ThemePreference): Promise<Reply<ThemePreference>>;
  snapshot(): Promise<Reply<WorkspaceSnapshot>>;
  switchContext(id: string): Promise<Reply<WorkspaceSnapshot>>;
  favorite(id: string): Promise<Reply<WorkspaceSnapshot>>;
  importFile(prefix: string): Promise<Reply<ImportResult | null>>;
  importText(text: string, prefix: string): Promise<Reply<ImportResult>>;
  addContext(input: AddContextInput): Promise<Reply<ImportResult>>;
  setNamespace(id: string, namespace: string): Promise<Reply<WorkspaceSnapshot>>;
  chooseConfig(): Promise<Reply<WorkspaceSnapshot | null>>;
  revealConfig(): Promise<Reply<void>>;
  pickFolder(): Promise<Reply<string | null>>;
  addFolder(name: string, path: string, recursive: boolean): Promise<Reply<WorkspaceSnapshot>>;
  renameFolder(id: string, name: string): Promise<Reply<WorkspaceSnapshot>>;
  removeFolder(id: string): Promise<Reply<WorkspaceSnapshot>>;
  revealFolder(id: string): Promise<Reply<void>>;
  openShell(id: string): Promise<Reply<{ label: string; shell: string }>>;
  onChanged(callback: () => void): () => void;
  onAddRequested(callback: () => void): () => void;
}
