// 队列续播 bug 回归 + island 展开式通知中心 + 左上角灰字 · 验证
import { chromium } from 'playwright';

const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(url);
await p.waitForTimeout(400);

const snap = () => p.evaluate(() => {
  const isl = document.querySelector('#island');
  return {
    s: window.__lab.S.stateLabel,
    speaking: window.__lab.S.speaking,
    queue: window.__lab.S.speakQueue.length,
    hist: window.__lab.S.history.length,
    countText: document.querySelector('#notifCount').textContent,
    countShow: document.querySelector('#notifCount').classList.contains('show'),
    panel: window.__lab.S.panelOpen,
    open: isl.classList.contains('notif-open'),
    h: Math.round(isl.getBoundingClientRect().height),
    w: Math.round(isl.getBoundingClientRect().width),
    items: document.querySelectorAll('.np-item').length,
    noticing: window.__lab.S.noticing,
  };
});

// A) 连发 ×3，第 1 条传话中点胶囊收起 → 队列必须续播（bug 回归）
await p.click('#acts button[data-a="burst"]');
await p.waitForTimeout(1000);
await p.locator('#island').click();
await p.waitForTimeout(300);
console.log('A1 收起第1条 (queue 应剩 2):', JSON.stringify(await snap()));
await p.waitForTimeout(5500);
console.log('A2 6.5s 后 (期待 speaking=false, queue=0, hist=3):', JSON.stringify(await snap()));

// B) 下拉 → island 整体变大
const box = await p.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx, cy + 45, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(550);
console.log('B 下拉展开 (期待 open=true, h>100, items=3):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-13-sheet.png' });

// C) 点舞台空白 → 看过即焚 → 收拢
await p.mouse.click(220, 520);
await p.waitForTimeout(900);
console.log('C 看过即焚 (期待 hist=0, h=26, count 隐藏):', JSON.stringify(await snap()));

// D) 左上角灰字入口
await p.evaluate(() => window.__lab.enqueueNotice('测试 · 灰字入口'));
await p.waitForTimeout(300);
const cnt = await p.evaluate(() => {
  const el = document.querySelector('#notifCount');
  const r = el.getBoundingClientRect();
  return { text: el.textContent, x: Math.round(r.x), y: Math.round(r.y), show: el.classList.contains('show') };
});
console.log('D1 灰字 (期待 通知 1, 左上角):', JSON.stringify(cnt));
await p.click('#notifCount');
await p.waitForTimeout(500);
console.log('D2 点灰字展开 (open=true, items=1):', JSON.stringify(await snap()));
await p.keyboard.press('Escape');
await p.waitForTimeout(800);
console.log('D3 Esc 焚尽 (hist=0):', JSON.stringify(await snap()));

console.log('errors:', errs.length, errs.join('|'));
await b.close();
