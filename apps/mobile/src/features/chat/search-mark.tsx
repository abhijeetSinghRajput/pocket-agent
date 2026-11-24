import { createContext, useContext, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Text, View } from 'react-native';
import { fonts, useTheme } from '@/lib/theme';

/** The words being searched for in the chat ('' when not searching). */
export const SearchQuery = createContext('');

/**
 * Given only inside the message the search went to: its marks get an invisible anchor, so the
 * chat can measure where the found word is and bring it into view (a long message, or the
 * keyboard, can leave it off screen even when the message is "in view").
 */
export const MatchAnchor = createContext<Ref<ComponentRef<typeof View>> | null>(null);

/** Marks a piece of text: the searched words in it, like a highlighter. */
export type Mark = (text: string, key?: string) => ReactNode;

const plain: Mark = (text) => text;

/**
 * The marker for the chat's search: each occurrence of the searched words (case aside) is drawn
 * like a browser's find, a solid orange highlight with white text. Without a search, text is left
 * as it is.
 */
export function useMark(): Mark {
  const query = useContext(SearchQuery).trim().toLowerCase();
  const anchor = useContext(MatchAnchor);
  const { c } = useTheme();
  if (query.length < 2) return plain;
  const style = {
    backgroundColor: c.primary,
    color: c.primaryForeground,
    fontFamily: fonts.semibold,
    borderRadius: 3,
  };
  return (text, key = 'm') => {
    const lower = text.toLowerCase();
    if (!lower.includes(query)) return text;
    const out: ReactNode[] = [];
    let from = 0;
    let at = lower.indexOf(query);
    while (at !== -1) {
      if (at > from) out.push(text.slice(from, at));
      if (anchor)
        out.push(
          <View
            key={`${key}-a${at}`}
            ref={anchor}
            collapsable={false}
            pointerEvents="none"
            style={{ width: 1, height: 1 }}
          />,
        );
      out.push(
        <Text key={`${key}-${at}`} style={style} testID="search-mark">
          {text.slice(at, at + query.length)}
        </Text>,
      );
      from = at + query.length;
      at = lower.indexOf(query, from);
    }
    if (from < text.length) out.push(text.slice(from));
    return out;
  };
}
