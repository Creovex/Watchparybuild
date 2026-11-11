# Synvello for Android

This Trusted Web Activity opens the live website in Chrome. It uses the package identifier `app.synvello.android`. The identifier and signing key must remain stable for installed apps to update in place.

Install the repository's pinned dependencies, then run `pnpm --filter @watchparty/android generate`. Bubblewrap generates the native project under `generated/`, which is ignored by Git. Generation uses Node's built-in fetch with inherited proxy settings and certificate trust; it never disables certificate verification. Install the Android platform and build tools required by the generated project, then run `./gradlew --no-daemon --max-workers=2 :app:assembleRelease` inside `generated/`.

The generated release package is unsigned. Do not distribute it as an installable app. The manually started Android release workflow aligns, signs and verifies the package before attaching `synvello.apk` to a GitHub Release. The website's `/android` page shows a download only when that release asset exists.

Configure these repository Actions secrets securely:

- `ANDROID_KEYSTORE_BASE64`: the signing keystore encoded as base64.
- `ANDROID_KEYSTORE_PASSWORD`: the password protecting the keystore.
- `ANDROID_KEY_PASSWORD`: the password protecting the signing key.
- `ANDROID_KEY_ALIAS`: the key alias in the keystore.

Keep an independent, secure backup of the keystore and passwords. Losing the key prevents updates to existing installations. Do not commit keys or passwords. The current integration cannot write Actions secrets, so the repository owner supplies them in GitHub settings.

The website includes the public certificate fingerprint for its directly downloaded Android app. The private key is never committed. `ANDROID_CERT_SHA256` in Vercel optionally overrides this association; multiple fingerprints may be comma-separated. The website serves Digital Asset Links, the association between the website and the Android signing certificate, at `/.well-known/assetlinks.json`. The release check compares this public response with the actual signed package before publication. Real-device verification is separate.

On a real Android phone, test Google sign in, microphone, camera, selecting a file, interruption and resumption, and opening a private room link with its fragment intact. Check the current Android developer distribution rules before sharing outside your own devices. The website remains the supported option on iPhone.

Bubblewrap uses the Apache licence. Its exact dependency pin lives in the package manifest and lockfile. Generated Android files retain their upstream copyright and licence notices.

The Gradle distribution URL and its official SHA-256 checksum are pinned in `gradle-distribution.properties`. Generation copies them into the wrapper configuration, and the wrapper verifies the downloaded distribution. Builds require a full Java Development Kit with a compiler, not a runtime alone.

The release workflow checks that the website association matches the signed certificate before publishing. Signing secrets are passed only to the validation and signing steps, not dependency installation. Each workflow run supplies an increasing application build number after the initial directly signed release; the configured release tag becomes the display version.

## Preserved signing identity

The initial signing identity is backed up in the project's encrypted Supabase Vault, independently of the execution workspace. Anonymous and signed-in application users cannot read the decrypted Vault table. A backup read-back check confirmed the preserved keystore and passwords before the initial package was signed. Never replace this identity for routine updates.

The current GitHub integration cannot write Actions secrets. The initial release is signed locally using the preserved identity. Before using the automated workflow, the repository owner must securely transfer these Vault values into the matching GitHub Actions secrets:

| Encrypted Vault entry | GitHub Actions secret |
| --- | --- |
| `android_signing_keystore_base64` | `ANDROID_KEYSTORE_BASE64` |
| `android_signing_store_password` | `ANDROID_KEYSTORE_PASSWORD` |
| `android_signing_key_password` | `ANDROID_KEY_PASSWORD` |
| `android_signing_alias` | `ANDROID_KEY_ALIAS` |

`android_signing_certificate_sha256` records the public fingerprint. Keep an additional independent secure backup under the account owner's control. Decode the keystore value only in a trusted environment, and keep passwords out of chat, Git, terminal output and screenshots. No signing material belongs in the public movie bucket or browser configuration.
