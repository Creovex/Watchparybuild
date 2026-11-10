import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { readEnv, type Env } from './env.ts';

export const MOVIE_PART_BYTES = 16 * 1024 * 1024;
export const MOVIE_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export interface UploadedPart { part_number: number; etag: string; size: number }
export interface ObjectInfo { size: number; content_type: string }
export interface MovieStorage {
  create(key: string, type: string): Promise<string>;
  parts(key: string, uploadId: string): Promise<UploadedPart[]>;
  signPart(key: string, uploadId: string, part: number, bytes: number): Promise<string>;
  complete(key: string, uploadId: string, parts: Pick<UploadedPart, 'part_number' | 'etag'>[]): Promise<void>;
  head(key: string): Promise<ObjectInfo | null>;
  abort(key: string, uploadId: string): Promise<void>;
  remove(key: string): Promise<void>;
  playUrl(key: string): Promise<{ url: string; expires_at: string }>;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function unescapeXml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function field(xml: string, name: string): string {
  const found = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  if (!found) throw new Error('Storage returned an invalid response');
  return unescapeXml(found[1]);
}

/** A failure never includes a signed URL, credential or storage response body. */
export class StorageError extends Error {
  constructor(readonly status: number) { super(`Movie storage request failed (${status})`); }
}

export class R2Storage implements MovieStorage {
  private readonly signer: AwsClient;
  private readonly endpoint: URL;
  private readonly bucket: string;
  constructor(env: Env, private readonly transport: typeof fetch = fetch) {
    const need = (name: string) => {
      const value = readEnv(env, name);
      if (!value) throw new Error(`Missing ${name}`);
      return value;
    };
    this.endpoint = new URL(readEnv(env, 'R2_ENDPOINT') ?? `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(this.endpoint.hostname);
    if ((this.endpoint.protocol !== 'https:' && !(local && this.endpoint.protocol === 'http:')) ||
      this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash || this.endpoint.pathname !== '/') {
      throw new Error('R2_ENDPOINT must be a secure origin or local test origin');
    }
    this.bucket = need('R2_BUCKET');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(this.bucket)) throw new Error('Invalid R2 bucket');
    this.signer = new AwsClient({ accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });
  }
  private url(key: string, query: Record<string, string> = {}): URL {
    if (!key || key.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid movie key');
    const url = new URL(`${encodeURIComponent(this.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`, this.endpoint);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  }
  private async request(method: string, key: string, query: Record<string, string> = {}, body?: string, headers?: HeadersInit): Promise<Response> {
    const request = await this.signer.sign(this.url(key, query), { method, body, headers });
    return this.transport(request);
  }
  private async checked(response: Response): Promise<string> {
    if (!response.ok) { await response.body?.cancel(); throw new StorageError(response.status); }
    const text = await response.text();
    // S3 completion can return HTTP success with an Error document in its body.
    if (/<Error(?:\s|>)/.test(text)) throw new StorageError(502);
    return text;
  }
  async create(key: string, type: string): Promise<string> {
    return field(await this.checked(await this.request('POST', key, { uploads: '' }, undefined, { 'Content-Type': type })), 'UploadId');
  }
  async parts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker = '';
    do {
      const xml = await this.checked(await this.request('GET', key, { uploadId, ...(marker ? { 'part-number-marker': marker } : {}) }));
      for (const item of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
        const number = Number(field(item[1], 'PartNumber'));
        const size = Number(field(item[1], 'Size'));
        if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid uploaded part');
        parts.push({ part_number: number, etag: field(item[1], 'ETag'), size });
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      const next = field(xml, 'NextPartNumberMarker');
      if (!/^\d+$/.test(next) || Number(next) <= Number(marker)) throw new Error('Invalid storage pagination');
      marker = next;
    } while (parts.length <= 10000);
    if (parts.length > 10000) throw new Error('Too many uploaded parts');
    return parts;
  }
  async signPart(key: string, uploadId: string, part: number, bytes: number): Promise<string> {
    if (!Number.isInteger(part) || part < 1 || part > Math.ceil(MOVIE_MAX_BYTES / MOVIE_PART_BYTES) ||
      !Number.isInteger(bytes) || bytes < 1 || bytes > MOVIE_PART_BYTES) throw new Error('Invalid upload part');
    const request = await this.signer.sign(this.url(key, { uploadId, partNumber: String(part), 'X-Amz-Expires': '3600' }), {
      method: 'PUT', headers: { 'Content-Length': String(bytes) }, aws: { signQuery: true, allHeaders: true },
    });
    return request.url;
  }
  async complete(key: string, uploadId: string, parts: Pick<UploadedPart, 'part_number' | 'etag'>[]): Promise<void> {
    if (!parts.length || parts.some((p, index) => p.part_number !== index + 1 || !p.etag)) throw new Error('Invalid completion manifest');
    const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.part_number}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    await this.checked(await this.request('POST', key, { uploadId }, xml, { 'Content-Type': 'application/xml' }));
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const response = await this.request('HEAD', key);
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new StorageError(response.status); }
    const raw = response.headers.get('Content-Length');
    const size = Number(raw);
    if (raw === null || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid object size');
    return { size, content_type: response.headers.get('Content-Type') ?? '' };
  }
  async abort(key: string, uploadId: string): Promise<void> {
    const response = await this.request('DELETE', key, { uploadId });
    if (response.status === 404) { await response.body?.cancel(); return; }
    await this.checked(response);
  }
  async remove(key: string): Promise<void> {
    const response = await this.request('DELETE', key);
    if (response.status === 404) { await response.body?.cancel(); return; }
    await this.checked(response);
  }
  async playUrl(key: string): Promise<{ url: string; expires_at: string }> {
    const request = await this.signer.sign(this.url(key, { 'X-Amz-Expires': '21600' }), { method: 'GET', aws: { signQuery: true } });
    return { url: request.url, expires_at: new Date(Date.now() + 21600 * 1000).toISOString() };
  }
}

export function partBytes(size: number, part: number): number {
  if (!Number.isSafeInteger(size) || size < 1 || size > MOVIE_MAX_BYTES || !Number.isInteger(part) || part < 1 || part > Math.ceil(size / MOVIE_PART_BYTES)) throw new Error('Invalid upload part');
  return Math.min(MOVIE_PART_BYTES, size - (part - 1) * MOVIE_PART_BYTES);
}
