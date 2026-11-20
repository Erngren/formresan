# Säker inloggningsgrund – steg 3

20 november 2026. Utgångspunkt: main `b231605`, inklusive PR #24.

## Vad som är byggt och vad som är avstängt

E-post/lösenordsvyn och integrationen med officiell Supabase SDK är implementerade. **Repo- och Pages-standard är fortfarande `enabled: false`.** Då laddas inte SDK:n och inga Auth-anrop görs. Oaktiverat lokalt testläge fungerar som tidigare. En redan befintlig kontomarkör återöppnar aldrig gamla testvyer.

Med separat godkänd distributionskonfiguration kan vyn logga in med `signInWithPassword`, logga ut lokalt och återverifiera med `getUser`. Felmeddelanden är generiska och visar inte SDK:ts servermeddelanden eller om adressen finns. Dubbelklick spärras; lösenordet tas omedelbart bort från fältet vid submit och skrivs inte till egna lagringsnycklar eller loggar. JavaScript-strängar kan inte garanterat nollställas i webbläsarens minne.

Registrering och lösenordsåterställning visas endast som information om att funktionerna ännu inte är aktiverade. Ingen signUp, resetPasswordForEmail, OTP, OAuth eller redirect-hantering används. Kontovyer och molnsynk är fortsatt helt avstängda: `accountViewsEnabled` är alltid false, även efter lyckad inloggning. Ingen gammal testdata importeras eller raderas. Distributionskonfigurationen laddas före lagrings- och appkoden; kontrollerad aktiveringsavsikt låser därför legacy-läsningen redan före SDK-laddning, så gamla testposter inte hinner renderas under uppstart. Detta kontrolleras med förladdad testdata och instrumenterade legacy-läsningar.

## Fast SDK och betrodd bootstrap

`js/auth-bootstrap.js` laddar officiell `@supabase/supabase-js` **2.119.2**, publicerad som npm-paketets UMD-fil:

```text
https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js
sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ
```

Integritetsvärdet verifierades mot både den installerade npm-filens bytes och CDN-svaret. Webbläsaren kräver samma SHA-384 via SRI och anonymous CORS. Version/hash måste uppdateras och testas tillsammans, aldrig via `@latest` eller flytande `@2`. Ingen CDN-kod laddas med avstängd eller ogiltig konfiguration. SDK-laddningsfel lämnar vyerna låsta och kräver omladdning.

Ett toppdokument skapar en klient. Träningsiframen återanvänder förälderns tjänst och kontroller, utan egen SDK-klient. Direkt öppnad träning är ett eget toppdokument och använder samma bootstrap, projektkonfiguration och sessionsnyckel. Flera toppdokument har var sin officiell SDK-instans, samordnade genom SDK:ts sessionshantering och appens flikinvalidering.

Inställningar: `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`. SDK:n hanterar återställning och tokenförnyelse; appen verifierar alltid identitet med `getUser`. Auth-fetch tillåter endast projektets exakta origin och `/auth/v1/`, förbjuder HTTP-redirect och har 15 sekunders nätverkstimeout per anrop. SDK:n kan göra egna återförsök, så detta är inte en total tidsgräns för hela operationen. Web Locks och BroadcastChannel krävs; ingen osäker reservväg används.

SDK-sessionen, inklusive tokens, lagras av SDK:n under `formresan_auth_v1:<projekthost>`, separat från appdata. Projektvärdet beräknas från konfigurationen vid körning. Inget lösenord sparas av appen. Detta är klientbaserad Auth; samma origin, XSS och tillgång till webbläsarprofilen kan exponera SDK-tokens. Använd aldrig service-role/secret key här. Befintliga data- och träningsnycklar är oförändrade.

Se officiella källor: [installation](https://supabase.com/docs/reference/javascript/installing), [klientinställningar](https://supabase.com/docs/reference/javascript/initializing), [lösenordsinloggning](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser) och [Auth-händelser](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## Distributionskonfiguration – separat godkännande krävs

`js/auth-config.js` är en uttryckligen avstängd distributionsfil i Git. Konfiguration hämtas aldrig från URL-parametrar, formulär eller localStorage. Bootstrap accepterar endast dessa fyra fält när enabled är true:

| Fält | Krav |
| --- | --- |
| `enabled` | Boolean true, endast i separat godkänd releaseartefakt. |
| `deploymentOrigin` | Exakt den avsedda HTTPS-sidans origin, utan sökväg; måste matcha webbläsaren. |
| `url` | Exakt HTTPS-projektorigin med 20 gemena alfanumeriska tecken följda av `.supabase.co`, utan avslutande snedstreck. Egna domäner stöds inte i detta steg. |
| `publishableKey` | Endast ny `sb_publishable_…`-nyckel. Legacy JWT/anon, secret och service-role avvisas. |

Planerad distribution är en granskad Pages-releaseartefakt där endast `js/auth-config.js` ersätts före uppladdning. Filen ska tilldela ett fryst objekt till `window.FormresanAuthConfig`. Värden ska serialiseras med JSON.stringify av ett byggsteg, inte sättas in genom shellstränginterpolation. Publicera endast publishable key; den är offentlig klientkonfiguration och ersätter inte RLS. Logga inte konfiguration eller sessionsdata. Lägg inga verkliga projektvärden i repo, tester eller PR.

**Ingen sådan aktiverad artefakt eller deploy-workflow skapas här.** Aktuell fil förblir avstängd. Före aktivering måste projektägaren separat godkänna målprojekt/origin, en konkret bygg- och Pages-publiceringsprocess samt kontrollerad hantering/cache av konfigurationsfilen. Flytta inte Pages-inställningar eller lägg till Actions-variabler/hemligheter som del av denna PR. En avstängd konfigurationsfil stoppar nya Auth-anrop men återkallar inte tidigare utfärdade tokens; ändrad konfiguration kräver omladdning. Avaktivering är inte en säkerhetsmässig utloggning av alla enheter.

Fel origin, extra fält, fel URL eller fel nyckeltyp låser utan att ladda SDK/Auth. Om filen saknas/är undefined körs endast lokalt testläge; om en tidigare kontomarkör finns förblir privata vyer låsta. Inga automatiska hostade projektkontroller görs. Syntaxvalidering bevisar inte att konfigurationen tillhör rätt projekt – det är releasegranskningens ansvar.

## Inloggningsoperationer och sena svar

`beginSignIn()` i befintlig kontroller tömmer vydata och skapar en generationsbunden operation med låst flikmarkör. SDK:ts SIGNED_IN under den operationen får inte i sig godkänna inloggningen. Efter SDK-svaret måste samma operation fortfarande vara aktuell, därefter sker `getUser`-verifiering. SIGNED_OUT och tokenförnyelse invaliderar tidigare handtag. `INITIAL_SESSION` ignoreras som övergång: den skickas till varje ny prenumerant och skulle annars avbryta lagringsobjektets egen verifiering. Sessionen från händelsen används aldrig som identitetsbevis.

Inloggning/utloggning/explicit återverifiering serialiseras mellan toppdokument via Web Lock `formresan-auth-operation-v1`. Avbryt låser genast men kan inte ta tillbaka ett redan skickat Auth-anrop. SDK:n kan hinna spara en session innan ett sent svar granskas. Därför hålls låset tills en stale/avbruten inloggning har försökt logga ut lokalt. Nya försök i samma vy spärras under tiden; andra flikar väntar eller avvisas när deras kontext blivit inaktuell. Inga datavyer öppnas i detta fönster. En sen SIGNED_OUT-notifiering i annan flik kan även stoppa ett direkt efterföljande försök. Det behandlas som konflikt och lämnar appen låst; omladdning av berörda flikar följt av ny inloggning verifieras som återhämtning. Ingen händelse ignoreras för att få testet att passera. Smidigare konfliktåterhämtning bör bedömas före bred aktivering.

Om SDK-utloggning misslyckas kan en SDK-session fortfarande finnas i webbläsaren. Appen håller då vyerna låsta och visar fel; den påstår inte att serveråterkallelse lyckades. Efter omladdning med lock/logout-markör sker ingen automatisk upplåsning. Explicit "Verifiera igen" kan verifiera en kvarvarande session och visar fortfarande endast den låsta kontovyn. "Logga ut" kan försöka igen. Global tokenåterkallelse eller kontobyte utan bekräftad lokal utloggning är inte implementerat som egen serverfunktion.

pagehide ogiltigförklarar pågående verifiering och kontohandtag; pageshow återverifierar en tidigare tillåten session. Flikmeddelanden betros aldrig som identitet. Smart mat, import/export och formulär har kvar skydden från PR #24. Inloggningsvyn ligger utanför privata main men dess utkast rensas vid övergångar. Riktig inloggning återöppnar aldrig legacy-main.

## Tester och reproduktion

Installera testverktyg i en separat temporär katalog med `playwright@1.65.1` och `@supabase/supabase-js@2.119.2`, installera Chromium och sätt FORMRESAN_PLAYWRIGHT till Playwright-modulkatalogen. SDK:n söks som dess syskon i node_modules; alternativt ange FORMRESAN_SUPABASE_UMD till UMD-filen. Sätt PLAYWRIGHT_BROWSERS_PATH vid behov. Kör:

```sh
node --test tests/auth-login.cjs tests/account-lifecycle.cjs tests/account-storage.cjs tests/local-data-safety.cjs
npm ci --prefix tests
node --test tests/database-security.cjs tests/auth-rest-guards.cjs tests/hosted-checks.cjs tests/rpc-revision-migration.cjs
```

Browserprov kör 390 × 844 och riktig SDK med lokalt simulerade HTTP-svar. Alla app-/CDN-/Auth-anrop uppfylls lokalt; oväntat nätverk avvisas. Syntetiska e-postadresser under example.invalid, tokens och projekthost är enbart fixtures, inte riktiga konton/nycklar. Proven täcker inloggning/fel/A → B → A, avbrott och sent SDK-svar, omladdning, refresh-token, bakgrund/återgång, flera flikar, iframe/direkt träning, saknad/ogiltig konfiguration, SDK-/nätverksfel, mobilbredd, låsta vyer och utebliven import.

Lokalt passerade 50 browserprov inklusive fyra överordnade grupper. Befintliga lokala databas-/guardprov: 17 passerade och ett riktigt tvåanslutningsprov hoppades över i PGlite. Ingen Docker/PostgreSQL-server eller riktig Auth-server kördes lokalt på arbetsdatorn. CI kör browserproven och de befintliga isolerade PostgreSQL-, RPC-retry- och Supabase Auth/REST-flödena; faktiska CI-resultat redovisas i PR:n. SQL-tester och migrationer är oförändrade.

Mockad HTTP testar SDK- och appbeteende men inte serverns lösenordskontroll, tokenunderskrifter, faktisk sessionsåterkallelse, leverans av e-post eller Safari. Fysisk iPhone och separat godkända server-/hostade Auth-prov återstår. Den befintliga isolerade Supabase-sviten är en separat backendverifiering, inte end-to-end-verifiering av den nya vyn mot en riktig server.

## Nästa steg och beslut

1. Granska denna PR, SDK-version/hash och sessionspersistens i webbläsaren. Kontovyer/molnsynk ska fortsätta vara avstängda.
2. Godkänn konkret releasekonfiguration och distributionsprocess. Välj isolerat målprojekt och kontrollera e-post/lösenordsprovider, lösenordspolicy, rate limits och behov av skydd mot automatiserade försök. Inga inställningar har ändrats här.
3. Kör separat godkända integrationstester med verklig Auth-server och syntetiska konton, inklusive nekad/utgången session, samtidiga inloggningar, utloggningsfel, tokenrotation och återgång på fysisk iPhone. Stäng inte befintliga molnverifieringsärenden utifrån mockade tester.
4. Besluta registrering, e-postbekräftelse, återställning, SMTP och redirect-allowlist innan deras funktioner byggs/aktiveras.
5. Implementera och granska kontobunden vyadapter som ett separat steg. Gamla lokala testposter får inte kopplas automatiskt till ett konto. Molnsynk och migration är fortsatt egna uppdrag.
