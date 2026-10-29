// Note: 蓝图端口拦截样板（attachNoteChatTools 同款）——launch-config.* 是运行配置唯一写入口 — see .agents/notes/agent/run-config-assistant-edit-tools.md
import { randomUUID } from 'node:crypto'
import { createToolManifests, type ToolDefinition, type ToolResult } from '@janus-agent/agent-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import type { LaunchConfig, ValidationResult } from '../../shared/ipc/project'
import {
  applyLaunchConfigOps,
  redactConfig,
  type LaunchConfigChange,
  type LaunchConfigOp,
} from '../../shared/launch-config-chat'
import { ProjectConfig } from '../project'

const fail = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)

export const LAUNCH_CONFIG_TOOLS = [
  {
    name: 'launch-config.get',
    actionRisk: 'inspect',
    description: 'Read the current turn draft of the JanusX LaunchConfig and its validation result. Env values are redacted; use setEnv to change them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'launch-config.edit',
    actionRisk: 'write',
    description: 'Edit the LaunchConfig draft. Prefer ops (setField / addConfiguration / updateConfiguration / removeConfiguration / setEnv) over whole-config replacement; full config is only for first generation or an explicit restart. Each receipt carries the draft summary and ValidationResult.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['setField', 'addConfiguration', 'updateConfiguration', 'removeConfiguration', 'setEnv'] },
              path: { type: 'string' },
              name: { type: 'string' },
              value: {},
              configuration: { type: 'object' },
              env: { type: 'object' },
            },
            required: ['op'],
            additionalProperties: false,
          },
        },
        config: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'launch-config.apply',
    actionRisk: 'config-apply',
    description: 'Validate the draft and save the JanusX launch configuration. Asks the user for one approval before the file lands. Refuses when validation fails.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as ToolDefinition[]

const isLaunchConfigTool = (name: string) => LAUNCH_CONFIG_TOOLS.some((tool) => tool.name === name)

function parseOps(input: Record<string, unknown>): LaunchConfigOp[] {
  const ops = input.ops
  if (ops === undefined) return []
  if (!Array.isArray(ops)) throw new Error('ops must be an array')
  return ops as LaunchConfigOp[]
}

/** 每轮文档状态：连续两次修复仍非法则停手，把错误交还用户。 */
interface DraftState {
  config: LaunchConfig
  consecutiveInvalid: number
  stopped: boolean
  trail: string[]
}

export function attachLaunchConfigTools(ports: ChatTurnPorts, options: {
  draft: { config: LaunchConfig; projectPath: string }
  workspaceId: string
  resources: Array<{ agentSessionId: string; workspaceId: string; workspacePath: string }>
  signal: AbortSignal
  onChange: (change: LaunchConfigChange) => void
}) {
  const original = ports.tools
  const state: DraftState = { config: structuredClone(options.draft.config), consecutiveInvalid: 0, stopped: false, trail: [] }

  const receipt = (summary: string, validation: ValidationResult, extra?: Record<string, unknown>) => ({
    summary,
    validation,
    config: redactConfig(state.config),
    ...extra,
  })

  /** 应用一次编辑并回灌 ValidationResult；两次连续非法后停手。 */
  const applyEdit = (next: LaunchConfig, summary: string) => {
    // 模型回读的 [REDACTED] 表示「保持原值」：既有配置的 env 不被脱敏占位符覆盖。
    for (const item of next.configurations) {
      const previous = state.config.configurations.find((entry) => entry.name === item.name)?.env
      if (!item.env || !previous) continue
      item.env = Object.fromEntries(Object.entries(item.env).map(([key, value]) =>
        [key, value === '[REDACTED]' && previous[key] !== undefined ? previous[key] : value]))
    }
    state.config = next
    state.trail.push(summary)
    const validation = ProjectConfig.validate(state.config)
    if (!validation.valid) {
      state.consecutiveInvalid += 1
      if (state.consecutiveInvalid >= 2) {
        state.stopped = true
      }
    } else {
      state.consecutiveInvalid = 0
    }
    options.onChange({
      id: randomUUID(),
      config: structuredClone(state.config),
      summary,
      validation,
    })
    return receipt(summary, validation, state.stopped
      ? { stopped: true, message: '两次修复仍非法，已停手。请把这些校验错误原样交给用户，不要再自行修改配置。' }
      : undefined)
  }

  ports.tools = {
    registry: {
      list: () => [...original.registry.list().filter((tool) => !isLaunchConfigTool(tool.name)), ...LAUNCH_CONFIG_TOOLS],
      listManifests: () => [...(original.registry.listManifests?.() ?? createToolManifests(original.registry.list())).filter((manifest) => !isLaunchConfigTool(manifest.canonicalName) && !isLaunchConfigTool(manifest.providerName)), ...createToolManifests(LAUNCH_CONFIG_TOOLS)],
    },
    executeFunctionCall: async (input, callerId): Promise<ToolResult> => {
      if (!isLaunchConfigTool(input.call.toolName)) return original.executeFunctionCall(input, callerId)
      const startedAt = new Date().toISOString()
      const correlationId = input.call.correlationId ?? randomUUID()
      const result = { workspaceId: options.workspaceId, sessionId: input.sessionId, correlationId, toolName: input.call.toolName, startedAt }
      try {
        if (!options.resources.some((item) => item.agentSessionId === input.sessionId)) {
          throw new Error('PERMISSION_DENIED: launch-config workspace session unavailable')
        }
        if (options.signal.aborted) throw new Error('launch-config operation cancelled')
        if (state.stopped) {
          throw new Error('已连续两次修复仍非法，停止编辑。请把校验错误交给用户。')
        }
        let output: unknown
        if (input.call.toolName === 'launch-config.get') {
          output = receipt('draft read', ProjectConfig.validate(state.config))
        } else if (input.call.toolName === 'launch-config.edit') {
          const args = (input.call.input ?? {}) as Record<string, unknown>
          const ops = parseOps(args)
          const hasConfig = args.config !== undefined
          if (hasConfig && ops.length) throw new Error('Provide either ops or config, not both')
          if (!hasConfig && !ops.length) throw new Error('Provide ops or a full config')
          if (hasConfig) {
            output = applyEdit(structuredClone(args.config) as LaunchConfig, 'replace full config')
          } else {
            const { config, summary } = applyLaunchConfigOps(state.config, ops)
            output = applyEdit(config, summary)
          }
        } else {
          const validation = ProjectConfig.validate(state.config)
          if (!validation.valid) {
            output = receipt('refused: config invalid', validation, {
              message: '校验未通过，不写盘。请先用 launch-config.edit 修复。',
            })
          } else {
            const detail = state.trail.slice(-30).join('\n')
            const target = options.draft.projectPath
              ? await ProjectConfig.getConfigPath(options.draft.projectPath)
              : 'JanusX launch configuration'
            const applied = await original.executeFunctionCall({
              sessionId: input.sessionId,
              call: {
                toolName: 'project.apply-config',
                input: { workspaceId: options.workspaceId, path: options.draft.projectPath, config: structuredClone(state.config) },
                correlationId,
                preview: {
                  summary: `Apply launch configuration for ${state.config.projectName}`,
                  paths: [target],
                  detail,
                  truncated: state.trail.length > 30,
                },
              },
            }, callerId)
            if (applied.status !== 'completed') {
              output = receipt('apply failed', validation, { error: applied.error ?? applied.summary, apply: applied.output })
            } else {
              options.onChange({
                id: randomUUID(),
                config: structuredClone(state.config),
                summary: 'launch configuration written',
                validation,
                applied: true,
              })
              output = receipt('written JanusX launch configuration', validation, { applied: true, apply: applied.output })
            }
          }
        }
        return { ...result, status: 'completed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: 'launch-config operation completed', output }
      } catch (error) {
        return { ...result, status: 'failed', completedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(startedAt), summary: fail(error), error: fail(error) }
      }
    },
  }
}
