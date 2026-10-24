// 待机动作（stretch/tilt/lookaround/hop/doze/breathe；yawn 已移除）· 验证（2026-10-24）
import { chromium } from 'playwright';

const url = new URL('./Janus Eye Behavior Lab.html', import.meta.url).href;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 960 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(url);
await p.waitForTimeout(400);
await p.evaluate(() => { window.__lab.FLAGS.autoAct = false; window.__lab.S.act = null; });

const KINDS = ['stretch', 'tilt', 'lookaround', 'hop', 'doze', 'breathe'];
const results = [];
for (const kind of KINDS) {
  await p.evaluate(() => { window.__lab.S.act = null; });
  // 走右栏「待机动作」按钮（手动主动操作通路）
  await p.click(`#idleActs button[data-k="${kind}"]`);
  const dur = await p.evaluate(k => window.__lab.IDLE_ACTS[k].dur, kind);
  await p.waitForTimeout(Math.round(dur * 0.35)); // 动作中段
  const mid = await p.evaluate(() => {
    const isl = document.querySelector('#island');
    return {
      act: window.__lab.S.act ? window.__lab.S.act.kind : null,
      rot: isl.style.getPropertyValue('--rot'),
      sx: isl.style.getPropertyValue('--sx'),
      sy: isl.style.getPropertyValue('--sy'),
      fy: isl.style.getPropertyValue('--face-y'),
      lid: isl.style.getPropertyValue('--lid'),
    };
  });
  await p.screenshot({ path: `shot-30-act-${kind}.png` });
  // 等动作播完（act 归 null）
  let done = false;
  for (let i = 0; i < 40; i++) {
    const active = await p.evaluate(() => !!window.__lab.S.act);
    if (!active) { done = true; break; }
    await p.waitForTimeout(150);
  }
  results.push({ kind, midAct: mid.act, done, rot: mid.rot, sy: mid.sy });
  console.log(`act ${kind}: midAct=${mid.act} done=${done} midVars=${JSON.stringify(mid)}`);
}

// 事件反应按钮手动通路：点头 → nodT0 生效；手动打断进行中的待机动作
await p.evaluate(() => window.__lab.doAct('lookaround'));
await p.click('#acts button[data-a="nod"]');
const reactOk = await p.evaluate(() => window.__lab.S.act === null && performance.now() - window.__lab.S.nodT0 < 500);
console.log('事件反应手动 (期待 act 打断 + nodT0 新鲜):', reactOk);

// 呼吸基线：静止时 sx/sy 应有极轻起伏（不为定值）
await p.waitForTimeout(200);
const b1 = await p.evaluate(() => document.querySelector('#island').style.getPropertyValue('--sy'));
await p.waitForTimeout(900);
const b2 = await p.evaluate(() => document.querySelector('#island').style.getPropertyValue('--sy'));
console.log('呼吸基线 (两次采样应不同):', b1, b2);

// hover/click 让位：点按钮播 doze 中摸头 → act 中止
await p.click('#idleActs button[data-k="doze"]');
const box = await p.locator('#island').boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(400);
const preempted = await p.evaluate(() => window.__lab.S.act === null);
console.log('摸头让位 (期待 act=null):', preempted);

const okActs = results.every(r => r.midAct === r.kind && r.done);
const okPreempt = preempted === true;
const okBreath = b1 !== b2;
const tiltMid = results.find(r => r.kind === 'tilt');
const okTilt = tiltMid && Math.abs(parseFloat(tiltMid.rot)) >= 5; // 中段应有明显倾角（±10）
console.log('歪头中段倾角 (|rot|≥5):', tiltMid && tiltMid.rot);
console.log('errors:', errs.length, errs.join('|'));
console.log('RESULT:', errs.length === 0 && okActs && okPreempt && okBreath && okTilt && reactOk ? 'PASS' : 'FAIL');
await b.close();
