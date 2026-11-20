'use client';

import type { HLJSApi } from 'highlight.js';

/**
 * Syntax highlighting without slowing the chat down:
 * - highlight.js core and a fixed set of common languages are loaded on demand (separate chunk),
 *   so the first paint never waits for them — code shows as plain text, then gets coloured;
 * - results are cached, so re-renders and live updates never highlight the same block twice;
 * - very large blocks stay plain, and auto-detection only runs on small blocks.
 */
const MAX_CHARS = 20_000;
const MAX_AUTO_CHARS = 3_000;
const CACHE_LIMIT = 300;

let loading: Promise<HLJSApi> | null = null;
const cache = new Map<string, string | null>();

function load(): Promise<HLJSApi> {
  loading ??= (async () => {
    const [core, ...langs] = await Promise.all([
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/powershell'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/yaml'),
      import('highlight.js/lib/languages/markdown'),
      import('highlight.js/lib/languages/diff'),
      import('highlight.js/lib/languages/go'),
      import('highlight.js/lib/languages/rust'),
      import('highlight.js/lib/languages/java'),
      import('highlight.js/lib/languages/ini'),
      import('highlight.js/lib/languages/dockerfile'),
    ]);
    const hljs = core.default;
    const names = [
      'typescript',
      'javascript',
      'json',
      'bash',
      'powershell',
      'python',
      'xml',
      'css',
      'sql',
      'yaml',
      'markdown',
      'diff',
      'go',
      'rust',
      'java',
      'ini',
      'dockerfile',
    ];
    names.forEach((n, i) => hljs.registerLanguage(n, langs[i]!.default));
    hljs.registerAliases(['tsx', 'ts'], { languageName: 'typescript' });
    hljs.registerAliases(['jsx', 'js', 'mjs', 'cjs'], { languageName: 'javascript' });
    hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
    hljs.registerAliases(['ps', 'ps1', 'pwsh'], { languageName: 'powershell' });
    hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
    hljs.registerAliases(['toml'], { languageName: 'ini' });
    return hljs;
  })();
  return loading;
}

/** Highlighted HTML (escaped by highlight.js), or null when the block should stay plain. */
export async function highlight(code: string, lang: string | undefined): Promise<string | null> {
  if (!code || code.length > MAX_CHARS) return null;
  const key = `${lang ?? ''}\u0000${code}`;
  if (cache.has(key)) return cache.get(key)!;
  const hljs = await load();
  let html: string | null = null;
  if (lang && hljs.getLanguage(lang)) {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } else if (!lang && code.length <= MAX_AUTO_CHARS) {
    const r = hljs.highlightAuto(code);
    html = r.relevance >= 5 ? r.value : null;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}

/** Synchronous cache lookup, so already-seen blocks render coloured on the first frame. */
export function cachedHighlight(code: string, lang: string | undefined): string | null | undefined {
  return cache.get(`${lang ?? ''}\u0000${code}`);
}
