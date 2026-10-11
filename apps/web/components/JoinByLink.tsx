'use client';

import { useEffect, useState } from 'react';
import { Button, TextField } from '@watchparty/ui';
import { parseRoomLink } from '@/lib/room-link';

const NOT_A_LINK = 'That is not a room link. Copy the whole link you were sent and paste it here.';

/**
 * Join by pasting a room link. An app on the iPhone home screen has no address bar, and links tapped
 * in Messages open in Safari instead, so this is the way into a room from the installed app.
 */
export function JoinByLink() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canPaste, setCanPaste] = useState(false);

  useEffect(() => setCanPaste(typeof navigator.clipboard?.readText === 'function'), []);

  function join(text: string) {
    const result = parseRoomLink(text);
    if (!result.ok) {
      setError(NOT_A_LINK);
      return;
    }
    // A full page load, so the room page reads the join key from the address exactly as it does when
    // someone taps the link.
    window.location.assign(result.path);
  }

  async function pasteAndJoin() {
    try {
      const text = await navigator.clipboard.readText();
      setValue(text);
      join(text);
    } catch {
      setError('Pasting was not allowed. Press and hold the box, choose Paste, then choose Join.');
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        join(value);
      }}
    >
      <TextField
        label="Join a room"
        placeholder="Paste the room link"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        error={error}
        hint="Paste the link you were sent, or the room code."
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        data-testid="join-link"
      />
      <div className="flex flex-wrap gap-2">
        {canPaste ? (
          <Button type="button" variant="primary" icon="copy" onClick={() => void pasteAndJoin()}>
            Paste and join
          </Button>
        ) : null}
        <Button type="submit" variant={canPaste ? 'secondary' : 'primary'} disabled={!value.trim()}>
          Join
        </Button>
      </div>
    </form>
  );
}
