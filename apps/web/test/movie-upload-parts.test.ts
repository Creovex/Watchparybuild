import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/movie-api', () => ({ movieCall: vi.fn() }));
vi.mock('../lib/movie-part-upload', () => ({ uploadPart: vi.fn() }));
import { movieCall } from '../lib/movie-api';
import { uploadPart } from '../lib/movie-part-upload';
import { movieUploadConcurrency, uploadMovieParts } from '../lib/movie-upload-parts';
const PART = 16 * 1024 * 1024;
// Lazy slices avoid allocating hundreds of MB for scheduler tests.
const file = (parts: number) => ({ size: PART * parts, slice: (a: number, b: number) => ({ size: b - a }) }) as File;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); vi.stubGlobal('navigator', {});
  vi.mocked(movieCall).mockImplementation(async (_name, args) => ({ urls: Object.fromEntries((args.part_numbers as number[]).map(p => [p, `part-${p}`])), uploaded: [] }));
  vi.mocked(uploadPart).mockImplementation(async (_url, blob, _signal, progress) => {
    progress(blob.size / 2);
    await new Promise(resolve => setTimeout(resolve, 100));
    return { status: 200, etag: 'ok' };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('uses six workers normally and two on constrained devices or data-saving connections', () => {
  expect(movieUploadConcurrency()).toBe(6);
  for (const device of [{ deviceMemory: 2 }, { connection: { saveData: true } }, { connection: { effectiveType: '2g' } }]) {
    vi.stubGlobal('navigator', device); expect(movieUploadConcurrency()).toBe(2);
  }
});
it('halves scheduling time versus three workers in a per-request-limited model without duplicate parts', async () => {
  const durations: number[] = [];
  for (const workers of [3, 6]) {
    vi.mocked(uploadPart).mockClear(); const start = Date.now(); const progress = vi.fn();
    const done = uploadMovieParts('movie', file(12), new AbortController().signal, progress, workers);
    await vi.runAllTimersAsync(); await done;
    durations.push(Date.now() - start);
    expect(new Set(vi.mocked(uploadPart).mock.calls.map(call => call[0])).size).toBe(12);
    expect(progress).toHaveBeenLastCalledWith(12 * PART, 12 * PART);
    expect(progress.mock.calls.every(([bytes]) => bytes <= 12 * PART)).toBe(true);
  }
  expect(durations).toEqual([400, 200]);
});
it('resumes only missing parts and includes completed bytes in progress', async () => {
  vi.mocked(movieCall).mockResolvedValue({ urls: { 2: 'part-2' }, uploaded: [{ part_number: 1, size: PART, etag: 'old' }] });
  const progress = vi.fn(); const done = uploadMovieParts('movie', file(2), new AbortController().signal, progress);
  await vi.runAllTimersAsync(); await done;
  expect(uploadPart).toHaveBeenCalledTimes(1); expect(progress).toHaveBeenLastCalledWith(2 * PART, 2 * PART);
});
it('refreshes an expired part URL and retries without double-counting bytes', async () => {
  vi.mocked(uploadPart).mockResolvedValueOnce({ status: 403, etag: null }).mockResolvedValueOnce({ status: 200, etag: 'ok' });
  const progress = vi.fn(); const done = uploadMovieParts('movie', file(1), new AbortController().signal, progress);
  await vi.runAllTimersAsync(); await done;
  expect(movieCall).toHaveBeenCalledTimes(2); expect(uploadPart).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith(PART, PART);
});
it('pause aborts every active part and never starts queued parts', async () => {
  const controller = new AbortController();
  vi.mocked(uploadPart).mockImplementation((_url, _blob, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
  }));
  const done = uploadMovieParts('movie', file(12), controller.signal, vi.fn());
  const stopped = expect(done).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(0); expect(uploadPart).toHaveBeenCalledTimes(6);
  controller.abort(); await stopped; expect(uploadPart).toHaveBeenCalledTimes(6);
});
it('continues across URL batches and sends each part once', async () => {
  const done = uploadMovieParts('movie', file(52), new AbortController().signal, vi.fn());
  await vi.runAllTimersAsync(); await done;
  expect(movieCall).toHaveBeenCalledTimes(2);
  expect(new Set(vi.mocked(uploadPart).mock.calls.map(call => call[0])).size).toBe(52);
});
