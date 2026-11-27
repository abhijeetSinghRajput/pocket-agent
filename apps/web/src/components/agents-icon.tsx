import type { LucideProps } from 'lucide-react';

// The app's Agents mark (apps/mobile/src/ui/agents-icon.tsx): a soft rounded face with two eyes,
// in its own 177 × 130 units, centred in a square with room for the stroke.
const FACE =
  'M177 65C177 130 137.377 130 88.5 130C27 130 0 120 0 65C0 1 37 0 88.5 0C137.377 0 175.994 0 177 65Z';
const BOX = 201;
const EYES = [
  { cx: 52.5, cy: 65 },
  { cx: 123.5, cy: 64 },
];

/** The Agents icon, taking a lucide icon's props (stroke width in 24-pixel units, fill, colour). */
export function AgentsIcon({ strokeWidth = 2, fill = 'none', fillOpacity, className, ...rest }: LucideProps) {
  const stroke = (Number(strokeWidth) * BOX) / 24;
  return (
    <svg viewBox={`-12 ${65 - BOX / 2} ${BOX} ${BOX}`} className={className} aria-hidden {...rest}>
      <path
        d={FACE}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      {EYES.map((e) => (
        <rect
          key={e.cx}
          x={e.cx - stroke / 2}
          y={e.cy - 22}
          width={stroke}
          height={44}
          rx={stroke / 2}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
