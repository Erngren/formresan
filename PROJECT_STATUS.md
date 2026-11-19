# Projektstatus för Formresan

## Implementerat och verifierat i repot

- `index.html` innehåller huvudvyerna Idag, Träning, Historik och Mål & data. Träning öppnar den inbäddade träningsvyn.
- Träningsvyn har gympassen Helkropp A och B samt golfuppvärmning och golfrörlighet. Varje pass eller rutin innehåller fem övningar.
- Träningsloggen sparar gymset med vikt och repetitioner samt avprickade övningar från golfrutinerna. Träningsvyn visar senaste passet och har en expanderbar historik.
- Övningsguiderna har instruktioner och tekniktips för 10 gymövningar och 10 golfövningar. Alla 20 guider refererar till motsvarande PNG-fil under `assets/exercises/`, och samtliga filvägar finns i repot.

Verifieringen gäller koden och bildfilerna enligt nedan. Körning på iPhone och den aktuella GitHub Pages-publiceringen återstår att verifiera.

## Gymövningar

- Helkropp A: `legpress`, `chest`, `row`, `rdl`, `deadbug`.
- Helkropp B: `squat`, `pulldown`, `shoulder`, `curl`, `pushup`.

`curl` är **Sittande lårcurl**.

## Golfövningar

- Golfuppvärmning: `thoracic`, `hipcircles`, `armcircles`, `legswings`, `swings`.
- Golfrörlighet: `openbook`, `hipflex`, `figure4`, `door`, `ankle`.

## Kända detaljer

- Golfbildernas PNG-mått bekräftar att alla tio är stående. Projektägaren upplever att de är lättare att läsa på iPhone.
- Enligt projektägaren har gymbilderna hittills huvudsakligen varit liggande. Gymbildernas mått och bildinnehåll kunde inte verifieras vid genomgången.
- `deadbug` har en tillfällig bild. Appens befintliga varning anger att bilden visar arm och ben i rörelse på samma sida. Det stämmer med projektägarens beskrivning. Följ guidens instruktion om motsatt arm och ben, till exempel vänster arm och höger ben, och byt sedan sida. Bevara varningen tills bilden rättas.
- Projektägaren vill bevara fungerande funktioner och sparad historik.

## Smart matberäknare v1

Implementerad i huvudappens matdialog. Användaren skriver ett livsmedel och en vikt i gram, väljer en databasvariant och bekräftar beräknade kalorier och protein. Manuell registrering och snabbknapparna finns kvar. Den smarta registreringen använder samma grundformat för matposter och samma lagringsnyckel som tidigare.

### Datakälla och teknik

- Källa är [Livsmedelsverkets öppna Livsmedelsdatabas](https://dataportal.livsmedelsverket.se/livsmedel/swagger/index.html), tillhandahållen enligt CC BY. Gränssnittet visar källan och att värdena är uppskattade genomsnitt för ätlig del.
- Verifierat mot faktiska API-svar den 18 november 2026. Listan använder `livsmedel`, `nummer`, `namn` och `_meta.totalRecords`. Näringsvärdena är en array med `euroFIRkod`, `enhet`, `varde`, `viktGram` och `matrisenhetkod`. Kalorier väljs med `ENERC` och enheten `kcal`, protein med `PROT` och enheten `g`. Båda ska avse 100 gram och viktbasen `W`.
- API:t har en paginerad lista utan dokumenterad textsökning. Appen hämtar hela listan i sidor om 500 poster vid första sökningen och söker sedan lokalt i minnet tills sidan laddas om. Matchning sker på ord, med stöd för benämningen kycklingfilé. Kokt matchar inte okokt. Användaren väljer alltid variant.
- Portionen beräknas som värdet per 100 gram gånger gram delat med 100. Kalorier avrundas till heltal och protein till en decimal. Mängder över 0 och högst 10 000 gram accepteras, med upp till två decimaler och svenskt decimaltecken.
- API:t svarade med `Access-Control-Allow-Origin: https://erngren.github.io` för både listan och näringsvärdena. Webbläsartest från denna origin med lokalt serverad kandidatkod och riktiga API-anrop passerade. Lösningen använder HTTPS direkt från klienten. Inga API-nycklar behövs.
- Nätverksanrop har 20 sekunders tidsgräns. Fel och saknade värden stoppar beräkningen. Ändrad söktext eller stängd dialog avbryter pågående anrop och ogiltigförklarar tidigare val. Lagringsfel lämnar portionen kvar för nytt sparförsök.

### Faktiskt körda tester

Automatiserade tester med Chromium i mobilstorlek 390 × 844 och en layoutkontroll vid 320 × 568 passerade den 18 november 2026. Skärmbilden av matdialogen granskades visuellt.

- Riktiga API-anrop för Kycklingfilé 200 gram, Ris kokt 150 g och Ägg 120 g. Rå kycklingbröstfilé utan skinn, kokt basmatiris och kokt ägg valdes uttryckligen. Sparade värden jämfördes med API-värdena och portionsformeln.
- Okänt livsmedel, noll, negativ mängd, över maxgränsen, text som mängd, fel enhet och flera mängder avvisades.
- Svensk decimal, ändring efter ett färdigt val, simulerat HTTP 500-fel, offline och saknade näringsvärden.
- Simulerat fullt localStorage, oförändrad lagring efter det misslyckade sparförsöket och lyckat nytt försök.
- Befintlig matpost visades och bevarades efter omladdning. Manuell mat, Banan och Min taco kunde sparas. Träningslagringens testdata förblev oförändrade. Inga JavaScript-fel registrerades i testen.

### Återstår och begränsningar

- Test på fysisk iPhone med Safari, inklusive skärmtangentbord, långa sökresultat och dialogrullning.
- Kontroll av den driftsatta versionen efter granskning och publicering via GitHub Pages.
- Första sökningen kräver nätverk och hämtar hela livsmedelslistan. Näringsvärden hämtas för varje valt livsmedel. Offline visas ett felmeddelande. CORS och API-tillgänglighet beror på Livsmedelsverkets tjänst.

## Lokal datasäkerhet

Implementerat för granskning den 19 november 2026. Huvudappen, smart matregistrering och träningsvyn använder nu den gemensamma modulen `js/storage.js`.

- Import och redan lagrade data valideras före användning och skrivning. Positiva numeriska ID:n, unika post-ID:n, riktiga kalenderdatum och relevanta tal-/textfält kontrolleras. Äldre giltiga numeriska ID:n, även decimaltal, och okända extra fält bevaras. Saknade äldre valfria aktivitetsfält får säkra standardvärden. Okända posttyper eller ogiltiga data kräver manuell granskning och kan exporteras som råkopia.
- Importerade ID:n används som data i raderingsknappar med eventlyssnare. De interpoleras inte i inline-JavaScript. Textfält HTML-escapas och värden som används som tal måste vara tal.
- Skrivning läser den senaste beständiga datan under ett gemensamt exklusivt Web Lock, tillämpar endast den begärda ändringen, validerar och skriver hela den berörda nyckeln. Alla befintliga sparvägar, inklusive smart mat, använder detta flöde. Nya numeriska ID:n tilldelas under låset och kontrolleras mot befintliga ID:n.
- Minnesdata och sparbekräftelse uppdateras efter lyckad lagring. Vid fel finns formulär och inmatning kvar. Träningspass läggs inte till i minnet före bekräftad skrivning, vilket förhindrar dubblett vid nytt försök efter fel. Pågående sparning spärrar upprepad inlämning.
- Storage-/pageshow-händelser läser om data utan att skriva. Träningshistorik uppdateras utan att pågående setinmatning byggs om. Ändrade målutkast bevaras vid omläsning av huvuddata.
- Befintliga nycklar och grundformat är kvar. Skadad eller otillgänglig lagring leder till felmeddelande och stoppad skrivning. Inget trasigt dokument ersätts automatiskt med standarddata.
- De separata äldre exporterna har kvar sina grundformat och filnamn och läser beständigt lagrad data. En separat komplett export hämtar båda nycklarna under samma lås. Formatet är `formresan-backup`, `formatVersion: 1`, `exportedAt` i ISO-format, `data`, `rawData` och `errors`. Råsträngarna bevaras även vid trasig JSON. Saknad nyckel anges med null. Nekad läsning stoppar exporten. Gemensam import ingår inte och den kompletta filen avvisas av huvudappens import.
- En bekräftad import av huvudappens äldre format behåller sitt ersättande beteende. Om huvuddata ändrats sedan importbekräftelsen stoppas ersättningen för att bevara den andra skrivningen. Träningsnyckeln påverkas inte.

### Samtidighet och begränsningar

Web Locks samordnar uppdaterade flikar, huvudappens iframe och direkt öppnad träningsvy inom samma origin. Det är ett avgränsat alternativ till en full IndexedDB-ombyggnad för detta lokala steg. Varje skrivning ändrar en nyckel. Komplett export håller samma lås vid läsning av båda. Någon transaktion för att ersätta båda nycklarna implementeras inte här. [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

Äldre redan öppna appversioner använder inte låset och kan fortfarande skriva gamla ögonblicksbilder. Vid publicering behöver samtliga gamla Formresan-flikar och hemskärmsvyer laddas om innan registrering fortsätter. Script- och iframeadresser har versionsparameter så att den uppdaterade HTML-versionen begär de nya scriptfilerna. Skyddet gör inget anspråk på att samordna äldre kod eller externa skrivare till localStorage.

Utan Web Locks stoppas skrivningar och samordnad komplett export med ett begripligt fel. De separata exporter som läser en enda giltig nyckel är fortfarande tillgängliga. WebKit dokumenterar Web Locks-stöd från Safari 15.4, men fysisk iPhone-verifiering av denna ändring återstår. [WebKit om Safari 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)

Lokal webbläsardata kan fortfarande rensas eller försvinna av miljöorsaker. Användaren behöver spara ned exporter. Om lagringen är skadad bevaras råvärdena och skrivningar stoppas. Återställning av skadade data och import av komplettfilen kräver ett senare uttryckligt uppdrag. Kryptering, versionsarkiv, beständig molnkö och Supabase-integration tillhör kommande granskade etapper.

### Faktiskt genomförda tester

`tests/local-data-safety.cjs` innehåller 17 isolerade regressionstestfall med syntetiska data i Chromium vid 390 × 844. Samtliga passerade den 19 november 2026. Node rapporterar 18 godkända tester inklusive den överordnade testgruppen.

- Äldre historik efter omladdning, oförändrade separata exportformat och bevarade extra fält.
- Giltig äldre import, ogiltiga ID:n, dubbletter, fel kalenderdatum, fel numeriska fält, ofullständiga poster och avvisad komplettfil. Ogiltig import lämnade båda nycklarna oförändrade.
- Manipulerade ID:n avvisades. HTML-/skripttext i namn, aktivitetsfält, sömntext och träningshistorik kördes inte. Raderingsknapparnas eventlyssnare testades.
- Simulerade skrivfel i manuell mat, taco, aktivitet, sömn, vikt, kreatin och mål. Data och inmatning bevarades och falska framgångsmeddelanden uteblev. Lyckade nya försök testades.
- Träningsfel följt av nytt försök gav exakt ett nytt pass. Golfregistrering och äldre träningsfält bevarades.
- Två flikar skrev 15 poster vardera samtidigt utan förlust eller ID-kollision. Samtidiga huvud-/träningsskrivningar från flik och iframe bevarades. En skrivning mellan importförhandsvisning och importlås stoppade ersättningen.
- Smart matregistrering testades med syntetiska API-svar, skrivfel och nytt försök. Portionen bevarades vid fel och sparades korrekt efteråt.
- Komplett export jämfördes mot beständigt lagrade data, båda råsträngarna och exportmetadata. Ett osparat formulär kom inte med som sparad post.
- Trasig JSON, ogiltiga lagringsstrukturer, nekad läsning både vid start och vid skrivning samt saknat Web Locks-stöd gav ingen nollställning. En råkopia kunde tas när lagringen var läsbar men innehöll trasig JSON.
- Uppdatering från annan flik bevarade ett pågående setutkast. Separat mobilkontroll öppnade, avkodade och stängde alla 20 guider. Mobil layout granskades visuellt och sidan rymdes på bredden.

Testfilen kräver Playwright med installerad Chromium som utvecklingsverktyg. Inga nya runtime-beroenden har lagts till appen. Kör `node --test tests/local-data-safety.cjs` från repots rot. Om Playwright ligger utanför repot anger `FORMRESAN_PLAYWRIGHT` den absoluta modulvägen. `PLAYWRIGHT_BROWSERS_PATH` kan ange sökvägen till installerade webbläsare. JavaScript-syntaxkontroll och `git diff --check` körs också före leverans.

### Återstår på fysisk iPhone

Testa i Safari och hemskärmsläge med båda vyerna, flera öppna flikar, bakgrund/återgång, importer, nedladdning av båda gamla exporter och komplettfilen samt simulerat fullt eller nekat lagringsutrymme. Bekräfta att den uppdaterade versionen är laddad i varje vy. Kontrollera formulärens felmeddelanden och återförsök. Detta steg skapar ingen reservkopia utanför enheten förrän användaren faktiskt laddar ned och bevarar exportfilen.

## Nästa planerade uppgift

### Benpress 2.0

Testa **Benpress 2.0**, en stående version av benpressguiden som ska vara lättare att läsa på iPhone. Uppdraget omfattar enbart ett byte av `assets/exercises/legpress.png` och ett test på iPhone.

## Framtida arbete

Om Benpress 2.0 fungerar bra på iPhone kan övriga gymbilder få samma stående format, en bild i taget och efter godkännande. Övriga framtida idéer är ännu ospecificerade.
