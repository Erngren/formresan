# Auth-testdistribution – förberedelse, steg 4

Utgångspunkt: main `a4f6d67`, inklusive PR #25. Ingen testrelease publiceras och ingen riktig Auth aktiveras i detta steg. Alla aktuella bygg-/browserprov använder avstängd konfiguration eller uttryckligen syntetiska värden med helt lokalt uppfylld HTTP. Det planerade framtida Supabase-målet är enligt projektägaren `formresan-test`; dess inställningar och konton har inte lästs eller ändrats.

## Verifierat nuläge och hinder

- Repoets fyra Actions-workflows kör tester, inte Pages-publicering. Ingen CNAME-fil finns i aktuell checkout. `js/auth-config.js` är fortsatt avstängd och ändras inte av bygget.
- Appens angivna adress är `https://erngren.github.io/formresan/`. Det publika, oautentiserade Pages-API-anropet gav 404. Detta fastställer **inte** vilka Pages-inställningar eller behörigheter som gäller. Publiceringskälla, eventuell administrativ konfiguration och domänkontroll behöver bekräftas av ägaren senare.
- En sökväg som `/formresan-test/` på samma `erngren.github.io` är inte en isolerad origin. Den skulle dela localStorage, SDK-sessioner, Web Locks och BroadcastChannel med vanlig app. Byggaren avvisar därför hela den kända produktionsoriginen, även alternativa sökvägar/portnotationer.

GitHub har en Pages-webbplats per repo och projektsidor ligger normalt under ägarens github.io-origin. Ett annat repo under samma ägare ger alltså inte i sig isolerad origin. Rekommenderat nästa beslut är en separat statisk testvärd med egen HTTPS-origin, eller ett separat testrepo med egen verifierad testdomän/annan konto-origin. Ändra inte den befintliga webbplatsens domän eller publiceringskälla. Inga sådana resurser eller inställningar har skapats här. Se [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) och [egna domäner](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Reproducerbart, avstängt bygge

Kör från reporoten med Node 22 eller senare. Ange en **ny absolut utdatamapp**, vars förälder redan finns, utanför alla Git-arbetskopior. Origin ska vara en exakt HTTPS-origin utan sökväg, credentials, frågesträng eller explicit port. Följande använder en reserverad exempeladress och skapar endast lokala filer:

```sh
node tools/build-auth-test.cjs --output /ABSOLUT/NY/auth-test-preview --test-origin https://formresan-auth-test.example.invalid
```

På Windows används exempelvis en ny absolut sökväg under en separat lokal artefaktmapp. Kör inte kommandot med en befintlig katalog: byggaren vägrar överskrivning och har ingen rensningsfunktion. Efter ett avbrutet bygge används en ny katalog; det ofullständiga bygget får inte publiceras.

Byggaren har en fast fillista för huvud-/tränings-HTML, nödvändig JS/CSS och ikoner. Den tar inte med Git-metadata, tester, SQL, exporter, godkännandefilen eller godtyckliga lokala filer. Övningsbilder utelämnas eftersom datavyerna är låsta. PWA-manifestlänken tas bort i artefakten för att undvika installation av testappen som vanliga Formresan. Ingen service worker läggs till.

Endast kopior ändras. Båda HTML-sidorna får testtitel och testskript före lagringskoden. Den genererade `js/auth-test-release.js` innehåller miljö/origin/aktiveringsläge och `js/auth-test-environment.js` visar en tydlig **FORMRESAN · AUTH-TEST**-banner, även vid direkt träning. Main förblir dold/inert även när Auth är avstängd, så testmiljön inte visar äldre lokala poster. Fel origin eller inkonsekvent miljö låser utan SDK/Auth-anrop.

`AUTH_TEST_MANIFEST.json` skrivs sist med källrevision, läge, origin och SHA-256 för varje artefaktfil. Text normaliseras till LF, ingen tidsstämpel används. Samma källbytes, revision och indata ger identiska filer/manifest. Revisionen ensam bevisar inte ren checkout: använd den granskade committen och kontrollera filhasharna innan en framtida publicering. Ett ändrat manifest kan inte i sig verifiera ägarens godkännande; det är ingen digital signatur. Inga artefakter laddas upp eller publiceras av CI.

## Förberedd aktiveringsväg – ska inte köras med riktiga värden ännu

Ett framtida uttryckligen godkänt bygge kräver **både** `--activate-auth-test` och `--approved-config /ABSOLUT/EXTERN/approval.json`. Utan båda avvisas aktivering. Inga miljövariabler, GitHub variables/secrets eller URL-parametrar kan implicit slå på Auth.

Godkännandefilen ska ligga utanför Git-arbetskopior och utdatamappen och innehålla exakt följande fält. Värden inom vinkelparenteser är platshållare, inte fungerande konfiguration:

```json
{
  "purpose": "formresan-auth-test",
  "targetProject": "formresan-test",
  "approval": "BUILD_AUTH_TEST_ARTIFACT_ONLY",
  "deploymentOrigin": "<godkänd exakt separat HTTPS-origin>",
  "productionOrigins": ["https://erngren.github.io", "<eventuella ytterligare produktionsorigins>"],
  "url": "<godkänd Supabase-projektorigin>",
  "publishableKey": "<projektets sb_publishable_-nyckel>"
}
```

Utelämna den andra platshållaren i productionOrigins om ingen ytterligare origin finns. Kända produktionsorigins måste anges och test-origin får inte ingå i listan. URL måste ha standardformatet HTTPS + 20 gemena alfanumeriska tecken + `.supabase.co`, utan snedstreck efter host. Endast `sb_publishable_…` accepteras; JWT/anon, service-role, secret keys och extra fält avvisas. Inga verkliga projektvärden finns i Git. Testfixturerna är syntetiska.

Byggaren serialiserar med JSON.stringify till en fryst klientkonfiguration, aldrig shellinterpolation. Fel loggar inte indata, nycklar eller projektreferens. Själva approval-strängen är ett skyddsräcke mot misstag, **inte bevis för mänskligt godkännande**. Projektägaren måste separat godkänna origin, målprojekt, publicering och specificerade Auth-anrop. Syntaxkontroll eller projektnamnet i filen bevisar inte vilket Supabase-projekt URL/nyckeln tillhör; det kontrolleras senare manuellt utan att värden läggs i PR/loggar.

En framtida aktiv artefakt innehåller offentlig projektadress/publishable key i klientfilen. Dessa är inte hemliga, men ska enligt uppdraget inte versionshanteras. Lösenord, access-/refresh-token eller privilegierade nycklar ska aldrig finnas i byggindata eller artefakten. SDK 2.119.2/SRI och Auth-endpointbegränsning från PR #25 bevaras. Projektkonfigurationen i repot förblir avstängd oavsett byggval.

## Flikbyte: lokal uppföljning i steg 5

PR #26 reproducerade att SDK-SIGNED_OUT utan appgeneration kunde skrivas om till en ny global logout-avsikt. [AUTH_TAB_SAFETY.md](AUTH_TAB_SAFETY.md) beskriver nu fixen: uttryckliga kontokommandon hålls åtskilda från notifieringar; en notifiering låser lokalt och kräver getUser i samma tillåtna kontext utan att skriva ny global avsikt. Verklig logout/lock-avsikt är fortsatt spärrande. Äldre handtag och svar nekas.

Den reproducerade lokala notifieringsblockeraren är åtgärdad och A → B → A över flikar provas utan omladdning. Det är inte hostad verifiering eller ett godkännande att aktivera testdistributionen. Verklig Auth, Safari/iPhone, cacheversioner och ytterligare samtidighetsfall behöver separat godkänd testning. Vid osäker session förblir appen låst och omladdning/explicit ny verifiering är reservväg. Inga molnverifieringsärenden stängs.

## Senare hostad testplan – inte körd

Först krävs separat skriftligt godkännande av releasehash, isolerad origin, projektbindning, två befintliga syntetiska testkonton och nedanstående Auth-sessionseffekter. Inga konton skapas av planen eller verktygen. Om konton saknas krävs ett eget godkänt uppdrag. Kontouppgifter lämnas utanför Git/loggar. Använd en ny testprofil i webbläsaren så vanlig Formresans lagring inte berörs.

| Anrop som den aktiva klienten kan göra | Syfte och möjliga ändringar |
| --- | --- |
| POST `/auth/v1/token?grant_type=password` | E-post/lösenord. Skapar Auth-session/refresh-token och kan ändra inloggningsmetadata/auditlogg. Skapar inte konto eller Formresan-post. |
| GET `/auth/v1/user` | Serververifierar identitet; kan ske flera gånger per övergång. Ingen avsiktlig dataskrivning, men serverloggar kan skapas. |
| POST `/auth/v1/token?grant_type=refresh_token` | Återställning/tokenförnyelse. Kan rotera/utfärda tokens och uppdatera Auth-sessioner. |
| POST `/auth/v1/logout?scope=local` | Återkallar den aktuella sessionens refresh-token, inte kontot eller Formresan-historik. Befintlig access-token kan gälla till utgång. Lokala SDK-sessionen tas normalt bort av SDK:n; fel får inte beskrivas som bekräftad serveråterkallelse. |
| OPTIONS till ovanstående Auth-sökvägar | Eventuell CORS-preflight. Ingen avsiktlig dataändring; loggning kan ske. |

Separat GET till den fast versionslåsta CDN-filen hämtar SDK:n, inte Supabase-data. SDK:n kan göra egna återförsök och flera getUser/refresh-anrop; exakt antal bestäms av session/timing. Auth-fetch tillåter bara konfigurerad origin och `/auth/v1/`. Testerna ska stoppa om `/rest/v1/`, RPC, Storage, Realtime, signup, recover, admin eller andra metoder/endpoints används. Ingen databasinstallation eller synk ingår.

Hostad Auth-testning är alltså **inte skrivskyddad** även utan appdata: inloggning/förnyelse/utloggning ändrar Auth-sessioner och kan skapa loggar. Avbrutet nätverk garanterar inte att serveroperationen avbröts. Inget sådant anrop har gjorts nu.

Senare checklista, varje punkt dokumenteras med enbart sanerad status/timing och förväntad identitet, aldrig lösenord/tokens eller osanerade HAR-filer:

1. Kontrollera origin, miljöbanner, releasehash och att ingen legacy-post visas före SDK-laddning. Bekräfta att inga datavyer/molnsynk kan öppnas.
2. Logga in befintligt syntetiskt A; verifiera rätt identitet med getUser och låst kontovy. Prova generiskt felmeddelande för nekad inloggning utan kontouppräkning.
3. Logga ut A lokalt och kontrollera båda flikarna, sedan B och åter A. Testa även direkt träning/iframe. Verifiera även sena SDK-notifieringar enligt steg 5:s negativa prov.
4. Ladda om en tillåten session; växla bakgrund/förgrund och kontrollera återverifiering. Vänta naturligt till förnyelse eller använd en separat godkänd isolerad sessionsfixtur. Ändra inte projektets JWT-/sessioninställningar som testgenväg.
5. Blockera/avbryt nätverket lokalt före/under inloggning, getUser och refresh. Kontrollera låst läge och att gamla callbacks inte öppnar annat konto.
6. Prova utloggningsfel genom lokal nätverksblockering, därefter återhämtning och ny kontrollerad utloggning. Det är inte bevis för lyckad serveråterkallelse förrän servern bekräftat den. Ingen automatisk cleanup eller global logout.
7. Upprepa relevanta punkter i Safari på fysisk iPhone och dator med två flikar, inklusive sidcache och återgång från bakgrunden. Verifiera att inga gamla lokala poster importeras och att kontonycklar inte fylls av legacy-data.
8. Avsluta bara med separat godkända Auth-operationer. Radera inga konton, databasposter, exporter eller tidigare webbläsardata. Bevara felbevis i sanerad form och rapportera kvarvarande blockerare.

## Automatiserad verifiering och nästa steg

```sh
node --test tests/auth-test-release.cjs tests/auth-login.cjs tests/account-lifecycle.cjs tests/account-storage.cjs tests/local-data-safety.cjs
```

Testverktyg/miljövariabler enligt [AUTH_LOGIN.md](AUTH_LOGIN.md). Lokalt passerade **61 prov**, inklusive överordnade grupper, utan överhoppade browser-/byggprov. Byggproven testar determinism, hashmanifest, avstängt standardläge, förbjudna origins/Git-mappar/nyckeltyper, explicit aktivering och utebliven överskrivning. Browserprov vid 390 × 844 uppfyller alla filer/SDK lokalt, spärrar övriga anrop och kontrollerar testbanner, direkt träning, fel origin/konfiguration och att gamla data finns kvar men inte visas. Aktiveringsprovet använder endast syntetiska värden; ingen riktig Auth-server kontaktas.

Befintliga lokala databas-/guardprov: 17 passerade, ett tvåanslutningsprov hoppades över med PGlite. CI kör även befintliga isolerade PostgreSQL-, RPC- och Supabase Auth/REST-flöden; faktisk status länkas i PR:n. Inga SQL-tester/migrationer ändras. Inga deploy-/upload-steg, Pages-rättigheter, secrets eller variables läggs till.

Före riktig testaktivering återstår: godkänd separat host/origin och dess publiceringsprocess, bekräftad projektadress/publishable key och produktionsoriginlista utanför Git, två bekräftade syntetiska konton, granskning av den lokala flikfixen och plan för verkliga Auth-/Safari-prov, releasegranskning och särskilt godkännande av publicering samt varje typ av hostat Auth-anrop ovan. Ingen av dessa framtida behörigheter antas av detta uppdrag.
