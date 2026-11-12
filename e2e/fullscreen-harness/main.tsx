import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MovieScreen } from '../../apps/web/app/r/[slug]/MovieScreen';
import { Html5VideoAdapter } from '../../apps/web/lib/adapters/html5';
function Player() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const adapter = new Html5VideoAdapter(container.current!, async () => ({ url: '/movie.mp4', expires_at: new Date(Date.now() + 86400000).toISOString() }), () => ({ playing: true, position: 0 }));
    void adapter.load('fixture');
    return () => adapter.destroy();
  }, []);
  return <div className="w-full bg-black"><div data-testid="player" className="relative mx-auto aspect-video w-full lg:max-w-[calc((100dvh-17rem)*16/9)]"><div ref={container} className="absolute inset-0" /></div></div>;
}
createRoot(document.getElementById('root')!).render(<>
  <header>Watch room <button>Invite</button></header>
  <main><MovieScreen><Player /></MovieScreen></main>
  <aside>Chat <button>Send message</button></aside>
</>);
