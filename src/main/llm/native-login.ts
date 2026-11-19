import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { NATIVE_LOGIN_CAPABILITIES, nativeLoginLaunchPlan, type NativeLoginState } from '../../shared/native-login'
import type { LlmConsumer } from '../../shared/llm-configuration'
import { terminalManager } from '../terminal/manager'
import { resolveCLIPath } from '../janus-runner/cli-resolver'
import { localRuntimeContext } from '../platform/runtime-context'
import { providerPathContext, resolveProviderPaths, providerLaunchPaths } from '../external-cli/provider-paths'

// Design and renderer compatibility evidence: .agents/notes/terminal/native-login-first.md
// Presence-only probe: parse the credentials file just enough to confirm it is
// a non-empty JSON object, then discard everything. Contents never leave this
// function — no token management, no cross-IPC bytes. Path drift is corrected
// in one place: NATIVE_LOGIN_CAPABILITIES.

export class NativeLoginService {
  constructor(private readonly home: string = homedir(), private readonly env: NodeJS.ProcessEnv = process.env) {}

  credentialsPath(consumer: LlmConsumer): string | null {
    if (consumer === 'janus') return null
    const capability = NATIVE_LOGIN_CAPABILITIES[consumer]
    if (!capability.detectable || !capability.credentials) return null
    const base = resolveProviderPaths(consumer, providerPathContext({ home: this.home, env: this.env })).configHome
    if (!base) return null
    return join(base, ...capability.credentials.path.slice(consumer === 'opencode' ? 1 : 0))
  }

  async getStatus(consumer: LlmConsumer): Promise<NativeLoginState> {
    const checkedAt = new Date().toISOString()
    // Consume-on-read: a launch failure is reported once, then forgotten, so
    // it can never park itself at the top of the settings panel forever.
    const launchError = loginLaunchErrors.get(consumer)
    loginLaunchErrors.delete(consumer)
    const path = this.credentialsPath(consumer)
    if (!path) return { status: 'unknown', checkedAt, ...(launchError ? { launchError } : {}) }
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // Only a missing file confirms "not signed in"; anything else degrades to
      // unknown so a probe failure never blocks the native apply.
      const code = (error as NodeJS.ErrnoException).code
      return { status: code === 'ENOENT' ? 'logged-out' : 'unknown', checkedAt, ...(launchError ? { launchError } : {}) }
    }
    try {
      const value: unknown = JSON.parse(text)
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
        return { status: 'logged-in', checkedAt }
      }
      return { status: 'unknown', checkedAt, ...(launchError ? { launchError } : {}) }
    } catch {
      return { status: 'unknown', checkedAt, ...(launchError ? { launchError } : {}) }
    }
  }
}

export const nativeLoginService = new NativeLoginService()

// Background login runner: the Agent's CLI runs in a hidden main-process PTY
// and opens the browser itself (codex login / claude /login …). Nothing is
// registered with the workbench UI; the credentials file remains the only
// success signal. One hidden PTY per Agent — starting again replaces it.
const LOGIN_PTY_PREFIX = 'native-login-'
const LOGIN_SUBMIT_DELAY_MS = 2500
const LOGIN_TIMEOUT_MS = 5 * 60_000
/** A PTY that dies within this window without signing in is treated as a launch failure. */
const LOGIN_EARLY_EXIT_MS = 60_000
const loginTimers = new Map<LlmConsumer, ReturnType<typeof setTimeout>>()
const loginLaunchErrors = new Map<LlmConsumer, string>()

/**
 * Claude's TUI asks a folder-trust question when launched in an untrusted cwd,
 * which swallows the /login keystrokes. Prefer a directory the user already
 * trusted (recorded in ~/.claude.json); fall back to the home directory and
 * let the dialog-answering path handle it.
 */
function trustedCwdForClaude(home: string): string {
  const fallback = join(home, 'Desktop', 'git')
  try {
    const configPath = join(home, '.claude.json')
    if (!existsSync(configPath)) return existsSync(fallback) ? fallback : home
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> }
    const trusted = Object.entries(config.projects || {}).find(([, value]) => value?.hasTrustDialogAccepted)?.[0]
    if (!trusted) return existsSync(fallback) ? fallback : home
    // claude.json keys use forward slashes even on Windows.
    return trusted
  } catch {
    return home
  }
}

function cleanOutput(text: string): string {
  // Strip ANSI/VT sequences so the surfaced error is readable plain text.
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // ConPTY uses cursor moves instead of spaces. Preserve word boundaries,
    // but keep SGR styling inside words transparent.
    .replace(/\x1b\[[0-9;?>]*[A-Za-z]/g, sequence => sequence.endsWith('m') ? '' : ' ')
    .replace(/\x1b[=>()][A-Za-z0-9]?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Turn a dead login PTY's output tail into one short, human-readable line.
 * Never returns URLs (OAuth links are long and stale the moment they exist);
 * an exit without a recognizable error is reported as a cancellation, not a
 * crash dump.
 */
export function classifyLaunchFailure(outputTail: string): string | undefined {
  const plain = cleanOutput(outputTail).replace(/https?:\/\/\S+/g, '[link]').trim()
  if (!plain) return undefined
  if (/os error 10013|EACCES|permission denied/i.test(plain)) {
    return 'Windows is blocking the login callback port (os error 10013). Free the reserved port range and try again.'
  }
  const match = plain.match(/.{0,60}(?:error|failed|refused|denied|not found).{0,140}/i)
  if (match) return 'The sign-in process exited unexpectedly: ' + match[0].trim().slice(0, 220)
  return 'The sign-in ended before it completed. You can try again.'
}

export async function startNativeLogin(consumer: LlmConsumer): Promise<{ success: boolean; error?: string }> {
  const plan = nativeLoginLaunchPlan(consumer)
  if (!plan) return { success: false, error: 'No sign-in flow for this Agent' }
  try {
    const context = localRuntimeContext()
    const command = await resolveCLIPath(plan.command, context)
    if (!command) return { success: false, error: `${plan.command} CLI not found on PATH` }
    const id = LOGIN_PTY_PREFIX + consumer
    const cwd = consumer === 'claude' ? trustedCwdForClaude(homedir()) : homedir()
    const provider = providerLaunchPaths(consumer, providerPathContext({ env: context.env, cwd, args: plan.args }))
    // create() kills any previous instance with the same id (AC5), so a
    // double-click restarts the login instead of leaking a second PTY.
    const instance = terminalManager.create({
      id,
      workspaceId: '__native_login__',
      // Claude's TUI blocks on a folder-trust dialog in an untrusted cwd,
      // which would swallow /login; run it in a directory the user already
      // trusted instead.
      cwd,
      shell: context.shell,
      program: command,
      programArgs: provider.args,
      launch: { identity: context.identity, program: command, args: provider.args, env: { ...provider.env, ...(consumer === 'claude' ? { CLAUDE_CODE_NO_FLICKER: '0' } : {}) }, source: 'native-login' },
      // This PTY has no visible renderer. Keep Claude's login in classic mode:
      // fullscreen boot canaries survive forced early termination and can
      // disable fullscreen for later, visible sessions sharing the same config.
      // Scope the override to this child; never rewrite the user's TUI setting.
      cols: 120,
      rows: 40,
    })
    const startedAt = Date.now()
    loginLaunchErrors.delete(consumer)
    let outputTail = ''
    let trustAnswered = false
    let slashSubmitted = !plan.submitLine
    let methodConfirmed = !plan.submitLine
    const write = (text: string) => { try { instance.pty.write(text) } catch { /* exited */ } }
    const submitSlash = () => {
      if (slashSubmitted) return
      slashSubmitted = true
      write(plan.submitLine + '\r')
    }
    instance.pty.onData((data: string) => {
      outputTail = (outputTail + data).slice(-4000)
      if (!plan.submitLine) return
      const plain = cleanOutput(outputTail)
      // Claude's TUI asks a folder-trust question before the chat input on an
      // untrusted cwd; answer "Yes, I trust" (Down + Enter) so /login is not
      // swallowed by the dialog.
      if (!trustAnswered && /you trust|trust this folder/i.test(plain)) {
        trustAnswered = true
        write('\x1b[B')
        setTimeout(() => { write('\r'); setTimeout(submitSlash, 2000) }, 400)
        return
      }
      // /login opens a login-method menu (1 subscription · 2 console · 3
      // platform); option 1 is preselected — confirm it to open the browser.
      if (slashSubmitted && !methodConfirmed && /login method/i.test(plain) && /Claude account with subscription/i.test(plain)) {
        methodConfirmed = true
        setTimeout(() => write('\r'), 400)
      }
    })
    instance.pty.onExit(() => {
      const timer = loginTimers.get(consumer)
      if (timer) clearTimeout(timer)
      loginTimers.delete(consumer)
      const early = Date.now() - startedAt < LOGIN_EARLY_EXIT_MS || !slashSubmitted
      if (!early) return
      // Classify the death AFTER checking credentials: a successful sign-in
      // also exits the CLI promptly (and closing the browser mid-flow is a
      // cancellation, not a crash — never dump raw output or OAuth URLs).
      void (async () => {
        if ((await nativeLoginService.getStatus(consumer)).status === 'logged-in') return
        const message = !slashSubmitted && plan.submitLine
          ? (classifyLaunchFailure(outputTail) ?? 'The login process exited before the TUI was ready')
          : classifyLaunchFailure(outputTail)
        if (message) loginLaunchErrors.set(consumer, message)
      })().catch(() => { /* probe failure must not mask the exit */ })
    })
    const existing = loginTimers.get(consumer)
    if (existing) clearTimeout(existing)
    loginTimers.set(consumer, setTimeout(() => {
      loginTimers.delete(consumer)
      try { terminalManager.kill(id) } catch { /* already gone */ }
    }, LOGIN_TIMEOUT_MS))
    if (plan.submitLine) {
      // Fallback: if no trust dialog ever appears (already-trusted cwd), submit
      // the slash command after the normal boot delay.
      setTimeout(submitSlash, LOGIN_SUBMIT_DELAY_MS)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function stopNativeLogin(consumer: LlmConsumer): void {
  const timer = loginTimers.get(consumer)
  if (timer) clearTimeout(timer)
  loginTimers.delete(consumer)
  try { terminalManager.kill(LOGIN_PTY_PREFIX + consumer) } catch { /* not running */ }
}
