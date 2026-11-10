'use client';
import { useEffect, useState } from 'react';
import type { RoomController } from '@watchparty/ui/room';
import { Sheet } from '@watchparty/ui';
export function MovieInvite({
  controller,
  seats,
  cap,
}: {
  controller: RoomController;
  seats: number;
  cap: number;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('invite') === '1') {
      setOpen(true);
      url.searchParams.delete('invite');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setMessage('');
    setLink('');
    setQr('');
    let active = true;
    const session = controller.session;
    if (!session) return;
    void controller.api
      .getRoomLink(session.roomId)
      .then(async (result) => {
        if (!active) return;
        if (!result.ok) {
          setMessage('The invite link could not load. Try again.');
          return;
        }
        if (!active) return;
        setLink(result.data.room_link);
        const code = await (
          await import('qrcode')
        ).toDataURL(result.data.room_link, { width: 240, margin: 2 });
        if (active) setQr(code);
      })
      .catch(() => active && setMessage('The invite link could not load. Try again.'));
    return () => {
      active = false;
    };
  }, [controller, open]);
  async function share() {
    try {
      if (navigator.share)
        await navigator.share({
          title: 'Watch together on Synvello',
          url: link,
        });
      else {
        await navigator.clipboard.writeText(link);
        setMessage('Invite link copied.');
      }
    } catch {
      setMessage('Sharing was cancelled or unavailable. You can select and copy the link.');
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Invite link copied.');
    } catch {
      setMessage('Select the invite link above and copy it to share.');
    }
  }
  return (
    <>
      <button
        className="min-h-11 rounded-lg bg-amber px-3 font-semibold text-amber-ink"
        onClick={() => setOpen(true)}
      >
        Invite
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Invite friends">
        <section className="flex flex-col gap-4">
          <p>
            Anyone with this link can join after signing in with Google. Seats: {seats} of {cap}{' '}
            taken.
          </p>
          {qr ? (
            <img
              src={qr}
              width={240}
              height={240}
              alt="Scan this code to join the room"
              className="mx-auto"
            />
          ) : null}
          <input
            aria-label="Private room invite link"
            readOnly
            value={link}
            className="w-full rounded bg-surface-2 p-3"
            onFocus={(e) => e.target.select()}
          />
          <button
            className="rounded bg-amber p-3 text-amber-ink"
            disabled={!link}
            onClick={() => void share()}
          >
            Share link
          </button>
          <button
            className="min-h-11 rounded-lg border border-line px-4"
            disabled={!link}
            onClick={() => void copy()}
          >
            Copy link
          </button>
          {message ? <p role="status">{message}</p> : null}
        </section>
      </Sheet>
    </>
  );
}
