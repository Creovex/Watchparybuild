const { createRequire } = require('node:module');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const cliRequire = createRequire(require.resolve('@bubblewrap/cli/package.json'));
const { TwaManifest, TwaGenerator } = cliRequire('@bubblewrap/core');
const { fetchUtils } = cliRequire('@bubblewrap/core/dist/lib/FetchUtils');
// Use Node's proxy-aware fetch with the inherited TLS trust settings.
fetchUtils.fetch = (url) => fetch(url);
const data = JSON.parse(readFileSync(path.join(__dirname, '../twa-manifest.json'), 'utf8'));
if (process.env.ANDROID_VERSION_CODE) {
  const code = Number(process.env.ANDROID_VERSION_CODE);
  if (!Number.isInteger(code) || code < 1 || code > 2100000000)
    throw new Error('Invalid Android build number');
  data.appVersionCode = code;
  data.appVersion = process.env.ANDROID_VERSION_NAME || data.appVersion;
}
const manifest = new TwaManifest(data);
const output = path.join(__dirname, '../generated');
mkdirSync(output, { recursive: true });
const log = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };
new TwaGenerator()
  .createTwaProject(output, manifest, log)
  .then(() => {
    const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
    chmodSync(path.join(output, 'gradlew'), 0o755);
    const build = path.join(output, 'app/build.gradle');
    writeFileSync(
      build,
      readFileSync(build, 'utf8').replace(
        /com\.google\.androidbrowserhelper:androidbrowserhelper:[^'"\s]+/g,
        'com.google.androidbrowserhelper:androidbrowserhelper:2.7.4',
      ),
    );
    const wrapper = path.join(output, 'gradle/wrapper/gradle-wrapper.properties');
    const pinned = readFileSync(path.join(__dirname, '../gradle-distribution.properties'), 'utf8');
    writeFileSync(
      wrapper,
      readFileSync(wrapper, 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('distributionUrl=') && !line.startsWith('distributionSha256Sum='))
        .join('\n') +
        '\n' +
        pinned,
    );
    console.log('Android project generated.');
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
