import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceListResponse, type DeviceDto } from '@pocket-agent/protocol';
import { API_URL } from '@/lib/api';
import { loadToken } from '@/lib/session';

/** One limit on the widget: its name, how much is used, when it resets. */
export interface UsageMeter {
  label: string;
  percent: number;
  resetsAt: string | null;
}

/** What the usage widget shows. Kept on the phone so the widget can draw without the network. */
export type WidgetUsage =
  | { state: 'signed-out' }
  | { state: 'none' }
  | {
      state: 'ok';
      deviceName: string;
      session: { percent: number; resetsAt: string | null } | null;
      weekly: { percent: number; resetsAt: string | null } | null;
      /** Model limits (e.g. "Fable limit"); missing in data saved by older versions. */
      models?: UsageMeter[];
      /** "Max 5x"; when the PC's Claude sign-in ends (PC agents from 0.1.5). */
      plan?: string | null;
      loginExpiresAt?: string | null;
      updatedAt: string;
    };

export const USAGE_WIDGET = 'Usage';
const KEY = 'pocket-agent.widget.usage';

/** The PC whose usage to show: the one that reported most recently (online ones first). */
export function pickUsage(devices: DeviceDto[]): WidgetUsage {
  const withUsage = devices
    .filter(
      (d) =>
        d.status !== 'Revoked' && d.usage && (d.usage.session || d.usage.weekly || d.usage.models.length),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'Online') - Number(a.status === 'Online') ||
        Date.parse(b.usage!.updatedAt) - Date.parse(a.usage!.updatedAt),
    );
  const d = withUsage[0];
  if (!d?.usage) return { state: 'none' };
  const win = (w: { percent: number; resetsAt: string | null } | null) =>
    w ? { percent: w.percent, resetsAt: w.resetsAt } : null;
  return {
    state: 'ok',
    deviceName: d.name,
    session: win(d.usage.session),
    weekly: win(d.usage.weekly),
    models: d.usage.models.map((m) => ({
      label: `${m.name} limit`,
      percent: m.percent,
      resetsAt: m.resetsAt,
    })),
    plan: d.usage.plan ?? null,
    loginExpiresAt: d.usage.loginExpiresAt ?? null,
    updatedAt: d.usage.updatedAt,
  };
}

export async function saveWidgetUsage(usage: WidgetUsage): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(usage)).catch(() => undefined);
}

export async function cachedWidgetUsage(): Promise<WidgetUsage> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as WidgetUsage;
  } catch {
    /* fall through */
  }
  return { state: 'none' };
}

/**
 * Fresh usage for the widget, fetched by itself (Android runs this without the app's screens).
 * Falls back to what was last saved when offline or slow.
 */
export async function freshWidgetUsage(timeoutMs = 8000): Promise<WidgetUsage> {
  const token = await loadToken();
  if (!token) {
    const out: WidgetUsage = { state: 'signed-out' };
    await saveWidgetUsage(out);
    return out;
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/devices`, {
      credentials: 'omit',
      signal: abort.signal,
      headers: { 'x-pocket-agent-client': 'mobile', authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { state: 'signed-out' };
    if (!res.ok) return cachedWidgetUsage();
    const parsed = DeviceListResponse.safeParse(await res.json());
    if (!parsed.success) return cachedWidgetUsage();
    const usage = pickUsage(parsed.data.devices);
    await saveWidgetUsage(usage);
    return usage;
  } catch {
    return cachedWidgetUsage();
  } finally {
    clearTimeout(timer);
  }
}
