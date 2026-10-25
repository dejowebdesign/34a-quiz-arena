import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Findet alle Compose-Dateien im Wurzelverzeichnis des Projekts. */
function composeFiles(): string[] {
  return fs
    .readdirSync(repoRoot)
    .filter((name) => /^docker-compose.*\.ya?ml$/.test(name))
    .sort();
}

/**
 * Prueft, ob ein Service-Block in der Compose-Datei ein `image:` oder `build:`
 * enthaelt. Bewusst ohne YAML-Bibliothek, damit der Test keine zusaetzliche
 * Abhaengigkeit braucht. Es wird nur die Ebene der Serviceeintraege unterhalb
 * von `services:` ausgewertet.
 */
function serviceHasImageOrBuild(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const serviceNames: string[] = [];
  let inServices = false;
  let servicesIndent = -1;

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;

    if (!inServices) {
      if (/^services:\s*$/.test(line)) {
        inServices = true;
        servicesIndent = indent;
      }
      continue;
    }

    // Erster Eintrag auf derselben Ebene wie `services:` beendet den Block.
    if (indent <= servicesIndent) break;
    const m = /^(\s+)([A-Za-z0-9._-]+):\s*$/.exec(line);
    if (m && m[1].length === servicesIndent + 2) serviceNames.push(m[2]);
  }

  for (const name of serviceNames) {
    const start = lines.findIndex((l) => new RegExp(`^\\s+${name}:\\s*$`).test(l));
    if (start < 0) continue;
    let hasImageOrBuild = false;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      const indent = line.length - line.trimStart().length;
      if (line.trim() !== '' && indent <= servicesIndent + 2) break;
      if (/^\s*(image|build):/.test(line)) {
        hasImageOrBuild = true;
        break;
      }
    }
    if (!hasImageOrBuild) return false;
  }
  return serviceNames.length > 0;
}

describe('Compose-Konfiguration', () => {
  it('stellt genau eine kanonische Compose-Datei bereit', () => {
    // Eine zweite Datei ohne eigenen image-Eintrag wurde in Portainer
    // versehentlich als Hauptdatei geladen und abgelehnt. Deshalb darf es
    // genau eine geben.
    expect(composeFiles()).toEqual(['docker-compose.yml']);
  });

  it('gibt in jedem Service ein Image oder einen Build-Kontext an', () => {
    for (const file of composeFiles()) {
      const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(serviceHasImageOrBuild(text), `${file} ohne image/build`).toBe(true);
    }
  });

  it('verwendet im Standard ein GHCR-Image und keinen lokalen Build', () => {
    const text = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(text).toMatch(/image:\s*ghcr\.io\/dejowebdesign\/34a-quiz-arena:latest/);
    expect(text).not.toMatch(/^\s*build:/m);
  });

  it('veroeffentlicht den Host-Port ueber QUIZ_PORT und behaelt Port 3000', () => {
    const text = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(text).toMatch(/"\$\{QUIZ_PORT:-3002\}:3000"/);
  });

  it('benoetigt im Standard kein externes Netzwerk', () => {
    const text = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(text).not.toMatch(/external:\s*true/);
  });

  it('haelt das persistente Volume quiz-data vor', () => {
    const text = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(text).toMatch(/quiz-data:\/app\/data/);
    expect(text).toMatch(/^volumes:\s*$/m);
  });

  it('veroeffentlicht ein Image, das der Workflow tatsaechlich baut', () => {
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github', 'workflows', 'docker.yml'),
      'utf8',
    );
    const image = /image:\s*(\S+?):latest/.exec(compose)?.[1];
    expect(image).toBeTruthy();
    // Der Workflow muss dasselbe Paket veroeffentlichen.
    expect(workflow).toContain('ghcr.io/dejowebdesign/34a-quiz-arena');
    expect(workflow).toContain('packages: write');
  });
});
