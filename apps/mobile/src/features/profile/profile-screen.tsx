import { formatDate } from '@pocket-agent/core';
import * as Application from 'expo-application';
import { LogOut, Moon, Smartphone, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ApiStatus } from '@/features/profile/api-status';
import { ClaudeUsageCard } from '@/features/profile/claude-usage';
import { AwayModeCard } from '@/features/profile/away-mode-card';
import { NotificationSettings } from '@/features/profile/notification-settings';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/appearance';
import { useAuth, useUser } from '@/lib/auth';
import { enter } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { Avatar, Button, Card, Press, T } from '@/ui/core';
import { Screen } from '@/ui/screen';
import { Segmented } from '@/ui/form';
import { Sheet } from '@/ui/sheet';

/** Who is signed in. */
function ProfileHeader() {
  const user = useUser();
  return (
    <View testID="profile-header">
      <Card
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <Avatar name={user.name} url={user.avatarUrl} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="subheading" accessibilityRole="header">
            {user.name}
          </T>
          <T variant="small" tone="muted">
            {user.email}
          </T>
          <T variant="caption" tone="muted" style={{ marginTop: 4 }}>
            Member since {formatDate(user.createdAt)}
          </T>
        </View>
      </Card>
    </View>
  );
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Light or dark: follow the phone, or pin one. */
function AppearanceCard() {
  const { c, dark } = useTheme();
  const pref = useThemePreference();
  const Icon = pref === 'system' ? Smartphone : dark ? Moon : Sun;
  return (
    <View testID="appearance">
      <Card style={{ padding: 16 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <T variant="overline" tone="muted" accessibilityRole="header">
            APPEARANCE
          </T>
          <Icon size={16} color={c.mutedForeground} strokeWidth={2.2} />
        </View>
        <View style={{ marginTop: 12 }}>
          <Segmented
            options={THEMES}
            value={pref}
            onChange={setThemePreference}
            label="Theme"
            testID="theme"
          />
        </View>
        <T variant="caption" tone="muted" style={{ marginTop: 8 }}>
          {pref === 'system' ? 'Follows your phone’s setting.' : `Always ${pref}, whatever the phone says.`}
        </T>
      </Card>
    </View>
  );
}

function SignOut() {
  const { c } = useTheme();
  const { logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Press
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        testID="sign-out"
        onPress={() => setConfirm(true)}
        scale={0.98}
        style={{
          height: 48,
          borderRadius: 18,
          backgroundColor: c.card,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <LogOut size={18} color={c.destructive} strokeWidth={2.2} />
        <T variant="bodyMedium" style={{ color: c.destructive }}>
          Sign out
        </T>
      </Press>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        dismissable={!pending}
        title="Sign out?"
        description="You’ll need to sign in again to use Pocket Agent on this phone. Your PCs stay paired."
      >
        <View style={{ gap: 12, paddingTop: 4 }}>
          <Button
            label={pending ? 'Signing out…' : 'Sign out'}
            variant="destructive"
            size="lg"
            full
            loading={pending}
            testID="sign-out-confirm"
            onPress={async () => {
              setPending(true);
              await logout();
              // Signed out: the root navigator swaps to sign-in.
            }}
          />
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            full
            disabled={pending}
            onPress={() => setConfirm(false)}
          />
        </View>
      </Sheet>
    </>
  );
}

/** Who is signed in, their Claude plan usage, and the few settings there are. */
export function ProfileScreen() {
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  return (
    <Screen title="Profile" contentStyle={{ paddingHorizontal: 16, gap: 12 }}>
      <Animated.View entering={enter.rise(0)}>
        <ProfileHeader />
      </Animated.View>
      <Animated.View entering={enter.rise(1)}>
        <ClaudeUsageCard />
      </Animated.View>
      <Animated.View entering={enter.rise(2)}>
        <AppearanceCard />
      </Animated.View>
      <Animated.View entering={enter.rise(3)}>
        <AwayModeCard />
      </Animated.View>
      <Animated.View entering={enter.rise(3)}>
        <Card style={{ padding: 16 }}>
          <T variant="overline" tone="muted" accessibilityRole="header" style={{ marginBottom: 12 }}>
            NOTIFICATIONS
          </T>
          <NotificationSettings />
        </Card>
      </Animated.View>
      <Animated.View entering={enter.rise(4)}>
        <ApiStatus />
      </Animated.View>
      <Animated.View entering={enter.rise(5)}>
        <SignOut />
      </Animated.View>
      <Animated.View entering={enter.rise(6)}>
        <T variant="caption" tone="muted" center style={{ marginTop: 8 }} testID="app-version">
          Pocket Agent {version ?? '—'}
          {build ? ` (${build})` : ''}
        </T>
      </Animated.View>
    </Screen>
  );
}
