// 探针：展开后逐层量高度，找出 269 的来源
import { chromium } from 'playwright';
const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
await p.goto(url);
await p.waitForTimeout(300);
await p.evaluate(() => {
  window.__lab.enqueueNotice('coderX 完成了插件配置重构');
  window.__lab.enqueueNotice('evaluatorX 评审通过 · 0 阻塞');
  window.__lab.enqueueNotice('e2e desktop-plugins 19/19 全绿');
});
await p.waitForTimeout(200);
await p.evaluate(() => window.__lab.openPanel());
await p.waitForTimeout(600);
const probe = await p.evaluate(() => {
  const isl = document.querySelector('#island');
  const sheet = document.querySelector('#notifSheet');
  const list = document.querySelector('#npList');
  const rows = [...document.querySelectorAll('.np-item')].map(el => el.offsetHeight);
  const head = document.querySelector('.ns-head').offsetHeight;
  const empty = document.querySelector('#npEmpty').offsetHeight;
  const notice = document.querySelector('#islandNotice');
  isl.style.height = 'auto';
  const content = isl.scrollHeight;
  const kids = [...isl.children].map(el => ({
    cls: el.className,
    h: el.offsetHeight,
    top: el.offsetTop,
    display: getComputedStyle(el).display,
    pos: getComputedStyle(el).position,
  }));
  return { content, sheet: sheet.offsetHeight, list: list.offsetHeight, rows, head, empty, kids, pad: getComputedStyle(isl).padding };
});
console.log(JSON.stringify(probe, null, 2));
await b.close();
