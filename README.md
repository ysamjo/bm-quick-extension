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

Die Frankreich-Angebote sind standardmäßig eingeschaltet und können im
Userscript-Menü oder über den gut sichtbaren Schalter oberhalb der Linkleiste
deaktiviert werden. Der Schalter zeigt seinen aktuellen Zustand mit **AN/AUS**.

## Entwicklung

`npm run sync` übernimmt die aktuellen geprüften Kernmodule aus dem benachbarten
Ordner `brickmerge-extension-db` und erzeugt anschließend mit `npm run build`
zwei installierbare Loader sowie deren GitHub-Runtimes. Logo-Assets werden wegen
der Cloud-Laufwerke bewusst nur bei Bedarf mit `npm run sync:icons` abgeglichen.

`npm test` baut die Datei neu, prüft ihre Syntax und kontrolliert die mobilen
Brücken sowie die wichtigsten aktuellen Funktionen.
