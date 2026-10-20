// Shorts covers use Studio, never a successful-but-ineffective thumbnails.set.
// Run against the built app on port 8756. No real credentials or requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const APP = 'http://127.0.0.1:8756/';
const SHORT = 'TTTTTTTTTT4', LONG = 'LLLLLLLLLL5';
const fixture = (id, short) => ({
  id, title: short ? 'Portrait Short' : 'Landscape video', description:'Original description',
  privacy_status:'public', category_id:'10', defaultAudioLanguage:'ko', default_language:'ko',
  published_at:'2026-10-20T00:00:00Z', tags:['Artist'], license:'youtube',
  embeddable:true, public_stats_viewable:true, made_for_kids:false,
  duration:short?'PT20S':'PT40S', width_pixels:short?1080:1920,height_pixels:short?1920:1080,
  upload_status:'processed',thumbnail_url:`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  thumbnails:{maxres:{url:`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,width:1280,height:720}}
});
const videos=[fixture(SHORT,true),fixture(LONG,false)];
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const browser=await chromium.launch();
const context=await browser.newContext({locale:'en-US',acceptDownloads:true});
await context.addInitScript(videos=>{
  localStorage.setItem('youtube_access_token','test-token');
  localStorage.setItem('youtube_token_expiry',String(Date.now()+3600000));
  localStorage.setItem('yt_video_cache',JSON.stringify({version:2,timestamp:Date.now(),videos}));
},videos);
const page=await context.newPage();
const errors=[],uploads=[],puts=[];
let portraitMode='custom';
let currentPortrait=PNG;
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',r=>r.request().url().startsWith(APP)?r.continue():r.abort());
await page.route(APP+'credentials.json',r=>r.fulfill({json:{web:{client_id:'test',client_secret:'test'}}}));
await page.route('https://i.ytimg.com/**',r=>{
  const path=new URL(r.request().url()).pathname;
  const failed=path.includes('/sardefault.jpg') && portraitMode!=='custom' || path.includes('/oar2.jpg') && portraitMode==='api';
  return r.fulfill({status:failed?404:200,contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:failed?PNG:currentPortrait});
});
await page.route('https://www.googleapis.com/**',r=>{
  if(r.request().url().includes('/thumbnails/set')) uploads.push(r.request().url());
  if(r.request().method()==='PUT') puts.push(JSON.parse(r.request().postData()));
  return r.fulfill({json:{items:[]}});
});
await page.goto(APP);
await page.locator(`#video-${SHORT}`).waitFor();
// Build and import a real ZIP with a portrait PNG using the production modules.
const cover=await page.evaluate(async ([id,rows])=>{
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
  const c=canvas.getContext('2d');c.fillStyle='#555';c.fillRect(0,0,1080,1920);
  c.fillStyle='white';c.font='100px sans-serif';c.fillText('Artist / Song',60,1720);
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const {createZip}=await import('./utils/zip.js');
  const {readBackupZip}=await import('./backup-zip.js');
  const zip=await createZip([{name:'videos.json',data:new TextEncoder().encode(JSON.stringify(rows.map(row=>({...row,thumbnail:row.id===id?`thumbnails/${id}.png`:null,thumbnail_sha256:null}))))},{name:`thumbnails/${id}.png`,data:bytes}]);
  const result=await readBackupZip(new Uint8Array(await zip.arrayBuffer()));
  await window.app.importVideoData(result.records,{thumbnails:result.thumbnails});
  return Array.from(bytes);
},[SHORT,videos]);
assert.match(await page.locator(`#thumbnail-${SHORT}`).innerText(),/apply in Studio/);
assert.ok(await page.locator(`#thumbnail-${SHORT}`).evaluate(async block=>{
  const img=block.querySelector('img');await img.decode();
  return block.querySelector('.thumbnail-pending-badge').getBoundingClientRect().top >= img.getBoundingClientRect().bottom;
}),'status must not cover the actual artwork');
assert.match(await page.locator('#status-message').innerText(),/Save All does not apply/);
assert.equal(await page.locator('.video-item.changed').count(),0,'a Studio cover must not create an API save');
assert.equal(await page.locator(`#thumbnail-${SHORT} a`).getAttribute('href'),`https://studio.youtube.com/video/${SHORT}/edit`);
await page.locator(`#thumbnail-${SHORT} summary`).click();
assert.ok(await page.locator(`#thumbnail-${SHORT} details img`).evaluate(img=>!img.src.startsWith('blob:')),'current image must remain distinct from the prepared cover');
const [download]=await Promise.all([page.waitForEvent('download'),page.locator(`#thumbnail-${SHORT}`).getByRole('button',{name:'Download cover',exact:true}).click()]);
assert.ok(readFileSync(await download.path()).equals(Buffer.from(cover)),'download preserves every cover byte');
await page.fill(`#title-${SHORT}`,'Edited Short title');
await page.locator(`#update-btn-${SHORT}`).click();
await page.waitForFunction(()=>!document.querySelector('.video-item.changed'));
assert.equal(puts.length,1);assert.equal(puts[0].snippet.title,'Edited Short title');
assert.equal(uploads.length,0,'metadata save must not attempt a Shorts cover API call');
assert.match(await page.locator(`#thumbnail-${SHORT}`).innerText(),/apply in Studio/,'metadata save must not mark the cover applied');
await page.setInputFiles(`#thumb-input-${SHORT}`,{name:'selected.png',mimeType:'image/png',buffer:Buffer.from(cover)});
assert.equal(uploads.length,0,'per-card file selection must also avoid the Shorts API');
await page.setInputFiles(`#thumb-input-${LONG}`,{name:'selected.png',mimeType:'image/png',buffer:Buffer.from(cover)});
await page.waitForFunction(()=>document.querySelector('#status-message').textContent==='Thumbnail updated');
assert.equal(uploads.length,1,'a 40s landscape video must retain its normal API upload');
// The old landscape-only fingerprint lost both of these edits completely.
const comparisons=await page.evaluate(async()=>{
  const {looksLikeSameThumbnail}=await import('./image-compare.js');
  const make=async(edit)=>{
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
    const c=canvas.getContext('2d');c.fillStyle='#555';c.fillRect(0,0,1080,1920);
    if(edit){c.fillStyle='white';c.fillRect(60,edit==='top'?80:1720,400,80);}
    return new Promise(r=>canvas.toBlob(r,'image/png'));
  };
  const original=await make();
  const top=await make('top'),bottom=await make('bottom');
  const canvas=document.createElement('canvas');canvas.width=540;canvas.height=960;
  const bitmap=await createImageBitmap(original);canvas.getContext('2d').drawImage(bitmap,0,0,540,960);bitmap.close();
  const jpeg=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.9));
  canvas.width=1280;canvas.height=720;
  const landscape=await new Promise(r=>canvas.toBlob(r,'image/png'));
  return {top:await looksLikeSameThumbnail(original,top),bottom:await looksLikeSameThumbnail(original,bottom),
    resized:await looksLikeSameThumbnail(original,jpeg),mixed:await looksLikeSameThumbnail(original,landscape)};
});
assert.deepEqual(comparisons,{top:false,bottom:false,resized:true,mixed:false});
// An actual public portrait cover is used for display, comparison and ZIP
// export. Missing CDN conventions fall back without changing the upload path.
currentPortrait=Buffer.from(cover);
for (const [mode,suffix] of [['custom','sardefault.jpg'],['auto','oar2.jpg'],['api','maxresdefault.jpg']]) {
  portraitMode=mode;
  await page.reload();
  await page.locator(`#video-${SHORT}`).waitFor();
  await page.evaluate(rows=>window.app.importVideoData(rows),videos);
  await page.locator(`#thumbnail-${SHORT} .thumbnail-image img`).scrollIntoViewIfNeeded();
  await page.waitForFunction(([id,suffix])=>{
    const img=document.querySelector(`#thumbnail-${id} .thumbnail-image img`);
    return img?.complete && img.naturalWidth>0 && new URL(img.currentSrc).pathname.endsWith(suffix);
  },[SHORT,suffix],{timeout:10000});
}
portraitMode='custom';
const nativeProof=await page.evaluate(async ([video,original])=>{
  const {fetchComparableThumbnail,buildBackupZip}=await import('./backup-zip.js');
  const {looksLikeSameThumbnail}=await import('./image-compare.js');
  const {readZip}=await import('./utils/zip.js');
  const reference=await fetchComparableThumbnail(video);
  const native=new Blob([new Uint8Array(original)],{type:'image/png'});
  const {blob}=await buildBackupZip([video],{records:[{id:video.id}],readme:'test',localThumbnail:()=>undefined});
  const entries=readZip(new Uint8Array(await blob.arrayBuffer()));
  const exported=await entries.find(e=>e.name.endsWith('.png')).read();
  return {same:await looksLikeSameThumbnail(native,reference),bytes:Array.from(exported)};
},[videos[0],cover]);
assert.equal(nativeProof.same,true,'a Studio-applied portrait must compare equal, not remain falsely pending');
assert.ok(Buffer.from(nativeProof.bytes).equals(Buffer.from(cover)),'ZIP export must use the full native portrait image');
assert.deepEqual(errors,[]);
await browser.close();
console.log('PASS Shorts ZIP/file selection, metadata-only saving, exact download, Studio route, landscape API, full portrait edge comparison');
