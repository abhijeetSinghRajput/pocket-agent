/**
 * Pocket Agent versions on a PC (`x.y.z`, maybe with a `-tag`). Features that need a newer PC
 * agent compare against the constant that names them (e.g. `CONFIGURE_AGENT_VERSION`).
 */

/**
 * `a < b` for `x.y.z` versions. A pre-release tag is ignored and a missing part counts as 0; an
 * unreadable `a` counts as older (a feature is never assumed on a PC that can't say its version).
 */
export function versionBelow(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10));
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (Number.isNaN(p)) return true;
    if (p !== q) return p < q;
  }
  return false;
}
