import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Syntax highlighting without slowing the chat down (the same rules as the web app):
 * - a fixed set of common languages, registered once;
 * - results are cached, so re-renders, recycled rows and live updates never highlight the same
 *   block twice;
 * - very large blocks stay plain, and auto-detection only runs on small blocks.
 *
 * highlight.js produces HTML; `parseHighlighted` turns it into a small tree of styled spans that
 * the code block renders as nested <Text>.
 */
const MAX_CHARS = 20_000;
const MAX_AUTO_CHARS = 3_000;
const CACHE_LIMIT = 300;

let ready = false;
const cache = new Map<string, Span[] | null>();

function load() {
  if (ready) return hljs;
  ready = true;
  const langs = {
    typescript,
    javascript,
    json,
    bash,
    powershell,
    python,
    xml,
    css,
    sql,
    yaml,
    markdown,
    diff,
    go,
    rust,
    java,
    ini,
    dockerfile,
  };
  for (const [name, lang] of Object.entries(langs)) hljs.registerLanguage(name, lang);
  hljs.registerAliases(['tsx', 'ts'], { languageName: 'typescript' });
  hljs.registerAliases(['jsx', 'js', 'mjs', 'cjs'], { languageName: 'javascript' });
  hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
  hljs.registerAliases(['ps', 'ps1', 'pwsh'], { languageName: 'powershell' });
  hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
  hljs.registerAliases(['toml'], { languageName: 'ini' });
  return hljs;
}

/** A run of code: plain text, or a highlight.js scope (its `hljs-…` classes) holding more runs. */
export type Span = string | { classes: string[]; children: Span[] };

const ENTITY: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
};
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITY[m] ?? m);

/** highlight.js output is escaped text plus nested `<span class="hljs-…">` wrappers; nothing else. */
export function parseHighlighted(html: string): Span[] {
  const root: Span[] = [];
  const stack: Span[][] = [root];
  const re = /<span class="([^"]*)">|<\/span>/g;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > last) stack[stack.length - 1]!.push(decode(html.slice(last, m.index)));
    last = re.lastIndex;
    if (m[1] !== undefined) {
      const node = { classes: m[1].split(/\s+/).filter(Boolean), children: [] as Span[] };
      stack[stack.length - 1]!.push(node);
      stack.push(node.children);
    } else if (stack.length > 1) {
      stack.pop();
    }
  }
  if (last < html.length) stack[stack.length - 1]!.push(decode(html.slice(last)));
  return root;
}

const keyOf = (code: string, lang: string | undefined) => `${lang ?? ''}\u0000${code}`;

/** Highlighted spans, or null when the block should stay plain. Cached. */
export function highlight(code: string, lang: string | undefined): Span[] | null {
  if (!code || code.length > MAX_CHARS) return null;
  const key = keyOf(code, lang);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const h = load();
  let html: string | null = null;
  try {
    if (lang && h.getLanguage(lang)) {
      html = h.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } else if (!lang && code.length <= MAX_AUTO_CHARS) {
      const r = h.highlightAuto(code);
      html = r.relevance >= 5 ? r.value : null;
    }
  } catch {
    html = null;
  }
  const spans = html === null ? null : parseHighlighted(html);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, spans);
  return spans;
}

/** Synchronous cache lookup, so already-seen blocks render coloured on the first frame. */
export function cachedHighlight(code: string, lang: string | undefined): Span[] | null | undefined {
  return cache.get(keyOf(code, lang));
}
