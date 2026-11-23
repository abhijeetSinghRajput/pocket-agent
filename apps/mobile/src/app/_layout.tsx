import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  useFonts,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { loadThemePreference } from '@/lib/appearance';
import { AuthProvider, useAuth } from '@/lib/auth';
import { QueryProvider } from '@/lib/query';
import { useTheme } from '@/lib/theme';
import { Button, T } from '@/ui/core';
import { ToastProvider } from '@/ui/toast';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { state, refresh } = useAuth();
  const { c } = useTheme();
  const ready = state.status !== 'loading';
  const signedIn = state.status === 'authenticated';
  const segments = useSegments();
  const router = useRouter();
  const inAuth = segments[0] === '(auth)';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Signed out anywhere but the sign-in screens: go to sign-in. Signed in on them: go home.
  useEffect(() => {
    if (!ready || state.status === 'error') return;
    if (!signedIn && !inAuth) router.replace('/login');
    else if (signedIn && inAuth) router.replace('/');
  }, [ready, signedIn, inAuth, state.status, router]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (state.status === 'error') {
    return (
      <View
        accessibilityRole="alert"
        style={{
          flex: 1,
          backgroundColor: c.background,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 8,
        }}
      >
        <T variant="heading" center>
          Can’t reach Pocket Agent
        </T>
        <T variant="small" tone="muted" center>
          {state.message}
        </T>
        <Button
          label="Try again"
          variant="outline"
          onPress={() => void refresh()}
          style={{ marginTop: 16, alignSelf: 'center' }}
        />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const { c, dark } = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  // Your light/dark choice is applied before anything is drawn, so nothing flashes the other way.
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    void loadThemePreference().finally(() => setThemeReady(true));
  }, []);

  // The window behind the screens (seen during transitions and keyboard resize) follows the theme.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.background);
  }, [c.background]);

  if ((!fontsLoaded && !fontError) || !themeReady) return null;

  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider
          value={{
            ...base,
            colors: {
              ...base.colors,
              background: c.background,
              card: c.bar,
              text: c.foreground,
              border: c.border,
              primary: c.primary,
            },
          }}
        >
          <QueryProvider>
            <AuthProvider>
              <ToastProvider>
                <StatusBar style={dark ? 'light' : 'dark'} />
                <RootNavigator />
              </ToastProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
