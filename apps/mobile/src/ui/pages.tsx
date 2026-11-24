import { Fragment, useEffect, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { settleSpring } from '@/lib/motion';

/**
 * A screen's tabs as pages side by side: swipe between them, or pick one with the tab control
 * (`value`), and the strip follows. A drag past a third of the screen, or a flick, turns the page;
 * past either end the strip only gives a little.
 */
export function SwipePages<T extends string>({
  pages,
  value,
  onChange,
  children,
}: {
  pages: readonly T[];
  value: T;
  onChange: (page: T) => void;
  /** Draws one page, `width` wide. */
  children: (page: T, width: number) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const index = Math.max(0, pages.indexOf(value));
  const count = pages.length;
  // Where the strip sits (0 = first page, -width = second…) and which page it is settled on.
  const x = useSharedValue(-index * width);
  const page = useSharedValue(index);
  useEffect(() => {
    page.set(index);
    x.set(withSpring(-index * width, settleSpring));
  }, [index, width, x, page]);

  const choose = (to: number) => onChange(pages[to]!);
  const pan = usePanGesture({
    activeOffsetX: [-16, 16],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      const last = -(count - 1) * width;
      let next = -page.get() * width + e.translationX;
      if (next > 0) next *= 0.25;
      else if (next < last) next = last + (next - last) * 0.25;
      x.set(next);
    },
    onDeactivate: (e) => {
      'worklet';
      const from = page.get();
      const step =
        e.translationX < -width * 0.3 || e.velocityX < -600
          ? 1
          : e.translationX > width * 0.3 || e.velocityX > 600
            ? -1
            : 0;
      const to = Math.min(count - 1, Math.max(0, from + step));
      page.set(to);
      x.set(withSpring(-to * width, { ...settleSpring, velocity: e.velocityX }));
      if (to !== from) scheduleOnRN(choose, to);
    },
  });
  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1, flexDirection: 'row', width: width * count }, strip]}>
        {pages.map((p) => (
          <Fragment key={p}>{children(p, width)}</Fragment>
        ))}
      </Animated.View>
    </GestureDetector>
  );
}
