// Spike S1 probe: paste into the browser console of a Netflix, Prime Video or Disney+ tab while a
// title is open and playing, on desktop Chrome or Edge. It tries each capability the sync extension
// needs 10 times in a row and prints one PASS or FAIL line per capability, then a table row to copy
// into docs/spike-results.md. Throwaway code: the spikes folder is deleted after Phase 1.
//
// Seeking by currentTime runs last because some services show an error screen after it; reload the
// tab if that happens and note it. For the buffering check, turn on network throttling in the
// developer tools (Network, Slow 4G or Slow 3G) when the probe asks, so the player has to wait.

(async () => {
  const RUNS = 10;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const host = location.hostname;
  const service = /netflix\.com$/.test(host)
    ? 'Netflix'
    : /primevideo\.com$|amazon\.(com|co\.uk|de|ca)$/.test(host)
      ? 'Prime Video'
      : /disneyplus\.com$/.test(host)
        ? 'Disney+'
        : null;
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const browser = brands.some((b) => /Edge/.test(b.brand)) || /Edg\//.test(navigator.userAgent) ? 'Edge' : 'Chrome';
  if (!service) {
    console.warn('S1 probe: open a Netflix, Prime Video or Disney+ watch page first.');
    return;
  }

  // The video the extension would drive: visible, then largest, then playing, then longest.
  function findVideo() {
    const better = (a, b) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
      return false;
    };
    let best = null;
    let bestScore = null;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      const score = [area > 0 ? 1 : 0, Math.round(area), v.paused ? 0 : 1, Number.isFinite(v.duration) ? v.duration : 0];
      if (!bestScore || better(score, bestScore)) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  function errorScreen() {
    const text = (document.body && document.body.innerText) || '';
    return /whoops|something went wrong|error code|M7375|we're having trouble|unexpected error/i.test(text);
  }

  function once(target, names, timeoutMs) {
    return new Promise((done) => {
      const timer = setTimeout(() => finish(null), timeoutMs);
      function finish(name) {
        clearTimeout(timer);
        for (const n of names) target.removeEventListener(n, handlers[n]);
        done(name);
      }
      const handlers = {};
      for (const n of names) {
        handlers[n] = () => finish(n);
        target.addEventListener(n, handlers[n]);
      }
    });
  }

  async function ensurePlaying(v) {
    if (!v.paused) return;
    await Promise.race([v.play().catch(() => undefined), sleep(5000)]);
    await sleep(500);
  }

  const results = [];
  // Runs one capability RUNS times. `finalCheck` may return a reason the capability still fails.
  async function capability(name, run, finalCheck) {
    let passes = 0;
    const notes = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        const outcome = await run(i);
        if (outcome === true) passes++;
        else notes.push(`run ${i + 1}: ${outcome || 'no effect'}`);
      } catch (error) {
        notes.push(`run ${i + 1}: ${error && error.name}: ${error && error.message}`);
      }
      if (errorScreen()) {
        notes.push(`run ${i + 1}: the service showed an error screen`);
        break;
      }
    }
    const extra = finalCheck ? finalCheck() : null;
    if (extra) notes.unshift(extra);
    const result = passes === RUNS && !extra && !errorScreen() ? 'PASS' : 'FAIL';
    results.push({ name, result, passes, notes });
    console.log(`${result} ${name} (${passes} of ${RUNS})${notes.length ? `: ${notes.slice(0, 3).join('; ')}` : ''}`);
    return result;
  }

  console.log(`S1 probe: ${service} on ${browser}, ${new Date().toISOString().slice(0, 10)}. Leave the tab in front until it finishes.`);

  await capability('Find video', async () => Boolean(findVideo()));

  await capability('Play', async () => {
    const v = findVideo();
    v.pause();
    await sleep(400);
    const before = v.currentTime;
    const result = await Promise.race([v.play().then(() => 'ok', (e) => e.name), sleep(5000).then(() => 'timeout')]);
    await sleep(800);
    if (result !== 'ok') return `play() gave ${result}`;
    return !v.paused && v.currentTime > before ? true : 'did not advance after play';
  });

  await capability('Pause', async () => {
    const v = findVideo();
    await ensurePlaying(v);
    v.pause();
    await sleep(600);
    const at = v.currentTime;
    await sleep(600);
    return v.paused && Math.abs(v.currentTime - at) < 0.05 ? true : 'kept playing';
  });

  await capability('Position', async () => {
    const v = findVideo();
    await ensurePlaying(v);
    const a = v.currentTime;
    const t0 = performance.now();
    await sleep(1000);
    const advanced = v.currentTime - a;
    const elapsed = (performance.now() - t0) / 1000;
    return Math.abs(advanced - elapsed) < 0.35 ? true : `advanced ${advanced.toFixed(2)} s in ${elapsed.toFixed(2)} s`;
  });

  console.log('S1 probe: turn on network throttling now (developer tools, Network, Slow 3G). Starting in 10 seconds.');
  await sleep(10000);
  let waitingSeen = 0;
  const countWaiting = () => waitingSeen++;
  const watched = findVideo();
  watched.addEventListener('waiting', countWaiting);
  await capability(
    'Buffering events',
    async () => {
      const v = findVideo();
      v.pause();
      await sleep(300);
      const playing = once(v, ['playing'], 15000);
      v.play().catch(() => undefined);
      return (await playing) === 'playing' ? true : 'no playing event after resuming';
    },
    () => (waitingSeen === 0 ? 'no waiting event was seen; rerun with network throttling on' : null),
  );
  watched.removeEventListener('waiting', countWaiting);
  console.log(`S1 probe: ${waitingSeen} waiting events seen. Turn network throttling off now.`);
  await sleep(5000);

  await capability('Volume', async (i) => {
    const v = findVideo();
    const original = v.volume;
    const target = i % 2 ? 0.4 : 0.6;
    v.volume = target;
    await sleep(500);
    const held = Math.abs(v.volume - target) < 0.01;
    v.volume = original;
    return held ? true : `volume went back to ${v.volume.toFixed(2)}`;
  });

  for (const rate of [0.95, 1.05]) {
    await capability(`Rate ${rate}`, async () => {
      const v = findVideo();
      await ensurePlaying(v);
      v.playbackRate = rate;
      const a = v.currentTime;
      const t0 = performance.now();
      await sleep(2000);
      const advanced = v.currentTime - a;
      const elapsed = (performance.now() - t0) / 1000;
      const held = v.playbackRate === rate;
      v.playbackRate = 1;
      await sleep(300);
      if (!held) return `rate went back to ${v.playbackRate}`;
      return Math.abs(advanced / elapsed - rate) < 0.03 ? true : `played at ${(advanced / elapsed).toFixed(3)}`;
    });
  }

  const latencies = [];
  await capability('Seek by currentTime', async (i) => {
    const v = findVideo();
    await ensurePlaying(v);
    const target = Math.max(5, v.currentTime + (i % 2 ? -30 : 30));
    const t0 = performance.now();
    const seeked = once(v, ['seeked'], 8000);
    v.currentTime = target;
    if ((await seeked) !== 'seeked') return 'no seeked event';
    await Promise.race([once(v, ['playing', 'timeupdate'], 8000), sleep(8000)]);
    latencies.push((performance.now() - t0) / 1000);
    await sleep(500);
    return Math.abs(v.currentTime - target) < 1.5 ? true : `landed at ${v.currentTime.toFixed(1)} instead of ${target.toFixed(1)}`;
  });
  if (latencies.length) {
    const recent = latencies.slice(-5);
    console.log(`S1 probe: seek latency, average of the last ${recent.length}: ${(recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2)} s`);
  }

  // Netflix's own player, reached from the page's main world, which is where this console runs.
  // The extension would need a script injected into the main world to use it.
  let pagePlayer = 'NOT RUN';
  if (service === 'Netflix') {
    pagePlayer = await capability('Seek by page player (Netflix)', async (i) => {
      const api = window.netflix && window.netflix.appContext && window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      if (!api) return 'netflix.appContext player not found';
      const player = api.getVideoPlayerBySessionId(api.getAllPlayerSessionIds()[0]);
      const v = findVideo();
      const target = Math.max(5, v.currentTime + (i % 2 ? -30 : 30));
      const seeked = once(v, ['seeked'], 8000);
      player.seek(Math.round(target * 1000));
      if ((await seeked) !== 'seeked') return 'no seeked event';
      await sleep(800);
      return Math.abs(v.currentTime - target) < 1.5 ? true : `landed at ${v.currentTime.toFixed(1)}`;
    });
  } else {
    console.log(`NOT RUN Seek by page player: no known page player for ${service}; record what the page exposes, if anything.`);
  }

  const cell = (name) => (results.find((r) => r.name === name) || { result: 'NOT RUN' }).result;
  const row = [
    service,
    browser,
    cell('Find video'),
    cell('Play'),
    cell('Pause'),
    cell('Position'),
    cell('Buffering events'),
    cell('Volume'),
    cell('Rate 0.95'),
    cell('Rate 1.05'),
    cell('Seek by currentTime'),
    pagePlayer,
    `${location.origin}${location.pathname.replace(/[A-Za-z0-9-]{6,}/g, '*')}`,
    `${location.origin}${location.pathname}`,
  ];
  console.log('S1 probe: copy this row into the S1 table in docs/spike-results.md, then edit the last two columns:');
  console.log(`| ${row.join(' | ')} |`);
  console.log('S1 probe: notes per capability', results.map((r) => ({ capability: r.name, result: r.result, notes: r.notes.join('; ') })));
})();
