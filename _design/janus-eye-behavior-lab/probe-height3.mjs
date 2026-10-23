// 探针3：精确复刻 verify-lab5 的 A+B，抓 openPanel 后的现场
import { chromium } from 'playwright';
const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
await p.goto(url);
await p.waitForTimeout(400);

// A 阶段
await p.click('#acts button[data-a="burst"]');
await p.waitForTimeout(1000);
await p.locator('#island').click();
await p.waitForTimeout(300);
await p.waitForTimeout(5500);

// B 阶段：下拉
const box = await p.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx, cy + 45, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(550);

const out = await p.evaluate(() => {
  const isl = document.querySelector('#island');
  const sheet = document.querySelector('#notifSheet');
  return {
    inlineH: isl.style.height,
    rectH: Math.round(isl.getBoundingClientRect().height),
    transform: getComputedStyle(isl).transform,
    sheetH: sheet.offsetHeight,
    rows: [...document.querySelectorAll('.np-item')].map(el => el.offsetHeight),
    gone: document.querySelectorAll('.np-item.gone').length,
    transitionDelay: [...document.querySelectorAll('.np-item')].map(el => getComputedStyle(el).transitionDelay),
    itemTransforms: [...document.querySelectorAll('.np-item')].map(el => getComputedStyle(el).transform),
    islandDisplay: getComputedStyle(isl).display,
    flexDirection: getComputedStyle(isl).flexDirection,
  };
});
console.log(JSON.stringify(out, null, 2));
await b.close();
