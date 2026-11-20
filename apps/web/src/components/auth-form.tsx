'use client';

import { LoginRequest, RegisterRequest } from '@pocket-agent/protocol';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/redirect';

type Mode = 'login' | 'register';
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

export function AuthForm({ mode }: { mode: Mode }) {
  const { login, register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

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

      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-4">
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
