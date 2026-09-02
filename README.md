# Brickmerge Tweaker

Mobile Userscript-Ausgabe von **Brickmerge Tools**. Sie bringt die Funktionen
der Chrome-Extension auf Browser mit Tampermonkey- oder Violentmonkey-Unterstützung.

## Enthalten

- bereinigte Detail- und Übersichtsseiten ohne sichtbares Nachladen
- persönliche Händlerrabatte, Versandkosten, Sortierung und Rabatt-Bubbles
- gemeinsame Marktplatzpreise über den Cloudflare-Worker `getdata`
- eBay DE/FR, Kleinanzeigen, Vinted, Leboncoin, StockX, Idealo, BrickLink und BrickOwl
- Marktplatzpreise ausschließlich auf Set-Detailseiten
- keine Marktplatzabfragen, Preisübernahme oder Neusortierung auf Übersichtsseiten
- manueller Abruf weiterer Marktplätze und gemeinsamer Preis-Cache
- Minifiguren-Overlay mit BrickLink-Preisen für Deutschland und EU
- Copy-Buttons, Preisverlauf und Quick-Links
- separate Meta-GPT-Bridge mit kurzlebiger URL-Fragmentübergabe

API-Schlüssel und Tokens sind nicht im Userscript enthalten. Sie liegen
ausschließlich als Secrets in den Cloudflare-Workern.

## Installation als Chrome-Erweiterung

Dieses Repository ist zugleich die entpackte Chrome-Erweiterung:

1. `chrome://extensions` öffnen.
2. Den Entwicklermodus aktivieren.
3. **Entpackte Erweiterung laden** wählen.
4. Den Stammordner dieses Repositorys auswählen, der direkt `manifest.json`
   enthält.

Der Erweiterungsname in Chrome lautet **Brickmerge Tools**. Ein separater
`-db`-Ordner ist nicht erforderlich.

Die Extension besitzt zusätzlich ein seitenfüllendes Overlay. Ein grünes Häkchen am
Toolbar-Icon zeigt an, dass auf der aktiven Seite ein LEGO-Set erkannt wurde.
Ein Klick auf das Icon öffnet dann direkt das Overlay mit der echten responsiven
Brickmerge-Detailseite. Ohne erkannten Set-Kontext zeigt der Klick stattdessen
die Brickmerge-Suche und die Einstellungen. Die
vorhandenen Extension-Skripte laufen auch in diesem eingebetteten Frame, sodass
kein zusätzliches Userscript nötig ist. Dieses Browser-Feature ist absichtlich
nicht Teil des mobilen Userscripts.

## Installation auf Mobilgeräten

1. Einen mobilen Browser mit Userscript-Unterstützung verwenden.
2. Tampermonkey oder Violentmonkey installieren.
3. `brickmerge-tweaks.js` über die Raw-Ansicht auf GitHub einmalig installieren.
4. Für die Meta-GPT-Übergabe `brickmerge-meta-gpt.user.js` einmalig installieren.
5. Die angeforderten Verbindungen zum Preis-Worker erlauben.

Beide installierten Dateien sind kleine Loader. Sie starten die zuletzt geprüfte
Runtime sofort aus dem lokalen Tampermonkey-Cache, vergleichen im Hintergrund die
Version mit GitHub und laden nur bei einer neuen Version die aktuelle Runtime.
Damit greifen Updates spätestens beim nächsten Seitenaufruf, auch wenn
Tampermonkeys eigene `@updateURL`-Prüfung ausbleibt. Bei einem GitHub-Ausfall läuft
die letzte funktionierende Version weiter. `@updateURL` bleibt als zusätzlicher
Fallback für Änderungen an Berechtigungen oder Seitenregeln erhalten.

Die Frankreich-Angebote sind standardmäßig eingeschaltet und können ausschließlich
über den Tampermonkey-Menüeintrag **Frankreich-Angebote: AN/AUS – umschalten**
deaktiviert oder wieder aktiviert werden. Auf der Brickmerge-Seite selbst wird
kein zusätzlicher Frankreich-Schalter eingeblendet.

## Entwicklung

Die Chrome-Erweiterung im Repository-Stamm ist die gemeinsame Quelle.
`npm run sync` übernimmt ihre geprüften Kernmodule nach `src/` und erzeugt
anschließend mit `npm run build` zwei installierbare Loader sowie deren
GitHub-Runtimes.

`npm test` baut die Datei neu, prüft ihre Syntax und kontrolliert die mobilen
Brücken, das Chrome-Manifest und die wichtigsten aktuellen Funktionen.

## Cloudflare Worker

Der vollständige Quellcode der Worker `getdata` und `ebay-price-api` liegt im
Ordner [`worker`](worker/). Produktive API-Schlüssel und Tokens sind nicht im
Repository enthalten und werden ausschließlich als Cloudflare-Secrets gesetzt.
