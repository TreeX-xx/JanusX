// 探针2：复刻下拉手势，在 openPanel 同帧逐层量
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

// 在 openPanel 内部同帧插桩：猴子补丁 openPanel 的测量
await p.evaluate(() => {
  const orig = window.__lab.openPanel;
  window.__probe = [];
  window.__lab.openPanel = function () {
    const isl = document.querySelector('#island');
    const sheet = document.querySelector('#notifSheet');
    orig.call(this);
    // orig 已经量完并设置了高度；这里复现它的测量帧
    window.__probe.push({
      inlineH: isl.style.height,
      sheetH: sheet.offsetHeight,
      rows: [...document.querySelectorAll('.np-item')].map(el => el.offsetHeight),
      headH: document.querySelector('.ns-head').offsetHeight,
      islandClient: isl.clientHeight,
      islandScroll: isl.scrollHeight,
    });
  };
});

// 复刻下拉
const box = await p.locator('#island').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx, cy + 45, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(600);

const out = await p.evaluate(() => ({
  probe: window.__probe,
  finalH: Math.round(document.querySelector('#island').getBoundingClientRect().height),
  sheetNow: document.querySelector('#notifSheet').offsetHeight,
  rowsNow: [...document.querySelectorAll('.np-item')].map(el => el.offsetHeight),
}));
console.log(JSON.stringify(out, null, 2));
await b.close();
