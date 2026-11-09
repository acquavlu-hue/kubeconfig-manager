import { useCallback, useEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronRight, CircleDot, Command, Copy, FileCode2, FolderOpen, GitBranch, Hexagon, KeyRound, Layers3, LoaderCircle, LockKeyhole, Palette, Plus, RefreshCw, Search, Server, Settings2, ShieldCheck, Star, Terminal, Upload, X } from 'lucide-react';
import { FolderHeader, FolderModal } from './Folders';
import { Modal } from './Modal';
import { shellQuote } from '../shared/shell-quote';
import type { AddContextInput, WorkspaceContext, DesktopAPI, ImportResult, Reply, ThemePreference, WorkspaceSnapshot } from '../shared/types';

declare global { interface Window { kcm?: DesktopAPI } }
type Page = 'contexts' | 'favorites' | 'vault' | 'cli' | 'settings';
const api = () => { if (!window.kcm) throw new Error('Apri l’app desktop con npm run dev oppure npm start.'); return window.kcm; };
async function unwrap<T>(promise: Promise<Reply<T>>): Promise<T> {
  const result = await promise;
  if ('error' in result) throw new Error(result.error);
  return result.data;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Operazione non riuscita.';
const shortPath = (path: string) => path.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/');
function Logo({ small = false }: { small?: boolean }) {
  return <span className={`logo ${small ? 'small' : ''}`}><Hexagon size={small ? 23 : 29} strokeWidth={1.6} /><GitBranch className="logo-branch" size={small ? 12 : 15} strokeWidth={2} /></span>;
}

export default function App() {
  const [state, setState] = useState<WorkspaceSnapshot | null>(null);
  const [page, setPage] = useState<Page>('contexts');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<'add' | 'folder' | null>(null);
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState(false);
  const [openingShell, setOpeningShell] = useState('');
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const reload = useCallback(async () => {
    try { setState(await unwrap(api().snapshot())); setLoadError(''); }
    catch (error) { setLoadError(errorText(error)); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void reload(); return window.kcm?.onChanged(() => { void reload(); }); }, [reload]);
  useEffect(() => window.kcm?.onAddRequested(() => setModal(current => current ?? 'add')), []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    if (modal) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPage('contexts'); setTimeout(() => search.current?.focus(), 0); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [modal]);
  const current = state?.contexts.find(context => context.id === state.currentId);
  const contexts = state?.contexts ?? [];
  const scopedFolder = page === 'contexts' ? state?.folders.find(folder => folder.id === scope) : undefined;
  const filtered = contexts.filter(context => (!scopedFolder || context.folderId === scopedFolder.id) && (page !== 'favorites' || state?.favorites.includes(context.id)) && [context.name, context.cluster, context.namespace, context.server, context.folderName, context.relativePath].some(value => value.toLowerCase().includes(query.toLowerCase())));
  const detail = filtered.find(context => context.id === selected) ?? filtered.find(context => context.id === state?.currentId) ?? filtered[0];
  const problems = (scopedFolder ? [scopedFolder] : state?.folders ?? []).flatMap(folder => folder.issues.map(issue => ({ ...issue, folderName: folder.name })));
  const clusters = new Set(contexts.map(context => context.filePath + ':' + context.cluster)).size;

  const switchTo = async (id: string) => {
    setBusy(true);
    try { const result = await unwrap(api().switchContext(id)); setState(result); notify(`Contesto attivo: ${result.current}`); }
    catch (error) { notify(errorText(error), true); }
    finally { setBusy(false); }
  };
  const openShell = async (id: string) => {
    setOpeningShell(id);
    try { const result = await unwrap(api().openShell(id)); notify(`Shell isolata aperta: ${result.label}. Il contesto locale è invariato.`); }
    catch (error) { notify(errorText(error), true); }
    finally { setOpeningShell(''); }
  };
  const favorite = async (id: string) => {
    try { setState(await unwrap(api().favorite(id))); }
    catch (error) { notify(errorText(error), true); }
  };
  const chooseConfig = async () => {
    try { const result = await unwrap(api().chooseConfig()); if (result) { setState(result); setLoadError(''); setSelected(''); notify('Kubeconfig selezionato.'); } }
    catch (error) { notify(errorText(error), true); }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); notify('Copiato negli appunti.'); }
    catch { notify('Impossibile accedere agli appunti.', true); }
  };
  const nav = (id: Page, title: string, icon: React.ReactNode, end?: React.ReactNode) => <button className={`nav-item ${page === id && (id !== 'contexts' || !scopedFolder) ? 'active' : ''}`} onClick={() => { setPage(id); if (id === 'contexts') { setScope('all'); setSelected(''); } }}>{icon}<span>{title}</span>{end}</button>;
  const revealFolder = async (id: string) => { try { await unwrap(api().revealFolder(id)); } catch (error) { notify(errorText(error), true); } };
  const selectFolder = (id: string) => { setScope(id); setSelected(''); setQuery(''); setPage('contexts'); };
  const terminalCommand = platformShell() === 'powershell' ? 'kcm env --shell powershell | Invoke-Expression' : 'eval "$(kcm env)"';

  return <div className="app-shell">
    <aside className="sidebar" inert={modal !== null}>
      <div className="window-space" />
      <div className="brand"><Logo /><div>KubeContext<span>YOUR CLUSTER COMPANION</span></div></div>
      <div className="workspace"><span className="workspace-avatar">L</span><div>Workspace locale<small>Configurazione personale</small></div><ChevronRight size={14} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>
        {nav('contexts', 'Contesti', <Layers3 size={18} />, <span className="nav-count">{contexts.length}</span>)}
        {nav('favorites', 'Preferiti', <Star size={18} />, state && state.favorites.length > 0 ? <span className="nav-count">{contexts.filter(context => state.favorites.includes(context.id)).length}</span> : undefined)}
        {nav('vault', 'Vault', <ShieldCheck size={18} />, <span className="soon-dot" />)}
      </nav>
      <div className="folder-nav-heading"><span id="collections-heading">RACCOLTE</span><button className="icon-button" aria-label="Collega cartella" title="Collega cartella" onClick={() => setModal('folder')}><Plus size={15} /></button></div>
      <nav className="folder-nav" aria-labelledby="collections-heading">{state?.folders.map(folder => <button key={folder.id} className={`nav-item folder-nav-item ${page === 'contexts' && scope === folder.id ? 'active' : ''}`} title={folder.path} aria-label={`Cartella ${folder.name}`} onClick={() => selectFolder(folder.id)}><FolderOpen size={16} /><span>{folder.name}</span>{folder.issues.length > 0 && <span className="folder-warning-dot" />}<span className="nav-count">{folder.contextCount}</span></button>)}</nav>
      <div className="nav-label tools-label">STRUMENTI</div>
      <nav>{nav('cli', 'Accesso da CLI', <Terminal size={18} />)}{nav('settings', 'Preferenze', <Settings2 size={18} />)}</nav>
      <div className="sidebar-bottom">
        <div className="tray-tip"><Command size={19} /><strong>Un contesto, un gesto.</strong><p>Apri l’app da ovunque con</p><kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ⇧ K</kbd></div>
        <div className="local-status"><span className="status-dot" /><span>Tutto sul tuo dispositivo</span><LockKeyhole size={12} /></div>
        <div className="version">KubeContext <span>v{version}</span></div>
      </div>
    </aside>

    <main className="main" inert={modal !== null}>
      <header className="topbar"><span>Workspace locale</span><ChevronRight size={13} /><strong>{{ contexts: 'Contesti', favorites: 'Preferiti', vault: 'Vault', cli: 'Accesso da CLI', settings: 'Preferenze' }[page]}</strong><div className="topbar-end"><span className="local-pill"><span className="status-dot" />LOCALE</span><span className="avatar">K</span></div></header>
      <div className="page-content">
        {loadError && <div className="error-banner" role="alert"><div><strong>Impossibile leggere il kubeconfig</strong><span>{loadError}</span></div><button className="button secondary" onClick={chooseConfig}>Scegli file</button><button className="icon-button" aria-label="Riprova" onClick={reload}><RefreshCw size={16} /></button></div>}
        {(page === 'contexts' || page === 'favorites') && <>
          <div className="page-heading"><div><div className="eyebrow">KUBERNETES, SENZA ATTRITO</div><h1>{page === 'favorites' ? 'I tuoi preferiti' : scopedFolder?.name ?? 'I tuoi contesti'}<span className="heading-dot">.</span></h1><p>Passa al cluster giusto e riprendi da dove eri rimasto.</p></div><div className="heading-actions"><button className="button secondary" onClick={() => setModal('folder')}><FolderOpen size={16} />Collega cartella</button>{scopedFolder?.kind === 'filesystem' ? <button className="button primary" onClick={() => revealFolder(scopedFolder.id)}><FolderOpen size={17} />Apri cartella</button> : <button className="button primary" onClick={() => setModal('add')}><Plus size={17} />Aggiungi contesto</button>}</div></div>
          {scopedFolder && <FolderHeader folder={scopedFolder} onReveal={() => revealFolder(scopedFolder.id)} onRename={async name => { setState(await unwrap(api().renameFolder(scopedFolder.id, name))); }} onRemove={async () => { setState(await unwrap(api().removeFolder(scopedFolder.id))); setScope('all'); setSelected(''); notify('Cartella scollegata. Nessun file eliminato.'); }} />}
          {problems.length > 0 && <details className="folder-problems"><summary>{problems.length} {problems.length === 1 ? 'problema di lettura' : 'problemi di lettura'} · Gli altri kubeconfig restano disponibili</summary>{problems.map((issue, index) => <div key={index}><strong>{issue.folderName}</strong><code>{issue.path}</code><span>{issue.message}</span></div>)}</details>}

          <section className="current-card" aria-label="Contesto attivo">
            <div className="current-illustration"><Hexagon size={51} strokeWidth={1} /><GitBranch size={24} /></div>
            <div className="current-info"><div className="current-label"><span className="status-dot" />CONTESTO ATTIVO{current ? ` · ${current.folderName}` : ''}</div><h2>{current?.name || (state?.current ? state.current : 'Pronto al primo switch')}</h2><div className="current-meta">{current ? <><Server size={12} /><span>{current.cluster}</span><span className="meta-separator">/</span><span>namespace</span><strong>{current.namespace}</strong></> : <span>{state?.current ? 'Il contesto selezionato non è presente nel file.' : 'Aggiungi un kubeconfig e scegli il tuo ambiente.'}</span>}</div></div>
            <div className="current-right"><span className="current-badge"><CircleDot size={13} />{current ? 'Selezionato in kubeconfig' : 'Nessun contesto selezionato'}</span><span>Sincronizzato con CLI e tray</span></div>
          </section>
          {current && current.folderId !== 'standard' && <div className="shell-banner"><Terminal size={15} /><span>Il file del cliente resta separato. Per usarlo in questa shell:</span><button onClick={() => copy(terminalCommand)} title="Copia comando per il terminale"><code>{terminalCommand}</code><Copy size={13} /></button></div>}

          <div className="stats"><div><Layers3 size={17} /><strong>{contexts.length.toString().padStart(2, '0')}</strong><span>contesti disponibili</span></div><div><Server size={17} /><strong>{clusters.toString().padStart(2, '0')}</strong><span>cluster</span></div><div><Star size={17} /><strong>{contexts.filter(context => state?.favorites.includes(context.id)).length.toString().padStart(2, '0')}</strong><span>preferiti</span></div><span className="stats-hint"><ShieldCheck size={14} />Backup prima di ogni modifica</span></div>

          <div className="contexts-layout">
            <section className="context-list">
              <div className="list-toolbar"><label className="search-box"><Search size={17} /><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca contesti, cluster, namespace…" aria-label="Cerca contesti" /><kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd></label><button className="icon-button refresh-button" title="Aggiorna contesti" aria-label="Aggiorna contesti" onClick={reload}><RefreshCw size={16} /></button></div>
              <div className="table-head"><span>CONTESTO / CLUSTER</span><span>NAMESPACE</span><span /></div>
              {!loaded ? <div className="empty-state"><LoaderCircle className="spin" size={28} /><p>Caricamento contesti…</p></div> : !filtered.length ? <div className="empty-state"><div className="empty-graphic"><Hexagon size={58} strokeWidth={1} /><Layers3 size={25} /></div><h3>{query ? 'Nessun risultato' : page === 'favorites' ? 'Tieni i tuoi ambienti a portata di mano' : 'Il tuo prossimo cluster parte da qui'}</h3><p>{query ? 'Prova con un altro nome o namespace.' : page === 'favorites' ? 'Seleziona la stella accanto a un contesto.' : scopedFolder?.kind === 'filesystem' ? 'Aggiungi file kubeconfig nella cartella del cliente. Appariranno qui automaticamente.' : 'Importa un file kubeconfig, incollalo oppure crea un contesto.'}</p>{!query && page !== 'favorites' && <button className="button secondary" onClick={() => scopedFolder?.kind === 'filesystem' ? revealFolder(scopedFolder.id) : setModal('add')}><Plus size={15} />{scopedFolder?.kind === 'filesystem' ? 'Apri cartella cliente' : 'Aggiungi il primo contesto'}</button>}</div> : <div className="context-rows">{filtered.map(context => <div key={context.id} data-context-id={context.id} className={`context-row ${detail?.id === context.id ? 'selected' : ''}`}>
                <button className={`favorite-button ${state?.favorites.includes(context.id) ? 'is-favorite' : ''}`} aria-label={`${state?.favorites.includes(context.id) ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti ${context.name}`} onClick={() => favorite(context.id)}><Star size={16} fill={state?.favorites.includes(context.id) ? 'currentColor' : 'none'} /></button>
                <button className="row-content" onClick={() => setSelected(context.id)} onDoubleClick={() => { if (!busy) void switchTo(context.id); }}><span className={`context-symbol ${context.id === state?.currentId ? 'active' : ''}`}><Hexagon size={20} /></span><span className="context-name"><strong>{context.name}</strong><small title={context.filePath}>{context.folderName} · {context.relativePath} · {context.cluster}</small></span><span className="namespace-tag">{context.namespace}</span><span className={`row-state ${context.id === state?.currentId ? 'is-active' : ''}`}>{context.id === state?.currentId ? <Check size={16} /> : <ChevronRight size={16} />}</span></button>
              </div>)}</div>}
              <div className="list-footer"><span>{filtered.length} {filtered.length === 1 ? 'contesto' : 'contesti'}{query ? ` su ${contexts.length}` : ''}</span><span>Doppio clic per attivare<ArrowRight size={12} /></span></div>
            </section>
            <aside className="detail-panel">{detail ? <ContextDetail key={detail.id + detail.namespace} context={detail} active={detail.id === state?.currentId} busy={busy} openingShell={openingShell !== ''} onShell={() => openShell(detail.id)} onCopyShell={() => copy(contextCommand(detail, 'shell'))} onSwitch={() => switchTo(detail.id)} onNamespace={async namespace => { try { setState(await unwrap(api().setNamespace(detail.id, namespace))); notify('Namespace aggiornato.'); } catch (error) { notify(errorText(error), true); } }} onCopy={() => copy(contextCommand(detail))} /> : <div className="detail-placeholder"><CircleDot size={24} /><h3>Ogni dettaglio al suo posto</h3><p>Seleziona un contesto per vedere cluster, endpoint e namespace.</p></div>}</aside>
          </div>
          <div className="file-footer"><FileCode2 size={14} /><span>KUBECONFIG</span><button title={state?.activePath} onClick={() => setPage('settings')}>{state ? shortPath(state.activePath) : 'In attesa di configurazione'}</button><span className="footer-spacer" /><span className="status-dot" />{state?.exists ? 'File locale' : 'Creato al primo import'}</div>
        </>}

        {page === 'vault' && <><PageHeading eyebrow="CONNESSIONI" title="Il tuo Vault, qui." description="Un unico posto anche per i kubeconfig della tua organizzazione." /><section className="vault-card"><div className="vault-art"><ShieldCheck size={60} strokeWidth={1.1} /><span><LockKeyhole size={20} /></span></div><span className="coming-badge">INTEGRAZIONE PREVISTA</span><h2>Connetteremo il tuo Vault.</h2><p>Il collegamento al vault aziendale verrà aggiunto in un secondo momento. Nessun servizio remoto è attualmente connesso.</p><div className="vault-steps"><span><CheckCheck size={17} />Gestore di contesti condiviso</span><span><CheckCheck size={17} />Importazione con controllo conflitti</span><span className="muted"><KeyRound size={17} />Provider e autenticazione da integrare</span></div><button className="button secondary" onClick={() => setModal('add')}><Upload size={16} />Importa un kubeconfig locale</button></section></>}

        {page === 'cli' && <><PageHeading eyebrow="ANCHE DAL TERMINALE" title="Poche lettere. Fatto." description="Gli stessi contesti, direttamente nel tuo flusso di lavoro." /><div className="info-note"><Terminal size={18} /><p>Per usare <code>kcm</code>, esegui <code>npm link</code> nella cartella del progetto dopo <code>npm run build</code>. È richiesto Node.js 22.12 o successivo.</p></div><section className="command-list">{[
          ['Vedi tutti i contesti', 'kcm list', 'Aggiungi --json per integrarlo nei tuoi script.'],
          ['Apri una shell isolata', detail ? contextCommand(detail, 'shell') : 'kcm shell dev --folder Acme', 'Prompt con cliente e contesto. Nessuna modifica al kubeconfig originale o alla selezione locale.'],
          ['Cambia ambiente', detail ? contextCommand(detail) : 'kcm use --folder standard -- il-tuo-contesto', 'La selezione si aggiorna anche nell’app e nel menu tray.'],
          ['Collega un cliente', 'kcm folder add Acme ./clienti/acme', 'I file restano separati dal kubeconfig standard.'],
          ['Usa il cliente nel terminale', terminalCommand, 'Eseguilo dopo lo switch tra file: una shell aperta mantiene il proprio ambiente.'],
          ['Importa un kubeconfig', 'kcm import ./config.yaml --prefix team', 'Un prefisso evita collisioni con nomi già presenti.'],
          ['Aggiungi un contesto', 'kcm add dev --server https://localhost:6443', 'Puoi specificare --namespace, --ca e --token-stdin.'],
          ['Scegli il namespace', 'kcm namespace staging', 'Modifica il namespace del contesto attivo.'],
          ['Abilita il completamento zsh', 'source <(kcm completion zsh)', 'Disponibile anche per bash e fish.'],
        ].map(([title, command, hint]) => <div className="command-item" key={title}><div><h3>{title}</h3><p>{hint}</p></div><div className="code-line"><span>$</span><code>{command}</code><button className="icon-button" aria-label={`Copia ${title}`} onClick={() => copy(command)}><Copy size={15} /></button></div></div>)}</section></>}

        {page === 'settings' && <><PageHeading eyebrow="IL TUO WORKSPACE" title="Tutto sotto controllo." description="Il file standard e le cartelle clienti restano separati." /><AppearanceSettings notify={notify} /><section className="settings-card"><div className="section-heading"><FileCode2 size={21} /><div><h3>Kubeconfig standard</h3><p>L’app modifica questo file. Anche kubectl lo userà se punta allo stesso percorso.</p></div></div><code className="path-display">{state?.path || 'Nessun file selezionato'}</code><div className="button-row"><button className="button secondary" onClick={chooseConfig}><FolderOpen size={16} />Scegli un altro file</button><button className="button quiet" onClick={async () => { try { await unwrap(api().revealConfig()); } catch (error) { notify(errorText(error), true); } }}>Mostra nella cartella<ArrowRight size={15} /></button></div><div className="settings-note">Il file scelto qui o con <code>kcm path</code> è condiviso tra app e CLI. <code>--kubeconfig</code> (CLI) e <code>KCM_KUBECONFIG</code> hanno precedenza. Prima di fissare un file Standard, KubeContext usa il singolo file indicato in <code>KUBECONFIG</code> o il percorso predefinito <code>~/.kube/config</code>.</div></section><section className="settings-card backup-card"><ShieldCheck size={23} /><div><h3>Un backup prima di ogni modifica</h3><p>I backup vengono salvati accanto al kubeconfig con suffisso <code>.backup-…</code>. Kubeconfig e backup sono scritti con permessi privati sui sistemi POSIX. I backup possono contenere credenziali: gestiscili come il file originale.</p></div></section><section className="settings-card backup-card"><Command size={23} /><div><h3>Sempre a portata di mano</h3><p>Chiudendo la finestra, KubeContext resta nella barra di sistema. Usa <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ⇧ K</kbd> per riaprirlo, oppure il menu tray per cambiare contesto. Per terminare l’app usa “Esci”.</p></div></section></>}
      </div>
    </main>
    {toast && <div inert={modal !== null} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleDot size={18} /> : <Check size={18} />}<span>{toast.message}</span><button className="icon-button" aria-label="Chiudi messaggio" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {modal === 'add' && <AddModal onClose={() => setModal(null)} onDone={async result => { const updated = await unwrap(api().snapshot()); setState(updated); setModal(null); setPage('contexts'); setScope('standard'); if (result.added[0]) setSelected(updated.contexts.find(context => context.folderId === 'standard' && context.name === result.added[0])?.id ?? ''); notify(result.added.length ? `${result.added.length} ${result.added.length === 1 ? 'contesto aggiunto' : 'contesti aggiunti'}. Scegli quale attivare.` : 'I contesti importati sono già presenti.'); }} />}
    {modal === 'folder' && <FolderModal onClose={() => setModal(null)} onPick={() => unwrap(api().pickFolder())} onAdd={async (name, path, recursive) => { const updated = await unwrap(api().addFolder(name, path, recursive)); setState(updated); setModal(null); const folder = updated.folders.find(item => item.name === name.trim()); if (folder) selectFolder(folder.id); notify('Cartella collegata. I kubeconfig restano separati.'); }} />}
  </div>;
}

function platformShell(): 'bash' | 'powershell' {
  return navigator.platform.toLowerCase().includes('win') ? 'powershell' : 'bash';
}
function AppearanceSettings({ notify }: { notify(message: string, error?: boolean): void }) {
  const [theme, setTheme] = useState<ThemePreference | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!window.kcm) return;
    unwrap(window.kcm.getTheme()).then(setTheme).catch(error => notify(errorText(error), true));
  }, [notify]);

  async function changeTheme(preference: ThemePreference) {
    setSaving(true);
    try {
      setTheme(await unwrap(api().setTheme(preference)));
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setSaving(false);
    }
  }

  return <section className="settings-card appearance-card">
    <div className="section-heading">
      <Palette size={21} />
      <div><h3>Aspetto</h3><p>Scegli il tema di KubeContext.</p></div>
    </div>
    <div className="theme-field">
      <label htmlFor="theme-preference">Tema</label>
      <select id="theme-preference" value={theme ?? 'system'} disabled={theme === null || saving}
        onChange={event => void changeTheme(event.target.value as ThemePreference)}>
        <option value="system">Sistema</option>
        <option value="light">Chiaro</option>
        <option value="dark">Scuro</option>
      </select>
    </div>
  </section>;
}

function contextCommand(context: WorkspaceContext, command: 'use' | 'shell' = 'use'): string {
  const quote = (value: string) => shellQuote(value, platformShell());
  return `kcm ${command} --folder ${quote(context.folderId)} --file ${quote(context.filePath)} -- ${quote(context.name)}`;
}
function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading standalone"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div></div>;
}
function ContextDetail({ context, active, busy, openingShell, onShell, onCopyShell, onSwitch, onNamespace, onCopy }: { context: WorkspaceContext; active: boolean; busy: boolean; openingShell: boolean; onShell(): void; onCopyShell(): void; onSwitch(): void; onNamespace(value: string): Promise<void>; onCopy(): void }) {
  const [namespace, setNamespace] = useState(context.namespace);
  const [saving, setSaving] = useState(false);
  return <><div className="detail-heading"><span>DETTAGLI CONTESTO</span><CircleDot size={14} /></div><div className="detail-symbol"><Hexagon size={30} strokeWidth={1.5} /></div><h3 className="detail-name">{context.name}</h3><span className={`detail-status ${active ? 'active' : ''}`}><span className="status-dot" />{active ? 'Contesto attivo' : 'Disponibile'}</span><div className="isolated-actions"><button className="button primary" disabled={openingShell} onClick={onShell}>{openingShell ? <LoaderCircle className="spin" size={16} /> : <Terminal size={16} />}{openingShell ? 'Apertura…' : 'Apri shell isolata'}</button><span className="isolated-shell-note">Non cambia il contesto locale</span><button className="button quiet" onClick={onCopyShell}><Copy size={14} />Copia comando shell</button></div><dl className="detail-fields"><div><dt><FolderOpen size={13} />Cliente / file</dt><dd title={context.filePath}>{context.folderName}<br /><code>{context.relativePath}</code></dd></div><div><dt><Server size={13} />Cluster</dt><dd>{context.cluster}</dd></div><div><dt><KeyRound size={13} />Utente</dt><dd>{context.user || 'Non specificato'}</dd></div><div><dt><GitBranch size={13} />API server</dt><dd className="endpoint">{context.server || 'Non specificato'}</dd></div></dl><form className="namespace-form" onSubmit={async event => { event.preventDefault(); setSaving(true); try { await onNamespace(namespace); } finally { setSaving(false); } }}><label htmlFor="detail-namespace">Namespace</label><div><input id="detail-namespace" aria-label="Namespace del contesto" required maxLength={63} value={namespace} onChange={event => setNamespace(event.target.value)} /><button className="icon-button" type="submit" aria-label="Salva namespace" disabled={saving || namespace === context.namespace}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}</button></div></form><div className="detail-actions"><button className={`button ${active ? 'already-active' : 'secondary'}`} disabled={active || busy} onClick={onSwitch}>{busy ? <LoaderCircle className="spin" size={16} /> : active ? <CheckCheck size={16} /> : <ArrowRight size={16} />}{active ? 'Già attivo' : 'Attiva contesto'}</button><button className="button quiet" onClick={onCopy}><Copy size={14} />Copia comando CLI</button></div></>;
}

function AddModal({ onClose, onDone }: { onClose(): void; onDone(result: ImportResult): Promise<void> }) {
  const [tab, setTab] = useState<'file' | 'paste' | 'manual'>('file');
  const [prefix, setPrefix] = useState('');
  const [content, setContent] = useState('');
  const [input, setInput] = useState<AddContextInput>({ name: '', server: '', namespace: 'default', token: '', certificateAuthority: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = tab === 'file' ? await unwrap(api().importFile(prefix)) : tab === 'paste' ? await unwrap(api().importText(content, prefix)) : await unwrap(api().addContext(input));
      if (result) await onDone(result);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  const update = (key: keyof AddContextInput, value: string) => setInput(current => ({ ...current, [key]: value }));
  return <Modal titleId="add-title" busy={busy} onClose={onClose}>
    <div className="modal-heading"><div className="modal-icon"><Plus size={23} /></div><button className="icon-button" aria-label="Chiudi" disabled={busy} onClick={onClose}><X size={19} /></button></div><h2 id="add-title">Un nuovo contesto.</h2><p className="modal-subtitle">Aggiungi contesti al kubeconfig standard. Per un cliente, collega la sua cartella.</p><div className="modal-tabs" role="tablist" aria-label="Metodo di aggiunta">{([['file', 'Importa file', FolderOpen], ['paste', 'Incolla YAML', FileCode2], ['manual', 'Crea contesto', Plus]] as const).map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={id === tab} disabled={busy} onClick={() => { setTab(id); setError(''); }} className={id === tab ? 'active' : ''}><Icon size={15} />{label}</button>)}</div><form onSubmit={submit}>
    {tab === 'file' && <div className="upload-zone"><div><ArrowDownToLine size={28} strokeWidth={1.5} /></div><h3>Il tuo kubeconfig, al posto giusto.</h3><p>Scegli un file YAML o JSON dal tuo dispositivo.<br />I contesti esistenti vengono mantenuti.</p><span>.yaml &nbsp; .yml &nbsp; .json &nbsp; config</span></div>}
    {tab === 'paste' && <label className="field-label">Contenuto kubeconfig<textarea className="yaml-input" required spellCheck={false} value={content} onChange={event => setContent(event.target.value)} placeholder={'apiVersion: v1\nkind: Config\nclusters: …\ncontexts: …\nusers: …'} /><small>Usa certificati e chiavi incorporati. Per riferimenti a file locali, importa il file originale.</small></label>}
    {tab !== 'manual' && <label className="field-label prefix-field">Prefisso dei nomi <span>facoltativo</span><input value={prefix} maxLength={80} onChange={event => setPrefix(event.target.value)} placeholder="es. team-platform" pattern="[a-zA-Z0-9_.\-]*" /><small>Diventa <code>{prefix || 'prefisso'}/nome-contesto</code>. Utile per evitare conflitti.</small></label>}
    {tab === 'manual' && <div className="manual-fields"><div className="form-grid"><label className="field-label">Nome contesto<input autoComplete="off" required maxLength={200} value={input.name} onChange={event => update('name', event.target.value)} placeholder="es. sviluppo-eu" /></label><label className="field-label">Namespace<input required maxLength={63} value={input.namespace} onChange={event => update('namespace', event.target.value)} placeholder="default" /></label></div><label className="field-label">API server<input type="url" required value={input.server} onChange={event => update('server', event.target.value)} placeholder="https://api.example.com:6443" /></label><label className="field-label">Bearer token <span>facoltativo</span><input type="password" autoComplete="off" value={input.token} onChange={event => update('token', event.target.value)} placeholder="Token di accesso al cluster" /></label><details><summary>Certificato CA personalizzato</summary><label className="field-label"><textarea spellCheck={false} value={input.certificateAuthority} onChange={event => update('certificateAuthority', event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" aria-label="Certificato CA PEM" /></label></details></div>}
    {error && <div className="modal-error" role="alert">{error}</div>}
    <div className="import-note"><ShieldCheck size={16} /><span>Backup automatico. Il contesto attivo resta invariato.</span></div><div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annulla</button><button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : tab === 'file' ? <FolderOpen size={16} /> : <Plus size={16} />}{busy ? 'Importazione…' : tab === 'file' ? 'Scegli e importa file' : tab === 'paste' ? 'Importa contesti' : 'Crea contesto'}</button></div>
    </form>
  </Modal>;
}
