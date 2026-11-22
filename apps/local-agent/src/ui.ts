import { createInterface } from 'node:readline/promises';

/** Small terminal helpers for the setup / status / doctor output. No dependencies. */

const useColor = !!process.stdout.isTTY && !('NO_COLOR' in process.env);
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

export type Mark = 'ok' | 'warn' | 'fail' | 'info';
const MARKS: Record<Mark, string> = { ok: green('✓'), warn: yellow('!'), fail: red('✗'), info: cyan('•') };

/** One aligned result line: `  ✓ Label            detail`. */
export function line(mark: Mark, label: string, detail?: string): void {
  console.log(`  ${MARKS[mark]} ${detail ? label.padEnd(20) : label}${detail ? ` ${dim(detail)}` : ''}`);
}

export function heading(text: string): void {
  console.log(`\n${bold(text)}`);
}

export const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY;

/** Yes/no question; returns `def` without asking when there is no terminal. */
export async function confirm(question: string, def: boolean): Promise<boolean> {
  if (!interactive()) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`  ${cyan('?')} ${question} ${dim(def ? '[Y/n]' : '[y/N]')} `))
      .trim()
      .toLowerCase();
    return a ? a.startsWith('y') : def;
  } finally {
    rl.close();
  }
}

/** Free-text question with a default; returns `def` without asking when there is no terminal. */
export async function ask(question: string, def = ''): Promise<string> {
  if (!interactive()) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`  ${cyan('?')} ${question}${def ? ` ${dim(`(${def})`)}` : ''} `)).trim();
    return a || def;
  } finally {
    rl.close();
  }
}

/** A line with a spinner while `work` runs (a plain line when output isn't a terminal). */
export async function withSpinner<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return work();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const draw = () => process.stdout.write(`\r  ${cyan(frames[i++ % frames.length]!)} ${label}`);
  draw();
  const timer = setInterval(draw, 80);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    process.stdout.write('\r\x1b[2K');
  }
}
