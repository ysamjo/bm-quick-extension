# Brickmerge Tweaker

Mobile Userscript-Ausgabe von **Brickmerge Tools**. Sie bringt die Funktionen
der Chrome-Extension auf Browser mit Tampermonkey- oder Violentmonkey-Unterstützung.

## Enthalten

- bereinigte Detail- und Übersichtsseiten ohne sichtbares Nachladen
- persönliche Händlerrabatte, Versandkosten, Sortierung und Rabatt-Bubbles
- gemeinsame Marktplatzpreise über den Cloudflare-Worker `getdata`
- eBay DE/FR, Kleinanzeigen, Vinted, Leboncoin, StockX, Idealo, BrickLink und BrickOwl
- manueller Abruf weiterer Marktplätze und gemeinsamer Preis-Cache
- Minifiguren-Overlay mit BrickLink-Preisen für Deutschland und EU
- Copy-Buttons, Preisverlauf, Quick-Links und Meta-GPT-Übergabe

API-Schlüssel und Tokens sind nicht im Userscript enthalten. Sie liegen
ausschließlich als Secrets in den Cloudflare-Workern.

## Installation auf Mobilgeräten

1. Einen mobilen Browser mit Userscript-Unterstützung verwenden.
2. Tampermonkey oder Violentmonkey installieren.
3. `brickmerge-tweaks.js` über die Raw-Ansicht auf GitHub öffnen und installieren.
4. Die angeforderten Verbindungen zum Preis-Worker erlauben.

Vorhandene Installationen werden über `@updateURL` automatisch aktualisiert.
Die Frankreich-Angebote sind standardmäßig ausgeschaltet und können im
Userscript-Menü über **Frankreich-Angebote umschalten** aktiviert werden.

## Entwicklung

`npm run sync` übernimmt die aktuellen geprüften Module und Logo-Assets aus dem
benachbarten Ordner `brickmerge-extension-db` und erzeugt anschließend mit
`npm run build` die einzelne installierbare Userscript-Datei.

`npm test` baut die Datei neu, prüft ihre Syntax und kontrolliert die mobilen
Brücken sowie die wichtigsten aktuellen Funktionen.
