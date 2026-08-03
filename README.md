# bm-quick-extension

Erweiterung für den LEGO-Preisvergleich von Brickmerge.de

🧹 1. Cleaner:
Das Skript entfernt störende, werbliche oder überflüssige Elemente.

💶 2. Persönliche Rabatte: Hier lassen sich dauerhafte Prozentrabatte für bestimmte Händler (z. B. Mitarbeiterrabatte oder Gutscheine für LEGO, Müller, Thalia) hinterlegen. Das Skript berechnet automatisch den finalen Preis abzüglich des eigenen Rabatts und inklusive der Versandkosten.
Die Preisliste wird live neu sortiert – basierend auf dem echten Effektivpreis.

📊 3. Erweiterte Rabatt- und Bestpreis-Analyse: Das Skript vergleicht das aktuell günstigste Angebot mit dem zweitgünstigsten und zeigt den konkreten prozentualen Preisvorteil in einer schwarzen Blase neben dem Preis an.

All-Time-Bestpreis-Tracking (ATB): Sucht den historischen Bestpreis aus den Seitendaten und fügt direkt unter dem Top-Angebot eine farbige Differenzanzeige ein.

🔗 4. Quick-Links:
Fügt unter der Preisliste einen scrollbaren Bereich mit Direktlinks für das jeweilige LEGO-Set ein, unterteilt in Kategorien.

🛠️ 5. Zusätzliche Marktplatz-Preise: Das Skript fragt im Hintergrund weitere Marktpreise von Amazon, Smyths Toys, Kleinanzeigen, Brickowl und Bricklink ab und fügt diese nahtlos als neue Zeilen in die Brickmerge-Preisliste ein. Bei Kleinanzeigen wird deutschlandweit nach dem günstigsten passenden LEGO-Set in neuem und originalverpacktem Zustand gesucht.

🧍 6. Minifiguren-Overlay: Macht das Wort „Minifiguren“ in den Texten anklickbar. Ein Klick öffnet ein Overlay, das in Echtzeit die genaue Liste der im Set enthaltenen Minifiguren (inklusive Bildern und Preisen) direkt von Rebrickable und Bricklink lädt.

🤖 7. Meta-GPT Anbindung:
KI-Preisvergleich: Ein Klick auf den "Meta-GPT"-Link generiert einen Such-Prompt für das Set, kopiert diesen in die Zwischenablage und öffnet einen speziellen ChatGPT-Bot, der auf Preisvergleiche spezialisiert ist.

📋 8. 1-Klick-Kopieren: Fügt neben der großen Set-Überschrift ein Copy-Icon ein, um den sauberen Namen des LEGO-Sets mit einem Klick in die Zwischenablage zu kopieren.

📦 9. Ein Klick auf die Maße öffnet den Paketpreisvergleich von Paketda.de.

ᯓ➤ 10. Brickmerge-Suchen ohne Ergebnis werden per DuckDuckGo-Lucky direkt zum bestmöglichsten Treffer weitergeleitet.

# Installation
* Eine Userscript-Erweiterung wie Tampermonkey oder Violentmonkey installieren.
* Brickmerge Tweaker installieren.
* Die angeforderten Verbindungsberechtigungen bestätigen. Sie werden für die zusätzlichen Preis- und Produktabfragen benötigt.
Aktualisierungen werden anschließend über die im Userscript hinterlegte GitHub-Adresse angeboten.

## Kleinanzeigen über den Preis-Worker
* Der Kleinanzeigen-Agent API-Key liegt ausschließlich als Cloudflare-Secret im Preis-Worker.
* In Tampermonkey beim „Brickmerge Tweaker“ den Menüpunkt „Brickmerge Worker-Zugriffstoken einrichten“ öffnen.
* Dasselbe Token eingeben, das im Worker als `BM_WORKER_TOKEN` gespeichert ist, und die Brickmerge-Seite neu laden.

Das Zugriffstoken wird nur lokal im Userscript-Speicher abgelegt und nicht in dieses Repository geschrieben. Der Tweaker speichert Worker-Antworten 45 Minuten lokal; der Worker hält erfolgreiche Kleinanzeigen-Ergebnisse zwei Stunden und leere Ergebnisse 20 Minuten im Cache.

# Hinweise
Preise und Verfügbarkeiten können sich zwischen Abfrage und Händlerseite ändern.
Persönliche Rabatte werden ausschließlich lokal im Browser gespeichert.
Externe Preis- und Produktdaten stammen unter anderem von BrickLink, BrickOwl, Rebrickable, Brickbank, Keepa und Kleinanzeigen Agent.
Das Projekt ist eine private Erweiterung und steht in keiner Verbindung zu Brickmerge oder der LEGO Gruppe.
