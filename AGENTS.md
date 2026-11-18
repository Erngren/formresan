# Arbetsinstruktioner för Formresan

## Projektet

Formresan är en personlig, mobilanpassad webbapp för träning, golf, kost, sömn, vikt, rutiner och historik. Enligt projektägaren publiceras appen via GitHub Pages på [Formresan](https://erngren.github.io/formresan/) och används främst på iPhone.

## Designprinciper

- Följ den GitHub Dark-inspirerade designen med mörk bakgrund, tydlig kontrast och lättläst text.
- Prioritera mobilen, särskilt iPhone. Använd stora, tryckvänliga knappar och enkel navigering.
- Gör övningsguiderna lättlästa på en stående mobilskärm.
- Behåll svensk text i användargränssnittet.

## Teknisk struktur

- `index.html` innehåller huvudappens HTML, CSS och JavaScript. Den hanterar dagslogg, historik, mål och datahantering. Fliken Träning bäddar in träningsvyn i en iframe.
- `training/index.html` är den inbäddade träningsvyn med passval, träningshistorik, export och en dialog för övningsguider.
- `js/training.js` definierar övningar och pass, öppnar guiderna och hanterar loggning, lokal lagring och träningshistorik. Skriptet meddelar huvudappen vilken höjd iframen behöver.
- `css/training.css` styr träningsvyns layout, färger och kontroller, inklusive guidedialogen.
- `assets/exercises/` innehåller guidebilder. Träningslogiken kopplar varje aktuell guide till en PNG med övnings-ID:t som filnamn.
- `manifest.webmanifest` anger bland annat namn, startadress och fristående visning. `icon.svg` används som app- och webbläsarikon. `apple-touch-icon.png` refereras som ikon för Apples hemskärm.

## Skydda användardata

- Bevara localStorage-nyckeln `formresan_v1` för huvudappens mål och dagslogg.
- Bevara localStorage-nyckeln `formresan_training_v14` för träningspassen och träningshistoriken.
- Ändra aldrig datamodeller, historikformat eller övnings-ID:n utan uttryckligt godkännande.
- Bevara befintliga användardata och träningshistorik. Radera eller återställ dem aldrig som en del av utvecklingsarbetet.
- Var särskilt försiktig vid migreringar och ändringar i lagringslogiken. Kontrollera att redan sparade poster fortfarande kan läsas.

## Arbetsregler

1. Läs relevant befintlig kod innan du ändrar något.
2. Gör små, avgränsade ändringar.
3. Bevara fungerande funktioner.
4. Arbeta på en separat branch.
5. Skapa en pull request för granskning.
6. Beskriv exakt vilka filer som ändrats.
7. Kontrollera att appen fortfarande fungerar på mobil.
8. Gör aldrig oombedda större ombyggnader.
9. Be om förtydligande om uppdraget riskerar att påverka sparad data.
10. Uppdatera `PROJECT_STATUS.md` när en större funktion eller beslutad milstolpe är klar.
