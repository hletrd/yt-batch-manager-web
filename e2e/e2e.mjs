// E2E flow verification with a fully mocked Google/YouTube backend — no real
// credentials needed. Covers: OAuth start (PKCE S256), code->token exchange,
// video load chain, rendering (badges/fields), save PUT bodies (incl. the
// recordingDetails changed-flag semantics), 401 silent-refresh-retry, cache
// reload, quota-403 messaging, and logout.
//
// Run:
//   npm run build && npx http-server dist -p 8753 -c-1 &
//   cd e2e && npm init -y && npm i playwright && node e2e.mjs
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const APP = 'http://127.0.0.1:8753/';
const results = [];
const ok = (name, cond, detail = '') =>
  results.push({ name, pass: !!cond, detail: cond ? '' : detail });

const VID_A = 'AAAAAAAAAA1'; // vertical 45s short, kids, has recordingDetails
const VID_B = 'BBBBBBBBBB2'; // landscape 5m

const videoItem = (id, opts) => ({
  id,
  snippet: {
    title: opts.title, description: 'desc ' + id, publishedAt: '2024-01-01T00:00:00Z',
    categoryId: '22', tags: opts.tags || [], defaultAudioLanguage: 'en',
    thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mq.jpg`, width: 320, height: 180 } }
  },
  status: {
    privacyStatus: 'public', containsSyntheticMedia: false, madeForKids: opts.kids,
    license: 'youtube', embeddable: true, publicStatsViewable: true, uploadStatus: 'processed'
  },
  contentDetails: { duration: opts.duration },
  statistics: { viewCount: '100', likeCount: '5', commentCount: '1' },
  ...(opts.rec ? { recordingDetails: { recordingDate: '2023-05-10T00:00:00.000Z', location: { latitude: 37.5, longitude: 127 } } } : {})
});

const fixtures = {
  videos: [
    videoItem(VID_A, { title: 'Short video', tags: ['alpha', 'beta'], kids: true, duration: 'PT45S', rec: true }),
    videoItem(VID_B, { title: 'Long video', tags: [], kids: false, duration: 'PT5M' })
  ],
  fileDetails: [
    { id: VID_A, fileDetails: { videoStreams: [{ widthPixels: 1080, heightPixels: 1920 }] } },
    { id: VID_B, fileDetails: { videoStreams: [{ widthPixels: 1920, heightPixels: 1080 }] } }
  ]
};

const counters = { token: 0, playlistItems: 0, videosList: 0, put: 0 };
const captured = { authUrl: null, tokenBodies: [], putRequests: [], retriedAuthHeader: null };
let arm401Channels = false, armQuotaChannels = false;
let accessTokenNo = 1;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();

  const pageErrors = [];
  // Tests 7 and 9 deliberately arm a 401 and a 403 response; the resulting
  // resource-load + handled quota errors are expected, not regressions.
  const EXPECTED = [
    /status of 401/, /status of 403/, /quotaExceeded/
  ];
  page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (EXPECTED.some(re => re.test(t))) return;
    pageErrors.push('console: ' + t);
  });

  // Catch-all FIRST (lowest priority): allow app origin, abort the rest.
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(APP)) return r.continue();
    return r.abort();
  });
  await page.route('**/i.ytimg.com/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route(APP + 'credentials.json', r => r.fulfill({ json: { web: { client_id: 'test-client-id', client_secret: 'test-secret' } } }));
  await page.route('https://accounts.google.com/**', r => {
    captured.authUrl = r.request().url();
    return r.fulfill({ contentType: 'text/html', body: '<html><body>google-mock</body></html>' });
  });
  await page.route('https://oauth2.googleapis.com/token', async r => {
    counters.token++;
    captured.tokenBodies.push(r.request().postData() || '');
    const tok = 'at-' + (accessTokenNo++);
    return r.fulfill({ json: { access_token: tok, expires_in: 3600, refresh_token: counters.token === 1 ? 'rt-1' : undefined } });
  });
  await page.route('https://www.googleapis.com/**', async r => {
    const u = new URL(r.request().url());
    const part = u.searchParams.get('part') || '';
    const method = r.request().method();
    if (u.pathname.endsWith('/videos') && method === 'PUT') {
      counters.put++;
      captured.putRequests.push({ part, body: JSON.parse(r.request().postData() || '{}') });
      return r.fulfill({ json: {} });
    }
    if (u.pathname.endsWith('/channels')) {
      if (part.includes('contentDetails')) {
        if (arm401Channels) { arm401Channels = false; return r.fulfill({ status: 401, json: { error: { errors: [{ reason: 'authError' }], message: 'Invalid Credentials' } } }); }
        if (armQuotaChannels) { armQuotaChannels = false; return r.fulfill({ status: 403, json: { error: { errors: [{ reason: 'quotaExceeded' }], message: 'You have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.' } } }); }
        captured.retriedAuthHeader = r.request().headers()['authorization'] || null;
        return r.fulfill({ json: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUtestuploads' } } }] } });
      }
      return r.fulfill({ json: { items: [{ snippet: { title: 'Test Channel', thumbnails: { default: { url: `https://i.ytimg.com/ch.png` } } } }] } });
    }
    if (u.pathname.endsWith('/playlistItems')) {
      counters.playlistItems++;
      return r.fulfill({ json: { items: [{ contentDetails: { videoId: VID_A } }, { contentDetails: { videoId: VID_B } }] } });
    }
    if (u.pathname.endsWith('/videos') && part === 'fileDetails') {
      return r.fulfill({ json: { items: fixtures.fileDetails } });
    }
    if (u.pathname.endsWith('/videos')) {
      counters.videosList++;
      return r.fulfill({ json: { items: fixtures.videos } });
    }
    if (u.pathname.endsWith('/videoCategories')) {
      return r.fulfill({ json: { items: [{ id: '22', snippet: { title: 'People & Blogs' } }, { id: '10', snippet: { title: 'Music' } }] } });
    }
    if (u.pathname.endsWith('/i18nLanguages')) {
      return r.fulfill({ json: { items: [{ id: 'en', snippet: { name: 'English' } }, { id: 'ko', snippet: { name: 'Korean' } }] } });
    }
    return r.fulfill({ status: 404, json: {} });
  });

  // ---- 1. Cold load: auth prompt ----
  await page.goto(APP, { waitUntil: 'load' });
  const authBtn = page.locator('.auth-button');
  await authBtn.waitFor({ state: 'visible', timeout: 15000 });
  ok('1. cold load shows auth prompt', true);
  ok('1b. html lang set', ['en', 'ko'].includes(await page.evaluate(() => document.documentElement.lang)));

  // ---- 2. OAuth start: redirect URL + PKCE ----
  const verifierP = page.evaluate(() => new Promise(res => {
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { orig(k, v); if (k === 'oauth_code_verifier') res(v); };
  }));
  await authBtn.click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 15000 });
  const au = new URL(captured.authUrl);
  const q = au.searchParams;
  ok('2. redirects to accounts.google.com/o/oauth2/auth', au.pathname === '/o/oauth2/auth');
  ok('2b. client_id', q.get('client_id') === 'test-client-id');
  ok('2c. redirect_uri = app origin', q.get('redirect_uri') === APP);
  ok('2d. scope minimal (force-ssl only)', q.get('scope') === 'https://www.googleapis.com/auth/youtube.force-ssl');
  ok('2e. offline + consent', q.get('access_type') === 'offline' && q.get('prompt') === 'consent');
  ok('2f. PKCE S256 challenge present', q.get('code_challenge_method') === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') || ''));
  const state = q.get('state');
  ok('2g. state present', !!state && state.length >= 16);

  // ---- 3. OAuth callback: token exchange ----
  await page.goto(APP + '?code=TESTCODE99&state=' + encodeURIComponent(state), { waitUntil: 'load' });
  await page.locator(`#video-${VID_A}`).waitFor({ state: 'visible', timeout: 20000 });
  const tb = new URLSearchParams(captured.tokenBodies[0] || '');
  ok('3. token exchange called once', counters.token === 1, 'token calls=' + counters.token);
  ok('3b. grant authorization_code + code', tb.get('grant_type') === 'authorization_code' && tb.get('code') === 'TESTCODE99');
  const verifier = tb.get('code_verifier') || '';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  ok('3c. PKCE verifier matches challenge', !!verifier && challenge === q.get('code_challenge'), `sha256(${verifier})=${challenge}`);
  ok('3d. client_secret + redirect_uri sent', tb.get('client_secret') === 'test-secret' && tb.get('redirect_uri') === APP);
  ok('3e. tokens stored', await page.evaluate(() => localStorage.getItem('youtube_access_token') === 'at-1' && localStorage.getItem('youtube_refresh_token') === 'rt-1'));
  ok('3f. url cleaned of code/state', !page.url().includes('code='));

  // ---- 4. Render assertions ----
  ok('4. two cards rendered', await page.locator('.video-item').count() === 2);
  ok('4b. Short badge only on vertical 45s', await page.locator(`#video-${VID_A} .short-badge`).count() === 1 && await page.locator(`#video-${VID_B} .short-badge`).count() === 0);
  ok('4c. kids badge only on A', await page.locator(`#video-${VID_A} .made-for-kids-badge`).count() === 1 && await page.locator(`#video-${VID_B} .made-for-kids-badge`).count() === 0);
  ok('4d. recording date loaded', await page.locator(`#recording-date-${VID_A}`).inputValue() === '2023-05-10');
  ok('4e. lat/lng loaded', await page.locator(`#latitude-${VID_A}`).inputValue() === '37.5' && await page.locator(`#longitude-${VID_A}`).inputValue() === '127');
  ok('4f. tags rendered', await page.locator(`#tags-container-${VID_A} .tag-chip`).count() === 2);
  ok('4g. license select', await page.locator(`#license-${VID_A}`).inputValue() === 'youtube');
  ok('4h. cache written (source=youtube)', await page.evaluate(() => !!localStorage.getItem('yt_video_cache')));

  // ---- 5. Title edit -> save: PUT body, no recordingDetails part ----
  await page.fill(`#title-${VID_A}`, 'Short video EDITED');
  const updBtn = page.locator(`#update-btn-${VID_A}`);
  await updBtn.waitFor({ state: 'visible', timeout: 5000 });
  await updBtn.click();
  await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('updated'), null, { timeout: 10000 });
  const put1 = captured.putRequests[0];
  ok('5. PUT sent once', counters.put === 1);
  ok('5b. title updated in snippet', put1.body.snippet?.title === 'Short video EDITED');
  ok('5c. status fields round-tripped', put1.body.status?.license === 'youtube' && put1.body.status?.embeddable === true && put1.body.status?.publicStatsViewable === true && put1.body.status?.privacyStatus === 'public');
  ok('5d. NO recordingDetails on incidental save', !put1.part.includes('recordingDetails') && !('recordingDetails' in put1.body), JSON.stringify(put1));
  ok('5e. selfDeclaredMadeForKids never sent', !('selfDeclaredMadeForKids' in (put1.body.status || {})));

  // ---- 6. Clear recording date -> save: empty recordingDetails propagates ----
  await page.fill(`#recording-date-${VID_A}`, '');
  await page.dispatchEvent(`#recording-date-${VID_A}`, 'change');
  // also clear location so the body is a full clear
  await page.fill(`#latitude-${VID_A}`, ''); await page.dispatchEvent(`#latitude-${VID_A}`, 'change');
  await page.fill(`#longitude-${VID_A}`, ''); await page.dispatchEvent(`#longitude-${VID_A}`, 'change');
  await updBtn.waitFor({ state: 'visible', timeout: 5000 });
  await updBtn.click();
  await page.waitForFunction(c => (window.app && document.querySelectorAll('.video-item.changed').length === 0), null, { timeout: 10000 });
  const put2 = captured.putRequests[1];
  ok('6. clear sends recordingDetails part', put2 && put2.part.includes('recordingDetails'), JSON.stringify(put2 || {}));
  ok('6b. empty body = intentional clear', put2 && JSON.stringify(put2.body.recordingDetails) === '{}');

  // ---- 7. 401 -> silent refresh -> retry ----
  arm401Channels = true;
  await page.click('#refresh-videos-btn');
  await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.includes('Loaded'), null, { timeout: 15000 });
  const refreshBody = new URLSearchParams(captured.tokenBodies[1] || '');
  ok('7. refresh-token grant used', refreshBody.get('grant_type') === 'refresh_token' && refreshBody.get('refresh_token') === 'rt-1');
  ok('7b. retried with NEW bearer', captured.retriedAuthHeader === 'Bearer at-2', 'got ' + captured.retriedAuthHeader);
  ok('7c. videos reloaded after refresh', await page.locator('.video-item').count() === 2);

  // ---- 8. Reload -> serves from cache (no playlistItems hit) ----
  const plBefore = counters.playlistItems;
  await page.reload({ waitUntil: 'load' });
  await page.locator('.video-item').first().waitFor({ state: 'visible', timeout: 15000 });
  ok('8. cards from cache on reload', await page.locator('.video-item').count() === 2);
  ok('8b. no new playlistItems call', counters.playlistItems === plBefore, `before=${plBefore} after=${counters.playlistItems}`);
  ok('8c. status says cached', await page.evaluate(() => document.getElementById('status-message')?.textContent?.includes('(Cached)')));

  // ---- 9. Quota 403 -> friendly message ----
  armQuotaChannels = true;
  await page.click('#refresh-videos-btn');
  await page.waitForFunction(() => document.getElementById('status-message')?.textContent?.toLowerCase().includes('quota'), null, { timeout: 15000 });
  const quotaMsg = await page.evaluate(() => document.getElementById('status-message')?.textContent || '');
  ok('9. friendly quota message', quotaMsg.includes('daily quota exceeded') && quotaMsg.includes('Pacific Time'), quotaMsg);
  ok('9b. no raw html in message', !quotaMsg.includes('<a') && !quotaMsg.includes('href'));

  // ---- 10. Logout ----
  await page.evaluate(() => window.app.logout());
  ok('10. tokens cleared', await page.evaluate(() => !localStorage.getItem('youtube_access_token') && !localStorage.getItem('youtube_refresh_token')));
  ok('10b. auth prompt back', await page.locator('.auth-button').count() >= 1);
  ok('10c. video cache cleared on logout', await page.evaluate(() => !localStorage.getItem('yt_video_cache')));

  // ---- console/page errors ----
  ok('11. zero page/console errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();

  let fail = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -- ' + r.detail}`);
    if (!r.pass) fail++;
  }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error('FATAL', e); process.exit(2); });
