// Note: .agents/notes/desktop/reproducible-verification.md
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The pinned engine has two directory consumers outside the desktop bundle.
// Keep the source archives intact and verify both sides of each local edit.
const edits = [
  {
    file: '@janus-agent/node-hosts/dist/workflowx-detection.js',
    upstream: '47577b35db68d06b4431eb28db6db936450d3c2aa3a26149f4035b76a16bf07b',
    patched: '00a632597307b3104b888b005a75bb808b8cc75e54ae34d8098446f9add87318',
    transform: source => source.replace('import { open, opendir }', 'import { open, opendir, readdir }')
      .replace('const dir = await opendir(path);', "const dir = process.platform === 'win32' ? await readdir(path, { withFileTypes: true }) : await opendir(path);"),
  },
  {
    file: '@janus-agent/agent-core/dist/main/agent/checkpoint/checkpoint-manager.js',
    upstream: 'aafffbbea2b828a1f8411687d50942c74dc35ed044375a5c2b9b6c7d5f3e0481',
    patched: 'fbdc0b49e579a609230eb5c64164b79cd0fc3be5b255d58ef1c5eca7c0183d82',
    transform: source => source.replace('const entries = await opendir(root);',
      "const entries = process.platform === 'win32' ? await readdir(root, { withFileTypes: true }) : await opendir(root);"),
  },
]
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export function installedEngineDigest(file, upstream) {
  return edits.find(edit => edit.file === file && edit.upstream === upstream)?.patched ?? upstream
}

export function prepareEngineDirectoryReads(root) {
  for (const edit of edits) {
    const path = join(root, 'node_modules', edit.file)
    const source = readFileSync(path)
    const current = digest(source)
    if (current === edit.patched) continue
    if (current !== edit.upstream) throw new Error('Unexpected engine source for directory handling: ' + edit.file)
    const patched = edit.transform(source.toString('utf8'))
    if (digest(patched) !== edit.patched) throw new Error('Directory handling patch mismatch: ' + edit.file)
    const temporary = path + '.' + randomUUID()
    try {
      writeFileSync(temporary, patched, { flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}
