/**
 * Reine Logik des Gluecksrads zur Kandidatenauswahl.
 *
 * Regeln:
 * - Ein Rad pro Team.
 * - Es wird zufaellig ein Spieler gewaehlt, der in der aktuellen Runde dieses
 *   Teams noch nicht ausgewaehlt wurde.
 * - Bereits ausgewaehlte Spieler sind voruebergehend nicht im Rad.
 * - Sind alle Spieler ausgewaehlt, wird nur dieses Rad wieder vollstaendig
 *   aufgefuellt.
 * - Die Rotation ist unabhaengig vom Fortschritt der Gewinnleiter.
 *
 * Ein Durchgang umfasst jeden Spieler genau einmal. `remaining` enthaelt die
 * noch ziehbaren, `drawn` die in diesem Durchgang bereits gezogenen Spieler.
 * Beide Mengen bilden zusammen die Rotation; nur so koennen bereits gezogene
 * Spieler voruebergehend aus dem Rad verschwinden, ohne bei der naechsten
 * Synchronisierung wieder aufzutauchen.
 */

export type Rng = () => number;

export interface WheelState {
  /** Spieler-IDs, die im aktuellen Durchgang noch gezogen werden koennen. */
  remaining: string[];
  /** Spieler-IDs, die im aktuellen Durchgang bereits gezogen wurden. */
  drawn: string[];
  /** Zuletzt gezogener Spieler. */
  lastDrawn: string | null;
  /** Anzahl vollstaendig abgeschlossener Durchgaenge. */
  roundsCompleted: number;
}

export function createWheel(players: readonly string[]): WheelState {
  return { remaining: [...players], drawn: [], lastDrawn: null, roundsCompleted: 0 };
}

/**
 * Rad mit der aktuellen Teammitgliederliste abgleichen (z. B. nach
 * Wiederverbindung oder Teamwechsel): ausgeschiedene Spieler entfernen, neu
 * hinzugekommene Spieler in die Rotation aufnehmen. Bereits gezogene Spieler
 * bleiben ausgenommen, bis der Durchgang abgeschlossen ist.
 */
export function syncWheelPlayers(state: WheelState, players: readonly string[]): WheelState {
  const valid = new Set(players);
  const remaining = state.remaining.filter((id) => valid.has(id));
  const drawn = state.drawn.filter((id) => valid.has(id));
  const known = new Set([...remaining, ...drawn]);
  for (const id of players) {
    if (!known.has(id)) remaining.push(id);
  }
  const lastDrawn = state.lastDrawn && valid.has(state.lastDrawn) ? state.lastDrawn : null;
  return { remaining, drawn, lastDrawn, roundsCompleted: state.roundsCompleted };
}

export interface DrawResult {
  state: WheelState;
  drawn: string;
  /** true, wenn das Rad in diesem Schritt neu aufgefuellt wurde. */
  refilled: boolean;
}

/**
 * Zieht einen Spieler. Nach der Ziehung wird ausschliesslich dieses Rad wieder
 * mit allen Teammitgliedern aufgefuellt, sobald alle Spieler gezogen wurden.
 */
export function drawFromWheel(
  state: WheelState,
  players: readonly string[],
  rng: Rng = Math.random,
): DrawResult {
  if (players.length === 0) {
    throw new Error('Keine Spieler fuer die Auswahl vorhanden.');
  }

  let current = syncWheelPlayers(state, players);
  let refilled = false;

  if (current.remaining.length === 0) {
    // Alle Spieler wurden gezogen - neuer Durchgang beginnt mit vollem Rad.
    current = { ...current, remaining: [...players], drawn: [] };
    refilled = true;
  }

  const index = Math.min(current.remaining.length - 1, Math.floor(rng() * current.remaining.length));
  const drawnPlayer = current.remaining[index] as string;
  const remaining = current.remaining.filter((_, i) => i !== index);
  const drawn = [...current.drawn, drawnPlayer];

  if (remaining.length === 0) {
    // Durchgang abgeschlossen: nur dieses Rad wieder vollstaendig auffuellen.
    return {
      state: {
        remaining: [...players],
        drawn: [],
        lastDrawn: drawnPlayer,
        roundsCompleted: current.roundsCompleted + 1,
      },
      drawn: drawnPlayer,
      refilled: true,
    };
  }

  return {
    state: { remaining, drawn, lastDrawn: drawnPlayer, roundsCompleted: current.roundsCompleted },
    drawn: drawnPlayer,
    refilled,
  };
}
