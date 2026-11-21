'use client';

import { memo, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton } from '@/components/ui/copy-button';
import { cachedHighlight, highlight } from '@/lib/highlight';
import { cn } from '@/lib/utils';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return '';
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  ),
  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-2 flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground',
        className?.includes('contains-task-list') && 'list-none pl-1',
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 mb-2 text-[15px] font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h6>,
  h5: ({ children }) => <p className="mt-3 mb-1 font-semibold first:mt-0">{children}</p>,
  h6: ({ children }) => <p className="mt-3 mb-1 font-semibold first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md bg-card">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-b bg-muted/60 px-2.5 py-1.5 text-left font-semibold whitespace-nowrap"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style}
      className="max-w-[40ch] min-w-[10ch] border-b px-2.5 py-1.5 align-top [overflow-wrap:break-word] [tr:last-child_&]:border-b-0"
    >
      {children}
    </td>
  ),
  pre: ({ children }) => {
    const code = textOf(children).replace(/\n$/, '');
    const lang =
      children && typeof children === 'object' && 'props' in children
        ? /language-([\w-]+)/.exec(String((children.props as { className?: string }).className ?? ''))?.[1]
        : undefined;
    return <CodeBlock code={code} lang={lang?.toLowerCase()} />;
  },
  code: ({ children, className }) =>
    className?.startsWith('language-') ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-foreground/[0.07] px-1 py-0.5 font-mono text-[0.88em] [overflow-wrap:anywhere]">
        {children}
      </code>
    ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={!!checked}
      readOnly
      disabled
      className="mr-1.5 align-middle accent-primary"
    />
  ),
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || 'image'}]</span>,
};

/** Code with a language label, copy button and syntax colours (highlighted off the critical path). */
const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState(() => cachedHighlight(code, lang) ?? null);
  useEffect(() => {
    if (cachedHighlight(code, lang) !== undefined) {
      setHtml(cachedHighlight(code, lang) ?? null);
      return;
    }
    let live = true;
    // Let the message paint first; colour it when the browser is idle.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => {
      void highlight(code, lang).then((h) => live && setHtml(h));
    });
    return () => {
      live = false;
      cancel(id);
    };
  }, [code, lang]);

  return (
    <div className="my-2 overflow-hidden rounded-lg bg-card">
      <div className="flex h-8 items-center justify-between border-b bg-muted/60 pr-0.5 pl-3">
        <span className="font-mono text-[11px] text-muted-foreground">{lang ?? 'code'}</span>
        <CopyButton value={code} label="Copy code" className="size-7" />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
        {html !== null ? (
          // highlight.js escapes the code; its output only adds <span class="hljs-…"> wrappers.
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
});

/**
 * Claude's replies as rich text. Raw HTML is never rendered (react-markdown escapes it), and
 * images are not loaded — message text comes from the PC and should not make the browser fetch URLs.
 */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('text-[14.5px] leading-relaxed [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
