import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { dur, ease } from '@/lib/motion';
import { radius, useTheme } from '@/lib/theme';
import { T } from '@/ui/core';

/**
 * A panel that rises from the bottom edge over a dimmed screen. It follows the finger when dragged
 * down and leaves the way it came (drag past a third, flick, tap outside, or the back button).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** False for something that must be answered (a confirmation in progress). */
  dismissable?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Stays mounted through the exit animation.
  const [mounted, setMounted] = useState(open);
  const y = useSharedValue(height);
  const dim = useSharedValue(0);

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      y.set(withTiming(0, { duration: dur.sheet, easing: ease.touch }));
      dim.set(withTiming(1, { duration: dur.enter, easing: ease.out }));
    } else {
      dim.set(withTiming(0, { duration: dur.enter, easing: ease.out }));
      y.set(
        withTiming(height, { duration: dur.enter, easing: ease.move }, (done) => {
          if (done) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [open, mounted, height, y, dim]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissable) onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, dismissable, onClose]);

  const pan = usePanGesture({
    enabled: dismissable,
    activeOffsetY: 10,
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      y.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > height * 0.22 || e.velocityY > 900) scheduleOnRN(onClose);
      else y.set(withTiming(0, { duration: dur.enter, easing: ease.touch }));
    },
  });

  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdrop = useAnimatedStyle(() => ({ opacity: dim.value }));

  if (!mounted) return null;
  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      {/* A Modal is its own window on Android: gestures inside it need their own root. */}
      <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }, backdrop]}>
          <Pressable
            style={{ flex: 1 }}
            accessibilityLabel="Close"
            onPress={dismissable ? onClose : undefined}
          />
        </Animated.View>
        <KeyboardAvoidingView behavior="padding">
          <Animated.View
            accessibilityViewIsModal
            style={[
              {
                backgroundColor: c.popover,
                borderTopLeftRadius: radius.xxl,
                borderTopRightRadius: radius.xxl,
                paddingBottom: insets.bottom + 16,
                maxHeight: height - insets.top - 24,
              },
              panel,
            ]}
          >
            {/* Drag down from the handle or the title; the content below scrolls on its own. */}
            <GestureDetector gesture={pan}>
              <View collapsable={false}>
                <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                  <View style={{ width: 40, height: 4.5, borderRadius: 3, backgroundColor: c.border }} />
                </View>
                {(title || description) && (
                  <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 4 }}>
                    {title && <T variant="heading">{title}</T>}
                    {description && (
                      <T variant="small" tone="muted">
                        {description}
                      </T>
                    )}
                  </View>
                )}
              </View>
            </GestureDetector>
            <View style={{ paddingHorizontal: 20 }}>{children}</View>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
