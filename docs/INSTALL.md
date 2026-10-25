# Installation und Betrieb

Diese Anleitung beschreibt drei Wege: Docker Compose, Portainer und die
lokale Entwicklung. Am Ende steht die Konfiguration von HTTPS ueber einen
Reverse Proxy mit DuckDNS-Domain.

## 1. Voraussetzungen

- Docker 24 oder neuer, Docker Compose v2
- Optional: ein Reverse Proxy (Zoraxy, Traefik, Nginx Proxy Manager)
- Optional: eine DuckDNS-Domain mit gueltigem Let's-Encrypt-Zertifikat

## 2. Konfiguration vorbereiten

```bash
cp .env.example .env
```

In `.env` mindestens zwei Werte setzen:

```bash
# Zufaelliges Geheimnis
openssl rand -hex 32        # Ergebnis in SESSION_SECRET eintragen

# Moderatorenpasswort als scrypt-Hash erzeugen
node server/scripts/hash-password.mjs "DeinSicheresPasswort"
# Ergebnis in ADMIN_PASSWORD_HASH eintragen und ADMIN_PASSWORD entfernen
```

Optional den Host-Port aendern. Standard ist `3002`, weil auf dem Zielserver
`3000` und `3001` belegt sind:

```bash
QUIZ_PORT=3002
```

`SESSION_SECRET` signiert Sitzungs- und Join-Tickets. Ohne festen Wert werden
Verbindungen bei jedem Neustart ungueltig. `ADMIN_PASSWORD_HASH` ist der
empfohlene Weg; `ADMIN_PASSWORD` bleibt als einfacher Einstieg erhalten.

### Wichtig: Dollarzeichen im scrypt-Hash

Docker Compose ersetzt in `.env` jedes einfache `$` durch einen
Variablenverweis. Ein scrypt-Hash besteht aus mehreren durch `$` getrennten
Teilen. Beginnt ein Teil mit einem Buchstaben, wird er als Variablenname
gelesen und durch einen leeren Wert ersetzt. Der Hash wird dadurch still
abgeschnitten und die Anmeldung schlaegt fehl.

In `.env` deshalb jedes `$` verdoppeln:

```bash
# Hash erzeugen
node server/scripts/hash-password.mjs "DeinSicheresPasswort"
# Ausgabe, zum Beispiel:
#   scrypt$16384$8$1$<salt-hex>$<hash-hex>

# In .env so eintragen (jedes $ verdoppelt):
#   ADMIN_PASSWORD_HASH=scrypt$$16384$$8$$1$$<salt-hex>$$<hash-hex>
```

Schnellpruefung, dass der Wert vollstaendig ankommt:

```bash
docker compose exec quiz-arena \
  sh -c 'echo ${#ADMIN_PASSWORD_HASH}'
# Muss die volle Laenge des Hashes ausgeben, typisch 178.
```

Im Portainer-Formular unter *Environment variables* dagegen die **einfachen**
Dollarzeichen eintragen. Dort ersetzt Portainer nichts, der Wert kommt
unveraendert an.

## 3. Betrieb mit Docker Compose

Das Image wird nicht mehr lokal gebaut. Alle Compose-Dateien laden
`ghcr.io/dejowebdesign/34a-quiz-arena:latest` aus GitHub Container Registry.

### Wann welche Datei

| Datei | Verwenden wenn |
| --- | --- |
| `docker-compose.yml` | Immer. Das ist der Standard und funktioniert ohne externes Docker-Netz. Diese Datei verwendet ein Portainer-Git-Stack. |
| `docker-compose.zoraxy.yml` | Zusaetzlich zur Basisdatei, wenn Zoraxy als Container den Quiz-Container ueber das gemeinsame Docker-Netz `web` erreichen soll. Optional. |

### Ports

Der Host-Port ist ueber `QUIZ_PORT` konfigurierbar, Standard `3002`. Der
Container-Port bleibt immer `3000`. Auf dem Zielserver (Umbrel) sind `3000`
durch `dejo-kitchen-designer-backend-1` und `3001` durch FreeLLMAPI belegt.

| Umgebung | Wert |
| --- | --- |
| Container-Port (`PORT`) | `3000` (nicht aendern) |
| Host-Port (`QUIZ_PORT`) | `3002` (Standard) |

### Standardbetrieb ohne externes Netz

```bash
docker compose pull
docker compose up -d
```

Aufruf unter `http://<server-ip>:3002`.

### Optional: mit externem Proxy-Netz

Nur noetig, wenn Zoraxy als Container im Netz `web` laeuft.

```bash
docker network create web     # einmalig, falls noch nicht vorhanden
docker compose -f docker-compose.yml -f docker-compose.zoraxy.yml up -d
```

Ist der Proxy im selben Netz, erreicht er den Container unter
`quiz-arena:3000`. Der veroeffentlichte Host-Port `3002` kann dann entfallen,
muss aber nicht.

### Pruefen

```bash
docker compose ps
docker compose logs -f quiz-arena
curl http://127.0.0.1:3002/api/health
```

Die Antwort `{"status":"ok",...}` zeigt, dass der Dienst bereit ist.

### Aktualisieren

```bash
docker compose pull
docker compose up -d
```

Das Volume `quiz-data` wird dabei nicht angefasst; Fragen und Zertifikate
bleiben erhalten. Vor groesseren Updates trotzdem sichern, siehe Abschnitt 10.

## 4. Betrieb mit Portainer

Portainer soll das Image nur herunterladen und starten, nicht selbst bauen.
Dafuer ist in allen Compose-Dateien kein `build`-Abschnitt enthalten. Der
Standard `docker-compose.yml` braucht kein externes Netzwerk.

### 4.1 Paket oeffentlich stellen

Das GHCR-Paket ist nach dem ersten Push standardmaessig **privat**. Portainer
kann es dann nur mit hinterlegten Zugangsdaten ziehen. Fuer den Betrieb ohne
Anmeldung:

1. Auf GitHub das Profil oeffnen und zu *Packages* wechseln.
2. Das Paket `34a-quiz-arena` auswaehlen.
3. *Package settings* → *Change visibility* → *Public* bestaetigen.

Danach laesst sich das Image ohne Anmeldung ziehen. Pruefen mit:

```bash
docker pull ghcr.io/dejowebdesign/34a-quiz-arena:latest
```

Soll das Paket privat bleiben, in Portainer unter *Registries* einen Eintrag
fuer `ghcr.io` anlegen:

| Feld | Wert |
| --- | --- |
| Registry | `ghcr.io` |
| Username | GitHub-Benutzername |
| Password | Personal Access Token mit Berechtigung `read:packages` |

Diesen Registry-Eintrag dann im Stack auswaehlen.

### 4.2 Bestehenden Git-Stack aktualisieren

So wird der bereits vorhandene Stack `34a-quiz-arena` auf die korrigierte
Konfiguration gebracht. Der Stack verwaltet sich ueber ein Git-Repository, es
wird also nichts manuell kopiert.

1. In Portainer auf *Stacks* den Stack `34a-quiz-arena` oeffnen.
2. Die Repository-Einstellungen pruefen. Sie muessen so bleiben:

   | Feld | Wert |
   | --- | --- |
   | Repository URL | `https://github.com/dejowebdesign/34a-quiz-arena` |
   | Repository reference | `refs/heads/main` |
   | Compose path | `docker-compose.yml` |

3. Unter *Environment variables* die Werte eintragen oder pruefen. Die Datei
   liest sie ueber `${VAR:-...}`, es wird keine `.env` benoetigt:

   | Variable | Wert |
   | --- | --- |
   | `SESSION_SECRET` | Ergebnis von `openssl rand -hex 32` |
   | `ADMIN_PASSWORD_HASH` | Ergebnis von `hash-password.mjs`, hier mit **einfachen** `$` |
   | `ADMIN_USER` | z. B. `moderator` |
   | `NODE_ENV` | `production` |
   | `QUIZ_PORT` | `3002` (oder frei lassen, dann gilt der Standard) |
   | `COOKIE_SECURE` | `true`, sobald HTTPS aktiv ist; fuer den ersten Test ueber HTTP `false` |
   | `TRUST_PROXY` | `true` |

   Hinweis: Im Portainer-Formular die einfachen `$` des Hashes verwenden, zum
   Beispiel `scrypt$16384$8$1$...$...`. Nur in einer `.env`-Datei muessen die
   `$` verdoppelt werden, siehe Abschnitt 2.

4. **Deploy.** Auf *Update the stack* beziehungsweise *Pull and redeploy*
   klicken. Portainer klont den neuen Stand von `main`, zieht das Image und
   ersetzt den Container. Das Volume `quiz-data` bleibt erhalten.
5. **Pruefen.** Unter *Containers* muss `quiz-arena` den Status `healthy`
   zeigen. Danach im Browser `http://<UMBREL-IP>:3002` aufrufen.

Achtung: Die Felder *Repository reference* und *Compose path* muessen auf
`refs/heads/main` und `docker-compose.yml` zeigen. Nur diese Datei wird
verwendet; eine Aenderung an einer anderen Datei wirkt sich nicht aus.

### 4.3 Stack neu anlegen (Web editor)

Wenn kein Git-Stack verwendet wird, laesst sich der Inhalt der Datei direkt
einfuegen:

1. In Portainer auf *Stacks* → *Add stack*.
2. Unter *Build method* die Option **Web editor** waehlen, damit Portainer
   nichts klont und nichts baut.
3. Den Inhalt von `docker-compose.yml` einfuegen. Fuer den Betrieb mit dem
   externen Netz `web` zusaetzlich die Zeilen aus
   `docker-compose.zoraxy.yml` anhaengen und das Netz vorher anlegen.
4. Die Umgebungsvariablen wie in Abschnitt 4.2 setzen.
5. *Deploy the stack*. Portainer zieht das Image und startet den Container.
   Der Health-Status wird als `healthy` angezeigt.
6. **Aktualisieren.** Im Stack auf *Pull and redeploy* klicken. Alternativ
   *Recreate*. Portainer zieht das neue Image. Das Volume `quiz-data` bleibt
   erhalten.
7. **Sichern.** Volume `quiz-data` sichern; darin liegen Fragen und
   Zertifikate.

### 4.4 Feste Fassung statt latest

Statt `latest` kann ein Commit-Tag verwendet werden, damit ein Update nur
bewusst erfolgt:

```yaml
image: ghcr.io/dejowebdesign/34a-quiz-arena:sha-<commit>
```

Den passenden Tag zeigt die Paketseite auf GitHub.

## 5. HTTPS mit Reverse Proxy und DuckDNS

Diese Schritte sind optional. Sie sind erst noetig, wenn die Show ueber eine
oeffentliche Domain mit HTTPS erreichbar sein soll. Bis dahin laeuft die App
unter `http://<UMBREL-IP>:3002`.

### 5.1 DuckDNS einrichten

1. Auf duckdns.org anmelden und eine Subdomain anlegen, zum Beispiel
   `quiz-arena`.
2. Im Router oder per Update-URL die aktuelle oeffentliche IP melden:
   `https://www.duckdns.org/update?domains=quiz-arena&token=<TOKEN>&ip=`
3. Die Domain zeigt danach auf `quiz-arena.duckdns.org`.

### 5.2 Ports freigeben

Im Router nur 80 und 443 auf den Proxy weiterleiten. Port 3002 bleibt
geschlossen. Der Proxy erreicht den Container entweder ueber das Docker-Netz
oder ueber die Host-Adresse und Port 3002.

### 5.3 Variante A: Zoraxy als Container (Netz `web`)

Laeuft Zoraxy selbst als Container, den Quiz-Container mit der Override-Datei
ins gemeinsame Netz bringen:

```bash
docker network create web     # einmalig, falls noch nicht vorhanden
docker compose -f docker-compose.yml -f docker-compose.zoraxy.yml up -d
```

In Portainer: siehe Abschnitt 4.3, die Zeilen aus `docker-compose.zoraxy.yml`
ergaenzen.

Danach in Zoraxy:

1. Einen *HTTP Proxy* anlegen.
2. Als Ziel den Containernamen und Port eintragen: `quiz-arena:3000`.
   Zoraxy loest den Namen im gemeinsamen Docker-Netz `web` auf.
3. Als Hostname `quiz-arena.duckdns.org` eintragen.
4. Unter *TLS/SSL* ein Let's-Encrypt-Zertifikat fuer die Domain anfordern.
   Zoraxy nutzt dazu die HTTP-01-Challenge ueber Port 80.
5. *Force HTTPS* aktivieren, damit HTTP-Anfragen umgeleitet werden.
6. WebSocket-Unterstuetzung einschalten. Socket.IO nutzt den Pfad
   `/socket.io/`; Zoraxy leitet WebSocket-Verbindungen standardmaessig weiter.
   Pruefen, dass die Kopfzeilen `Upgrade` und `Connection` unveraendert
   durchgereicht werden.

### 5.4 Variante B: Proxy ausserhalb von Docker

Laeuft der Proxy nicht als Container (oder soll den Host-Port nutzen), als
Ziel die Host-Adresse mit Port `3002` verwenden, zum Beispiel
`http://192.168.1.50:3002`. Dann ist kein gemeinsames Docker-Netz noetig, und
`docker-compose.yml` allein genuegt.

### 5.5 Nginx als Alternative

```nginx
server {
    listen 80;
    server_name quiz-arena.duckdns.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name quiz-arena.duckdns.org;

    ssl_certificate     /etc/letsencrypt/live/quiz-arena.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/quiz-arena.duckdns.org/privkey.pem;

    location / {
        # Im gemeinsamen Docker-Netz: quiz-arena:3000.
        # Ausserhalb von Docker: die Host-Adresse mit Port 3002.
        proxy_pass http://quiz-arena:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

Der lange `proxy_read_timeout` verhindert, dass WebSocket-Verbindungen
waehrend einer laufenden Show abgebaut werden.

### 5.6 Nach dem Umstieg auf HTTPS

In `.env` beziehungsweise den Portainer-Variablen setzen:

```bash
COOKIE_SECURE=true
TRUST_PROXY=true
# Optional, wenn der Ursprung eingeschraenkt werden soll:
ALLOWED_ORIGINS=https://quiz-arena.duckdns.org
```

Danach den Stack neu starten.

## 6. Lokale Entwicklung

```bash
npm install
npm run build --workspace shared

# Terminal 1: Server auf Port 3000
npm run dev:server

# Terminal 2: Vite auf Port 5173 mit Proxy auf 3000
npm run dev:client
```

Aufruf unter `http://localhost:5173`.

## 7. Tests und Builds

```bash
npm test           # 100 Tests fuer Spielregeln, Geheimhaltung, Auth, Realtime
npm run typecheck  # TypeScript-Pruefung aller Workspaces
npm run build      # shared, Server und Client bauen
```

## 7a. Image-Veroeffentlichung (GHCR)

Der Workflow `.github/workflows/docker.yml` steuert Pruefung und
Veroeffentlichung.

| Ausloeser | Ablauf |
| --- | --- |
| Pull Request nach `main` | `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, danach Image-Bau ohne Veroeffentlichung |
| Push auf `main` | Derselbe Ablauf. Nur bei Erfolg wird das Image nach GHCR veroeffentlicht |
| Manuell | *Actions* → *Docker* → *Run workflow* |

Die Veroeffentlichung nutzt `GITHUB_TOKEN` mit den Rechten `contents: read` und
`packages: write`. Es sind keine eigenen Geheimnisse noetig.

Vergebene Tags:

| Tag | Herkunft |
| --- | --- |
| `latest` | Nur auf dem Standardbranch `main` |
| `sha-<kurz>` | Kurzer Commit-Hash |
| `sha-<lang>` | Vollstaendiger Commit-Hash |

Ein neues Image ziehen und den Container neu bereitstellen:

```bash
# Mit Compose
docker compose pull && docker compose up -d

# Mit Zoraxy-Override
docker compose -f docker-compose.yml -f docker-compose.zoraxy.yml pull
docker compose -f docker-compose.yml -f docker-compose.zoraxy.yml up -d

# In Portainer
# Stack oeffnen -> Pull and redeploy
```

Das Volume `quiz-data` bleibt dabei unveraendert.

Fehlt das Paket unter *Packages* oder schlaegt der Pull mit
`denied`/`unauthorized` fehl, ist es noch privat. Dann entweder oeffentlich
stellen (Abschnitt 4.1) oder in Portainer einen Registry-Eintrag mit
`read:packages` hinterlegen.

## 8. Fragenverwaltung

1. Unter `#/admin` mit dem Moderatorenzugang anmelden.
2. Fragen einzeln anlegen oder als JSON importieren
   (Beispiel: `examples/questions.sample.json`).
3. Rechtsangaben mit Rechtsgrundlage und Quelle versehen. Ohne Quelle wird der
   Rechtsstatus automatisch auf „Pruefung erforderlich“ gesetzt.
4. Fragen freigeben. Nur freigegebene Fragen koennen im Spiel gestartet werden.

## 9. Betrieb einer Show

1. Moderation: unter `#/moderator` anmelden und eine Show anlegen.
2. Selbstbeitritt freigeben und den Show-Code an die Kandidaten geben.
3. Publikum: `#/audience` aufrufen und den Show-Code eingeben.
4. Pro Durchgang: Rad drehen, Frage starten, bei Bedarf Joker einsetzen,
   letzten zehn Sekunden starten, Antwort freigeben, Team wechseln.

## 10. Datensicherung

```bash
# Datenbank aus dem Volume sichern
docker run --rm -v quiz-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/quiz-arena-$(date +%F).tar.gz -C /data .
```

Wiederherstellen entsprechend in umgekehrter Richtung, waehrend der Container
gestoppt ist.

## 11. Fehlersuche

| Symptom | Ursache | Loesung |
| --- | --- | --- |
| `network web declared as external, but could not be found` | Externes Netz fehlt | `docker-compose.yml` allein verwenden, oder `docker network create web` und die Override-Datei `docker-compose.zoraxy.yml` ergaenzen, Abschnitt 5.3 |
| `Bind for 0.0.0.0:3002 failed: port is already allocated` | Host-Port 3002 belegt | Anderen freien Port setzen: `QUIZ_PORT` in Portainer oder `.env` aendern |
| `Bind for 0.0.0.0:3000 failed: port is already allocated` | Alter Stand mit festem Port 3000 | Compose-Datei auf den neuen Stand bringen (Host-Port 3002 ueber `QUIZ_PORT`), Abschnitt 3 |
| `pull access denied` beim Image | GHCR-Paket noch privat | Paket oeffentlich stellen oder Registry-Zugang in Portainer hinterlegen, Abschnitt 4.1 |
| `manifest unknown` beim Pull | Tag existiert nicht | Auf der Paketseite verfuegbare Tags pruefen; `latest` entsteht erst nach einem Push auf `main` |
| Container startet mit altem Stand | `pull` vergessen | `docker compose pull && docker compose up -d` |
| `/api/health` antwortet nicht | Container laeuft nicht | `docker compose logs quiz-arena` pruefen |
| Anmeldung schlaegt fehl | `ADMIN_PASSWORD_HASH` passt nicht | Hash neu erzeugen und Stack neu starten |
| Anmeldung schlaegt fehl trotz richtigem Passwort | In `.env` wurde der Hash mit einfachen `$` geschrieben, Compose hat ihn abgeschnitten | In `.env` jedes `$` verdoppeln, siehe Abschnitt 2; mit `${#ADMIN_PASSWORD_HASH}` die Laenge pruefen |
| Hash-Laenge im Container zu kurz | `$` in `.env` nicht verdoppelt | siehe Abschnitt 2, Wert auf `scrypt$$16384$$8$$1$$...` aendern |
| Verbindung bricht ab | Proxy reicht WebSocket nicht durch | Upgrade-Kopfzeilen und Pfad `/socket.io/` pruefen |
| Tickets nach Neustart ungueltig | `SESSION_SECRET` wechselt | festen Wert in `.env` setzen |
| Kandidat kann nicht beitreten | Selbstbeitritt gesperrt | in der Moderation freigeben |
| Keine Frage startbar | keine freigegebene Frage | im Admin-Bereich freigeben |
