import { LoginRequest, RegisterRequest } from '@pocket-agent/protocol';
import { Link } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Image, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { enter } from '@/lib/motion';
import { useTheme } from '@/lib/theme';
import { Button, buzz, IconButton, T } from '@/ui/core';
import { Notice } from '@/ui/feedback';
import { Field } from '@/ui/form';

type Mode = 'login' | 'register';
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

/** Sign in / create an account. The same rules and messages as the web app (shared schemas). */
export function AuthScreen({ mode }: { mode: Mode }) {
  const { login, register } = useAuth();
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
