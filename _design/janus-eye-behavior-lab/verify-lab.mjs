// Janus Eye Behavior Lab · 最小交互验证
// 用法: node verify-lab.mjs   （需 playwright 可用）
import { chromium } from 'playwright';

const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url);
await page.waitForTimeout(600);

// 1) 初始截图
await page.screenshot({ path: 'shot-1-idle.png' });

// 2) 鼠标移近胶囊 → 应被吸引并驻留跟随
const box = await page.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx + 120, cy + 40, { steps: 12 });
await page.waitForTimeout(500);
const s1 = await page.evaluate(() => ({
  state: window.__lab.S.stateLabel,
  gaze: { ...window.__lab.S.gaze },
  attention: window.__lab.S.attention,
}));
console.log('靠近后:', JSON.stringify(s1));

// 指针大幅移到另一侧 → gaze 应转向
await page.mouse.move(cx - 300, cy + 200, { steps: 15 });
await page.waitForTimeout(500);
const s2 = await page.evaluate(() => ({ state: window.__lab.S.stateLabel, gaze: { ...window.__lab.S.gaze } }));
console.log('移开后:', JSON.stringify(s2));
await page.screenshot({ path: 'shot-2-tracking.png' });

// 3) 点击胶囊 → 惊跳
await page.mouse.click(cx, cy);
await page.waitForTimeout(120);
const s3 = await page.evaluate(() => ({ lid: window.__lab.S.lid, sx: window.__lab.S.blink !== null }));
console.log('点击后(应有眨眼/惊跳):', JSON.stringify(s3));
await page.screenshot({ path: 'shot-3-flinch.png' });

// 4) 切旧循环对照
await page.click('#segBehavior button[data-v="legacy"]');
await page.waitForTimeout(300);
const legacy = await page.evaluate(() => document.body.dataset.behavior);
console.log('旧循环切换:', legacy);
await page.screenshot({ path: 'shot-4-legacy.png' });

// 5) 通知注视
await page.click('#segBehavior button[data-v="new"]');
await page.click('#acts button[data-a="notice"]');
await page.waitForTimeout(700);
const s5 = await page.evaluate(() => ({ state: window.__lab.S.stateLabel, attention: window.__lab.S.attention }));
console.log('通知注视:', JSON.stringify(s5));
await page.screenshot({ path: 'shot-5-notice.png' });

console.log('页面错误数:', errors.length);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
