// Focused E2E suite for batch editing via JSON/ZIP backups and the status
// fields that videos.update must round-trip, against a fully mocked
// Google/YouTube backend (no real credentials or quota).
//
// Run: npm run build && npx http-server dist -p 8755 -c-1 & cd e2e && node batch-fields.mjs
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  statistics: { viewCount: '10', likeCount: '1', commentCount: '0' },
  ...(opts.recordingDate ? { recordingDetails: { recordingDate: opts.recordingDate } } : {})
});

const fixtures = [
  videoItem(VID_S, { title: 'Scheduled video', privacy: 'private', publishAt: SCHEDULE, recordingDate: '2023-05-10T00:00:00.000Z' }),
  videoItem(VID_P, { title: 'Public video', privacy: 'public', tags: ['keep', 'these'] })
];

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// A real 16x9 JPEG, used as the "new" thumbnail a user drops into the ZIP.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAACQAAAAD/wAARCAAJABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAJCQkJCQkQCQkQFhAQEBYeFhYWFh4mHh4eHh4mLiYmJiYmJi4uLi4uLi4uNzc3Nzc3QEBAQEBISEhISEhISEhI/9sAQwELDAwSERIfEREfSzMqM0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tL/90ABAAB/9oADAMBAAIRAxEAPwDoqKKK4D68/9k=', 'base64');
const counters = { playlistItems: 0 };
const puts = [];
const thumbnailUploads = [];
const work = mkdtempSync(join(tmpdir(), 'ytbm-e2e-'));

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
// The batch-failure test deliberately arms a 400; its resource error and the
// app's batch error log are expected, not regressions.
const EXPECTED = [/status of 400/, /Batch save errors/];
page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error' || EXPECTED.some(re => re.test(m.text()))) return;
  pageErrors.push('console: ' + m.text());
});
let failPutFor = null;

await page.route('**/*', r => r.request().url().startsWith(APP) ? r.continue() : r.abort());
// Thumbnail CDN: serve a 1x1 PNG with the CORS header i.ytimg.com really sends
// (the ZIP export fetch()es these cross-origin).
await page.route('https://i.ytimg.com/**', r => r.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG }));
await page.route(APP + 'credentials.json', r => r.fulfill({ json: { web: { client_id: 'cid', client_secret: 'sec' } } }));
await page.route('https://www.googleapis.com/**', async r => {
  const u = new URL(r.request().url());
  const part = u.searchParams.get('part') || '';
  if (u.pathname.endsWith('/videos') && r.request().method() === 'PUT') {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.id === failPutFor) {
      failPutFor = null;
      return r.fulfill({ status: 400, json: { error: { errors: [{ reason: 'invalidMetadata' }], message: 'Request metadata is invalid.' } } });
    }
    puts.push({ part, body });
    return r.fulfill({ json: {} });
  }
  if (u.pathname.endsWith('/thumbnails/set')) {
    thumbnailUploads.push({ videoId: u.searchParams.get('videoId'), contentType: r.request().headers()['content-type'], body: r.request().postDataBuffer() });
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

const exportZip = async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.app.downloadVideoZip())
  ]);
  const path = join(work, `export-${Date.now()}.zip`);
  await download.saveAs(path);
  return path;
};

const unzipTo = (zipPath) => {
  const dir = mkdtempSync(join(work, 'x-'));
  execFileSync('unzip', ['-q', zipPath, '-d', dir]);
  return dir;
};

// Re-zip a folder with Info-ZIP (DEFLATE), wrapped in a top-level folder the
// way people re-zip an extracted backup.
const zipFolder = (dir) => {
  const out = join(work, `import-${Date.now()}.zip`);
  execFileSync('zip', ['-qr', out, '.'], { cwd: dir });
  const wrapped = join(work, `wrapped-${Date.now()}`);
  execFileSync('mkdir', ['-p', wrapped]);
  execFileSync('unzip', ['-q', out, '-d', join(wrapped, 'my backup')]);
  execFileSync('zip', ['-qr', out + '.wrapped.zip', 'my backup'], { cwd: wrapped });
  return readFileSync(out + '.wrapped.zip');
};

const importZip = (buffer) => importFile('backup.zip', 'application/zip', buffer);

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
ok('S3b. ...and does not touch recordingDetails', putS1 && !putS1.part.includes('recordingDetails'), putS1?.part);

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

// ---- Partial / hand-edited JSON keeps the live values ----
await importJson([
  { id: VID_P, title: 'Only the title changed' },
  {
    id: VID_S, tags: 'alpha, beta ,', latitude: '37.5', longitude: 127, recording_date: 'not a date',
    license: 'bogus', category_id: 44, upload_status: '<img id="pwned" src=x>', statistics: { view_count: '<b id="pwned2">' }
  }
]);
ok('P1. both edited videos marked', JSON.stringify(await changedIds()) === JSON.stringify([VID_P, VID_S].sort()), JSON.stringify(await changedIds()));
ok('P2. omitted fields keep the live values', await page.locator(`#description-${VID_P}`).inputValue() === 'desc ' + VID_P &&
  await page.locator(`#privacy-${VID_P}`).inputValue() === 'public' && await page.locator(`#tags-container-${VID_P} .tag-chip`).count() === 2);
ok('P3. comma-separated tags + numeric-string coordinates accepted',
  await page.locator(`#tags-container-${VID_S} .tag-chip`).count() === 2 && await page.locator(`#latitude-${VID_S}`).inputValue() === '37.5');
ok('P4. unlisted category id stays selected', await page.locator(`#category-${VID_S}`).inputValue() === '44');
ok('P5. invalid license/date fall back to live values', await page.locator(`#license-${VID_S}`).inputValue() === 'youtube' && await page.locator(`#recording-date-${VID_S}`).inputValue() === '2023-05-10');
ok('P6. read-only fields never come from the file', await page.locator('#pwned, #pwned2').count() === 0);
const putsP = await saveAll();
const putP = putsP.find(x => x.body.id === VID_P);
const putS = putsP.find(x => x.body.id === VID_S);
ok('P7. partial save keeps description/tags/privacy/status', putP?.body.snippet?.title === 'Only the title changed' && putP.body.snippet.description === 'desc ' + VID_P &&
  JSON.stringify(putP.body.snippet.tags) === '["keep","these"]' && putP.body.status.privacyStatus === 'public' && putP.body.status.embeddable === false, JSON.stringify(putP?.body));
ok('P8. hand-edited values are sent normalized', JSON.stringify(putS?.body.snippet?.tags) === '["alpha","beta"]' && putS.body.snippet.categoryId === '44' &&
  putS.body.recordingDetails?.location?.latitude === 37.5 && putS.body.recordingDetails.recordingDate === '2023-05-10T00:00:00.000Z' && putS.body.status.license === 'youtube', JSON.stringify(putS?.body));

// ---- Batch save reports a rejected video as failed ----
await page.fill(`#title-${VID_P}`, 'Batch P');
await page.fill(`#title-${VID_S}`, 'Batch S');
failPutFor = VID_S;
await saveAll();
const batchMsg = await statusText();
ok('B1. failed save counted as failed', /1 successful, 1 failed/.test(batchMsg) && batchMsg.includes('Request metadata is invalid'), batchMsg);
ok('B2. failed video stays marked changed', JSON.stringify(await changedIds()) === JSON.stringify([VID_S]), JSON.stringify(await changedIds()));

// ---- Thumbnails via ZIP ----
const zip1 = await exportZip();
let unzipOk = true;
try { execFileSync('unzip', ['-tq', zip1]); } catch { unzipOk = false; }
ok('T1. exported ZIP passes unzip -t', unzipOk);
const dir1 = unzipTo(zip1);
const exported = JSON.parse(readFileSync(join(dir1, 'videos.json'), 'utf8'));
const recS = exported.find(v => v.id === VID_S);
ok('T2. ZIP has thumbnails + hashes + README', recS?.thumbnail === `thumbnails/${VID_S}.png` &&
  recS.thumbnail_sha256 === createHash('sha256').update(PNG).digest('hex') &&
  readFileSync(join(dir1, recS.thumbnail)).equals(PNG) && readFileSync(join(dir1, 'README.txt'), 'utf8').includes('thumbnail_sha256'), JSON.stringify(recS));

await importZip(readFileSync(zip1));
ok('T3. untouched ZIP re-imports with nothing to save', (await changedIds()).length === 0 && await page.locator('.thumbnail-pending-badge').count() === 0, JSON.stringify(await changedIds()) + ' ' + await statusText());

// Replace S's thumbnail with a JPEG (keeping the .png name) and edit P's title.
writeFileSync(join(dir1, `thumbnails/${VID_S}.png`), JPEG);
exported.find(v => v.id === VID_P).title = 'Title from ZIP';
writeFileSync(join(dir1, 'videos.json'), JSON.stringify(exported, null, 2));
const editedZip = zipFolder(dir1);
await importZip(editedZip);
ok('T4. replaced thumbnail is pending, title edit marked', JSON.stringify(await changedIds()) === JSON.stringify([VID_P, VID_S].sort()) &&
  await page.locator(`#video-${VID_S} .thumbnail-pending-badge`).count() === 1 && await page.locator(`#video-${VID_P} .thumbnail-pending-badge`).count() === 0,
  JSON.stringify(await changedIds()));
ok('T4b. status mentions the pending thumbnail', /1 new thumbnail/.test(await statusText()), await statusText());
ok('T5. pending preview renders (blob: allowed by CSP)', await page.locator(`#video-${VID_S} .video-thumbnail img`).evaluate(img => img.src.startsWith('blob:') && img.naturalWidth === 16));

const uploadsBefore = thumbnailUploads.length;
const putsT = await saveAll();
const uploadsT = thumbnailUploads.slice(uploadsBefore);
ok('T6. thumbnail uploaded once, as JPEG, for S only', uploadsT.length === 1 && uploadsT[0].videoId === VID_S && uploadsT[0].contentType === 'image/jpeg' && uploadsT[0].body.equals(JPEG),
  JSON.stringify(uploadsT.map(u => [u.videoId, u.contentType, u.body.length])));
ok('T7. thumbnail-only video skips videos.update', putsT.length === 1 && putsT[0].body.id === VID_P && putsT[0].body.snippet.title === 'Title from ZIP', JSON.stringify(putsT.map(p => p.body.id)));
ok('T8. after save: nothing pending, uploaded image still shown', (await changedIds()).length === 0 && await page.locator('.thumbnail-pending-badge').count() === 0 &&
  await page.locator(`#video-${VID_S} .video-thumbnail img`).evaluate(img => img.src.startsWith('blob:')));

// Export again: the uploaded image is exported (YouTube's CDN may still serve
// the old one) with its own hash, so it is not re-uploaded on re-import.
const zip2 = await exportZip();
const dir2 = unzipTo(zip2);
const recS2 = JSON.parse(readFileSync(join(dir2, 'videos.json'), 'utf8')).find(v => v.id === VID_S);
ok('T9. re-export carries the uploaded thumbnail', recS2.thumbnail === `thumbnails/${VID_S}.jpg` && readFileSync(join(dir2, recS2.thumbnail)).equals(JPEG), JSON.stringify(recS2));
await importZip(readFileSync(zip2));
ok('T9b. ...and re-importing it uploads nothing', (await changedIds()).length === 0, JSON.stringify(await changedIds()));

// Pending thumbnail can be discarded; unusable files are skipped and reported.
await importZip(editedZip);
await page.click(`#video-${VID_S} .thumbnail-discard-btn`);
ok('T10. discarding the pending thumbnail unmarks a thumbnail-only change', !(await changedIds()).includes(VID_S) && await page.locator(`#video-${VID_S} .thumbnail-pending-badge`).count() === 0, JSON.stringify(await changedIds()));
writeFileSync(join(dir1, `thumbnails/${VID_P}.png`), 'not an image');
await importZip(zipFolder(dir1));
ok('T11. non-image thumbnail skipped and reported', /1 thumbnail file\(s\) skipped/.test(await statusText()) && await page.locator(`#video-${VID_P} .thumbnail-pending-badge`).count() === 0, await statusText());
rmSync(join(dir1, 'videos.json'));
await importZip(zipFolder(dir1));
ok('T12. ZIP without videos.json is rejected clearly', (await statusText()).includes('No videos.json'), await statusText());

ok('Z. zero page/console errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
rmSync(work, { recursive: true, force: true });
let fail = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -- ' + r.detail}`); if (!r.pass) fail++; }
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
