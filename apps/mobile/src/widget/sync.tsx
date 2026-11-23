import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { requestPinWidget, requestWidgetUpdate } from 'react-native-android-widget';
import { useDevices } from '@/lib/data';
import { pickUsage, saveWidgetUsage, USAGE_WIDGET, type WidgetUsage } from '@/widget/data';
import { usageWidget } from '@/widget/usage-widget';

async function push(usage: WidgetUsage): Promise<void> {
  await saveWidgetUsage(usage);
  if (Platform.OS !== 'android') return;
  await requestWidgetUpdate({ widgetName: USAGE_WIDGET, renderWidget: () => usageWidget(usage) }).catch(
    () => undefined,
  );
}

/** While the app is open, the home-screen widget follows the same numbers the app shows. */
export function useWidgetSync(): void {
  const devices = useDevices().state.data;
  const last = useRef('');
  useEffect(() => {
    if (!devices) return;
    const usage = pickUsage(devices);
    const key = JSON.stringify(usage);
    if (key === last.current) return;
    last.current = key;
    void push(usage);
  }, [devices]);
}

/** After signing out the widget says so instead of showing the last account's numbers. */
export const widgetSignedOut = () => push({ state: 'signed-out' });

/** Home-screen widgets exist on Android only. */
export const widgetsSupported = Platform.OS === 'android';

/** Asks the launcher to place the usage widget (Android shows its own confirmation). */
export async function addUsageWidget(): Promise<boolean> {
  if (!widgetsSupported) return false;
  return requestPinWidget({ widgetName: USAGE_WIDGET }).catch(() => false);
}
