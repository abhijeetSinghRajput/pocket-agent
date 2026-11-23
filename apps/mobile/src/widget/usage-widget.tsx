import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import type { WidgetUsage } from '@/widget/data';

/**
 * The home-screen widget: Claude plan usage of your PC (the 5-hour session and the 7-day limit),
 * the same numbers as the Profile screen. Drawn by Android from this description: no hooks, no
 * animation, only the widget primitives.
 */

interface Palette {
  bg: ColorProp;
  fg: ColorProp;
  muted: ColorProp;
  track: ColorProp;
  primary: ColorProp;
  warning: ColorProp;
  danger: ColorProp;
}
const LIGHT: Palette = {
  bg: '#ffffff',
  fg: '#151619',
  muted: '#616369',
  track: '#e6e7ea',
  primary: '#c64200',
  warning: '#da950b',
  danger: '#d02b31',
};
const DARK: Palette = {
  bg: '#1d1d20',
  fg: '#eeeef0',
  muted: '#aeb1b8',
  track: '#3a3a3f',
  primary: '#f67f2f',
  warning: '#edb345',
  danger: '#ed5350',
};

const SEMIBOLD = 'Geist_600SemiBold';
const MEDIUM = 'Geist_500Medium';
const REGULAR = 'Geist_400Regular';

function Meter({ label, percent, p }: { label: string; percent: number; p: Palette }) {
  const value = Math.round(Math.max(0, Math.min(100, percent)));
  const color = value >= 90 ? p.danger : value >= 75 ? p.warning : p.primary;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <TextWidget text={label} style={{ fontSize: 13, fontFamily: MEDIUM, color: p.fg }} maxLines={1} />
        <TextWidget text={`${value}%`} style={{ fontSize: 15, fontFamily: SEMIBOLD, color: p.fg }} />
      </FlexWidget>
      <FlexWidget
        style={{
          width: 'match_parent',
          height: 7,
          marginTop: 5,
          borderRadius: 4,
          backgroundColor: p.track,
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        {value > 0 && <FlexWidget style={{ flex: value, height: 7, borderRadius: 4, backgroundColor: color }} />}
        {value < 100 && <FlexWidget style={{ flex: 100 - value, height: 7 }} />}
      </FlexWidget>
    </FlexWidget>
  );
}

/** "3:40 PM" today, otherwise "Fri 3:40 PM". */
function resetText(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now) return null;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return `Session resets at ${time}`;
  return `Session resets ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

function Frame({ p, children }: { p: Palette; children: React.ReactNode }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Claude usage. Opens Pocket Agent."
      style={{
        width: 'match_parent',
        height: 'match_parent',
        backgroundColor: p.bg,
        borderRadius: 24,
        padding: 16,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {children}
    </FlexWidget>
  );
}

function Message({ p, title, body }: { p: Palette; title: string; body: string }) {
  return (
    <Frame p={p}>
      <TextWidget text="Claude usage" style={{ fontSize: 13, fontFamily: SEMIBOLD, color: p.primary }} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
        <TextWidget text={title} style={{ fontSize: 15, fontFamily: SEMIBOLD, color: p.fg }} maxLines={1} />
        <TextWidget
          text={body}
          style={{ fontSize: 12, fontFamily: REGULAR, color: p.muted, marginTop: 2 }}
          maxLines={2}
        />
      </FlexWidget>
    </Frame>
  );
}

function Usage({ usage, p, now }: { usage: WidgetUsage; p: Palette; now: number }) {
  if (usage.state === 'signed-out') {
    return <Message p={p} title="Not signed in" body="Open Pocket Agent and sign in." />;
  }
  if (usage.state === 'none') {
    return <Message p={p} title="No usage yet" body="It appears once your PC is connected and reports it." />;
  }
  const footer = (usage.session ? resetText(usage.session.resetsAt, now) : null) ?? usage.deviceName;
  return (
    <Frame p={p}>
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <TextWidget text="Claude usage" style={{ fontSize: 13, fontFamily: SEMIBOLD, color: p.primary }} />
        <TextWidget
          text={usage.deviceName}
          style={{ fontSize: 11, fontFamily: REGULAR, color: p.muted }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
      {usage.session && <Meter label="Session (5hr)" percent={usage.session.percent} p={p} />}
      {usage.weekly && <Meter label="Weekly (7 day)" percent={usage.weekly.percent} p={p} />}
      <TextWidget
        text={footer}
        style={{ fontSize: 11, fontFamily: REGULAR, color: p.muted }}
        maxLines={1}
        truncate="END"
      />
    </Frame>
  );
}

/** Light and dark versions; Android shows the one that matches the system theme. */
export function usageWidget(usage: WidgetUsage, now = Date.now()) {
  return {
    light: <Usage usage={usage} p={LIGHT} now={now} />,
    dark: <Usage usage={usage} p={DARK} now={now} />,
  };
}
