# Kontobunden lokal lagring – inaktiv förberedelse

20 november 2026, från main `2d0a4c2` efter PR #21. Projektägaren anger att befintliga lokala poster endast är testdata. De raderas, migreras eller laddas inte upp automatiskt. Inga Supabase-migrationer, SQL-tester eller öppna verifieringsärenden ändras.

## Vad som faktiskt används i appen

Huvudappen, smart mat och träningsvyn använder fortfarande det befintliga separata lokala läget via `FormresanStorage`. Nycklarna `formresan_v1` och `formresan_training_v14`, deras format, export/import, Web Lock och felhantering är oförändrade.

**Appen saknar Auth-klient och aktiverar inte kontolagringen.** Ingen användare påstås vara inloggad. Ingen Auth-session hämtas eller sparas av den nya koden vid vanlig sidstart. Ingen ny funktion eller kontovy införs. Gamla testposter kan fortfarande visas i det befintliga lokala läget. De presenteras inte som något nytt kontos data.

## Den förberedda gränsen

`FormresanStorage.createAccountStorage(auth)` kräver en betrodd Auth-klient med `getUser()` och `onAuthStateChange()`. Funktionen skapar en koordinator, ingen inloggning. Det finns inget API som väljer en användare genom UUID, e-post, URL-parameter, localStorage eller postMessage. Om Auth-klient saknas kastas fel.

En framtida integration måste ge den riktiga Supabase-klientens Auth-del, inte en egen adapter som hämtar ID ur getSession eller litar på en callback-session. `getUser()` verifierar användaren via Auth-servern enligt [Supabases dokumentation](https://supabase.com/docs/reference/javascript/auth-getuser). Denna PR testar endast kontraktet med uttryckligt syntetiska fixtures, inte autentisering mot en server.

`await coordinator.openAccount()` verifierar användaren och returnerar ett fryst objekt bundet till exakt detta UUID och koordinatorns aktuella generation. Objektet har readMain, readTraining, updateMain, updateTraining och exportRaw. Kontots UUID kommer bara från ett lyckat getUser-svar med error null. Saknad användare, ogiltigt UUID, felaktigt svar, anonym Auth-användare eller verifieringsfel ger avslag. ID normaliseras till gemener. Hela användar-/sessionssvaret lagras aldrig.

| Utrymme | Nyckel |
| --- | --- |
| Kontots huvuddata | `formresan_account_v1:<verifierat UUID>:main` |
| Kontots träning | `formresan_account_v1:<verifierat UUID>:training` |
| Gemensamt exklusivt lås för kontots båda delar | `formresan-account-data-v1:<verifierat UUID>` |

UUID är det stabila Auth-ID:t, inte ett molnpost-ID, en e-postadress eller ett token. Payload behåller nuvarande huvud-/träningsformat. Befintliga validatorer återanvänds direkt. Det finns ingen spegling till gamla nycklar och ingen automatisk import till kontot. Ett nytt konto börjar med tomma strukturer, som inte skrivs till lagringen förrän en faktisk giltig ändring görs.

## Kontobyte och asynkrona operationer

- Alla Auth-händelser ökar en generationsräknare omedelbart. Callbackens session används inte som verifierad identitet och inget async Auth-anrop görs inne i callbacken. Även tokenförnyelse ogiltigförklarar gamla objekt som en avsiktligt försiktig första policy.
- Ett lagringsobjekt följer aldrig automatiskt med från A till B. Det gamla objektet förblir ogiltigt även om kontot senare växlar tillbaka till A. Ett nytt objekt måste öppnas efter ny verifiering.
- Varje läsning, skrivning och råexport använder kontots gemensamma exklusiva Web Lock. Inne i låset verifieras Auth på nytt och måste matcha det bundna UUID:t och generationen. Saknade Web Locks stoppar kontots operationer. Det gamla lokala lägets separata exportregler ändras inte.
- Därefter sker läsning, synkron ändring, validering och setItem utan await. Generationskontroll görs igen före commit och innan resultatet returneras. Ett Auth-byte under kötid, verifiering eller mutator stoppar skrivningen. En async mutator avvisas och dess utkast skrivs inte.
- Om bytet sker **efter** en lyckad atomisk setItem kan ändringen redan vara sparad under A:s nyckel. Den flyttas aldrig till B och skrivs inte tillbaka för att försöka ångra den. Ett gammalt resultat på väg tillbaka avvisas. Senare UI-kod måste ändå hantera att en sådan operation har okänt sparbesked och bevara rätt kontos utkast.
- dispose ogiltigförklarar alla objekt och avslutar koordinatorns Auth-prenumeration. Inga nycklar eller data raderas vid utloggning, kontobyte eller dispose.

En tidigare observerad kontonyckel som försvinner får samma säkra avslag som i den gamla modulen. Trasig JSON, ogiltiga modeller och nekad/full lagring ersätts inte med tomma data. exportRaw kan returnera båda kontots råsträngar, även trasig JSON eller null, under samma lås. Formatet är `formresan-account-backup`, version 1, userId, exportedAt och rawData med main/training. Det finns ingen ny exportknapp, nedladdning eller import. Råexporten läser aldrig legacy-nycklar eller ett annat kontos namespace. Den gamla kompletta råexporten är fortfarande tillgänglig i det lokala läget.

## Varför full aktivering måste vänta

Det räcker inte att byta lagringsnyckel. Huvudappen håller db och formulärutkast i minnet, träningen håller state, setinmatning och historik, och smart mat har pågående beräkningar och sparcallbacks. De gamla API:erna är synkrona vid läsning medan kontogränsen är asynkron och kan avvisas. Att ändra allt detta utan riktig Auth skulle skapa falsk säkerhet och en större PR.

Innan aktivering behövs en separat granskad Auth-/vyintegration som

1. initierar en betrodd Supabase Auth-klient och inväntar dess livscykel, utan att själv deklarera ett inloggat UUID. Inga projektinställningar eller nycklar tillkommer här.
2. äger en gemensam koordinator och ett bundet kontoobjekt för huvudapp och iframe. Fristående träningsvy och flera flikar måste få samma auktoritativa Auth-livscykel. De två modulinstanser som dagens sidor laddar har inte automatiskt en gemensam kontokontext.
3. döljer/tömmer gamla vydata, guide-/historikdialoger, formulärutkast och smart mat-resultat vid utloggning, kontobyte eller ogiltig kontext. Det räcker inte att endast neka nya lagringsanrop. Redan returnerade JavaScript-objekt kan inte återkallas av denna modul.
4. binder varje UI-operation till det kontoobjekt som gällde när operationen började. Gamla callbacks får inte hämta B:s nya objekt och använda A:s gamla formulärdata. Sena svar ska ignoreras om vy-/kontogenerationen ändrats.
5. verifierar verkliga Auth-händelser, tokenförnyelse, kontobyte mellan flikar, Safari/hemskärm och direkt öppnad träning. De syntetiska testen bevisar inte SDK:ts faktiska händelseleverans eller att varje flik upptäcker ett mycket snabbt A–B–A-byte.
6. beslutar offlinepolicyn. Förberedelsen kräver lyckad getUser-verifiering för varje operation och nekar åtkomst vid nätfel. Den utlovar inget offline-kontoläge eller någon beständig molnkö. Nätanrop under låset kan fördröja andra operationer och behöver en separat testad timeout-/avbrottspolicy med den riktiga SDK-klienten.
7. skiljer ett eventuellt kvarvarande lokalt testläge och dess råexport tydligt från kontovyerna. Kontovyer får inte använda de gamla fallback-/import-/exportvägarna. Ingen automatisk koppling av gamla testdata till ett konto ska införas.
8. versionsmärker script-/iframeadresser och säkerställer omladdning av gamla flikar innan aktivering. Denna inaktiva förberedelse ändrar inga HTML-adresser.

Ingen del av den listan är påstått färdig. Ingen molnsynk, inloggningsvy eller hostad verifiering aktiveras i denna PR. Molnlagringens befintliga verifieringsärenden förblir öppna.

## Lokal säkerhetsgräns

Detta skyddar de förberedda API-flödena mot kontoförväxling, inte mot en angripare som redan kan köra JavaScript på samma origin, ändra Auth-klienten eller använda DevTools i samma webbläsarprofil. localStorage är inte ett krypterat fleranvändarsystem. Betrodda framtida callers måste använda rätt API. Den äldre modulens råmetoder är fortfarande nödvändiga för det lokala läget och är inte en ny autentiseringsgräns. Serverns RLS/ACL behövs fortfarande för framtida molndata.

## Faktiskt körda tester 20 november 2026

Chromium 390 × 844 med Playwright 1.65.1 kördes lokalt mot repo-filer och isolerad syntetisk lagring. Den nya sviten avbryter alla nätverksanrop som inte uppfylls med lokala appfiler. Auth är en fixture, inga konton eller serveranrop skapas.

- `tests/account-storage.cjs`: elva underprov, tolv godkända inklusive överordnad grupp. A/B-namespace för båda datatyperna, permanent ogiltiga gamla objekt, saknad/ogiltig/offline/anon Auth, utebliven Auth-händelse, fördröjd verifiering/öppning, låskö vid utloggning, byte inne i mutator och sena resultat efter commit.
- Samma svit verifierar synkrona mutatorer, validering, råexport av trasig/saknad lagring, skrivfel, saknade Web Locks, två flikars 30 samtidiga poster utan förlust/ID-kollision samt ett delat kontoobjekt mellan huvudfönster och riktig tränings-iframe. Den kontobundna vägen kopplas endast in av testet, inte av appens ordinarie kod.
- `tests/local-data-safety.cjs`: alla 17 befintliga underprov, 18 inklusive överordnad grupp, passerade. Det omfattar huvudappens mat/aktiviteter/mål/import/export, smart mat med syntetiska API-svar, gym/golf, lagringsfel, gamla format, flikar och iframe. Filen och SQL-testerna är oförändrade.
- Syntaxkontroll av storage.js och testfil samt git diff --check körs före leverans. Inga Supabase-migrationer eller hostade data har hanterats.

Kör med en separat installation av Playwright och Chromium som utvecklingsverktyg, utan appberoenden

```sh
node --test tests/account-storage.cjs tests/local-data-safety.cjs
```

`FORMRESAN_PLAYWRIGHT` kan ange den absoluta modulvägen och `PLAYWRIGHT_BROWSERS_PATH` en separat Chromium-katalog, enligt den befintliga regressionens upplägg. Workflow `account-storage.yml` installerar versionslåst Playwright i runnerns temporära katalog och kör båda sviterna. Ingen ny app-/SDK-dependency, hemlighet eller Supabase-konfiguration behövs. Faktiska CI-resultat redovisas separat i PR:n. Riktig Auth-integration, kontobundna produktionsvyer och test på fysisk iPhone återstår.
