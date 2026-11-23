// Not compiled by the React Compiler: the widget library calls these components as plain
// functions, outside React, so the compiler's memo hooks would crash and the widget stay blank.
'use no memo';

import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import type { UsageMeter, WidgetUsage } from '@/widget/data';

/**
 * The home-screen widget: Claude plan usage of your PC, the same meters as the Profile screen
 * (the 5-hour session, the week, and model limits such as Fable), each with when it resets.
 * Drawn by Android from this description: no hooks, no animation, only the widget primitives.
 * Its content sits at the top; the foot says when the PC's Claude sign-in ends.
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

/** Lucide's rotate-cw in `color`, with room around it so the arrow head is never clipped. */
const refreshSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-2 -2 28 28" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;

const SEMIBOLD = 'Geist_600SemiBold';
const MEDIUM = 'Geist_500Medium';
const REGULAR = 'Geist_400Regular';

function time(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Resets at 11:09 PM" today, "Resets Fri, Nov 27 at 1:29 AM" otherwise (as on Profile). */
function resetText(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now) return null;
  if (d.toDateString() === new Date(now).toDateString()) return `Resets at ${time(d)}`;
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Resets ${day} at ${time(d)}`;
}

function Meter({ m, p, reset }: { m: UsageMeter; p: Palette; reset: string | null }) {
  const value = Math.round(Math.max(0, Math.min(100, m.percent)));
  const color = value >= 90 ? p.danger : value >= 75 ? p.warning : p.primary;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', marginTop: 10 }}>
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <TextWidget text={m.label} style={{ fontSize: 13, fontFamily: MEDIUM, color: p.fg }} maxLines={1} />
        <TextWidget text={`${value}%`} style={{ fontSize: 14, fontFamily: SEMIBOLD, color: p.fg }} />
      </FlexWidget>
      <FlexWidget
        style={{
          width: 'match_parent',
          height: 6,
          marginTop: 5,
          borderRadius: 3,
          backgroundColor: p.track,
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        {value > 0 && (
          <FlexWidget style={{ flex: value, height: 6, borderRadius: 3, backgroundColor: color }} />
        )}
        {value < 100 && <FlexWidget style={{ flex: 100 - value, height: 6 }} />}
      </FlexWidget>
      {reset && (
        <TextWidget
          text={reset}
          style={{ fontSize: 11, fontFamily: REGULAR, color: p.muted, marginTop: 3 }}
          maxLines={1}
          truncate="END"
        />
      )}
    </FlexWidget>
  );
}

/** The header: the widget's name, and the refresh button (a generous tap target, fully inside). */
function Header({ p, refreshing, plan }: { p: Palette; refreshing: boolean; plan?: string | null }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextWidget text="Claude usage" style={{ fontSize: 13, fontFamily: SEMIBOLD, color: p.primary }} />
        {plan ? (
          <TextWidget
            text={`  ·  ${plan}`}
            style={{ fontSize: 12, fontFamily: MEDIUM, color: p.muted }}
            maxLines={1}
          />
        ) : null}
      </FlexWidget>
      <FlexWidget
        clickAction={REFRESH_ACTION}
        accessibilityLabel={refreshing ? 'Updating' : 'Refresh'}
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: refreshing ? p.track : '#00000000',
        }}
      >
        <SvgWidget svg={refreshSvg(String(refreshing ? p.muted : p.fg))} style={{ width: 20, height: 20 }} />
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
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 14,
        flexDirection: 'column',
        justifyContent: 'flex-start',
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
      <TextWidget
        text={title}
        style={{ fontSize: 15, fontFamily: SEMIBOLD, color: p.fg, marginTop: 10 }}
        maxLines={1}
      />
      <TextWidget
        text={body}
        style={{ fontSize: 12, fontFamily: REGULAR, color: p.muted, marginTop: 2 }}
        maxLines={2}
      />
    </Frame>
  );
}

/** "PC sign-in valid until Dec 20" (the closest thing to an end date Claude Code shares). */
function loginText(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now) return 'PC sign-in to Claude expired';
  return `PC sign-in valid until ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** "Updated 3:42 PM" (today) or "Updated Fri 3:42 PM": when the PC last reported these numbers. */
function updatedText(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === new Date(now).toDateString()) return `Updated ${time(d)}`;
  return `Updated ${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time(d)}`;
}

/** The meters, in the Profile screen's order. Older saved data has no model limits. */
export function meters(usage: Extract<WidgetUsage, { state: 'ok' }>): UsageMeter[] {
  return [
    ...(usage.session ? [{ label: 'Session (5hr)', ...usage.session }] : []),
    ...(usage.weekly ? [{ label: 'Weekly (7 day)', ...usage.weekly }] : []),
    ...(usage.models ?? []),
  ];
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
  const list = meters(usage);
  // As on Profile: every meter says when it resets; the foot says when the PC's sign-in ends.
  const login = loginText(usage.loginExpiresAt ?? null, now);
  return (
    <Frame p={p}>
      <Header p={p} refreshing={refreshing} plan={usage.plan} />
      {list.map((m) => (
        <Meter key={m.label} m={m} p={p} reset={resetText(m.resetsAt, now)} />
      ))}
      <FlexWidget
        style={{
          width: 'match_parent',
          marginTop: 10,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <TextWidget
          text={login ?? usage.deviceName}
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
 * Light and dark versions; Android shows the one that matches the system theme. `refreshing` draws the moment between a tap on
 * refresh and the new numbers.
 */
export function usageWidget(
  usage: WidgetUsage,
  {
    height = 0,
    now = Date.now(),
    refreshing = false,
  }: { height?: number; now?: number; refreshing?: boolean } = {},
) {
  return {
    light: <Usage usage={usage} p={LIGHT} now={now} refreshing={refreshing} />,
    dark: <Usage usage={usage} p={DARK} now={now} refreshing={refreshing} />,
  };
}
