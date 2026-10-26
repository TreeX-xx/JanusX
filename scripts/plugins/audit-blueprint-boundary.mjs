// Note: .agents/notes/planning/blueprint-official-plugin.md — reproducible BP-0 import baseline.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, dirname } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const output = resolve(root, process.argv[2] ?? 'artifacts/plugins/blueprint-boundary.json')
const portable = path => relative(root, path).replaceAll('\\', '/')
const configuration = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile)
if (configuration.error) throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n'))
const options = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root).options
const candidates = path => /(?:^|\/)blueprint(?:\/|[-.])/.test(path)
  || /src\/main\/janus\/maintenance\//.test(path) || /(?:^|\/)note-mcp(?:[/.])/.test(path)
const walk = async directory => {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path))
    else if (entry.isFile() && /\.(?:tsx?|css|json)$/.test(path)) result.push(path)
  }
  return result.sort()
}
const files = await walk(resolve(root, 'src'))
const inventory = []
const imports = []
for (const file of files) {
  const bytes = await readFile(file)
  const path = portable(file)
  if (candidates(path)) inventory.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  if (!/\.tsx?$/.test(file)) continue
  const source = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true)
  const add = (specifier, typeOnly) => {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
    const target = resolved ? portable(resolved.resolvedFileName) : null
    imports.push({ from: path, specifier, target, typeOnly })
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, Boolean(node.isTypeOnly || node.importClause?.isTypeOnly))
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      add(node.arguments[0].text, false)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
const incoming = imports.filter(edge => !candidates(edge.from) && edge.target && candidates(edge.target))
const outgoing = imports.filter(edge => candidates(edge.from) && (!edge.target || !candidates(edge.target)))
const report = {
  schemaVersion: 1,
  description: 'Migration candidates and import edges, not an ownership decision or runtime/bundle measurement. Type-only means the whole import/export is type-only; mixed specifiers remain conservative.',
  summary: { candidateFiles: inventory.length, sourceBytes: inventory.reduce((sum, file) => sum + file.bytes, 0),
    incomingEdges: incoming.length, outgoingEdges: outgoing.length,
    hostConsumers: new Set(incoming.map(edge => edge.from)).size,
    hostDependencies: new Set(outgoing.filter(edge => edge.target?.startsWith('src/')).map(edge => edge.target)).size },
  candidates: inventory, incoming, outgoing,
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output: portable(output), ...report.summary }, null, 2))
