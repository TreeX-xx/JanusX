import { z } from 'zod'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { automationInputSchema, isReminder, reminderTemplate, type AutomationDraft } from '../../shared/automations'
import { automationService } from './host'

export const REMINDER_CHAT_PROMPT = `When the user asks for a recurring reminder or notification, use automation_reminder to create an actual draft, including without a project. Do not just describe how to create it or claim it is active. Infer name and notification message from the request; minutes are integers (one hour = 60). Use daily/weekdays/weekly plus HH:mm for wall-clock schedules. Ask only for essential missing information. Tool receipts distinguish drafts from saved schedules. Creation and edits require Save/Enable in the right panel. For changes to existing reminders, list first and use their exact id and revision; do not guess the target. To revise an unsaved draft, send its complete revised configuration. Unsupported actions and schedules must be explained, not silently replaced. General agent automation beyond code review is not available yet.`

const parameters = z.object({
  action: z.enum(['list', 'propose']), id: z.string().optional(), revision: z.number().int().optional(),
  name: z.string().trim().min(1).max(120).optional(), message: z.string().trim().min(1).max(2000).optional(),
  schedule: z.enum(['interval', 'daily', 'weekdays', 'weekly', 'manual']).optional(),
  intervalMinutes: z.number().int().min(1).max(10080).optional(), time: z.string().optional(),
  timezone: z.string().optional(), weekday: z.number().int().min(0).max(6).optional(), enabled: z.boolean().optional(),
}).strict()

export function attachReminderChatTools(ports: ChatTurnPorts, signal: AbortSignal, onDraft: (draft: AutomationDraft) => void): void {
  let pending: AutomationDraft | undefined
  ports.localTools = [...(ports.localTools ?? []), {
    name: 'automation_reminder', executionMode: 'sequential',
    description: 'List reminders or propose/create/update a notification reminder draft. No project or model is needed to run reminders. Never saves or enables by itself. For pause propose enabled=false with saved id and revision. Application must remain running.',
    parameters,
    execute: async (call, toolSignal) => {
      try {
        signal.throwIfAborted(); toolSignal.throwIfAborted()
        const args = parameters.parse(call.arguments)
        const service = await automationService()
        if (args.action === 'list') return { content: JSON.stringify({ reminders: service.list().filter(isReminder), pending }) }
        const previous = args.id ? service.list().find(card => card.id === args.id && isReminder(card)) : undefined
        if (args.id && (!previous || previous.revision !== args.revision)) throw new Error('revision_conflict: list reminders and use the current revision')
        const { action: _action, id: _id, revision: _revision, message, ...patch } = args
        const schedule = patch.schedule ?? (patch.intervalMinutes ? 'interval' : previous?.schedule)
        if (!schedule) throw new Error('Ask the user for the reminder schedule')
        const changingSchedule = !previous || previous.schedule !== schedule
        if (changingSchedule && schedule === 'interval' && !patch.intervalMinutes) throw new Error('Interval minutes are required')
        if (changingSchedule && ['daily', 'weekdays', 'weekly'].includes(schedule) && !patch.time) throw new Error('Ask the user for the reminder time')
        if (changingSchedule && schedule === 'weekly' && patch.weekday === undefined) throw new Error('A weekday is required')
        const base = previous ? service.input(previous) : reminderTemplate(message)
        const input = automationInputSchema.parse({ ...base, ...patch, schedule, enabled: previous ? patch.enabled ?? previous.enabled : false,
          tasks: [{ id: 'notify', kind: 'notification', message: message ?? base.tasks[0].message }] })
        signal.throwIfAborted(); toolSignal.throwIfAborted()
        pending = { input, id: previous?.id, revision: previous?.revision }; onDraft(pending)
        return { content: JSON.stringify({ draft: pending, saved: false, message: 'Draft ready. Review and Save/Enable in the automation panel. Runs only while JanusX is running.' }) }
      } catch (error) { return { content: error instanceof Error ? error.message : String(error), isError: true } }
    },
  }]
}
