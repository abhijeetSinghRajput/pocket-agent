import {
  NOTIFICATION_CATEGORIES,
  NotificationSettingsDto,
  type NotificationCategory,
  type NotificationSettingsDto as Settings,
} from '@pocket-agent/protocol';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { PushThisDevice } from '@/features/profile/push-this-device';
import { apiRequest } from '@/lib/api';
import { enter, exit, layout } from '@/lib/motion';
import { usePoll } from '@/lib/query';
import { fonts, radius, useTheme } from '@/lib/theme';
import { Button, Divider, IconButton, Press, T, buzz } from '@/ui/core';
import { Notice, Roll, Skeleton } from '@/ui/feedback';
import { Toggle } from '@/ui/form';
import { Sheet } from '@/ui/sheet';

const LABELS: Record<NotificationCategory, { title: string; hint: string }> = {
  permission_required: {
    title: 'Permission requests',
    hint: 'Also during quiet hours.',
  },
  agent_failed: { title: 'Failures', hint: 'A turn ended with an error.' },
  device_disconnected: { title: 'PC offline', hint: 'No response for 2 minutes.' },
  task_completed: {
    title: 'Finished turns',
    hint: 'Chats started here, or any chat in Away mode.',
  },
  agent_started: { title: 'Chat started', hint: 'Every new chat.' },
};

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const wrap = (n: number, max: number) => ((n % max) + max) % max;

/** One column of the time picker: up, the value (rolling), down. */
function Stepper({
  label,
  value,
  onChange,
  step,
  max,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step: number;
  max: number;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <IconButton
        icon={ChevronUp}
        label={`${label} up`}
        size={44}
        filled
        onPress={() => onChange(wrap(value + step, max))}
      />
      <View style={{ height: 56, justifyContent: 'center', minWidth: 72, alignItems: 'center' }}>
        <Roll text={pad(value)} variant="display" />
      </View>
      <IconButton
        icon={ChevronDown}
        label={`${label} down`}
        size={44}
        filled
        onPress={() => onChange(wrap(value - step, max))}
      />
      <T variant="caption" tone="muted" style={{ marginTop: 4 }}>
        {label}
      </T>
    </View>
  );
}

/** A small in-app time picker (hour and minute steppers) for a quiet-hours edge. */
function TimeSheet({
  open,
  title,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onPick: (hhmm: string) => void;
}) {
  const [h0 = 0, m0 = 0] = value.split(':').map(Number);
  const [hour, setHour] = useState(h0);
  const [minute, setMinute] = useState(m0);
  // Re-read the current value each time the sheet opens.
  const [seen, setSeen] = useState<string | null>(null);
  if (open && seen !== value) {
    setSeen(value);
    setHour(h0);
    setMinute(m0);
  }
  if (!open && seen !== null) setSeen(null);
  return (
    <Sheet open={open} onClose={onClose} title={title} description="Quiet hours in your time zone.">
      <View style={{ gap: 20, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Stepper label="Hour" value={hour} onChange={setHour} step={1} max={24} />
          <T variant="display" tone="muted" style={{ marginBottom: 26 }}>
            :
          </T>
          <Stepper label="Minute" value={minute} onChange={setMinute} step={5} max={60} />
        </View>
        <Button
          label="Done"
          size="lg"
          full
          onPress={() => {
            onPick(`${pad(hour)}:${pad(minute)}`);
            onClose();
          }}
        />
      </View>
    </Sheet>
  );
}

/** "From 22:00": a time shown as a small field; tapping opens the picker. */
function TimeField({
  label,
  value,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <T variant="caption" tone="muted">
        {label}
      </T>
      <Press
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value}`}
        testID={testID}
        onPress={onPress}
        scale={0.96}
        style={{
          width: 112,
          height: 40,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: c.input,
          backgroundColor: c.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Roll text={value} variant="bodyMedium" />
      </Press>
    </View>
  );
}

/** Which notifications to send, quiet hours, and push on this phone. Saved as on the web. */
export function NotificationSettings() {
  const fetcher = useCallback(
    (signal: AbortSignal) => apiRequest('/notification-settings', NotificationSettingsDto, { signal }),
    [],
  );
  const { state, refresh } = usePoll(['notification-settings'], fetcher, 5 * 60_000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Settings | null>(null);
  const settings = override ?? state.data;
  const [quiet, setQuiet] = useState<{ start: string; end: string } | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      setOverride(
        await apiRequest('/notification-settings', NotificationSettingsDto, { method: 'PUT', body }),
      );
    } catch (err) {
      setError((err as Error).message);
      buzz(false);
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading')
    return (
      <Animated.View exiting={exit.fade} accessibilityState={{ busy: true }}>
        <Skeleton height={96} round={10} />
      </Animated.View>
    );
  if (!settings)
    return (
      <Animated.View entering={enter.fade} accessibilityRole="alert">
        <T variant="small" tone="danger">
          {state.error}
        </T>
      </Animated.View>
    );

  const q =
    quiet ??
    (settings.quietHours ? { start: settings.quietHours.start, end: settings.quietHours.end } : null);

  return (
    <Animated.View entering={enter.fade} layout={layout} style={{ gap: 24 }} testID="notification-settings">
      <View style={{ gap: 8 }}>
        <T variant="smallMedium">Push on this device</T>
        <PushThisDevice
          serverAvailable={settings.push.available}
          onChanged={() => void refresh().then(() => setOverride(null))}
        />
      </View>

      <View>
        <T variant="smallMedium">What to notify</T>
        <View style={{ marginTop: 4 }}>
          {(Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((cat, i) => (
            <View key={cat}>
              {i > 0 && <Divider />}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  paddingVertical: 10,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="smallMedium">{LABELS[cat].title}</T>
                  <T variant="caption" tone="muted">
                    {LABELS[cat].hint}
                  </T>
                </View>
                <Toggle
                  value={settings.categories[cat] ?? false}
                  label={LABELS[cat].title}
                  disabled={saving}
                  testID={`category-${cat}`}
                  onChange={() => void save({ categories: { [cat]: !settings.categories[cat] } })}
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      <Animated.View layout={layout}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="smallMedium">Quiet hours</T>
            <T variant="caption" tone="muted">
              No pushes, except permission requests.
            </T>
          </View>
          <Toggle
            value={settings.quietHours !== null}
            label="Quiet hours"
            disabled={saving}
            testID="quiet-switch"
            onChange={() => {
              if (settings.quietHours) {
                setQuiet(null);
                void save({ quietHours: null });
              } else {
                const def = { start: '22:00', end: '07:00' };
                setQuiet(def);
                void save({ quietHours: { ...def, timezone: deviceTimeZone() } });
              }
            }}
          />
        </View>
        {settings.quietHours && q && (
          <Animated.View entering={enter.fade} exiting={exit.fade} style={{ marginTop: 12, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <TimeField
                label="From"
                value={q.start}
                onPress={() => setPicking('start')}
                testID="quiet-start"
              />
              <TimeField label="To" value={q.end} onPress={() => setPicking('end')} testID="quiet-end" />
              <Button
                label="Save"
                variant="outline"
                size="sm"
                disabled={saving}
                testID="quiet-save"
                style={{ height: 40 }}
                onPress={() => void save({ quietHours: { ...q, timezone: deviceTimeZone() } })}
              />
            </View>
            <T variant="caption" tone="muted" testID="quiet-timezone" style={{ fontFamily: fonts.regular }}>
              Time zone: {settings.quietHours.timezone}
            </T>
            <TimeSheet
              open={picking !== null}
              title={picking === 'end' ? 'To' : 'From'}
              value={picking === 'end' ? q.end : q.start}
              onClose={() => setPicking(null)}
              onPick={(hhmm) => setQuiet(picking === 'end' ? { ...q, end: hhmm } : { ...q, start: hhmm })}
            />
          </Animated.View>
        )}
      </Animated.View>

      {error && <Notice>{error}</Notice>}
    </Animated.View>
  );
}
