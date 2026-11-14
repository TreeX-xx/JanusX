// Import reviewed screenshots without editing their pixels. Raw recordings live in the app checkout.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const appRoot = resolve(process.env.JANUSX_APP_ROOT || resolve(siteRoot, '../JanusX'));
const dualViewManifest = '.cache/readme-dual-view-fkPH3s/manifest.json';
const rightPanelManifest = '.cache/readme-right-dock-full-dXLiGB/manifest.json';
const dualView = JSON.parse(await readFile(resolve(appRoot, dualViewManifest), 'utf8'));
const rightPanel = JSON.parse(await readFile(resolve(appRoot, rightPanelManifest), 'utf8'));
if (dualView.threadUnchanged !== true || rightPanel.sessionsFixture !== true) throw new Error('Source recording evidence does not match the selected captures.');
const sources = [
  ['workbench', 'docs/assets/readme/workbench-overview.png'],
  ['conversation', '.cache/readme-dual-view-fkPH3s/frames/p-0000.png'],
  ['terminal', '.cache/readme-dual-view-fkPH3s/frames/p-0015.png'],
  ['split', '.cache/readme-chat-split-R5Y4y9/frames/p-0063.png'],
  ['files-panel', '.cache/readme-right-dock-full-dXLiGB/frames/p-0014.png'],
  ['session-panel', '.cache/readme-right-dock-full-dXLiGB/frames/p-0107.png'],
  ['blueprint-workbench', 'docs/assets/readme/blueprint-workbench.png']
];
// Read all sources before changing published assets.
const assets = await Promise.all(sources.map(async ([name, source]) => {
  const bytes = await readFile(resolve(appRoot, source));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Not a PNG: ${source}`);
  return { bytes, file: `${name}.png`, source, sha256: createHash('sha256').update(bytes).digest('hex'),
    width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}));
for (const { bytes, file } of assets) await writeFile(resolve(siteRoot, 'assets/workspace', file), bytes);
await writeFile(resolve(siteRoot, 'assets/workspace/current-ui.json'), JSON.stringify({
  importedAt: new Date().toISOString(), theme: 'dark',
  sourceNote: 'JanusX/.agents/notes/desktop/readme-showcase.md',
  sourcePeriod: '2026-11-10 / 2026-11-12',
  provenance: 'Existing isolated Electron captures; original bytes preserved. Not a fresh capture of current HEAD.',
  conversationContent: 'Local scripted demonstration responses in the Atlas example project',
  dualView: { threadUnchanged: dualView.threadUnchanged, sourceManifest: dualViewManifest },
  rightPanel: { sessionsFixture: rightPanel.sessionsFixture, sourceManifest: rightPanelManifest },
  assets: assets.map(({ bytes, ...metadata }) => metadata)
}, null, 2) + '\n');
console.log(`Imported ${assets.length} current UI captures without pixel changes.`);
