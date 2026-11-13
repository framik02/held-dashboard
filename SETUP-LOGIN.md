# Login con GitHub — attivazione una tantum

Stato al **13 novembre 2026**, aggiornato dopo la scelta di Cloudflare: piano Workers Free verificato nell’account del proprietario e servizio pubblicato su https://held-dashboard.chiarolanza-francesco.workers.dev. L’interfaccia è raggiungibile; il login non è ancora attivo. Mancano registrazione della GitHub App, installazione sulla sola wiki, secrets e collaudo con account reali. GitHub Pages continua a usare il login esistente. Non modificare `auth-config.json` finché il nuovo servizio non funziona.

## Cosa cambia per il team

Il pulsante **Accedi con GitHub** apre l’autorizzazione GitHub. Ogni collaboratore usa il proprio account e deve già avere accesso in scrittura alla wiki. Ricaricare la dashboard conserva la sessione su quel dispositivo per un massimo di otto ore; dopo la scadenza basta accedere nuovamente, senza generare o incollare token. I refresh token non vengono conservati. Il pulsante Esci cancella il cookie e tenta di revocare il singolo token GitHub.

La dashboard autenticata e il servizio di login condividono lo stesso dominio Cloudflare, per evitare dipendenze dai cookie di terze parti sui telefoni. Il codice e la wiki restano su GitHub. La pagina GitHub Pages può offrire il pulsante che porta al nuovo indirizzo. Le modifiche restano commit attribuiti all’utente connesso, con controllo della versione SHA.

## Costi e trattamento dei dati

Usare **Workers Free**, senza attivare piani a pagamento: al 13 novembre 2026 include 100.000 richieste dinamiche al giorno e 10 ms di CPU per invocazione; i file statici sono gratuiti. Si applicano anche i limiti API di GitHub. Non sono necessari dominio a pagamento, database, KV o Vercel. Al raggiungimento dei limiti gratuiti il servizio può interrompere le richieste: non è un’offerta illimitata. [Prezzi ufficiali](https://developers.cloudflare.com/workers/platform/pricing/) e [asset statici](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

Il Worker inoltra letture e modifiche della wiki a GitHub: Cloudflare tratta quindi i contenuti durante queste richieste. Non vengono creati un database della wiki o log applicativi dei contenuti. Il cookie contiene una sessione cifrata AES-GCM, Secure, HttpOnly, SameSite=Lax; JavaScript non riceve il token GitHub. La chiave e il client secret vivono esclusivamente nei secrets del Worker. Non attivare log dei corpi delle richieste o delle credenziali.

## 1. Account e primo indirizzo — completato per Held

Creare un [account Cloudflare](https://dash.cloudflare.com/sign-up), confermare l’email e mantenere Workers Free. Nel repository `held-dashboard`, con Node 22 o successivo:

```sh
npx wrangler@4 login
node scripts/build-auth.mjs
npx wrangler@4 deploy
```

Questa prima pubblicazione serve a ottenere l’indirizzo HTTPS `workers.dev`: il login risponderà ancora «non configurato». Copiare l’origine esatta in `APP_ORIGIN` dentro `wrangler.jsonc`, senza slash finale. Se il nome del Worker è già occupato nell’account, scegliere un altro nome prima di pubblicare. Nessun dominio personalizzato è necessario.

## 2. GitHub App del proprietario

Aprire [New GitHub App](https://github.com/settings/apps/new) con l’account proprietario della wiki:

| Campo | Impostazione |
|---|---|
| Nome | Un nome disponibile e riconoscibile, per esempio Held Team Login |
| Homepage URL | Origine HTTPS ottenuta al passo 1 |
| Callback URL | Stessa origine seguita da `/auth/callback` |
| Expire user authorization tokens | Attivo |
| Request user authorization during installation | Disattivo: il team accede dal pulsante della dashboard |
| Webhook Active | Disattivo; non serve un webhook |
| Repository permissions | Contents: Read and write; Metadata: Read-only obbligatorio |
| Altri permessi | Nessuno |
| Where can this GitHub App be installed? | Any account, per consentire l’autorizzazione dei collaboratori esterni |

La registrazione dell’app deve essere **pubblica** per gli account esterni; questo non rende pubblica la wiki né concede accesso ai suoi contenuti. Il servizio controlla la wiki configurata e i permessi dell’utente. Non serve pubblicarla nel Marketplace. [Regole ufficiali sulla visibilità](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private).

Installare l’app sull’account proprietario, scegliendo **Only select repositories → held-wiki**. Non scegliere tutti i repository. I collaboratori autorizzano l’app dal login, senza installarla sui loro repository personali. L’autorizzazione non sostituisce l’invito alla wiki.

Copiare il **Client ID** (non l’App ID) in `GITHUB_CLIENT_ID` di `wrangler.jsonc`. Generare il client secret nelle impostazioni dell’app. Non serve generare una chiave privata PEM: l’integrazione usa solo token utente.

## 3. Secrets e pubblicazione definitiva

Dal terminale nel repository:

```sh
npx wrangler@4 secret put GITHUB_CLIENT_SECRET
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | npx wrangler@4 secret put SESSION_KEY
node scripts/build-auth.mjs
npx wrangler@4 deploy
```

Il primo comando richiede il secret in modo interattivo; il secondo genera e trasmette una chiave casuale senza stamparla. Non mettere credenziali in chat, file versionati, `auth-config.json` o variabili pubbliche. `.dev.vars*` e gli artefatti locali sono ignorati da Git. Conservare gli eventuali backup dei segreti nel proprio gestore di password. Ruotare `SESSION_KEY` invalida tutte le sessioni esistenti.

Controllare che `HELD_REPO`, `APP_ORIGIN` e `GITHUB_CLIENT_ID` siano corretti. Per ogni aggiornamento del codice ripetere build e deploy: il solo push su GitHub non aggiorna il Worker. Una pubblicazione automatica potrà essere collegata dopo l’attivazione; non è già configurata.

## 4. Collaudo reale e collegamento da GitHub Pages

- Accedere con il proprietario: dashboard e grafo devono leggere la wiki privata.
- Ricaricare e verificare che la sessione resti attiva; provare anche telefono e uscita.
- Accedere con un collaboratore già autorizzato: l’app non deve richiedere un PAT.
- Verificare che un account senza accesso alla wiki venga rifiutato.
- Su un’attività di prova concordata, verificare salvataggio, autore del commit e conflitto fra due versioni. Non usare attività reali come prova di completamento senza incarico.
- Registrare esito e data nella wiki. La simulazione locale non sostituisce questi controlli con GitHub reale.

Solo dopo queste verifiche impostare nel file pubblico `auth-config.json`:

```json
{"managed_auth":false,"github_login_url":"https://INDIRIZZO-REALE.workers.dev/"}
```

Sostituire il segnaposto con l’indirizzo effettivo, fare commit e push. GitHub Pages mostrerà il pulsante che apre il servizio con login; l’accesso corrente resta disponibile. Per tornare indietro impostare `github_login_url` a `null`. Il build del Worker genera separatamente `managed_auth:true` nei propri asset.

## Controlli per chi modifica il codice

```sh
node --test tests/*.test.mjs
node scripts/build-auth.mjs
npx wrangler@4 deploy --dry-run
```

`tests/browser.mjs` usa Playwright e API fittizie: eseguirlo con il server locale avviato, prima normalmente e poi con la variabile `TEST_AUTH=1`. Verifica anche ripristino della sessione, richieste senza Bearer nel browser, CSRF, uscita, conflitti e layout mobile. Il runtime della dashboard non richiede dipendenze Node aggiuntive.

Il proxy consente solo la wiki configurata, letture del ramo main e scritture Markdown; esclude repository esterni e percorsi nascosti. OAuth usa state e PKCE. Le scritture richiedono sessione valida, origine corretta e CSRF. Gli errori GitHub e i conflitti vengono preservati; non usare un token del proprietario condiviso come scorciatoia.

Fonti: [token utente GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [revoca del singolo token](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token), [Workers con asset statici](https://developers.cloudflare.com/workers/static-assets/).
