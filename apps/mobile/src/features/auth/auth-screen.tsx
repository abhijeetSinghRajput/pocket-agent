import { LoginRequest, RegisterRequest } from '@pocket-agent/protocol';
import { Link } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Image, StyleSheet, TextInput, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { GoogleCancelled, googleAvailable, signInWithGoogle } from '@/lib/google';
import { enter } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { Button, buzz, IconButton, Press, Spinner, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { Field } from '@/ui/form';

type Mode = 'login' | 'register';
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

/** Sign in / create an account. The same rules and messages as the web app (shared schemas). */
export function AuthScreen({ mode }: { mode: Mode }) {
  const { login, register, loginWithGoogle } = useAuth();
  const [google, setGoogle] = useState(false);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const isLogin = mode === 'login';

  async function onGoogle() {
    if (google || pending) return;
    setErrors({});
    setGoogle(true);
    try {
      await loginWithGoogle(await signInWithGoogle());
      // Signed in: the root navigator swaps to the app.
    } catch (err) {
      if (!(err instanceof GoogleCancelled)) {
        setErrors({ form: (err as Error).message });
        buzz(false);
      }
      setGoogle(false);
    }
  }

  async function submit() {
    if (pending) return;
    const parsed = isLogin
      ? LoginRequest.safeParse({ email, password })
      : RegisterRequest.safeParse({ name, email, password });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      buzz(false);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      if (isLogin) await login(parsed.data as LoginRequest);
      else await register(parsed.data as RegisterRequest);
      // Signed in: the root navigator swaps to the app.
    } catch (err) {
      setErrors({ form: (err as Error).message });
      buzz(false);
      setPending(false);
    }
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <Animated.View entering={enter.rise(0)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={{ width: 48, height: 48, borderRadius: 12 }}
          accessibilityIgnoresInvertColors
        />
        <View>
          <T variant="heading">Pocket Agent</T>
          <T variant="small" tone="muted">
            Your PC, in your pocket.
          </T>
        </View>
      </Animated.View>

      <Animated.View entering={enter.rise(1)} style={{ marginTop: 36, gap: 6 }}>
        <T variant="title" accessibilityRole="header">
          {isLogin ? 'Sign in' : 'Create your account'}
        </T>
        <T variant="body" tone="muted">
          {isLogin
            ? 'Welcome back. Your agents are waiting.'
            : 'Control the coding agents on your own machines.'}
        </T>
      </Animated.View>

      <Animated.View entering={enter.rise(2)} style={{ marginTop: 28, gap: 16 }}>
        {errors.form && <Notice>{errors.form}</Notice>}
        {googleAvailable && (
          <>
            <Press
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              testID="google-sign-in"
              disabled={google || pending}
              onPress={() => void onGoogle()}
              style={{
                height: 52,
                borderRadius: 18,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: c.border,
                backgroundColor: c.card,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
              }}
            >
              {google ? <Spinner /> : <GoogleMark />}
              <T variant="subheading">{google ? 'Signing in with Google…' : 'Continue with Google'}</T>
            </Press>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityElementsHidden>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
              <T variant="caption" tone="muted">
                or with email
              </T>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
            </View>
          </>
        )}
        {!isLogin && (
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            error={errors.name}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            testID="name"
          />
        )}
        <Field
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="email"
        />
        <Field
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          hint={isLogin ? undefined : 'At least 10 characters.'}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          textContentType={isLogin ? 'password' : 'newPassword'}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          testID="password"
          right={
            <IconButton
              icon={show ? EyeOff : Eye}
              label={show ? 'Hide password' : 'Show password'}
              size={36}
              onPress={() => setShow((s) => !s)}
            />
          }
        />
        <Button
          label={
            pending ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'
          }
          onPress={() => void submit()}
          loading={pending}
          size="lg"
          full
          style={{ marginTop: 4 }}
          testID="submit"
        />
      </Animated.View>

      <Animated.View
        entering={enter.rise(3)}
        style={{ marginTop: 24, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
      >
        <T variant="small" tone="muted">
          {isLogin ? 'New to Pocket Agent?' : 'Already have an account?'}
        </T>
        <Link href={isLogin ? '/register' : '/login'} replace>
          <T variant="smallMedium" tone="primary">
            {isLogin ? 'Create an account' : 'Sign in'}
          </T>
        </Link>
      </Animated.View>
    </KeyboardAwareScrollView>
  );
}

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}
