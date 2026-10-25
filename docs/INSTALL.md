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

`SESSION_SECRET` signiert Sitzungs- und Join-Tickets. Ohne festen Wert werden
Verbindungen bei jedem Neustart ungueltig. `ADMIN_PASSWORD_HASH` ist der
empfohlene Weg; `ADMIN_PASSWORD` bleibt als einfacher Einstieg erhalten.

## 3. Betrieb mit Docker Compose

### Variante A: mit externem Proxy-Netz

```bash
docker network create web
docker compose up -d --build
```

Der Dienst verbindet sich mit dem Netz `web`, in dem auch der Reverse Proxy
laeuft. Der veroeffentlichte Port `3000` kann dann entfernt werden.

### Variante B: ohne externes Netz

```bash
docker compose -f docker-compose.standalone.yml up -d --build
```

Aufruf unter `http://<server-ip>:3000`.

### Pruefen

```bash
docker compose ps
docker compose logs -f quiz-arena
curl http://127.0.0.1:3000/api/health
```

Die Antwort `{"status":"ok",...}` zeigt, dass der Dienst bereit ist.

## 4. Betrieb mit Portainer

1. **Stack anlegen.** In Portainer auf *Stacks* → *Add stack*.
2. **Repository waehlen.** Unter *Build method* „Repository“ auswaehlen und die
   Git-Adresse sowie den Branch eintragen. Portainer klont das Projekt und
   nutzt die `docker-compose.yml` im Wurzelverzeichnis.
   Alternativ „Web editor“ waehlen und den Inhalt der `docker-compose.yml`
   einfuegen; dann muss das Projekt vorher auf dem Server liegen.
3. **Umgebungsvariablen setzen.** Im Abschnitt *Environment variables* die
   Werte aus `.env` eintragen. Besonders wichtig:

   | Variable | Wert |
   | --- | --- |
   | `SESSION_SECRET` | Ergebnis von `openssl rand -hex 32` |
   | `ADMIN_PASSWORD_HASH` | Ergebnis von `hash-password.mjs` |
   | `ADMIN_USER` | z. B. `moderator` |
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `true` |
   | `COOKIE_SECURE` | `true`, sobald HTTPS aktiv ist |

4. **Netzwerk.** Nutzt der Proxy ein bestehendes Docker-Netz, in Portainer
   unter *Networks* ein Netz mit dem Namen `web` anlegen und im Stack
   referenzieren. Ohne Proxy die `docker-compose.standalone.yml` verwenden.
5. **Starten.** *Deploy the stack*. Portainer baut das Image und startet den
   Container. Der Health-Status wird als `healthy` angezeigt.
6. **Aktualisieren.** Bei neuem Stand im Repository im Stack auf *Pull and
   redeploy* klicken. Die Datenbank liegt im Volume `quiz-data` und bleibt
   erhalten.
7. **Sichern.** Volume `quiz-data` sichern; darin liegen Fragen und
   Zertifikate.

## 5. HTTPS mit Reverse Proxy und DuckDNS

### 5.1 DuckDNS einrichten

1. Auf duckdns.org anmelden und eine Subdomain anlegen, zum Beispiel
   `quiz-arena`.
2. Im Router oder per Update-URL die aktuelle oeffentliche IP melden:
   `https://www.duckdns.org/update?domains=quiz-arena&token=<TOKEN>&ip=`
3. Die Domain zeigt danach auf `quiz-arena.duckdns.org`.

### 5.2 Ports freigeben

Im Router nur 80 und 443 auf den Proxy weiterleiten. Port 3000 bleibt
geschlossen; der Proxy erreicht den Container ueber das Docker-Netz.

### 5.3 Zoraxy konfigurieren

1. In Zoraxy einen *HTTP Proxy* anlegen.
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

### 5.4 Nginx als Alternative

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

### 5.5 Nach dem Umstieg auf HTTPS

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
npm test           # 99 Tests fuer Spielregeln, Geheimhaltung, Auth, Realtime
npm run typecheck  # TypeScript-Pruefung aller Workspaces
npm run build      # shared, Server und Client bauen
```

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
| `/api/health` antwortet nicht | Container laeuft nicht | `docker compose logs quiz-arena` pruefen |
| Anmeldung schlaegt fehl | `ADMIN_PASSWORD_HASH` passt nicht | Hash neu erzeugen und Stack neu starten |
| Verbindung bricht ab | Proxy reicht WebSocket nicht durch | Upgrade-Kopfzeilen und Pfad `/socket.io/` pruefen |
| Tickets nach Neustart ungueltig | `SESSION_SECRET` wechselt | festen Wert in `.env` setzen |
| Kandidat kann nicht beitreten | Selbstbeitritt gesperrt | in der Moderation freigeben |
| Keine Frage startbar | keine freigegebene Frage | im Admin-Bereich freigeben |
