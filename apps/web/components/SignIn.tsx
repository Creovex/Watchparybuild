'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, GoogleMark, Notice, TextField } from '@watchparty/ui';
import { getBrowserClient } from '@/lib/supabase/client';

function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

/** Google's sign in button, in Google's dark theme colours as its branding rules require. */
export function GoogleSignInButton({ next }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setBusy(true);
    setFailed(false);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
    const { error } = await getBrowserClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        aria-busy={busy || undefined}
        className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-3 whitespace-nowrap rounded-full border border-[#8E918F] bg-[#131314] px-5 text-[15px] font-medium text-[#E3E3E3] transition-colors hover:bg-[#1f1f20] disabled:opacity-70 sm:w-auto"
      >
        <GoogleMark size={20} />
        {busy ? 'Opening Google…' : 'Sign in with Google'}
      </button>
      {failed ? (
        <Notice tone="error">Google sign in did not open. Check your connection and try again.</Notice>
      ) : null}
    </div>
  );
}

/**
 * Email and password sign in for the local stack only, where Google is not configured. Shown when
 * NEXT_PUBLIC_DEV_EMAIL_SIGNIN is 1; hosted projects keep email sign in turned off.
 */
export function DevEmailSignIn({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (process.env.NEXT_PUBLIC_DEV_EMAIL_SIGNIN !== '1') return null;

  async function submit(create: boolean) {
    setBusy(true);
    setError(null);
    const auth = getBrowserClient().auth;
    const { error: err } = create
      ? await auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } })
      : await auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError('That email and password did not work on the local stack.');
      return;
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-dashed border-line-strong p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      data-testid="dev-sign-in"
    >
      <p className="slate">Local stack only</p>
      <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" busy={busy}>
          Sign in with email
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit(true)}>
          Create test account
        </Button>
      </div>
    </form>
  );
}
