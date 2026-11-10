export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? '')
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
