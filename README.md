# KubeContext

App desktop per macOS, Windows e Linux per gestire i contesti Kubernetes da finestra, barra di sistema e CLI. Interfaccia in italiano, Electron + React + TypeScript. Non richiede `kubectl` per leggere o modificare i kubeconfig e non contatta i cluster.

## Avvio

Richiede Node.js **22.12+** e npm. Consigliato Node.js 24 LTS.

```sh
npm ci
npm run dev
```

Il primo `npm ci` scarica anche il runtime Electron. Se il download è stato saltato, eseguire `npx install-electron`. In sviluppo il renderer si aggiorna automaticamente; dopo modifiche al processo main o al core riavviare `npm run dev`.

Per usare la build di produzione:

```sh
npm run build
npm start
```

## Funzionalità

- Cartelle clienti/tenant collegate al filesystem, separate dal kubeconfig Standard.
- Lista, ricerca per nome/cluster/namespace/endpoint/cliente/file e preferiti.
- Switch del `current-context` nel file kubeconfig effettivo, da finestra, tray o CLI.
- Aggiunta da file YAML/JSON, testo incollato o creazione manuale con server, namespace, bearer token e CA PEM facoltativi.
- Importazione senza sovrascrivere nomi in conflitto. Un prefisso rinomina insieme contesti, cluster e utenti. Gli elementi identici vengono ignorati.
- Modifica del namespace e copia del comando CLI.
- Shell isolata per il contesto scelto, dalla finestra e da `kcm shell`, con prompt dedicato e nessuno switch locale.
- Menu tray con sottomenu per cliente, preferiti in cima, file di provenienza e selezione del contesto.
- Scorciatoia globale `Cmd/Ctrl+Shift+K` per mostrare l’app; `Cmd/Ctrl+K` nella finestra per cercare. La scorciatoia globale dipende dal sistema operativo e dalla disponibilità della combinazione.
- Scansione periodica delle cartelle e rilevamento delle modifiche esterne (circa 1,5 secondi per cartelle piccole), anche da `kubectl`.
- Backup prima di ogni modifica, scrittura atomica e lock condiviso fra app e CLI.

Chiudere la finestra lascia l’app nella tray. Per terminarla scegliere **Esci**. Su Linux la visibilità della tray dipende dal supporto del desktop environment/AppIndicator.

## CLI

Dopo la build, installare il comando nel proprio ambiente npm:

```sh
npm link
kcm --help
kcm list
kcm list --json
kcm use development
kcm shell development
kcm import ./team-config.yaml --prefix team
kcm add local --server https://127.0.0.1:6443 --namespace development
kcm namespace payments
kcm namespace staging --context development
kcm current
kcm path
kcm path /percorso/al/config
```

In alternativa, senza installazione globale: `node dist/cli.mjs list` oppure `npm run cli -- list`.

Il token per `kcm add` si passa con `--token-stdin` tramite stdin, evitando argomenti e cronologia shell. `--ca ./ca.pem` incorpora la CA. L’importazione conserva certificati, credenziali ed eventuali plugin `exec` del kubeconfig; non esegue i plugin. Per l’autenticazione a un cluster saranno comunque necessari gli strumenti richiesti dal suo kubeconfig.

Completamento shell (salvare nel proprio profilo se desiderato):

```sh
# zsh
source <(kcm completion zsh)
# bash
source <(kcm completion bash)
# fish
kcm completion fish | source
```

Per nomi che iniziano con `-`, usare il separatore: `kcm use -- '-nome'`.

## Cartelle clienti e tenant

Nella sidebar selezionare **Collega cartella**, assegnare un nome cliente e scegliere una directory. L'opzione **Includi le sottocartelle** è attiva per impostazione predefinita. **Contesti** mostra tutte le sorgenti; **Standard** e ciascun cliente filtrano la lista. Ogni contesto mostra cliente e file di provenienza. Si possono rinominare i gruppi o scollegarli senza eliminare alcun file.

Esempio di organizzazione:

```text
~/.kube/config                 # Standard: contesti personali
~/clienti/acme/
  sviluppo.yaml
  eu/produzione.kubeconfig
~/clienti/altro-tenant/
  config
```

Non avviene alcun merge fra questi file. La scansione è di sola lettura. Lo switch modifica solo il `current-context` del kubeconfig selezionato; il cambio namespace modifica solo il relativo contesto in quel file. Entrambe le operazioni creano un backup. Certificati e comandi con percorsi relativi restano relativi al file originale.

I nomi di contesti, cluster e utenti possono ripetersi fra clienti o fra file dello stesso cliente. Le identità usate dall'app includono cartella, file e nome. Dalla CLI, disambiguare con `--folder` e, se occorre, `--file`:

```sh
kcm folder add Acme ~/clienti/acme
kcm folder add "Altro tenant" ~/clienti/altro-tenant --no-recursive
kcm folder list
kcm list --folder Acme
kcm use dev --folder Acme
kcm use prod --folder Acme --file ~/clienti/acme/eu/produzione.kubeconfig
kcm namespace payments --context prod --folder Acme --file ~/clienti/acme/eu/produzione.kubeconfig
kcm folder rename Acme --name "Acme EU"
kcm folder remove "Acme EU"
```

`--folder` accetta nome o ID stabile del gruppo. Il nome `standard` identifica il kubeconfig personale. `kcm list --json` espone anche `id`, `folderId`, `filePath`, `currentId` e `activePath` per l'automazione. Nessuna credenziale viene esposta in questi metadata.

La scansione considera file senza estensione e file `.yaml`, `.yml`, `.json`, `.conf`, `.config`, `.kubeconfig`, `.kcfg`, `.cfg`. Ignora file/cartelle nascosti, `node_modules`, backup KubeContext, temporanei, lock e symlink. Le directory selezionate vengono normalizzate al percorso reale; i symlink all'interno non vengono seguiti. Limiti: 10 MB per file, 5000 elementi per cartella collegata e 20 livelli di sottocartelle. Un errore in un file viene indicato nel suo gruppo e non nasconde gli altri file validi.

Aggiunte e rimozioni di file vengono rilevate automaticamente. Se scompare il file attivo, l'app segnala il problema e richiede di selezionare un altro contesto; non passa silenziosamente a un altro cliente. I preferiti sono salvati per file e nome, quindi non si confondono fra clienti. La rinomina del gruppo mantiene identità e preferiti. Scollegare il gruppo attivo riporta la selezione dell'app a Standard senza modificare i file del cliente.

Il pulsante **Aggiungi contesto**, `kcm add` e `kcm import` operano sul file Standard. Per aggiungere un kubeconfig a un cliente, inserirlo nella cartella collegata (il pulsante **Apri cartella** aiuta a raggiungerla).

### Usare il cliente nel terminale

L'app e la CLI condividono la scelta del file attivo nelle preferenze, ma non possono modificare le variabili d'ambiente di una shell già aperta. Per indirizzare `kubectl`, Helm e gli altri strumenti al file selezionato:

```sh
# bash / zsh
kcm use prod --folder Acme
eval "$(kcm env)"
kubectl config current-context

# fish
kcm env --shell fish | source
```

```powershell
# PowerShell
kcm env --shell powershell | Invoke-Expression
```

Eseguire nuovamente il comando di ambiente quando si cambia **file** dall'app o dalla tray. Se si cambia contesto nello stesso file, gli strumenti che usano quel file ne leggono il nuovo `current-context`. Per tornare ai contesti personali: `kcm use <nome> --folder standard`, poi aggiornare la shell con `kcm env`. In alternativa si può passare il file direttamente: `kubectl --kubeconfig <file> ...`.

`kcm current --json` mostra il file e il gruppo attivi. `kcm env --json` restituisce solo il percorso; `kcm env` stampa il comando quotato e non esegue una shell. Non cambia il contesto né i file. Se il contesto attivo non è disponibile, termina con errore.

## Shell isolata

Per operare su un contesto senza cambiare la selezione locale, selezionalo nell’app e premi **Apri shell isolata**. Da terminale:

```sh
kcm shell prod --folder Acme
kcm shell dev --folder Acme --file ~/clienti/acme/sviluppo.yaml
kcm shell --shell bash  # contesto attualmente selezionato
kcm shell staging --kubeconfig ~/config-staging.yaml
```

Il prompt mostra un indicatore come `[KCM: Acme / prod]`. La sessione contiene solo il contesto scelto, il suo cluster e il relativo utente. `KUBECONFIG` e le preferenze di `kcm` puntano a file temporanei privati; anche modifiche come `kcm namespace` valgono solo per quella sessione. I file originali, la selezione condivisa dell’app e l’ambiente della shell chiamante restano invariati. Certificati, chiavi e plugin di autenticazione già referenziati continuano a usare i propri percorsi.

Usa `exit` per chiudere la sessione: il kubeconfig e gli altri file temporanei vengono rimossi alla chiusura normale. In caso di arresto forzato possono restare nella directory temporanea del sistema. Sessioni aperte in parallelo hanno copie distinte. L’isolamento riguarda la configurazione locale; le operazioni sul cluster usano i permessi reali del contesto.

Da CLI la shell parte nel terminale corrente, nella directory corrente. L’app apre Terminale su macOS, una finestra PowerShell su Windows o un terminale supportato su Linux (`x-terminal-emulator`, GNOME Terminal, Konsole, Xfce Terminal, xterm). Sono supportati Bash e zsh su macOS/Linux e PowerShell su Windows. La shell isolata usa un prompt proprio e non carica il profilo personale: alias e funzioni definiti lì non sono disponibili.

## Quale kubeconfig viene modificato

Il file **Standard**, usato anche dagli import e dalla creazione manuale, è risolto inizialmente in questo ordine:

1. `--kubeconfig <file>` per la singola invocazione CLI.
2. Variabile `KCM_KUBECONFIG`.
3. Variabile `KUBECONFIG`, se contiene un solo file.
4. File scelto nelle preferenze o con `kcm path <file>`.
5. `~/.kube/config`.

Quando si collega la prima cartella, il percorso Standard viene fissato nelle preferenze. Da quel momento prevale su `KUBECONFIG`, anche dopo aver scollegato i clienti: esportare il file di un tenant nella shell non deve trasformarlo nel file Standard. `--kubeconfig` e `KCM_KUBECONFIG` continuano a prevalere. **Scegli un altro file** e `kcm path <file>` cambiano il file Standard e riportano la selezione dell'app su Standard.

`--kubeconfig` su `list`, `use`, `namespace` e `current` mantiene la modalità diretta su quel solo file, senza cambiare la selezione condivisa dell'app. Senza tale opzione la CLI usa il workspace e distingue le cartelle. `kcm path` mostra il percorso Standard; `kcm env` mostra come attivare quello correntemente selezionato.

Una lista di file in `KUBECONFIG` non viene appiattita o modificata implicitamente; prima di configurare le cartelle richiede una selezione esplicita del file Standard. Un'app aperta dal Finder o dal menu del sistema può non ereditare le variabili della shell.

Le cartelle, il file attivo, i preferiti e il percorso Standard sono in `~/.config/kubecontext/settings.json` (o `$XDG_CONFIG_HOME`); su Windows in `%APPDATA%/kubecontext/settings.json`. `KCM_SETTINGS` permette di isolare le preferenze nei test. Le credenziali non vengono copiate nelle preferenze o restituite al renderer. Il file kubeconfig continua a contenere i suoi segreti secondo il formato Kubernetes.

Gli import **non attivano automaticamente** alcun contesto, neppure il primo. Selezionarlo esplicitamente dalla UI, dalla tray o con `kcm use`.

Solo nel caso di un **import nel file Standard**, i riferimenti relativi a certificati, chiavi, token file e comandi exec vengono resi assoluti rispetto al file importato. I file referenziati non vengono copiati e devono restare disponibili. Il testo incollato deve avere credenziali incorporate e non può usare riferimenti a file. Collegare una cartella mantiene invece i file originali e i loro riferimenti senza spostarli.

## Vault: fase successiva

L’integrazione con il vault aziendale è **rinviata**. La schermata dedicata lo indica esplicitamente; nessun provider remoto, token Vault o autenticazione simulata è attivo.

Il contratto `KubeconfigProvider` in `src/core/providers.ts` prevede `list()` e `fetch()` con cancellazione. Il futuro adapter gestirà l’autenticazione nel processo main e passerà kubeconfig autosufficienti allo stesso percorso di validazione/importazione. Restano da definire prodotto Vault, API, modalità SSO/autenticazione e struttura dei secret.

## Integrità dei file

I backup sono accanto al kubeconfig: `config.backup-<timestamp>-<id>`. Sono copie esatte dell’originale e possono contenere credenziali. Non vengono eliminati automaticamente. Su POSIX i nuovi file e i backup hanno permessi `0600`; su Windows valgono le ACL della directory utente. La scrittura conserva i symlink del file gestito e usa un file temporaneo nella stessa directory con rename atomico.

Il lock `.kcm-lock` coordina più processi KubeContext e si riprende dopo un crash (scadenza 10 secondi). Un controllo prima del salvataggio rileva modifiche fatte da programmi esterni: strumenti come `kubectl` non rispettano questo lock, quindi resta possibile una gara nell’intervallo finale di scrittura. Evitare modifiche simultanee da altri strumenti. In caso di errore di parsing il file originale non viene riscritto.

Per ripristinare un backup, uscire dall’app e copiare il backup sul file originale con i permessi appropriati. Sono mantenuti i campi kubeconfig sconosciuti; switch e cambio namespace preservano i commenti. Un import può riformattare le liste che estende.

## Verifica e pacchetti

```sh
npm test           # core e CLI: esclusivamente file temporanei
npm run build     # controllo TypeScript e build di tutti i componenti
npm run test:e2e  # avvia Electron: UI, CLI sync, tray e isolamento
npm run package   # cartella app per il sistema corrente, in release/
npm run dist      # installer per il sistema corrente
```

Lo smoke test crea screenshot in `artifacts/` e non accede al kubeconfig personale. La workflow GitHub Actions prepara DMG/ZIP per macOS, NSIS per Windows e AppImage per Linux sui rispettivi runner. I pacchetti di sviluppo non sono firmati né notarizzati; per la distribuzione pubblica configurare i certificati nelle pipeline. Windows e Linux richiedono verifica sui rispettivi sistemi.

Un override limitato a `minimatch` 7–10 seleziona la versione corretta 11.0.1 o successiva negli strumenti di packaging, per [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Non modifica le vecchie API 3/5 usate da altri strumenti. L’audit npm della prima versione risulta senza vulnerabilità segnalate.

Il renderer usa sandbox, isolamento del contesto, CSP e un bridge IPC con operazioni esplicite. Non riceve accesso Node.js e non carica contenuti remoti.

## Struttura

```text
src/core/         workspace e cartelle, parsing, merge, file lock, backup, preferenze
src/main/         Electron, tray, dialoghi e bridge IPC
src/renderer/     interfaccia React
src/shared/       tipi del bridge (solo metadata, mai token)
src/cli.ts        comando kcm, usa lo stesso core
tests/            test di integrità e CLI
scripts/          build, icone, sviluppo e smoke test desktop
```

Riferimenti: [formato kubeconfig e contesti](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/), [isolamento Electron](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [sicurezza Electron](https://www.electronjs.org/docs/latest/tutorial/security).
