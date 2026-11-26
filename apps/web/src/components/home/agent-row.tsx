import Image from 'next/image';
import './agent-row.css';

/**
 * The agents Pocket Agent connects to: Claude Code in the middle, working today, and other coding
 * agents around it, faded, marked coming soon. Lines run from each down to Pocket Agent; Claude
 * Code's is live. Only `claude-code` is implemented (packages/protocol ProviderId), so the others
 * must stay marked as coming soon until they are.
 */

type Agent = { name: string; light: string; dark?: string };

const LEFT: Agent[] = [
  { name: 'Codex', light: 'codex_light', dark: 'codex_dark' },
  { name: 'Gemini CLI', light: 'gemini' },
  { name: 'Cursor', light: 'cursor_light', dark: 'cursor_dark' },
];
const RIGHT: Agent[] = [
  { name: 'GitHub Copilot', light: 'copilot', dark: 'copilot_dark' },
  { name: 'OpenCode', light: 'opencode', dark: 'opencode-dark' },
  { name: 'Qwen Code', light: 'qwen_light', dark: 'qwen_dark' },
];

// Where each tile sits along the row (0-100), and the hub below the middle the lines meet at
const X = [8, 22, 36, 50, 64, 78, 92];
const HUB = { x: 50, y: 92 };

function Logo({ a, size }: { a: Agent; size: number }) {
  return (
    <>
      <Image
        src={`/logos/agents/${a.light}.svg`}
        alt={a.name}
        width={size}
        height={size}
        className={a.dark ? 'dark:hidden' : undefined}
      />
      {a.dark && (
        <Image
          src={`/logos/agents/${a.dark}.svg`}
          alt={a.name}
          width={size}
          height={size}
          className="hidden dark:block"
        />
      )}
    </>
  );
}

export function AgentRow() {
  const tiles = LEFT;
  return (
    <figure
      className="agents"
      aria-label="Works with Claude Code today. Codex, Gemini CLI, Cursor, GitHub Copilot, OpenCode and Qwen Code are coming soon."
    >
      <svg className="agents__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {X.map((x, i) => (
          <path
            key={i}
            className={i === 3 ? 'agents__line agents__line--live' : 'agents__line'}
            d={`M ${x} 46 C ${x} 74, ${HUB.x} 66, ${HUB.x} ${HUB.y}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <ul className="agents__row">
        {tiles.slice(0, 3).map((a, i) => (
          <li
            key={a!.name}
            className="agents__tile agents__tile--soon"
            style={{ left: `${X[i]}%` }}
            title={`${a!.name}: coming soon`}
          >
            <Logo a={a!} size={30} />
          </li>
        ))}
        <li
          className="agents__tile agents__tile--claude"
          style={{ left: `${X[3]}%` }}
          title="Claude Code: works today"
        >
          <svg className="agents__scribble" viewBox="0 0 100 100" aria-hidden>
            <path d="M14 22c18-12 52-14 70-4 10 10 8 46 4 62-6 12-48 14-66 8-12-8-14-44-8-64" />
            <path d="M82 10l6-8M90 18l9-4M88 4l2-4" />
          </svg>
          <Image src="/logos/agents/claude-code.svg" alt="Claude Code" width={40} height={40} />
        </li>
        {RIGHT.map((a, i) => (
          <li
            key={a.name}
            className="agents__tile agents__tile--soon"
            style={{ left: `${X[4 + i]}%` }}
            title={`${a.name}: coming soon`}
          >
            <Logo a={a} size={30} />
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
        <Image src="/icons/logo-64.png" alt="Pocket Agent" width={36} height={36} />
      </span>
    </figure>
  );
}
