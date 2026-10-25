# AGENTS.md - Arbeitshinweise fuer dieses Repository

## Projekt

34A Quiz Arena: Monorepo (npm workspaces) mit `shared`, `server`, `client`.
Der Server ist die einzige Autoritaet fuer Spielregeln, Zeit und Geheimhaltung.

## Befehle

```bash
npm install                      # alle Workspaces
npm run build --workspace shared # zuerst bauen, Server/Client haengen davon ab
npm test                         # Vitest, 100 Tests (server/tests)
npm run typecheck                # TypeScript alle Workspaces
npm run build                    # shared -> server -> client
```

Reihenfolge beachten: `shared` muss vor `server` und `client` gebaut sein,
sonst findet TypeScript die Typen aus `@quiz/shared` nicht.

## Konventionen

- Sprache im Code und in Kommentaren: ASCII, keine Umlaute in Bezeichnern.
  Umlaute in sichtbaren Texten sind erlaubt, dann als HTML-Entitaet oder
  direkt im String.
- ESM ueberall (`"type": "module"`), Imports mit `.js`-Endung im Server.
- Keine Geheimnisse im Repository. Konfiguration ausschliesslich ueber
  Umgebungsvariablen (siehe `.env.example`).
- Neue Spielregeln immer in `server/src/engine/game.ts` durchsetzen und in
  `server/tests/` absichern.

## Kritische Invarianten

Diese Regeln duerfen nicht verletzt werden:

1. Die richtige Antwort (`correctIndex`) darf nur in `moderatorView` und im
   `reveal` nach der Freigabe erscheinen. Projektionen liegen ausschliesslich in
   `server/src/engine/projections.ts`.
2. Punktestand, Zeitsteuerung und Phasen werden nur serverseitig geaendert.
3. Joker sind pro Team einmal einsetzbar und werden dauerhaft verbraucht.
4. Das Gluecksrad zieht innerhalb eines Durchgangs jeden Spieler genau einmal.
5. Rechtsangaben ohne Quelle gelten als ungeprueft (`needs_review`).

## Tests

`server/tests/` enthaelt die Testsuite. `helpers.ts` bietet `FakeClock` fuer
Zeittests und `drawnPlayer()` fuer den aktuell gezogenen Kandidaten. Beim
Schreiben von Tests beachten: das Rad wird vor der Frage gedreht, waehrend
einer laufenden Frage ist es gesperrt.

## Umgebung

Node 22 oder neuer. Docker fuer den Containerbau. Tests laufen mit
In-Memory-SQLite (`DB_PATH=:memory:`) und benoetigen keine externe Datenbank.
