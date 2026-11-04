import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const automationTaskSchema = z.object({
  id, kind: z.enum(['git', 'command', 'agent.internal', 'agent.cli', 'artifact', 'notification']),
  message: z.string().trim().min(1).max(2000).optional(),
  input: z.string().max(128).optional(), prompt: z.string().max(8000).optional(),
  command: z.literal('diff-check').optional(),
}).strict()
export const automationInputSchema = z.object({
  cardId: id.optional(),
  name: z.string().trim().min(1).max(120), workspaceId: z.union([id, z.literal('')]),
  branch: z.string().min(1).max(200).regex(/^(?!-)[a-zA-Z0-9_./-]+$/),
  enabled: z.boolean(), timezone: z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
  }),
  schedule: z.enum(['manual', 'daily', 'weekdays', 'weekly', 'interval']),
  intervalMinutes: z.number().int().min(1).max(10080).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weekday: z.number().int().min(0).max(6),
  providerId: z.string().max(128), modelId: z.string().max(128),
  // Persisted legacy field: these are execution steps within one independently scheduled task.
  tasks: z.array(automationTaskSchema).min(1).max(12),
}).strict().superRefine((value, context) => {
  if (value.schedule === 'interval' && !value.intervalMinutes) context.addIssue({ code: 'custom', message: 'Interval minutes are required' })
  if (value.tasks.some(task => task.kind === 'notification')) {
    if (value.tasks.length !== 1 || !value.tasks[0].message || value.tasks[0].input || value.workspaceId)
      context.addIssue({ code: 'custom', message: 'A reminder requires exactly one notification with a message, no input binding and no project' })
    return
  }
  if (!value.workspaceId) context.addIssue({ code: 'custom', message: 'A project is required for code review' })
  const seen = new Set<string>()
  value.tasks.forEach((task, index) => {
    if (seen.has(task.id) || (index > 0 && (!task.input || !seen.has(task.input))))
      context.addIssue({ code: 'custom', message: 'Tasks require unique IDs and an earlier output binding' })
    seen.add(task.id)
    if ((task.kind === 'git') !== (index === 0) || (task.kind === 'artifact') !== (index === value.tasks.length - 1))
      context.addIssue({ code: 'custom', message: 'Git must be first and artifact must be last' })
    if (task.kind === 'command' && task.command !== 'diff-check') context.addIssue({ code: 'custom', message: 'Only the diff-check template is available' })
  })
  if (!value.tasks.some(task => task.kind.startsWith('agent.'))) context.addIssue({ code: 'custom', message: 'A review task is required' })
  if (value.tasks.some(task => task.kind === 'agent.internal') && (!value.providerId || !value.modelId)) context.addIssue({ code: 'custom', message: 'Select a model for the internal Agent' })
})
export type AutomationInput = z.infer<typeof automationInputSchema>
export const automationCardInputSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict()
export interface AutomationCard { id: string; name: string; revision: number; createdAt: string }
export interface AutomationDefinition extends AutomationInput {
  id: string; revision: number; root: string; createdAt: string; nextRunAt: string | null
}
export interface AutomationCursor { commit: string; epoch: number; partialCount: number; attention: boolean; lastRunId?: string; explicitBaseline?: boolean }
export const reviewSchema = z.object({
  summary: z.string().max(16000), coveredFiles: z.array(z.string()).max(500),
  incomplete: z.boolean(), findings: z.array(z.object({
    severity: z.enum(['info', 'warning', 'error']), category: z.string().max(120),
    path: z.string().max(1024), line: z.number().int().positive(),
    evidence: z.string().max(4000), suggestion: z.string().max(4000),
  }).strict()).max(200),
}).strict()
export type AutomationReview = z.infer<typeof reviewSchema>
export interface AutomationReport extends AutomationReview {
  base: string; head: string; ruleVersion: string; files: string[]; skipped: string[];
  checks: Array<{ taskId: string; command: string; output: string; passed: boolean }>;
  verdict: 'clean' | 'findings' | 'incomplete'
}
export interface AutomationRun {
  message?: string;
  id: string; definitionId: string; occurrenceKey: string; trigger: 'manual' | 'scheduled';
  state: 'queued' | 'running' | 'needs_attention' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';
  snapshot: AutomationDefinition; startedAt: string; finishedAt?: string; reason?: string;
  cursor: AutomationCursor; head?: string; report?: AutomationReport; cursorCommitted?: boolean; cursorApplied?: boolean; notified?: boolean;
  tasks: Array<{ id: string; state: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'; output?: string }>;
}
export interface AutomationPreview { root: string; head: string; base: string; files: string[]; noChanges: boolean }
export interface AutomationDraft { input: AutomationInput; id?: string; revision?: number }
export interface AutomationsAPI {
  listCards(): Promise<AutomationCard[]>;
  saveCard(name: string, id?: string, revision?: number): Promise<AutomationCard>;
  removeCard(id: string, revision: number): Promise<void>;
  list(): Promise<AutomationDefinition[]>;
  save(input: AutomationInput, id?: string, revision?: number, baseline?: string): Promise<AutomationDefinition>;
  preview(input: AutomationInput, id?: string, baseline?: string): Promise<AutomationPreview>;
  run(id: string, requestKey: string): Promise<AutomationRun>;
  cancel(id: string): Promise<void>;
  remove(id: string, revision: number): Promise<void>;
  history(id: string): Promise<AutomationRun[]>;
  onChanged(callback: () => void): () => void;
  onRemoved(callback: (id: string) => void): () => void;
  onDraft(callback: (draft: AutomationDraft) => void): () => void;
  onCompleted(callback: (run: AutomationRun) => void): () => void;
  onFocus(callback: (run: AutomationRun) => void): () => void;
}
export function dailyReviewTemplate(workspaceId = ''): AutomationInput {
  return { name: '每日增量代码质量审查', workspaceId, branch: 'main', enabled: false,
    timezone: 'Asia/Shanghai', schedule: 'daily', time: '21:00', weekday: 1, providerId: '', modelId: '',
    tasks: [{ id: 'range', kind: 'git' }, { id: 'review', kind: 'agent.internal', input: 'range',
      prompt: '检查重复逻辑、模块耦合、异常处理、资源生命周期和测试缺口。区分新增问题与存量债务。只报告有证据的问题。' },
    { id: 'report', kind: 'artifact', input: 'review' }] }
}
export function reminderTemplate(message = ''): AutomationInput {
  return { name: message.slice(0, 120) || '提醒', workspaceId: '', branch: 'main', enabled: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, schedule: 'interval', intervalMinutes: 1,
    time: '09:00', weekday: 1, providerId: '', modelId: '', tasks: [{ id: 'notify', kind: 'notification', message }] }
}
export function isReminder(input: Pick<AutomationInput, 'tasks'>): boolean {
  return input.tasks.length === 1 && input.tasks[0].kind === 'notification'
}
export const AUTOMATIONS_CHANNELS = { listCards: 'automations:cards:list', saveCard: 'automations:cards:save', removeCard: 'automations:cards:remove', list: 'automations:list', save: 'automations:save', preview: 'automations:preview', run: 'automations:run', cancel: 'automations:cancel', remove: 'automations:remove', history: 'automations:history', changed: 'automations:changed', removed: 'automations:removed', draft: 'automations:draft', completed: 'automations:completed', focus: 'automations:focus' } as const
