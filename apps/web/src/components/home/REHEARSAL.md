# Homepage demos: rehearsal notes

Built with the Stageshow kit (vendored in `kit/`, MIT, upstream code untouched apart from a
`// @ts-nocheck` header; lint and Prettier skip it).

## What each demo is

- **Hero** (`hero-demo.tsx`): device pair, copied from the `device-pair` gold. Claude Code in a
  terminal on the PC; Pocket Agent's chat on the phone straddling the window's right edge, pinned
  a gutter off the stage's foot and cropped at the top inside the thread, so the composer shows.
  Beats: the task is typed in the phone's composer and sent (bubble rises into the thread), it
  lands in Claude Code ("from your phone"), Claude finds the bug and edits, then asks to run
  `npm test` (terminal waits, approval card rises on the phone), a touch on Allow, the button
  becomes Allowed and the card closes, an `npm test` row takes its place (Running, then 148
  passed), Claude's reply lands on both. Holds about 2.6s, then what the loop added leaves
  last-first. Poster: the finished state. Compact (below 720px): the phone alone.
- **Feature cards** (`feature-demos.tsx`), each a loop:
  - Connect: `node -v` and `claude --version` already checked; `npm i -g …` typed, its output, then
    `pocket-agent connect 7KQ2` typed, Pairing… (spinner) becomes Paired, then linked and Online.
    The terminal fills from its foot and older lines fade under the title bar. Reset: the session
    fades out, resets unseen, a fresh one fades in.
  - Steer: Claude's answer streams in word by word, its edit row arrives, the next instruction is
    typed in the composer and sent, Claude edits `theme.ts` (spinner to tick). Reset: what the
    loop added leaves last first.
  - Notify: on the lock screen Claude's question drops in, then the finished task on top of it.
    Reset: cleared newest first.

## What changed from the gold

Product, words and chrome are Pocket Agent's: Geist, the site's own `--primary` orange as the
accent (so light and dark each get their shade), the app's chat header, bubbles, tool rows and the
approval card's Deny and Allow.

## Film results

`node scripts/film.mjs http://localhost:3000/home --select '.pa-hero' --states --gate` at 1280 and
390, and `--select '.pa-feat' --still --gate` at 1280 and 390.

Every line is cleared except `kit override` (6 per stage). Those are false positives in this host:
the check skips stylesheets whose URL contains `/kit/`, but Next bundles the kit's own CSS into
`/_next/static/...`, so the kit's own `.ss-phone__*` rules are reported as the page's. `home.css` has
no `.ss-phone__*` selector.

## Not checked

- The dark theme was not filmed.
- The hero filmed with sampling gaps (dev server, 20-260ms); motion inside them was not judged.
- No fresh-eye review pass.
