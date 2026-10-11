# The extension's key pair

Chrome and Edge give an unpacked extension an id computed from the public key in its manifest's `key` field. This repository's manifest (`apps/extension/manifest.config.ts`, `PUBLIC_KEY`) carries the public half of a key pair made for this project, so every unpacked install gets the id `appcjgbhipnbklhodimgbmjhbncljoip`. The web app finds the extension through that id (`NEXT_PUBLIC_EXTENSION_IDS`), and the Edge Functions accept requests from `chrome-extension://appcjgbhipnbklhodimgbmjhbncljoip` once it is listed in their `EXTENSION_ORIGINS` secret.

The private half is not in the repository and must never be committed (`*.pem` is git ignored). James keeps it.

## Making your own key pair

To use a key pair of your own instead:

1. Make a private key, kept outside the repository:

   ```sh
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out ~/watchparty-extension-key.pem
   ```

2. Print the public key in the base64 DER form the manifest wants:

   ```sh
   openssl rsa -in ~/watchparty-extension-key.pem -pubout -outform DER | openssl base64 -A
   ```

3. Put that text in `PUBLIC_KEY` in `apps/extension/manifest.config.ts`.

4. Work out the new extension id (the first 32 hexadecimal characters of the SHA-256 hash of the DER key, with 0 to f written as a to p):

   ```sh
   openssl rsa -in ~/watchparty-extension-key.pem -pubout -outform DER | openssl dgst -sha256 | awk '{print $NF}' | cut -c1-32 | tr '0-9a-f' 'a-p'
   ```

5. Replace the old id everywhere it appears: `NEXT_PUBLIC_EXTENSION_IDS` in the web app's env files and hosting settings, `EXTENSION_ORIGINS` in the Edge Function secrets, the expected id in `apps/extension/scripts/verify-dist.mjs` and `apps/extension/e2e/detect.spec.ts`, and `docs/decisions.md`.

6. Rebuild (`pnpm --filter @watchparty/extension build`) and reload the unpacked extension. `pnpm --filter @watchparty/extension verify-dist` checks the id.

## Publishing

The first upload to the Chrome Web Store can include the private key as `key.pem` at the root of the uploaded zip file, so the store keeps the same id; check the store's current publishing instructions when you get there, as they change. The Edge Add-ons store may assign a different id (unconfirmed); if it does, add that id to `NEXT_PUBLIC_EXTENSION_IDS` and to `EXTENSION_ORIGINS` beside this one.
