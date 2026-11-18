import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MovieScreen } from '../../apps/web/app/r/[slug]/MovieScreen';
import { Html5VideoAdapter } from '../../apps/web/lib/adapters/html5';
import { ReactionBand } from '../../packages/ui/src/room/components/ReactionBand';
import { MemberStrip } from '../../packages/ui/src/room/components/People';
import { RoomProvider } from '../../packages/ui/src/room/components/context';
import type { RoomController } from '../../packages/ui/src/room/controller';
const snapshot = { room: { room_cap: 3 }, members: [{ user_id: 'host', name: 'Test host', role: 'host', state: 'joined', present: true }] };
const controller = { userId: 'host', store: { subscribe: () => () => {}, get: () => snapshot } } as unknown as RoomController;
function Layout() {
  const [reaction, setReaction] = useState(0);
  const [tray, setTray] = useState(false);
  return <RoomProvider controller={controller}><div className="flex h-dvh flex-col overflow-hidden">
    <div className="shrink-0" style={{ height: 72 }}>Watch room</div>
    <div data-testid="room-main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <MovieScreen><Player /><ReactionBand reactions={reaction ? [{ id: reaction, emoji: '❤️', userId: 'host', x: .5, drift: 0 }] : []} popups={[]} timed={[]} duration={60} nameOf={() => 'Host'} /></MovieScreen>
      <MemberStrip speaking={new Set()} cameras={new Set()} attachVideo={() => () => {}} className="shrink-0" />
      <div className="relative z-20 mx-auto mt-auto w-full shrink-0 max-w-3xl px-3 pb-4"><button onClick={() => setTray(!tray)}>React</button>{tray && <div data-testid="reaction-picker" className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-xl bg-surface-2 p-1.5 ring-1 ring-line" style={{ height: 180 }}><button onClick={() => setReaction(n => n + 1)}>Send reaction</button></div>}</div>
    </div>
  </div></RoomProvider>;
}
function Player() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const adapter = new Html5VideoAdapter(container.current!, async () => ({ url: '/movie.mp4', expires_at: new Date(Date.now() + 86400000).toISOString() }), () => ({ playing: true, position: 0 }));
    void adapter.load('fixture');
    return () => adapter.destroy();
  }, []);
  return <div className="w-full bg-black"><div data-testid="player" className="relative mx-auto aspect-video w-full lg:max-w-[calc((100dvh-17rem)*16/9)]"><div ref={container} className="absolute inset-0" /></div></div>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('layout') ? <Layout /> : <>
  <header>Watch room <button>Invite</button></header>
  <main><MovieScreen><Player /></MovieScreen></main>
  <aside>Chat <button>Send message</button></aside>
</>);
