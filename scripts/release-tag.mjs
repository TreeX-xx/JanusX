// 本地版本脚本：版本递增提交 + 打 tag；推送不触发构建或公开发布。
// 用法：npm run release:tag -- <版本> [--dry-run] [--push] [--yes] [--verify] [--notes-file <路径>]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 与 CONTRIBUTING.md 一致：日常迭代 X.Y.Z，内测仅允许 v1.0.0-beta.N 形态。
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(-beta\.(\d+))?$/

function run(cmd, args, options = {}) {
  // Windows 上 npm 只有 npm.cmd，execFile 不走 shell，必须显式走 cmd.exe。
  const needShell = cmd === 'npm' && process.platform === 'win32'
  const bin = needShell ? 'npm.cmd' : cmd
  try {
    return execFileSync(bin, args, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      ...(needShell ? { shell: true } : {}), ...options,
    }).trim()
  } catch (err) {
    const detail = (err.stderr ?? err.message ?? '').toString().trim()
    throw new Error(`命令失败：${cmd} ${args.join(' ')}\n${detail}`)
  }
}

function fail(message) {
  console.error(`release-tag: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = { version: null, dryRun: false, push: false, yes: false, verify: false, notesFile: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--push') out.push = true
    else if (arg === '--yes') out.yes = true
    else if (arg === '--verify') out.verify = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--notes-file') {
      i += 1
      out.notesFile = argv[i] ?? null
      if (!out.notesFile) fail('--notes-file 需要一个路径参数')
    } else if (arg.startsWith('--')) {
      fail(`未知参数：${arg}（查看 npm run release:tag -- --help）`)
    } else if (!out.version) {
      out.version = arg
    } else {
      fail(`多余的位置参数：${arg}`)
    }
  }
  return out
}

function printHelp() {
  console.log(`用法：npm run release:tag -- <版本> [选项]

  <版本>              如 0.8.8（稳定版）或 1.0.0-beta.1（内测版，维护者声明后使用）
  --dry-run           只打印计划，不改任何文件、不提交、不打 tag
  --push              推送 main 分支与 tag（只推送版本标记，需二次确认）
  --yes               跳过二次确认（agent 或 CI 调用时使用）
  --verify            先跑 npm run verify（慢；日常合入已由 PR 门禁覆盖）
  --notes-file <路径> Release 说明模板输出路径（默认 release/release-notes-v<版本>.md）
  --help              显示本帮助

流程：干净工作树检查 → main 与远端同步检查 → 版本递增检查 → tag 不存在检查
  → [可选 verify] → npm version 改版本 → chore 提交 → annotated tag → 生成说明模板 → [可选 push]`)
}

function parseVersion(raw) {
  const m = VERSION_RE.exec(raw.trim())
  if (!m) fail(`版本号不合法：${raw}（期望 X.Y.Z 或 X.Y.Z-beta.N，可带小写 v 前缀）`)
  return { text: `${m[1]}.${m[2]}.${m[3]}${m[4] ?? ''}`, nums: [+m[1], +m[2], +m[3]], beta: m[5] === undefined ? null : +m[5] }
}

// 返回值 >0 表示 a 更新；稳定版高于同基线内测版。
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i]
  }
  if (a.beta === b.beta) return 0
  if (a.beta === null) return 1
  if (b.beta === null) return -1
  return a.beta - b.beta
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(question)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function bumpVersionFiles(version) {
  const pkgPath = join(ROOT, 'package.json')
  const lockPath = join(ROOT, 'package-lock.json')
  const pkg = readJson(pkgPath)
  const lock = readJson(lockPath)
  pkg.version = version
  lock.version = version
  if (lock.packages && lock.packages['']) lock.packages[''].version = version
  writeJson(pkgPath, pkg)
  writeJson(lockPath, lock)
  // 自检：只允许版本行变化，防止序列化破坏文件格式。
  const diff = run('git', ['diff', '--numstat', 'package.json', 'package-lock.json'])
  for (const line of diff.split('\n').filter(Boolean)) {
    const [added, removed] = line.split('\t').map(Number)
    if (added > 3 || removed > 3) {
      throw new Error(`版本文件 diff 异常（${line.trim()}），已停止，请检查后手动恢复`)
    }
  }
}

function previousTag() {
  try {
    return run('git', ['describe', '--tags', '--abbrev=0', 'HEAD'])
  } catch {
    return null
  }
}

function buildNotes(version, prevTag) {
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD'
  const subjects = run('git', ['log', range, '--format=- %s'])
    .split('\n')
    .filter((line) => line && !line.startsWith('- chore: bump version'))
  const lines = [
    `# v${version}`,
    '',
    `> 本地构建并通过 stage:win 上传草稿后填写 Highlights，用 gh release edit v${version} --notes-file <本文件>更新正文；审核后单独运行 publish:win 公开。`,
    '',
    '## Highlights',
    '',
    '- （手动填写用户可见的优化项，每条一句话）',
    '',
    '## Changes',
    '',
    ...(subjects.length > 0 ? subjects : ['- （无可列提交）']),
    '',
  ]
  return `${lines.join('\n')}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  if (!args.version) fail('缺少版本号，例如：npm run release:tag -- 0.8.8')
  const target = parseVersion(args.version)
  const tag = `v${target.text}`

  // 1. 工作树必须干净：tag 必须指向可复现的精确提交。
  const dirty = run('git', ['status', '--porcelain'])
  if (dirty) fail(`工作树不干净，先提交或暂存：\n${dirty}`)

  // 2. 必须在 main 且与远端同步：发版内容就是 origin/main 推进的那一个提交。
  const branch = run('git', ['branch', '--show-current'])
  if (branch !== 'main') fail(`当前分支是 ${branch || '(detached)'}，请切到 main 再打版`)
  run('git', ['fetch', 'origin'])
  const sync = run('git', ['status', '-sb'])
  if (!/^## main\.\.\.origin\/main$/.test(sync.split('\n')[0])) {
    fail(`main 与 origin/main 不同步（${sync.split('\n')[0]}），先按 CONTRIBUTING 同步后再打版`)
  }

  // 3. 版本必须递增。
  const pkg = readJson(join(ROOT, 'package.json'))
  const current = parseVersion(String(pkg.version))
  if (compareVersions(target, current) <= 0) {
    fail(`目标版本 v${target.text} 必须高于当前 package.json 版本 v${current.text}`)
  }

  // 4. tag 不得已存在（本地与远端都查，远端 tag 删不掉）。
  try {
    run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
    fail(`本地已存在 tag ${tag}`)
  } catch (err) {
    if (!String(err.message).includes('命令失败')) throw err
  }
  const remoteTags = run('git', ['ls-remote', '--tags', 'origin', tag])
  if (remoteTags) fail(`远端已存在 tag ${tag}，换一个版本号`)

  const prevTag = previousTag()
  const notesPath = args.notesFile ?? `release/release-notes-v${target.text}.md`

  console.log(`release-tag 计划：${current.text} → ${target.text}（${tag}）`)
  console.log(`- 基线 tag：${prevTag ?? '(无，取全量日志)'}`)
  console.log(`- 改版本文件：package.json + package-lock.json → chore 提交`)
  console.log(`- 打 annotated tag：${tag}`)
  console.log(`- 生成说明模板：${notesPath}`)
  console.log(args.push ? '- 推送：origin main + ' + tag + '（不构建、不公开）' : '- 推送：跳过（加 --push 才推）')

  if (args.dryRun) {
    console.log('dry-run：以上步骤均未执行。')
    return
  }

  if (args.verify) {
    console.log('跑 npm run verify（较慢）…')
    run('npm', ['run', 'verify'], { stdio: 'inherit' })
  }

  if (args.push && !args.yes) {
    const ok = await confirm(`将推送 main 和 ${tag}（不触发构建或公开发布），继续？[y/N] `)
    if (!ok) fail('已取消，未做任何改动')
  }

  // 5. 改版本：直接写两个文件的 version 字段（等价于 npm version 的写文件部分，
  // 不触发 npm 生命周期脚本）。写后 diff 应只有版本行变化，否则说明格式被破坏。
  bumpVersionFiles(target.text)
  run('git', ['add', 'package.json', 'package-lock.json'])
  run('git', ['commit', '-m', `chore: bump version to ${target.text}`])

  // 6. 打 tag，校验 tag 与包版本一致（与 CI 的 Version guard 同一规则）。
  run('git', ['tag', '-a', tag, '-m', tag])
  const taggedCommit = run('git', ['rev-parse', `${tag}^{commit}`])
  const head = run('git', ['rev-parse', 'HEAD'])
  if (taggedCommit !== head) fail('tag 未指向当前 HEAD，停止（请勿推送）')
  const bumped = readJson(join(ROOT, 'package.json')).version
  if (`v${bumped}` !== tag) fail(`tag ${tag} 与 package.json v${bumped} 错位，停止（请勿推送）`)

  // 7. 生成 Release 说明模板（不入库，填好后由人执行 gh release edit 或网页编辑）。
  const notesAbs = resolve(ROOT, notesPath)
  if (existsSync(notesAbs) && !args.notesFile) fail(`模板文件已存在：${notesPath}（用 --notes-file 指定别处或先删除）`)
  mkdirSync(dirname(notesAbs), { recursive: true })
  writeFileSync(notesAbs, buildNotes(target.text, prevTag), 'utf8')
  console.log(`已生成：${notesPath}（填好 Highlights，上传草稿后附加，最后单独公开）`)

  if (!args.push) {
    console.log(`本地已就绪但未推送。确认后执行：git push origin main && git push origin ${tag}`)
    return
  }
  run('git', ['push', 'origin', 'main'])
  run('git', ['push', 'origin', tag])
  console.log(`已推送 ${tag}，未触发构建或发布。本地构建并运行 stage:win 后执行：`)
  console.log(`  gh release edit ${tag} --notes-file ${notesPath}`)
  console.log('  npm run publish:win')
  console.log('  再按 CONTRIBUTING 把 main 同步回 dev：git switch dev && git merge --ff-only origin/main && git push origin dev')
}

await main().catch((err) => fail(err.message ?? String(err)))
