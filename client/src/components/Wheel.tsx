import { useEffect, useRef, useState } from 'react';

interface WheelProps {
  players: { id: string; name: string; inWheel: boolean }[];
  lastDrawnName: string | null;
  spinning: boolean;
  onSpin: () => void;
  label: string;
}

/** Gluecksrad zur Kandidatenauswahl. Die Auswahl selbst trifft der Server. */
export function Wheel({ players, lastDrawnName, spinning, onSpin, label }: WheelProps) {
  const [angle, setAngle] = useState(0);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (spinning) {
      setAngle((current) => current + 1080 + Math.floor(Math.random() * 360));
    }
  }, [spinning]);

  useEffect(() => {
    if (lastDrawnName && lastDrawnName !== previous.current) {
      previous.current = lastDrawnName;
      setAngle((current) => current + 720 + Math.floor(Math.random() * 360));
    }
  }, [lastDrawnName]);

  const remaining = players.filter((p) => p.inWheel);

  return (
    <div>
      <h3>{label}</h3>
      <div className="wheel" style={{ transform: `rotate(${angle}deg)` }} aria-hidden="true">
        <div className="hub">{lastDrawnName ?? 'Bereit'}</div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={onSpin} disabled={spinning || players.length === 0}>
          Rad drehen
        </button>
        <span className="pill">{remaining.length} im Rad</span>
      </div>
      <ul className="player-list">
        {players.map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            <span className={player.inWheel ? 'pill ok' : 'pill'}>
              {player.inWheel ? 'im Rad' : 'bereits gezogen'}
            </span>
          </li>
        ))}
        {players.length === 0 && <li className="muted">Noch keine Spieler eingetragen.</li>}
      </ul>
    </div>
  );
}
