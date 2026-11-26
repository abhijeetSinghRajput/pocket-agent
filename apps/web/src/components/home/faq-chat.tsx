'use client';

import Image from 'next/image';
import { useId, useState } from 'react';
import './faq-chat.css';

export type FaqItem = { q: string; a: string };

/**
 * The FAQ as a conversation: each question is a message you could send; open one and it shrinks
 * to its words like a sent bubble, and the answer arrives beside it from Pocket Agent. One open at
 * a time. Every answer stays in the page (only folded), so search engines and screen readers get
 * all of it.
 */
export function FaqChat({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState(0);
  const id = useId();
  return (
    <ul className="faq-chat">
      {items.map(({ q, a }, i) => {
        const on = open === i;
        return (
          <li key={q} className="faq-chat__item" data-open={on || undefined}>
            <h3 className="faq-chat__q-wrap">
              <button
                type="button"
                className="faq-chat__q"
                aria-expanded={on}
                aria-controls={`${id}-${i}`}
                onClick={() => setOpen(on ? -1 : i)}
              >
                {q}
              </button>
            </h3>
            <div id={`${id}-${i}`} role="region" aria-label={q} className="faq-chat__fold">
              <div className="faq-chat__fold-inner">
                <div className="faq-chat__reply">
                  <p className="faq-chat__a">{a}</p>
                  <Image
                    src="/icons/icon-192.png"
                    alt=""
                    width={48}
                    height={48}
                    className="faq-chat__avatar"
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
