import { CircleCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectStatus, ConnectSteps, type ConnectMode } from '@/features/devices/connect-steps';
import { usePairing } from '@/features/devices/use-pairing';
import { enter } from '@/lib/motion';
import { alpha, radius, useTheme } from '@/lib/theme';
import { playSound } from '@/lib/sound';
import { Button, buzz, T } from '@/ui/core';
import { Sheet } from '@/ui/sheet';

/** "Add device": the two commands in a sheet, following the PC live until it is paired. */
export function AddDeviceSheet({
  open,
  onClose,
  knownDeviceIds,
  onPaired,
}: {
  open: boolean;
  onClose: () => void;
  knownDeviceIds: string[];
  onPaired: () => void;
}) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { step, now, regenerate } = usePairing({ active: open, knownDeviceIds, onPaired });
  const paired = step.kind === 'paired';
  const [mode, setMode] = useState<ConnectMode>('scan');

  useEffect(() => {
    if (open && paired) {
      buzz(true);
      playSound('landed');
    }
  }, [open, paired]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={paired ? 'Device paired' : 'Pair a device'}
      description={paired ? undefined : 'Run these in a terminal on the PC.'}
    >
      {paired ? (
        <Animated.View entering={enter.fade} style={{ gap: 20, paddingBottom: 4 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 12,
              padding: 16,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: alpha(c.success, 0.3),
              backgroundColor: alpha(c.success, 0.1),
            }}
          >
            <Animated.View entering={enter.pop} style={{ marginTop: 2 }}>
              <CircleCheck size={20} color={c.success} strokeWidth={2.2} />
            </Animated.View>
            <T variant="small" style={{ flex: 1 }}>
              <T variant="smallMedium">{step.device.name}</T>{' '}
              {step.device.status === 'Online'
                ? 'is connected and online.'
                : 'is paired. It shows as Online in a moment.'}
            </T>
          </View>
          <Button label="Done" onPress={onClose} style={{ alignSelf: 'flex-end' }} />
        </Animated.View>
      ) : (
        // A gesture-handler ScrollView: scrolling the steps does not drag the sheet; the handle does.
        <ScrollView
          style={{ maxHeight: height - insets.top - insets.bottom - 200 }}
          contentContainerStyle={{ paddingBottom: 4 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: 12 }}>
            <ConnectSteps
              step={step}
              now={now}
              regenerate={() => void regenerate()}
              mode={mode}
              onModeChange={setMode}
            />
            <ConnectStatus step={step} mode={mode} />
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}
