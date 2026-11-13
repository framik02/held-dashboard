# Dashboard Held

Questo repository contiene soltanto codice e documentazione della dashboard pubblica, non i contenuti della wiki privata. Non copiare qui task reali, dossier, screenshot autenticati, token o dati dei collaboratori. Test e fixture devono essere fittizi.

La fonte dati è il repository selezionato dall’utente. Mantenere la scrittura Markdown con controllo SHA; non introdurre copie del database o salvataggi forzati. Preservare campi non riconosciuti e commenti. Non memorizzare token in localStorage/sessionStorage, URL o JavaScript persistente. Il login GitHub opzionale conserva la sessione in un cookie cifrato Secure/HttpOnly, inaccessibile a JavaScript; le chiavi restano nei secrets del Worker.

Verificare parser, salvataggi, conflitti, errori API, interfaccia a 390 e 1440 px. Node senza dipendenze runtime. Il server locale resta su 127.0.0.1, con controllo Host, Origin e nonce; non trasformarlo in proxy generico. Nessun iframe o script di terze parti.

La wiki e il codice hanno repository separati. Gli agenti che lavorano sui contenuti devono leggere AGENTS.md della wiki. Non dedurre che un’attività spuntata autorizzi invii esterni o spese.

Per modifiche all’autenticazione eseguire anche npm run test:worker dopo npm ci: il test usa il runtime workerd con un servizio GitHub fittizio. I soli mock Node non provano la compatibilità Cloudflare. Non usare redirect: error nelle chiamate Workers; mantenere redirect manual e il rifiuto esplicito dei 3xx per evitare inoltri delle credenziali.
