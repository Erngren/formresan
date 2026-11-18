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

#### Faktiskt körda tester

Automatiserade tester med Chromium i mobilstorlek 390 × 844 och en layoutkontroll vid 320 × 568 passerade den 18 november 2026. Skärmbilden av matdialogen granskades visuellt.

- Riktiga API-anrop för Kycklingfilé 200 gram, Ris kokt 150 g och Ägg 120 g. Rå kycklingbröstfilé utan skinn, kokt basmatiris och kokt ägg valdes uttryckligen. Sparade värden jämfördes med API-värdena och portionsformeln.
- Okänt livsmedel, noll, negativ mängd, över maxgränsen, text som mängd, fel enhet och flera mängder avvisades.
- Svensk decimal, ändring efter ett färdigt val, simulerat HTTP 500-fel, offline och saknade näringsvärden.
- Simulerat fullt localStorage, oförändrad lagring efter det misslyckade sparförsöket och lyckat nytt försök.
- Befintlig matpost visades och bevarades efter omladdning. Manuell mat, Banan och Min taco kunde sparas. Träningslagringens testdata förblev oförändrade. Inga JavaScript-fel registrerades i testen.

#### Återstår och begränsningar

- Test på fysisk iPhone med Safari, inklusive skärmtangentbord, långa sökresultat och dialogrullning.
- Kontroll av den driftsatta versionen efter granskning och publicering via GitHub Pages.
- Första sökningen kräver nätverk och hämtar hela livsmedelslistan. Näringsvärden hämtas för varje valt livsmedel. Offline visas ett felmeddelande. CORS och API-tillgänglighet beror på Livsmedelsverkets tjänst.

## Nästa planerade uppgift

### Benpress 2.0

Testa **Benpress 2.0**, en stående version av benpressguiden som ska vara lättare att läsa på iPhone. Uppdraget omfattar enbart ett byte av `assets/exercises/legpress.png` och ett test på iPhone.

## Framtida arbete

Om Benpress 2.0 fungerar bra på iPhone kan övriga gymbilder få samma stående format, en bild i taget och efter godkännande. Övriga framtida idéer är ännu ospecificerade.
