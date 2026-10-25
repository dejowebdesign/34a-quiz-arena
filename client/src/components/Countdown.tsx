import { formatSeconds, useCountdown } from '../lib/hooks';

interface CountdownProps {
  countdown: { state: string; endsAt: number | null; remainingMs: number | null };
  serverNow: number;
  totalMs?: number;
}

/** Synchronisierte Countdown-Anzeige. Rechnet mit der Serverzeit. */
export function Countdown({ countdown, serverNow, totalMs = 10_000 }: CountdownProps) {
  const remaining = useCountdown(countdown, serverNow);

  if (countdown.state === 'idle') {
    return <span className="pill">Kein Countdown aktiv</span>;
  }

  const urgent = (remaining ?? 0) <= 3_000;
  const width = remaining === null ? 0 : Math.max(0, Math.min(100, (remaining / totalMs) * 100));

  return (
    <div style={{ width: '100%' }}>
      <div className="row">
        <span className={`countdown${urgent ? ' urgent' : ''}`}>{formatSeconds(remaining)}s</span>
        <span className="pill">
          {countdown.state === 'running'
            ? 'laeuft'
            : countdown.state === 'paused'
              ? 'pausiert'
              : countdown.state === 'expired'
                ? 'abgelaufen'
                : countdown.state}
        </span>
      </div>
      <div className="countdown-track">
        <div className="countdown-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
