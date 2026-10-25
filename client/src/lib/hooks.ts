import { useEffect, useRef, useState } from 'react';

/**
 * Countdown-Anzeige. Rechnet ausschliesslich mit der Serverzeit und gleicht
 * lokale Drift aus. Die Autoritaet bleibt der Server: bei Ablauf zeigt der
 * Client nur 0 an und wartet auf die naechste Sicht.
 */
export function useCountdown(
  countdown: { state: string; endsAt: number | null; remainingMs: number | null },
  serverNow: number,
): number | null {
  const driftRef = useRef(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    driftRef.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    if (countdown.state === 'paused') {
      setRemaining(countdown.remainingMs ?? 0);
      return;
    }
    if (countdown.state !== 'running' || countdown.endsAt === null) {
      setRemaining(countdown.state === 'expired' ? 0 : null);
      return;
    }
    const tick = () => {
      const now = Date.now() + driftRef.current;
      setRemaining(Math.max(0, countdown.endsAt! - now));
    };
    tick();
    const handle = window.setInterval(tick, 100);
    return () => window.clearInterval(handle);
  }, [countdown.state, countdown.endsAt, countdown.remainingMs]);

  return remaining;
}

export function formatSeconds(ms: number | null): string {
  if (ms === null) return '--';
  return (ms / 1000).toFixed(1);
}

/** Kleiner persistenter Zustand (z. B. Tickets in sessionStorage). */
export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Speicher nicht verfuegbar - Zustand bleibt im Speicher. */
    }
  };
  return [value, set];
}
