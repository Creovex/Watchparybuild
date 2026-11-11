import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/.well-known/assetlinks.json/route';

afterEach(() => vi.unstubAllEnvs());

describe('Android website association', () => {
  it('serves the released app certificate without requiring a deployment secret', async () => {
    vi.stubEnv('ANDROID_CERT_SHA256', undefined);
    const response = GET();
    const associations = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(associations).toHaveLength(1);
    expect(associations[0].target.package_name).toBe('app.synvello.android');
    expect(associations[0].target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('supports an explicit certificate override for future signing changes', async () => {
    const fingerprint = Array(32).fill('ab').join(':');
    vi.stubEnv('ANDROID_CERT_SHA256', ` ${fingerprint},invalid `);
    const associations = await GET().json();
    expect(associations[0].target.sha256_cert_fingerprints).toEqual([fingerprint.toUpperCase()]);
  });

  it('does not publish a malformed certificate association', async () => {
    vi.stubEnv('ANDROID_CERT_SHA256', 'invalid');
    expect(await GET().json()).toEqual([]);
  });
});
