import { app, ipcMain, Notification, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { AUTOMATIONS_CHANNELS as channels } from '../../shared/automations'
import { AutomationService } from './service'
import { executeAutomationReview } from './executors'
import type { ResolveWorkspaceRoot } from '../office/office-workspace-guard'
import { appShutdown } from '../shutdown/AppShutdown'

let instance: AutomationService | undefined
let ready: Promise<void> | undefined
export async function automationService(): Promise<AutomationService> {
  await ready
  if (!instance) throw new Error('Automation service unavailable')
  return instance
}
export function registerAutomationHandlers(getWindow: () => BrowserWindow | null, resolveWorkspace: ResolveWorkspaceRoot): void {
  const notifications = new Map<string, Set<Notification>>()
  const publish = (channel: string, value?: unknown) => {
    const window = getWindow()
    if (window && !window.webContents.isDestroyed()) window.webContents.send(channel, value)
  }
  instance = new AutomationService(join(app.getPath('userData'), 'janusx', 'automations'), {
    resolveWorkspace, review: executeAutomationReview, changed: () => publish(channels.changed),
    removed: id => {
      for (const notice of notifications.get(id) ?? []) notice.close()
      notifications.delete(id); publish(channels.removed, id)
    },
    completed: run => {
      // These private executors do not use agent-notifier. One owner chooses one surface.
      const window = getWindow()
      if (window?.isVisible() && !window.isMinimized() && !window.webContents.isLoading()) publish(channels.completed, run)
      else if (Notification.isSupported()) {
        const notice = new Notification({ title: run.snapshot.name, body: run.message ?? `${run.state}: ${run.report?.summary.slice(0, 160) ?? run.reason ?? ''}` })
        const group = notifications.get(run.definitionId) ?? new Set<Notification>()
        notifications.set(run.definitionId, group); group.add(notice)
        notice.on('close', () => { group.delete(notice); if (!group.size) notifications.delete(run.definitionId) })
        notice.on('click', () => {
          if (!instance?.list().some(card => card.id === run.definitionId)) return
          const current = getWindow(); current?.show(); current?.focus(); publish(channels.focus, run)
        })
        notice.show()
      }
    },
  })
  ready = instance.initialize()
  void ready.catch(error => console.error('[automations] startup failed', error))
  appShutdown.configure({ stopAutomations: async () => { await instance?.stop() } })
  const handle = (channel: string, action: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted automation caller')
      await ready; return action(...args)
    })
  }
  handle(channels.list, () => instance!.list())
  handle(channels.listCards, () => instance!.listCards())
  handle(channels.saveCard, (...args: Parameters<AutomationService['saveCard']>) => instance!.saveCard(...args))
  handle(channels.removeCard, (...args: Parameters<AutomationService['removeCard']>) => instance!.removeCard(...args))
  handle(channels.save, (...args: Parameters<AutomationService['save']>) => instance!.save(...args))
  handle(channels.preview, (...args: Parameters<AutomationService['preview']>) => instance!.preview(...args))
  handle(channels.run, (id: string, requestKey: string) => instance!.run(id, requestKey))
  handle(channels.history, (id: string) => instance!.history(id))
  handle(channels.cancel, (id: string) => instance!.cancel(id))
  handle(channels.remove, (id: string, revision: number) => instance!.remove(id, revision))
}
