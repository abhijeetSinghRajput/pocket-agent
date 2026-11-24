import * as Linking from 'expo-linking';
import { Check } from 'lucide-react-native';
import { lexer, type Token, type Tokens } from 'marked';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, Fragment, memo, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { CodeBlock } from '@/features/chat/code-block';
import { dur, ease } from '@/lib/motion';
import { alpha, fonts, radius, useTheme, type Colors } from '@/lib/theme';
import { tap } from '@/ui/core';

/**
 * Claude's replies as rich text, drawn with native Text and Views from marked's tokens (the same
 * GFM features the web app renders). Raw HTML is shown as text, never interpreted, and images are
 * not loaded: message text comes from the PC and should not make the phone fetch URLs.
 */

/** Reading size of a reply: a touch larger than UI text, like a chat app's. */
const BODY: TextStyle = { fontFamily: fonts.regular, fontSize: 15.75, lineHeight: 24 };
const GAP = 8;

/** The running text colour (blockquotes read in the muted colour). */
const TextColor = createContext<string | null>(null);

function useTextColor(): string {
  const { c } = useTheme();
  return useContext(TextColor) ?? c.foreground;
}

const openLink = (href: string) => {
  tap();
  void Linking.openURL(href).catch(() => undefined);
};

// ── Inline ───────────────────────────────────────────────────────────────────

function inline(tokens: Token[] | undefined, c: Colors, prefix: string): ReactNode[] {
  if (!tokens) return [];
  const out: ReactNode[] = [];
  tokens.forEach((t, i) => {
    const key = `${prefix}${i}`;
    switch (t.type) {
      case 'text': {
        const tk = t as Tokens.Text;
        // A list item's text token holds inline children of its own.
        out.push(tk.tokens ? <Fragment key={key}>{inline(tk.tokens, c, `${key}.`)}</Fragment> : tk.text);
        break;
      }
      case 'escape':
        out.push((t as Tokens.Escape).text);
        break;
      case 'strong':
        out.push(
          <Text key={key} style={{ fontFamily: fonts.semibold }}>
            {inline((t as Tokens.Strong).tokens, c, `${key}.`)}
          </Text>,
        );
        break;
      case 'em':
        out.push(
          <Text key={key} style={{ fontStyle: 'italic' }}>
            {inline((t as Tokens.Em).tokens, c, `${key}.`)}
          </Text>,
        );
        break;
      case 'del':
        out.push(
          <Text key={key} style={{ textDecorationLine: 'line-through' }}>
            {inline((t as Tokens.Del).tokens, c, `${key}.`)}
          </Text>,
        );
        break;
      case 'codespan':
        out.push(
          <Text
            key={key}
            style={{
              fontFamily: fonts.mono,
              fontSize: 13.5,
              backgroundColor: alpha(c.foreground, 0.07),
              borderRadius: 4,
            }}
          >
            {` ${(t as Tokens.Codespan).text} `}
          </Text>,
        );
        break;
      case 'link': {
        const link = t as Tokens.Link;
        out.push(
          <Text
            key={key}
            accessibilityRole="link"
            onPress={() => openLink(link.href)}
            style={{ fontFamily: fonts.medium, color: c.primary, textDecorationLine: 'underline' }}
          >
            {inline(link.tokens, c, `${key}.`)}
          </Text>,
        );
        break;
      }
      case 'image':
        out.push(
          <Text key={key} style={{ color: c.mutedForeground }}>
            [{(t as Tokens.Image).text || 'image'}]
          </Text>,
        );
        break;
      case 'br':
        out.push('\n');
        break;
      case 'html':
        out.push((t as Tokens.HTML).text);
        break;
      case 'checkbox':
        // Drawn by the list item, before its text.
        break;
      default: {
        const g = t as Tokens.Generic;
        out.push(typeof g['text'] === 'string' ? (g['text'] as string) : g.raw);
      }
    }
  });
  return out;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function Para({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const color = useTextColor();
  return <Text style={[BODY, { color }, style]}>{children}</Text>;
}

const HEADING: Record<number, TextStyle> = {
  1: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 25 },
  2: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  3: { fontFamily: fonts.semibold, fontSize: 15.75, lineHeight: 24 },
};

function Heading({ depth, children }: { depth: number; children: ReactNode }) {
  const color = useTextColor();
  return (
    <Text
      accessibilityRole="header"
      style={[BODY, HEADING[Math.min(depth, 3)], { color, marginTop: depth <= 2 ? 8 : 4 }]}
    >
      {children}
    </Text>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  const { c } = useTheme();
  return (
    <View
      aria-hidden
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        marginTop: 3.5,
        borderWidth: 1.5,
        borderColor: checked ? c.primary : alpha(c.mutedForeground, 0.5),
        backgroundColor: checked ? c.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && <Check size={11} color={c.primaryForeground} strokeWidth={3} />}
    </View>
  );
}

function List({ list, depth }: { list: Tokens.List; depth: number }) {
  const { c } = useTheme();
  const start = typeof list.start === 'number' ? list.start : 1;
  const task = list.items.some((i) => i.task);
  return (
    <View style={{ gap: 4, paddingLeft: task ? 0 : 4 }}>
      {list.items.map((item, i) => {
        const checkbox = item.tokens.find((t): t is Tokens.Checkbox => t.type === 'checkbox');
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            {checkbox || item.task ? (
              <Checkbox checked={checkbox?.checked ?? item.checked ?? false} />
            ) : (
              <Text
                aria-hidden
                style={[
                  BODY,
                  { color: c.mutedForeground, minWidth: list.ordered ? 20 : 12, textAlign: 'right' },
                ]}
              >
                {list.ordered ? `${start + i}.` : depth % 2 ? '◦' : '•'}
              </Text>
            )}
            <View style={{ flex: 1, gap: GAP / 2 }}>
              <Blocks tokens={item.tokens.filter((t) => t.type !== 'checkbox')} depth={depth + 1} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A cell never grows past this; longer text wraps inside it. */
const CELL_MAX = 240;
const CELL_MIN = 44;
const CELL_PAD_X = 12;
const CELL_TEXT: TextStyle = { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 };

/** Measured column widths by table source, so a table scrolled back into view lays out at once. */
const widthCache = new Map<string, number[]>();

function cellStyle(header: boolean, align: Tokens.TableCell['align'], color: string): TextStyle {
  return {
    ...CELL_TEXT,
    color,
    fontFamily: header ? fonts.semibold : fonts.regular,
    textAlign: align ?? 'left',
    fontVariant: align === 'right' ? ['tabular-nums'] : undefined,
  };
}

/** The faded edge on the side of a table that has more to scroll to. */
function Edge({ side, visible, color }: { side: 'left' | 'right'; visible: boolean; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: dur.quick, easing: ease.out }),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, bottom: 0, width: 28, [side]: 0 }, style]}
    >
      <LinearGradient
        colors={side === 'right' ? [alpha(color, 0), color] : [color, alpha(color, 0)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

/**
 * A GFM table. Every cell of a column is as wide as the column's widest cell (measured once,
 * off screen, up to CELL_MAX, past which text wraps), cells follow the column's `:--`/`:-:`/`--:`
 * alignment, and a table wider than the message scrolls sideways inside its frame (a gesture
 * handler scroll view, so a sideways drag goes to the table and an upward one to the chat).
 */
function Table({ table }: { table: Tokens.Table }) {
  const { c } = useTheme();
  const cols = table.header.length;
  const rows = [table.header, ...table.rows];
  // The column widths and the source they were measured for. While a reply streams in, the table
  // keeps its last widths (same columns) until the grown one has been measured.
  const [sized, setSized] = useState<{ raw: string; widths: number[] } | null>(() => {
    const cached = widthCache.get(table.raw);
    return cached ? { raw: table.raw, widths: cached } : null;
  });
  const widths = sized && sized.widths.length === cols ? sized.widths : null;
  const fresh = sized?.raw === table.raw;
  const measured = useRef<{ raw: string; cells: number[][] }>({ raw: '', cells: [] });
  const [frame, setFrame] = useState(0);
  // Which ends have more to scroll to (kept as two flags: a scroll only re-renders when one flips).
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const onCell = (r: number, i: number, w: number) => {
    if (measured.current.raw !== table.raw) measured.current = { raw: table.raw, cells: [] };
    const m = measured.current.cells;
    (m[r] ??= [])[i] = w;
    let done = 0;
    for (const row of m) if (row) done += row.filter((x) => x !== undefined).length;
    if (done < rows.length * cols) return;
    const next = Array.from({ length: cols }, (_, col) =>
      Math.ceil(Math.max(CELL_MIN, ...m.map((row) => row?.[col] ?? 0)) + 1),
    );
    if (widthCache.size > 100) widthCache.clear();
    widthCache.set(table.raw, next);
    setSized({ raw: table.raw, widths: next });
  };

  const total = widths ? widths.reduce((a, b) => a + b, 0) : 0;
  const scrolls = widths !== null && frame > 0 && total + 1 > frame;

  return (
    <View>
      {/* Off-screen: every cell at its natural width (wrapping past the cap), to size the columns. */}
      {!fresh && (
        <View
          key={table.raw}
          aria-hidden
          pointerEvents="none"
          style={{ position: 'absolute', opacity: 0, left: 0, top: 0, width: 10_000 }}
        >
          {rows.map((cells, r) =>
            Array.from({ length: cols }, (_, i) => (
              <View key={`${r}.${i}`} style={{ flexDirection: 'row' }}>
                <Text
                  onLayout={(e) => onCell(r, i, e.nativeEvent.layout.width)}
                  style={[
                    cellStyle(r === 0, table.align[i] ?? null, c.foreground),
                    { maxWidth: CELL_MAX, paddingHorizontal: CELL_PAD_X },
                  ]}
                >
                  {cells[i] ? inline(cells[i].tokens, c, `m${r}.${i}.`) : ''}
                </Text>
              </View>
            )),
          )}
        </View>
      )}
      {widths && (
        <View
          onLayout={(e) => setFrame(e.nativeEvent.layout.width)}
          style={{
            width: total + 2,
            maxWidth: '100%',
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: c.card,
            overflow: 'hidden',
          }}
        >
          <GHScrollView
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            bounces={false}
            overScrollMode="never"
            scrollEnabled={scrolls}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={32}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              setAtStart(contentOffset.x <= 2);
              setAtEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - 2);
            }}
          >
            <View accessibilityRole="grid" style={{ width: total }}>
              {rows.map((cells, r) => (
                <View
                  key={r}
                  accessibilityRole={r === 0 ? 'header' : undefined}
                  style={{
                    flexDirection: 'row',
                    backgroundColor:
                      r === 0 ? alpha(c.muted, 0.7) : r % 2 === 0 ? alpha(c.foreground, 0.025) : undefined,
                    borderBottomWidth: r === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: r === 0 ? c.border : alpha(c.border, 0.7),
                  }}
                >
                  {widths.map((w, i) => (
                    <Text
                      key={i}
                      style={[
                        cellStyle(r === 0, table.align[i] ?? null, c.foreground),
                        { width: w, paddingHorizontal: CELL_PAD_X, paddingVertical: 8 },
                      ]}
                    >
                      {cells[i] ? inline(cells[i].tokens, c, `t${r}.${i}.`) : ''}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </GHScrollView>
          <Edge side="left" visible={scrolls && !atStart} color={c.card} />
          <Edge side="right" visible={scrolls && !atEnd} color={c.card} />
        </View>
      )}
    </View>
  );
}

function Blocks({ tokens, depth = 0 }: { tokens: Token[]; depth?: number }) {
  const { c } = useTheme();
  const out: ReactNode[] = [];
  tokens.forEach((t, i) => {
    switch (t.type) {
      case 'space':
      case 'def':
        return;
      case 'paragraph':
        out.push(<Para key={i}>{inline((t as Tokens.Paragraph).tokens, c, `${i}.`)}</Para>);
        return;
      case 'text': {
        // Tight list items hold bare text tokens instead of paragraphs.
        const tk = t as Tokens.Text;
        out.push(<Para key={i}>{tk.tokens ? inline(tk.tokens, c, `${i}.`) : tk.text}</Para>);
        return;
      }
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push(
          <Heading key={i} depth={h.depth}>
            {inline(h.tokens, c, `${i}.`)}
          </Heading>,
        );
        return;
      }
      case 'code': {
        const code = t as Tokens.Code;
        const lang = code.lang?.trim().split(/\s+/)[0]?.toLowerCase();
        out.push(<CodeBlock key={i} code={code.text.replace(/\n$/, '')} lang={lang || undefined} />);
        return;
      }
      case 'blockquote':
        out.push(
          <View
            key={i}
            style={{ borderLeftWidth: 2, borderLeftColor: alpha(c.primary, 0.4), paddingLeft: 12, gap: GAP }}
          >
            <TextColor.Provider value={c.mutedForeground}>
              <Blocks tokens={(t as Tokens.Blockquote).tokens} depth={depth} />
            </TextColor.Provider>
          </View>,
        );
        return;
      case 'list':
        out.push(<List key={i} list={t as Tokens.List} depth={depth} />);
        return;
      case 'hr':
        out.push(
          <View
            key={i}
            style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 4 }}
          />,
        );
        return;
      case 'table':
        out.push(<Table key={i} table={t as Tokens.Table} />);
        return;
      case 'html':
        out.push(<Para key={i}>{(t as Tokens.HTML).text.replace(/\n$/, '')}</Para>);
        return;
      default:
        out.push(<Para key={i}>{(t as Tokens.Generic).raw}</Para>);
    }
  });
  return <>{out}</>;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tokens = useMemo((): Token[] => {
    try {
      return lexer(text, { gfm: true, breaks: false });
    } catch {
      return [{ type: 'paragraph', raw: text, text, tokens: [{ type: 'text', raw: text, text }] }];
    }
  }, [text]);
  return (
    <View style={{ gap: GAP }}>
      <Blocks tokens={tokens} />
    </View>
  );
});
