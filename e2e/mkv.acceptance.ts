import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixtures = mkdtempSync(join(tmpdir(), 'synvello-mkv-'));
test.afterAll(() => rmSync(fixtures, { recursive: true, force: true }));
async function preparedBytes(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await (await root.getDirectoryHandle('synvello-mkv')).getDirectoryHandle('acceptance');
    const file = await (await directory.getFileHandle('movie.mp4')).getFile();
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  });
}
test.beforeAll(() => {
  for (const codec of ['aac', 'ac3', 'eac3', 'dca', 'truehd']) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
      '-c:v', 'libx264', '-c:a', codec, '-strict', '-2', '-y', join(fixtures, codec + '.mkv')]);
  }
});
for (const codec of ['aac', 'ac3', 'eac3', 'dca', 'truehd']) {
  test(`MKV with ${codec}: prepares, retains sound, plays and seeks`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByLabel('Movie').setInputFiles(join(fixtures, codec + '.mkv'));
    const result = page.locator('output');
    await expect(result).toContainText('"content_type":"video/mp4"', { timeout: 60000 });
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
      await video.play();
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve(); video.onerror = () => reject(new Error('Playback failed'));
        video.currentTime = 1.5;
      });
    });
    // Inspect the actual converted bytes independently, including the audio track.
    const bytes = await preparedBytes(page);
    const output = join(fixtures, codec + '.mp4');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(output, Buffer.from(bytes));
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
    expect(info.streams.map((stream: { codec_name: string }) => stream.codec_name)).toEqual(['h264', 'aac']);
    execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
    const hashes = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], { encoding: 'utf8' }).split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1));
    expect(hashes(output)).toEqual(hashes(join(fixtures, codec + '.mkv')));
    expect(errors).toEqual([]);
    // A reload must recover the identical prepared bytes for multipart upload resumption.
    const first = await result.textContent();
    await page.reload();
    await page.getByLabel('Movie').setInputFiles(join(fixtures, codec + '.mkv'));
    await expect(result).toHaveText(first!);
    const recovered = await preparedBytes(page);
    expect(Buffer.from(recovered).equals(readFileSync(output))).toBe(true);
  });
}
test('damaged MKV is rejected without a completed cache', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Movie').setInputFiles({ name: 'broken.mkv', mimeType: 'video/x-matroska', buffer: Buffer.from('broken') });
  await expect(page.locator('output')).toContainText('Error:');
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('synvello-mkv')).getDirectoryHandle('acceptance');
    return dir.getFileHandle('ready.json').then(() => true, () => false);
  })).toBe(false);
});

test('VP9 video is converted to H.264', async ({ page }) => {
  const file = join(fixtures, 'vp9.mkv');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=3', '-c:v', 'libvpx-vp9', '-an', '-y', file]);
  await page.goto('/');
  await page.getByLabel('Movie').setInputFiles(file);
  await expect(page.locator('output')).toContainText('"content_type":"video/mp4"', { timeout: 60000 });
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
});
test('cancel removes partial preparation and allows another selection', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'ac3.mkv'));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('output')).toContainText('Error:');
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'aac.mkv'));
  await expect(page.locator('output')).toContainText('"content_type":"video/mp4"', { timeout: 60000 });
});

test('quota failure explains browser storage, removes partial output and permits retry', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await original.apply(this, args);
      if (this.name === 'movie.mp4') stream.write = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
      return stream;
    };
    (window as Window & { restoreWrites?: () => void }).restoreWrites = () => { FileSystemFileHandle.prototype.createWritable = original; };
  });
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'aac.mkv'));
  await expect(page.locator('output')).toContainText('browser ran out of temporary storage');
  await expect(page.locator('output')).toContainText('separate from your Synvello storage allowance');
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('synvello-mkv')).getDirectoryHandle('acceptance');
    return dir.getFileHandle('movie.mp4').then(() => true, () => false);
  })).toBe(false);
  await page.evaluate(() => (window as Window & { restoreWrites?: () => void }).restoreWrites!());
  await page.getByLabel('Movie').setInputFiles([]);
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'aac.mkv'));
  await expect(page.locator('output')).toContainText('"content_type":"video/mp4"');
});

async function destinationWithoutBrowserStorage(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    // Real filesystem handle exercises writes; the browser-cache entry point is then disabled.
    const handle = await root.getFileHandle('chosen-output.mp4', { create: true });
    (window as Window & { testDestination?: FileSystemFileHandle }).testDestination = handle;
    navigator.storage.getDirectory = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
}

test('selected destination prepares playable MP4 without opening browser cache', async ({ page }) => {
  await page.goto('/');
  await destinationWithoutBrowserStorage(page);
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'ac3.mkv'));
  await expect(page.locator('output')).toContainText('"name":"chosen-output.mp4"', { timeout: 60000 });
  await expect(page.locator('output')).toContainText('"content_type":"video/mp4"');
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  const bytes = await page.evaluate(async () => {
    const handle = (window as Window & { testDestination?: FileSystemFileHandle }).testDestination!;
    return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
  });
  const { writeFileSync } = await import('node:fs');
  const output = join(fixtures, 'folder.mp4');
  writeFileSync(output, Buffer.from(bytes));
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
  expect(info.streams.map((s: { codec_name: string }) => s.codec_name)).toEqual(['h264', 'aac']);
  execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
  // Selecting the saved output later must preserve upload-resume name/mtime/bytes.
  const first = await page.locator('output').textContent();
  await page.evaluate(async () => {
    const f = await (window as Window & { testDestination?: FileSystemFileHandle }).testDestination!.getFile();
    const transfer = new DataTransfer(); transfer.items.add(f);
    const input = document.querySelector('input')!;
    input.files = transfer.files; input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('output')).toHaveText(first!);
});

test('selected disk quota error identifies disk, not Synvello allowance', async ({ page }) => {
  await page.goto('/');
  await destinationWithoutBrowserStorage(page);
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'aac.mkv'));
  await expect(page.locator('output')).toContainText('selected disk cannot store');
});

test('failed external preparation preserves existing destination contents', async ({ page }) => {
  await page.goto('/');
  await destinationWithoutBrowserStorage(page);
  await page.evaluate(async () => {
    const handle = (window as Window & { testDestination?: FileSystemFileHandle }).testDestination!;
    const stream = await handle.createWritable(); await stream.write('Existing saved file'); await stream.close();
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await original.apply(this, args);
      stream.write = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
      return stream;
    };
  });
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'aac.mkv'));
  await expect(page.locator('output')).toContainText('selected disk cannot store');
  expect(await page.evaluate(async () => (await (window as Window & { testDestination?: FileSystemFileHandle }).testDestination!.getFile()).text())).toBe('Existing saved file');
});

test('unavailable browser cache reports the alternative destination route', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { navigator.storage.getDirectory = async () => { throw new DOMException('Unavailable', 'SecurityError'); }; });
  await page.getByLabel('Movie').setInputFiles(join(fixtures, 'aac.mkv'));
  await expect(page.locator('output')).toContainText('Browser temporary storage is unavailable');
  await expect(page.locator('output')).toContainText('folder');
});
