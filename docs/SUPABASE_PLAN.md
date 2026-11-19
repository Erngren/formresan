# Formresan Cloud – lagringsanalys och Supabase-plan

Plan för granskning, daterad 19 november 2026. Kodbasen är `main` vid commit `e8bb6c75e0ef59ab31bc9f25417c4fb6f57c350c`.

Dokumentet föreslår kommande arbete. Kodfynd och lokala reproduktioner anges uttryckligen. Supabase-resurser, SQL-policyer och synkronisering är ännu inte implementerade eller testade mot en riktig databas. Projektägarens uppgift om förlorade testdata har ingen fastställd orsak.

## 1. Beslutsförslag

Börja med Supabase Auth via engångskod i e-post och PostgreSQL-tabeller för huvudappens poster, träningspass och inställningar. Bevara varje befintlig posts innehåll i en JSONB-kolumn och lägg ägarskap, moln-ID och revisionsnummer utanför den. Behåll lokala nycklar och historikformat genom en kompatibilitetsadapter.

En gemensam lagringsmodul ska hantera lokal skrivning, beständig kö, inloggat konto och molnsynk för både huvudapp och träningsvy. Varje ändring får ett operations-ID och kontrolleras mot en serverrevision. Konflikter ska kunna lösas utan att någon version försvinner.

Molnets återställningsbara historik, lokal cache och exporter kompletterar varandra. Automatisk synk får aktiveras för riktiga data först efter tester av kontoavskiljning, idempotens, migrering och återställning. Implementeringsetapperna i avsnitt 10 kräver separata granskningar.

## 2. Verifierad lagringskarta

Sökningen omfattade samtliga spårade filer och alla förekomster av `localStorage`, `sessionStorage`, IndexedDB, lagringshändelser och service worker. Appkodens localStorage-anrop finns på tre ställen.

| Fil och kod | Läsning | Skrivning och innehåll |
| --- | --- | --- |
| `index.html`, rad 45, initiering av `db` | `getItem('formresan_v1')`, JSON.parse vid sidstart | `save()` skriver hela `db` med setItem |
| `js/smart-food.js`, rad 158–168, bekräftad portion | Använder huvudappens redan laddade `db` och `KEY` | Skriver hela nästa huvudappsdokumentet direkt med setItem |
| `js/training.js`, rad 3, initiering av `state` | `getItem('formresan_training_v14')`, JSON.parse vid träningsvyns start | `persist()` skriver hela `state` med setItem |

Radnumren gäller den angivna bascommitten. Funktionerna är säkrare sökankare eftersom mycket kod ligger på samma rad.

Kodunderlaget finns i [huvudappen](https://github.com/Erngren/formresan/blob/e8bb6c75e0ef59ab31bc9f25417c4fb6f57c350c/index.html#L45), [träningslogiken](https://github.com/Erngren/formresan/blob/e8bb6c75e0ef59ab31bc9f25417c4fb6f57c350c/js/training.js#L3), [smart matregistrering](https://github.com/Erngren/formresan/blob/e8bb6c75e0ef59ab31bc9f25417c4fb6f57c350c/js/smart-food.js#L151) och [träningsvyn](https://github.com/Erngren/formresan/blob/e8bb6c75e0ef59ab31bc9f25417c4fb6f57c350c/training/index.html).

### Huvudappen

`formresan_v1` har grundformen `{goals: {protein, cal}, entries: [...]}`. Nya poster får `id: Date.now() + Math.random()` och ett lokalt kalenderdatum från datumväljaren. Befintliga typer är följande.

| `kind` | Innehåll utöver id och datum | Skrivande kod |
| --- | --- | --- |
| `food` | `name`, `kcal`, `protein` | Matdialog, Banan, Min taco, smart matregistrering |
| `work` | `type`, `notes`, `minutes`, `km`, `burn` | Huvudappens allmänna träningsdialog |
| `weight` | `kg` | Viktformuläret |
| `sleep` | `minutes`, `feel` | Sömnformuläret, som först tar bort befintliga sömnposter för vald dag |
| `creatine` | Registrerad bock för dagen | `setCreatine()`, som ersätter dagens kreatinpost eller tar bort den |

`add()`, `remove()`, `saveGoals()`, sömn- och kreatinregistrering ändrar `db` i minnet före `save()`. `remove()` kräver bekräftelse och filtrerar på post-ID. Mål ersätts som en grupp. Vid fel i setItem visas en alert, men `save()` fortsätter med `render()` och lämnar minnesändringen kvar. Flera formulär stängs ändå och målflödet visar därefter även ett sparmeddelande.

Smart matregistrering har ett annat skrivflöde. Den bygger `updated`, försöker skriva först och ändrar `db` samt stänger dialogen efter lyckad skrivning. Vid lagringsfel finns portionen kvar för nytt försök. Även detta flöde utgår från en ögonblicksbild i minnet och kan skriva över en annan fliks senare ändringar.

Familjeveckornas ankardatum, tidigare sömnsnitt, favoritberäkningar och övningsprogram ligger i koden. De är inte separata användarinställningar i localStorage i nuläget. Recept och redigerbara veckoscheman har ingen befintlig lagringsmodell att migrera.

### Träningsvyn

`formresan_training_v14` har formen `{sessions: [...]}`. Ett pass innehåller `id: Date.now()`, `date`, `plan` och `exercises`. Gymövningar innehåller `id` och `sets` med `kg` och `reps`. Golf-/rörlighetsövningar innehåller `id` och `done: true`. Planerna är `a`, `b`, `warm` och `mob`. Övnings-ID:n återanvänds när historik och tidigare vikter visas.

`saveSession()` validerar inmatning, lägger till passet i minnesarrayen och anropar `persist()`. Lyckad skrivning ger sparmeddelande och omrendering. Vid misslyckad skrivning returnerar persist false men passet ligger kvar i minnet. Det finns ingen registrerad träning-import och ingen UI-funktion för att redigera eller radera träningspass i den granskade koden.

### Samordning mellan vyerna

`index.html` bäddar in `training/index.html` från samma origin. I samma webbläsarprofil delar de localStorage-utrymme, men läser olika nycklar och har egna minnesobjekt. Det befintliga postMessage-flödet avser iframehöjd. Det överför inga användardata. Ingen lagringslyssnare uppdaterar en redan öppnad vy när en annan flik ändrar en nyckel.

Huvudappens `work` är en allmän aktivitetsregistrering. Ett detaljerat gympass i träningsvyn skapar ingen motsvarande `work`-post. Dessa två flöden ska kunna synkas utan att samma aktivitet automatiskt dubbelregistreras eller slås ihop.

Inga anrop till `localStorage.clear()` eller `removeItem()` hittades i appkoden. Ingen molnlagring, autentisering, IndexedDB-kö eller service worker finns i repot. Manifestet anger fristående visning men implementerar ingen offline-cache för appfiler.

### JSON-export och import

| Funktion | Verifierat beteende | Begränsning |
| --- | --- | --- |
| `exportData()` i huvudappen | Exporterar minnesobjektet `db` till `formresan-YYYY-MM-DD.json` | Innehåller inte `sessions` från träningsnyckeln. Efter sparfel kan minnet avvika från beständigt lagrad data |
| `importData()` i huvudappen | Läser JSON, kontrollerar goals/protein, entries-array och att varje post har strängarna kind/date. Efter bekräftelse ersätts `db` och hela nyckeln skrivs | Ingen sammanslagning eller automatisk säkerhetskopia före ersättning. Fullständig typvalidering saknas |
| `download()` i träningsvyn | Exporterar minnesobjektet `state` till `formresan-traning-YYYY-MM-DD.json` | Innehåller inte huvudappens mål/poster. Ingen motsvarande import finns |

Huvudappens import avvisar normalt den separata träningsfilen eftersom den saknar goals och entries. En tom huvudappsfil med giltig grundform accepteras och ersätter befintliga huvudappsposter efter bekräftelse. Den påverkar inte träningsnyckeln. Detta behöver framgå tydligare i en framtida gemensam säkerhetskopiering.

## 3. Fynd och möjlig förklaring till förlorade testdata

### Verifierat i isolerade Chromium-tester

Den 19 november 2026 kördes tester mot oförändrad kandidatkod i separata tillfälliga webbläsarkontexter, med syntetiska data vid 390 × 844. Ingen användares webbläsarlagring användes.

| Fall | Reproduktion och utfall | Bedömning |
| --- | --- | --- |
| Trasig JSON vid start | Lägg `{invalid` i huvudnyckeln och ladda om. Koden använder tom standarddata i minnet. Råsträngen ligger kvar tills nästa registrering, som skriver över den | Verifierad felhanteringsrisk. Ingen återställningsdialog eller bevarad felsnapshot |
| Misslyckad manuell matsparning | Låt setItem kasta QuotaExceededError. Dialogen stängs och nya posten finns i minnet men saknas i localStorage. Den försvinner efter omladdning | Verifierad inkonsekvens mellan visning och beständig lagring, trots att en felalert visas |
| Två huvudappsflikar | Öppna båda med samma data. Spara Banan i A och därefter en annan matpost i B. B:s hela dokument skriver bort A:s nya post | Verifierad förlust av en lyckat sparad ändring i ett flerskrivarfall |
| Träningssparning och nytt försök | Låt första persist misslyckas och andra lyckas. Samma formulär sparas igen. Två pass skrivs eftersom första passet redan lades i minnet | Verifierat dubbelregistreringsfel vid nytt försök |
| Exporternas omfattning | Ladda ned båda JSON-filerna | Huvudfilen innehåller entries/goals, träningsfilen sessions |
| Ersättande import | Importera en giltig tom huvudappsfil och bekräfta | Huvudposterna ersätts, träningsdata består |
| Ofullständig matpost i import | Importera goals/protein och en food-post med endast kind/date | Importen accepteras trots att bland annat id, kcal och protein saknas |
| Otillåtet uttryck i importerat ID | Importera en syntetisk post vars id innehåller ett harmlöst JavaScript-uttryck och klicka på dess raderingsknapp | Uttrycket körs. `entryHtml()` interpolerar id i en inline-onclick utan typkontroll |

Testerna avser felmekanismerna. De visar inte att någon av dem inträffade när projektägarens testdata försvann. Testskript och nedladdningar låg utanför repot.

Importfyndet innebär också en verifierad kodinjektionsmöjlighet från en manipulerad säkerhetskopia vid klick på en post. I testet sattes endast en flagga i den isolerade sidans minne. En framtida inloggad klient kan ha åtkomliga sessionstoken, vilket gör strikt validering och säker rendering av importerade och molnhämtade fält till ett villkor före Auth-piloten. Denna PR innehåller analysen av felet.

### Ytterligare kodrisker

- Båda läsflödena fångar JSON-/åtkomstfel och fortsätter med standarddata. Träningsvyn kontrollerar bara att sessions är en array. Huvudappen saknar startvalidering av ett sanningsvärdigt tolkat JSON-objekt. Ett felaktigt men syntaktiskt giltigt objekt kan därför ge renderingsfel. Ingen läsning ska i framtiden automatiskt auktorisera en tom ersättning i molnet.
- Huvudappens import validerar inte alla fält, numeriska värden, kalenderdatum eller unika ID:n. Dubbla ID:n kan göra att `remove(id)` raderar flera poster. Ett efterföljande renderingsfel kan uppstå efter att importen redan skrivits. Dessa följder har identifierats i koden men ingick inte i alla reproduktionstester ovan.
- En separat träningsflik kan ha samma problem med gamla minnesbilder som huvudappens flikar. Date.now-baserade tränings-ID:n ger också möjlig kollision mellan enheter. Ingen kollisionsfri molnidentitet finns ännu.
- Alla dokument skrivs i sin helhet. localStorage-skrivningen av en enskild nyckel ger ingen gemensam transaktion mellan nycklarna eller mellan data och en framtida synkkö.
- Datumväljaren och vyn kan göra att sparade poster inte syns där användaren väntar sig dem. Huvudappens Historik visar inte den detaljerade träningshistoriken. Detta kan uppfattas som förlust utan att nycklarnas innehåll ändrats.

### Miljörisker och sådant som är okänt

localStorage hör till origin och webbläsarmiljö. Annan enhet, profil eller privat surfning kan ha annan lagring. Enbart bytet från `/formresan/` till `/formresan/training/` på samma origin skapar inget nytt lagringsutrymme. Andra projekt på samma GitHub Pages-origin delar också lagringsnamnrymd. En bildadress med `?v=2` ändrar bildcachen och återställer inte registreringar. [MDN om localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)

WebKit beskriver lagringskvoter och möjlig eviktion av webbplatsdata. Sådana mekanismer är möjliga förklaringar tillsammans med rensad webbplatsdata eller ändrad webbläsarkontext. Det finns inget underlag här för att fastställa att Safari rensade just Formresans data, eller att en viss tidsgräns orsakade händelsen. Att flytta cachen till IndexedDB ger ingen garanti mot eviktion. [WebKit om lagringspolicy](https://webkit.org/blog/14403/updates-to-storage-policy/)

För incidentanalys behövs ungefärlig tid, iOS-version, exakt URL/origin, Safari eller hemskärmsapp, privat/vanlig profil, senaste lyckade export, eventuella sparfel och uppgift om vilka datatyper som försvann. Lokal rådata bör bara granskas med ägarens medverkan. Repo och GitHub Pages kan inte visa vad som fanns i en viss telefons localStorage.

## 4. Rekommenderad arkitektur

### Databasval

| Alternativ | Fördel | Konsekvens för Formresan |
| --- | --- | --- |
| Två hela användarägda JSON-dokument | Nära dagens nycklar och enkelt första test | Alla ändringar konkurrerar på samma dokument. Större konfliktyta, svårare återställning av en enda post och svagare relationer till recept/veckoschema |
| Helt normaliserad modell för varje fält och gymset | Tydliga datatyper och avancerade frågor | Större initial migration och fler kodändringar innan befintliga data kan bevaras |
| Separata tabeller per befintlig samling med JSONB per post | Ägarskap, revision och konflikt per post samtidigt som befintligt innehåll bevaras | Rekommenderad startmodell |

Använd `main_entries`, `training_sessions` och `user_settings`. Behåll kompletta gamla poster i payload och introducera molnmetadata utanför dem. Ett träningspass är en atomisk enhet med sin exercises-/sets-array i första versionen. PostgreSQL stöder JSONB, vilket gör att fält kan normaliseras senare efter separata beslut. [Supabase om JSONB](https://supabase.com/docs/guides/database/json)

För framtida recept och veckoscheman föreslås egna användarägda tabeller när kraven finns. Recept kan då få stabila ID:n och schemaposter hänvisa till dem med ägarsäkrade relationer. Historisk matlogg ska behålla sina sparade namn och näringsvärden även om ett recept senare ändras. Innehåll, fält och gränssnitt för dessa funktioner beslutas separat.

### Klient och vyer

En gemensam lagringsmodul ska bli enda skrivvägen för manuella poster, smart mat, mål, sömn, kreatin och detaljerade träningspass. En adapter läser/skriver befintliga format till nycklarna `formresan_v1` och `formresan_training_v14`. Ändringar i minnet publiceras efter beständig lokal lagring. Ett lokalt skrivfel ska behålla formuläret och erbjuda export eller nytt försök.

Föreslagen lokal bas är IndexedDB med en transaktion för ändrade poster, operationer och synkmetadata. De gamla localStorage-dokumenten speglar samma data för kompatibilitet. Eftersom de två lagringsteknikerna inte kan skrivas atomiskt måste en generationsmarkör upptäcka avbruten spegling och kunna bygga om spegeln från den bekräftade lokala transaktionen. Om speglingen misslyckas visas ett fel. De gamla direkt-skrivvägarna måste kopplas om före aktivering, inklusive `js/smart-food.js`.

Huvudfönstret äger normalt en Supabase-klient och synksamordnare. Iframen skickar versionsmärkta dataoperationer och får bekräftelser. Kontrollera `event.origin`, `event.source === trainingFrame.contentWindow` respektive `window.parent`, meddelandetyp och payload. Återanvänd säker origin-kontroll men håll höjdmeddelanden och datameddelanden åtskilda. Formulärutkast får inte tappas när fjärrdata anländer.

Direkt öppnad `training/index.html` ska använda samma modul med egen samordnare. Flera flikar använder lokal transaktionsordning och en verifierad låsmekanism med fallback. Molnets revisionskontroll och unika operations-ID:n måste ändå göra dubbla samordnare säkra. BroadcastChannel/storage-händelser meddelar andra vyer om ändringar och följs av återläsning. Ingen lösning får bygga på att bara en flik råkar vara öppen.

När en bekräftad lokal databas redan finns får oväntade skrivningar till kompatibilitetsnycklarna från gamla appflikar inte bli en ny fullständig molnimport. Bevara den avvikande råsträngen som återställningsunderlag, visa att en äldre flik behöver stängas/laddas om och erbjud jämförelse av eventuella tillägg. Testa denna situation före migreringspiloten.

### Enkel inloggning och iPhone

Rekommendationen är e-post med engångskod som skrivs i den appvy där inloggningen startade. Supabase stöder `signInWithOtp()` och `verifyOtp({email, token, type: 'email'})`. E-postmallen behöver visa token. Det minskar beroendet av att en e-postlänk öppnas i samma Safari-/hemskärmskontext. E-postadressens normalisering och inbjudan/nyregistrering beslutas i Auth-etappen. [Supabase om e-postkod](https://supabase.com/docs/guides/auth/auth-email-passwordless)

Använd en versionslåst officiell supabase-js-klient. Konfigurera beständig session och automatisk tokenförnyelse via SDK:t. Förnyelsen i webbläsare arbetar när vyn är i förgrunden. Vid återgång till appen kontrolleras sessionsläge, nätanslutning och fjärrdata. Om förnyelsen inte går igenom pausas uppladdning och användaren erbjuds återinloggning till samma konto. Kö och lokala data bevaras. [Supabase om klientinitiering](https://supabase.com/docs/reference/javascript/initializing), [automatisk förnyelse](https://supabase.com/docs/reference/javascript/auth-startautorefresh)

Raderad lokal session ska kunna återskapas genom inloggning och nedladdning av bekräftade molndata. Osynkade data som samtidigt försvunnit från enheten kan inte återskapas från molnet. Offline innebär lokalt sparande när appen redan kan köras. Kallstart utan nät efter rensad appcache är ett separat offlineappkrav och kräver senare beslut om service worker.

Stöd flera samtidiga enhetssessioner för samma konto. Testa Safari-flik, hemskärmsapp, byte till e-postapp, bakgrundsläge, omstart och utgången session på fysisk iPhone. Lova ingen bestämd sessionslivslängd utan att den faktiska Auth-konfigurationen är testad. [Supabase om sessioner](https://supabase.com/docs/guides/auth/sessions)

Vid eventuell framtida länkinloggning ska Site URL och tillåtna omdirigeringar peka på en verklig statisk sida under `https://erngren.github.io/formresan/`. Exakta produktionsadresser ska användas och PKCE-flödet testas mellan webbläsarkontexter. E-postkoder behöver ingen sådan länkcallback. E-postleverans till avsedda mottagare behöver verifieras med lämplig SMTP-konfiguration före pilot, eftersom Supabases standardtjänst har begränsningar. [Omdirigeringar](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## 5. Databasförslag och säkerhet

### Föreslagna tabeller

Alla användarägda rader har `user_id uuid not null`, som refererar till `auth.users(id)`, samt index som börjar med user_id. Automatisk kaskadradering vid kontoborttagning föreslås inte i första etappen. En framtida kontoradering behöver ett uttryckligt, granskat flöde för all data och historik.

| Tabell | Innehåll och identitet |
| --- | --- |
| `main_entries` | Primärnyckel `(user_id, entity_id uuid)`, gammal post i `payload jsonb`, `entry_kind`, `entry_date`, `revision bigint`, `schema_version`, serverns created_at/updated_at och nullable deleted_at |
| `training_sessions` | Samma metadata och primärnyckel, hela gamla sessionsposten i payload samt session_date |
| `user_settings` | Nyckel `(user_id, setting_key)`, payload och revision. Börja med gruppen goals |
| `record_versions` | Oföränderliga versioner med user_id, collection, entity_id/setting_key, revision, payload, deleted_at, operation_id och serverns tidsstämpel |
| `sync_operations` | Unikt `(user_id, operation_id uuid)`, hash av begäran och kvitto med serverrevision. Ger idempotenta nya försök |
| `migration_batches` | Ägare, batch-ID, källhashar, mappning från gamla poster till entity_id, räknare och status |
| `migration_snapshots` | Ägare, batch-ID och råa JSON-strängar för båda nycklarna, inklusive kända/okända fält, för återställning |

UUID gäller molnets identitet. Gamla numeriska id, övnings-ID:n, datum och historikformat ligger kvar i payload och kompatibilitetsexport. Tidsstämplar för synk sätts av servern i UTC. Dagsloggens lokala kalenderdatum ska inte flyttas genom tidszonskonvertering.

Servervalidering ska säkra att payload är ett objekt, att typ och datum motsvarar de separata kolumnerna och att obligatoriska fält är rimliga för respektive känd datatyp. Okända äldre fält bevaras. Ogiltiga äldre poster arkiveras i migrationssnapshot för granskning. Inga poster får falla bort tyst. Föreslå en rimlig storleksgräns efter mätning av riktiga exporter.

För sömn och kreatin finns en post per dag i dagens arbetsflöde. Ett partiellt unikt index på `(user_id, entry_kind, entry_date)` för aktiva poster av dessa typer ska hindra att parallella registreringar skapar två aktuella värden. Gamla dubbletter ska presenteras vid migrering före detta krav aktiveras. Mat och aktiviteter tillåter flera poster per dag.

### Nycklar och klientgräns

Klienten får endast innehålla projekt-URL och Supabase publishable key. En inloggad användares access token följer databasförfrågningar. Behörighet avgörs av JWT, databasrättigheter och RLS. Secret key och service-role-nyckel ska aldrig finnas i klient, Git, byggartefakter, exporter eller testloggar. Publishable key är publik och ger ingen ersättning för RLS. [Supabase om API-nycklar](https://supabase.com/docs/guides/getting-started/api-keys)

Appens användardata kan innehålla kost, vikt, sömn, fritext och familjeuppgifter. Föreslå EU-region och besluta åtkomst, lagringstid, driftansvar och backuphantering före produktionsdata. Visa användartext med befintlig HTML-escaping eller textContent. RLS skyddar inte mot skadlig kod som redan körs i en inloggad klients origin. Versionslås beroenden och undvik att logga payload, e-postkoder eller sessionstoken.

Validera gamla ID:n som data och knyt händelser med säkra eventlyssnare i den framtida adaptern. Granska även kcal/protein och andra importerade värden som idag interpoleras i HTML. Alla GitHub Pages-projekt under `erngren.github.io` har samma origin och tillhör samma klientmässiga tillitsgräns. Kontrollera därför övrig kod på denna origin inför Auth-piloten. En egen origin för Formresan kan bedömas separat om de andra projekten inte ska dela den tilliten.

### Konkreta RLS-policyer att granska

Följande SQL är en policyskiss för framtida migrationer, förutsatt att tabellerna ovan finns. Den har inte körts. Aktuella datatabeller tillåter ägarens läsning, infogning och uppdatering. Radering representeras som en uppdaterad deleted_at. Ägarskap måste kontrolleras på både befintlig och ny rad. Utan inloggning är auth.uid() null. [Supabase om RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

```sql
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'main_entries', 'training_sessions', 'user_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
    execute format(
      'create policy owner_select on public.%I for select to authenticated
       using ((select auth.uid()) is not null and (select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy owner_insert on public.%I for insert to authenticated
       with check ((select auth.uid()) is not null and (select auth.uid()) = user_id)',
      table_name
    );
    execute format(
      'create policy owner_update on public.%I for update to authenticated
       using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
       with check ((select auth.uid()) is not null and (select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end $$;
```

`record_versions`, `sync_operations`, `migration_batches` och `migration_snapshots` behöver samma ägarvillkor för SELECT och ingen direkt INSERT/UPDATE/DELETE-rätt för klienten. Infogning där sker via granskade databasfunktioner/triggers. RLS aktiveras även på dessa tabeller. Alla nya tabeller ska omfattas av motsvarande säkerhet innan de exponeras. Undvik vyer som oavsiktligt kringgår RLS.

Föreslagen skrivfunktion `apply_operation` kör som SECURITY INVOKER för uppdatering av datatabellerna och kontrollerar förväntad revision. En servertrigger kräver revision 1 vid insert och exakt föregående revision + 1 vid update, förbjuder byte av ägare/identitet och sätter serverns tidsstämplar. Det gör även direktanrop till tabellernas API revisionsstyrda. Skrivning och versionsarkiv måste ske i samma transaktion.

De begränsade interna hjälpfunktioner som skriver kvitton, migrationsstatus och versionsarkiv kan behöva SECURITY DEFINER. De ska härleda user_id från auth.uid(), kontrollera alla berörda raders ägare, ha tom search_path, fullständiga schemanamn och återkallad standardrätt att exekvera. Endast avsedda anrop får delegeras. En funktion med utökade rättigheter får inte anta att RLS automatiskt begränsar dess dataåtkomst. Exakta grants, triggers och funktioner granskas tillsammans i databas-PR:n. [Supabase om databasfunktioner](https://supabase.com/docs/guides/database/functions)

## 6. Synkprotokoll och konflikter

1. En lokal handling bildar en operation med UUID, konto-ID, collection, entity_id, base_revision, ny payload eller raderingsmarkering samt begäranshash. Spara data och operation atomiskt lokalt innan UI visar lokalt sparat.
2. Hämta aktuell session och verifiera att den tillhör operationens konto. En kö från konto A får aldrig skickas med konto B:s session.
3. Servern låser operationens identitet och berörda rader, validerar innehåll/ägare och jämför base_revision med aktuell revision. En ny rad förutsätter att ID:t ännu saknas. Avvikelse ger konflikt utan ersättning av data.
4. En lyckad transaktion skriver ny revision, versionshistorik och operationskvitto tillsammans. Ett identiskt operation_id med samma hash returnerar samma kvitto. Samma ID med annat innehåll avvisas. Detta ska även hålla för samtidiga nya försök och tappat svar efter commit.
5. Klienten markerar operationen som kvitterad först när serverns kvitto mottagits och sparats lokalt. Nätfel ger återförsök med fördröjning och jitter. Behörighetsfel, ogiltiga data och konflikt kräver annan hantering än nätavbrott.
6. Dra in serverändringar och bygg lokal bekräftad bas. Lägg kvarvarande lokala operationer ovanpå basen. Skriv ingen fjärrsnapshot direkt över osynkade data eller öppna formulär.

Revision jämförs per post eller inställningsgrupp. En enhets klocka avgör inte vinnare. Olika matposter eller olika pass kan läggas till oberoende. Samtidig ändring av samma pass, goals eller dagsvärde ska visa båda versionerna och låta användaren välja eller spara separata poster där datatypen tillåter det. Redigera/radera-konflikter ska bevara både innehållet och raderingsavsikten för beslut. Import efter molnaktivering blir en förhandsgranskad batch med samma konflikthantering, aldrig en tyst ersättning av kontots alla data.

Bekräftad radering sätter deleted_at och skapar en ny version. En offlineenhet får inte återskapa posten genom en gammal upsert. Återställning utgår från vald historisk version men skapar en ny aktuell revision med nytt operations-ID.

Realtime kan signalera att serverdata ändrats, men signalerna är inte synkkvittot eller en återspelningsbar kö. Läs serverdata vid start, återgång till förgrund, återanslutning och efter egen skrivning. Föreslå även en reservkontroll var 30:e sekund medan appen är synlig. Börja med en komplett ägarfiltrerad snapshot av aktuella rader inklusive tombstones, hämtad konsistent av serverfunktion. För större datamängder behövs sidindelning av en stabil snapshot, så att standardgränser i API:t inte tappar poster eller samtidiga commits. Ett senare inkrementellt protokoll måste definiera commit-säker återläsning innan det ersätter detta. [Supabase om Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)

### Synkstatus

| Status i UI | Villkor |
| --- | --- |
| Sparat lokalt | Lokal transaktion klar, operation väntar på kvitto |
| Synkroniserar | En eller flera operationer behandlas eller serverdata hämtas |
| Sparat i molnet | Samtliga aktuella operationer kvitterade och inga kända konflikter. Visa senaste bekräftade tid |
| Offline | Nätkontakt saknas. Visa antal lokalt sparade ändringar som väntar |
| Fel | Lokal skrivning misslyckad, databasfel eller avvisad operation. Visa begriplig åtgärd och behåll data |
| Inloggning krävs / konflikt | Separat orsak med återinloggning respektive versionsval |

`navigator.onLine` kan hjälpa presentationen men verkliga anrop avgör om tjänsten nås. Visa aldrig molnsparat enbart för att en webbförfrågan startats. När iOS pausar appen kan synken fortsätta vid nästa öppning, så omedelbar bakgrundssynk mellan stängda appar utlovas inte.

## 7. Säker migrering och kontoavskiljning

1. Läs båda befintliga nycklarna med separata resultat för saknad, giltig, oläsbar och åtkomst nekad. Bevara exakta råsträngar. Erbjud nedladdad gemensam säkerhetskopia med båda nycklarna och versionsmanifest. Befintliga exportformat ska fortsatt kunna läsas och erbjudas separat.
2. Visa antal poster/pass, datumintervall, mål, valideringsproblem och vilket konto de ska kopplas till. Begär uttryckligt beslut för kopplingen av lokala data till det inloggade kontot. Att logga in innebär inte att en hel lokal datamängd automatiskt laddas upp.
3. Läs kontots molndata före beslut om sammanslagning. Nätfel, RLS-fel och utgången session får aldrig tolkas som tomt konto. Även ett lyckat tomt SELECT-svar kan bero på RLS-filtrering. En autentiserad bootstrap-funktion ska därför kontrollera ägaren och returnera kontots serverlagrade migrations-/initieringsstatus. Ett tomt posturval får aldrig ensamt auktorisera initiering eller ersättning. En ny/tom enhet ska hämta befintliga molndata före lokal initiering.
4. Skapa en migrationsbatch med källhashar och beständig mappning mellan varje äldre post och ett nytt UUID. Bevara gamla id-värden och all rådata. Likadana filer som importeras igen känns igen via batch/källhash. Kolliderande gamla ID:n med olika innehåll, och överlappande data från två enheter, kräver granskning. Slå inte automatiskt ihop identiska måltider som kan vara två riktiga registreringar.
5. Arkivera båda råsträngarna som användarägd migrationssnapshot och överför validerade poster med idempotenta operationer. Batchen kan gå i delar men får markeras klar först när alla poster är kvitterade eller explicit avskilda för beslut. Avbruten migrering återupptas från serverkvitton.
6. Läs tillbaka data och jämför innehåll, antal, datumintervall och payload-hashar med den planerade mängden. Kontrollera att existerande molnposter och framtida okända fält bevarats. Dokumentera avvikelser för användaren.
7. Behåll råsnapshot, nedladdad export och de befintliga nycklarna. Aktivera sedan kontots cache och normal synk. Lagringsadaptern återskapar samma grundformat till de gamla nycklarna. Återställning till tidigare appversion behöver en egen testad procedur eftersom den gamla koden annars kan skriva från en gammal minnesbild.

Molnmetadata, köer och cache ska avskiljas per konto i den nya lokala lagringsmodellen. En separat ägarmarkör visar vilket konto de två gamla kompatibilitetsnycklarna just nu speglar. Nycklarna ska inte byta namn. Vid utloggning pausas köerna, minnesvyer stängs och privat data döljs. Vid byte från A till B arkiveras först A:s lokala cache/kö i kontots egen lagring, varefter B:s data får speglas. Saknas möjlighet att bevara A:s osynkade data ska kontobytet stoppas med exportmöjlighet. Gamla lokala data utan ägarmarkör behandlas som ännu omigrerade, inte som B:s data.

Ett separat rent lokalt läge kan behållas, men gränsen mot kontodata måste vara tydlig. Detaljer om gemensam enhet och lokal datasekretess ska beslutas innan flerkontostöd släpps. RLS skyddar servern och kan inte isolera två personer som delar samma upplåsta webbläsarprofil.

## 8. Återställning och backup

Behåll postversioner, tombstones, operationskvitton och migrationssnapshots under en föreslagen första återställningsperiod på 90 dagar. Den perioden och därefter eventuell gallring kräver projektägarens beslut. Gallra inte ännu okvitterade operationer. En klient som varit offline längre än serverns bevarade kvittohistorik måste först göra en säker avstämning innan gamla operationer skickas igen.

Användarens återställningsvy ska kunna hitta en raderad post, jämföra versioner och återställa genom en ny revision. Större import/återställning ska ha förhandsvisning och snapshot av läget före ändringen. Behåll en komplett exporterbar kontokopia med både huvuddata och träningshistorik även efter molninförandet.

Databasbackup är ett separat skydd vid driftproblem. Kontrollera vald Supabase-plan, retention och återläsningskostnad före produktionsstart. Supabase beskriver dagliga säkerhetskopior för betalda planer och PITR som ett ytterligare alternativ. En hel databasåterställning ersätter ett större tillstånd och ska därför övas isolerat före eventuell produktionsåtgärd. Projektets egen versionshistorik behövs för vardaglig återställning av en användares poster. [Supabase om backup och PITR](https://supabase.com/docs/guides/platform/backups)

## 9. Konkreta acceptanstester för kommande etapper

Tester nedan är planerade. Endast lagringsreproduktionerna i avsnitt 3 har körts i denna etapp.

| Område | Test och godkänt resultat |
| --- | --- |
| Befintliga format | Alla kind-typer, båda gympass, båda golfrutiner, gamla id och okända fält kan läsas, migreras och exporteras med bevarat innehåll |
| Lokal lagring | Trasig JSON, nekad läsning, full kvot och fel i IndexedDB/localStorage ger bevarad rådata, tydligt fel och ingen tom molnöverskrivning |
| Säker import/rendering | Manipulerade ID:n och text-/näringsfält får inte skapa körbar HTML eller JavaScript. Äldre giltiga poster ska fortsatt kunna läsas |
| Sparbesked | Ingen lyckad lokal/molsparning visas före respektive beständigt kvitto. Nytt försök efter fel skapar ingen dubblett |
| Två flikar och iframe | Parallella tillägg från huvudapp, smart mat, iframe och direkt träningsvy bevaras. Falska postMessage-källor avvisas |
| Två enheter | Mat på iPhone och gympass på datorn visas på båda efter synk. Nyinstallation/rensad testprofil återfår båda datamängderna efter inloggning |
| Offline | Gör ändringar, stäng och öppna igen med tillgängliga appfiler, återanslut och kontrollera att varje ändring överförs exakt en gång |
| Kvitton | Avbryt nätet efter servercommit men före svar. Skicka samma operation igen, även samtidigt från två klienter. En ändring och samma kvitto ska återkomma |
| Konflikter | Redigera samma post/goals offline på två enheter. Ingen tyst vinnare. Testa även radera/redigera samt två nya sömn-/kreatinvärden samma dag |
| Tidszon | Olika tidszoner och fel enhetsklocka ändrar inte registrerat kalenderdatum eller konflikters revisionsordning |
| Migrering | Tom enhet med fullt molnkonto, båda fyllda, gammal huvudexport, träningsexport, upprepad fil, överlappande ID:n, ogiltiga poster och avbrott mellan batchdelar bevarar alla källor |
| Stor datamängd | Fler poster än API:ts sidgräns och samtidiga ändringar under läsning ger fullständig konsistent återläsning |
| Session | E-postkod, fel/utgången kod, utgången token, pausad app, återstart och återinloggning till samma konto fungerar utan förlorad kö |
| Kontobyte | A har osynkad data, loggar ut och B loggar in. B ser/skriver bara B:s moln och cache. A:s kö ligger kvar för A |
| Återställning | Radera testpost, återställ tidigare version, låt gammal offlineenhet återansluta och verifiera att korrekt revision består |
| Mobil | Chromium 390 × 844 samt fysisk iPhone i Safari och hemskärmsläge, inklusive e-postappbyte, rullning och synkstatus |

### Säkerhetsprov med två konton

Använd två testkonton A/B och varsin access token samt den publika publishable-nyckeln. Lägg olika sentinelposter i samtliga tabeller. Kör tester genom REST/RPC och Realtime, inte bara genom gränssnittets filtrering. Kör ingen sådan verifiering med service-role som testklient.

1. A läser egna rader och får inga B-rader, även med explicit B:s user_id eller kända entity_id. Gör om testet för versioner, snapshots, kvitton och migrationsstatus.
2. A försöker skapa en rad med B som ägare, ändra B:s payload, flytta en egen rad till B samt återställa B:s version. Operationerna ska avvisas eller påverka noll rader enligt API:t. Kontrollera som B att innehåll, revisionsnummer och antal faktiskt är oförändrade.
3. A försöker hårdradera och ändra/radera historik eller kvitton. Direkt API och publika RPC:er ska sakna den möjligheten. Prova även obehöriga anrop till interna hjälpfunktioner och ändrad collection/UUID i batchoperationer.
4. Utloggad klient med endast publishable key och klient med utgången/förfalskad token kan inte läsa eller skriva privata rader. Fel vid SELECT får inte förväxlas med ett godkänt tomt kontosvar.
5. Testa prenumeration som A med filter för B. A ska aldrig få B:s data. Gör efterkontroll vid utloggning och kontobyte.
6. Granska databasschema, grants, RLS, vyer, funktionernas ägare/search_path och standardrättigheter. Kör regressionsproven vid varje schemamigration, särskilt när recept eller veckoschema införs.

## 10. Små PR-etapper och godkännanden

| Etapp | Innehåll | Krav för godkännande |
| --- | --- | --- |
| 1. Denna plan | Lagringsanalys, reproducerade risker, modell och testplan | Projektägaren godkänner arkitektur och vägval |
| 2. Lokal datasäkerhet | Gemensam lagringsadapter, skrivfel, säker import/rendering och komplett backup/återläsning. Behåll format och nycklar | Reproducerade fel får regressionstester. Alla befintliga sparvägar, inklusive smart mat, ska gå via adaptern |
| 3. Databas och säkerhet | Granskade migrationer för föreslagna tabeller, RLS, revisioner, transaktionsfunktioner, idempotens och återställning i separat testmiljö | Konto A/B-prov, parallella skrivningar, tappat kvitto och återställning passerar. Resursskapande kräver då ett eget godkänt uppdrag |
| 4. Inloggning | Engångskod, session, status och kontoavskiljning, med synkning av riktiga data avstängd | Chromium och fysisk iPhone. Inloggning i sig ändrar inte befintliga användarposter |
| 5. Första molnsparningen | Endast uttryckligt syntetiska testdata, separat testläge och full återläsning | Två enheter, säkerhet, kö, offline, konflikt och återställning. Ingen implicit import av verkliga lokala nycklar |
| 6. Migreringsförhandsvisning | Läs båda källorna, export/snapshot, jämförelse, UUID-mappning och valideringsrapport | Alla migrationsfall och avbrott testas med kopior. Ägaren granskar en konkret importplan |
| 7. Kontrollerad migrering och synk | Opt-in för verkliga data, kvitterade batcher, automatisk återläsning och konflikthantering | Innehåll och antal stämmer efter återläsning. Ny enhet kan återfå allt. Tidigare snapshot finns kvar |
| 8. Drift- och återställningsprov | iPhone/dator, längre offline, tokenförnyelse, backup, rollback och återställning | Projektägaren godkänner funktion och driftrutin före bred användning |

Den lokala säkerhetsetappen ligger före molnpilot eftersom dagens separata skrivflöden annars riskerar att förlora eller dubblera ändringar redan före uppladdningen. SQL-filer, SDK-integration och resurser tillkommer först i senare godkända uppdrag.

## 11. Beslut som återstår

- Godkänna tabeller med JSONB per post och e-postkod som första inloggningssätt.
- Fastställa Supabase-region, driftansvar, SMTP, kostnadsram och återställningsperiod. Bedöma krav för behandling av personliga hälso- och familjeuppgifter.
- Besluta om appen är för en enda ägare eller även ska stödja flera konton på delad enhet. Fastställa vad som syns offline efter utloggning.
- Bestämma pilotens backup- och återställningsrutin samt hur gamla appflikar/versioner spärras från att skriva föråldrade ögonblicksbilder under övergången.
- Granska verkliga exporter först när ägaren väljer att lämna dem för migrering. Inga riktiga data har inventerats i denna etapp.
- Specificera framtida recept och redigerbara veckoscheman innan deras datamodell byggs.

`PROJECT_STATUS.md` har lästs som projektbakgrund men innehåller fortfarande äldre uppgifter om gymbilder och Dead bug-varningen. Den granskade koden är underlag för lagringsanalysen. Denna dokumentations-PR lägger endast till planen.
