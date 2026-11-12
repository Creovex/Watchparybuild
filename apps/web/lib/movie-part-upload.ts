// Fetch doesn't expose upload progress. XHR reports bytes sent while each part is in flight.
export function uploadPart(
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<{ status: number; etag: string | null }> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const stop = () => xhr.abort();
    const done = () => signal.removeEventListener('abort', stop);
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => progress(Math.min(blob.size, event.loaded));
    xhr.onload = () => {
      done();
      resolve({ status: xhr.status, etag: xhr.getResponseHeader('ETag') });
    };
    xhr.onerror = () => { done(); reject(new Error('The upload connection stopped.')); };
    xhr.onabort = () => { done(); reject(new DOMException('Stopped', 'AbortError')); };
    signal.addEventListener('abort', stop, { once: true });
    xhr.send(blob);
  });
}
