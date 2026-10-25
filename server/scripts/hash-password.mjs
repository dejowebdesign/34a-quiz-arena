#!/usr/bin/env node
/**
 * Erzeugt einen scrypt-Hash fuer ADMIN_PASSWORD_HASH.
 * Verwendung: node server/scripts/hash-password.mjs "DeinPasswort"
 *
 * Das Klartextpasswort wird nur im Speicher verarbeitet und nicht gespeichert.
 */
import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Verwendung: node server/scripts/hash-password.mjs "DeinPasswort"');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Bitte ein Passwort mit mindestens 10 Zeichen waehlen.');
  process.exit(1);
}

const N = 16384;
const r = 8;
const p = 1;
const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync(password.normalize('NFKC'), salt, 64, { N, r, p });
console.log(['scrypt', N, r, p, salt.toString('hex'), derived.toString('hex')].join('$'));
