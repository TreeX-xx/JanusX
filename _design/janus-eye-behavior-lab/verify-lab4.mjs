// 多通知队列 / 角标 / 下拉通知中心 / 看过即焚 · 验证
import { chromium } from 'playwright';

const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(url);
await p.waitForTimeout(400);

const snap = () => p.evaluate(() => ({
  s: window.__lab.S.stateLabel,
  speaking: window.__lab.S.speaking,
  queue: window.__lab.S.speakQueue.length,
  hist: window.__lab.S.history.length,
  badge: document.querySelector('#unreadBadge').classList.contains('show'),
  badgeN: document.querySelector('#unreadBadge').textContent,
  panel: document.querySelector('#notifPanel').classList.contains('open'),
  items: document.querySelectorAll('.np-item').length,
  noticing: window.__lab.S.noticing,
}));

// 1) 连发 ×3：应串行传话，全部进历史
await p.click('#acts button[data-a="burst"]');
await p.waitForTimeout(900);
console.log('t=0.9s (第1条传话中, hist=3, badge=3):', JSON.stringify(await snap()));
await p.waitForTimeout(2500);
console.log('t=3.4s (串行到第2/3条):', JSON.stringify(await snap()));
await p.waitForTimeout(4800);
console.log('t=8.2s (全部说完, speaking=false):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-10-burst.png' });

// 2) 下拉胶囊 → 通知中心
const box = await p.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx, cy + 45, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(500);
console.log('pull-down (期待 panel=true, items=3, 看通知):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-11-notif-panel.png' });

// 3) 点舞台空白 → 看过即焚
await p.mouse.click(200, 500);
await p.waitForTimeout(800);
console.log('after-close (期待 hist=0, badge=false, panel=false):', JSON.stringify(await snap()));

// 4) 空历史再拉：显示空态
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx, cy + 45, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(400);
console.log('empty-panel (items=0, 空态可见):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-12-empty-panel.png' });

console.log('errors:', errs.length, errs.join('|'));
await b.close();
