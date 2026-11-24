import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLiveConnection } from '@/lib/live';
import { enter, exit } from '@/lib/motion';
import { alpha, useTheme } from '@/lib/theme';
import { Spinner, T } from '@/ui/core';

/** Down this long before the strip shows: starting up, or a blip, says nothing. */
const SHOW_AFTER_MS = 2500;

/**
 * A thin strip saying live updates are reconnecting, so a quiet screen is never taken for a stuck
 * one. It shows only when they have been down for a moment, and leaves when they are back (the
 * screens check by themselves meanwhile).
 */
export function ConnectionStrip() {
  const { c } = useTheme();
  // No live connection here at all (signed out): nothing to say.
  const state = useLiveConnection();
  const live = state === null || state === 'live';
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (live) {
      const t = setTimeout(() => setDown(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [live]);
  if (!down) return null;
  return (
    <Animated.View
      entering={enter.fade}
      exiting={exit.fade}
      accessibilityRole="alert"
      accessibilityLabel="Reconnecting to live updates"
      testID="connection-strip"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 5,
        backgroundColor: alpha(c.warning, 0.14),
      }}
    >
      <View style={{ transform: [{ scale: 0.7 }] }}>
        <Spinner tone="warning" />
      </View>
      <T variant="captionMedium" style={{ color: c.warning }}>
        Reconnecting… updates may be late
      </T>
    </Animated.View>
  );
}
