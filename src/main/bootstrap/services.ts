import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { subscribeWorkspaceWatcher } from '../ipc/handlers'
import { OfficeArtifactIndex } from '../office/office-artifact-index'
import { OfficeWatchPool } from '../office/office-watch-pool'
import { releaseRemoteOfficePreviews } from '../office/remote-office-cache'
import { createRegisteredWorkspaceRootResolver } from '../office/office-workspace-guard'

export function createApplicationServices(getOfficeWindows: () => BrowserWindow[]) {
  const resolveOfficeWorkspaceRoot = createRegisteredWorkspaceRootResolver(
    join(app.getPath('userData'), 'janusx', 'workspaces'),
  )
  const broadcast = (channel: string, event: unknown) => {
    for (const window of getOfficeWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(channel, event)
    }
  }
  const officeWatchPool = new OfficeWatchPool(resolveOfficeWorkspaceRoot, {
    onEvicted: (event) => { releaseRemoteOfficePreviews(event.previewLeaseIds); broadcast('office:watch-evicted', event) },
  })
  const officeArtifactIndex = new OfficeArtifactIndex(resolveOfficeWorkspaceRoot, {
    subscribe: subscribeWorkspaceWatcher,
    onChanged: (event) => broadcast('office:files:changed', event),
  })

  return { resolveOfficeWorkspaceRoot, officeWatchPool, officeArtifactIndex }
}
