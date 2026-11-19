# Supabase – databas och säkerhetsgrund

Underlag för PR #18, 19 november 2026. Bas är `b41d6d7`, senaste `main` efter PR #17. Läs tillsammans med `SUPABASE_PLAN.md`. Ingen SQL har körts mot ett riktigt Supabase-projekt. Appen använder fortfarande enbart sin befintliga lokala lagring.

## Levererad avgränsning

`supabase/migrations/20261119000100_foundation.sql` skapar sju tabeller, RLS, rättigheter och en transaktionsfunktion. Inga befintliga appfiler ändras. SQL installeras först efter granskning och godkända isolerade tester.

| Tabell | Modell och åtkomst |
| --- | --- |
| main_entries | UUID per molnpost, ursprunglig JSONB, härledd typ och kalenderdatum, revision och tombstone |
| training_sessions | UUID, komplett sessionspayload inklusive övnings-ID:n, datum och samma revisionsmetadata |
| user_settings | UUID och unik `(user_id, setting_key)`, inledningsvis endast `goals` med protein/cal |
| record_versions | En oföränderlig version per lyckad operation, inklusive raderingsmarkering |
| sync_operations | Kvitto och kanonisk JSONB-begäran, unik `(user_id, operation_id)` |
| migration_batches | Status, källhashar, ID-mappning, antal och revision för kommande migrering |
| migration_snapshots | Exakta råsträngar från de två lokala nycklarna, kopplade till en ägarbunden batch |

Alla tabeller har ägarindex genom primärnyckeln och servergenererad skapelsetid. Aktuella datatabeller har schema_version 1 och positiva revisioner. Historikens sammansatta primärnyckel hindrar dubbla revisioner. Främmande nycklar till auth.users saknar kaskadradering. Versionshistorikens kvitto-FK kontrolleras senast vid commit.

Kalenderdatum lagras som validerad ISO-text, inte som tidszonskonverterad tidsstämpel. Härledda datumkolumner kan inte avvika från payload. Sömn och kreatin har ett unikt aktivt dagsvärde per konto. Gamla dubbletter måste granskas innan framtida import. `user_settings` får UUID även för inställningar för ett enhetligt operationsprotokoll, med unik goals-nyckel i tillägg till UUID. Det preciserar planens tidigare nyckelförslag.

Gamla numeriska ID:n, även giltiga decimaltal, och okända extra fält ligger kvar i payload. Övnings-ID:n skrivs inte om. Kända numeriska fält, datum, kind, grundläggande träningsstruktur och goals valideras. En provisorisk gräns på 1 MiB per post gäller. Verkliga exporter måste granskas före migrering. SQL ersätter inte framtida importvalidering och tillåter inte automatiskt nya schemaversioner. Råa migrationssnapshots parsas inte och kan bevara trasig JSON för granskning.

## Skrivprotokoll

Klienten saknar INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES och TRIGGER på samtliga sju tabeller. Den enda tillåtna skrivfunktionen är

```text
apply_operation(operation_id UUID, collection TEXT, entity_id UUID,
                expected_revision BIGINT, payload JSONB, action TEXT = 'put')
```

- `collection` måste vara main_entries, training_sessions eller user_settings. Andra värden avvisas före dynamisk SQL. Tabellnamnet vitlistas och citeras, alla datavärden binds som parametrar.
- Ny post kräver expected_revision 0 och action put. Nästa revision blir 1. Klienten skapar ett nytt moln-UUID och beständigt operations-UUID, skilda från gamla ID:n.
- Uppdatering kräver exakt aktuell revision. Konflikt ger SQLSTATE 40001. Ingen automatisk omskrivning med en ny revision får ske i en framtida klient.
- Delete kräver null-payload och sätter serverns deleted_at. Innehållet bevaras. En borttagen post kan inte återupplivas med put. Restore kräver aktuell revision och uttrycklig payload och skapar en ny revision. Återställningsval och förhandsvisning tillhör senare etapp.
- Ägare härleds alltid från auth.uid(). Funktionen tar inget ägarargument. UUID används bara som uppslagsnyckel inom detta konto. Försök med B:s UUID och revision ändrar aldrig B. Samma UUID kan förekomma under ett annat konto eftersom identiteten är sammansatt med ägaren.
- Gamla payload.id får inte ändras vid uppdatering. Textfält och extra JSON-fält är opaka data. Exempelvis payload.user_id eller payload.revision kan aldrig ändra kolumnernas rättigheter eller revisioner. Framtida adapter måste använda kolumnmetadata för auktoritet och säkert rendera fritext.
- Ett transaktionsbundet advisory lock per konto serialiserar dess skrivningar, inklusive skapande och samtidiga återförsök. Befintlig rad läses dessutom FOR UPDATE. Detta är enkelt men begränsar parallella skrivningar inom samma konto. Låskollisioner mellan konton innebär endast väntan.
- Samma operation och identiska JSONB-argument returnerar ursprungligt kvitto. Samma operations-ID med annan begäran ger 22023. Kanonisk JSONB jämförs direkt i stället för en hash, så hashkollisioner kan inte godkänna fel begäran. Ursprunglig begäran bevaras och upptar extra utrymme.
- Post, version och kvitto skrivs i samma transaktion. Fel eller rollback lämnar inget delresultat. Misslyckade operationer får inget kvitto. Inga gamla kvitton gallras i denna etapp.

Övriga ogiltiga argument och payload ger 22023. Unikt dagsvärde eller goals-kollision ger 23505. Behörighetsfel ger 42501. Framtida klient behöver hantera dessa separat från nätfel. Serverns klocka används för tidsstämplar. Kvitto returnerar operation, collection, UUID, revision, tombstone och uppdateringstid.

## Rättighetsgranskning

RLS aktiveras på alla sju tabeller med en enda SELECT-policy för authenticated där auth.uid() = user_id. Anon saknar tabellrättigheter och EXECUTE på skrivfunktionen. En authenticated-roll utan användar-ID får inga rader och skrivfunktionen avvisar anropet. Inga öppna skrivpolicyer finns.

`apply_operation` är SECURITY DEFINER med ägaren postgres, tom search_path och schemaangivna tabeller, auth.uid och privat validator. PostgreSQLs inbyggda funktioner slås upp i pg_catalog. RLS begränsar normalt inte tabellägaren. Därför kontrollerar funktionen autentisering och konto explicit för varje läsning och skrivning, inklusive kvitton och historik. Den accepterar inga fritt valda scheman, SQL-uttryck, roller eller ägar-ID:n. Detta är ett avgränsat avsteg från planens föreslagna SECURITY INVOKER plus skrivtriggers. Här hålls alla direkta skrivvägar stängda och hela transaktionen sker i en granskbar funktion. [PostgreSQL om RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [Supabase om funktioner](https://supabase.com/docs/guides/database/functions)

Det privata schemat saknar USAGE för PUBLIC, anon och authenticated. Validatorn saknar klient-EXECUTE. CREATE i public återkallas för klientroller och PUBLIC. Endast authenticated får uttrycklig EXECUTE på den publika skrivfunktionen. Inga vyer, extra RPC:er eller triggers exponeras.

Migrationen återkallar **global** default EXECUTE för framtida funktioner skapade av postgres och även motsvarande schema-specifika grants. En enbart schema-lokal revoke skulle inte undanröja PostgreSQLs globala PUBLIC-standard. Framtida public-tabeller skapade av postgres får inte automatiska klientgrants. Det påverkar nya postgres-ägda funktioner även utanför Formresan, och måste granskas före installation i ett delat projekt. Befintliga Supabase-systemfunktioner ändras inte. Migrationer ska köras som postgres. En annan skaparroll har egna default privileges som måste granskas separat. Testet skapar en ny funktion och kontrollerar faktisk EXECUTE för båda klientrollerna. [Supabase om API-rättigheter](https://supabase.com/docs/guides/api/securing-your-api)

Administratörer, databasägare och service_role är betrodda driftroller, inte testklienter. De kan kringgå klientgränsen och får inte användas från appen. Ingen constraint skyddar mot en administratör som medvetet ändrar själva databasen. Alla nya tabeller/RPC:er kräver en ny granskning.

## Medvetet stängd migrationsväg

Batcher och råsnapshots kan läsas av ägaren men **inte skapas eller ändras av klienten ännu**. Inga migrations-RPC:er finns. Säker batchinitiering, hashverifiering, beständig ID-mappning, bootstrap-status, återupptagning och slutförande måste implementeras och testas i senare PR före någon verklig import. Inte heller migrationsräknare/revision uppdateras automatiskt här. Testerna lägger endast in syntetiska migrationsfixturer som administratör för att verifiera läsisolering. Inga oskyddade tillfälliga skrivvägar lämnas öppna.

## Reproducerbar isolerad verifiering

Kräver Node 22 eller senare. Testberoenden ligger under tests och används inte av appen.

```sh
npm ci --prefix tests
node --test tests/database-security.cjs
```

Utan databas-URL skapas en ny minnesdatabas i PGlite. Motorn kör PostgreSQL, PL/pgSQL, roller och RLS, men har bara en anslutning. Provet med två anslutningar rapporteras som SKIPPED. Det får inte räknas som verifierad samtidighet eller Supabase-integration.

För fulla PostgreSQL-prov kan man använda en ny tom, lokal PostgreSQL 17-databas med namnet formresan_test eller formresan_test_*. Kör som postgres. Testet skapar de minimala auth-fixturerna själv och vägrar om auth-schemat redan finns. Det kör alltså **inte** mot en normal Supabase-installations auth-schema och kan inte radera eller återställa en tidigare testdatabas.

Ett exempel för Docker i en separat lokal testmiljö är följande. Trust-autentisering är endast för denna tillfälliga databas, med syntetiska data, bunden till loopback. Använd den aldrig för drift eller på delad dator. Inget beständigt datavolymnamn används.

```sh
docker run --rm --name formresan-test-pr18 -p 127.0.0.1:55432:5432 -e POSTGRES_DB=formresan_test_pr18 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
```

Vänta tills databasen är redo och kör i en annan terminal, med miljövariabelsättning anpassad till ditt skal.

```powershell
$env:FORMRESAN_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/formresan_test_pr18'
node --test tests/database-security.cjs
Remove-Item Env:FORMRESAN_TEST_DATABASE_URL
docker stop formresan-test-pr18
```

Runnern godtar bara loopback och särskilt testdatabasnamn. Den skapar inga riktiga konton. Auth-fixturen härleder UUID från en lokal transaktionsinställning. Detta simulerar PostgRESTs betrodda JWT-kontext och verifierar databasroller, **inte** JWT-signatur, tokenförnyelse, REST eller Auth-servern. En användare med direkt SQL-kontroll kan själv sätta denna testkontext och är därför inte en webbläsarklient.

Workflow `.github/workflows/database-security.yml` kör samma test mot en separat PostgreSQL 17-service och två anslutningar vid relevanta PR-ändringar. Den kräver inga GitHub-hemligheter, har bara contents:read och använder syntetiska data. PostgreSQL-imagen följer majorversion 17 för patchuppdateringar. Beroenden för testverktygen är versionslåsta med lockfil.

### Faktiskt körda kontroller i utvecklingsmiljön

Den 19 november 2026 kördes migrationen i PGlite 0.5.16. Sju underprov passerade. Node rapporterade åtta godkända inklusive överordnad grupp och ett överhoppat samtidighetsprov. Kontrollerna omfattade

- RLS och A/B-läsning i alla sju tabeller, anonymt nekad åtkomst, nekade INSERT/UPDATE/DELETE/TRUNCATE och ändring av ägare/moln-ID.
- Nekad åtkomst till B:s post via funktionen, fel revision och oföränderligt äldre numeriskt ID.
- Identiskt återförsök och avvisat återanvänt operations-ID med annat innehåll.
- JSONB med fel typer, ogiltigt datum, SQL-liknande text och manipulerade metadata. Okända fält och numeriskt decimal-ID bevarades.
- Mjuk radering, versionskedja, blockerad oavsiktlig återupplivning, uttrycklig återställning samt rollback av post/version/kvitto.
- Unika dagsposter och ingen kvittoskrivning efter constraint-fel.
- Schema- och funktionsbehörigheter, ägare/search_path, privat helper och faktisk default EXECUTE för en ny funktion.

Docker, PostgreSQL-server och Supabase CLI fanns inte installerade lokalt. Två samtidiga serveranslutningar och riktig lokal Supabase är därför **inte lokalt verifierade**. CI-resultatet måste granskas separat i PR:n. JavaScript-syntaxkontroll och git diff --check körs före leverans. Ingen mobiltestning behövs för oförändrad appkod och inga iPhone-resultat påstås för denna backend-etapp.

### Faktiskt körd CI med PostgreSQL

[CI-körning 44488388443](https://github.com/Erngren/formresan/actions/runs/44488388443) passerade den 19 november 2026 med PostgreSQL 17 i en tillfällig container. Alla åtta underprov passerade, nio tester inklusive överordnad grupp, inga överhoppade. Två separata anslutningar försökte uppdatera samma revision. Exakt en lyckades och den andra fick 40001. Samtidiga identiska operations-ID:n gav samma kvitto och endast en version. Första CI-körningen upptäckte en skillnad i drivrutinernas bigint-avkodning i en testjämförelse. Jämförelsen korrigerades och hela sviten kördes om med godkänt resultat. Ingen ändring i databaslogiken behövdes.

## Senare Supabase-konfiguration

1. Skapa först efter uttryckligt godkännande ett separat testprojekt, välj tillgänglig EU-region och bestäm driftansvar/kostnad. Skapa inga produktionsdata i piloten.
2. Granska migrationen och kör den med CLI som postgres. Kontrollera grants/default privileges, ägare, RLS och säkerhetsrådgivaren i den faktiska Supabase-miljön. Exponera bara public, aldrig formresan_private. Public innehåller endast den avsedda skrivfunktionen och ägarfiltrerade tabellerna.
3. Genomför separata REST/RPC-prov med två riktiga testkontons access tokens, publishable key och en anonym/utgången/förfalskad token. Använd inte service_role som klient. Granska både funktionsrättigheter och radinnehåll efter angreppsförsök. Realtime är inte aktiverat i denna migration och ska testas separat om det senare slås på.
4. Konfigurera Auth med e-postkod, e-postmall, SMTP och inbjudnings-/registreringsregler i Auth-etappen. Site URL och redirect allowlist ska vara exakta. `supabase/config.example.toml` är en dokumentationsmall utan nycklar. Den är inte en komplett lokal CLI-konfiguration. Projekt-URL och publishable key får senare ligga i klienten, inga secret/service-role-nycklar eller SMTP-/databaslösenord. [Supabase om nycklar](https://supabase.com/docs/guides/getting-started/api-keys)
5. Bestäm retention, backup/PITR, kontoradering och återställningsövning före riktiga data. Ingen gallring eller automatisk kontokaskad ingår här.

## Kvarstående risker och nästa steg

Databasprov är inte samma sak som säker REST/Auth-integration. CI med faktisk PostgreSQL är godkänd. Efterföljande lokal Supabase-verifiering och kodgranskning återstår före installation. Riktiga exporter, dagsdubbletter, storleksgränser och okända äldre fält behöver granskas inför migration. En fullständig återläsnings-/bootstrap-RPC, paginering, migrationsskrivning, användarstyrt återställningsflöde och beständig lokal operationskö återstår. Ingen automatisk synk eller klientanpassning levereras här.

Föreslagen ordning är databasgranskning och säkerhetstest, isolerad Supabase-installation med REST-prov, därefter en separat inloggnings-PR och molnpilot enbart med syntetiska data. Migrering kräver ett eget godkänt uppdrag. Befintliga `formresan_v1` och `formresan_training_v14` har inte ändrats eller lästs av backendtesterna.
