import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// npm owns the publication file list; cache only exactly matching published bytes.
export async function publicArchives({ sources, vendor, cache, npm }) {
  await mkdir(cache, { recursive: true })
  const plans = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts', ...sources]))
  const pending = [], records = new Map()
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]
    const files = await Promise.all(plan.files.map(async ({ path, mode }) =>
      [path, mode, digest(await readFile(join(sources[index], path)))]))
    files.sort(([a], [b]) => a.localeCompare(b))
    const key = digest(JSON.stringify({ files, node: process.version }))
    const directory = join(cache, key)
    try {
      const record = JSON.parse(await readFile(join(directory, 'record.json'), 'utf8'))
      const bytes = await readFile(join(directory, plan.filename))
      if (record.name !== plan.name || record.file !== plan.filename || digest(bytes) !== record.sha256) throw Error('Cache changed')
      await cp(join(directory, plan.filename), join(vendor, plan.filename))
      records.set(plan.name, record)
      console.log(`Reusing ${plan.name}`)
    } catch {
      pending.push({ source: sources[index], plan, directory })
    }
  }
  if (pending.length) {
    const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', vendor, ...pending.map(item => item.source)]))
    for (const { plan, directory } of pending) {
      const item = packed.find(item => item.name === plan.name)
      if (!item || item.filename !== plan.filename) throw Error(`Publication identity changed: ${plan.name}`)
      const bytes = await readFile(join(vendor, item.filename))
      const record = { name: item.name, version: item.version, file: item.filename, sha256: digest(bytes), integrity: item.integrity }
      await mkdir(directory, { recursive: true })
      await cp(join(vendor, item.filename), join(directory, item.filename))
      await writeFile(join(directory, 'record.json'), JSON.stringify(record))
      records.set(item.name, record)
      console.log(`Packed ${item.name}`)
    }
  }
  return [...records.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function dependencyDifferences(previous, current) {
  const old = new Map(previous.dependencies.map(item => [item.name, item]))
  const next = new Map(current.dependencies.map(item => [item.name, item]))
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap(name => {
    const before = old.get(name), after = next.get(name)
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    return [`${name}: ${before?.sha256 ?? 'missing'} -> ${after?.sha256 ?? 'removed'}`]
  })
}
