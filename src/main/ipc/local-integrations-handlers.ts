import { ipcMain, shell, type BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { z } from 'zod'
import { LOCAL_INTEGRATION_CHANNELS, LOCAL_INTEGRATION_CLIENTS } from '../../shared/local-integrations'
import type { ResolveWorkspaceRoot } from '../office/office-workspace-guard'
import type { PluginService } from '../plugins/service'
import { LocalIntegrationService } from '../local-integrations/service'
import { probeMcp } from '../local-integrations/probe'

const querySchema = z.object({ client: z.enum(LOCAL_INTEGRATION_CLIENTS), scope: z.enum(['user', 'workspace']), workspaceId: z.string().regex(/^[\w-]{1,128}$/).optional() }).strict()
const idSchema = z.string().min(1).max(256)
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const saveSchema = z.object({ query: querySchema, sourceId: idSchema, entryId: idSchema.optional(), name: z.string().min(1).max(128), content: z.string().max(256 * 1024), expectedRevision: revisionSchema }).strict()

// Note: only trusted application windows may manage local native client files — .agents/notes/workbench/local-skills-mcp.md
export function registerLocalIntegrationHandlers(getAllowedWindows: () => readonly BrowserWindow[], resolveWorkspace: ResolveWorkspaceRoot, getPlugins: () => PluginService | undefined) {
  const service = new LocalIntegrationService({ home: homedir(), env: process.env, resolveWorkspace, plugins: () => getPlugins()?.snapshot().plugins ?? [] })
  const handle = (channel: string, operation: (...args: unknown[]) => Promise<unknown>) => ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame || !getAllowedWindows().some(window => !window.isDestroyed() && window.webContents === event.sender)) throw new Error('Local integration request is not authorized')
    return operation(...args)
  })
  handle(LOCAL_INTEGRATION_CHANNELS.scan, query => service.scan(querySchema.parse(query)))
  handle(LOCAL_INTEGRATION_CHANNELS.read, (query, id) => service.read(querySchema.parse(query), idSchema.parse(id)))
  handle(LOCAL_INTEGRATION_CHANNELS.save, input => service.save(saveSchema.parse(input)))
  handle(LOCAL_INTEGRATION_CHANNELS.reveal, async (query, id) => { shell.showItemInFolder(await service.revealPath(querySchema.parse(query), idSchema.parse(id))) })
  let probing = false
  handle(LOCAL_INTEGRATION_CHANNELS.probe, async (query, id, revision) => {
    if (probing) throw new Error('probe-busy')
    probing = true
    try {
      const { config, cwd } = await service.probeConfiguration(querySchema.parse(query), idSchema.parse(id), revisionSchema.parse(revision))
      return await probeMcp(config, cwd)
    } finally { probing = false }
  })
}
