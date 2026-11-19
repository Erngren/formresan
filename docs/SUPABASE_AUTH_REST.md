# Supabase Auth/REST – isolerad säkerhetsverifiering
**Versionsvillkor:** Den lokala testsviten använder nu även det separata migrationsförslaget `20261119000200_revision_conflict_http409.sql` och kräver PT409/HTTP 409. Det ersätter den avsiktliga 40001-koden, inte verkliga PostgreSQL-serialiseringsfel. Tidigare CI-resultat i dokumentet är historiska. Se [diagnos och nya verifieringskrav](RPC_TIMEOUT_DIAGNOSIS.md). Ingen hostad körning ingår.

PR #19, bas `dc77672` på main efter PR #18, 19 november 2026. Läs först `SUPABASE_PLAN.md` och `SUPABASE_DATABASE.md`. Detta steg ändrar inga appfiler, lokala lagringsnycklar eller riktiga användardata.

## Behörighetsgranskning av PR #18

Den mergade migrationen lämnas oförändrad. Ingen korrigerande SQL-migration behövs utifrån denna kodgranskning. Det är inte ett påstående om godkänd produktionsinstallation.

| Område | Verifierat i SQL och konsekvens |
| --- | --- |
| Globala default privileges | `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` gäller framtida funktioner skapade av postgres i **alla scheman i denna databas**. Det ändrar inte befintliga funktionsgrants eller andra databaser/projekt. |
| Schema-lokala standardrättigheter | Även schema-specifika funktionsgrants i public tas bort. Nya postgres-skapade public-tabeller får inga automatiska klientgrants. CREATE i public återkallas för PUBLIC/anon/authenticated. Detta kan påverka andra appar som förväntar sig att skapa public-objekt som klient eller få automatiska grants. |
| Begränsning av den globala ändringen | Enbart `IN SCHEMA public REVOKE` tar inte bort PostgreSQLs globala PUBLIC-standard för nya funktioner. Att återge global EXECUTE skulle återöppna framtida funktioner, även om anon/authenticated saknar explicit grant. Vi återställer därför inte denna standard i denna PR. |
| Minsta Formresan-rättigheter | authenticated behöver USAGE i public, SELECT på de sju tabellerna och EXECUTE på just apply_operation. Samtliga direkta skrivprivilegier är återkallade. Ägarfiltrerad SELECT-policy finns på varje tabell. Anon behöver ingen privat tabell eller RPC. |
| Privat validator | formresan_private saknar klient-USAGE. valid_payload saknar PUBLIC-/klient-EXECUTE. Schema exponeras inte genom REST. Funktionen är invoker/immutable och validerar data, utan godtycklig SQL. |
| SECURITY DEFINER | apply_operation ägs av postgres, har tom search_path, använder auth.uid() och ägarfilter för varje tabellåtkomst. Tabellnamn vitlistas före format med %I och alla värden binds. Åtkomst bygger inte på RLS inne i den privilegierade funktionen. Metadata i payload ger ingen auktoritet. |
| PUBLIC | PUBLIC är en implicit grupp för alla roller, inte samma sak som anon. PUBLIC:s tabell- och funktionsgrants återkallas uttryckligen. Standard-USAGE i public är inte i sig privat dataåtkomst och behövs inte återkallas när objekträttigheterna är stängda. |
| Andra ägare | Standardprivilegier gäller den skapande rollen, inte automatiskt alla dess medlemsroller. Framtida migrationer ska köras som postgres och granskas. Supabase-systemobjekt kan ägas av andra roller och omfattas inte automatiskt av Formresans standardspärr. |

**Ett dedikerat Supabase-projekt är ett krav med den nuvarande migrationsmodellen.** Installera inte migrationen i ett projekt som delas med andra appar. De globala rättigheterna är en databasövergripande säker standard, inte en garanti för kompatibilitet med andra appar eller framtida tillägg. Även framtida funktioner i privata scheman måste få nödvändiga explicita grants till sina avsedda serverroller.

Ett framtida alternativ för ett delat projekt är en särskild NOLOGIN-skaparroll och eget schema för Formresan, med globala standardspärrar begränsade till den rollen. Det kräver omarbetad objektägare, funktionsrättigheter och migrationsverktyg. Det införs inte här. Att automatiskt återställa tidigare postgres-standarder är heller inte säkert eftersom deras ursprungliga ACL inte sparades av PR #18.

Källor som granskats är [Supabase om API-rättigheter och globala standarder](https://supabase.com/docs/guides/api/securing-your-api), [databasfunktioner](https://supabase.com/docs/guides/database/functions) och [PostgreSQL ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html). Separat databasverifiering från PR #18 ersätter inte riktiga Auth-/REST-prov.

## Testernas isolering

`tests/run-auth-rest.cjs --isolated-local` är enda körvägen för integrationssviten. Den tar inte emot ett projekts URL, nycklar, konto eller databasanslutning som argument eller miljökonfiguration. Remote-/hostade projekt stöds inte, även om de skulle vara avsedda för test.

Runnern kräver lokal Docker-socket (unix eller Windows named pipe) och vägrar tcp/ssh-kontext. Därefter skapas ett nytt temporärt projekt med slumpmässigt ID, ny konfiguration, nya volymer och separat Docker-nät. Den kontrollerar före start att projektets containrar/volymer inte redan finns. Ingen befintlig lokal Supabase-stack återanvänds och inget repo länkas till ett konto. Ärvt Supabase-/PG-/Formresan-mål och CLI binary override förs inte vidare. Angivna vanliga projekt-/nyckelvariabler stoppar körningen.

Endast migrationsfilerna kopieras till den nya katalogen. Inga lokala exporter, seedfiler, appdata, .env-filer eller Supabase-länkar kopieras. Docker-nätets portbindning sätts till 127.0.0.1. Runnern kontrollerar faktisk containeridentitet, nät och portbindningar, CLI-statusens API- och databasport, tomma auth.users och alla sju tomma datatabeller innan konton och fixturer skapas. Fel eller saknad migration stoppar körningen.

Kontona skapas via vanlig `/auth/v1/signup` och loggar in via `/auth/v1/token?grant_type=password`. De har slumpmässiga lösenord i minnet och adresser under example.test. Lokal e-postbekräftelse är avstängd. Inga riktiga e-postmeddelanden eller administrativt skapade konton behövs. Lösenordsflödet används endast som testverktyg för att få riktiga signerade access tokens. Det beslutar inte Formresans kommande inloggningsvy eller ersätter framtida prov med e-postkod/iPhone.

REST-klienten använder bara publishable key eller lokal legacy anon-nyckel, aldrig secret/service_role. Auth-/sessionstoken och lösenord loggas eller skrivs inte till fil. CLI:s start-/statusutdata undertrycks eftersom de kan innehålla privilegierade lokala nycklar. Bara den publika nyckeln plockas ut till klienten. CLI:s lokala databas-URL används i separat fixturesetup för tomhets-/rättighetskontroll och syntetiska sentinelrader i migrationstabellerna. Den administratörsanslutningen skapar **inga konton** och används aldrig för att avgöra REST-provens kontoavskiljning. Ingen administratörs-API-nyckel används.

Migrationsmetadata saknar avsiktligt klientskrivväg. Separat setup lägger därför in en syntetisk batch och snapshot för varje Auth-konto, efter kontroll att Auth-ID:n exakt motsvarar den nya lokala databasens två användare. Därmed kan läsisolering testas på riktiga rader, inte bara tomma tabeller.

Normalt stoppas endast detta slumpmässiga projekt med `stop --no-backup --project-id ...`, varefter endast dess nät och temporära katalog tas bort. Inget `stop --all`, `db reset`, `link`, fjärranrop eller SQL-installation i ett befintligt projekt används. Avbruten process eller misslyckad cleanup kan lämna syntetiska resurser kvar. Hantera då enbart det aktuella temporära projektet, aldrig alla lokala projekt. Kör på en betrodd utvecklingsmaskin eller en tillfällig CI-runner med Docker-rättigheter. Den som kan manipulera Docker eller testskriptet tillhör den betrodda administrationsgränsen.

## Körinstruktioner

Kräver Node 22+, Docker Desktop/Engine med Linux-containrar samt utrymme/nät för Supabase-images. CLI 3.2.0 är versionslåst som testberoende. Ingen Supabase-inloggning, access token eller projektägarkonto behövs. CLI:s egen katalog kan skapas under den nya temporära katalogen, inte användarens vanliga Supabase-profil.

```sh
npm ci --prefix tests
node --test tests/auth-rest-guards.cjs
node tests/run-auth-rest.cjs --isolated-local
```

Stäng av ärvda projekt-/nyckelvariabler först. Runnern vägrar i stället för att falla tillbaka till en befintlig miljö. Ett fel ger en felkod och inget godkänt integrationsresultat. Den undertrycker externa verktygsfeltexter för att undvika nyckelläckor. Steget där körningen stannade framgår av de säkra progressmeddelandena. Publicera inte rå CLI-status, container-env, HTTP-headers eller Auth-svar vid felsökning.

JWT-livslängden sätts till 60 sekunder i **den nya lokala testkonfigurationen**. Ett riktigt Auth-utfärdat token sparas i minnet och får löpa ut naturligt. Expiry-provet väntar upp till exp + 65 sekunder för serverns eventuella tidsmarginal och kräver att REST och RPC nekar token. Ingen signeringshemlighet används för att fabricera ett utgånget godkänt token. Sviten gör ingen tokenförnyelse under detta prov.

Workflow `.github/workflows/supabase-auth-rest.yml` kör samma kommandon på en tillfällig GitHub-runner med Docker, utan GitHub-hemligheter och med contents:read. Det är en riktig lokal Supabase-stack i CI, inte projektägarens hostade projekt. Kontrollera den faktiska körningen innan något resultat räknas som godkänt. CLI och npm-beroenden låses med lockfil. CLI väljer kompatibla container-images, så behåll även körningens verktygs-/imageversioner vid senare reproduktion.

[Supabase om lokal utveckling](https://supabase.com/docs/guides/local-development/cli/getting-started), [CLI-konfiguration](https://supabase.com/docs/guides/local-development/cli/config), [lokala och hostade mål i CLI v3](https://supabase.com/docs/guides/local-development/local-and-hosted-projects).

## Integrationsscenarier och beviskrav

Varje PASS-rad skrivs först när motsvarande riktiga HTTP-anrop har kontrollerats. Felstatus från en otillgänglig tjänst räknas inte som ett behörighetsfel.

| Scenario | Kontroll |
| --- | --- |
| Auth-identitet | Två registreringar och lösenordsinloggningar, /user, sub och authenticated-claim. RPC-skapade raders user_id måste matcha det verkliga Auth-ID:t. |
| Anonym | SELECT i alla sju tabeller samt apply_operation avvisas med 42501 och HTTP 401/403. |
| A/B | Båda har sentinelrader i alla tabeller. Ägarläsning fungerar och explicit annat user_id/UUID ger tomt resultat. |
| B angriper A | Direkt PATCH/DELETE nekas. RPC med A:s UUID/revision ger konflikt. Efterkontroll som A visar oförändrad revision/payload. |
| Metadata/JSONB | Direkt INSERT och PATCH av ägare, UUID och revision nekas. Payload med falskt user_id/entity_id/revision ger ingen kolumnauktoritet. Fel ID-typ och SQL-liknande collection avvisas. |
| Revision | Efter det nya separata migrationsförslaget ger fel revision PT409/HTTP 409, ingen kvittorad. Den historiska 40001 kan utlösa interna återförsök i äldre PostgREST. Kontrollera koden och återläs, tolka inte alla HTTP 500 som nätfel eller gör blind omskrivning. |
| Idempotens | Samma operation ger samma kvitto och en version. Ändrat innehåll ger 22023. Även parallella identiska återförsök ingår. |
| Radering | Tombstone och ny version, blockerad put på raderad post, explicit restore med ny revision och bevarad versionskedja. |
| Historik/migrering | POST/PATCH/DELETE nekas för versioner, kvitton, batcher och snapshots. Efterkontroll är oförändrad. Privat validator är inte exponerad RPC. |
| Token | Ogiltig token och ändrad sub/role utan omsignering nekas i REST/RPC och Auth. Riktigt utfärdad token som passerat exp nekas i REST/RPC. |
| Samtidighet | Två REST-anrop med samma förväntade revision ger exakt en framgång och en PT409/HTTP 409. Slutrevision och antal versioner kontrolleras. |

PostgRESTs egna [felkoder och HTTP-mappning](https://docs.postgrest.org/en/stable/references/errors.html) ligger till grund för kontrollerna. Testsvarens råa feltexter loggas inte.

## Faktiskt körda tester och återstår

Lokalt den 19 november 2026 passerade tre spärrtester i `auth-rest-guards.cjs`, syntaxkontroller för de nya skripten och befintlig PGlite-regression med sju underprov (åtta inklusive överordnad grupp), ett överhoppat tvåanslutningsprov. Testberoenden installerades med npm och audit rapporterade noll kända sårbarheter vid denna körning.

Docker saknas lokalt. Ett integrationsförsök stoppades före miljö-/kontoskapande och HTTP-prov. **Inget av de 13 riktiga Auth/REST-scenarierna är därför lokalt verifierat.** CI-resultatet redovisas separat i PR:n om körningen blir klar. Fysisk iPhone, e-postkod, SMTP, återinloggning, bakgrundsläge, Realtime och ett hostat Supabase-projekt ingår inte i denna testsvit.

### Verifierat i CI med riktig lokal Supabase-stack

[Auth/REST-körning 44492718865](https://github.com/Erngren/formresan/actions/runs/44492718865) passerade den 19 november 2026 med Supabase CLI 3.2.0 på en tillfällig Ubuntu-runner med Docker. Tre spärrtester och samtliga 13 riktiga Auth/REST-scenarier passerade. Auth utfärdade två separata kontons signerade token. REST-skapade raders user_id jämfördes med dessa Auth-ID:n. Alla sju tabeller hade syntetiska sentinelrader så kontoavskiljningen inte kunde passera enbart på tomma resultat.

Parallella REST-uppdateringar gav en vinnare och en revisionskonflikt. Parallella identiska återförsök gav samma kvitto. Den verkliga access-token som sparats från Auth tilläts löpa ut naturligt och nekades därefter i både REST-läsning och RPC. Ogiltig token och manipulerad sub/role nekades i REST/RPC och Auth. Projektbegränsad stop med borttagning av testvolymer samt nät-/katalogcleanup slutfördes utan fel. Inga hostade resurser eller projektägarkonton användes.

Även [befintlig PostgreSQL-regression 44492718697](https://github.com/Erngren/formresan/actions/runs/44492718697) passerade på denna PR, nio tester inklusive överordnad grupp och inga överhoppade. Detta kompletterar den lokala PGlite-körningen. Ingen installation i ett hostat projekt är verifierad eller godkänd genom dessa resultat.

`tests/database-security.cjs` och den mergade SQL-migrationen ändras inte. Den befintliga PostgreSQL-CI:n fortsätter verifiera databasgrunden. Ingen Supabase-resurs skapas i projektägarens konto och ingen produktionsinstallation eller migrering tillåts av testskriptet. Efter kodgranskning och godkända integrationsprov kan nästa separat godkända etapp planeras. Appen börjar inte lagra molndata genom denna PR.
