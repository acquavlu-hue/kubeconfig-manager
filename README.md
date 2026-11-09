# KubeContext

App desktop per macOS, Windows e Linux per gestire i contesti Kubernetes da finestra, barra di sistema e CLI. KubeContext legge e modifica kubeconfig locali. Per operare sui cluster dalla shell servono `kubectl` o gli altri strumenti che usi abitualmente.

[Release e download](https://github.com/acquavlu-hue/kubeconfig-manager/releases) · [Guida alla pubblicazione](docs/pubblicazione.md) · [Licenze delle dipendenze](docs/licenze.md)

## Installazione e avvio

Le release pubblicate sono disponibili nella [pagina GitHub Releases](https://github.com/acquavlu-hue/kubeconfig-manager/releases), insieme alle note di versione e a `SHA256SUMS.txt`. La CLI si installa separatamente con `npm link` come indicato sotto.

- **macOS.** Scegli `arm64` per Apple Silicon o `x64` per Intel. Apri il DMG o estrai lo ZIP e trascina `KubeContext.app` in Applicazioni.
- **Windows x64.** Estrai lo ZIP e avvia `KubeContext.exe` dalla cartella estratta.
- **Linux x64.** Estrai l’archivio `tar.gz` e avvia `kubecontext-manager` dalla cartella estratta. Il runtime richiede le librerie di sistema di Electron.

### Da sorgente

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
- Tema **Sistema**, **Chiaro** o **Scuro** in **Preferenze → Aspetto**. La scelta viene salvata e il valore iniziale segue il sistema.
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

Nella sidebar, sotto **Raccolte**, selezionare **Collega cartella**, assegnare un nome e scegliere una directory. L'opzione **Includi le sottocartelle** è attiva per impostazione predefinita. **Contesti** mostra tutte le sorgenti. **Standard** e ciascuna raccolta filtrano la lista. Ogni contesto mostra raccolta e file di provenienza. Si possono rinominare o scollegare le raccolte mantenendo i file sul filesystem.

Esempio di organizzazione:

```text
~/.kube/config                 # Standard: contesti personali
~/clienti/acme/
  sviluppo.yaml
  eu/produzione.kubeconfig
~/clienti/altro-tenant/
  config
```

I kubeconfig delle raccolte restano separati. La scansione è di sola lettura e mostra il file Standard una volta sola, anche quando si trova dentro una directory collegata. Lo switch modifica il `current-context` del kubeconfig selezionato. Il cambio namespace modifica il relativo contesto in quel file. Le scritture creano un backup. Certificati e comandi con percorsi relativi restano relativi al file originale.

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

`kcm current --json` mostra il file e il gruppo attivi. `kcm env --json` restituisce il percorso e `kcm env` stampa il comando da eseguire. Entrambi i comandi terminano con un codice diverso da zero se manca il contesto attivo. Se il percorso contiene il separatore di lista di `KUBECONFIG` (`:` su macOS/Linux, `;` su Windows), passalo direttamente a `kubectl --kubeconfig <file>`.

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

Il prompt indica il contesto con cui KubeContext ha aperto la shell. Le preferenze `kuberc` restano attive, comprese le policy sui plugin di autenticazione. Se configurano un kubeconfig diverso per un comando, passa esplicitamente il file della sessione con `kubectl --kubeconfig "$KUBECONFIG" …` su Bash/zsh o `kubectl --kubeconfig "$env:KUBECONFIG" …` su PowerShell. [Preferenze kubectl](https://kubernetes.io/docs/reference/kubectl/kuberc/)

Da CLI la shell parte nel terminale corrente, nella directory corrente. L’app apre Terminale su macOS, una finestra PowerShell su Windows o un terminale supportato su Linux (`x-terminal-emulator`, GNOME Terminal, Konsole, Xfce Terminal, xterm). Sono supportati Bash e zsh su macOS/Linux e PowerShell su Windows. La shell isolata usa un prompt proprio e non carica il profilo personale: alias e funzioni definiti lì non sono disponibili.

## Quale kubeconfig viene modificato

Per individuare il file **Standard**, usato anche dagli import e dalla creazione manuale, KubeContext segue quest’ordine.

1. `--kubeconfig <file>` per la singola invocazione CLI.
2. Variabile `KCM_KUBECONFIG`.
3. File fissato scegliendolo nell’app, usando `kcm path <file>` o collegando la prima raccolta.
4. Variabile `KUBECONFIG`, se contiene un solo file.
5. Percorso salvato da una versione precedente senza raccolte, se presente, oppure `~/.kube/config`.

La prima raccolta fissa il percorso Standard in uso. L’impostazione vale anche dopo aver scollegato le raccolte. **Scegli un altro file** e `kcm path <file>` salvano un percorso condiviso e riportano la selezione a Standard. Se hai avviato l’app con `KCM_KUBECONFIG`, rimuovi la variabile e riaprila per scegliere un altro file dalla finestra.

`--kubeconfig` su `list`, `use`, `namespace` e `current` mantiene la modalità diretta su quel solo file, senza cambiare la selezione condivisa dell'app. Senza tale opzione la CLI usa il workspace e distingue le cartelle. `kcm path` mostra il percorso Standard; `kcm env` mostra come attivare quello correntemente selezionato.

Una lista di file in `KUBECONFIG` non viene appiattita o modificata implicitamente; prima di configurare le cartelle richiede una selezione esplicita del file Standard. Un'app aperta dal Finder o dal menu del sistema può non ereditare le variabili della shell.

Raccolte, file attivo, preferiti, tema e percorso Standard sono in `~/.config/kubecontext/settings.json`, oppure in `$XDG_CONFIG_HOME/kubecontext/settings.json` se impostato. Su Windows sono in `%APPDATA%/kubecontext/settings.json`. `KCM_SETTINGS` permette di usare un file di preferenze separato, ad esempio nei test.

Gli import **non attivano automaticamente** alcun contesto, neppure il primo. Selezionarlo esplicitamente dalla UI, dalla tray o con `kcm use`.

Solo nel caso di un **import nel file Standard**, i riferimenti relativi a certificati, chiavi, token file e comandi exec vengono resi assoluti rispetto al file importato. I file referenziati non vengono copiati e devono restare disponibili. Il testo incollato deve avere credenziali incorporate e non può usare riferimenti a file. Collegare una cartella mantiene invece i file originali e i loro riferimenti senza spostarli.

## Vault

L’integrazione con il vault aziendale è rinviata. Le raccolte di questa versione leggono kubeconfig dal filesystem.

## Integrità dei file

I backup sono accanto al kubeconfig: `config.backup-<timestamp>-<id>`. Sono copie esatte dell’originale e possono contenere credenziali. Non vengono eliminati automaticamente. Su POSIX i nuovi file e i backup hanno permessi `0600`; su Windows valgono le ACL della directory utente. La scrittura conserva i symlink del file gestito e usa un file temporaneo nella stessa directory con rename atomico.

Il lock `.kcm-lock` coordina più processi KubeContext e si riprende dopo un crash (scadenza 10 secondi). Un controllo prima del salvataggio rileva modifiche fatte da programmi esterni: strumenti come `kubectl` non rispettano questo lock, quindi resta possibile una gara nell’intervallo finale di scrittura. Evitare modifiche simultanee da altri strumenti. In caso di errore di parsing il file originale non viene riscritto.

Per ripristinare un backup, uscire dall’app e copiare il backup sul file originale con i permessi appropriati. Gli import aggiungono le voci conservando commenti, campi sconosciuti e ancore già presenti. Se una modifica a un campo con ancora YAML cambierebbe anche altri valori, KubeContext interrompe l’operazione e chiede di espandere gli alias. Il limite di 10 MB si applica anche al file risultante da un import.

## Verifica e pacchetti

```sh
npm test           # core e CLI: esclusivamente file temporanei
npm run build     # controllo TypeScript e build di tutti i componenti
npm run licenses  # inventario npm e avvisi di distribuzione in dist/licenses/
npm run test:e2e  # dopo la build, avvia Electron e verifica UI, CLI, tray e isolamento
npm run package   # cartella app per il sistema corrente, in release/
npm run dist      # pacchetti scaricabili per il sistema corrente
```

Lo smoke test usa un workspace temporaneo e crea screenshot in `artifacts/`. La pipeline GitHub Actions prepara una release in bozza quando viene inviato un tag `vX.Y.Z` coerente con `package.json`. Per firme, verifica dei binari e messa online del sito consulta la [guida alla pubblicazione](docs/pubblicazione.md).

Per orientarti nel codice, consulta la [guida all’architettura](docs/architettura.md).
