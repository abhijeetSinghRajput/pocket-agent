import { createContext, useContext, type ReactNode } from 'react';
import { Text } from 'react-native';
import { alpha, useTheme } from '@/lib/theme';

/** The words being searched for in the chat ('' when not searching). */
export const SearchQuery = createContext('');

/** Marks a piece of text: the searched words in it, like a highlighter. */
export type Mark = (text: string, key?: string) => ReactNode;

const plain: Mark = (text) => text;

/**
 * The marker for the chat's search: each occurrence of the searched words (case aside) gets an
 * orange highlight behind it. Without a search, text is left as it is.
 */
export function useMark(): Mark {
  const query = useContext(SearchQuery).trim().toLowerCase();
  const { c } = useTheme();
  if (query.length < 2) return plain;
  const style = { backgroundColor: alpha(c.primary, 0.32), color: c.foreground, borderRadius: 3 };
  return (text, key = 'm') => {
    const lower = text.toLowerCase();
    if (!lower.includes(query)) return text;
    const out: ReactNode[] = [];
    let from = 0;
    let at = lower.indexOf(query);
    while (at !== -1) {
      if (at > from) out.push(text.slice(from, at));
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
