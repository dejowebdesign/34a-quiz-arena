import type { TeamView } from '@quiz/shared';

const LETTERS = ['A', 'B', 'C', 'D'];

interface LadderProps {
  team: TeamView;
  maxLevel: number;
}

/** Gewinnleiter eines Teams inklusive Sicherheitsstufen und aktueller Stufe. */
export function Ladder({ team, maxLevel }: LadderProps) {
  const rows = Array.from({ length: maxLevel }, (_, i) => i + 1);
  return (
    <div className="ladder">
      {rows.map((level) => {
        const isSafety = team.safetyLevels.includes(level);
        const isCurrent = team.level === level;
        const isTop = level === maxLevel;
        const classes = [
          'ladder-row',
          isSafety ? 'safety' : '',
          isCurrent ? 'current' : '',
          level <= team.level ? 'reached' : '',
          isTop ? 'top' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div key={level} className={classes}>
            <span className="num">{level}</span>
            <span>
              {isTop ? 'Challenge bestanden' : isSafety ? 'Sicherheitsstufe' : ''}
              {isCurrent ? (isTop ? ' - erreicht' : ' - aktuelle Stufe') : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function OptionLetter({ index }: { index: number }) {
  return <span className="letter">{LETTERS[index] ?? '?'}</span>;
}

export function optionLetter(index: number): string {
  return LETTERS[index] ?? '?';
}
