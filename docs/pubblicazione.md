# Pubblicazione su GitHub

Il repository configurato è `acquavlu-hue/kubeconfig-manager`. Il codice e il sito statico in `site/` vivono nello stesso repository. La pipeline desktop compila i pacchetti sui runner dei rispettivi sistemi, mentre GitHub Pages serve direttamente HTML, CSS e asset.

## Prima del push

1. Verifica che `LICENSE`, `package.json` e `package-lock.json` riportino la licenza MIT di KubeContext. Le dipendenze mantengono le proprie licenze.
2. Rivedi i file da committare e la cronologia che sarà pubblica. Controlla anche gli eventuali artifact e log delle precedenti esecuzioni di Actions. Il sito usa uno screenshot prodotto dallo smoke test con kubeconfig di esempio. [Effetti del cambio di visibilità](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility#making-a-repository-public)
3. Esegui `npm ci`, `npm test` e `npm run build`. Rivedi lo staging con `git diff --cached`, crea il commit e invia `main` con `git push -u origin main`.
4. In **Settings → General → Danger Zone → Change repository visibility** seleziona **Public** con un account che amministra il repository. In **Settings → Pages** imposta **Build and deployment → Source → GitHub Actions**. [Configurazione di GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

Se il primo push precede l’attivazione di Pages, avvia **Actions → GitHub Pages → Run workflow** su `main`. Dopo un deployment riuscito, il job mostra l’URL. Con il nome attuale del repository, l’indirizzo previsto è `https://acquavlu-hue.github.io/kubeconfig-manager/`.

## Creare la prima release

Per una prova dei pacchetti, esegui **Actions → Build desktop → Run workflow** su `main`. Scarica i pacchetti dagli artifact del run e verifica l’avvio su ciascuna piattaforma.

Quando la versione, il codice e la licenza di progetto sono su `main`, crea il tag dello stesso commit. Per la versione attuale:

```sh
git tag -a v0.3.0 -m 'KubeContext 0.3.0'
git push origin v0.3.0
```

Il tag deve coincidere con `package.json`. GitHub Actions esegue test, build e controlli licenze, poi prepara questi asset nella release in bozza:

| Piattaforma | Asset |
| --- | --- |
| macOS Apple Silicon e Intel | `KubeContext-<versione>-mac-arm64.dmg`, `KubeContext-<versione>-mac-x64.dmg` e i rispettivi `.zip` |
| Windows x64 | `KubeContext-<versione>-win-x64.zip` |
| Linux x64 | `KubeContext-<versione>-linux-x64.tar.gz` |
| Tutti | `SHA256SUMS.txt`, `THIRD-PARTY-NOTICES.txt`, `DEPENDENCIES.json`, `FFmpeg-source.tar.gz` |

Windows e Linux usano archivi portatili per tenere la prima distribuzione circoscritta al runtime Electron e ai file di KubeContext. Il workflow genera pacchetti senza firma di distribuzione. Per una distribuzione firmata, configura identità di firma e notarizzazione sui runner pertinenti e verifica gli asset risultanti. [Firma dei pacchetti Electron](https://www.electron.build/code-signing)

Prima di premere **Publish release**, verifica i pacchetti e gli avvisi dei componenti nativi per ogni piattaforma. La pipeline allega il sorgente FFmpeg con le patch applicate e il codice Electron dello stesso tag. Se altri componenti inclusi richiedono sorgenti corrispondenti, aggiungili alla bozza e aggiorna `SHA256SUMS.txt`. Per le release successive aggiorna la versione di `package.json` e `package-lock.json` prima di creare il tag. [Verifica licenze](licenze.md) · [Gestione delle release GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

## Anteprima del sito

```sh
python3 -m http.server 4318 --bind 127.0.0.1 --directory site
```

Apri `http://127.0.0.1:4318`. Il sito usa asset locali e punta alla pagina Releases, che elenca automaticamente le versioni pubblicate.
