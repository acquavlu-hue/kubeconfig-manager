import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, LoaderCircle, Pencil, Unplug, X } from 'lucide-react';
import type { FolderInfo } from '../shared/types';

export function FolderHeader({ folder, onReveal, onRename, onRemove }: {
  folder: FolderInfo;
  onReveal(): void;
  onRename(name: string): Promise<void>;
  onRemove(): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setName(folder.name); setEditing(false); setConfirm(false); }, [folder.id, folder.name]);
  return <section className="folder-header">
    <div className="folder-header-icon"><FolderOpen size={23} /></div>
    <div className="folder-header-info">
      {editing ? <form className="folder-rename" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await onRename(name); setEditing(false); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }}>
        <input aria-label="Nuovo nome cartella" value={name} onChange={event => setName(event.target.value)} required maxLength={80} autoFocus />
        <button className="icon-button" type="submit" aria-label="Salva nome cartella" disabled={busy}><Check size={16} /></button>
        <button className="icon-button" type="button" aria-label="Annulla rinomina" onClick={() => { setName(folder.name); setEditing(false); }}><X size={16} /></button>
      </form> : <strong>{folder.kind === 'standard' ? 'Kubeconfig standard' : folder.name}</strong>}
      <code title={folder.path}>{folder.path}</code>
      <small>{folder.fileCount} {folder.fileCount === 1 ? 'file' : 'file'} · {folder.contextCount} contesti · {folder.kind === 'filesystem' ? folder.recursive ? 'Include sottocartelle' : 'Solo questa cartella' : 'Configurazione personale'}</small>
      {error && <span className="folder-inline-error" role="alert">{error}</span>}
    </div>
    {folder.kind === 'filesystem' && <div className="folder-header-actions">
      {confirm ? <><span>Nessun file verrà eliminato.</span><button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onRemove(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }}>Scollega cartella</button><button className="icon-button" aria-label="Annulla scollegamento" onClick={() => setConfirm(false)}><X size={16} /></button></> : <>
        <button className="icon-button" aria-label="Apri cartella cliente" title="Apri cartella" onClick={onReveal}><FolderOpen size={17} /></button>
        <button className="icon-button" aria-label="Rinomina cartella" title="Rinomina" onClick={() => setEditing(true)}><Pencil size={16} /></button>
        <button className="icon-button" aria-label="Scollega cartella" title="Scollega" onClick={() => setConfirm(true)}><Unplug size={17} /></button>
      </>}
    </div>}
  </section>;
}

export function FolderModal({ onClose, onPick, onAdd }: {
  onClose(): void;
  onPick(): Promise<string | null>;
  onAdd(name: string, path: string, recursive: boolean): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (!busy) onClose(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...ref.current!.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [busy, onClose]);
  const pick = async () => {
    try {
      const value = await onPick();
      if (!value) return;
      setPath(value);
      if (!name) setName(value.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 80) ?? 'Cliente');
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose(); }}>
    <div className="modal folder-modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="folder-title">
      <div className="modal-heading"><div className="modal-icon"><FolderOpen size={23} /></div><button className="icon-button" aria-label="Chiudi cartella" disabled={busy} onClick={onClose}><X size={19} /></button></div>
      <h2 id="folder-title">Uno spazio per ogni cliente.</h2>
      <p className="modal-subtitle">Collega una cartella di kubeconfig senza unirli a quelli standard.</p>
      <form onSubmit={async event => { event.preventDefault(); if (!path) { setError('Scegli una cartella.'); return; } setBusy(true); setError(''); try { await onAdd(name, path, recursive); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }}>
        <label className="field-label">Nome cliente o tenant<input required autoComplete="off" maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="es. Acme · Produzione" /></label>
        <div className="folder-picker"><FolderOpen size={24} /><div><strong>{path ? 'Cartella selezionata' : 'Scegli la cartella dei kubeconfig'}</strong><code>{path || 'I file restano nella loro posizione originale.'}</code></div><button className="button secondary" type="button" onClick={pick} disabled={busy}>Sfoglia…</button></div>
        <label className="checkbox-label"><input type="checkbox" checked={recursive} onChange={event => setRecursive(event.target.checked)} />Includi le sottocartelle</label>
        <div className="folder-explanation"><strong>File separati, contesti organizzati.</strong><p>La scansione non modifica i file. Quando attivi un contesto, cambia solo il current-context del suo kubeconfig, con backup automatico. Il kubeconfig standard resta separato.</p><p>Per usare il file selezionato in un terminale già aperto, esegui il comando mostrato dall’app.</p></div>
        {error && <div className="modal-error" role="alert">{error}</div>}
        <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annulla</button><button className="button primary" type="submit" disabled={busy || !path}>{busy ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={16} />}{busy ? 'Scansione…' : 'Collega cartella'}</button></div>
      </form>
    </div>
  </div>;
}
