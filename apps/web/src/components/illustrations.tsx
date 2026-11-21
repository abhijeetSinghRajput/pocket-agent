import type { SVGProps } from 'react';

/**
 * A PC resting under a blanket, with a mug of coffee beside it: for empty states that wait on a PC
 * that isn't online (the words beside it say "offline", never "asleep"). Drawn in fixed colours (the blanket is the brand orange) that read on both the
 * light and the dark card.
 */
export function SleepingPc(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 220" fill="none" aria-hidden {...props}>
      <defs>
        {/* The blanket's check: a lighter grid woven over the orange, tilted with the drape. */}
        <pattern
          id="sleeping-pc-check"
          width="18"
          height="18"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-24)"
        >
          <rect width="18" height="18" fill="#F58A1F" />
          <rect width="18" height="5" fill="#FBB15A" opacity="0.75" />
          <rect width="5" height="18" fill="#FBB15A" opacity="0.75" />
          <rect width="5" height="5" fill="#FFD08F" opacity="0.9" />
        </pattern>
        <linearGradient id="sleeping-pc-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3F3F45" />
          <stop offset="1" stopColor="#34343A" />
        </linearGradient>
      </defs>

      {/* Soft shadows on the desk */}
      <ellipse cx="146" cy="196" rx="62" ry="6" fill="#000" opacity="0.1" />
      <ellipse cx="249" cy="196" rx="28" ry="4.5" fill="#000" opacity="0.1" />

      {/* Stand */}
      <path d="M132 160h28l4 26h-36l4-26Z" fill="#5A5A61" />
      <rect x="108" y="184" width="76" height="10" rx="5" fill="#4C4C53" />

      {/* Monitor */}
      <rect x="70" y="62" width="150" height="102" rx="9" fill="#55555C" />
      <rect x="77" y="69" width="136" height="88" rx="5" fill="url(#sleeping-pc-screen)" />

      {/* Asleep: closed eyes and a small mouth */}
      <path d="M104 116c5 6 16 6 21 0" stroke="#D5D5DB" strokeWidth="3" strokeLinecap="round" />
      <path d="M146 116c5 6 16 6 21 0" stroke="#D5D5DB" strokeWidth="3" strokeLinecap="round" />
      <path d="M131 134h9" stroke="#D5D5DB" strokeWidth="3" strokeLinecap="round" />

      {/* Blanket draped over the top-left corner */}
      <path
        d="M34 158c-9-34 2-76 30-96 22-16 52-22 78-12 6 2 10 6 12 11-28 2-52 16-66 40-10 17-14 37-12 57-14 6-30 6-42 0Z"
        fill="url(#sleeping-pc-check)"
      />
      {/* Its folded hem */}
      <path d="M34 158c12 6 28 6 42 0-1 5-1 9 0 13-14 6-30 6-41 0-1-4-1-9-1-13Z" fill="#E97A12" />
      <path
        d="M142 50c6 2 10 6 12 11-28 2-52 16-66 40-10 17-14 37-12 57"
        stroke="#D96C0A"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* z z */}
      <path
        d="M214 62h17l-16 20h18"
        stroke="#F58A1F"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M240 36h13l-12 15h14"
        stroke="#F58A1F"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Mug, with steam */}
      <path
        d="M240 138c-4-5 4-8 0-13"
        stroke="#B9B9C0"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path
        d="M252 140c-4-5 4-8 0-13"
        stroke="#B9B9C0"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path d="M229 163h-5a9 9 0 0 0 0 18h5" stroke="#6F6F77" strokeWidth="6" strokeLinecap="round" />
      <rect x="227" y="150" width="46" height="44" rx="8" fill="#75757D" />
      <rect x="227" y="150" width="46" height="9" rx="4.5" fill="#8A8A92" />
      <path
        d="M243 168l-6 6 6 6M257 168l6 6-6 6M252 166l-4 16"
        stroke="#ECECF0"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
