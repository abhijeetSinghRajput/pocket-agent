'use client';

import Image from 'next/image';
import { Info, LayoutGrid, RotateCw, Trash2 } from 'lucide-react';
import { Count, Phone, Stage, type Act } from './kit';
import { useStageLook } from './look';
import './home.css';

// Adding the Android widget, as Android does it: a long press on Pocket Agent's app icon (top
// right of the home screen) opens its shortcuts; Widgets opens the app's widget drawer from the
// bottom; a tap on the widget there adds it: the drawer goes and the widget lands on the home
// screen with a small bounce, then fills with the PC's usage. The widget itself is drawn as the app draws it
// (apps/mobile/src/widget/usage-widget.tsx): "Claude usage" and the plan, a refresh button, one
// meter per limit with when it resets, the PC it came from; past 75% amber, past 90% red. The loop
// ends as it would on a phone: a long press on the widget, Remove.
//

type W = {
  press: { on: boolean; x: number; y: number };
  shortcuts: boolean;
  drawer: boolean;
  placed: boolean;
  loaded: boolean;
  removeMenu: boolean;
};

const START: W = {
  press: { on: false, x: 0, y: 0 },
  shortcuts: false,
  drawer: false,
  placed: false,
  loaded: false,
  removeMenu: false,
};
const POSTER: W = { ...START, placed: true, loaded: true };

const USAGE = { session: 81, weekly: 34, model: 19 };

/** A long press: the finger lands, a ring spreads under it while it holds, then lets go. */
async function longPress(a: Act<W>, target: string, x = 0.5, y = 0.5) {
  const r = a.rect(target);
  await a.click({ at: target, x, y });
  await a.set({ press: { on: true, x: r.x + r.width * x, y: r.y + r.height * y } });
  await a.wait(560);
  await a.set((s) => ({ press: { ...s.press, on: false } }));
}

async function script(a: Act<W>) {
  await a.wait(600);
  // Long press on the app icon: its shortcuts
  await longPress(a, 'app-icon');
  await a.set({ shortcuts: true });
  await a.wait(800);
  // Widgets: the app's widget drawer rises from the bottom
  await a.click({ at: 'shortcut-widgets', x: 0.7, y: 0.5 });
  await a.set({ shortcuts: false, drawer: true });
  await a.wait(1100);
  // A tap on the widget: the drawer goes and the widget lands on the home screen
  await a.click({ at: 'widget-preview', x: 0.5, y: 0.5 });
  await a.set({ drawer: false, placed: true });
  await a.wait(500);
  await a.set({ loaded: true });
  await a.wait(3000);
  // Done with it: long press on the widget, Remove
  await longPress(a, 'widget-spot', 0.5, 0.3);
  await a.set({ removeMenu: true });
  await a.wait(650);
  await a.click({ at: 'widget-remove', x: 0.6, y: 0.5 });
  await a.set({ removeMenu: false, placed: false });
  await a.wait(500);
  await a.snap({ loaded: false });
  await a.wait(150);
}

function tone(v: number) {
  return v >= 90 ? 'danger' : v >= 75 ? 'warning' : 'primary';
}

function Meter({ label, value, reset }: { label: string; value: number; reset: string }) {
  return (
    <div className="pa-w-meter">
      <div className="pa-w-row">
        <span className="pa-w-label">{label}</span>
        <span className="pa-w-value">
          <Count value={value} format={(n) => `${Math.round(n)}%`} />
        </span>
      </div>
      <div className="pa-w-track">
        <div className="pa-w-fill" data-tone={tone(value)} style={{ transform: `scaleX(${value / 100})` }} />
      </div>
      <div className="pa-w-reset">{reset}</div>
    </div>
  );
}

/** The widget as the app draws it. `loaded` false: just placed, still fetching from the PC. */
function UsageWidget({ dark, loaded }: { dark: boolean; loaded: boolean }) {
  const v = loaded ? USAGE : { session: 0, weekly: 0, model: 0 };
  return (
    <div className="pa-w" data-dark={dark || undefined}>
      <div className="pa-w-head">
        <span>
          <span className="pa-w-title">Claude usage</span>
          <span className="pa-w-plan"> · Max 5x</span>
        </span>
        <span className="pa-w-refresh" data-spinning={!loaded || undefined}>
          <RotateCw size={18} strokeWidth={2.2} aria-hidden />
        </span>
      </div>
      <Meter label="Session (5hr)" value={v.session} reset="Resets at 11:09 PM" />
      <Meter label="Weekly (7 day)" value={v.weekly} reset="Resets Fri, Nov 27 at 1:29 AM" />
      <Meter label="Opus limit" value={v.model} reset="Resets Mon, Nov 30 at 9:00 AM" />
      <div className="pa-w-foot">
        <span>Studio-PC</span>
        <span className="pa-w-updated" data-fresh={loaded || undefined}>
          <span className="pa-w-upd pa-w-upd--old">Updating…</span>
          <span className="pa-w-upd pa-w-upd--new">Updated just now</span>
        </span>
      </div>
    </div>
  );
}

export function WidgetDemo() {
  const look = useStageLook();
  const dark = look.theme === 'dark';
  return (
    <Stage
      width={380}
      height={700}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ style: 'touch', at: { x: 300, y: 640 } }}
      className="pa-feat pa-feat--widget"
      {...look}
    >
      {(s) => {
        return (
          <>
            <Phone
              width={344}
              screenHeight={820}
              frame="android"
              dark
              wallpaper="linear-gradient(160deg, #f2a36f 0%, #c8562a 55%, #6d2a1a 100%)"
              className="pa-phone"
            >
              <div className="pa-home">
                <div className="pa-glance">
                  <div className="pa-glance-day">Thu, Nov 26</div>
                  <div className="pa-glance-sub">24°C · Clear</div>
                </div>

                {/* Pocket Agent on the home screen */}
                <div className="pa-appicon" data-target="app-icon" data-held={s.shortcuts || undefined}>
                  <Image src="/icons/icon-192.png" alt="" width={60} height={60} />
                  <span>Pocket Agent</span>
                </div>

                {/* The spot the widget goes to, and the widget once it is there */}
                <div className="pa-spot" data-target="widget-spot" style={{ top: 118, left: 20 }}>
                  <div className="pa-spot-widget" data-placed={s.placed || undefined}>
                    <UsageWidget dark={dark} loaded={s.loaded} />
                  </div>
                </div>

                {/* The app icon's shortcuts, under the icon */}
                <div className="pa-shortcuts" data-open={s.shortcuts || undefined}>
                  <div className="pa-hmenu-row" data-target="shortcut-widgets">
                    <LayoutGrid size={20} aria-hidden /> Widgets
                  </div>
                  <div className="pa-hmenu-row">
                    <Info size={20} aria-hidden /> App info
                  </div>
                </div>

                {/* The app's widget drawer, from the bottom */}
                <div className="pa-drawer" data-open={s.drawer || undefined}>
                  <span className="pa-sheet-handle" />
                  <div className="pa-drawer-head">
                    <Image
                      src="/icons/icon-192.png"
                      alt=""
                      width={28}
                      height={28}
                      className="pa-sheet-icon"
                    />
                    <div>
                      <div className="pa-sheet-name">Pocket Agent</div>
                      <div className="pa-sheet-sub">Claude usage · 4 × 3 · Tap to add</div>
                    </div>
                  </div>
                  {/* The preview: a tap adds it to the home screen */}
                  <div className="pa-drawer-slot" data-target="widget-preview">
                    <div className="pa-drawer-mini">
                      <UsageWidget dark={dark} loaded />
                    </div>
                  </div>
                </div>

                {/* The widget's own long-press menu */}
                <div className="pa-hmenu pa-hmenu--widget" data-open={s.removeMenu || undefined}>
                  <div className="pa-hmenu-row" data-target="widget-remove">
                    <Trash2 size={20} aria-hidden /> Remove
                  </div>
                </div>
              </div>
            </Phone>
            {/* The finger held down (stage coordinates, over the phone) */}
            <span
              className="pa-press"
              data-on={s.press.on || undefined}
              style={{ left: s.press.x, top: s.press.y }}
              aria-hidden
            />
          </>
        );
      }}
    </Stage>
  );
}
