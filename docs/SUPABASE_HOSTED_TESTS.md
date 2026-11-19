# Hostade Auth/REST-testkort – endast efter separat godkännande

Detta dokument är en manuell, granskningsbar testplan. Det kör inga anrop. Följ först grind A–C i [installationsprocessen](SUPABASE_HOSTED.md). Inget kort har körts mot projektägarens projekt i PR #20.

## Målspärr och privat testprotokoll

Operatören väljer i en betrodd **lokal** API-klient en enda sessionsbunden testmiljö med den exakt godkända HTTPS-origin som jämförts med Dashboard. Ingen fallback/default-origin, delad molncollection, team-synkning, export, proxy, shell history eller CI-körning används. Följ inte redirects. Före varje skrivkort ska den upplösta origin visas och jämföras igen med det privata godkännandet. Vid projektbyte, nytt API-certifikatproblem eller oväntad redirect stoppas arbetet. Ett namn, en publishable key eller avkodade JWT-claims är inte i sig bevis för rätt projekt.

Alla `{{...}}` nedan är **platshållare**, aldrig verkliga värden i Git. Mål, apikey, lösenord, tokens och kontonas UUID hålls i maskerade minnesvariabler. Klistra inte in dem i webbaserade JWT-verktyg. Uppgifter får inte sparas i collection, requestsammanställning eller publik rapport. Dokumentera resultat privat, inklusive syntetiska entity-/operation-/batch-ID:n, väntad revision och vilken begäran som hör till vilket ID. Logga inte Authorization, Auth-svar, lösenord eller återanvändbara tokens. Publik rapport använder endast kortnummer, godkänt/underkänt/ej kört, verktygsversion och datum.

Manuell målbekräftelse kan inte ge en maskinell garanti mot mänskligt fel. Om operatören inte kan verifiera origin och godkännande ska inga hostade skrivprov köras. Det är skälet till att ingen nätverkskapabel hostad runner levereras. En framtida sådan runner kräver en separat granskad, verifierbar miljöbindning.

## Gemensamt HTTP-format

Anropen nedan är relativa sökvägar mot den privat verifierade test-origin. Skicka `apikey: {{PUBLISHABLE_KEY}}` och `Content-Type: application/json`. Nyckeln ska vara `sb_publishable_...`, aldrig secret/service_role eller en användartoken som apikey. För inloggade anrop används `Authorization: Bearer {{A_ACCESS_TOKEN}}` respektive B. Vid anonymt prov utelämnas Authorization helt. Lägg aldrig publishable key i Bearer-fältet. Sätt `Prefer: return=representation` för att kunna kontrollera berörda rader.

Skapa nya slumpmässiga UUID lokalt för varje ny operation och molnpost. Återförsök använder samma UUID och exakt samma begäran. Testpayload för huvudpost är enbart

```json
{"id":101,"date":"2026-11-19","kind":"food","name":"Syntetiskt hostat säkerhetsprov","kcal":100,"protein":10}
```

Generiskt RPC-format, där payload ersätts med objektet ovan eller kortets angivna värde

```http
POST /rest/v1/rpc/apply_operation
```
```json
{
  "p_operation_id":"{{OPERATION_UUID}}",
  "p_collection":"main_entries",
  "p_entity_id":"{{ENTITY_UUID}}",
  "p_expected_revision":0,
  "p_payload":{"id":101,"date":"2026-11-19","kind":"food","name":"Syntetiskt hostat säkerhetsprov","kcal":100,"protein":10},
  "p_action":"put"
}
```

40001 är revisionskonflikt även om PostgREST mappar den till HTTP 500. 22023 är ogiltig operation/payload, 42501 är behörighetsfel. En 404, timeout eller generisk 500 är inte bevis på fungerande RLS. [PostgREST om felmappning](https://docs.postgrest.org/en/stable/references/errors.html)

## 1. Två riktiga syntetiska Auth-konton

Efter testgodkännande registreras A och B genom vanlig `POST /auth/v1/signup` med `{ "email":"{{TEST_EMAIL}}", "password":"{{TEST_PASSWORD}}" }`. Använd två av ägaren godkända testadresser, inga riktiga användarkonton. Lösenorden skapas lokalt och hålls privat. Inga admin-/secret-nycklar eller administrativ kontoskapning ingår. Hostad e-postbekräftelse kan krävas. Stäng inte av den eller ändra SMTP/Auth-inställningar utan separat beslut. Om testadresser inte kan bekräftas är kortet ej verifierat och fortsättningen stoppas.

Logga in separat via `POST /auth/v1/token?grant_type=password`. Kontrollera varje token via `GET /auth/v1/user`. A och B måste ha olika UUID och rätt testadress. Spara inga råa Auth-svar. Före dataskrivningar bekräftas privat att dessa är de enda kontona och att postflight fortfarande visar tomma Formresan-tabeller. Lösenordsflödet här är ett testverktyg, inte ett beslut om appens framtida inloggning.

## 2. Anonym åtkomst

GET `/rest/v1/{{TABLE}}?select=*` utan Bearer för var och en av de sju tabellerna och ett anonymt RPC-skapandeförsök ska avvisas med 42501 och HTTP 401/403. Ett tomt 200-svar räcker inte för detta grant-test. Om RPC skulle lyckas stoppas alla tester och den syntetiska posten lämnas för utredning.

## 3. Egna poster och rätt användaridentitet

A och B skapar varsin main_entries-post via RPC. Förväntad första revision är 1. GET `/rest/v1/main_entries?entity_id=eq.{{OWN_ENTITY_UUID}}&select=*` ska ge exakt en rad med user_id från respektive `/auth/v1/user`, rätt UUID och payload. Avkodad token ensam räcker inte för att verifiera serveridentitet.

Skapa via RPC även en settings-post per konto med collection user_settings och payload `{"protein":120,"cal":0}`, samt ett pass med collection training_sessions och payload `{"id":202,"date":"2026-11-19","plan":"warm","exercises":[{"id":"thoracic","done":true}]}`. Använd separata entity-/operations-ID:n och expected_revision 0. Historik och operationskvitton ska nu ha riktiga syntetiska ägarrader.

## 4. Migrationssentineler med separat tillstånd

För att inte påstå kontoavskiljning på tomma tabeller behövs en syntetisk batch och snapshot per konto. Endast efter uttryckligt tillstånd för denna fixturesetup får operatören skriva dem som postgres i det verifierade testprojektet. Det är setup, aldrig klientens behörighetsprov. Kontrollera först privat att rätt två Auth-ID:n valts. För varje konto används detta granskningsbara mönster, fyllt **privat** med nya UUID:n. Ingen originalexport används.

```sql
begin;
insert into public.migration_batches
  (user_id,batch_id,source_hashes,expected_count)
values ('{{AUTH_UUID}}'::uuid,'{{BATCH_UUID}}'::uuid,'{"synthetic":true}'::jsonb,0);
insert into public.migration_snapshots
  (user_id,batch_id,snapshot_id,main_raw,training_raw)
values ('{{AUTH_UUID}}'::uuid,'{{BATCH_UUID}}'::uuid,'{{SNAPSHOT_UUID}}'::uuid,
  '{"synthetic":true}','{"synthetic":true}');
commit;
```

Platshållarna är avsiktligt ogiltiga UUID:n tills operatören fyllt dem privat. Vid osäkert commitutfall ska dessa UUID:n läsas tillbaka, inte ersättas med nya och köras igen. Om fixturesetup inte godkänns anges kontoavskiljning för batcher/snapshots som **ej verifierad**, aldrig godkänd enbart på tomma SELECT-resultat.

## 5. Läsisolering i alla sju tabeller

För båda kontona ska egna sentinelrader kunna läsas i varje tabell. GET med explicit `user_id=eq.{{OTHER_AUTH_UUID}}` ska ge `[]`. B:s GET med A:s entity-ID ska också ge `[]`. Jämför med A:s lyckade ägarläsning. A/B får inte blandas ihop i API-klientens sessionsvariabler.

## 6. Nekade ändringar av den andra ägarens post

Som B, PATCH och DELETE `/rest/v1/main_entries?user_id=eq.{{A_AUTH_UUID}}&entity_id=eq.{{A_ENTITY_UUID}}` ska nekas med 42501/403. PATCH-body kan vara `{"payload":{"synthetic_attack":true}}`. Gör även RPC put respektive delete med A:s UUID och revision 1. Delete använder null-payload. De ska få 40001, eftersom B inte har denna post i sitt konto. Läs sedan som A och verifiera oförändrad payload, revision och historik. Avbryt vid avvikelse. Hårdradering är endast ett avgränsat **förväntat nekat** testförsök mot den registrerade syntetiska raden, aldrig ett rensningssteg.

## 7. Ägare, UUID, revision och manipulerad JSONB

Som A, försök PATCH på den egna syntetiska raden med var och en av user_id=B, entity_id=ett annat registrerat test-UUID och revision=999. Alla nekas med 42501/403. Direkt POST till main_entries med B:s ägare ska också nekas. Inga tabellgrants öppnas för att få anropen att fungera.

En separat ny RPC-post med extra payloadfält user_id=B, entity_id=ett annat UUID och revision=999 ska fortfarande få **kolumnernas** ägare A, begärt moln-UUID och revision 1. Extra fält är opaka data, ingen auktoritet. RPC med ID som text eller collection `main_entries; invalid` ska avvisas med 22023. Följ upp att inga sådana misslyckade operationer fått kvitton.

## 8. Fel revision och operationskvitton

RPC put mot A:s ursprungliga post med expected_revision 99 ska ge 40001. Läs kvitton med `operation_id=eq.{{FAILED_OPERATION_UUID}}` och verifiera noll rader. Läs post/historik igen. Skicka därefter den ursprungliga lyckade skapandebegäran exakt igen, med samma operations-ID. Svaret ska vara samma kvitto och historiken fortfarande innehålla en version. Samma operations-ID med ändrad kcal ska ge 22023 utan ändring.

## 9. Mjuk radering och återställning

RPC action delete med expected_revision 1 och null-payload ska ge revision 2 och deleted_at, bevarad payload och en ny historikrad. Vanlig put med revision 2 får inte återuppliva posten. Restore med revision 2 och ursprunglig payload ska ge revision 3, null deleted_at och historik 1/2/3 där raderingsmarkeringen finns på version 2. Använd nya operations-ID:n för delete/restore. Ingen hårdradering görs som återställning.

## 10. Historik och migrationsmetadata får inte manipuleras direkt

För record_versions, sync_operations, migration_batches och migration_snapshots testar A POST, PATCH och DELETE mot exakt de privat registrerade syntetiska identiteterna. Identifiera historik med collection/entity_id/revision, kvitto med operation_id, batch med batch_id och snapshot med snapshot_id, alltid även user_id=A. POST kan använda kopian av en egen syntetisk rad. Alla anrop måste få 42501/403. Läs samma rader före/efter och jämför. Prova även `/rest/v1/rpc/valid_payload`, som inte ska exponera den privata hjälpfunktionen. En 404 för just denna helper är väntad, men bevisar inte tabellernas behörigheter.

## 11. Ogiltig, manipulerad och riktigt utgången token

Med oförändrad publishable key testas en ogiltig Bearer-sträng och en kopia av ett riktigt testtoken där sub/role ändrats lokalt utan ny signatur. REST-läsning och RPC ska ge 401, `/auth/v1/user` ska neka med 401/403. Ingen signeringshemlighet används.

Spara dessutom ett riktigt utfärdat testtoken endast i minnet och låt det passera sin verkliga exp samt serverns tidsmarginal. Ändra inte exp för att imitera utgång. Förnya inte detta sparade token. REST-läsning och RPC med det ska därefter ge 401. Hostad livslängd kan vara mycket längre än den lokala CI:ns 60 sekunder. Ändra inte projektets JWT-inställningar utan godkännande. Om väntan inte genomförs rapporteras utgångstestet som ej kört. Andra kort ska köras med fortfarande giltiga kontosessioner.

## 12. Samtidiga uppdateringar och återförsök

Skapa en ny syntetisk post med revision 1. Förbered två RPC-put med olika operations-ID:n, samma entity-ID/expected_revision 1 och olika kcal 200/300. Skicka som A parallellt med den lokala API-klientens parallellfunktion. Exakt ett ska lyckas, ett ska ge 40001. Återläs revision 2 och exakt två versioner. Inga blinda omskrivningar görs. Om verktyget bara kör sekventiellt redovisas faktisk samtidighet som ej verifierad.

Skicka även två identiska skapandebegäranden parallellt med samma nya operations-ID och entity-ID. Båda ska returnera identiskt kvitto och exakt en post/version/kvitto. Vid nätfel behåll samma operation och kontrollera resultatet före nytt försök.

## Resultat och avslut

För varje kort anges godkänt, underkänt eller ej verifierat med orsak. Behörighetsfel, nätfel och tomma resultat ska hållas isär. Alla fel stoppar fortsatt skrivning tills orsaken granskats. Syntetiska poster och konton **lämnas kvar**. Ingen automatisk rensning, reset, kontoborttagning eller rollback utförs. Avsluta den lokala API-sessionen så att tokens och lösenord inte sparas till disk eller delad collection. Eventuell senare rensning kräver en egen ägargranskad plan med exakt avgränsade identiteter och utan påverkan på nya data.
