# Brickmerge Tweaker

Userscript-Erweiterung für den LEGO-Preisvergleich auf [Brickmerge.de](https://www.brickmerge.de/). Das Skript ergänzt Preis-, Markt- und Produktinformationen und optimiert die Detailseiten für Desktop und Mobilgeräte.

## Funktionen

### Persönliche Rabatte und Offerlist

- Dauerhafte Händlerrabatte, etwa für LEGO, Müller oder Thalia, zentral konfigurieren und ein- oder ausschalten.
- Effektivpreise direkt in der Offerlist anzeigen und bei aktivierter Funktion automatisch danach sortieren.
- Versandkosten aus den vorhandenen Angebotsdaten übernehmen und getrennt darstellen.
- Prozent-Bubbles anhand der UVP berechnen. Fehlt die UVP, dient der höchste verfügbare Angebotspreis als Referenz.
- Kürzlich ausverkaufte Angebote preislich einsortieren und eindeutig als **Sold out** kennzeichnen.
- Händler-Zwischenseiten nach Möglichkeit automatisch über den vorhandenen Weiterleitungsbutton überspringen.

### Zusätzliche Preise

Weitere Angebote werden passend zum Preis in die Offerlist eingefügt und farblich markiert:

- BrickLink: niedrigster aktueller Neupreis bei deutschen Händlern
- BrickOwl
- Keepa/Amazon, sofern kein reguläres Amazon-Angebot vorhanden ist
- MyBrickDepot-eBay, sofern kein anderes eBay-Angebot vorhanden ist
- Smyths Toys und Müller, wenn Brickbank einen aktuellen Preis liefert

Die zusätzlichen Abfragen werden zwischengespeichert, damit Seitenaufrufe schneller bleiben und externe Dienste nicht unnötig oft angesprochen werden.

### Preisentwicklung und Bestpreise

- Brickmerge-Bestpreis und Preisvorteile übersichtlicher darstellen.
- All-Time-Bestpreis aus den Seitendaten übernehmen und die Differenz zum aktuellen Preis anzeigen.
- Historische Preisangaben direkt mit der Preisentwicklung verlinken.
- Großes Preisverlaufsdiagramm als Vollbild-Overlay öffnen; standardmäßig werden die letzten 30 Tage angezeigt.
- Preisdiagramm, Zeitraumwahl und Detailtexte kompakter aufbereiten.

### Minifiguren

- Die Minifiguren-Zeile öffnet ein einheitliches, mobilfähiges Overlay.
- Figuren, Mengen und Bilder werden bevorzugt über Rebrickable geladen; BrickLink dient als Ergänzung und Fallback.
- Jede Figurenzeile führt direkt zur passenden BrickLink-Seite.
- Aktuelle BrickLink-Preise deutscher Händler werden je Figur angezeigt und zum Gesamtwert der enthaltenen Minifiguren addiert.
- Preisabfragen starten erst nach einem bewussten Klick auf das `€`-Symbol oder beim Öffnen des Overlays. Ergebnisse werden lokal zwischengespeichert.

### Quick Links und Suche

- Direkte Links zu Marktplätzen, Preisvergleichen, Ressourcen, Reviews und Verkaufshistorien.
- Meta-Preisvergleich und Meta-GPT gemeinsam in der Meta-Schaltfläche.
- Meta-GPT mit einem auf das aktuelle Set zugeschnittenen Suchauftrag öffnen und automatisch absenden.
- Fehlgeschlagene Brickmerge-Suchen über den besten extern gefundenen Brickmerge-Treffer weiterleiten.
- Setname mit einem Klick in die Zwischenablage kopieren.

### Produktseite und Layout

- Weitere Produktbilder direkt unter dem Hauptbild anzeigen und im vorhandenen Bildbetrachter öffnen.
- Einheitliche Hover-Effekte für Hauptbild und Galerie.
- Videos unterhalb der Bilder platzieren.
- Bauanleitungen, EAN-Barcode und Einzelteillisten sinnvoll in das Desktop-Raster einordnen.
- Offizielle LEGO-Produktbeschreibung über die volle Seitenbreite darstellen und den Zeilenabstand normalisieren.
- Artikelnummer mit LEGO, Designer einzeln mit passenden Suchergebnissen und OVP-Maße mit einem Paketpreisrechner verlinken.
- Störende Werbe-, Alarm-, Social-Media- und Doppelelemente entfernen.

## Installation

1. Eine Userscript-Erweiterung wie Tampermonkey oder Violentmonkey installieren.
2. [Brickmerge Tweaker installieren](https://github.com/ysamjo/bm-quick-extension/raw/main/brickmerge-tweaks.js).
3. Die angeforderten Verbindungsberechtigungen bestätigen. Sie werden für die zusätzlichen Preis- und Produktabfragen benötigt.

Aktualisierungen werden anschließend über die im Userscript hinterlegte GitHub-Adresse angeboten.

## Hinweise

- Preise und Verfügbarkeiten können sich zwischen Abfrage und Händlerseite ändern.
- Persönliche Rabatte werden ausschließlich lokal im Browser gespeichert.
- Externe Preis- und Produktdaten stammen unter anderem von BrickLink, BrickOwl, Rebrickable, Brickbank, Keepa und MyBrickDepot.
- Das Projekt ist eine private Erweiterung und steht in keiner Verbindung zu Brickmerge oder der LEGO Gruppe.
