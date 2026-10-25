# Architektur - 34A Quiz Arena

## 1. Ueberblick

Die Anwendung ist ein Monorepo mit drei Workspaces. Der Server ist die einzige
Autoritaet fuer Spielregeln, Zeitsteuerung und Geheimhaltung. Clients senden
ausschliesslich Absichten und erhalten rollenabhaengige Sichten.

```
quiz-arena-34a/
├── shared/    Typen, Konstanten, reine Spiellogik (Leiter, Gluecksrad), Protokoll
├── server/    Express + Socket.IO + SQLite; GameEngine, Projektionen, Repos
├── client/    React + TypeScript; Moderator-, Kandidaten-, Publikumsansicht
├── docs/      Diese Dokumentation
└── examples/  Beispielfragen fuer den Import
```

## 2. Schichten

| Schicht | Ort | Verantwortung |
| --- | --- | --- |
| Reine Logik | `shared/src/ladder.ts`, `shared/src/wheel.ts` | Gewinnleiter, Sicherheitsstufen, Kandidatenrotation. Ohne Seiteneffekte, direkt testbar. |
| Spielzustand | `server/src/engine/game.ts` | Phasen, Antworten, Joker, Countdown, Punkte, Zertifikate. Setzt alle Regeln durch. |
| Projektionen | `server/src/engine/projections.ts` | Erzeugt Moderator-, Kandidaten- und Publikumssicht. Einzige Stelle, die die richtige Antwort herausgibt. |
| Realtime | `server/src/realtime/socket.ts` | Socket.IO-Ereignisse, Rollenpruefung, Verteilung der Sichten. |
| HTTP | `server/src/http/routes.ts` | Auth, Fragenverwaltung, oeffentliche Lobby, Zertifikate. |
| Persistenz | `server/src/db/` | SQLite-Schema, Fragen- und Zertifikatsrepository. |

## 3. Warum der Server alles entscheidet

Der Client hat keine Moeglichkeit, Punktestand, Zeit oder Geheimnis zu
beeinflussen:

- Der Punktestand existiert nur im `GameState` des Servers.
- `submitAnswer` prueft Phase, Zugehoerigkeit, Ziehung, Zeitfenster und
  doppelte Antworten. Es gibt keinen Weg daran vorbei.
- Der Countdown speichert `endsAt` als absolute Serverzeit. `isAnswerable()`
  vergleicht zusaetzlich gegen die aktuelle Uhrzeit, damit ein abgelaufener
  Countdown auch dann blockiert, wenn der Timer-Callback ausbleibt.
- `correctIndex` erscheint ausschliesslich in der Moderatorensicht und in
  `reveal` nach der Freigabe.

## 4. Rollen und Beitritt

| Rolle | Beitritt | Berechtigung |
| --- | --- | --- |
| Moderator | Passwort (`/api/auth/moderator`) → signiertes Token | Alle Spielaktionen, Fragenverwaltung |
| Kandidat | Signierter Einladungspass (`#/c/<pass>`) → Name und Team → signiertes Ticket | Antwort abgeben |
| Publikum | Signierter Einladungspass (`#/a/<pass>`) → Geraeteticket | Beim Publikumsjoker abstimmen |

Der **regulaere** Weg fuehrt ueber Einladungslinks; ein Show-Code ist dafuer
nicht noetig. Der Code-Weg (`#/join`) bleibt als Ersatz erhalten und unterliegt
weiterhin dem Schalter `openJoin`.

Einladungspasse sind HMAC-signierte, zustandslose Token mit dem Zusatzfeld
`kind` (`candidate` oder `audience`) und der `inviteVersion` der Show. Sie
enthalten weder Moderatorenrechte noch die richtige Antwort. `verifyInvite`
prueft Signatur, Rolle, Show und Version; **Links erneuern** erhoeht die
`inviteVersion` und macht damit alle bisherigen Passe sofort ungueltig, ohne
dass ein neues Datenmodell noetig ist. Ein Publikumspass kann keinen
Kandidatenbeitritt erzeugen und umgekehrt, weil `kind` mitgeprueft wird.

Tickets sind HMAC-signierte, zustandslose Token (`server/src/crypto.ts`). Die
Signatur deckt die Nutzlast ab, daher ist eine Rollenerhoehung durch Aenderung
der Nutzlast nicht moeglich. Das ist in `tests/auth.test.ts` abgesichert.

## 4a. Spielstart und Mindestanzahl

`GameEngine.startGame()` verlangt mindestens `MIN_APPROVED_QUESTIONS` (15)
freigegebene Fragen. Die Zahl stammt aus dem Fragenkatalog
(`QuestionRepository.countApproved`) und wird zur Laufzeit abgefragt, damit
Aenderungen an der Freigabe sofort greifen. Vor dem Start liefert
`startQuestion` einen Fehler, und Kandidaten- und Publikumssicht enthalten keine
Frage. Damit kann kein Team ohne ausreichenden Fragenkatalog starten.

## 5. Spielablauf

```
idle ──(Rad drehen)──► idle
idle ──(Frage starten)──► question ──(Joker)──► joker ──(Joker beenden)──► question
question/joker ──(Freigabe)──► revealed ──(Team wechseln)──► idle
```

- Eine richtige Antwort erhoeht die Stufe um eins; Stufe 15 bedeutet bestanden.
- Eine falsche oder unbeantwortete Frage setzt auf die letzte Sicherheitsstufe
  zurueck. Kein Team scheidet aus.
- Nach dem ersten Abschluss kann die Moderation weiterlaufen lassen, damit das
  zweite Team abschliessen kann.

## 6. Gluecksrad

`WheelState` fuehrt zwei Mengen: `remaining` (noch ziehbar) und `drawn` (in
diesem Durchgang gezogen). Bereits gezogene Spieler sind damit voruebergehend
aus dem Rad entfernt und werden bei der Synchronisierung nicht faelschlich
wieder aufgenommen. Erst wenn alle Spieler gezogen sind, wird genau dieses Rad
neu aufgefuellt. Die Rotation ist unabhaengig vom Leiterfortschritt.

## 7. Datenhaltung

- SQLite mit WAL-Modus, Datei unter `/app/data/quiz-arena.db` im Container.
- Der laufende Spielzustand liegt im Speicher. Fragen und ausgestellte
  Zertifikate sind persistent und ueberleben einen Neustart.
- Fragen durchlaufen die Status `draft → review → approved → archived`. Nur
  freigegebene Fragen koennen gestartet werden.

## 8. Sicherheit

- Keine Geheimnisse im Repository; Konfiguration ausschliesslich ueber
  Umgebungsvariablen.
- Passwoerter werden mit scrypt gehasht; der Hash steht in
  `ADMIN_PASSWORD_HASH`, nie das Klartextpasswort.
- `helmet` setzt Sicherheitsheader. Der Login ist ratenbegrenzt.
- Der Ersatzweg ueber Show-Code ist standardmaessig gesperrt und wird von der
  Moderation freigegeben. Der regulaere Weg ueber Einladungslinks ist davon
  unabhaengig und jederzeit widerrufbar.
- Einladungspasse sind rollengebunden (`kind`), versionsgebunden und
  signiert; manipulierte Passe erzeugen keine Berechtigung.
- Der Container laeuft als Benutzer `quiz` ohne root-Rechte.

## 9. Testabdeckung

Die Tests liegen in `server/tests/` und pruefen unter anderem:

- Aufstieg, Rueckfall und Sicherheitsstufen (`ladder.test.ts`)
- Kandidatenrotation des Gluecksrads (`wheel.test.ts`)
- Spielregeln, doppelte Antworten, Teamwechsel (`game.test.ts`)
- Jokerverbrauch, 50:50, Publikumsjoker (`jokers.test.ts`)
- Countdown, Pause und Manipulationsschutz (`countdown.test.ts`)
- Geheimhaltung der richtigen Antwort (`secrecy.test.ts`)
- Schutz des KI-Jokers vor Preisgabe (`hints.test.ts`)
- Auth, Hashes und signierte Tickets (`auth.test.ts`)
- HTTP-API (`http.test.ts`)
- End-to-End ueber Socket.IO inklusive Wiederverbindung (`realtime.test.ts`)
- Einladungslinks, Rollentrennung, 15-Fragen-Grenze und Mehrfachabstimmung
  (`invites.test.ts`)
