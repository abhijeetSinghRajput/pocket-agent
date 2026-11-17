/**
 * Only same-site relative paths are allowed as post-login destinations, so `?next=` can't be
 * abused as an open redirect (e.g. `//evil.example` or `https://evil.example`).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/login') || next.startsWith('/register')) return '/';
  return next;
}
