const { execFileSync } = require('node:child_process');
const path = require('node:path');
async function main() {
  const sdk = process.env.ANDROID_HOME;
  if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK.');
  const certificate = execFileSync(
    path.join(sdk, 'build-tools/36.0.0/apksigner'),
    ['verify', '--print-certs', process.argv[2] || 'synvello.apk'],
    { encoding: 'utf8' },
  );
  const digest = /certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(certificate)?.[1]?.toUpperCase();
  if (!digest) throw new Error('The signed package certificate could not be read.');
  const url = 'https://synvello.vercel.app/.well-known/assetlinks.json';
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw new Error('The website signing association is not available.');
  const associations = await response.json();
  const matched = associations.some(
    (entry) =>
      entry.relation?.includes('delegate_permission/common.handle_all_urls') &&
      entry.target?.namespace === 'android_app' &&
      entry.target.package_name === 'app.synvello.android' &&
      entry.target.sha256_cert_fingerprints?.some(
        (fingerprint) => fingerprint.replace(/:/g, '').toUpperCase() === digest,
      ),
  );
  if (!matched)
    throw new Error(
      'Configure ANDROID_CERT_SHA256 on the production website before releasing. Public fingerprint: ' +
        digest.match(/../g).join(':'),
    );
  console.log('Website association matches the signed Android package.');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
