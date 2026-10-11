import { useSyncExternalStore } from 'react';
import { Button, Icon } from '@watchparty/ui';
import { useRoom, type FatalKind, type RoomController } from '@watchparty/ui/room';
import { APP_NAME } from '../shared/env';
import { errorSentence } from './errors';
import { PanelRoom } from './PanelRoom';
import type { PanelSession, PanelState } from './session';

export function App({ session }: { session: PanelSession }) {
  const state = useSyncExternalStore(session.store.subscribe, session.store.get);
  if (state.phase === 'room' && state.controller && state.me) {
    return <LiveRoom session={session} state={state} controller={state.controller} />;
  }
  if (state.phase === 'no_room') {
    return (
      <Message session={session} title="No room in this tab">
        Open a room in {APP_NAME} on this computer and choose the button that opens it here, so this tab can sync.
      </Message>
    );
  }
  if (state.phase === 'error') {
    return (
      <Message session={session} title="Can’t open the room" tone="error">
        {state.error ?? errorSentence('internal')}
      </Message>
    );
  }
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center" aria-busy="true">
      <p className="slate">{APP_NAME}</p>
      <p className="text-muted">Joining the room…</p>
    </div>
  );
}

function LiveRoom({ session, state, controller }: { session: PanelSession; state: PanelState; controller: RoomController }) {
  const room = useRoom(controller);
  if (room.fatal) {
    const text = fatalText(room.fatal, state.stopReason, room.room?.room_cap);
    return (
      <Message session={session} title={text.title} slate={room.room?.title}>
        {text.body}
      </Message>
    );
  }
  return <PanelRoom session={session} state={state} controller={controller} me={state.me!} />;
}

/** The end states a panel can reach, each as one plain sentence. */
export function fatalText(
  kind: FatalKind,
  stopReason: PanelState['stopReason'],
  roomCap?: number,
): { title: string; body: string } {
  switch (kind) {
    case 'removed':
    case 'banned':
      return { title: 'You were removed', body: 'You were removed from this room.' };
    case 'closed':
      return { title: 'Room closed', body: 'This room was closed.' };
    case 'replaced':
      return { title: 'Opened elsewhere', body: 'You opened this room somewhere else.' };
    case 'handed_over':
      return stopReason === 'replaced'
        ? { title: 'Opened in another tab', body: 'You opened this room in another tab, so this one stopped.' }
        : { title: 'Back on the room page', body: 'Watching back on the room page.' };
    case 'left':
      return { title: 'You left', body: 'You left the room. You can hide this panel.' };
    case 'room_full':
      return { title: 'Room full', body: errorSentence('room_full', { roomCap }) };
    case 'not_member':
    default:
      return { title: 'Not in this room', body: errorSentence('not_member') };
  }
}

function Message({
  session,
  title,
  slate,
  tone = 'info',
  children,
}: {
  session: PanelSession;
  title: string;
  slate?: string;
  tone?: 'info' | 'error';
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-line px-3">
        <p className="slate">{APP_NAME}</p>
        <Button variant="ghost" icon="chevronRight" onClick={() => session.collapse()}>
          Hide
        </Button>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-3 px-5 pb-12" role={tone === 'error' ? 'alert' : 'status'} data-testid="panel-message">
        {slate ? <p className="slate truncate">{slate}</p> : null}
        <h1 className="marquee flex items-center gap-2 text-5xl">
          {tone === 'error' ? <Icon name="alert" size={28} className="shrink-0 text-red" /> : null}
          {title}
        </h1>
        <p className="text-muted">{children}</p>
      </main>
    </div>
  );
}
