'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_DUCK_LEVEL } from '@watchparty/sync-core';
import { Button, Notice, Switch, TextField, useToast } from '@watchparty/ui';
import { RoomApi } from '@watchparty/ui/room';
import { errorSentence } from '@/lib/errors';
import { getBrowserClient } from '@/lib/supabase/client';
import { FUNCTIONS_URL } from '@/lib/env';

export function SettingsForm({
  userId,
  email,
  initialName,
  initialDuck,
  plan,
}: {
  userId: string;
  email: string;
  initialName: string;
  initialDuck: number | null;
  plan: 'free' | 'paid';
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [duck, setDuck] = useState<number | null>(initialDuck);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dirty = name.trim() !== initialName || duck !== initialDuck;

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      setNameError('Use 1 to 40 characters.');
      return;
    }
    setNameError(null);
    setSaving(true);
    const { error } = await getBrowserClient().from('profiles').update({ display_name: trimmed, duck_level: duck }).eq('id', userId);
    setSaving(false);
    if (error) {
      toast(errorSentence('internal'), 'error');
      return;
    }
    toast('Settings saved.', 'success');
    router.refresh();
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    const supabase = getBrowserClient();
    const res = await new RoomApi(supabase, { functionsUrl: FUNCTIONS_URL || undefined }).deleteAccount();
    if (!res.ok) {
      setDeleting(false);
      setDeleteError(errorSentence(res.code));
      return;
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    window.location.assign('/');
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <p className="slate normal-case tracking-normal">{email}</p>
        <h1 className="marquee text-6xl">Settings</h1>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Display name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          hint="What people in your rooms see."
          autoComplete="nickname"
        />

        <section className="flex flex-col gap-2">
          <Switch
            label="Lower the movie while others talk"
            description="Your default for every room. You can change it inside a room too."
            checked={duck !== null}
            onChange={(on) => setDuck(on ? DEFAULT_DUCK_LEVEL : null)}
          />
          {duck !== null ? (
            <label className="flex flex-col gap-2 text-sm font-semibold">
              <span className="flex justify-between">
                Movie volume while someone talks
                <span className="timecode text-amber">{Math.round(duck * 100)}%</span>
              </span>
              <input
                type="range"
                min={5}
                max={90}
                step={5}
                value={Math.round(duck * 100)}
                onChange={(e) => setDuck(Number(e.target.value) / 100)}
                className="h-11 w-full accent-amber"
              />
              <span className="font-normal text-muted">35% keeps speech clear and the scene audible.</span>
            </label>
          ) : null}
        </section>

        <Button type="submit" variant="primary" busy={saving} disabled={!dirty} className="self-start">
          Save changes
        </Button>
      </form>

      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="text-lg font-bold">Plan</h2>
        <p className="text-muted">
          {plan === 'paid' ? 'Paid: rooms you start seat 10.' : 'Free: rooms you start seat 3.'}{' '}
          <Link href="/upgrade" className="font-semibold text-amber hover:text-amber-bright">
            Compare plans
          </Link>
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="text-lg font-bold">Sign out</h2>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary" icon="leave">
            Sign out
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="text-lg font-bold text-red">Delete account</h2>
        <p className="text-muted">
          Closes every room you host and deletes your profile. Your old chat messages stay in their rooms as &ldquo;Deleted
          user&rdquo;. This cannot be undone.
        </p>
        <TextField
          label='Type "delete" to confirm'
          value={confirmDelete}
          onChange={(e) => setConfirmDelete(e.target.value)}
          autoComplete="off"
        />
        {deleteError ? <Notice tone="error">{deleteError}</Notice> : null}
        <Button
          variant="danger"
          busy={deleting}
          disabled={confirmDelete.trim().toLowerCase() !== 'delete'}
          onClick={() => void deleteAccount()}
          className="self-start"
        >
          Delete my account
        </Button>
      </section>
    </div>
  );
}
