# Säker kontoväxling mellan flikar – steg 5

Utgångspunkt: main `93bfd67`, inklusive PR #26. Auth är fortsatt avstängd. SDK-versionen är oförändrad: **2.119.2**, med samma SHA-384. Ingen hostad miljö, publicering, migration eller kontodata-synk ingår.

## Bekräftad grundorsak

Det befintliga provet från PR #26 reproducerade felet före ändringen: B hade en giltig syntetisk SDK-session; en senare levererad SIGNED_OUT-notifiering låste ändå B och skrev en ny global logout-markör.

I det officiella installerade paketet `@supabase/auth-js` 2.119.2 visar `dist/main/GoTrueClient.js` följande:

- SDK:ts BroadcastChannel använder dess storageKey. `_notifyAllSubscribers` sänder `{event, session}`. Mottagaren anropar prenumeranter med broadcast=false för att undvika rundgång.
- Meddelandet innehåller inte Formresans avsikt eller generation. SIGNED_OUT har normalt session=null; det går inte att härleda vilket tidigare inloggningsförsök det hör till.
- `signInWithPassword` sparar session och notifierar innan dess promise returnerar. Lokal `_signOut` tar bort SDK-sessionen och notifierar innan serverns återkallelseanrop slutförts. Notifieringar kan därför levereras efter att ett annat appflöde redan gått vidare.

Felet i appen var att callbacken i `attachAuth` behandlade varje SIGNED_OUT som ett nytt användarkommando och anropade `publish('logout')`. En äldre notifiering kunde därmed ersätta den nyare lock/verify-avsikten. Även ett gammalt inloggningsförsöks catch anropade global cancel och kunde förstöra ett senare försök. Det var inte ett verifierat fel i Supabases server.

Källor för kontraktet: [Auth-händelser](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [serververifiering med getUser](https://supabase.com/docs/reference/javascript/auth-getuser) och [lokal utloggning](https://supabase.com/docs/reference/javascript/auth-signout). SDK-koden granskades i den exakt versionslåsta npm-installationen, inte genom antaganden om senaste master.

## Ny regel: kommandon och notifieringar har olika befogenheter

| Händelse | Tillåten effekt |
| --- | --- |
| Användaren loggar in, loggar ut, avbryter eller begär verifiering | Appens kontokommando får skriva ny global nonce/avsikt. |
| En ny flik ansluter till befintlig verify-avsikt | Följer den befintliga noncen och verifierar lokalt; skriver inte om den. Första initialiseringen utan markör behåller tidigare initialiseringsflöde. |
| SDK SIGNED_OUT, SIGNED_IN eller TOKEN_REFRESHED | Ledtråd: lås lokalt, ogiltigförklara tidigare handtag och kontrollera aktuell Auth. Ingen global markör skrivs från notifieringen. |
| Rå SDK-notifiering under ett redan låst lösenordsanrop | Ingen identitet kan användas där. Slutförandet måste kontrollera samma avsikt och därefter getUser; en verklig ny logout/lock-markör avbryter fortfarande försöket. |
| Ett sent asynkront fel | Kan avvisa aktuell lokal operation, men får aldrig skriva en global cancel/logout över nyare avsikt. |

`SIGNED_OUT` ignoreras alltså inte. Klienten försöker inte tidsstämpla eller gissa vilket historiskt konto notifieringen tillhör. Den rekonstruerar tillåtet **aktuellt** tillstånd med senaste appavsikt och verifierad Auth. Råa notifieringar skickas också som identitetsfria `auth-hint` till övriga appflikar; mottagare återutsänder dem inte. Ingen e-post, UUID eller token skickas i appens kanal.

## Verifierbar säkerhetsgräns

1. En notifiering i inloggat läge invaliderar den lokala generationen, tömmer kontoobjektet och låser/rensar vyerna **före** Auth-anrop. Gamla handtag blir permanent ogiltiga även om samma konto sedan återverifieras.
2. Om aktuell global avsikt är logout eller lock finns ingen automatisk upplåsning från SDK-händelser. En verklig app-utloggning publicerar denna spärr före sitt SDK-/nätverksarbete. Äldre getUser-svar kan inte passera markör-/generationskontrollen.
3. När avsikten tillåter verifiering måste officiell SDK getUser och lagringsfabrikens getUser ge samma giltiga UUID. Saknad session ger utloggat, fel/anon/identitetsbyte ger låst fel. Ingen getSession/callback-session används som identitetsbevis.
4. En ensam verifieringsuppgift per generation/markör samlar samtidiga notifieringar. Om en ny notifiering kom under verifieringen kasseras kandidaten och samma aktuella kontext prövas igen, högst tre varv per uppgift. Ett faktiskt UUID-byte mellan kontrollerna avvisas; instabil kontext lämnas låst. Detta är inte en total rate limit mot ett skript som fortsätter skicka händelser.
5. Kontrollern ger lagringsfabriken en betrodd wrapper: getUser går direkt till SDK:n; generationsnotifieringar kommer från kontrollerns invalidate. Därmed undviks dubbla, osamordnade invalidationer mitt i verifieringen. `assertContext` kontrollerar fortfarande lokal generation och faktisk markör. Själva `js/storage.js`, dess validering, Web Locks, bundna UUID och verifiering per operation är oförändrade.
6. Lösenordsoperationens slutförande kontrolleras även efter den asynkrona verifieringen. En stale operation får varken returnera nyare kontos resultat som sin framgång eller skriva global avsikt från catch. Den lokala reject-metoden gör ingen global skrivning, vilket undviker compare/write-race mellan flikar.
7. SDK-inloggning/utloggning ligger kvar bakom befintligt gemensamt Web Lock. Om A blir gammal medan B väntar försöker A:s cleanup logga ut sin session **innan B kan starta sitt SDK-anrop**. Ett gammalt svar kan därför inte rensa B:s senare session. Äldre asynkrona bootstrap-/utloggningsfel låser endast lokalt.

Alla kontovyer är fortfarande avstängda (`accountViewsEnabled=false`). Denna PR öppnar inga privata eller gamla lokala vyer. Skriptversionerna för ändrad kontokod och iframe-HTML uppdateras så framtida kontroller inte avsiktligt återanvänder tidigare versioners skript.

## Hur verklig utloggning skiljs från en gammal ledtråd

En app-utloggning har en ny explicit logout/lock-avsikt: spärren gäller även om ett gammalt access-token fortfarande skulle accepteras av Auth-servern. Den får bara ersättas av ett senare uttryckligt kontokommando.

En SDK-utloggning utan appkommando hanteras genom aktuell session/serververifiering. I provet med nekad refresh tar den officiella SDK:n bort sessionen och skickar SIGNED_OUT; båda flikarna förblir då utloggade trots att appmarkören fortfarande har verify-avsikt. Vid offline eller serverfel lämnas åtkomst låst. Vid en gammal notifiering och fortsatt giltig aktuell session krävs nya positiva getUser-svar innan ett nytt kontoobjekt lämnas ut.

Detta garanterar inte omedelbar fjärråterkallelse på andra enheter eller att ett redan utfärdat JWT slutar gälla direkt. Supabases server-/tokenregler gäller fortfarande. Samma-origin-skript/DevTools är inte en säkerhetssandbox. Vi litar på officiella Auth-serverns aktuella getUser-svar, inte på notifieringens session.

## Faktiskt verifierat lokalt

Chromium 390 × 844, officiell SDK 2.119.2 och helt lokalt simulerad HTTP. Alla oväntade nätverksanrop spärras. **65 bygg-/browserprov passerade**, inklusive överordnade grupper, inga överhoppade. Befintliga databas-/guardprov: 17 passerade, ett tvåanslutningsprov hoppades över i PGlite. CI-resultat redovisas i PR:n.

- Det fördröjda SIGNED_OUT-provet håller getUser-svaren tillbaka. Under tiden är captureAccount nekat och den globala markören oförändrad. Först efter verifieringen återfår båda flikarna B, med nya handtag; det gamla nekar fortfarande läsning.
- Verklig utloggning från en annan flik spärrar även ett äldre fördröjt HTTP-200-svar. Provet inväntar den gamla verifieringens promise innan slutkontrollen, inte bara första synliga utloggningsstatus.
- A → B → A testas över huvudapp och direkt träning utan omladdning. Iframe delar samma kontroller/SDK-tjänst och privata main förblir dold.
- Samtidiga A/B-försök: A:s tokenanrop hålls tillbaka, B installerar nyare avsikt och väntar på låset. A:s sena cleanup kan inte ersätta B:s avsikt; båda flikarna slutar på serververifierat B.
- Avbruten inloggning, sena callbacks, tokenförnyelse, sessionsåterställning, utloggningsfel/nytt försök, offline och SDK-utloggning vid nekad refresh täcks. Äldre lokala poster finns kvar men visas/importeras inte.

Kör enligt [AUTH_LOGIN.md](AUTH_LOGIN.md): samma fem testfiler och backend-regressioner som i PR #26. Inga SQL-tester/migrationer eller SDK-beroenden ändras.

## Status och kvarvarande risker

Den reproducerade **lokala notifieringsblockeraren är åtgärdad** med en explicit regel för återverifiering och negativa tester, inte genom att märka alla SIGNED_OUT som gamla. Sömlöst byte gäller de testade lokala flödena; osäker/nekad Auth lämnas fortsatt låst och omladdning/ny explicit verifiering är reservväg.

Riktig Supabase Auth, verklig tokenrotation/återkallelse, sessionspolicy, blandade cacheversioner, fler än de testade flikarna, långvarig bakgrund och fysisk Safari/iPhone återstår att verifiera i en separat godkänd miljö. Notifieringsstorm kan ge extra getUser-trafik och konservativ låsning. Samtidiga uppstarter utan tidigare markör behåller befintlig initialisering och är inte ett löfte om globalt ordnade användarkommandon över alla tänkbara browserprocesser. Datavyernas framtida upplåsning kräver egen granskning.

Flikar som fortfarande kör PR #26:s gamla callback kan fortsätta skriva globala v1-logout-markörer. De kan inte särskiljas från riktiga utloggningskommandon och ska därför fortfarande låsa. Alla sådana kodversioner måste stängas/laddas om före senare Auth-testaktivering. Proven för sömlöst byte gäller flikar med uppdaterad kod.

Testdistributionen, riktig Auth och molnsynk är fortsatt inaktiva. Ingen hostad kontakt eller publicering har gjorts. Inga befintliga molnverifieringsärenden stängs; plan och godkännanden i [AUTH_TEST_RELEASE.md](AUTH_TEST_RELEASE.md) gäller fortfarande.
