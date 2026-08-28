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
Von BrickLink als Nettobetrag mit vier Nachkommastellen gelieferte EU-Händlerpreise
werden für deutsche Endkunden inklusive 19 % MwSt. normalisiert.

`/offers/dismissals` speichert verworfene Angebots-IDs je anonymer Client-ID und
LEGO-Set für 180 Tage in KV. GET synchronisiert die gespeicherten IDs, POST setzt,
entfernt oder löscht sie. Konkrete Angebotsdaten und API-Schlüssel werden dabei
nicht gespeichert.

Vinted und Leboncoin werden über getrennte Apify-Actors abgefragt. Dafür muss
das Worker-Secret `APIFY_TOKEN` gesetzt sein. Pro Lauf werden höchstens acht
Vinted- beziehungsweise zehn Leboncoin-Treffer verarbeitet. Unvollständige Sets,
Zubehör, Minifiguren-Angebote und verdächtig niedrige Treffer werden entfernt;
der Gesamtpreis berücksichtigt die vom Actor gelieferten Versand- und Gebührenwerte.

Alle Apify-Routen starten ausschließlich asynchron. Die Extension verfolgt den
zurückgegebenen Status-Endpunkt; einzelne Worker-Anfragen bleiben deshalb nicht
während eines langen Actor-Laufs geöffnet.

Google Shopping wird auf Set-Detailseiten direkt über SerpApi geladen. Der
Worker verwendet dafür das Secret `SERPAPI_API_KEY`, fragt deutsche
Google-Shopping-Ergebnisse ab und speichert positive Treffer zwei Stunden im
gemeinsamen Cache. In die Offerlist gelangt nur der günstigste passende Treffer.

`/ebay-minifig?itemNo=...` liefert den günstigsten passenden eBay-Sofort-Kaufen-
Treffer für eine BrickLink-Minifiguren-ID. Wie `/price` wird die Route intern an
`ebay-price-api` delegiert. OAuth, Secrets, eBay-Cache und Rate-Limits bleiben
damit vollständig im eBay-Worker gekapselt.

## eBay-Entwürfe aus Google Sheets

Der bestehende eBay-Worker stellt zusätzlich `POST /v1/preview` und
`POST /v1/drafts` bereit. Beide Routen verwenden dieselbe Browse-API- und
Titelnormalisierung wie `/price`, filtern aber zusätzlich auf gewerbliche
Verkäufer. `/v1/drafts` legt bei aktivierter Schreibfreigabe ein Inventory-Item
und ein unveröffentlichtes Fixed-Price-Angebot an; es gibt keinen Publish-Aufruf.

Benötigte Secrets/Variablen: `DRAFT_API_TOKEN`, `EBAY_REFRESH_TOKEN`,
`EBAY_CATEGORY_ID`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`,
`EBAY_RETURN_POLICY_ID`, `EBAY_MERCHANT_LOCATION_KEY`,
`EBAY_FEE_PERCENT`, `EBAY_FEE_FIXED_EUR`, `ACTUAL_SHIPPING_COST_EUR`,
`PACKAGING_COST_EUR`, `MIN_PROFIT_EUR` und bei aktivem Schreiben
`EBAY_REGULATORY_JSON`. Die eBay-Refresh-Token-Scopes müssen Inventory- und
Account-Zugriff abdecken. `LEGO_IMAGES_ENABLED=true` aktiviert die LEGO.de-
Bildquelle; die Bildrechte müssen vor einer Veröffentlichung geprüft werden.

## Gemeinsamer Angebots-Cache

- `/offers/cache?set=...&ean=...` liest eBay Deutschland, eBay Frankreich, Kleinanzeigen, Vinted,
  Leboncoin, StockX, Idealo und BrickLink ausschließlich aus Edge/KV. Ein Cache-Fehlschlag startet
  keinen externen oder kostenpflichtigen Abruf.
- `/offers/refresh?set=...&ean=...` aktualisiert die gewählten Quellen. Apify-
  Abfragen laufen asynchron und bleiben je Lauf auf maximal 0,05 USD begrenzt.
- Der direkte Kleinanzeigen-Abruf und automatische Seitenaufrufe verwenden nur
  die Kleinanzeigen-Agent-API. Erst `/offers/refresh` darf bei Fehlern oder null
  Treffern ausdrücklich den Apify-Actor als Backup starten. Die Apify-Rohdaten
  werden dabei pro Set und unabhängig vom schwankenden Brickmerge-Bestpreis
  zwischengespeichert.
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
- `SERPAPI_API_KEY`
- `KLAZ_API_KEY`
- `REBRICKABLE_API_KEY`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_OAUTH_ENCRYPTION_KEY` (zufälliger 32-Byte-Schlüssel in Base64)
- optional `EBAY_VERIFICATION_TOKEN` und `EBAY_WEBHOOK_ENDPOINT`

Der einmalige eBay-OAuth-Verbindungsweg startet unter `/oauth/start`. Nach der
Zustimmung speichert der Callback den Refresh-Token verschlüsselt im gebundenen
KV-Namespace `EBAY_OAUTH_STORE`; Tokenwerte werden nie im Browser ausgegeben.

Lokale Secret-Dateien wie `.dev.vars` und `.env` werden über `.gitignore`
ausgeschlossen.
