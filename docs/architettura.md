# Architettura di KubeContext

KubeContext ha due punti di ingresso. Electron gestisce finestra, tray e dialoghi nativi. `kcm` gestisce argomenti, output ed exit code. Entrambi usano lo stesso core TypeScript.

| Percorso | Responsabilità |
| --- | --- |
| `src/core/kubeconfig.ts` | Parsing YAML/JSON, validazione, import, modifica di un file e preparazione della copia per la shell. |
| `src/core/workspace.ts` | Risoluzione delle raccolte, scansione, selezione dei contesti e coordinamento dello switch. |
| `src/core/settings.ts` | Percorso Standard, tema, raccolte, file attivo e preferiti. |
| `src/core/files.ts` | Lettura con limite di dimensione, lock per percorso canonico e scrittura atomica. |
| `src/core/isolated-shell.ts` | Preparazione della sessione temporanea, scelta del terminale e pulizia. |
| `src/main/` | Processo Electron e preload. Il main convalida mittente e argomenti IPC. |
| `src/renderer/` | Interfaccia React, dialoghi e stili. Il renderer accede al core tramite `window.kcm`. |
| `src/shared/` | Tipi del bridge e quoting condiviso fra renderer, CLI e shell. |
| `src/cli.ts` | Comando `kcm`, con modalità workspace e modalità a file esplicito. |

## Identità e selezione

L’identità di un contesto nel workspace combina ID della raccolta, percorso assoluto del file e nome nel kubeconfig. La UI e la tray inviano l’ID esatto. La CLI risolve i nomi nel perimetro di `--folder` e `--file` e segnala le ambiguità. Il file Standard è una sorgente riservata e viene escluso dalle scansioni delle raccolte.

Ogni snapshot legge una volta le preferenze e le riusa per percorso Standard, raccolte, file attivo e preferiti. Il main effettua il polling per aggiornare tray e renderer quando cambiano i file o le preferenze. `activeFile` indica quale file fornisce il contesto attivo. Il nome effettivo viene letto dal suo `current-context`. L’assenza di `activeFile` indica Standard. Un file o contesto mancante viene segnalato nel workspace e `kcm current` termina con errore.

## Scritture e segreti

- Gli import uniscono le voci per nome. La modifica del documento YAML preserva i nodi esistenti. I riferimenti relativi non vuoti diventano assoluti quando un kubeconfig viene importato da file o copiato per una shell.
- Prima di sostituire un kubeconfig, il core verifica il limite di 10 MB e controlla che l’originale letto sia ancora presente con lo stesso contenuto. Crea un backup e usa un rename atomico nello stesso filesystem. I programmi esterni, incluso `kubectl`, possono scrivere senza partecipare al lock KubeContext.
- Lo switch nel workspace acquisisce prima il lock delle preferenze, verifica la sorgente, poi aggiorna il kubeconfig con il suo lock. Il puntatore `activeFile` viene salvato dopo lo switch. Le due scritture sono atomiche singolarmente. Un errore dopo la scrittura del kubeconfig può lasciare le preferenze precedenti.
- Gli snapshot contengono metadati. I kubeconfig, i backup e le copie temporanee possono contenere credenziali. Nella UI il testo incollato e i token inseriti passano al main soltanto per la richiesta di aggiunta. Il renderer usa sandbox, isolamento del contesto e una Content Security Policy.
- La shell isolata riceve una copia temporanea con un solo contesto, il cluster e l’eventuale utente. `KUBECONFIG`, `KCM_KUBECONFIG` e `KCM_SETTINGS` puntano alla sessione. La CLI o il launcher del terminale rimuove i file dopo l’uscita normale. I limiti relativi a profili e preferenze degli strumenti sono descritti nella [guida d’uso](../README.md#shell-isolata).

## Verifica locale

1. Esegui `npm test` per verificare il core e la CLI con file temporanei.
2. Esegui `npm run build` per controllare TypeScript e produrre `dist/`. `scripts/build.mjs` compila main, preload e CLI con esbuild. Vite compila il renderer.
3. Esegui `npm run test:e2e` in una sessione desktop per lo smoke test di Electron. Per verificare un pacchetto, imposta `KCM_EXECUTABLE` al percorso dell’eseguibile KubeContext.
4. Esegui `npm run package` per una cartella app o `npm run dist` per i pacchetti del sistema corrente. I workflow GitHub sono descritti nella [guida alla pubblicazione](pubblicazione.md).
