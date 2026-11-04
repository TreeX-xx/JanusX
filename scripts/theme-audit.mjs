// Note: theme maintenance — .agents/notes/workbench/theme-system.md
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import postcss from 'postcss'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const roots = ['src/renderer/src', 'packages/ui/src', 'plugins/blueprint/src/ui', 'plugins/docker/src/ui', 'plugins/cpa/src/ui']
const generated = new Set(['src/renderer/src/styles/themes.generated.css', 'packages/plugin-sdk/theme.css'])

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : /\.(?:css|ts|tsx|js|jsx)$/.test(path) ? [path] : []
  }).sort()
}

// Read actual string/template nodes, skipping comments, regular expressions and URLs
// outside strings. Keep raw source offsets so diagnostics refer to the source file.
function fragments(path, source) {
  if (extname(path) === '.css') {
    const tree = postcss.parse(source, { from: path })
    const parts = []
    tree.walkDecls(declaration => {
      const start = declaration.source.start.offset
      parts.push({ text: source.slice(start, declaration.source.end.offset), start })
    })
    // Attribute values in selectors identify artwork; they do not paint it.
    tree.walkRules(rule => parts.push({ text: rule.selector, start: rule.source.start.offset, selector: true }))
    return parts
  }
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const result = []
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(tree) + 1
      result.push({ text: source.slice(start, node.end - 1), start })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return result
}

/** Static inventory, not a CSS cascade/contrast validator. */
export function scanThemeSources(sources) {
  const parsed = sources.map(({ path, source }) => ({ path, source, parts: fragments(path, source) }))
  const defined = new Set()
  for (const { parts } of parsed) for (const { text } of parts) {
    for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1])
    // Custom properties assigned through style={{ '--name': value }} / setProperty.
    if (/^--[\w-]+$/.test(text)) defined.add(text)
  }
  const findings = []
  for (const { path, source, parts } of parsed) {
    if (generated.has(path)) continue // generated definitions are the allowed color source
    const add = (kind, value, offset) => {
      const before = source.slice(0, offset)
      const line = before.split('\n').length
      const column = offset - before.lastIndexOf('\n')
      findings.push({ path, line, column, kind, value })
    }
    for (const { text, start, selector } of parts) {
      if (!selector) {
        for (const match of text.matchAll(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\brgba?\(\s*[\d.][^)]*\)|\bhsla?\(\s*[\d.][^)]*\)|\b(?:bg|text|border|ring|fill|stroke|divide|from|via|to|shadow)-(?:black|white)(?:\/[\d.]+)?\b/gi)) {
          add('literal-color', match[0].toLowerCase().replace(/\s+/g, ''), start + match.index)
        }
        // Named colors used as CSS values or JS color strings (ordinary prose is ignored).
        for (const match of text.matchAll(/(?:^|:\s*)(black|white)(?=\s*(?:[;,}]|$))/gi)) {
          add('literal-color', match[1].toLowerCase(), start + match.index + match[0].indexOf(match[1]))
        }
      }
      for (const match of text.matchAll(/\[data-theme\s*=\s*['"\\]*([\w-]+)/g)) {
        add('theme-selector', match[1], start + match.index)
      }
      for (const match of text.matchAll(/var\(\s*(--[\w-]+)(?=\s*[,\)])/g)) {
        if (!defined.has(match[1])) add('undefined-variable', match[1], start + match.index)
      }
    }
  }
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column)
}

export function findingKey(finding) {
  return `${finding.kind}:${finding.value}`
}

/** Baseline budgets are per file + kind + value; moving lines does not reset them. */
export function classifyFindings(findings, config) {
  const used = new Map()
  return findings.map((finding) => {
    const key = findingKey(finding)
    const exception = config.exceptions.find((item) => item.path === finding.path && item.key === key)
    const id = `${finding.path}:${key}`
    const count = (used.get(id) ?? 0) + 1
    used.set(id, count)
    if (exception && count <= exception.count && exception.reason?.trim()) {
      return { ...finding, status: 'exception', reason: exception.reason }
    }
    const limit = config.legacy[finding.path]?.[key] ?? 0
    return { ...finding, status: count <= limit ? 'legacy' : 'new' }
  })
}

export function readThemeFindings() {
  return scanThemeSources([...roots.flatMap(directory => filesIn(resolve(root, directory))), resolve(root, 'packages/plugin-sdk/theme.css')].map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'), source: readFileSync(path, 'utf8'),
  })))
}

function main() {
  const config = JSON.parse(readFileSync(resolve(root, 'scripts/theme-audit-baseline.json'), 'utf8'))
  const findings = classifyFindings(readThemeFindings(), config)
  const fresh = findings.filter((finding) => finding.status === 'new')
  const check = process.argv.includes('--check')
  if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 2))
  else {
    for (const item of check ? fresh : findings) {
      console.log(`${item.path}:${item.line}:${item.column} [${item.status}] ${item.kind} ${item.value}${item.reason ? ` — ${item.reason}` : ''}`)
    }
    console.log(`[theme:audit] ${fresh.length} new, ${findings.filter((f) => f.status === 'legacy').length} legacy, ${findings.filter((f) => f.status === 'exception').length} exceptions`)
  }
  if (check && fresh.length) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
