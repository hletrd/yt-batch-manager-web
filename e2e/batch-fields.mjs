// Focused E2E suite for batch editing via JSON/ZIP backups and the status
// fields that videos.update must round-trip, against a fully mocked
// Google/YouTube backend (no real credentials or quota).
//
// Run: npm run build && npx http-server dist -p 8755 -c-1 & cd e2e && node batch-fields.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const APP = 'http://127.0.0.1:8755/';
const results = [];
const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail: cond ? '' : detail });

const VID_S = 'SSSSSSSSSS1'; // private, scheduled to publish
const VID_P = 'PPPPPPPPPP2'; // public, every status field set
const SCHEDULE = '2030-01-01T09:00:00Z';

const videoItem = (id, opts) => ({
  id,
  snippet: {
    title: opts.title, description: 'desc ' + id, publishedAt: '2024-01-01T00:00:00Z',
    categoryId: '22', tags: opts.tags || [], defaultAudioLanguage: 'en',
    thumbnails: {
      medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, width: 320, height: 180 },
      maxres: { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, width: 1280, height: 720 }
    }
  },
  status: {
    privacyStatus: opts.privacy, containsSyntheticMedia: false, madeForKids: false,
    license: 'youtube', embeddable: true, publicStatsViewable: true, uploadStatus: 'processed',
    ...(opts.publishAt ? { publishAt: opts.publishAt } : {})
  },
  contentDetails: { duration: 'PT5M' },
  statistics: { viewCount: '10', likeCount: '1', commentCount: '0' }
});

const fixtures = [
  videoItem(VID_S, { title: 'Scheduled video', privacy: 'private', publishAt: SCHEDULE }),
  videoItem(VID_P, { title: 'Public video', privacy: 'public', tags: ['keep', 'these'] })
];

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const counters = { playlistItems: 0 };
const puts = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
// Seed a valid session, plus (on the very first load only) a cache written by
// a pre-v2 build: it must be discarded, because it lacks publish_at.
await ctx.addInitScript(([schedule, id]) => {
  localStorage.setItem('youtube_access_token', 'test-token');
  localStorage.setItem('youtube_token_expiry', String(Date.now() + 3600_000));
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('yt_video_cache', JSON.stringify({
      timestamp: Date.now(),
      videos: [{ id, title: 'stale cached', description: '', thumbnail_url: 'https://i.ytimg.com/x.jpg', thumbnails: {}, published_at: '', privacy_status: 'private', category_id: '22' }]
    }));
  }
}, [SCHEDULE, VID_S]);
const page = await ctx.newPage();

const pageErrors = [];
page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

await page.route('**/*', r => r.request().url().startsWith(APP) ? r.continue() : r.abort());
// Thumbnail CDN: serve a 1x1 PNG with the CORS header i.ytimg.com really sends
// (the ZIP export fetch()es these cross-origin).
await page.route('https://i.ytimg.com/**', r => r.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG }));
await page.route(APP + 'credentials.json', r => r.fulfill({ json: { web: { client_id: 'cid', client_secret: 'sec' } } }));
await page.route('https://www.googleapis.com/**', async r => {
  const u = new URL(r.request().url());
  const part = u.searchParams.get('part') || '';
  if (u.pathname.endsWith('/videos') && r.request().method() === 'PUT') {
    puts.push({ part, body: JSON.parse(r.request().postData() || '{}') });
    return r.fulfill({ json: {} });
  }
  if (u.pathname.endsWith('/channels')) {
    if (part.includes('contentDetails')) {
      return r.fulfill({ json: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUtest' } } }] } });
    }
    return r.fulfill({ json: { items: [{ snippet: { title: 'Test Channel' } }] } });
  }
  if (u.pathname.endsWith('/playlistItems')) {
    counters.playlistItems++;
    return r.fulfill({ json: { items: fixtures.map(v => ({ contentDetails: { videoId: v.id } })) } });
  }
  if (u.pathname.endsWith('/videos') && part === 'fileDetails') {
    return r.fulfill({ json: { items: [] } });
  }
  if (u.pathname.endsWith('/videos')) {
    return r.fulfill({ json: { items: fixtures } });
  }
  if (u.pathname.endsWith('/videoCategories')) {
    return r.fulfill({ json: { items: [{ id: '22', snippet: { title: 'People & Blogs' } }] } });
  }
  if (u.pathname.endsWith('/i18nLanguages')) {
    return r.fulfill({ json: { items: [{ id: 'en', snippet: { name: 'English' } }] } });
  }
  return r.fulfill({ status: 404, json: {} });
});

const statusText = () => page.evaluate(() => document.getElementById('status-message')?.textContent || '');

// Save one card via its Update button and return the captured PUT.
const saveCard = async (id) => {
  const before = puts.length;
  const btn = page.locator(`#update-btn-${id}`);
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await btn.click();
  await page.waitForFunction(i => !document.getElementById(`video-${i}`)?.classList.contains('changed'), id, { timeout: 10000 });
  return puts.length > before ? puts[puts.length - 1] : null;
};

const exportJson = async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.app.downloadVideoInfo())
  ]);
  return JSON.parse(readFileSync(await download.path(), 'utf8'));
};

const importFile = async (name, mimeType, buffer) => {
  await page.evaluate(() => { document.getElementById('status-message').textContent = ''; });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.evaluate(() => window.app.loadFromFile())
  ]);
  await chooser.setFiles({ name, mimeType, buffer });
  await page.waitForFunction(() => /Imported|Invalid|Failed|No videos/.test(document.getElementById('status-message')?.textContent || ''), null, { timeout: 15000 });
};

const importJson = (records) => importFile('videos.json', 'application/json', Buffer.from(JSON.stringify(records)));

const changedIds = () => page.evaluate(() => [...document.querySelectorAll('.video-item.changed')].map(e => e.dataset.videoId).sort());

// Click "Save all" and return the PUTs it produced.
const saveAll = async () => {
  const before = puts.length;
  await page.evaluate(() => { document.getElementById('status-message').textContent = ''; });
  await page.click('#save-all-btn');
  await page.waitForFunction(() => /Batch save/.test(document.getElementById('status-message')?.textContent || ''), null, { timeout: 15000 });
  return puts.slice(before);
};

// ---- Load: the stale pre-v2 cache is discarded, videos come from YouTube ----
await page.goto(APP, { waitUntil: 'load' });
await page.locator(`#video-${VID_S}`).waitFor({ state: 'visible', timeout: 20000 });
ok('L1. pre-v2 cache discarded (fresh load)', counters.playlistItems === 1, 'playlistItems=' + counters.playlistItems);
ok('L2. fresh title rendered', await page.locator(`#title-${VID_S}`).inputValue() === 'Scheduled video');

// ---- Scheduled publish time (status.publishAt) ----
ok('S1. scheduled badge on the scheduled video only',
  await page.locator(`#video-${VID_S} .scheduled-badge`).count() === 1 && await page.locator(`#video-${VID_P} .scheduled-badge`).count() === 0);

const json1 = await exportJson();
ok('S2. JSON export carries publish_at', json1.find(v => v.id === VID_S)?.publish_at === '2030-01-01T09:00:00.000Z' && json1.find(v => v.id === VID_P)?.publish_at === null, JSON.stringify(json1.map(v => v.publish_at)));

await page.fill(`#title-${VID_S}`, 'Scheduled video EDITED');
const putS1 = await saveCard(VID_S);
ok('S3. title-only save keeps the schedule', putS1?.body.status?.publishAt === '2030-01-01T09:00:00.000Z' && putS1?.body.status?.privacyStatus === 'private', JSON.stringify(putS1?.body.status));

await page.selectOption(`#privacy-${VID_S}`, 'unlisted');
const putS2 = await saveCard(VID_S);
ok('S4. leaving private drops publishAt', putS2 && !('publishAt' in (putS2.body.status || {})) && putS2.body.status.privacyStatus === 'unlisted', JSON.stringify(putS2?.body.status));

await page.selectOption(`#privacy-${VID_S}`, 'private');
const putS3 = await saveCard(VID_S);
ok('S5. back to private does not resurrect the old schedule', putS3 && !('publishAt' in (putS3.body.status || {})), JSON.stringify(putS3?.body.status));

// ---- Embedding / public stats / made for kids ----
ok('F1. status selects reflect YouTube values',
  await page.locator(`#embeddable-${VID_P}`).inputValue() === 'true' &&
  await page.locator(`#public-stats-${VID_P}`).inputValue() === 'true' &&
  await page.locator(`#made-for-kids-${VID_P}`).inputValue() === 'false');

await page.selectOption(`#embeddable-${VID_P}`, 'false');
const putF2 = await saveCard(VID_P);
ok('F2. embedding change is saved', putF2?.body.status?.embeddable === false && putF2.body.status.publicStatsViewable === true, JSON.stringify(putF2?.body.status));
ok('F2b. made-for-kids untouched -> selfDeclaredMadeForKids not sent', putF2 && !('selfDeclaredMadeForKids' in putF2.body.status), JSON.stringify(putF2?.body.status));

await page.selectOption(`#made-for-kids-${VID_P}`, 'true');
const putF3 = await saveCard(VID_P);
ok('F3. made-for-kids change writes selfDeclaredMadeForKids', putF3?.body.status?.selfDeclaredMadeForKids === true && putF3.body.status.embeddable === false, JSON.stringify(putF3?.body.status));

// JSON round trip with a YouTube baseline: only the edited video is marked.
const json2 = await exportJson();
ok('F4. export reflects saved values', json2.find(v => v.id === VID_P)?.embeddable === false && json2.find(v => v.id === VID_P)?.made_for_kids === true);
json2.find(v => v.id === VID_P).public_stats_viewable = false;
json2.find(v => v.id === VID_P).made_for_kids = false;
await importJson(json2);
ok('F5. JSON-only status edit marks the video changed', JSON.stringify(await changedIds()) === JSON.stringify([VID_P]), JSON.stringify(await changedIds()));
ok('F5b. imported values shown in the card', await page.locator(`#public-stats-${VID_P}`).inputValue() === 'false' && await page.locator(`#made-for-kids-${VID_P}`).inputValue() === 'false');
const putsF6 = await saveAll();
const putF6 = putsF6[0];
ok('F6. save all sends one PUT', putsF6.length === 1, JSON.stringify(putsF6.map(p => p.body.id)));
ok('F6b. JSON status edits are written', putF6?.body.id === VID_P && putF6.body.status.publicStatsViewable === false && putF6.body.status.selfDeclaredMadeForKids === false && putF6.body.status.embeddable === false, JSON.stringify(putF6?.body.status));

ok('Z. zero page/console errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
let fail = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -- ' + r.detail}`); if (!r.pass) fail++; }
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
