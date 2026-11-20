import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

type Tok = { text: string; cls?: string };

/**
 * Colours a one-line shell command with the same syntax palette as code blocks: the program, its
 * subcommand, flags and values each get their own colour. Deterministic and instant (no parser to
 * load) — commands here are short and always the same shape.
 */
export function shellTokens(command: string): Tok[] {
  const out: Tok[] = [];
  let word = 0;
  for (const part of command.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push({ text: part });
      continue;
    }
    let cls: string;
    if (word === 0) cls = 'text-(--hl-title) font-semibold';
    else if (part.startsWith('-')) cls = 'text-(--hl-keyword)';
    else if (/^(https?:\/\/|@|["'])/.test(part) || /[/\\]/.test(part)) cls = 'text-(--hl-string)';
    else if (word === 1) cls = 'text-foreground';
    else cls = 'text-(--hl-number)';
    out.push({ text: part, cls });
    word++;
  }
  return out;
}

/** A command to run on the PC: highlighted, wraps on small screens, one tap to copy. */
export function CommandLine({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn('flex items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-3 shadow-xs', className)}
    >
      <code className="min-w-0 flex-1 py-1.5 font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]">
        <span aria-hidden className="mr-2 text-muted-foreground select-none">
          $
        </span>
        {shellTokens(command).map((t, i) => (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ))}
      </code>
      <CopyButton value={command} label="Copy command" />
    </div>
  );
}
