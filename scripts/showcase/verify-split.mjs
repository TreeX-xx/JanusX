// Verify compact README assets against their successful local recordings.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from './showcase-lib.mjs';
import { parseNote, validateNote } from '@janus-agent/harness-core';

const req = createRequire(join(process.env.SHOWCASE_GIFTOOLS ?? join(tmpdir(), 'opencode', 'giftools'), 'package.json'));
const { parseGIF, decompressFrame } = req('gifuct-js');
const feature = process.argv[2] ?? 'split';
assert.ok(['split', 'workspace', 'island', 'launch', 'blueprint', 'review', 'usage', 'session', 'worktree', 'product'].includes(feature), 'Unknown README feature');
const { dir } = JSON.parse(await readFile(`.cache/showcase/${feature}-latest.json`, 'utf8'));
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
assert.equal(manifest.presentation.framing, 'compact');
assert.equal(manifest.presentation.theme, ['session', 'product'].includes(feature) ? 'dark' : 'planche');
assert.equal(manifest.evidence.promptsSubmitted, feature === 'island' ? 2 : ['launch', 'blueprint'].includes(feature) ? 1 : 0);
if (feature === 'split') {
  assert.deepEqual(manifest.evidence.checkpoints.map(c => c.panes), [2, 3, 4, 4, 3]);
  assert.deepEqual(manifest.evidence.terminalPresets, ['claude', 'codex', 'opencode', 'pi']);
  assert.equal(manifest.frames.filter(f => f.pressed).length, 118);
  assert.ok(manifest.frames.every(f => !f.click), 'Drag release must not become a click');
} else if (feature === 'workspace') {
  const points = manifest.evidence.checkpoints;
  assert.deepEqual(points.map(c => c.stage), ['tools', 'switch', 'return']);
  assert.ok(points.every(c => c.projectPanes === 2 && c.toolPanes.length === 2 && c.native.length === 1));
  assert.ok(points.every(c => c.captures.length === 1 && c.captures[0].pagePixelRatio > .5),
    'Each checkpoint must include the attached browser page');
  assert.ok(points.every(c => c.browser.filter === 'search'
    && c.browser.cards.join('|') === 'Search tasks|Search empty state'),
    'Only matching browser cards must remain displayed');
  const before = points[0], switched = points[1], returned = points[2];
  for (const key of ['toolPanes', 'toolTabs', 'outerRatio', 'toolRatio', 'scope', 'title', 'document', 'browser', 'native']) {
    assert.deepEqual(switched[key], before[key], `${key} changed on project switch`);
    assert.deepEqual(returned[key], before[key], `${key} changed on return`);
  }
  assert.notDeepEqual(switched.projectTabs, before.projectTabs);
  assert.deepEqual(returned.projectTabs, before.projectTabs);
  assert.deepEqual(manifest.evidence.terminalPresets, ['opencode', 'pi']);
  assert.ok(manifest.frames.some(f => f.pressed));
  assert.ok(manifest.frames.every(f => !(f.pressed && f.click)), 'Dragging must not show a click ring');
} else if (feature === 'island') {
  const { checkpoints, calls, streaming, prompts, answers } = manifest.evidence;
  assert.deepEqual(checkpoints.map(c => c.stage), ['context', 'answer', 'result']);
  assert.deepEqual(checkpoints.map(c => c.users), [0, 1, 2]);
  assert.deepEqual(checkpoints.map(c => c.tools.length), [0, 2, 4]);
  assert.ok(checkpoints.every(c => c.resources.join() === 'Atlas' && c.theme === 'planche'));
  assert.deepEqual(calls.map(c => c.tool), ['workspace_read', 'workspace_read', 'reply', 'workspace_read', 'workspace_read', 'reply']);
  assert.deepEqual(calls.filter(c => c.args).map(c => c.args.path),
    ['src/main.mjs', 'src/search.mjs', 'tests/search.test.mjs', 'package.json']);
  assert.ok(calls.filter(c => c.args).every(c => c.args.workspaceId === manifest.evidence.workspaceId));
  assert.deepEqual(calls[3].verifiedHistory, [prompts[0], prompts[1], '结果保留原顺序']);
  assert.deepEqual(calls.flatMap(c => c.verifiedOutput),
    ['root.replaceChildren', 'query.trim().toLowerCase()', 'preserves task order', 'node --test']);
  for (const stage of ['answer', 'result']) {
    const samples = streaming.filter(s => s.stage === stage && s.active);
    assert.ok(samples.length > 5 && new Set(samples.map(s => s.chars)).size > 4, `${stage}: actual streaming samples required`);
  }
  assert.ok(checkpoints[1].text.includes(prompts[0]) && checkpoints[2].text.includes(prompts[1]));
  assert.ok(answers[0].includes('src/main.mjs') && answers[1].includes('npm test'));
  assert.equal(manifest.evidence.fixtureTests, 3);
  assert.equal(manifest.evidence.sourceUnchanged, true);
  assert.equal(manifest.evidence.accountsCopied, false);
  assert.equal(manifest.evidence.loopTransitionMs, 800);
  assert.ok(manifest.evidence.toolDetail.text.includes('src/search.mjs'));
} else if (feature === 'launch') {
  const { checkpoints, calls, config, testOutput, httpResult, running, processOutput, streaming } = manifest.evidence;
  assert.deepEqual(checkpoints.map(c => c.stage), ['ready', 'approval', 'saved', 'test', 'running']);
  assert.deepEqual(checkpoints.map(c => c.tools.length), [0, 5, 5, 5, 5]);
  assert.equal(checkpoints[1].draft, 1); assert.equal(checkpoints[1].applied, 0);
  assert.equal(checkpoints[2].applied, 1);
  assert.ok(checkpoints[1].text.includes('Janus 请求写入运行配置'));
  assert.ok(checkpoints[4].text.includes('1 个进程运行中'));
  assert.deepEqual(calls.map(c => c.tool), ['workspace_read', 'workspace_read', 'launch_config_get',
    'launch_config_edit', 'launch_config_apply', 'reply']);
  assert.deepEqual(calls.slice(0, 2).map(c => c.args.path), ['package.json', 'src/server.mjs']);
  assert.ok(calls.slice(0, 2).every(c => c.args.workspaceId === manifest.evidence.workspaceId));
  assert.deepEqual(config.configurations.map(c => [c.name, c.program, c.args]),
    [['dev', 'npm', ['run', 'dev']], ['test', 'npm', ['run', 'test']]]);
  assert.equal(config.configurations[0].env.PORT, String(config.configurations[0].port));
  assert.match(testOutput, /pass\s+3/);
  assert.deepEqual(httpResult, { name: 'Atlas', tasks: ['Search tasks', 'Search empty state', 'Release checklist'] });
  assert.equal(running.length, 1); assert.ok(running[0].pid > 0);
  assert.ok(processOutput.join('\n').includes(`http://127.0.0.1:${config.configurations[0].port}`));
  const samples = streaming.filter(s => s.stage === 'saved' && s.active);
  assert.ok(samples.length > 5 && new Set(samples.map(s => s.chars)).size > 4);
  for (const key of ['sourceUnchanged', 'approvedBeforeWrite', 'stoppedAfterCapture']) assert.equal(manifest.evidence[key], true);
  assert.equal(manifest.evidence.accountsCopied, false);
  assert.equal(manifest.evidence.loopTransitionMs, 800);
} else if (feature === 'blueprint') {
  const { checkpoints, calls, streaming, before, after, preservedId, created, updatedBefore, updatedAfter } = manifest.evidence;
  assert.deepEqual(checkpoints.map(c => c.stage), ['overview', 'module', 'before', 'updated', 'diff', 'result']);
  assert.deepEqual(checkpoints.map(c => c.module), ['Atlas', 'Atlas', '任务搜索', '任务搜索', '任务搜索', '任务搜索']);
  assert.ok(checkpoints.every(c => c.theme === 'planche' && c.nodes.length === 4));
  assert.ok(!checkpoints[2].document.includes('至少两个字符才筛选'));
  assert.ok(checkpoints[3].document.includes('至少两个字符才筛选'));
  assert.ok(checkpoints[3].panel.includes(manifest.evidence.prompt));
  assert.ok(checkpoints[4].writtenDiff.includes('至少两个字符才筛选'));
  assert.ok(checkpoints[4].diffScroll.top > 0 && checkpoints[4].diffScroll.contentHeight > checkpoints[4].diffScroll.height);
  assert.deepEqual(checkpoints[5].tools, ['workspace_read', 'note_read', 'note_scope', 'note_write', 'note_focus']);
  assert.deepEqual(calls.map(c => c.tool), ['workspace_read', 'note_read', 'note_scope', 'note_write', 'note_focus', 'reply']);
  assert.equal(calls[0].args.workspaceId, manifest.evidence.workspaceId);
  assert.equal(calls[0].args.path, 'src/search.mjs');
  assert.deepEqual(calls[1].verifiedOutput, ['needle.length < 2']);
  assert.deepEqual(calls[4].verifiedOutput, ['applied']);
  assert.equal(calls[3].args.operations.length, 1);
  assert.equal(calls[3].args.operations[0].type, 'update');
  assert.equal(calls[3].args.operations[0].expectedHash, createHash('sha256').update(before).digest('hex'));
  const oldNote = parseNote(before), newNote = parseNote(after);
  assert.deepEqual(validateNote(newNote), []);
  assert.equal(newNote.meta.id, preservedId); assert.equal(oldNote.meta.id, preservedId);
  assert.equal(oldNote.meta.created, created); assert.equal(newNote.meta.created, created);
  assert.equal(oldNote.meta.updated, updatedBefore); assert.equal(newNote.meta.updated, updatedAfter);
  assert.notEqual(updatedAfter, updatedBefore);
  for (const key of ['module', 'kind', 'lifecycle']) assert.deepEqual(oldNote.meta[key], newNote.meta[key]);
  assert.ok(after.includes(calls[3].args.operations[0].sections.Design));
  assert.equal(manifest.evidence.documents, 7); assert.equal(manifest.evidence.tasks, 0);
  assert.equal(manifest.evidence.fixtureTests, 3); assert.match(manifest.evidence.testOutput, /# pass 3/);
  for (const key of ['sourceUnchanged', 'otherNotesUnchanged']) assert.equal(manifest.evidence[key], true);
  const samples = streaming.filter(s => s.active);
  assert.ok(samples.length > 5 && new Set(samples.map(s => s.chars)).size > 4, 'Actual streaming samples required');
  assert.equal(manifest.evidence.accountsCopied, false);
  assert.equal(manifest.evidence.loopTransitionMs, 800);
} else if (feature === 'review') {
  const e = manifest.evidence, old = parseNote(e.before), updated = parseNote(e.after);
  assert.deepEqual(e.automatic, { enabled: true, commits: 1 });
  assert.notEqual(e.baseline, e.commit);
  assert.deepEqual(e.calls.map(c => c.tool), ['review_read', 'review_read', 'reply', 'note_repair_read', 'workspace_read', 'note_repair_write', 'reply', 'review_read', 'review_read', 'reply']);
  assert.ok(e.activityEvents.some(event => event.activities.some(a => a.trigger === 'automatic')));
  assert.deepEqual([...new Set(e.events.map(event => event.phase))].filter(phase => phase !== 'queued'), ['reading', 'editing', 'reviewing', 'resolved']);
  assert.equal(e.final.report.coverage, 'complete'); assert.deepEqual(e.final.report.findings, []);
  assert.notEqual(e.final.report.provenance.commit, e.commit, 'Repair review must read current source independently');
  assert.equal(old.meta.id, updated.meta.id); assert.equal(old.meta.created, updated.meta.created);
  assert.deepEqual(validateNote(updated), []);
  assert.equal(e.calls[5].args.expectedHash, createHash('sha256').update(e.before).digest('hex'));
  assert.ok(e.after.includes('从两个字符开始筛选'));
  assert.ok(e.checkpoints.find(p => p.stage === 'finding').text.includes('if (needle.length < 2) return tasks;'));
  assert.ok(e.checkpoints.find(p => p.stage === 'result').text.includes('已修复，审核通过'));
} else if (feature === 'usage') {
  const e = manifest.evidence;
  assert.equal(e.sampleData, true); assert.equal(e.modelCalls, 0);
  for (const preset of ['claude', 'codex']) {
    assert.equal(e.snapshots[preset].sessionId, e.nativeSessionIds[preset]);
    assert.equal(e.snapshots[preset].totalTokens, e.expected[preset].total);
    assert.equal(e.snapshots[preset].inputTokens, e.expected[preset].input);
    assert.equal(e.snapshots[preset].outputTokens, e.expected[preset].output);
  }
  assert.notEqual(e.terminalIds.claude, e.terminalIds.codex);
  assert.deepEqual(e.checkpoints.map(p => p.stage), ['drawer', 'focus', 'history', 'week', 'filter', 'trend', 'heatmap']);
  for (const key of ['435,295', '482,370', '357,420']) assert.ok(e.checkpoints[0].text.includes(key));
  assert.ok(e.checkpoints[3].text.includes('918k'));
  assert.ok(e.checkpoints[4].text.includes('435k'));
  assert.ok(e.checkpoints[6].text.includes('预估费用'));
} else if (feature === 'session') {
  const e = manifest.evidence;
  assert.equal(e.sampleTranscript, true); assert.equal(e.modelCalls, 0);
  assert.equal(e.sampleNativeTranscript, true);
  assert.equal(e.nativeRows.length, 4);
  assert.ok(e.nativeRows.every(row => row.sessionId === e.providerSessionId));
  assert.equal(e.continuationCancelled, true); assert.equal(e.sourceBefore, e.sourceAfter);
  assert.deepEqual(e.checkpoints.map(p => p.stage), ['scope', 'search', 'turns', 'detail', 'confirm', 'result']);
  assert.ok(e.checkpoints[2].text.includes(e.prompts[1]));
  assert.ok(e.checkpoints[3].text.includes(e.excerpts[1]));
  assert.ok(e.checkpoints[3].text.includes('回到原会话'));
  assert.ok(e.checkpoints[4].text.includes('恢复对话'));
  assert.ok(e.checkpoints[4].text.includes('将在新终端中加载原生会话历史'));
  assert.ok(!e.checkpoints[5].text.includes('恢复对话'));
} else if (feature === 'worktree') {
  const e = manifest.evidence;
  assert.equal(e.mainBranch, 'main'); assert.equal(e.worktreeBranch, 'feature/search');
  assert.equal(e.mainServiceRetained, true); assert.equal(e.merged, false); assert.equal(e.modelCalls, 0);
  assert.notEqual(e.mainSource, e.worktreeSource); assert.ok(e.worktreeSource.includes('searchHint'));
  assert.deepEqual(e.branchDiff.files.map(f => f.path), ['src/search.mjs']);
  assert.ok(e.branchDiff.additions > 0);
  assert.ok(e.checkpoints.every(p => p.service.branch === 'main' && p.service.status === 'running'));
} else if (feature === 'product') {
  const e = manifest.evidence;
  assert.equal(e.modelCalls, 0); assert.match(e.testBefore, /# pass 3/); assert.match(e.testAfter, /# pass 4/);
  assert.ok(e.reportBefore.includes('3 / 3')); assert.ok(e.reportAfter.includes('4 / 4'));
  assert.deepEqual(e.checkpoints.map(p => p.stage), ['opened', 'interactive', 'json', 'refreshed']);
}
const asset = `wiki/assets/readme/features/${manifest.name}`;
const bytes = await readFile(`${asset}.gif`);
const parsed = parseGIF(bytes);
const frames = parsed.frames.filter(f => f.image);
const width = 1784, height = 908, border = 12;
assert.equal(parsed.lsd.width, width);
assert.equal(parsed.lsd.height, height);
assert.equal(frames.length, manifest.frames.length);
assert.deepEqual(frames.map(f => f.gce.delay * 10), manifest.frames.map(f => f.delay));
assert.deepEqual(Array.from(parsed.frames.find(f => f.application).application.blocks), [1, 0, 0]);
assert.ok(frames.every(f => !f.image.descriptor.lct.exists && f.gce.extras.disposal === 1));
assert.equal(frames[0].gce.extras.transparentColorGiven, false);
assert.equal(frames[0].image.descriptor.width, width);
assert.equal(frames[0].image.descriptor.height, height);

function ringHash(canvas) {
  const hash = createHash('sha256');
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    if (y < border || y >= height - border) hash.update(canvas.subarray(row, row + width * 4));
    else {
      hash.update(canvas.subarray(row, row + border * 4));
      hash.update(canvas.subarray(row + (width - border) * 4, row + width * 4));
    }
  }
  return hash.digest('hex');
}

const canvas = Buffer.alloc(width * height * 4);
const samples = new Set([0, ...manifest.evidence.checkpoints.map(c => c.frame),
  ...(manifest.evidence.toolDetail ? [manifest.evidence.toolDetail.frame] : []), frames.length - 1]);
const sampleErrors = [];
let borderHash, maxCursorStep = 0;
for (let i = 0; i < frames.length; i++) {
  const frame = decompressFrame(frames[i], parsed.gct, true);
  assert.deepEqual(frame.dims, { top: 0, left: 0, width, height });
  for (let p = 0; p < frame.patch.length; p += 4) if (frame.patch[p + 3]) canvas.set(frame.patch.subarray(p, p + 4), p);
  const hash = ringHash(canvas);
  if (i) assert.equal(hash, borderHash, `Frame ${i}: border changed`);
  else borderHash = hash;
  for (let p = 3; p < canvas.length; p += 4) assert.equal(canvas[p], 255, `Frame ${i}: transparent residue`);
  const current = manifest.frames[i], previous = manifest.frames[i - 1];
  if (previous && !current.transition) {
    const step = Math.hypot(current.mouse.x - previous.mouse.x, current.mouse.y - previous.mouse.y);
    assert.ok(step < 130, `Frame ${i}: cursor jumped ${step}px`);
    maxCursorStep = Math.max(maxCursorStep, step);
  }
  if (samples.has(i)) {
    const raw = PNG.sync.read(await readFile(join(dir, 'frames', current.file)));
    let error = 0, channels = 0;
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
      // The compositor draws the cursor; compare the actual application elsewhere.
      if (Math.abs(x - current.mouse.x) < 50 && Math.abs(y - current.mouse.y) < 60) continue;
      const source = (y * raw.width + x) * 4, target = ((y + border) * width + x + border) * 4;
      for (let c = 0; c < 3; c++) { error += Math.abs(raw.data[source + c] - canvas[target + c]); channels++; }
    }
    const mean = error / channels;
    assert.ok(mean < 4, `Frame ${i}: excessive quantization error ${mean}`);
    sampleErrors.push({ frame: i, meanChannelError: Number(mean.toFixed(3)) });
    await writeFile(join(dir, `verified-${i}.png`), PNG.sync.write({ width, height, data: canvas }));
  }
}
const poster = PNG.sync.read(await readFile(`${asset}.png`));
assert.equal(poster.width, width); assert.equal(poster.height, height);
const posterState = manifest.frames[manifest.posterFrame];
const source = PNG.sync.read(await readFile(join(dir, 'frames', posterState.file)));
for (let y = 0; y < 884; y++) {
  for (let x = 0; x < 1760; x++) {
    if (Math.abs(x - posterState.mouse.x) < 50 && Math.abs(y - posterState.mouse.y) < 60) continue;
    const a = (y * 1760 + x) * 4, b = ((y + border) * width + border + x) * 4;
    assert.ok(source.data.subarray(a, a + 4).equals(poster.data.subarray(b, b + 4)), `Poster pixel ${x},${y}`);
  }
}
const report = {
  frames: frames.length, durationMs: manifest.frames.reduce((sum, f) => sum + f.delay, 0),
  width, height, bytes: bytes.length, globalPalette: true, fixedBorder: true,
  opaqueReplay: true, infiniteLoop: true, posterMatches: true,
  maxCursorStep: Number(maxCursorStep.toFixed(2)), sampleErrors,
  assetSha256: createHash('sha256').update(bytes).digest('hex'),
};
await writeFile(join(dir, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, recording: resolve(dir) }, null, 2));
