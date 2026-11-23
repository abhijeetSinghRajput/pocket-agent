// Not compiled by the React Compiler: the widget library calls these components as plain
// functions, outside React, so the compiler's memo hooks would crash and the widget stay blank.
'use no memo';

import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
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

/** The click action of the refresh button (handled in task-handler). */
export const REFRESH_ACTION = 'REFRESH';

/** Lucide's rotate-cw, drawn in `color`. */
const refreshSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;

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
        {value > 0 && (
          <FlexWidget style={{ flex: value, height: 7, borderRadius: 4, backgroundColor: color }} />
        )}
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

/** The header: the widget's name, and the refresh button (a generous tap target). */
function Header({ p, refreshing }: { p: Palette; refreshing: boolean }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <TextWidget text="Claude usage" style={{ fontSize: 13, fontFamily: SEMIBOLD, color: p.primary }} />
      <FlexWidget
        clickAction={REFRESH_ACTION}
        accessibilityLabel={refreshing ? 'Updating' : 'Refresh'}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          marginTop: -8,
          marginRight: -8,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: refreshing ? p.track : '#00000000',
        }}
      >
        <SvgWidget svg={refreshSvg(String(refreshing ? p.muted : p.fg))} style={{ width: 17, height: 17 }} />
      </FlexWidget>
    </FlexWidget>
  );
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

function Message({
  p,
  title,
  body,
  refreshing,
}: {
  p: Palette;
  title: string;
  body: string;
  refreshing: boolean;
}) {
  return (
    <Frame p={p}>
      <Header p={p} refreshing={refreshing} />
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

/** "Updated 3:42 PM" (today) or "Updated Fri 3:42 PM": when the PC last reported these numbers. */
function updatedText(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return `Updated ${time}`;
  return `Updated ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

function Usage({
  usage,
  p,
  now,
  refreshing,
}: {
  usage: WidgetUsage;
  p: Palette;
  now: number;
  refreshing: boolean;
}) {
  if (usage.state === 'signed-out') {
    return (
      <Message p={p} refreshing={refreshing} title="Not signed in" body="Open Pocket Agent and sign in." />
    );
  }
  if (usage.state === 'none') {
    return (
      <Message
        p={p}
        refreshing={refreshing}
        title="No usage yet"
        body="It appears once your PC is connected and reports it."
      />
    );
  }
  const reset = (usage.session ? resetText(usage.session.resetsAt, now) : null) ?? usage.deviceName;
  return (
    <Frame p={p}>
      <Header p={p} refreshing={refreshing} />
      {usage.session && <Meter label="Session (5hr)" percent={usage.session.percent} p={p} />}
      {usage.weekly && <Meter label="Weekly (7 day)" percent={usage.weekly.percent} p={p} />}
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <TextWidget
          text={reset}
          style={{ fontSize: 11, fontFamily: REGULAR, color: p.muted }}
          maxLines={1}
          truncate="END"
        />
        <TextWidget
          text={refreshing ? 'Updating…' : updatedText(usage.updatedAt, now)}
          style={{
            fontSize: 11,
            fontFamily: refreshing ? MEDIUM : REGULAR,
            color: refreshing ? p.primary : p.muted,
          }}
          maxLines={1}
        />
      </FlexWidget>
    </Frame>
  );
}

/**
 * Light and dark versions; Android shows the one that matches the system theme. `refreshing` draws
 * the moment between a tap on refresh and the new numbers.
 */
export function usageWidget(usage: WidgetUsage, now = Date.now(), refreshing = false) {
  return {
    light: <Usage usage={usage} p={LIGHT} now={now} refreshing={refreshing} />,
    dark: <Usage usage={usage} p={DARK} now={now} refreshing={refreshing} />,
  };
}
