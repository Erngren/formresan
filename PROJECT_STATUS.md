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

## Nästa planerade uppgift

Testa **Benpress 2.0**, en stående version av benpressguiden som ska vara lättare att läsa på iPhone. Uppdraget omfattar enbart ett byte av `assets/exercises/legpress.png` och ett test på iPhone.

## Framtida arbete

Om Benpress 2.0 fungerar bra på iPhone kan övriga gymbilder få samma stående format, en bild i taget och efter godkännande. Övriga framtida idéer är ännu ospecificerade.
