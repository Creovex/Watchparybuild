'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getBrowserClient } from '@/lib/supabase/client';

type Proof = { key: string; upload_id: string };
type Urls = { urls: { part_number: number; url: string }[] };
const PART = 16 * 1024 * 1024;

/** Operator-only storage proof. Authorization and enablement are enforced in the function. */
export function StorageProof() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const proof = useRef<Proof | null>(null);
  const running = useRef(false);
  const say = (text: string) => setMessages((previous) => [...previous, text]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('synvello:storage-proof') ?? 'null');
      if (saved && typeof saved.key === 'string' && typeof saved.upload_id === 'string') {
        proof.current = saved;
        setMessages(['A previous test upload needs cleanup. Remove the test file before starting again.']);
      }
    } catch { setMessages(['Session storage is unavailable. Keep this page open until cleanup finishes.']); }
    const warn = (event: BeforeUnloadEvent) => { if (running.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await getBrowserClient().functions.invoke('movie-storage-proof', { body });
    if (error || !data?.ok) throw new Error('The storage check could not finish. Confirm operator access and the storage configuration.');
    return data.data as T;
  }
  async function cleanup() {
    const current = proof.current;
    if (!current || running.current) return;
    setBusy(true);
    try {
      await call({ action: 'cleanup', ...current });
      proof.current = null;
      try { sessionStorage.removeItem('synvello:storage-proof'); } catch { /* Cleanup is already complete. */ }
      setVideoUrl(null);
      say('The test upload and its unfinished parts were removed.');
    } catch { say('Cleanup did not finish. Keep this page open and try Remove test file again.'); }
    finally { setBusy(false); }
  }
  async function run() {
    if (!file || running.current || proof.current) return;
    if (file.size < 1 || file.size > 250 * 1024 * 1024 || !['video/mp4', 'video/webm'].includes(file.type)) {
      say('Choose a playable MP4 or WebM test file up to 250 MiB.'); return;
    }
    running.current = true;
    setBusy(true);
    setMessages([]);
    try {
      const started = await call<Proof>({ action: 'start', content_type: file.type });
      proof.current = started;
      try { sessionStorage.setItem('synvello:storage-proof', JSON.stringify(started)); } catch { say('Keep this page open until you remove the test file; cleanup details could not be saved.'); }
      const signed = await call<Urls>({ action: 'urls', ...started, size_bytes: file.size });
      const first = signed.urls[0];
      if (!first) throw new Error('No upload parts were returned.');
      const firstSize = Math.min(PART, file.size);
      // Browser-generated Content-Length must match the signed size. Never set this forbidden header manually.
      const wrong = await fetch(first.url, { method: 'PUT', body: new Blob([new Uint8Array(firstSize === 1 ? 2 : 1)]) });
      if (wrong.ok) throw new Error('Storage accepted the wrong part length. Do not enable movie uploads.');
      if (![400, 403].includes(wrong.status)) throw new Error('The length enforcement check had an unexpected response.');
      say('PASS: a part with the wrong length was rejected.');
      let next = 0;
      let completed = 0;
      const workers = await Promise.allSettled(Array.from({ length: Math.min(3, signed.urls.length) }, async () => {
        while (next < signed.urls.length) {
          const item = signed.urls[next++];
          if (!item) break;
          const start = (item.part_number - 1) * PART;
          const response = await fetch(item.url, { method: 'PUT', body: file.slice(start, Math.min(file.size, start + PART)) });
          if (!response.ok || !response.headers.get('ETag')) throw new Error('An upload failed or the browser could not read its part identifier.');
          say(`Uploaded part ${++completed} of ${signed.urls.length}; its identifier was readable.`);
        }
      }));
      if (workers.some((result) => result.status === 'rejected')) throw new Error('A part failed or its identifier was not readable. Remove the test file before retrying.');
      await call({ action: 'complete', ...started, size_bytes: file.size });
      say('PASS: the completed object has the declared size.');
      const playback = await call<{ url: string }>({ action: 'play', key: started.key });
      for (const offset of [Math.floor(file.size / 2), Math.max(0, file.size - 1024)]) {
        const response = await fetch(playback.url, { headers: { Range: `bytes=${offset}-${Math.min(file.size - 1, offset + 1023)}` } });
        const range = response.headers.get('Content-Range');
        if (response.status !== 206 || !range?.startsWith(`bytes ${offset}-`)) {
          await response.body?.cancel();
          throw new Error('Storage did not return the requested byte range. Do not enable playback.');
        }
        const bytes = (await response.arrayBuffer()).byteLength;
        if (bytes !== Math.min(1024, file.size - offset)) throw new Error('Storage returned an unexpected number of bytes.');
      }
      say('PASS: partial reads at the middle and end returned only the requested bytes.');
      setVideoUrl(playback.url);
      say('Play the video below and seek to the middle and end. Remove the test file when finished.');
    } catch (error) {
      say(error instanceof Error && !/https?:\/\//.test(error.message) ? error.message : 'The storage check failed. No upload feature was enabled.');
    } finally { running.current = false; setBusy(false); }
  }
  return <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
    <Link href="/home">Back to your rooms</Link>
    <h1 className="text-3xl font-bold">Movie storage check</h1>
    <p>This check is available only to the configured owner while storage testing is enabled. Use a test video you have permission to upload. Keep this page open until you remove the test file.</p>
    <label>Test video<input className="block p-3" type="file" accept="video/mp4,video/webm" disabled={busy || Boolean(proof.current)} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <button className="rounded-lg bg-amber p-3 text-amber-ink disabled:opacity-50" disabled={!file || busy || Boolean(proof.current)} onClick={() => void run()}>Run storage check</button>
    <button className="rounded-lg border p-3 disabled:opacity-50" disabled={busy || !proof.current} onClick={() => void cleanup()}>Remove test file</button>
    <ol className="list-inside list-decimal" aria-live="polite">{messages.map((message, index) => <li key={index}>{message}</li>)}</ol>
    {videoUrl ? <video src={videoUrl} controls playsInline className="w-full" /> : null}
  </main>;
}
