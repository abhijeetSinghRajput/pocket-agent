import { memo, useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { cachedHighlight, highlight, type Span } from '@/features/chat/highlight';
import { alpha, fonts, radius, useTheme, type Colors } from '@/lib/theme';
import { CopyButton } from '@/ui/copy-button';
import { T } from '@/ui/core';

const CODE: TextStyle = { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 20 };

/** The web app's hljs colours (globals.css), keyed by scope class. */
function styleFor(classes: string[], c: Colors): TextStyle | null {
  let s: TextStyle | null = null;
  const add = (more: TextStyle) => (s = { ...(s ?? {}), ...more });
  for (const cls of classes) {
    switch (cls) {
      case 'hljs-keyword':
      case 'hljs-doctag':
      case 'hljs-template-tag':
      case 'hljs-type':
      case 'hljs-selector-tag':
        add({ color: c.hlKeyword });
        break;
      case 'hljs-string':
      case 'hljs-regexp':
        add({ color: c.hlString });
        break;
      case 'hljs-title':
      case 'hljs-section':
        add({ color: c.hlTitle });
        break;
      case 'hljs-number':
      case 'hljs-literal':
      case 'hljs-attr':
      case 'hljs-attribute':
      case 'hljs-variable':
      case 'hljs-property':
      case 'hljs-selector-attr':
      case 'hljs-selector-class':
      case 'hljs-selector-id':
      case 'hljs-meta':
      case 'hljs-symbol':
      case 'hljs-name':
      case 'hljs-tag':
        add({ color: c.hlNumber });
        break;
      case 'hljs-built_in':
      case 'hljs-params':
      case 'hljs-subst':
        add({ color: c.hlBuiltin });
        break;
      case 'hljs-comment':
      case 'hljs-quote':
        add({ color: c.hlComment, fontStyle: 'italic' });
        break;
      case 'hljs-addition':
        add({ color: c.hlAdd, backgroundColor: alpha(c.success, 0.15) });
        break;
      case 'hljs-deletion':
        add({ color: c.hlDel, backgroundColor: alpha(c.destructive, 0.15) });
        break;
      case 'hljs-emphasis':
        add({ fontStyle: 'italic' });
        break;
      case 'hljs-strong':
        add({ fontFamily: fonts.monoMedium });
        break;
    }
  }
  return s;
}

function renderSpans(spans: Span[], c: Colors, prefix: string): ReactNode[] {
  return spans.map((s, i) => {
    if (typeof s === 'string') return s;
    const key = `${prefix}${i}`;
    return (
      <Text key={key} style={styleFor(s.classes, c)}>
        {renderSpans(s.children, c, `${key}.`)}
      </Text>
    );
  });
}

/**
 * Code with a language label, copy button and syntax colours. Highlighting runs after the message
 * has painted (and is cached), so a long reply never waits for it; the block scrolls sideways.
 */
export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const { c } = useTheme();
  const [spans, setSpans] = useState<Span[] | null>(() => cachedHighlight(code, lang) ?? null);
  useEffect(() => {
    const hit = cachedHighlight(code, lang);
    if (hit !== undefined) {
      setSpans(hit);
      return;
    }
    let live = true;
    // Let the message paint first; colour it once the UI is idle.
    const task = setTimeout(() => {
      const result = highlight(code, lang);
      if (live) setSpans(result);
    }, 0);
    return () => {
      live = false;
      clearTimeout(task);
    };
  }, [code, lang]);

  return (
    <View style={{ borderRadius: radius.md, backgroundColor: c.card, overflow: 'hidden' }}>
      <View
        style={{
          height: 32,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 12,
          paddingRight: 2,
          backgroundColor: alpha(c.muted, 0.6),
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}
      >
        <T variant="caption" tone="muted" style={{ fontFamily: fonts.mono, fontSize: 11 }} numberOfLines={1}>
          {lang ?? 'code'}
        </T>
        <CopyButton value={code} label="Copy code" size={28} />
      </View>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <Text selectable style={[CODE, { color: c.foreground }]}>
          {spans ? renderSpans(spans, c, '') : code}
        </Text>
      </ScrollView>
    </View>
  );
});
