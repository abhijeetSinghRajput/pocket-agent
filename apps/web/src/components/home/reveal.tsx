'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';

/**
 * A list item that comes alive the first time it scrolls into view: the card rises in, then what
 * is inside it (`.pa-reveal-inner`) follows a beat later. `index` staggers cards in a row.
 */
export function RevealItem({
  index = 0,
  style,
  ...props
}: ComponentPropsWithoutRef<'li'> & { index?: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <li
      ref={ref}
      data-in={shown || undefined}
      style={{ ...style, ['--i' as string]: index }}
      {...props}
      className={`pa-reveal ${props.className ?? ''}`}
    />
  );
}
