# Held · Dashboard del team

Interfaccia responsive per coordinare un progetto con attività, fasi e wiki Markdown. Il sito pubblico contiene soltanto il codice: i dati vengono letti dal repository GitHub a cui l’utente è autorizzato ad accedere.

## Accesso con GitHub senza token manuali

Accesso dal telefono e visualizzazione delle attività reali confermati dall’utente il **13 novembre 2026**. [Apri Held](https://held-dashboard.chiarolanza-francesco.workers.dev/) e premi **Accedi con GitHub**. Nessun token da generare o incollare; sessione cifrata fino a otto ore. Anche il vecchio link GitHub Pages offre il pulsante verso il nuovo accesso. [Configurazione e manutenzione](SETUP-LOGIN.md).

## Aprire sul computer

Prerequisiti: Node.js 22 o successivo, Git e GitHub CLI.

```sh
git clone https://github.com/framik02/held-dashboard.git
cd held-dashboard
gh auth login
node server.mjs
```

Aprire http://127.0.0.1:4173. Non occorre installare dipendenze per usare la dashboard. Il server ascolta solo sul computer locale e usa GitHub CLI; nessun token viene inviato al browser. Il repository predefinito è `framik02/held-wiki`; può essere configurato con la variabile d’ambiente `HELD_REPO` prima dell’avvio.

## Aprire dal telefono o da un altro computer

Sito: https://held-dashboard.chiarolanza-francesco.workers.dev/

Ogni persona entra con il proprio account GitHub e deve già avere accesso in scrittura alla wiki. Il servizio Cloudflare Workers Free usa una GitHub App: i token restano in una sessione cifrata, non accessibile al JavaScript. Alla scadenza si accede di nuovo con il pulsante. Il codice e i documenti restano su GitHub.

## Come si sincronizza

- Una scheda attività corrisponde a `attivita/<id>.md` nella wiki. Non esiste un database duplicato.
- Ogni salvataggio della dashboard crea un commit nel ramo `main`, attribuito dall’API all’account connesso.
- L’AI e le persone possono modificare i medesimi Markdown. Le modifiche locali diventano visibili al team **dopo commit e push** (o merge della PR).
- La dashboard controlla GitHub ogni 30 secondi quando la scheda è visibile. Il pulsante ↻ aggiorna subito.
- La copia locale della wiki si aggiorna con `git pull --ff-only`: il sito non modifica automaticamente il filesystem del computer.
- Il contenuto delle pagine si può leggere e modificare nella sezione Wiki. Scrivere in una pagina narrativa non crea automaticamente attività: creare/modificare le schede in `attivita/`.
- I nomi, le descrizioni e i periodi delle fasi provengono dal campo `phases` di `attivita/README.md`, modificabile anche dalla vista Fasi. Gli ID delle cinque fasi rimangono stabili.
- I commenti sono aggiunte al Markdown dell’attività; lo storico completo rimane nei commit GitHub.
- I salvataggi usano lo SHA della versione letta: modifiche simultanee allo stesso file non vengono sovrascritte. In caso di conflitto, scaricare la bozza, riaprire la scheda aggiornata e integrare il proprio testo.

La bacheca ha filtri per persona, fase e priorità; menu per cambiare stato, casella per completare/riaprire, sottoattività, commenti e distinzione fra incarico proposto e confermato. Nessuna email, candidatura, spesa o approvazione istituzionale viene inviata dalla dashboard.

## Formato per assistenti AI

```markdown
---
id: "H001"
title: "Titolo concreto"
type: "overview"
updated: "2026-11-13"
status: "todo"
priority: "high"
phase: "avvio"
assignee: ""
assignment: "proposed"
due: ""
schedule: "proposed"
sources: ["../agenda.md"]
---

## Risultato atteso

Che cosa prova il completamento.

## Sottoattività

- [ ] Un passo verificabile

## Commenti

### 2026-11-13T12:00:00Z · @autore

> Un aggiornamento datato.
```

Valori: `status` = todo/doing/blocked/done; `priority` = high/medium/low; `phase` = avvio/ascolto/proposta/copertura/pilota; `assignment` e `schedule` = proposed/confirmed; `due` = YYYY-MM-DD oppure stringa vuota. Conservare metadati sconosciuti, fonti, commenti e ID. Le modifiche ai task non riscrivono automaticamente le pagine narrative: aggiornare la pagina pertinente se cambiano risultati o decisioni.

## Verifiche

```sh
node --test tests/core.test.mjs tests/graph.test.mjs
```

Le prove browser sono separate e richiedono Playwright installato nell’ambiente di sviluppo; avviare il server, poi `node tests/browser.mjs`. Usano dati fittizi e API simulate, senza scrivere nella wiki reale. La variabile `CHROME_PATH` può indicare il browser Chromium installato. Nessuna dipendenza viene caricata da CDN durante l’uso.

## Fonti tecniche

- [GitHub Pages: hosting statico](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [API Contents e controllo della versione SHA](https://docs.github.com/en/rest/repos/contents)
- [Token personali e limiti dei fine-grained](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Verifica documentale: 13 novembre 2026.

## Grafica, assegnatari e grafo

Dal 13 novembre 2026: palette blu e ghiaccio e font variabile Manrope ospitato in fonts/ con licenza SIL OFL. Nessuna richiesta runtime a Google Fonts.

Nella bacheca, Cambia apre il responsabile della scheda. Scelte rapide, nome libero e rimozione dell’assegnazione; la modifica del responsabile torna proposta finché viene esplicitamente confermata nel formulario. Salva nella wiki per condividere.

La vista Grafo legge i titoli e i riferimenti dei Markdown, inclusi sources e wikilink univoci. Colori per fase delle attività, decisioni, progressi e altre pagine. Ricerca, filtro, legenda cliccabile, zoom, pan, pinch e apertura del nodo; l’elenco espandibile mostra i nomi completi. Il grafo non è una mappa di dipendenze dedotte: ogni arco corrisponde a un rimando presente nei file. Si aggiorna dai dati GitHub senza una base dati separata.

Hosting: GitHub Pages per il sito e API GitHub per i dati. Nessun progetto o account Vercel è stato configurato. Il server locale è una modalità alternativa e ascolta solo su localhost.
