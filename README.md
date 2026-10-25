# Reifen Einlagerung für Android

Eigenständige Tablet-App: PDF oder CSV einlesen, Spalten den Feldern zuordnen, auf dem Gerät speichern
und daraus druckfertige QR-Etiketten erzeugen. Die App braucht kein Internet und keine KI.

## APK bauen und installieren (einmalig, ca. 15 Minuten)

1. Auf github.com anmelden und ein **neues, privates Repository** anlegen (zum Beispiel `reifen-einlagerung`).
   Privat lassen, denn im Projekt liegt der Signaturschlüssel für Ihre App.
2. Im neuen Repository auf **„uploading an existing file“** klicken und **alle** Dateien und Ordner aus diesem
   ZIP hineinziehen, auch den versteckten Ordner `.github`.
   - Windows: im Explorer unter „Anzeigen“ die „Ausgeblendeten Elemente“ einschalten.
   - Mac: im Finder Umschalt + Cmd + Punkt drücken.
   Danach unten auf **„Commit changes“** klicken.
3. Oben auf den Reiter **„Actions“** wechseln. Der Lauf **„APK bauen“** startet von selbst (falls nicht:
   links „APK bauen“ wählen, dann „Run workflow“). Er dauert etwa 5 bis 10 Minuten.
4. Wenn der Lauf ein grünes Häkchen hat, ihn öffnen und unten bei **„Artifacts“** `Reifen-Einlagerung-APK`
   herunterladen. Das ist ein ZIP mit der Datei `app-debug.apk`.
5. Die Datei auf das Tablet übertragen (zum Beispiel per Google Drive oder E-Mail), entpacken und öffnen.
   Android fragt einmalig, ob die Installation aus dieser Quelle erlaubt sein soll. Das bestätigen Sie.

## Gut zu wissen

- Alle Daten liegen nur auf dem Tablet. Speichern Sie regelmäßig eine **Sicherung** (Reiter „Datenbank“).
  Beim Deinstallieren der App werden die Daten gelöscht.
- Aktualisierungen: neue Dateien ins Repository hochladen, APK neu laden und über die alte installieren.
  Die Daten bleiben erhalten, weil jede Version mit demselben Schlüssel (`signing/debug.keystore`) signiert wird.
- Gescannte PDFs ohne Text lassen sich ohne KI nicht auslesen. Texte aus normalen PDFs und CSV-Dateien funktionieren.
- Scannen: Im Reiter „Scannen“ liest die Kamera die QR-Codes und gleicht sie mit der Datenbank ab. Beim ersten
  Start fragt Android nach der Kamera-Erlaubnis. Ohne Erlaubnis geht es über „Foto aufnehmen“.
- Drucken: Im Reiter „QR-Etiketten“ auf „Etiketten drucken“ tippen. Im Android-Druckdialog lässt sich auch
  „Als PDF speichern“ wählen.
