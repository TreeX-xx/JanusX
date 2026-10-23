// 胶囊传话（通知重设计）· 验证
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
    w: Math.round(isl.getBoundingClientRect().width),
    noticing: isl.classList.contains('noticing'),
    gazeX: +window.__lab.S.gaze.x.toFixed(2),
  };
});

// 1) 触发传话 → 胶囊应展开
await p.click('#acts button[data-a="notice"]');
await p.waitForTimeout(250);
console.log('t=0.25s (期待 noticing, w>100):', JSON.stringify(await snap()));

// 2) 念通知 → 眼神扫向文字
await p.waitForTimeout(500);
console.log('t=0.75s (期待 念通知, gazeX>0.5):', JSON.stringify(await snap()));
await p.screenshot({ path: 'shot-9-speak.png' });

// 3) 收起
await p.waitForTimeout(2400);
console.log('t=3.15s (期待 收起, w=52):', JSON.stringify(await snap()));

// 4) 传话中点击 = 提前收起
await p.click('#acts button[data-a="notice"]');
await p.waitForTimeout(600);
await p.mouse.click(600, 400); // 点舞台空白处不影响；点胶囊才算——改为点胶囊
const box = await p.locator('#island').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(200);
console.log('click-dismiss (期待 noticing=false, w 回落中):', JSON.stringify(await snap()));

// 5) 摸头闭眼与传话互斥回归
await p.waitForTimeout(600);
const box2 = await p.locator('#island').boundingBox();
await p.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 6 });
await p.waitForTimeout(800);
console.log('hover-after (期待 闭眼享受):', JSON.stringify(await snap()));

console.log('errors:', errs.length, errs.join('|'));
await b.close();
