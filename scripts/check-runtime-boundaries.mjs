import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Note: .agents/notes/desktop/platform-runtime-boundaries.md
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = 'scripts/runtime-boundary-baseline.json'
const PROCESS_MODULES = new Set(['child_process', 'node:child_process', 'execa', 'node-pty'])
const PLATFORM_MODULES = new Set(['os', 'node:os', 'process', 'node:process'])
const RULES = new Set(['process-import', 'platform-read'])
const PHASES = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'retained'])
const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/
const testSource = /(?:^|\/)(?:__tests__|__fixtures__)\/|\.(?:test|spec)\.[^.]+$/
const normalize = value => value.replaceAll('\\', '/')
const stringValue = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null

function member(node) {
  if (ts.isPropertyAccessExpression(node)) return { object: node.expression, name: node.name.text }
  if (ts.isElementAccessExpression(node)) return { object: node.expression, name: stringValue(node.argumentExpression) }
  return null
}

function runtimeImport(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (clause?.isTypeOnly) return null
    const bindings = clause?.namedBindings
    if (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length && bindings.elements.every(item => item.isTypeOnly)) return null
    return stringValue(node.moduleSpecifier)
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return null
    if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(item => item.isTypeOnly)) return null
    return stringValue(node.moduleSpecifier)
  }
  if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) return stringValue(node.moduleReference.expression)
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (callee.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(callee) && callee.text === 'require') return stringValue(node.arguments[0])
  }
  return null
}

/** AST-based: comments, string examples and type-only imports cannot create exemptions. */
export function inspectRuntimeSource(file, contents) {
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true)
  const findings = []
  const observations = []
  const processNames = new Set(['process'])
  const osNames = new Set(['os'])
  const add = (target, rule, detail, node) => target.push({ rule, detail, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 })
  const walk = node => {
    const imported = runtimeImport(node)
    if (PROCESS_MODULES.has(imported)) add(findings, 'process-import', imported.replace(/^node:/, ''), node)
    if (PLATFORM_MODULES.has(imported)) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        const names = imported.endsWith('process') ? processNames : osNames
        if (clause?.name) names.add(clause.name.text)
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text)
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const item of clause.namedBindings.elements) {
            if (!item.isTypeOnly && (item.propertyName ?? item.name).text === 'platform') add(findings, 'platform-read', `${imported.replace(/^node:/, '')}.platform`, item)
          }
        }
      } else if (ts.isExportDeclaration(node)) {
        if (!node.exportClause || ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(item => !item.isTypeOnly && (item.propertyName ?? item.name).text === 'platform')) add(findings, 'platform-read', `${imported.replace(/^node:/, '')}.platform-export`, node)
      } else if (ts.isVariableDeclaration(node.parent)) {
        const names = imported.endsWith('process') ? processNames : osNames
        if (ts.isIdentifier(node.parent.name)) names.add(node.parent.name.text)
        else if (ts.isObjectBindingPattern(node.parent.name) && node.parent.name.elements.some(item => (item.propertyName ?? item.name).getText(source) === 'platform')) add(findings, 'platform-read', `${imported.replace(/^node:/, '')}.platform`, node)
      }
    }
    const access = member(node)
    if (access) {
      const { object, name } = access
      const root = ts.isIdentifier(object) ? object.text : ''
      const owner = member(object)
      if (name === 'platform' && (processNames.has(root) || osNames.has(root))) add(findings, 'platform-read', processNames.has(root) ? 'process.platform' : 'os.platform', node)
      else if ((name === 'platform' || name === 'userAgent' || name === 'userAgentData') && (root === 'navigator' || owner?.name === 'navigator')) add(findings, 'platform-read', `navigator.${name}`, node)
      else if (name === 'platform' && (root === 'electron' || owner?.name === 'electron')) add(findings, 'platform-read', 'electron.platform', node)
      if (owner?.name === 'env' && /^(?:HOME|USERPROFILE|PATH|SHELL|COMSPEC|.*_HOME|.*_DIR)$/i.test(name ?? '')) add(observations, 'environment-read', name, node)
      if (name === 'toLowerCase' && ts.isCallExpression(node.parent)) add(observations, 'case-fold-review', 'toLowerCase', node)
    }
    if (ts.isPropertyAssignment(node) && (stringValue(node.name) ?? node.name.getText(source)) === 'shell') add(observations, 'shell-option-review', node.initializer.kind === ts.SyntaxKind.FalseKeyword ? 'false' : 'explicit-shell-policy', node)
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 'homedir' || member(node.expression)?.name === 'homedir')) add(observations, 'home-read', 'homedir', node)
    if (imported?.startsWith('@janus-agent/')) add(observations, 'engine-dependency', imported, node)
    ts.forEachChild(node, walk)
  }
  walk(source)
  return { findings, observations }
}

export function collectRuntimeSources(root = ROOT) {
  const sources = new Map()
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && sourceExtension.test(entry.name)) {
        const file = normalize(relative(root, path))
        if (!testSource.test(file) && !file.endsWith('.d.ts')) sources.set(file, readFileSync(path, 'utf8'))
      }
    }
  }
  visit(join(root, 'src'))
  return sources
}

export function summarizeFindings(findings) {
  const counts = new Map()
  for (const { rule, detail } of findings) {
    const key = `${rule}:${detail}`
    const existing = counts.get(key)
    if (existing) existing.count++
    else counts.set(key, { rule, detail, count: 1 })
  }
  return [...counts.values()].sort((a, b) => `${a.rule}:${a.detail}`.localeCompare(`${b.rule}:${b.detail}`))
}

/** Each file/rule count is an explicit ceiling; a removed use also retires its allowance. */
export function assessRuntimeBoundaries(sources, baseline) {
  if (baseline?.schema !== 1 || !Array.isArray(baseline.entries)) throw new Error('Invalid runtime boundary baseline')
  const allowed = new Map()
  for (const entry of baseline.entries) {
    if (typeof entry.path !== 'string' || !entry.path.startsWith('src/') || entry.path.includes('..') || entry.path.includes('\\') || allowed.has(entry.path) || !entry.owner?.trim() || !entry.reason?.trim() || !PHASES.has(entry.phase) || !['migrate', 'adapter', 'desktop'].includes(entry.kind) || !Array.isArray(entry.findings) || !entry.findings.length) throw new Error(`Invalid runtime boundary entry: ${entry.path}`)
    const keys = new Set()
    for (const finding of entry.findings) {
      const key = `${finding.rule}:${finding.detail}`
      if (!RULES.has(finding.rule) || typeof finding.detail !== 'string' || !finding.detail || !Number.isSafeInteger(finding.count) || finding.count < 1 || keys.has(key)) throw new Error(`Invalid runtime boundary allowance: ${entry.path}`)
      keys.add(key)
    }
    allowed.set(entry.path, entry)
  }
  const inventory = []
  const errors = []
  for (const [file, contents] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    const { findings, observations } = inspectRuntimeSource(file, contents)
    if (findings.length || observations.length) inventory.push({ path: file, owner: allowed.get(file)?.owner ?? null, phase: allowed.get(file)?.phase ?? null, findings, observations })
    const actual = new Map(summarizeFindings(findings).map(item => [`${item.rule}:${item.detail}`, item]))
    const expected = new Map((allowed.get(file)?.findings ?? []).map(item => [`${item.rule}:${item.detail}`, item]))
    for (const [key, item] of actual) {
      const count = expected.get(key)?.count ?? 0
      if (item.count > count) errors.push(`${file}: new ${key} (${item.count} > ${count}); use the owning runtime service`)
    }
    for (const [key, item] of expected) {
      const count = actual.get(key)?.count ?? 0
      if (count < item.count) errors.push(`${file}: stale ${key} allowance (${item.count} > ${count}); reduce the baseline`)
    }
    allowed.delete(file)
  }
  for (const file of allowed.keys()) errors.push(`${file}: stale baseline entry; source no longer exists`)
  return { errors, inventory }
}

export function checkRuntimeBoundaries(root = ROOT) {
  return assessRuntimeBoundaries(collectRuntimeSources(root), JSON.parse(readFileSync(join(root, BASELINE), 'utf8')))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 2 && args[0] === '--report')) throw new Error('Usage: node scripts/check-runtime-boundaries.mjs [--report <existing-directory/file.json>]')
  const result = checkRuntimeBoundaries()
  if (args[0] === '--report') writeFileSync(resolve(args[1]), JSON.stringify(result, null, 2) + '\n')
  for (const error of result.errors) console.error(error)
  const findings = result.inventory.reduce((sum, file) => sum + file.findings.length, 0)
  console.log(`Runtime boundaries: ${result.errors.length} errors; ${findings} recorded uses in ${result.inventory.filter(file => file.findings.length).length} files`)
  process.exitCode = result.errors.length ? 1 : 0
}
