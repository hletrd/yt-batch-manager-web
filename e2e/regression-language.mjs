// Regression test for the videos.update language-code bug.
//
// The "Auto"/unset language option is an empty string, which is NOT a valid
// BCP-47 code. Sending snippet.defaultLanguage:"" or defaultAudioLanguage:""
// makes videos.update reject the ENTIRE request with 400 "Request metadata is
// invalid", silently blocking every field of the save. This test asserts that
// a video with NO language set omits both language fields from the PUT.
//
// (The complementary case — a video WITH languages set still sends them — is
// covered by e2e.mjs assertion 5f, where the category/language <select>s are
// fully populated via the mocked load chain; this focused harness skips that
// load, so the selects here would read empty and cannot exercise that path.)
//
// Run: npm run build && npx http-server dist -p 8754 -c-1 & cd e2e && node regression-language.mjs
import { chromium } from 'playwright';

const APP = 'http://127.0.0.1:8754/';
const results = [];
const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail: cond ? '' : detail });

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'en-US' });
// Seed a valid token BEFORE app scripts run so YouTubeAPI is authenticated and
// updateVideo actually builds + sends the PUT (otherwise it early-returns).
await ctx.addInitScript(() => {
  localStorage.setItem('youtube_access_token', 'test-token');
  localStorage.setItem('youtube_token_expiry', String(Date.now() + 3600_000));
});
const page = await ctx.newPage();
const puts = [];
await page.route('**/*', r => r.request().url().startsWith(APP) ? r.continue() : r.abort());
await page.route(APP + 'credentials.json', r => r.fulfill({ json: { web: { client_id: 'cid', client_secret: 'sec' } } }));
await page.route('https://www.googleapis.com/**', async r => {
  const u = new URL(r.request().url());
  if (u.pathname.endsWith('/videos') && r.request().method() === 'PUT') {
    puts.push({ part: u.searchParams.get('part'), body: JSON.parse(r.request().postData() || '{}') });
    return r.fulfill({ json: {} });
  }
  return r.fulfill({ json: {} });
});

await page.goto(APP, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.app, null, { timeout: 15000 });

const saveAndCapture = async (id) => {
  const before = puts.length;
  const btn = page.locator(`#update-btn-${id}`);
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await btn.click();
  await page.waitForFunction(n => window.__none || true, before, { timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(400);
  return puts[before];
};

// ---- Case A: no language set -> empty codes must be omitted ----
const A = 'CCCCCCCCCC3';
await page.evaluate((id) => window.app.importVideoData([{
  id, title: 'No language', description: 'd', privacy_status: 'public', category_id: '22',
  published_at: '2024-01-01T00:00:00Z', tags: ['x'], license: 'youtube', embeddable: true, public_stats_viewable: true
}]), A);
await page.locator(`#video-${A}`).waitFor({ state: 'visible', timeout: 15000 });
await page.fill(`#title-${A}`, 'No language EDITED');
const putA = await saveAndCapture(A);
const snipA = putA?.body?.snippet || {};
ok('A1. PUT was sent', !!putA, 'no PUT captured');
ok('A2. title present', snipA.title === 'No language EDITED');
ok('A3. defaultLanguage omitted (not "")', !('defaultLanguage' in snipA), JSON.stringify(snipA));
ok('A4. defaultAudioLanguage omitted (not "")', !('defaultAudioLanguage' in snipA), JSON.stringify(snipA));

await browser.close();
let fail = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -- ' + r.detail}`); if (!r.pass) fail++; }
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
