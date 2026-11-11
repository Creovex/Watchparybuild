// Public certificate of the website-distributed Android app. The private key is never committed.
const RELEASE_CERTIFICATE = '23:EA:48:4B:A2:0A:52:68:6A:A2:52:91:1B:AB:09:54:41:A1:D8:06:CE:90:09:92:02:E1:6C:2A:2A:3C:9E:58';

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256?.trim() || RELEASE_CERTIFICATE)
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  return Response.json(
    fingerprints.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: 'app.synvello.android',
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [],
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
