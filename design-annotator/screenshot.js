/**
 * フルページスクリーンショット
 * 使い方: node screenshot.js <URL> [待機秒数]
 * 例:     node screenshot.js https://xd.adobe.com/view/xxx 5
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const url     = process.argv[2];
const waitSec = parseInt(process.argv[3]) || 3; // デフォルト3秒待機

if (!url) {
  console.log('使い方: node screenshot.js <URL> [待機秒数]');
  console.log('例:     node screenshot.js https://example.com 5');
  process.exit(1);
}

// 保存ファイル名：日時ベース
function makeFileName(url) {
  const now = new Date();
  const ts  = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `screenshot_${ts}.png`;
}
function pad(n) { return String(n).padStart(2, '0'); }

(async () => {
  const outFile = path.join(__dirname, makeFileName(url));

  console.log(`URL     : ${url}`);
  console.log(`待機    : ${waitSec}秒`);
  console.log(`保存先  : ${outFile}`);
  console.log('---');
  console.log('ブラウザ起動中...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // PC表示（1440px）で撮る
  await page.setViewport({ width: 1440, height: 900 });

  console.log('ページ読み込み中...');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // SPAやアニメーションが終わるまで待機
  console.log(`${waitSec}秒待機中...`);
  await new Promise(r => setTimeout(r, waitSec * 1000));

  console.log('スクリーンショット撮影中...');
  await page.screenshot({
    path: outFile,
    fullPage: true   // ← スクロールして全ページを撮る
  });

  await browser.close();

  const stats = fs.statSync(outFile);
  const kb    = Math.round(stats.size / 1024);
  console.log(`完了！ (${kb} KB)`);
  console.log(`→ ${outFile}`);
})().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
