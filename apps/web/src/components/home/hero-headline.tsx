'use client';

import {
  Bell,
  Bot,
  BedDouble,
  Eye,
  FlaskConical,
  MessageSquare,
  MousePointerClick,
  Smartphone,
  Sofa,
  SquareTerminal,
  TrainFront,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import './hero-headline.css';

type Word = { text: string; icon: LucideIcon };

const WHAT: Word[] = [
  { text: 'Claude Code', icon: SquareTerminal },
  { text: 'your agent', icon: Bot },
  { text: 'a refactor', icon: Wand2 },
  { text: 'the tests', icon: FlaskConical },
];
const WHERE: Word[] = [
  { text: 'phone', icon: Smartphone },
  { text: 'couch', icon: Sofa },
  { text: 'commute', icon: TrainFront },
  { text: 'bed', icon: BedDouble },
];
/** The last line's verb changes with its word, so every combination still reads. */
const HOW: (Word & { verb: string })[] = [
  { verb: 'approve it with', text: 'one tap', icon: MousePointerClick },
  { verb: 'answer it with', text: 'a reply', icon: MessageSquare },
  { verb: 'check on it at', text: 'a glance', icon: Eye },
  { verb: 'hear back with', text: 'a ping', icon: Bell },
];

/**
 * A highlighted word that swaps to the next option when tapped: the new word rises in, the old one
 * leaves upward, and the marker eases to the new width so the line around it moves with it.
 */
function Swap({
  words,
  at,
  onNext,
  label,
}: {
  words: Word[];
  at: number;
  onNext: () => void;
  label: string;
}) {
  const { text, icon: Icon } = words[at]!;
  const inner = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (inner.current) setWidth(inner.current.offsetWidth);
  }, [at]);
  return (
    <button
      type="button"
      className="hh-swap"
      onClick={onNext}
      aria-label={`${text}. ${label}`}
      style={width ? { width } : undefined}
    >
      <span ref={inner} key={at} className="hh-swap__inner">
        <Icon className="hh-swap__icon" aria-hidden strokeWidth={2.4} />
        {text}
      </span>
    </button>
  );
}

export function HeroHeadline() {
  const [what, setWhat] = useState(0);
  const [where, setWhere] = useState(0);
  const [how, setHow] = useState(0);
  const [touched, setTouched] = useState(false);
  const next = (set: (f: (n: number) => number) => void, n: number) => () => {
    set((i) => (i + 1) % n);
    setTouched(true);
  };
  return (
    <>
      <h1 className="hh-title">
        <span className="hh-line">
          Run <Swap words={WHAT} at={what} onNext={next(setWhat, WHAT.length)} label="Tap to swap" /> on your
          PC.
        </span>
        <span className="hh-line hh-line--muted">
          Steer it from your{' '}
          <Swap words={WHERE} at={where} onNext={next(setWhere, WHERE.length)} label="Tap to swap" />,
        </span>
        <span className="hh-line hh-line--muted">
          <span key={how} className="hh-verb">
            {HOW[how]!.verb}
          </span>{' '}
          <Swap words={HOW} at={how} onNext={next(setHow, HOW.length)} label="Tap to swap" />.
        </span>
      </h1>
      <p className="hh-hint" aria-live="polite">
        {touched
          ? 'Every combination is something it really does. Keep going.'
          : 'Tap a highlighted word to swap it.'}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className="hh-hint__arrow">
          <path
            d="M4 18c6-1 11-5 13-12M12 6h5v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </p>
    </>
  );
}
