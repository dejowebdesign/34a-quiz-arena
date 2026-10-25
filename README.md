# 34A Quiz Arena

Eine responsive Multiplayer-Quizshow zur Vorbereitung auf die Sachkundepruefung
nach § 34a GewO. Zwei Teams treten abwechselnd an, jedes mit eigener
Gewinnleiter, eigenem Gluecksrad und drei Jokern. Der Moderator fuehrt die Show
ueber Zoom, die Kandidaten erhalten die Fragen privat auf ihrem Geraet, das
Publikum sieht die Uebertragungsansicht.

> Hinweis: Die Quiz Arena dient der Pruefungsvorbereitung. Das spielinterne
> Leistungszertifikat ist kein amtlicher Nachweis der Sachkundepruefung und
> ersetzt nicht die Pruefung bei der zustaendigen IHK.

## Funktionsumfang

- Zwei Teams mit je 15 Stufen und eigenen Sicherheitsstufen (Standard 5 und 10)
- Rueckfall auf die letzte Sicherheitsstufe bei falscher oder fehlender Antwort
- Kein Ausscheiden; nach dem ersten Abschluss laeuft die Show fuer das zweite
  Team weiter
- Gluecksrad pro Team mit Rotation ohne Wiederholung innerhalb eines Durchgangs
- Drei Joker pro Team: KI, Publikum, 50:50, je einmal einsetzbar
- Countdown der letzten zehn Sekunden, ausdruecklich gestartet, synchron
  angezeigt, waehrend eines Jokers pausierbar
- Drei getrennte Ansichten: Moderation, Kandidat, Publikum
- Geschuetzte Fragenverwaltung mit Import, Freigabe und Pruefstatus fuer
  Rechtsangaben
- Leistungszertifikat bei Stufe 15 mit Pflichthinweis

## Technik

| Bereich | Technologie |
| --- | --- |
| Oberflaeche | React 18, TypeScript, Vite |
| Server | Node.js, TypeScript, Express |
| Echtzeit | Socket.IO |
| Datenbank | SQLite (better-sqlite3, WAL) |
| Bereitstellung | Docker, Docker Compose |
| Registry | GitHub Container Registry (GHCR) |

## Container-Image

Nach dem ersten Push auf `main` stehen die Images unter:

```
ghcr.io/dejowebdesign/34a-quiz-arena:latest
ghcr.io/dejowebdesign/34a-quiz-arena:sha-<commit>
```

Das Paket ist zunaechst privat. Fuer den Zugriff ohne Anmeldung muss es in den
GitHub-Paketeinstellungen auf oeffentlich gestellt werden. Andernfalls in
Portainer einen Registry-Eintrag mit `read:packages` hinterlegen. Siehe
[`docs/INSTALL.md`](docs/INSTALL.md), Abschnitt 4.

Die Veroeffentlichung laeuft ueber `.github/workflows/docker.yml`:

- Bei Pull Requests: Tests, Typecheck und Build. Kein Image wird
  veroeffentlicht.
- Bei Push auf `main`: derselbe Ablauf, und nur bei Erfolg wird das Image
  veroeffentlicht.

Verfuegbare Tags:

| Tag | Bedeutung |
| --- | --- |
| `latest` | Jeweils neuester Stand von `main` |
| `sha-<kurz>` | Kurzer Commit-Hash, zum Anheften an eine feste Fassung |
| `sha-<lang>` | Vollstaendiger Commit-Hash |

## Schnellstart

Das Image wird bei jedem Push auf `main` automatisch nach GitHub Container
Registry veroeffentlicht. Es muss nichts lokal gebaut werden.

```bash
cp .env.example .env
openssl rand -hex 32                                  # in SESSION_SECRET eintragen
node server/scripts/hash-password.mjs "DeinPasswort"  # in ADMIN_PASSWORD_HASH eintragen

# Standardbetrieb: ohne externes Docker-Netz
docker compose pull
docker compose up -d

# Nur wenn Zoraxy als Container ueber das Netz "web" angebunden wird:
docker network create web
docker compose -f docker-compose.yml -f docker-compose.zoraxy.yml up -d
```

Hinweis zum Hash: In `.env` muss der scrypt-Hash mit doppelten Dollarzeichen
stehen, sonst schneidet Compose ihn ab und die Anmeldung schlaegt fehl:

```bash
# Ausgabe des Skripts:  scrypt$16384$8$1$<salt>$<hash>
# In .env eintragen:    ADMIN_PASSWORD_HASH=scrypt$$16384$$8$$1$$<salt>$$<hash>
```

Im Portainer-Formular dagegen die einfachen Dollarzeichen verwenden. Details in
[`docs/INSTALL.md`](docs/INSTALL.md), Abschnitt 2.

Aufruf unter `http://<server>:3002`. Der Host-Port ist ueber `QUIZ_PORT`
konfigurierbar (Standard 3002); der Container-Port bleibt 3000.

Welche Datei gilt:

| Datei | Verwenden wenn |
| --- | --- |
| `docker-compose.yml` | Immer. Standardbetrieb, ohne externes Netz. Das ist die Datei fuer einen Portainer-Git-Stack |
| `docker-compose.zoraxy.yml` | Zusaetzlich, wenn Zoraxy als Container den Quiz-Container ueber das gemeinsame Netz `web` erreichen soll |

Beide Dateien laden `ghcr.io/dejowebdesign/34a-quiz-arena:latest` und bauen
nichts lokal. Einzelheiten in [`docs/INSTALL.md`](docs/INSTALL.md).

## Ansichten

| Adresse | Zweck |
| --- | --- |
| `#/` | Startseite und Systemstatus |
| `#/moderator` | Show anlegen, Gewinnleitern, Rad, Joker, Countdown, Freigabe |
| `#/join` | Kandidatenbeitritt mit Show-Code |
| `#/candidate` | Private Frage und verbindliche Antwortabgabe |
| `#/audience` | Uebertragungsansicht und Abstimmung beim Publikumsjoker |
| `#/admin` | Geschuetzte Fragenverwaltung |
| `#/certificate/<id>` | Aufrufbares Leistungszertifikat |

## Entwicklung

```bash
npm install
npm run build --workspace shared
npm run dev:server      # Port 3000
npm run dev:client      # Port 5173 mit Proxy auf 3000
```

## Tests und Pruefungen

```bash
npm test           # 100 Tests
npm run typecheck  # TypeScript in allen Workspaces
npm run build      # shared, Server und Client
```

Die Tests decken die Spielregeln (Aufstieg, Rueckfall, Sicherheitsstufen), die
Kandidatenrotation des Gluecksrads, den Jokerverbrauch, die Zeitsteuerung, die
Geheimhaltung der richtigen Antwort, die Zugangskontrolle und den vollstaendigen
Ablauf ueber Socket.IO inklusive Wiederverbindung ab.

## Dokumentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - Aufbau und Entscheidungen
- [`docs/INSTALL.md`](docs/INSTALL.md) - Docker, Portainer, HTTPS mit DuckDNS
  und Reverse Proxy, Fehlersuche
- [`examples/questions.sample.json`](examples/questions.sample.json) -
  Beispielfragen fuer den Import

## Sicherheit

- Rollen sind serverseitig getrennt. Kandidaten und Publikum treten nur mit
  signiertem Ticket bei, Moderation mit Passwort und Token.
- Die richtige Antwort verlaesst den Server erst bei der Freigabe.
- Zeitsteuerung und Punktestand liegen ausschliesslich auf dem Server.
- Doppelte Antworten und mehrfache Jokeraktivierung werden abgewiesen.
- Keine Geheimnisse im Repository; alles laeuft ueber Umgebungsvariablen.
- Der Container laeuft ohne root-Rechte.

## Lizenz

MIT
