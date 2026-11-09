# Verifica delle licenze

L’inventario deriva da `package-lock.json`. Esegui `npm ci` e `npm run licenses` per rigenerare `dist/licenses/DEPENDENCIES.json` e gli avvisi. La build esegue lo stesso controllo. Lo script richiede una dichiarazione per ogni voce del lockfile e blocca le nuove licenze nei pacchetti distribuiti finché vengono riviste.

## Dipendenze npm

Per il lockfile corrente risultano **380 voci**. Le **11 voci di produzione** dichiarano solo MIT o ISC. `lucide-react` dichiara ISC e conserva anche l’attribuzione MIT degli elementi Feather nel testo originale. La build raccoglie i testi effettivi dei pacchetti installati, compresi `LICENSE`, `NOTICE` e gli avvisi pertinenti. Include inoltre gli avvisi di Electron, esbuild, Vite e Rolldown, dato che il runtime e gli helper generati possono comparire negli asset finali.

Nel solo albero di build il lockfile include, fra le altre, MPL-2.0 per Lightning CSS e WTFPL per `truncate-utf8-bytes`. Queste dipendenze rimangono strumenti di compilazione o packaging. Il sito statico usa CSS e SVG del progetto, uno screenshot di esempio e font di sistema. [Licenza MIT](https://opensource.org/license/mit), [licenza ISC](https://opensource.org/license/isc-license-txt), [MPL 2.0](https://www.mozilla.org/MPL/2.0/)

## Runtime nativo Electron

Ogni pacchetto include `THIRD-PARTY-NOTICES.txt`, `LICENSE.electron.txt`, `LICENSES.chromium.html` e l’inventario npm nella directory `resources/licenses`, o `Contents/Resources/licenses` su macOS. La build copia anche `LICENSE` del progetto quando è presente. Gli avvisi Chromium elencano dipendenze native, tra cui FFmpeg con componenti LGPL. La verifica delle sorgenti native va svolta sull’esatto runtime distribuito. [Distribuzione Electron](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [LGPL 2.1, §§4 e 6](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html)

Per l’attuale lockfile il runtime è **Electron 45.2.3**. Il suo `DEPS` fissa **Chromium 156.0.8078.80** e **Node.js 24.22.2**. Il `DEPS` di Chromium fissa **FFmpeg `9db86ce5b5b454dfc96c435f9f0723012980c37f`**. Electron applica anche le patch del proprio tag in `patches/ffmpeg`. [DEPS Electron](https://github.com/electron/electron/blob/v45.2.3/DEPS), [DEPS Chromium](https://github.com/chromium/chromium/blob/156.0.8078.80/DEPS), [Revisione FFmpeg](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/9db86ce5b5b454dfc96c435f9f0723012980c37f), [Patch Electron](https://github.com/electron/electron/tree/v45.2.3/patches/ffmpeg)

Gli archivi automatici del sorgente Electron contengono il repository Electron e i riferimenti alle dipendenze. Le sorgenti corrispondenti dei componenti soggetti a obbligo di distribuzione, comprese le modifiche effettive e le istruzioni pertinenti, vanno rese disponibili insieme ai binari quando richiesto. [Struttura del sorgente Electron](https://www.electronjs.org/docs/latest/development/source-code-directory-structure), [Indicazioni FFmpeg](https://ffmpeg.org/legal.html)

Prima di rendere pubblica la release:

1. Esamina gli avvisi e i file realmente contenuti in ogni archivio per piattaforma. Usa gli avvisi come indice e individua i componenti copyleft che il binario include effettivamente.
2. Predisponi l’accesso alle sorgenti corrispondenti richieste per gli esatti componenti distribuiti. Verifica la configurazione della build FFmpeg, gli eventuali codec abilitati e i relativi requisiti per la distribuzione prevista.
3. Allegali alla release o indica dalla stessa pagina la posizione delle sorgenti verificate. Mantieni disponibili sorgenti e avvisi per le versioni binarie che distribuisci.

La pipeline prepara la bozza con inventario, avvisi e checksum. La decisione di pubblicare i binari segue la verifica delle sorgenti native e la scelta della licenza del progetto.
