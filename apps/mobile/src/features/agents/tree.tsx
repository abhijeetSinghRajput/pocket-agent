import type { ReactNode } from 'react';
import { View } from 'react-native';
import { alpha, useTheme } from '@/lib/theme';
import { ROW_DOT_Y } from './worker-row';

/** How far a child row sits in from its parent, and where its branch line runs. */
export const TREE_INDENT = 28;
const LINE_X = 13;
/** Where the branch meets the row: its status dot. */
const ELBOW_Y = ROW_DOT_Y;

/**
 * One child in a tree, like a file tree: a line comes down from the parent and turns into the row
 * (├──); the last child's line stops at its row (└──).
 */
export function TreeBranch({ last, children }: { last: boolean; children: ReactNode }) {
  const { c } = useTheme();
  const line = alpha(c.mutedForeground, 0.35);
  return (
    <View style={{ paddingLeft: TREE_INDENT }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: LINE_X,
          top: 0,
          width: 1.5,
          height: last ? ELBOW_Y : '100%',
          backgroundColor: line,
          borderBottomLeftRadius: last ? 6 : 0,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: LINE_X,
          top: ELBOW_Y - 1,
          width: TREE_INDENT - LINE_X - 2,
          height: 1.5,
          backgroundColor: line,
        }}
      />
      {children}
    </View>
  );
}

/** Children of a node, each on its branch. */
export function TreeChildren<T>({
  items,
  keyOf,
  render,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  return items.map((item, i) => (
    <TreeBranch key={keyOf(item)} last={i === items.length - 1}>
      {render(item)}
    </TreeBranch>
  ));
}
