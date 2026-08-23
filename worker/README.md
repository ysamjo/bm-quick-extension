# getdata Worker

Neutral benannter Cloudflare Worker für die Datenabfragen der Chrome-Extension.
Der separate Worker `ebay-price-api` enthält ausschließlich die eBay-Logik.
Die eBay-Routen nutzen ihn über eine interne Service-Bindung; Secret-Werte
werden dabei weder ausgelesen noch dupliziert. Rebrickable und Kleinanzeigen
verwenden serverseitige Worker-Secrets.
Öffentliche Brickmerge-Seiten und BrickOwl werden direkt durch Chrome geladen
und nicht mehr über diesen Worker geleitet.

Die gemeinsame, sprachabhängige eBay-Titelprüfung liegt in
`lib/ebay-title-filter.js`. Beide Worker verwenden dadurch dieselben Regeln für
exakte Setnummern, Zubehör, unvollständige Sets und reine Minifigurenangebote;
französische Ausschlussbegriffe bleiben als eigener Regelsatz gekapselt.

BrickLink-Minifigurenpreise werden über
`/proxy/bricklink/minifig-price?itemNo=...&region=DE|EU` gebündelt. Der Worker ermittelt
intern die BrickLink-Artikel-ID und den niedrigsten aktuellen Neupreis eines
deutschen Händlers, damit die Extension dafür nur eine Anfrage je Figur braucht.

`/bricklink?set=...` liefert außerdem den niedrigsten aktuellen Neupreis eines
deutschen BrickLink-Händlers für ein vollständiges Set. Dieser normalisierte
Preis liegt im gemeinsamen Angebots-Cache und wird auf Set-Detailseiten
verwendet. Übersichts- und Suchseiten übernehmen keine Marktplatzpreise und
werden nicht neu sortiert. Versandkosten sind beim BrickLink-Wert nicht
enthalten, weil BrickLink sie vor der Warenkorbanfrage nicht zuverlässig liefert.

Vinted und Leboncoin werden über getrennte Apify-Actors abgefragt. Dafür muss
das Worker-Secret `APIFY_TOKEN` gesetzt sein. Pro Lauf werden höchstens acht
Vinted- beziehungsweise zehn Leboncoin-Treffer verarbeitet. Unvollständige Sets,
Zubehör, Minifiguren-Angebote und verdächtig niedrige Treffer werden entfernt;
der Gesamtpreis berücksichtigt die vom Actor gelieferten Versand- und Gebührenwerte.

Alle Apify-Routen starten ausschließlich asynchron. Die Extension verfolgt den
zurückgegebenen Status-Endpunkt; einzelne Worker-Anfragen bleiben deshalb nicht
während eines langen Actor-Laufs geöffnet.

`/ebay-minifig?itemNo=...` liefert den günstigsten passenden eBay-Sofort-Kaufen-
Treffer für eine BrickLink-Minifiguren-ID. Wie `/price` wird die Route intern an
`ebay-price-api` delegiert. OAuth, Secrets, eBay-Cache und Rate-Limits bleiben
damit vollständig im eBay-Worker gekapselt.

## Gemeinsamer Angebots-Cache

- `/offers/cache?set=...&ean=...` liest eBay Deutschland, eBay Frankreich, Kleinanzeigen, Vinted,
  Leboncoin, StockX, Idealo und BrickLink ausschließlich aus Edge/KV. Ein Cache-Fehlschlag startet
  keinen externen oder kostenpflichtigen Abruf.
- `/offers/refresh?set=...&ean=...` aktualisiert die gewählten Quellen. Apify-
  Abfragen laufen asynchron und bleiben je Lauf auf maximal 0,05 USD begrenzt.
- Detailseiten können dadurch bereits erzeugte Ergebnisse wiederverwenden.
  Neue Abrufe werden ausschließlich durch den gemeinsamen Aktualisieren-Button
  der Extension oder des Userscripts ausgelöst.

Cacheantworten enthalten `x-worker-cache` und `x-bm-saved-at`. Der gebündelte
Endpunkt reicht diese Angaben je Quelle weiter, damit die Extension Alter und
Cacheebene transparent anzeigen kann.

StockX verwendet den regionsfähigen Actor `crawlerbros/stockx-scraper` mit
`country: DE`, `currency: EUR`, höchstens drei Treffern und ohne Detailabrufe.
Das Lauf-Limit bleibt bei 0,10 USD; alle anderen Apify-Actors bleiben auf
0,05 USD begrenzt. Nicht als deutscher EUR-Preis ausgewiesene StockX-Treffer
werden verworfen, statt einen US-Preis irreführend umzurechnen.

## Lokale Prüfung und Deployment

```sh
npm ci
npm run check
npm test
npm run deploy
npx wrangler deploy --config wrangler.ebay.jsonc
```

Die Konfiguration enthält nur Bindings und Namespace-IDs. Folgende Werte müssen
als Cloudflare-Secrets gesetzt werden und gehören niemals in Git:

- `APIFY_TOKEN`
- `KLAZ_API_KEY`
- `REBRICKABLE_API_KEY`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- optional `EBAY_VERIFICATION_TOKEN` und `EBAY_WEBHOOK_ENDPOINT`

Lokale Secret-Dateien wie `.dev.vars` und `.env` werden über `.gitignore`
ausgeschlossen.
