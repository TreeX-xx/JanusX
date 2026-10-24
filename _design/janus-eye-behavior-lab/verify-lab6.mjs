// 单击=通知中心开合（下拉开面退役）+ 自主动作切换 · 验证（2026-10-24）
import { chromium } from 'playwright';

const url = new URL('./Janus Eye Behavior Lab.html', import.meta.url).href;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(url);
await p.waitForTimeout(400);
// 手势场景先关自主动作，避免随机动作干扰；最后一节再开。
await p.evaluate(() => { window.__lab.FLAGS.autoAct = false; });

const snap = () => p.evaluate(() => {
  const isl = document.querySelector('#island');
  return {
    panel: window.__lab.S.panelOpen,
    open: isl.classList.contains('notif-open'),
    h: Math.round(isl.getBoundingClientRect().height),
    items: document.querySelectorAll('.np-item').length,
    hist: window.__lab.S.history.length,
    speaking: window.__lab.S.speaking,
    queue: window.__lab.S.speakQueue.length,
    lastAct: window.__lab.S.lastAutoAct,
    label: window.__lab.S.stateLabel,
  };
});

const box = await p.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

// A) 单击 → 通知中心展开（空态；空态身高比有内容时矮，>40 即算长出）
await p.mouse.click(cx, cy);
await p.waitForTimeout(550);
console.log('A 单击展开 (期待 panel=true, open=true, h>40, items=0):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-20-click-open.png' });

// B) 再单击 → 看过即焚收起
await p.mouse.click(cx, cy);
await p.waitForTimeout(900);
console.log('B 单击收起 (期待 panel=false, h=26):', JSON.stringify(await snap()));

// C) 下拉 ≥14px → 不开面（手势退役）
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx, cy + 45, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(500);
console.log('C 下拉不开面 (期待 panel=false):', JSON.stringify(await snap()));

// D) 传话中单击 = 收起续播，不开面
await p.evaluate(() => {
  window.__lab.enqueueNotice('验证 · 第一条');
  window.__lab.enqueueNotice('验证 · 第二条');
});
await p.waitForTimeout(700);
await p.mouse.click(cx, cy);
await p.waitForTimeout(250);
console.log('D 传话中单击 (期待 panel=false, queue≥1 续播):', JSON.stringify(await snap()));
await p.waitForTimeout(5200); // 让队列播完
console.log('D2 播完 (期待 speaking=false, hist=2):', JSON.stringify(await snap()));

// E) 自主动作：时不时切换做动作（鼠标先离开胶囊——摸头中按设计让位）
await p.mouse.move(cx, 500);
await p.waitForTimeout(600);
await p.evaluate(() => {
  window.__lab.FLAGS.autoAct = true;
  window.__lab.S.lastAutoAct = null;
  window.__lab.S.nextAutoActAt = 0;
});
await p.waitForTimeout(400);
const a1 = await p.evaluate(() => window.__lab.S.lastAutoAct);
// 若第一条是 notice（会播传话），等播完再触发第二次
for (let i = 0; i < 30; i++) {
  const busy = await p.evaluate(() => window.__lab.S.speaking || window.__lab.S.noticing);
  if (!busy) break;
  await p.waitForTimeout(300);
}
await p.evaluate(() => { window.__lab.S.nextAutoActAt = 0; });
await p.waitForTimeout(400);
const a2 = await p.evaluate(() => window.__lab.S.lastAutoAct);
console.log('E 自主动作切换 (期待两次不同):', a1, '→', a2);
await p.screenshot({ path: 'shot-21-auto-act.png' });

// F) 忙时让位：面板开着不抢戏（鼠标移开，排除摸头干扰）
await p.mouse.click(cx, cy);
await p.waitForTimeout(550);
await p.mouse.move(cx, 500);
await p.evaluate(() => { window.__lab.S.lastAutoAct = null; window.__lab.S.nextAutoActAt = 0; });
await p.waitForTimeout(500);
const a3 = await p.evaluate(() => window.__lab.S.lastAutoAct);
console.log('F 面板开着不抢戏 (期待 null):', a3);
await p.keyboard.press('Escape');

console.log('errors:', errs.length, errs.join('|'));
console.log('RESULT:', errs.length === 0 && a1 && a2 && a1 !== a2 && a3 === null ? 'PASS' : 'FAIL');
await b.close();
