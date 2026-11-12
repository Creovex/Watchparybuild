import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPart } from '../lib/movie-part-upload';
class Request {
  static last: Request;
  upload = { onprogress: null as null | ((event: ProgressEvent) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  status = 200;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  getResponseHeader = vi.fn(() => 'part-etag');
  constructor() { Request.last = this; }
}
afterEach(() => vi.unstubAllGlobals());
describe('multipart upload transport', () => {
  it('reports in-flight bytes before receiving the part receipt', async () => {
    vi.stubGlobal('XMLHttpRequest', Request);
    const progress = vi.fn();
    const blob = new Blob([new Uint8Array(100)]);
    const result = uploadPart('https://storage.example/part', blob, new AbortController().signal, progress);
    Request.last.upload.onprogress?.({ loaded: 37 } as ProgressEvent);
    expect(progress).toHaveBeenLastCalledWith(37);
    expect(Request.last.send).toHaveBeenCalledWith(blob);
    Request.last.onload?.();
    await expect(result).resolves.toEqual({ status: 200, etag: 'part-etag' });
  });
  it('aborts an in-flight request when the uploader pauses', async () => {
    vi.stubGlobal('XMLHttpRequest', Request);
    const controller = new AbortController();
    const result = uploadPart('https://storage.example/part', new Blob(['movie']), controller.signal, vi.fn());
    const stopped = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await stopped;
    expect(Request.last.abort).toHaveBeenCalledOnce();
  });
  it('propagates HTTP failures so the caller can refresh expired URLs', async () => {
    vi.stubGlobal('XMLHttpRequest', Request);
    const result = uploadPart('https://storage.example/part', new Blob(['movie']), new AbortController().signal, vi.fn());
    Request.last.status = 403;
    Request.last.getResponseHeader.mockReturnValue('');
    Request.last.onload?.();
    await expect(result).resolves.toMatchObject({ status: 403 });
  });
});
