import { router, type ErrorBoundaryProps } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { Button, IconTile, T } from '@/ui/core';

/**
 * Shown in place of a screen that failed to draw (expo-router's `ErrorBoundary` export), instead
 * of the app closing: try again, or go back to the chats.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="alert"
      testID="crash-screen"
      style={{
        flex: 1,
        backgroundColor: c.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        paddingHorizontal: 32,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <IconTile icon={TriangleAlert} tone="danger" size={56} />
      <T variant="heading" center>
        Something went wrong
      </T>
      <T variant="small" tone="muted" center numberOfLines={4}>
        This screen couldn’t be shown. {error.message}
      </T>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Button
          label="Go to chats"
          variant="outline"
          onPress={() => {
            if (router.canDismiss()) router.dismissAll();
            router.replace('/');
          }}
        />
        <Button label="Try again" onPress={() => void retry()} />
      </View>
    </View>
  );
}
