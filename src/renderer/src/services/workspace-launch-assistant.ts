import type { ToolResult } from '../../../shared/ipc/agent-runtime'
import type { ChatToolTraceEntry, ChatWorkspaceResource } from '../../../shared/ipc/llm'
import { ProjectType, type LaunchConfig, type RunningProjectSummary, type ValidationResult } from '../../../shared/ipc/project'
import type { LaunchConfigChange } from '../../../shared/launch-config-chat'
import { chatStream, type ChatMessage } from './llm'
import { emptyChatTimeline, mergeTimelineTrace, reduceChatTimeline, reduceTimelineRuntime, settleChatTimeline } from '../../../shared/chat-timeline'

// Note: launch-assistant sourceTag keeps this dialog out of persona capture (recall/capture/timeline gates) — see .agents/notes/agent/run-config-assistant-edit-tools.md
// Note: config exchange runs through the launch-config.* tool surface (get/edit/apply + config_change); the <janus-launch-action> text protocol is retired — see .agents/notes/agent/run-config-assistant-edit-tools.md

const MANIFEST_PATTERN = /(^|\/)(package\.json|pyproject\.toml|cargo\.toml|go\.mod|cmakelists\.txt|readme(?:\.md)?)$/i
const MAX_CONTEXT_FILES = 5
const ROOT_CONTEXT_FILES = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'CMakeLists.txt', 'README.md']

/**
 * 助手轮次固定工具面：只读理解 + 专属配置写入口。git 只读按需追加，
 * project.process-output 默认不放行 — see
 * .agents/notes/agent/run-config-assistant-edit-tools.md
 */
export const LAUNCH_ASSISTANT_TOOL_ALLOWLIST = [
  'workspace.list', 'workspace.read', 'project.detect',
  'launch-config.get', 'launch-config.edit', 'launch-config.apply',
]
const IGNORED_CONTEXT_DIRECTORIES = new Set([
  '.claude', '.codex', '.git', '.hybrid', '.janusx',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'test-results',
])

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
}

export function selectLaunchContextFiles(files: string[], projectPath = ''): string[] {
  const normalizedProjectPath = normalizeRelativePath(projectPath)
  const projectPrefix = normalizedProjectPath ? `${normalizedProjectPath}/` : ''

  return files
    .map(normalizeRelativePath)
    .filter((path) => !normalizedProjectPath || path.startsWith(projectPrefix))
    .filter((path) => {
      const relativePath = projectPrefix ? path.slice(projectPrefix.length) : path
      const directories = relativePath.split('/').slice(0, -1)
      return !directories.some((segment) => IGNORED_CONTEXT_DIRECTORIES.has(segment.toLowerCase()))
    })
    .sort((left, right) => {
      const leftRelative = projectPrefix ? left.slice(projectPrefix.length) : left
      const rightRelative = projectPrefix ? right.slice(projectPrefix.length) : right
      const depthDifference = leftRelative.split('/').length - rightRelative.split('/').length
      if (depthDifference !== 0) return depthDifference
      const leftReadme = /(^|\/)readme(?:\.md)?$/i.test(leftRelative) ? 1 : 0
      const rightReadme = /(^|\/)readme(?:\.md)?$/i.test(rightRelative) ? 1 : 0
      return leftReadme - rightReadme || left.localeCompare(right)
    })
}

export function redactWorkspaceExcerpt(content: string): string {
  return content
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key)["']?\s*[:=]\s*)["']?[^"'\s,}]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[REDACTED]@')
}

export interface WorkspaceLaunchAnalysis {
  workspaceId: string
  projectPath: string
  relativePath: string
  detection: {
    type: ProjectType
    confidence: number
    evidence: string[]
    availableScripts?: string[]
    candidates: Array<{ path: string; type: ProjectType; confidence: number; evidence: string[] }>
  }
  candidateConfig: LaunchConfig
  validation: ValidationResult
  files: string[]
  excerpts: Array<{ path: string; content: string }>
}

function completed<T>(result: ToolResult): T {
  if (result.status !== 'completed') throw new Error(result.error || `${result.toolName} ${result.status}`)
  return result.output as T
}

export async function analyzeWorkspaceLaunch(input: {
  workspaceId: string
  workspaceRoot: string
  projectRelativePath?: string
}): Promise<WorkspaceLaunchAnalysis> {
  const session = await window.electron.agentRuntime.createSession({
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
  })
  try {
    const relativePath = input.projectRelativePath ?? ''
    const listed = completed<{ entries: Array<{ path: string; type: 'file' | 'directory' }> }>(
      await window.electron.agentRuntime.executePlannerStep({
        sessionId: session.id,
        call: { toolName: 'workspace.list', input: { workspaceId: input.workspaceId, path: relativePath, depth: 3, maxEntries: 600 } },
      }),
    )
    const detection = completed<WorkspaceLaunchAnalysis['detection']>(
      await window.electron.agentRuntime.executePlannerStep({
        sessionId: session.id,
        call: { toolName: 'project.detect', input: { workspaceId: input.workspaceId, path: relativePath, depth: 3, maxDirectories: 100 } },
      }),
    )
    const selectedPath = input.projectRelativePath ?? detection.candidates[0]?.path ?? relativePath
    const generated = completed<{ config: LaunchConfig; validation: ValidationResult }>(
      await window.electron.agentRuntime.executePlannerStep({
        sessionId: session.id,
        call: {
          toolName: 'project.generate-config',
          input: { workspaceId: input.workspaceId, path: selectedPath, projectType: detection.candidates[0]?.type ?? detection.type },
        },
      }),
    )
    const listedFiles = listed.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path)
    const files = selectLaunchContextFiles(listedFiles, selectedPath)
    const projectPrefix = selectedPath ? `${normalizeRelativePath(selectedPath)}/` : ''
    const contextFiles = [...new Set([
      ...ROOT_CONTEXT_FILES.map((path) => `${projectPrefix}${path}`),
      ...files.filter((path) => MANIFEST_PATTERN.test(path)),
    ])]
    const excerpts: Array<{ path: string; content: string }> = []
    for (const path of contextFiles) {
      if (excerpts.length >= MAX_CONTEXT_FILES) break
      try {
        const result = await window.electron.agentRuntime.executeFunctionCall({
          sessionId: session.id,
          call: { toolName: 'workspace.read', input: { workspaceId: input.workspaceId, path, maxBytes: 48 * 1024 } },
        })
        if (result.status !== 'completed') continue
        const read = result.output as { content: string }
        excerpts.push({ path, content: redactWorkspaceExcerpt(read.content) })
        if (!files.includes(path)) files.unshift(path)
      } catch {
        // Manifest excerpts improve the model context but are not required for detection.
      }
    }
    return {
      workspaceId: input.workspaceId,
      projectPath: selectedPath,
      relativePath: selectedPath,
      detection,
      candidateConfig: generated.config,
      validation: generated.validation,
      files,
      excerpts,
    }
  } finally {
    await window.electron.agentRuntime.cancelSession(session.id).catch(() => undefined)
  }
}

export function buildLaunchAssistantMessages(input: {
  request: string
  analysis: WorkspaceLaunchAnalysis
  runningProjects?: RunningProjectSummary[]
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}): ChatMessage[] {
  const context = {
    detection: input.analysis.detection,
    files: input.analysis.files.slice(0, 160),
    excerpts: input.analysis.excerpts,
    runningProjects: input.runningProjects ?? [],
  }
  return [
    {
      role: 'system',
      content: [
        'You are the JanusX workspace launch assistant. You read and edit the JanusX LaunchConfig exclusively through the launch-config tools.',
        'Use launch-config.get to read the current draft and its validation result (env values are redacted).',
        'Use launch-config.edit to change the draft: prefer granular ops (setField / addConfiguration / updateConfiguration / removeConfiguration / setEnv) over whole-config replacement; the full config is only for first generation or an explicit restart. Each receipt feeds the ValidationResult back so you can fix errors.',
        'Use launch-config.apply to validate the draft and save the JanusX launch configuration; it asks the user for one approval before the file lands.',
        'Analyze the supplied workspace evidence and the user request. Do not invent files, scripts, ports, or commands.',
        'Detected project type is advisory evidence, not a restriction. The user description of how the project is actually launched is authoritative.',
        'If the user names an external workspace script or executable, create a complete custom LaunchConfig using type "custom", program, args, cwd and env as needed. Do not force CMake or another detected default.',
        'Distinguish the detected project type from the requested launch method in your explanation.',
        'Answer the user in concise prose first. The tool calls perform the edits. Never output a machine action block and never wrap config JSON in Markdown fences.',
      ].join('\n'),
    },
    { role: 'system', content: `Workspace evidence:\n${JSON.stringify(context)}` },
    ...(input.history ?? []).filter(message => message.role === 'user' || message.content.trim()).slice(-8)
      .map(({ role, content }) => ({ role, content })),
    { role: 'user', content: input.request },
  ]
}

export function streamWorkspaceLaunchAssistant(input: {
  request: string
  analysis: WorkspaceLaunchAnalysis
  config: LaunchConfig
  projectPath: string
  workspaceResources: ChatWorkspaceResource[]
  toolTraces?: ChatToolTraceEntry[]
  runningProjects?: RunningProjectSummary[]
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  onDelta: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
  onConfigChange: (change: LaunchConfigChange) => void
  onToolTraces: (entries: ChatToolTraceEntry[]) => void
  onTimeline?: (snapshot: import('../../../shared/chat-timeline').ChatTimelineSnapshot) => void
  onDone: (message: string) => void
  onError: (error: string) => void
}): { abort: () => void } {
  let raw = ''
  let timeline = emptyChatTimeline()
  let usingAgentEvents = false
  const publish = () => input.onTimeline?.(timeline)
  const liveTools = new Map<string, ChatToolTraceEntry>()
  const unsubscribe = typeof window === 'undefined' ? undefined : window.electron?.agentRuntime?.onEvent?.(event => {
    if (event.type !== 'approval-requested' || !input.workspaceResources.some(resource => resource.agentSessionId === event.request.sessionId)) return
    timeline = reduceTimelineRuntime(timeline, event)
    publish()
  })
  const stream = chatStream(
    buildLaunchAssistantMessages(input),
    (delta) => {
      raw += delta
      if (!usingAgentEvents) {
        timeline = reduceChatTimeline(timeline, { type: 'text_delta', requestId: 'legacy', delta })
        publish()
      }
      input.onDelta(delta)
    },
    () => { unsubscribe?.(); timeline = settleChatTimeline(timeline, Date.now()); publish(); input.onDone(raw) },
    error => { unsubscribe?.(); timeline = settleChatTimeline(timeline, Date.now()); publish(); input.onError(error) },
    {
      sourceTag: 'launch-assistant',
      workspaceId: input.analysis.workspaceId,
      workspacePath: input.workspaceResources[0]?.workspacePath,
      workspaceResources: input.workspaceResources,
      toolAllowlist: [...LAUNCH_ASSISTANT_TOOL_ALLOWLIST],
      toolTraces: input.toolTraces,
      launchDraft: { config: input.config, projectPath: input.projectPath },
      onAgentEvent: (event) => {
        usingAgentEvents = true
        timeline = reduceChatTimeline(timeline, event)
        publish()
        if (event.type === 'config_change') {
          input.onConfigChange(event.change)
        } else if (event.type === 'reasoning_delta') {
          input.onReasoningDelta?.(event.delta)
        } else if (event.type === 'tool_execution_start') {
          liveTools.set(event.callId, { ...liveTools.get(event.callId), callId: event.callId, toolName: event.toolName, workspaceId: input.analysis.workspaceId, status: 'running', summary: '' })
          input.onToolTraces([...liveTools.values()])
        } else if (event.type === 'tool_execution_end') {
          liveTools.set(event.callId, { ...liveTools.get(event.callId), callId: event.callId, toolName: event.toolName, workspaceId: input.analysis.workspaceId, status: event.status, summary: '' })
          input.onToolTraces([...liveTools.values()])
        }
      },
      onToolTrace: (entries) => {
        for (const entry of entries) {
          const { configResult: _displayOnly, ...contextTrace } = entry
          liveTools.set(entry.callId ?? entry.turnId ?? entry.toolName, contextTrace)
          timeline = mergeTimelineTrace(timeline, entry)
        }
        publish()
        input.onToolTraces([...liveTools.values()])
      },
    },
  )
  return { abort: () => { unsubscribe?.(); stream.abort() } }
}
