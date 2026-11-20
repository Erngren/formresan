# Kontolivscykel – säker förberedelse, steg 2

20 november 2026. Utgångspunkt: main `147b34a`, inklusive PR #23.

## Aktiverat och förberett

Vanlig sidstart använder fortfarande de två befintliga lokala testnycklarna. En statusrad säger uttryckligen att konto inte är konfigurerat. Ingen SDK laddas och inga Auth-, REST- eller molnanrop görs. Befintliga poster raderas eller importeras inte.

`js/account-lifecycle.js` förbereder `FormresanAccount.attachAuth(client.auth)` för en betrodd, officiell Supabase-klient. Ingen bootstrap, projektkonfiguration, inloggningsvy eller SDK-dependency ingår. Det är en avsiktlig mindre förberedelse, inte färdig Auth-aktivering. Ett objekt med samma metodnamn bevisar inte att det är Supabases SDK; endast betrodd appkod får senare ansluta klienten.

Kontrollern verifierar med `getUser()`, aldrig enbart `getSession()` eller callbackens session. Auth-anrop schemaläggs utanför Auth-callbacken. Saknad användare ger utloggat läge; felaktig, anonym eller misslyckat verifierad identitet ger inget kontoutrymme. UUID normaliseras och valideras av lagringsmodulen. Se [officiell getUser-dokumentation](https://supabase.com/docs/reference/javascript/auth-getuser) och [Auth-händelser](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

Tillstånden är `unconfigured`, `verifying`, `signed_in`, `signed_out` och `error`. `managed` skiljer ett aldrig aktiverat lokalt testläge från en sida där kontohantering har inletts. `signed_in` betyder endast verifierad identitet. **`accountViewsEnabled` är alltid false.** Den gamla privata appvyn öppnas aldrig för ett verifierat konto. En separat adapter för kontodata måste granskas innan kontovyer får aktiveras.

## Livscykel och lagringsgräns

`attachAuth`, `verify`, `signOut` och `cancel` spärrar det gamla lokala läget för återstoden av dokumentets livstid. Den spärren kan inte hävas genom ett sent svar. `signOut` låser och rensar vyerna före nätverksanropet och använder `scope: 'local'`; ett utloggningsfel lämnar dem låsta. Detta är inte global återkallelse av redan utfärdade tokens. Se [Supabases signOut](https://supabase.com/docs/reference/javascript/auth-signout).

Varje övergång ogiltigförklarar gamla kontohandtag. `captureAccount()` kräver verifierad identitet och ger ett UUID-bundet lagringsobjekt med en generationskontroll. Lagringsmodulen verifierar dessutom användaren vid operationen. Huvudapp och samma-origins träningsiframe delar förälderns kontroller. Direkt öppnad träning skapar en egen. Saknad eller otillgänglig föräldrakontroller låser iframen.

Flikar delar en ny nyckel, `formresan_account_lifecycle_v1`, och en BroadcastChannel. Nyckeln innehåller endast version, slumpmässig nonce och avsikt (`verify`, `logout`, `lock`), aldrig användar-ID, e-post eller token. Den är en spärrsignal, inte autentisering. Varje flik måste själv köra `getUser()`. Borttagen eller trasig kontext låser. Kontooperationer jämför markören även före commit, så en missad eller fördröjd flikhändelse inte räcker för att tillåta en gammal skrivning. Legacy-läsning och -skrivning spärras också synkront om markören finns.

En kvarvarande markör efter omladdning ger låst läge även om Auth inte är konfigurerat. Appen återgår inte tyst till testdata. Inget användargränssnitt för att häva spärren finns i detta steg. Saknad BroadcastChannel eller otillgänglig markör vid aktivering ger fel, inte reservidentitet. Om lagringen är otillgänglig redan i oaktiverat testläge hanterar befintlig lagringsfelhantering läsfelet; inget konto antas.

## Granskade ytor och skydd

| Yta | Skydd vid kontohändelse |
| --- | --- |
| Huvudappens `db`, historik och mål | Privat main döljs och blir inert före återställning; minnesmodellen töms och renderas om. Sen `applyDb` ignoreras. |
| Träningsmodell, flik, vikter, historik och guide | Samma kontroller; modellen ersätts med tom träningsmodell, flik/historik återställs, guideinnehåll töms. |
| Dialoger och formulärutkast | Dialoger stängs, returnValue och inmatningar/defaultvärden rensas. Klick i privata vyer stoppas. |
| Köade legacy-skrivningar | Spärr kontrolleras före kö, inne i Web Lock och före skrivning; ingen fallback till kontonycklar. |
| Fördröjd import, export och sparning | Legacy-gräns kontrolleras efter await och före nedladdning/återrendering. |
| Smart mat | Pågående sökning avbryts och begäransidentitet ogiltigförklaras; query, val, portion och preview rensas. Sen save-callback kontrollerar generation/spärr. |
| Sidcache och flikar | pagehide ogiltigförklarar; pageshow återverifierar utan att öppna kontovyer; markörhändelser invaliderar båda vyer. |

Validering, Web Locks, äldre nycklar, postformat, övnings-ID:n och träningsprogram bevaras. Råexport finns kvar i oaktiverat testläge och via det bundna kontoobjektet; gamla exporter får inte avslutas efter en övergång. Ingen automatisk migration eller uppladdning införs.

## Reproducerbara lokala tester

Kör med Node, Playwright 1.65.1 och installerad Chromium. Sätt `FORMRESAN_PLAYWRIGHT` till modulens sökväg om den inte kan hittas normalt och vid behov `PLAYWRIGHT_BROWSERS_PATH` till webbläsarkatalogen:

```sh
node --test tests/account-lifecycle.cjs tests/account-storage.cjs tests/local-data-safety.cjs
```

Browserproven använder 390 × 844, syntetiska A/B-konton och lokalt uppfyllda appfiler; externa anrop blockeras. Livscykelsviten täcker A → B → A, saknad/ogiltig/anonym Auth, avbruten/fördröjd verifiering, gamla callbacks, formulär, iframe, direkt träning, flera flikar, markörbyte utan händelse, sena importer/exporter och smart matsökning som ignorerar abort. Tidigare validerings-, Web Lock- och regressionstester körs också. CI kör samma tre sviter i account-storage-workflowen. Faktiska körresultat redovisas i PR:n.

Dessa tester bevisar appens beteende mot ett syntetiskt Auth-kontrakt. De bevisar inte riktig SDK-händelseordning, sessionspersistens, tokenförnyelse, serververifiering eller Safari/iPhone-beteende. Ingen hostad miljö används. SQL-tester, migrationer och öppna molnverifieringsärenden ändras inte.

## Kvarstående beslut och nästa steg

1. Granska och godkänn SDK-version, betrodd bootstrap och extern projektkonfiguration. Ingen URL eller nyckel är inlagd. Endast publishable key får senare användas i klienten.
2. Besluta inloggningsmetod, registrering, återinloggning, redirect-URL:er, e-post/SMTP och felhantering. Bygg riktig inloggning med kontrollerad livscykel även för sena SDK-operationer. `verify()` är inte en inloggningsmetod.
3. Bygg en liten kontobunden vyadapter för huvudapp och träning. Behåll spärren tills varje läsning, formulär, export/import och skrivning är knuten till en aktuell lease. Återöppna aldrig legacy-vyer bara för att Auth är `signed_in`.
4. Besluta offlinebeteende. Nu nekas kontoåtkomst utan lyckad verifiering. `getUser()` har ingen egen tidsgräns här; cancel ogiltigförklarar logiskt sena svar men avbryter inte SDK:ts nätverkstrafik.
5. Verifiera med officiell SDK i separat godkänd isolerad miljö och därefter på fysisk iPhone, inklusive flera flikar, omladdning, bakgrund/återgång och utloggningsfel. Inga sådana hostade anrop har gjorts i detta steg.

Samma origin/localStorage är inte ett säkerhetssandbox mot XSS, andra skript på samma origin eller en person med DevTools. Den nya gränsen skyddar appens normala flöden; serverisolering kräver fortsatt granskad RLS. Molnsynk, befintliga databasverifieringar och migration av gamla testposter ingår inte.
