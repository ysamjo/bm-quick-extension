# Brickmerge Android

Native Android-Hülle für die echte Brickmerge-Webseite. Der WebView lädt bei
jeder Brickmerge-Seite automatisch die gemeinsam mit Extension und Userscript
gebaute Runtime. Dadurch bleiben Offerlist, persönliche Rabatte, Marktplätze,
Preisvergleiche, Ressourcen und die übrigen Layout-Anpassungen identisch.

## Eingaben

- Die Suchleiste in der App akzeptiert Setnummern, EANs und Suchbegriffe.
- Das Homescreen-Widget öffnet ein fokussiertes Suchfenster.
- Über **Teilen → Brickmerge** können Text und Produkt-URLs übergeben werden.
- **Text auswählen → Brickmerge** übernimmt markierte Wörter oder Ziffern.
- Deep Links verwenden `brickmerge://search?q=42154`.

Bei einer URL sucht die App zuerst direkt im Link und danach im Seitentitel
beziehungsweise in strukturierten Produktdaten nach Setnummer oder EAN. Externe
Shop- und Ressourcenlinks werden im Standardbrowser geöffnet.

## Build

```sh
cd android-app
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Vor jedem Build kopiert Gradle automatisch die aktuelle Datei
`../brickmerge-tweaks.runtime.js` in die ignorierten lokalen App-Assets. Das Debug-APK
liegt anschließend unter `app/build/outputs/apk/debug/app-debug.apk`.

Ein erfolgreicher Build prüft noch nicht WebView, Teilen-Menü und Widget auf
einem echten Gerät. Diese drei Wege sollten nach der Installation auf dem Pixel
jeweils einmal ausgeführt werden.
