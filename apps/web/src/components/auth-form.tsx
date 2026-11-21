'use client';

import { LoginRequest, RegisterRequest } from '@pocket-agent/protocol';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { finishGoogleRedirect, GoogleCancelled, googleConfig, signInWithGoogle } from '@/lib/google';
import { safeNextPath } from '@/lib/redirect';

type Mode = 'login' | 'register';
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register, loginWithGoogle } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [google, setGoogle] = useState<'idle' | 'busy'>('idle');
  const googleOn = !!googleConfig();

  async function withGoogleToken(token: string | null) {
    if (!token) return;
    await loginWithGoogle(token);
    router.replace(safeNextPath(params.get('next')));
  }

  // Back from a full-page Google sign-in (used when a popup can't open).
  useEffect(() => {
    if (!googleOn) return;
    let live = true;
    finishGoogleRedirect()
      .then(async (token) => {
        if (!live || !token) return;
        setGoogle('busy');
        await withGoogleToken(token);
      })
      .catch((err: Error) => live && (setErrors({ form: err.message }), setGoogle('idle')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  async function onGoogle() {
    setErrors({});
    setGoogle('busy');
    try {
      await withGoogleToken(await signInWithGoogle());
    } catch (err) {
      if (!(err instanceof GoogleCancelled)) setErrors({ form: (err as Error).message });
      setGoogle('idle');
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const schema = mode === 'login' ? LoginRequest : RegisterRequest;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      if (mode === 'login') await login(parsed.data as LoginRequest);
      else await register(parsed.data as RegisterRequest);
      router.replace(safeNextPath(params.get('next')));
    } catch (err) {
      setErrors({ form: (err as Error).message });
      setPending(false);
    }
  }

  const isLogin = mode === 'login';
  const describe = (f: keyof Errors) => (errors[f] ? `${f}-error` : undefined);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{isLogin ? 'Sign in' : 'Create your account'}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {isLogin
          ? 'Welcome back. Your agents are waiting.'
          : 'Control the coding agents on your own machines.'}
      </p>

      {googleOn && (
        <>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-8 w-full gap-3 bg-card"
            disabled={google === 'busy' || pending}
            onClick={() => void onGoogle()}
            data-testid="google-sign-in"
          >
            <GoogleMark />
            {google === 'busy' ? 'Signing in with Google…' : 'Continue with Google'}
          </Button>
          <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            or with email
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form
        onSubmit={onSubmit}
        noValidate
        className={googleOn ? 'mt-6 flex flex-col gap-4' : 'mt-8 flex flex-col gap-4'}
      >
        {errors.form && (
          <p
            role="alert"
            data-testid="form-error"
            className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            {errors.form}
          </p>
        )}
        {!isLogin && (
          <Field id="name" label="Name" error={errors.name}>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              aria-describedby={describe('name')}
            />
          </Field>
        )}
        <Field id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!errors.email}
            aria-describedby={describe('email')}
          />
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password}
          hint={isLogin ? undefined : 'At least 10 characters.'}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            aria-invalid={!!errors.password}
            aria-describedby={describe('password') ?? (isLogin ? undefined : 'password-hint')}
          />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
          {pending ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isLogin ? 'New to Pocket Agent? ' : 'Already have an account? '}
        <Link
          href={isLogin ? '/register' : '/login'}
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          {isLogin ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}

/** Google's "G" mark (brand colours), as Google's sign-in guidelines ask. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
