export const PROJECT_CHANNELS = {
  detect: 'project:detect',
  detectWithDetails: 'project:detect-with-details',
  readConfig: 'project:config:read',
  writeConfig: 'project:config:write',
  createDefaultConfig: 'project:config:create-default',
  validateConfig: 'project:config:validate',
  test: 'project:test',
  run: 'project:run',
  stop: 'project:stop',
  list: 'project:list',
  get: 'project:get',
  schemas: 'project:schemas',
} as const

export * from '@janus-agent/janus-agent/tools/contracts/project'
import type { ProjectType, LaunchConfig, DetectResult, ProjectTaskResult, ProjectTypeSchema, ValidationResult, ProjectRunOptions, RunningProjectSummary, RunningProjectDetail, ProjectRunResult } from '@janus-agent/janus-agent/tools/contracts/project'

export type ProjectResult<T> = { success: true; data: T } | { success: false; error: string }
export type ProjectCommandResult = { success: true } | { success: false; error: string }

export interface ProjectAPI {
  detect(projectPath: string): Promise<ProjectResult<{ type: ProjectType }>>
  detectWithDetails(projectPath: string): Promise<ProjectResult<DetectResult>>
  readConfig(projectPath: string): Promise<ProjectResult<LaunchConfig | null>>
  writeConfig(projectPath: string, config: LaunchConfig): Promise<ProjectCommandResult>
  createDefaultConfig(projectPath: string, projectType: ProjectType, projectName: string): Promise<ProjectResult<LaunchConfig>>
  validateConfig(config: LaunchConfig): Promise<ProjectResult<ValidationResult>>
  test(projectPath: string, script?: string): Promise<ProjectResult<ProjectTaskResult>>
  run(projectPath: string, configName?: string, options?: ProjectRunOptions): Promise<ProjectResult<ProjectRunResult>>
  stop(projectId: string): Promise<ProjectCommandResult>
  list(): Promise<ProjectResult<RunningProjectSummary[]>>
  get(projectId: string): Promise<ProjectResult<RunningProjectDetail>>
  schemas(): Promise<ProjectResult<ProjectTypeSchema[]>>
}
