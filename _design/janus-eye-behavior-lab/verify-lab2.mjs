// 摸头闭眼 / 睁眼偷看 / 惊醒 / 通知编排+牵引线 · 验证
import { chromium } from 'playwright';

const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(url);
await p.waitForTimeout(400);

const box = await p.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const snap = () => p.evaluate(() => ({
  s: window.__lab.S.stateLabel,
  lid: +window.__lab.S.lid.toFixed(2),
  thread: document.querySelector('#gazeThread').classList.contains('on'),
  notice: document.querySelector('#notice').classList.contains('show'),
}));

// 1) 摸头：停在胶囊上 → 闭眼享受
await p.mouse.move(cx, cy, { steps: 8 });
await p.waitForTimeout(900);
console.log('hover+0.9s (期待 闭眼享受, lid~0.05):', JSON.stringify(await snap()));

// 2) 时间到 → 睁眼偷看
await p.waitForTimeout(2100);
console.log('hover+3.0s (期待 睁眼偷看, lid~1):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-7-hover-peek.png' });

// 3) 回到闭眼段后点击 → 惊醒
await p.waitForTimeout(2900);
await p.mouse.click(cx, cy);
await p.waitForTimeout(350);
console.log('click-wake (期待 睁眼偷看/惊醒, lid 高):', JSON.stringify(await snap()));

// 4) 通知编排 + 牵引线
await p.mouse.move(cx + 400, cy + 300, { steps: 5 });
await p.click('#acts button[data-a="notice"]');
await p.waitForTimeout(700);
console.log('notice+0.7s (期待 事件注视, thread on):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-8-notice-thread.png' });
await p.waitForTimeout(1600);
console.log('notice+2.3s (期待 主动移开, thread off):', JSON.stringify(await snap()));

console.log('errors:', errs.length, errs.join('|'));
await b.close();
