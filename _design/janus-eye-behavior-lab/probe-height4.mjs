// 探针4：二分触发源 —— 悬停 vs 传话 vs 点击
import { chromium } from 'playwright';
const url = 'file:///' + String.raw`C:\Users\Tree\Desktop\git\JanusX\_design\janus-eye-behavior-lab\Janus Eye Behavior Lab.html`.replace(/\\/g, '/');

async function scenario(name, prep) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
  await p.goto(url);
  await p.waitForTimeout(300);
  await prep(p);
  const box = await p.locator('#island').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx, cy + 45, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(550);
  const out = await p.evaluate(() => ({
    inlineH: document.querySelector('#island').style.height,
    sheetNow: document.querySelector('#notifSheet').offsetHeight,
    rows: document.querySelectorAll('.np-item').length,
  }));
  console.log(name, JSON.stringify(out));
  await b.close();
}

await scenario('S1 只下拉(基线):           ', async p => {
  await p.evaluate(() => {
    window.__lab.enqueueNotice('a');
    window.__lab.enqueueNotice('b');
    window.__lab.enqueueNotice('c');
  });
});
await scenario('S2 悬停3s后下拉:           ', async p => {
  await p.evaluate(() => {
    window.__lab.enqueueNotice('a');
    window.__lab.enqueueNotice('b');
    window.__lab.enqueueNotice('c');
  });
  const box = await p.locator('#island').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(3000);
});
await scenario('S3 传话跑完后下拉:         ', async p => {
  await p.click('#acts button[data-a="burst"]');
  await p.waitForTimeout(8500);
});
await scenario('S4 传话中收起再跑完下拉:   ', async p => {
  await p.click('#acts button[data-a="burst"]');
  await p.waitForTimeout(1000);
  await p.locator('#island').click();
  await p.waitForTimeout(6800);
});
