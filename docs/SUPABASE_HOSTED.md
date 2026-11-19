# Hostad Supabase – installation efter separat godkännande
**Senare diagnosförslag:** Den historiska grundens avsiktliga 40001 kan ge återförsöksloop i PostgREST 14. [Diagnosen](RPC_TIMEOUT_DIAGNOSIS.md) föreslår en separat guardad funktionsmigration till PT409/HTTP 409. Installera inte den under ett gammalt godkännande och kör inte nya negativa hostade prov mot den gamla funktionen. Processen och grundfilens hash nedan är historiskt avgränsade till PR #18. En installation av det nya förslaget kräver egen granskning och separat godkännande. Inga hostade anrop görs i diagnosuppdraget.

PR #20, 19 november 2026, bas `b7537e2` efter PR #19. Detta är en förberedd manuell process. **Inga anrop, läskontroller, installationer eller kontoskapanden har gjorts mot projektägarens Supabase-projekt i denna etapp.** Appen och de lokala lagringsnycklarna ändras inte.

Projektägaren uppger att ett separat testprojekt har skapats. Det är inte verifierat av dessa filer. Ett projektnamn eller en URL bevisar inte att projektet är tomt, dedikerat eller avsett för test. Därför levereras inga hostade installationsskript, inga körbara hostade testsviter och inga hostade CI-steg. Operatören måste kontrollera mål och godkännanden manuellt. Om det inte går ska arbetet stoppas, inte automatiseras med svagare kontroller.

## Åtskilda godkännanden

| Grind | Krävs innan | Underlag |
| --- | --- | --- |
| A. Endast läsning | Någon ansluter till hostat projekt eller kör preflight | Ägaren har bekräftat exakt dedikerat testprojekt och medgett metadata-/tomhetskontroll. Denna PR ger inget sådant körmandat. |
| B. Installation | Migrationen körs | Genomförd aktuell preflight, granskad migration/hash, accepterade globala behörigheter och separat uttryckligt installationsgodkännande. |
| C. Syntetiska tester | Konton, fixturer eller RPC-testposter skapas | Godkänd postflight och separat tillstånd för två testkonton, syntetiska poster, mjuk radering/återställning och de avgränsade negativa skrivförsöken. |

En mergad PR betyder inte att grind B eller C är godkänd. Fråga inte om installation förrän den konkreta preflight-rapporten och migrationsfilen går att granska. Spara projektidentitet och godkännanden privat utanför Git. PR-kommentarer, issues, CI-variabler, artifacts och publika skärmbilder ska inte innehålla projekt-ID, nycklar, lösenord eller token.

## A. Preflight utan installation

1. Öppna rätt organisation och projekt i Supabase Dashboard. Projektägaren bekräftar i privat protokoll att det enbart är ett nytt Formresan-testprojekt, att ingen annan app använder det och att där inte finns riktig historik, importer, lagringsfiler, integrationer eller andra användare. Stäm av projektets identitet i projektöversikten och API-inställningarna. Jämför med ägarens privat angivna identitet. Namnlikhet räcker inte. Inga projektreferenser läggs i repo.
2. Stoppa om projektet är delat, om någon uppgift är oklar eller om någon annan kan göra parallella ändringar under installationen. Gör ingen upptäcktsmigration eller återställning. Granska även extra scheman och tidigare migrationshistorik. Supabases egna system-/extensionscheman kan finnas i ett nytt projekt och ska inte tas bort.
3. Efter grind A kör operatören endast `supabase/verification/hosted-preflight.sql` som postgres i det redan verifierade projektets SQL Editor. Filen börjar med `BEGIN TRANSACTION READ ONLY` och slutar med `ROLLBACK`. Den returnerar åtta booleanska kontroller samt schema-, objekt- och default-ACL-metadata. Den läser inga payloads, mejladresser eller användar-ID:n. Saknade systemtabeller eller SQL-fel betyder stopp.
4. **Alla åtta passed måste vara true.** Inga av de sju relationsnamnen, ingen public.apply_operation-överlagring eller formresan_private får redan finnas. Public får inte ha andra apptabeller, vyer, sekvenser eller funktioner utanför extensions. Auth och Storage ska vara tomma före kontoskapande. Detta är avsiktligt strikt. Om projektet redan har ett testkonto ska det inte raderas för att få grönt resultat. Utred och skapa en ny granskningsplan i stället.
5. Granska den övriga schemalistan manuellt. Nya appobjekt i andra scheman och andra integrationer kan inte uteslutas av public-kontrollen. Om migrationshistoriktabellen finns, låt behörig operatör granska versioner privat. Okänd historik stoppar installationen. Ta ingen genväg genom migration repair.
6. Ägaren måste uttryckligen acceptera att migrationen tar bort global standard-EXECUTE för framtida postgres-skapade funktioner i **alla scheman i databasen**, tar bort public-schema-standardgrants för klienter och stänger CREATE i public. Befintliga funktionsgrants ändras inte av ALTER DEFAULT PRIVILEGES. Det är inte enbart en ändring för Formresans tabeller. Ett dedikerat projekt är ett krav. Enbart schema-lokal REVOKE kan inte undanröja den globala PUBLIC-standarden. Se [behörighetsgranskningen](SUPABASE_AUTH_REST.md).

Preflight är ingen atomisk spärr på ett fjärrprojekt. Den bevisar inte projektets ändamål eller innehåll utanför kontrollerna. Godkännandet och kontrollen måste göras om om mål, behörigheter, migrationsfil eller projektinnehåll ändras. Kör kontrollen igen omedelbart före installation under ett överenskommet ändringsstopp. Kör aldrig migrationen om någon kontroll är false eller saknar resultat.

### Privat preflight-protokoll

Registrera separat och utanför repo exakt mål/organisation, kontrolltid, operatör, commit/hash, de åtta resultaten, granskning av extra scheman/integrationer/historik och ägarens uttryckliga acceptans av globala rättigheter. En publik redovisning ska bara säga förberett/kört/godkänt/ej verifierat, utan målidentifierare eller hemligheter. Radera inte tidigare rapporter vid ett fel.

## B. Granskad installation

Den enda avsedda installationsfilen är `supabase/migrations/20261119000100_foundation.sql`, oförändrad från PR #18. Den innehåller BEGIN/COMMIT runt alla ändringar. Kör inte verification-filer som migrationer och kopiera inte med exempeldata eller den lokala runnerns fixturekod.

Den granskade filens SHA-256, beräknad över UTF-8 med CRLF normaliserat till LF, är

```text
94326a15fbf26e1b5acc8a48aa06a9c25ba5396140794a127927df3636962d8e
```

Kontrollera från den granskade checkouten, helt offline från repots rot

```sh
node -e "const f=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(f.readFileSync('supabase/migrations/20261119000100_foundation.sql','utf8').replace(/\r\n/g,'\n')).digest('hex'))"
```

1. Efter färdig preflight begär ett separat, konkret godkännande av just denna version/hash och dess globala rättigheter i privat verifierat testprojekt. Ägaren får granska hela filen och rapporten. Godkännandet ska ange att inga andra migrationer, resurser eller riktiga data ingår.
2. Operatören dubbelkontrollerar projektidentiteten i Dashboard och kör preflight på nytt. Vid avvikelse stoppas arbetet. Använd en enda verifierad SQL Editor-flik som postgres. Undvik parallella flikar och sparade anslutningar med liknande namn.
3. Kör hela oförändrade filen, inklusive dess BEGIN och COMMIT, **som en enda körning**. Markera inte bara ett delavsnitt. Lägg inte till IF NOT EXISTS eller kör om efter ett fel. Filens hash och vald commit dokumenteras privat. Ingen hemlighet behöver klistras in i SQL-filen.
4. Direkt efter lyckad commit kör operatören `supabase/verification/hosted-postflight.sql`. Även den är skrivskyddad. Alla tolv passed måste vara true och alla sju row_count måste vara noll innan testposter skapas. Granska dessutom ägarpredikaten mot den mergade SQL-filen och hela funktionsdefinitionen via SQL Editors objektinspektion. RLS/ACL-grönt bevisar inte ensamt att en funktionskropp är rätt.
5. Kontrollera att Data API bara exponerar avsedda scheman och att formresan_private inte exponeras. Granska Supabases Security Advisor. Ett råd får inte tyst avfärdas eller åtgärdas genom öppnare grants. Ingen API-nyckel eller Supabase-klient läggs i Formresans app.

SQL Editor rekommenderas här för en manuellt vald, enstaka installationsfil. Den vägen registrerar **inte automatiskt** filen i CLI:s migrationshistorik. Dokumentera detta privat. Kör inte senare db push eller migration repair för att dölja skillnaden. Innan CLI-baserad drift införs behövs separat granskad avstämning mellan objekt, fil/hash och `supabase_migrations.schema_migrations`. Alternativ CLI-installation ska ha en egen granskad målbindning och dry-run, inte läggas till ad hoc i detta förfarande. [Supabase om migrationer och historik](https://supabase.com/docs/guides/deployment/database-migrations)

## C. Separata hostade Auth/REST-testkort

Följ [SUPABASE_HOSTED_TESTS.md](SUPABASE_HOSTED_TESTS.md) efter separat testgodkännande. Korten är instruktioner för en lokal API-klient med maskerade sessionsvariabler. De är inte ett importbart skript eller en CI-collection. Inga hostade anrop görs av repo eller CI. Använd endast publishable key från det privat verifierade testprojektet som apikey, och respektive riktiga testkontos token som Bearer. Secret/service_role får aldrig användas som klientnyckel. Inga nya konton skapas med administratörsnyckel.

Kör aldrig `tests/run-auth-rest.cjs`, `tests/database-security.cjs` eller cleanup/reset-kommandon mot hostat projekt. Den lokala Supabase-runnern har avsiktliga destruktiva cleanup-steg för sin egen nyskapade miljö och stöder inga hostade mål. Ändra inte dess URL-spärr för att återanvända den.

## Fel utan destruktiv rollback

| Händelse | Åtgärd |
| --- | --- |
| Preflight false, fel mål eller okänd historik | Stoppa innan installation. Bevara privat metadatautredning. Radera inga tabeller/konton för att få kontrollen att passera. |
| SQL-fel under installation | Stoppa. Vid fel inne i transaktionen kan dess ändringar inte committas, men kontrollera verkligt resultat med läsning. Skicka ingen andra migration eller global återställning. |
| Nätfel/timeout efter start | Utfallet är okänt, inte säkert misslyckat. Anslut bara efter ny målkontroll och granska vilka objekt/grants som finns. Kör inte migrationen igen. |
| Bara vissa objekt finns | Misstänk delkörning eller tidigare ändring. Frys arbetet, granska objekt och ACL. Ingen DROP, reset eller IF NOT EXISTS. En korrigering behöver separat versionshanterad migration och godkännande. |
| Postflight/RLS/REST-fel | Inga riktiga data får användas. Stoppa testerna. Bevara syntetiska poster och privat testprotokoll. Öppna inte tabellskrivrättigheter för att få tester gröna. |
| Delvis genomförda HTTP-testkort | Läs tillbaka endast de privat registrerade syntetiska post-/operations-ID:na. Återanvänd exakt samma operation vid ett nätverksosäkert skrivförsök, inte en ny. Konflikt ska utredas, inte automatiskt skrivas över. |
| Nyckel/token synlig i logg | Stoppa, hantera exponeringen privat och återkalla berörd session/nyckel enligt separat beslut. Klistra inte in incidentmaterial i PR. |

Återge inte global PUBLIC EXECUTE som generell rollback. Tidigare default ACL kan inte rekonstrueras säkert utan det privata preflight-underlaget. Ingen automatisk hårdradering, kontoradering, volymrensning eller databasåterställning ingår. Syntetiska testposter och tombstones lämnas kvar tills en uttrycklig, separat rensningsplan godkänts.

## Verifieringsstatus i denna PR

- Förberett: manuell mål-/godkännandeprocess, åtta preflight- och tolv postflight-kontroller samt separata hostade HTTP-testkort.
- Testat lokalt: `tests/hosted-checks.cjs` passerade fem tester inklusive överordnad grupp i ny PGlite. Kontrollerna reagerade på befintliga objekt/konton, avstängd RLS, extra öppen policy, kolumngrants, PUBLIC EXECUTE, återöppnad global standard och ändrad search_path. Inga hostade anslutningar görs i dessa tester.
- Hostad miljö: **ej verifierad**. Målidentitet, dedikerat ändamål, tomhet, globala rättigheter, installation, Auth-inställningar och samtliga HTTP-testkort återstår hos projektägaren efter respektive godkännande. Tidigare lokal Supabase-CI är inte ett hostat godkännande.
- Befintliga PostgreSQL-/Supabase-regressioner bibehålls. CI kör endast nya temporära lokala miljöer. Faktiska körresultat redovisas i PR:n, inte som antaganden om det hostade projektet.

Kompletterande källor är [Supabase om publishable och privilegierade nycklar](https://supabase.com/docs/guides/getting-started/api-keys), [Auth-lösenordsflödet](https://supabase.com/docs/guides/auth/passwords) och [säkerhetskontroller](https://supabase.com/docs/guides/security/production-checklist).
