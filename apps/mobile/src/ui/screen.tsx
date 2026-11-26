import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  RefreshControl,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { enter } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { IconButton, T } from '@/ui/core';
import { ConnectionStrip } from '@/ui/connection-strip';

/** Height of the floating tab bar above the bottom inset (content pads itself by this). */
export const TAB_BAR_HEIGHT = 64;

/** A tab's page: a large title with optional actions, then scrolling content. */
export function Screen({
  title,
  subtitle,
  actions,
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  tabBar = true,
  contentStyle,
  pinned,
  scrollRef,
  onScroll,
  overlay,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** False when the content is its own list (it scrolls itself). */
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Leave room for the tab bar at the bottom. */
  tabBar?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Stays at the top with the title while the content scrolls under it (a screen's tabs). With it,
   * the title stays too.
   */
  pinned?: ReactNode;
  scrollRef?: Ref<ComponentRef<typeof ScrollView>>;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Floats over the content, above the tab bar (e.g. a button that jumps down the page). */
  overlay?: ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = insets.bottom + (tabBar ? TAB_BAR_HEIGHT : 0) + 24;
  const header = (
    <Animated.View
      entering={enter.fade}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 14,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="title" accessibilityRole="header">
          {title}
        </T>
        {subtitle && (
          <T variant="small" tone="muted">
            {subtitle}
          </T>
        )}
      </View>
      {actions}
    </Animated.View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
      <ConnectionStrip />
      {pinned !== undefined && (
        <View style={{ backgroundColor: c.background, zIndex: 1 }}>
          {header}
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>{pinned}</View>
        </View>
      )}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={onScroll ? 32 : undefined}
          contentContainerStyle={[{ paddingBottom: bottom }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={c.primary}
                colors={[c.primary]}
                progressBackgroundColor={c.card}
              />
            ) : undefined
          }
        >
          {pinned === undefined && header}
          {children}
        </ScrollView>
      ) : (
        <>
          {pinned === undefined && header}
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        </>
      )}
      {overlay}
    </View>
  );
}

/** The bar on top of a pushed screen: back, a title, optional actions. */
export function NavBar({
  title,
  subtitle,
  right,
  onBack,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        paddingTop: insets.top + 4,
        paddingBottom: 8,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: c.bar,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <IconButton
        icon={ArrowLeft}
        label="Back"
        tone="default"
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <T variant="subheading" numberOfLines={1}>
            {title}
          </T>
        ) : (
          title
        )}
        {typeof subtitle === 'string' ? (
          <T variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </T>
        ) : (
          subtitle
        )}
      </View>
      {right}
    </View>
  );
}
