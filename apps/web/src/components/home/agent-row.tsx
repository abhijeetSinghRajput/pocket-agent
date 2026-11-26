import Image from 'next/image';
import { AgentLogo } from '@/components/agents/agent-logos';
import './agent-row.css';

/**
 * The agents Pocket Agent connects to, in a loose row above the headline: Claude Code in the
 * middle with Cursor, GitHub Copilot, Antigravity, Codex and OpenCode around it, all working
 * today (dark tiles, live lines), and the one still to come at the end, faded. Lines run from each
 * down to Pocket Agent.
 */

type Tile = {
  name: string;
  /** Works today (a dark tile with a live line); otherwise coming soon. */
  live: boolean;
  /** Logo file in /logos/agents (the one that reads on the tile), and its dark-theme twin. */
  logo?: string;
  dark?: string;
  /** Drawn from the app's own mark instead of a file. */
  mark?: 'codex';
  /** The one in the middle, larger. */
  main?: boolean;
};

// Left to right. Connected agents sit on dark tiles, so they use their light-on-dark logos.
const TILES: Tile[] = [
  { name: 'Cursor', live: true, logo: 'cursor_dark' },
  { name: 'GitHub Copilot', live: true, logo: 'copilot_dark' },
  { name: 'Antigravity', live: true, logo: 'antigravity' },
  { name: 'Claude Code', live: true, logo: 'claude-code', main: true },
  { name: 'Codex', live: true, mark: 'codex' },
  { name: 'OpenCode', live: true, logo: 'opencode-dark' },
  { name: 'Qwen Code', live: false, logo: 'qwen_light', dark: 'qwen_dark' },
];

// Where each tile sits along the row (0-100), and the hub below the middle the lines meet at
const X = [8, 22, 36, 50, 64, 78, 92];
const HUB = { x: 50, y: 92 };

const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');

function Logo({ t }: { t: Tile }) {
  if (t.mark) return <AgentLogo provider={t.mark} className="agents__mark" />;
  const size = t.main ? 40 : t.live ? 34 : 30;
  return (
    <>
      <Image
        src={`/logos/agents/${t.logo}.svg`}
        alt={t.name}
        width={size}
        height={size}
        className={t.dark ? 'dark:hidden' : undefined}
      />
      {t.dark && (
        <Image
          src={`/logos/agents/${t.dark}.svg`}
          alt={t.name}
          width={size}
          height={size}
          className="hidden dark:block"
        />
      )}
    </>
  );
}

export function AgentRow() {
  const live = TILES.filter((t) => t.live).map((t) => t.name);
  const soon = TILES.filter((t) => !t.live).map((t) => t.name);
  return (
    <figure
      className="agents"
      aria-label={`Works with ${list(live)} today. ${list(soon)} ${soon.length > 1 ? 'are' : 'is'} coming soon.`}
    >
      <svg className="agents__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {TILES.map((t, i) => (
          <path
            key={t.name}
            className={t.live ? 'agents__line agents__line--live' : 'agents__line'}
            d={`M ${X[i]} 46 C ${X[i]} 74, ${HUB.x} 66, ${HUB.x} ${HUB.y}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <ul className="agents__row">
        {TILES.map((t, i) => (
          <li
            key={t.name}
            className={
              t.main
                ? 'agents__tile agents__tile--claude'
                : t.live
                  ? 'agents__tile agents__tile--live'
                  : 'agents__tile agents__tile--soon'
            }
            style={{ left: `${X[i]}%` }}
            title={`${t.name}: ${t.live ? 'works today' : 'coming soon'}`}
          >
            <Logo t={t} />
          </li>
        ))}
      </ul>

      <span className="agents__note agents__note--today" aria-hidden>
        <span>works today</span>
        <svg viewBox="0 0 40 30" width="34" height="26">
          <path d="M3 4c12 0 24 6 28 20M24 20l7 5 3-8" />
        </svg>
      </span>
      <span className="agents__note agents__note--soon" aria-hidden>
        <svg viewBox="0 0 40 30" width="30" height="22">
          <path d="M37 4C25 4 12 9 7 22M14 20l-7 4-2-8" />
        </svg>
        coming soon
      </span>

      <span className="agents__hub" style={{ left: `${HUB.x}%`, top: `${HUB.y}%` }}>
        <svg className="agents__scribble" viewBox="0 0 100 100" aria-hidden>
          <path d="M14 22c18-12 52-14 70-4 10 10 8 46 4 62-6 12-48 14-66 8-12-8-14-44-8-64" />
          <path d="M82 10l6-8M90 18l9-4M88 4l2-4" />
        </svg>
        <Image src="/icons/hero-pocket-agent.png" alt="Pocket Agent" width={46} height={46} />
      </span>
    </figure>
  );
}
