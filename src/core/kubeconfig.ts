import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Document, isAlias, isNode, parseDocument, visit } from 'yaml';
import { atomicWrite, checkFileSize, optionalRead, withFileLock } from './files';
import { favoritesFor, readSettings } from './settings';
import type { Settings } from './settings';
import type { AddContextInput, ContextInfo, ImportResult, Snapshot } from '../shared/types';

type Entry = { name: string; [key: string]: unknown };
type Body = Record<string, unknown>;
type Config = { [key: string]: unknown; clusters: Entry[]; users: Entry[]; contexts: Entry[]; 'current-context': string };
const emptyConfig = (): Config => ({ apiVersion: 'v1', kind: 'Config', clusters: [], users: [], contexts: [], 'current-context': '' });
const body = (entry: Entry, key: string): Body => entry[key] as Body;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
function publicEndpoint(value: unknown): string {
  const source = text(value);
  if (!source) return '';
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol)) return '(endpoint non valido)';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return '(endpoint non valido)'; }
}

function parse(raw: string): { document: Document; config: Config } {
  const document = parseDocument(raw, { uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) throw new Error('Kubeconfig YAML/JSON non valido. Controlla la sintassi e le chiavi duplicate.');
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 50 }); }
  catch { throw new Error('Kubeconfig non valido: troppi riferimenti YAML.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Il kubeconfig deve essere un oggetto YAML/JSON.');
  const config = value as Config;
  if (config.apiVersion !== 'v1' || config.kind !== 'Config') throw new Error('Sono richiesti apiVersion: v1 e kind: Config.');
  for (const [key, inner] of [['clusters', 'cluster'], ['users', 'user'], ['contexts', 'context']] as const) {
    if (config[key] == null) config[key] = [];
    if (!Array.isArray(config[key])) throw new Error(`Il campo ${key} deve essere una lista.`);
    const names = new Set<string>();
    for (const entry of config[key]) {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim() || !entry[inner] || typeof entry[inner] !== 'object' || Array.isArray(entry[inner])) {
        throw new Error(`Voce non valida in ${key}.`);
      }
      if (names.has(entry.name)) throw new Error(`Nome duplicato in ${key}: ${entry.name}`);
      names.add(entry.name);
      if (inner === 'context') {
        for (const field of ['cluster', 'user', 'namespace']) {
          const item = body(entry, inner)[field];
          if (item != null && typeof item !== 'string') throw new Error(`Campo context.${field} non valido.`);
        }
      }
    }
  }
  if (config['current-context'] == null) config['current-context'] = '';
  if (typeof config['current-context'] !== 'string') throw new Error('current-context deve essere una stringa.');
  const clusterNames = new Set(config.clusters.map(entry => entry.name));
  const userNames = new Set(config.users.map(entry => entry.name));
  for (const entry of config.contexts) {
    const context = body(entry, 'context');
    if (!clusterNames.has(text(context.cluster))) throw new Error(`Cluster mancante per il contesto “${entry.name}”.`);
    if (context.user && !userNames.has(text(context.user))) throw new Error(`Utente mancante per il contesto “${entry.name}”.`);
  }
  return { document, config };
}

function summaries(config: Config): ContextInfo[] {
  const clusters = new Map(config.clusters.map(entry => [entry.name, entry]));
  return config.contexts.map(entry => {
    const context = body(entry, 'context');
    const cluster = clusters.get(text(context.cluster));
    return {
      name: entry.name, cluster: text(context.cluster), user: text(context.user),
      namespace: text(context.namespace) || 'default', server: cluster ? publicEndpoint(body(cluster, 'cluster').server) : '',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Relative credentials belong to the source kubeconfig, not the destination.
function resolveReferences(config: Config, sourceDirectory?: string): void {
  for (const [entries, key, fields] of [
    [config.clusters, 'cluster', ['certificate-authority']],
    [config.users, 'user', ['client-certificate', 'client-key', 'tokenFile']],
  ] as const) {
    for (const entry of entries) {
      const data = body(entry, key);
      for (const field of fields) {
        if (data[field] == null) continue;
        if (typeof data[field] !== 'string') throw new Error(`Riferimento ${field} non valido.`);
        if (data[field] === '') continue;
        if (!sourceDirectory) throw new Error(`L'importazione da testo richiede credenziali incorporate; trovato ${field}. Importa il file originale.`);
        if (!isAbsolute(data[field] as string)) data[field] = resolve(sourceDirectory, data[field] as string);
      }
      const exec = data.exec as Body | undefined;
      if (exec && typeof exec.command === 'string' && /[\\/]/.test(exec.command) && !isAbsolute(exec.command)) {
        if (!sourceDirectory) throw new Error('Il comando exec relativo richiede il file originale.');
        exec.command = resolve(sourceDirectory, exec.command);
      }
    }
  }
}

function prefixNames(config: Config, prefix: string): void {
  if (!prefix) return;
  if (!/^[a-zA-Z0-9_.-]+$/.test(prefix) || prefix.length > 80) throw new Error('Il prefisso può contenere lettere, numeri, punti, trattini e underscore (max 80).');
  for (const key of ['clusters', 'users', 'contexts'] as const) {
    config[key] = config[key].map(entry => ({ ...entry, name: `${prefix}/${entry.name}` }));
  }
  for (const entry of config.contexts) {
    const context = { ...body(entry, 'context') };
    context.cluster = `${prefix}/${context.cluster}`;
    if (context.user) context.user = `${prefix}/${context.user}`;
    entry.context = context;
  }
}

// Editing an anchor in place would also change every alias that references it.
function assertUnshared(document: Document, nodes: unknown[]): void {
  const anchors = new Set(nodes.filter(isNode).map(node => node.anchor).filter(Boolean));
  if (!anchors.size) return;
  visit(document, {
    Alias(_, alias) {
      if (anchors.has(alias.source) && nodes.includes(alias.resolve(document))) {
        throw new Error('Il campo usa un’ancora YAML condivisa. Espandi gli alias prima di modificarlo.');
      }
    },
  });
}

export class KubeconfigManager {
  constructor(public readonly path: string) {}

  async snapshot(settings?: Settings): Promise<Snapshot> {
    const raw = await optionalRead(this.path);
    const config = raw === undefined ? emptyConfig() : parse(raw).config;
    return { path: this.path, current: config['current-context'], contexts: summaries(config), favorites: favoritesFor(settings ?? await readSettings(), this.path), exists: raw !== undefined };
  }

  /** Read-only, single-context snapshot for a disposable shell. */
  async isolatedConfig(name: string): Promise<string> {
    const raw = await optionalRead(this.path);
    if (raw === undefined) throw new Error('Il kubeconfig di origine non è più disponibile.');
    const { config } = parse(raw);
    const context = config.contexts.find(entry => entry.name === name);
    if (!context) throw new Error(`Contesto non trovato: ${name}`);
    const reference = body(context, 'context');
    const isolated = emptyConfig();
    isolated.contexts = [context];
    isolated.clusters = config.clusters.filter(entry => entry.name === reference.cluster);
    isolated.users = config.users.filter(entry => entry.name === reference.user);
    isolated['current-context'] = name;
    resolveReferences(isolated, dirname(resolve(this.path)));
    const source = new Document(isolated).toString({ lineWidth: 0 });
    checkFileSize(Buffer.byteLength(source));
    return source;
  }

  private async mutate<T>(edit: (document: Document, config: Config) => T): Promise<{ value: T; backup?: string }> {
    return withFileLock(this.path, async path => {
      const original = await optionalRead(path);
      const { document, config } = parse(original ?? new Document(emptyConfig()).toString());
      const value = edit(document, config);
      const updated = document.toString({ lineWidth: 0 });
      if (original === updated) return { value };
      checkFileSize(Buffer.byteLength(updated));
      // Detect writers that do not participate in the app's lock, such as kubectl.
      if (await optionalRead(path) !== original) throw new Error('Il kubeconfig è stato modificato da un altro programma. Riprova.');
      let backup: string | undefined;
      if (original !== undefined) {
        backup = `${path}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
        await atomicWrite(backup, original);
      }
      await atomicWrite(path, updated);
      return { value, backup };
    });
  }

  async use(name: string, settings?: Settings): Promise<Snapshot> {
    await this.mutate((document, config) => {
      if (!config.contexts.some(entry => entry.name === name)) throw new Error(`Contesto non trovato: ${name}`);
      if (config['current-context'] === name) return;
      assertUnshared(document, [document.get('current-context', true)]);
      document.set('current-context', name);
    });
    return this.snapshot(settings);
  }

  async namespace(name: string, namespace: string): Promise<Snapshot> {
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63) throw new Error('Namespace non valido: usa un nome DNS di massimo 63 caratteri.');
    await this.mutate((document, config) => {
      const index = config.contexts.findIndex(entry => entry.name === name);
      if (index < 0) throw new Error(`Contesto non trovato: ${name}`);
      const entryPath = ['contexts', index];
      const contextPath = [...entryPath, 'context'];
      const namespacePath = [...contextPath, 'namespace'];
      const list = document.get('contexts', true);
      const entry = document.getIn(entryPath, true);
      const context = document.getIn(contextPath, true);
      if (isAlias(list) || isAlias(entry)) throw new Error('La lista o il contesto usa un alias YAML. Espandi gli alias prima di modificarlo.');
      assertUnshared(document, [list, entry, context, document.getIn(namespacePath, true)]);
      if (isAlias(context)) document.setIn(contextPath, { ...body(config.contexts[index], 'context'), namespace });
      else document.setIn(namespacePath, namespace);
    });
    return this.snapshot();
  }

  async importFile(path: string, prefix = ''): Promise<ImportResult> {
    const source = await optionalRead(path);
    if (source === undefined) throw new Error(`File non trovato: ${path}`);
    return this.import(source, prefix, dirname(resolve(path)));
  }
  async importText(source: string, prefix = ''): Promise<ImportResult> { return this.import(source, prefix); }

  private async import(source: string, prefix: string, directory?: string): Promise<ImportResult> {
    checkFileSize(Buffer.byteLength(source));
    const incoming = parse(source).config;
    if (!incoming.contexts.length) throw new Error('Il file non contiene contesti.');
    resolveReferences(incoming, directory);
    prefixNames(incoming, prefix.trim());
    const result = await this.mutate((document, config) => {
      const added: string[] = [], skipped: string[] = [];
      for (const key of ['clusters', 'users', 'contexts'] as const) {
        const existingByName = new Map(config[key].map(entry => [entry.name, entry]));
        const additions = [];
        for (const entry of incoming[key]) {
          const existing = existingByName.get(entry.name);
          if (existing && !isDeepStrictEqual(existing, entry)) throw new Error(`Conflitto in ${key}: “${entry.name}”. Usa un prefisso per importarlo con un nome distinto.`);
          if (!existing) additions.push(entry);
          if (key === 'contexts') (existing ? skipped : added).push(entry.name);
        }
        if (additions.length) {
          const list = document.get(key, true);
          if (isAlias(list)) throw new Error(`La lista ${key} usa un alias YAML. Espandi gli alias prima di importare.`);
          assertUnshared(document, [list]);
          if (document.get(key) == null) document.set(key, []);
          for (const entry of additions) document.addIn([key], entry);
        }
      }
      // Import never changes the active context. A first import also requires an explicit switch.
      return { added, skipped };
    });
    return { ...result.value, backup: result.backup };
  }

  async add(input: AddContextInput): Promise<ImportResult> {
    const name = input.name.trim();
    if (!name || name.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(name)) throw new Error('Inserisci un nome di contesto valido (max 200 caratteri).');
    let server: URL;
    try { server = new URL(input.server); } catch { throw new Error('Indirizzo API server non valido.'); }
    if (!['https:', 'http:'].includes(server.protocol) || !server.hostname || server.username || server.password || server.hash || server.search) throw new Error('Usa un URL HTTP/HTTPS senza credenziali, query o frammenti.');
    const namespace = input.namespace?.trim() || 'default';
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63) throw new Error('Namespace non valido.');
    const cluster: Body = { server: input.server.trim() };
    if (input.certificateAuthority?.trim()) {
      if (!input.certificateAuthority.includes('-----BEGIN CERTIFICATE-----')) throw new Error('La CA deve essere un certificato PEM.');
      cluster['certificate-authority-data'] = Buffer.from(input.certificateAuthority).toString('base64');
    }
    const config = emptyConfig();
    config.clusters.push({ name, cluster });
    config.users.push({ name, user: input.token ? { token: input.token } : {} });
    config.contexts.push({ name, context: { cluster: name, user: name, namespace } });
    return this.importText(new Document(config).toString());
  }
}
