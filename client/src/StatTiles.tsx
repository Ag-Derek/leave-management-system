/** A row of counts above a screen's table. */

import { Icon, type IconName } from './Icon';

export interface Stat {
  figure: number;
  label: string;
  icon: IconName;
  tone?: 'blue' | 'green' | 'violet';
}

/** `stats` undefined while loading, so the row keeps its height. */
export function StatTiles({ stats, count = 4 }: { stats: Stat[] | undefined; count?: number }) {
  if (stats === undefined) {
    return (
      <ul className="stat-tiles" aria-hidden="true">
        {Array.from({ length: count }, (_, at) => (
          <li key={at} className="skeleton stat-skeleton" />
        ))}
      </ul>
    );
  }

  return (
    <ul className="stat-tiles">
      {stats.map((stat) => (
        <li
          key={stat.label}
          className={`stat-tile${stat.tone === undefined ? '' : ` is-${stat.tone}`}`}
        >
          <span className="chip">
            <Icon name={stat.icon} />
          </span>
          <b className="stat-figure">{stat.figure.toLocaleString()}</b>
          <span className="stat-label">{stat.label}</span>
        </li>
      ))}
    </ul>
  );
}
