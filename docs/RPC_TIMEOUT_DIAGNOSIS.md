# RPC-timeout, revisionskonflikt och förslag inför 1.0

Diagnos från main `2f2d477` efter PR #20. Inga anslutningar, SQL-anrop, konton, inställningar eller poster har hanterats i hostad miljö. Ägarens observationer nedan är lämnade uppgifter, inte egna hostade mätningar.

## Slutsats och minsta förslag

**Sannolik orsak är transaktionsåterförsök i PostgREST på den avsiktligt kastade koden 40001.** Det passar kombinationen många revision_conflict, klient-timeout och oförändrade data. Det är inte bevisat att just den hostade instansen använder en drabbad version. Enstaka loggrader, en senare aktivitetsbild och SQL Editors timeoutvärden avgör inte det.

Föreslaget API-fel är HTTP 409 med `code: "PT409"` och `message: "revision_conflict"`. Den separata migrationen `20261119000200_revision_conflict_http409.sql` ersätter bara de två avsiktliga 40001-koderna i apply_operation. Den ursprungliga installerade migrationen förblir oförändrad. Signatur, ägarskap, ACL, SECURITY DEFINER, tom search_path, lås, revisionsjämförelse, idempotens och atomiska skrivningar bevaras. Verkliga motorfel som serialization_failure fångas eller skrivs inte om.

Detta är en granskad kandidat för lokala tester, **ingen hostad installation eller garanti mot alla slags timeout**. Lås- och nätverksfördröjning kan fortfarande förekomma. Framtida klienter måste känna till det nya felkontraktet innan ett separat godkänt hostat prov.

## Bekräftat i kod

Radnumren nedan gäller den oförändrade grundmigrationen och bascommitten. De finns även som stabila sökankare.

| Kodställe | Fynd |
| --- | --- |
| foundation.sql 154 | user_id härleds från auth.uid(), inte payload. |
| 167 | pg_advisory_xact_lock låser en hash av **anropande användarens** UUID. B låser normalt inte A:s konto. Hashkollision eller annan B-transaktion kan ändå ge väntan. |
| 169–172 | Tidigare operationskvitto läses per konto. Identiskt återförsök returnerar kvittot, ändrad begäran avvisas. |
| 175–176 | FOR UPDATE filtrerar på user_id = anropande konto och begärt entity_id. En B-begäran hittar inte A:s rad och kan inte ta radlåset på den raden. Tabell-/DDL-lås och annan samtidig aktivitet är inte uteslutna. |
| 177–181 | Saknad post med expected_revision > 0, delete mot saknad post eller avvikande befintlig revision kastar uttryckligen revision_conflict med 40001. Det är en avsiktlig affärsregel, inte bevis för att PostgreSQL upptäckt en serialiseringsanomali. |
| 187–188 | Delete kräver null-payload, men kontrollen sker **efter** revisions-/ägarkontrollen. |
| 201–213 | Post, version och kvitto skrivs först efter dessa kontroller. Ett konfliktundantag ska lämna alla tre oförändrade. |

I `tests/auth-rest-security.cjs`, funktionen http, gör varje anrop en fetch med 15 sekunders AbortSignal och ingen egen retry-loop. Parallella anrop och avsiktliga idempotensprov skickar uttryckligen flera begäranden. `tests/database-security.cjs` rullar tillbaka fel och kastar vidare, utan automatisk ny transaktion. Ingen molnklient eller automatisk Supabase-synk finns i appkoden. Den befintliga lokala lagrings-/låsningslogiken ändras inte av förslaget. Det använda hostade testverktygets nätverksbeteende finns inte i repo och har inte granskats.

## Dokumenterat beteende

PostgreSQL använder 40001 för serialization_failure och rekommenderar att hela transaktionen kan återförsökas vid sådana motorfel. PostgreSQL erbjuder inte själv ett allmänt automatiskt återförsök. [PostgreSQL 17](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)

Supabases felsökningsartikel, uppdaterad 4 november 2026, beskriver att en egen RAISE med 40001 kan orsaka oändliga PostgREST-transaktionsåterförsök. Artikeln anger PostgREST 14 som drabbad och 16 som korrigerad och rekommenderar exempelvis PT-prefix för ett HTTP-fel. Detta är en primärkälla som stämmer väl med observationerna men fastställer inte versionen i ägarens projekt. [Supabase Knowledge Base](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)

Upstreams issue kopplar återförsöken till hasql-transaction. [PostgREST #3673](https://github.com/PostgREST/postgrest/issues/3673). Därmed kan ett HTTP-anrop ge många databastransaktioner utan nya klientanrop. Äldre versionsbeteende får inte härledas enbart från den aktuella dokumentationens HTTP-tabell.

PostgRESTs dokumenterade felmappning anger 40*-klassen som HTTP 500 när felet faktiskt returneras. Ett PT409-undantag ger explicit HTTP 409. P0001 skulle normalt ge HTTP 400. PT409 är mer precist för en bestående versionskonflikt och undviker att den klassificeras som retrybar serialiseringsstörning. [PostgRESTs felkontrakt](https://docs.postgrest.org/en/stable/references/errors.html)

## Hypoteser och vad observationerna inte bevisar

- Många 40001 kan vara interna återförsök av ett enda HTTP-anrop. De kan också komma från flera klientanrop, manuell upprepning eller ett proxy-/SDK-lager. Skilj med korrelerade request-/databasmätningar och faktisk verktygs-/PostgREST-version, inte genom att räkna SQL-fel ensamt.
- En senare pg_stat_activity utan låsväntan utesluter inte tidigare väntan och fångar inte säkert korta återförsök mellan transaktioner. Att funktionen nått RAISE visar att just det försöket kommit förbi låsanropen, inte att hela HTTP-kedjan saknat fördröjning.
- statement_timeout 120000 från SQL Editor gäller den sessionens kontext. API-rollen/transaktionen kan ha andra inställningar. Många korta transaktioner kan dessutom var och en ligga under sin SQL-tidsgräns medan det överordnade HTTP-anropet väntar länge.
- lock_timeout 0 innebär ingen sådan låstidsgräns i den observerade sessionen. deadlock_timeout 1000 är startpunkt för deadlock-kontroll, inte en generell sekundgräns för lås eller RPC. Transaktionsbundna advisory-/radlås släpps vid transaktionens slut. [PostgreSQL om lås](https://www.postgresql.org/docs/17/explicit-locking.html), [timeout-inställningar](https://www.postgresql.org/docs/17/runtime-config-client.html)
- Klientens 30-sekundersgräns bevisar inte att serverns arbete upphörde. Höjd timeout, borttagna lås eller öppnare ACL är därför inget motiverat botemedel.
- Oförändrad A-post och avsaknad av B-kvitton stämmer med tidigt avslag. Det bevisar inte att retry-loopen saknas eller att alla andra säkerhetsscenarier är verifierade.

## DELETE med tidigare icke-null-payload

För B mot A med expected_revision 1 hittas ingen B-rad. Konflikten på rad 178 inträffar före delete_requires_null_payload. Därför kan även en felaktig icke-null-delete ha orsakat samma 40001-kedja. Den observationen är förenlig med ägarisolering, men testar inte payloadvalidering för ett giltigt delete-flöde.

Nya prover skiljer uttryckligen på korrekt cross-account delete med null (PT409), felaktig cross-account delete med objekt (fortfarande PT409), egen post/rätt revision/icke-null (22023) och giltig egen delete med null (ny revision och tombstone). Inget avslag får skapa kvitto eller historik.

## Migrationsförslag och risker

Ny fil använder CREATE OR REPLACE med samma signatur och body som grundmigrationen, med endast två errcode-byten. Ingen ny GRANT, policy, dataändring eller generell exception-handler tillkommer. Ett förhandsvillkor kräver postgres, rätt funktionsägare, definer/search_path och exakt godkänd ursprungsbody (SHA-256 med LF-normalisering). Drift eller en redan ändrad funktion ger 22023 och stopp i stället för tyst överskrivning. Då behövs ny granskning, inte borttagen guard. Även en tillfälligt återkallad EXECUTE-rätt bevaras.

Normal put/delete och lyckade idempotenta återförsök behåller svar och format. En framtida klient ska behandla kombinationen HTTP 409, PT409 och revision_conflict som ett avvisat ändringsförsök, bevara utkast/kö och begära avstämning. Den får inte byta expected_revision och automatiskt skriva över. Nätosäkra operationer kan återförsökas med samma operations-ID och identiska argument. Andra 409-koder, exempelvis 23505, ska inte förväxlas med denna konflikt. En motorframkallad 40001 har fortfarande sin ursprungliga betydelse.

Det är en avsiktlig ändring av fel-API:t. Testkort och tester uppdateras tillsammans. Det finns ingen appintegrerad molnsynk att migrera i denna kodbas, men externa verktyg eller framtida klienter som förväntar sig 40001 måste ändras. Ingen befintlig lagrad historik eller operationskvittopayload ändras. En begäran som redan tidigare lyckats ska fortfarande få sitt ursprungliga kvitto.

## Isolerad verifiering

```sh
npm ci --prefix tests
node --test tests/rpc-revision-migration.cjs
node --test tests/database-security.cjs
```

Lokalt finns ingen Docker/PostgreSQL-server. PGlite-proven kör den nya SQL-funktionen, ägaravslag, korrekt/felaktig DELETE, oförändrade data/versioner/kvitton, normala ändringar och idempotens. Testet för två anslutningar rapporteras uttryckligen SKIPPED i PGlite. Migrationsprovet jämför hela normaliserade bodyn och säkerhetsmetadata samt bevarad indragen EXECUTE. Enbart dessa prov kan inte bevisa PostgREST-beteende.

Workflow `rpc-retry-diagnosis.yml` startar en ny loopback-bunden PostgreSQL 17-service på en tillfällig Linux-runner. `tests/rpc-retry-local.cjs --isolated-ci` vägrar andra körkontexter/mål och kräver tomt startschema och nya roller. Två nya databaser används, med samma syntetiska A/B och samma PostgREST **14.5**. Den första får oförändrad grund, den andra grund plus förslaget. JWT signeras med slumpmässig lokal testnyckel enbart för PostgREST. Detta testar inte Supabase Auth eller något hostat projekt. Ingen nyckel eller rå begäran loggas.

Basprovet skickar exakt ett cross-account HTTP-anrop, använder 1200 ms klientgräns, mäter databasens rollback-delta och pausar sin egen CPU-begränsade gateway efter en kort observationsperiod. Ingen backend termineras, ingen databas/tabell tas bort och inga testdata rensas. Pausen är en resursgräns för den isolerade reproduktionen, inget förslag till hostad åtgärd. Den korrigerade databasen testas separat så ett pausat basprov inte kan blockera dess lås. Dess avslag måste få PT409/HTTP 409 inom 2000 ms med oförändrat fullständigt post-/versions-/kvittotillstånd. Därefter provas normala ändringar, parallell idempotens och samtidiga revisionsuppdateringar. Databaser och containrar lämnas kvar på den tillfälliga runnern, inte i projektägarens konto.

Den befintliga lokala Supabase-sviten körs med `--preserve` så att denna diagnoskörning inte använder dess gamla destruktiva cleanup. Också den är enbart en ny lokal teststack. De äldre preflight-fixturproven har inte gjorts till hostade prov. CI:s vanliga borttagning av sin tillfälliga maskin är plattformens livscykel, inte en rensningsrutin för användardata.

Faktiska CI-resultat redovisas i PR:n. Resultat får inte räknas som godkända innan körningen är klar. Ett uteblivet reproduktionsresultat eller fel i förberedelsen är inte bevis för att felet saknas.

### Faktiskt verifierat 19 november 2026

- [Jämförelse med PostgREST 14.5](https://github.com/Erngren/formresan/actions/runs/44535278359) passerade. En enda HTTP-begäran mot gamla funktionen nådde klientgränsen 1200 ms och gav fler än en databasrollback i observationsfönstret. Samma gatewayversion med två errcode-byten returnerade PT409/HTTP 409 före 2000 ms för revisions-/kontoavslagen. Egen felaktig DELETE gav 22023/HTTP 400. Fullständiga poster, versioner och kvitton var oförändrade efter samtliga avslag. Normala PUT/DELETE, parallell idempotens och samtidiga revisionsuppdateringar passerade.
- [PostgreSQL-regression](https://github.com/Erngren/formresan/actions/runs/44535278201) passerade alla nio tester inklusive överordnad grupp, utan överhoppade tvåanslutningsprov.
- [Riktig lokal Supabase-stack](https://github.com/Erngren/formresan/actions/runs/44535278166) passerade samtliga 13 Auth/REST-scenarier med det nya kontraktet. Tre spärrtester, fem preflight-fixturtester och ett migrations-/ACL-prov passerade i samma CI. Stacken kördes med preserve i stället för destruktiv cleanup.

Trösklarna ovan är de verifierade assertionerna, inte ett produktions-SLA eller en uppmätt hostad svarstid. Reproduktionen bekräftar **mekanismen i den isolerade versionen** och att kodvalet undanröjer just den loopen där. Den bevisar inte att ägarens hostade projekt kör samma version, saknar andra fördröjningar eller är redo för release.

## Före ett separat godkänt hostat prov

1. Granska diagnos, två errcode-byten, fullständig funktionsbody, guard och lokala resultat. Ingen hostad körning ingår i detta uppdrag.
2. Projektägaren behöver separat godkänna minimal läsande diagnostik för verklig PostgREST-version och korrelation mellan ett kontrollerat HTTP-anrop, databasförsök och klientens retry-/timeoutinställningar. Projekt-ID:n, tokens och råa loggar ska hållas privata. Observera att SQL Editors inställningar inte ersätter API-kontextens mätning.
3. Kontrollera privat att installerad body/ägare/search_path motsvarar migreringsförslaget och om RPC-EXECUTE redan har återkallats. Inget får återöppnas automatiskt.
4. Eventuellt redan pågående retry-arbete kräver en separat driftbedömning. Vi har inte kontrollerat eller terminerat något hostat backend, startat om projektet eller ändrat rättigheter. Att ändra en funktion bevisar inte att gamla in-flight-anrop upphör.
5. Först efter separat installations- och testgodkännande kan ägaren planera ett begränsat syntetiskt prov av PT409/HTTP 409, svarstid, antal HTTP-/SQL-försök, A/B-isolering samt oförändrade post-, versions- och kvittoantal. Bevara gamla operationer; ingen reset eller destruktiv rollback. Ett lyckat lokalt prov innebär inte releasegodkännande.
