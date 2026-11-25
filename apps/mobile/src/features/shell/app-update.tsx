import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { ArrowDownToLine, RefreshCw, Rocket } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { z } from 'zod';
import { radius, useTheme } from '@/lib/theme';
import { Button, buzz, Card, IconTile, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { useToast } from '@/ui/toast';

/**
 * Updates from inside the app, two ways:
 *
 * - Code (over the air, expo-updates): checked at every start, downloaded in the background and
 *   used from the next start (or at once with "Restart"). Each update is signed with our key and
 *   the app refuses anything else; it only takes updates made for its own native build; an update
 *   that fails to start is rolled back by Expo.
 * - A new native build (an APK): published with `latest.json` (version, size, MD5) next to it. The
 *   app shows "Update available", downloads it, checks size and MD5, and hands it to Android's
 *   installer, which asks you and installs it only if it is signed with this app's key.
 */

const RELEASES = 'https://github.com/abhijeetSinghRajput/pocket-agent/releases/download/';
const LATEST_URL =
  'https://github.com/abhijeetSinghRajput/pocket-agent/releases/download/mobile-preview/latest.json';

const LatestApkSchema = z.object({
  versionName: z.string().max(40),
  versionCode: z.number().int().positive(),
  // Only from this project's releases (Android also checks the signature before installing).
  url: z.url().refine((u) => u.startsWith(RELEASES), 'not a Pocket Agent release'),
  size: z.number().int().positive(),
  md5: z.string().regex(/^[0-9a-f]{32}$/i),
  notes: z.string().max(2000).optional(),
});
export type LatestApk = z.infer<typeof LatestApkSchema>;

const installedCode = () => Number(Application.nativeBuildVersion ?? '0') || 0;

/** The newest APK, when it is newer than this app; null when this one is the newest. */
export async function newerApk(): Promise<LatestApk | null> {
  if (Platform.OS !== 'android') return null;
  const res = await fetch(`${LATEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Couldn’t check for updates right now.');
  const latest = LatestApkSchema.parse(await res.json());
  return latest.versionCode > installedCode() ? latest : null;
}

/**
 * Downloads the APK, checks that it is exactly the file that was published (size and MD5), then
 * opens Android's installer (which also checks the signature, and asks you).
 */
export async function installApk(latest: LatestApk, onProgress: (fraction: number) => void): Promise<void> {
  // Downloaded under a temporary name and renamed only once it is complete and checked: an
  // interrupted or wrong download is never handed to the installer (it is deleted).
  const file = `${FileSystem.cacheDirectory}pocket-agent-${latest.versionCode}.apk`;
  const part = `${file}.part`;
  await FileSystem.deleteAsync(part, { idempotent: true });
  await FileSystem.deleteAsync(file, { idempotent: true });
  const fail = async (message: string): Promise<never> => {
    await FileSystem.deleteAsync(part, { idempotent: true });
    throw new Error(message);
  };
  const task = FileSystem.createDownloadResumable(latest.url, part, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  const done = await task.downloadAsync().catch(() => null);
  if (!done || done.status !== 200)
    return fail('The download didn’t finish, so nothing was installed. Try again.');
  const info = await FileSystem.getInfoAsync(part, { md5: true });
  if (!info.exists || info.size !== latest.size || info.md5?.toLowerCase() !== latest.md5.toLowerCase())
    return fail('The downloaded file didn’t match the published one, so nothing was installed.');
  await FileSystem.moveAsync({ from: part, to: file });
  const contentUri = await FileSystem.getContentUriAsync(file);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: the installer may read the file
    type: 'application/vnd.android.package-archive',
  });
}

/** Downloaded APKs (and unfinished downloads) are removed once they are of no more use. */
async function cleanDownloads(): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  for (const name of names) {
    const m = /^pocket-agent-(\d+)\.apk(\.part)?$/.exec(name);
    // A finished download of a newer version stays until it is installed; the rest goes.
    if (m && (m[2] || Number(m[1]) <= installedCode()))
      await FileSystem.deleteAsync(dir + name, { idempotent: true });
  }
}

/** Restarts into a downloaded code update. */
const restart = () => void Updates.reloadAsync().catch(() => undefined);

/**
 * Once per start: a new APK or a downloaded code update says so in a toast (tap: Profile, where
 * the update is). Nothing is installed or restarted without you.
 */
export function UpdateNotice() {
  const toast = useToast();
  const router = useRouter();
  const { isUpdatePending } = Updates.useUpdates();
  const told = useRef({ apk: false, ota: false });

  useEffect(() => {
    if (told.current.apk) return;
    told.current.apk = true;
    void cleanDownloads();
    void newerApk()
      .then((latest) => {
        if (latest)
          toast({
            key: 'apk-update',
            title: `Update available · ${latest.versionName}`,
            body: 'Tap to update Pocket Agent.',
            onPress: () => router.navigate('/profile'),
          });
      })
      .catch(() => undefined);
  }, [toast, router]);

  useEffect(() => {
    if (!isUpdatePending || told.current.ota) return;
    told.current.ota = true;
    toast({
      key: 'ota-update',
      title: 'Pocket Agent was updated',
      body: 'Tap to restart and use it.',
      onPress: restart,
    });
  }, [isUpdatePending, toast]);

  return null;
}

/** Profile: this app's version, and its update (code or a new build), with what to do. */
export function AppUpdateCard() {
  const { c } = useTheme();
  const { isUpdatePending, isChecking, isDownloading } = Updates.useUpdates();
  const [latest, setLatest] = useState<LatestApk | null | undefined>(undefined);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setError(null);
    setLatest(undefined);
    try {
      setLatest(await newerApk());
      // A code update made since the app started is fetched now (it is used from the restart).
      if (Updates.isEnabled) {
        const found = await Updates.checkForUpdateAsync();
        if (found.isAvailable) await Updates.fetchUpdateAsync();
      }
    } catch (err) {
      setLatest(null);
      setError((err as Error).message);
    }
  };
  // Once, when Profile opens.
  const onOpen = useEffectEvent(() => void check());
  useEffect(() => {
    const t = setTimeout(onOpen, 0);
    return () => clearTimeout(t);
  }, []);

  const update = async () => {
    if (!latest) return;
    setError(null);
    setProgress(0);
    try {
      await installApk(latest, setProgress);
      buzz(true);
    } catch (err) {
      buzz(false);
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const version = `${Application.nativeApplicationVersion ?? '—'} (${Application.nativeBuildVersion ?? '—'})`;
  const busy = progress !== null;
  return (
    <Card style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile
          icon={latest || isUpdatePending ? Rocket : RefreshCw}
          size={40}
          tone={latest || isUpdatePending ? 'primary' : 'muted'}
        />
        <View style={{ flex: 1 }}>
          <T variant="bodyMedium">
            {latest
              ? `Update available · ${latest.versionName}`
              : isUpdatePending
                ? 'Update downloaded'
                : latest === undefined || isChecking || isDownloading
                  ? 'Checking for updates…'
                  : 'Pocket Agent is up to date'}
          </T>
          <T variant="caption" tone="muted">
            This app: {version}
          </T>
        </View>
      </View>
      {latest?.notes ? (
        <T variant="small" tone="muted" numberOfLines={6}>
          {latest.notes}
        </T>
      ) : null}
      {busy && (
        <View style={{ height: 6, borderRadius: radius.full, backgroundColor: c.muted, overflow: 'hidden' }}>
          <View
            style={{ width: `${Math.round((progress ?? 0) * 100)}%`, height: 6, backgroundColor: c.primary }}
          />
        </View>
      )}
      {error && <Notice>{error}</Notice>}
      {latest ? (
        <Button
          label={
            busy ? `Downloading… ${Math.round((progress ?? 0) * 100)}%` : `Update to ${latest.versionName}`
          }
          icon={ArrowDownToLine}
          full
          loading={busy}
          disabled={busy}
          onPress={() => void update()}
          testID="apk-update"
        />
      ) : isUpdatePending ? (
        <Button label="Restart to update" icon={Rocket} full onPress={restart} testID="ota-restart" />
      ) : (
        <Button label="Check for updates" variant="outline" size="sm" onPress={() => void check()} />
      )}
      {latest && (
        <T variant="caption" tone="muted">
          Android asks you to confirm, and installs it only if it is signed like this app. The first time,
          allow Pocket Agent to install apps when Android asks.
        </T>
      )}
    </Card>
  );
}
