import { BellRing } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { currentPushState, disablePush, enablePush, type PushState } from '@/lib/push';
import { useTheme } from '@/lib/theme';
import { Button, buzz, IconTile, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { Toggle } from '@/ui/form';

/**
 * Notifications on this phone: one switch. Off by default; turning it on asks Android for
 * permission and registers this phone with the account. The server's push availability is
 * reported by the Profile screen (`serverAvailable`).
 */
export function PushThisDevice({
  serverAvailable,
  onChanged,
}: {
  serverAvailable: boolean;
  onChanged: () => void;
}) {
  const { c } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void currentPushState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);

  async function toggle(on: boolean) {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (on) {
        const next = await enablePush();
        setState(next);
        buzz(next.status === 'on');
        if (next.status === 'denied') setError('Notifications are off for Pocket Agent in Android settings.');
      } else {
        await disablePush();
        setState({ status: 'off' });
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      buzz(false);
    } finally {
      setBusy(false);
    }
  }

  const on = state?.status === 'on';
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon={BellRing} size={40} tone={on ? 'primary' : 'muted'} />
        <View style={{ flex: 1 }}>
          <T variant="bodyMedium">Notifications on this phone</T>
          <T variant="caption" tone="muted">
            {state?.status === 'unsupported'
              ? state.reason
              : !serverAvailable
                ? 'Push is not set up on the server.'
                : on
                  ? 'Permission requests and activity reach you here.'
                  : 'Get permission requests and activity when the app is closed.'}
          </T>
        </View>
        <Toggle
          label="Notifications on this phone"
          value={on}
          disabled={busy || !state || state.status === 'unsupported' || !serverAvailable}
          onChange={(next) => void toggle(next)}
          testID="push-switch"
        />
      </View>
      {state?.status === 'denied' && (
        <Button
          label="Open Android settings"
          variant="outline"
          size="sm"
          onPress={() => void Linking.openSettings()}
          style={{ alignSelf: 'flex-start', borderColor: c.border }}
        />
      )}
      {error && <Notice>{error}</Notice>}
    </View>
  );
}
