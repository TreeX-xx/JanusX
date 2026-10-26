import { ipcMain } from 'electron'
import { getStatus, getLog, stage, unstage, discard, getCommitChanges, commit, push, pull, getFileBaseline } from '../git/service'

import { GIT_CHANNELS } from '../../shared/ipc/git'

export function registerGitHandlers(): void {
  ipcMain.handle(GIT_CHANNELS.status, async (_event, cwd: string) => {
    const status = getStatus(cwd)
    return status
  })

  ipcMain.handle(GIT_CHANNELS.log, async (_event, cwd: string, maxCount?: number) => {
    const log = getLog(cwd, maxCount)
    return log
  })

  ipcMain.handle(GIT_CHANNELS.stage, async (_event, cwd: string, paths: string[]) => {
    await stage(cwd, paths)

    return getStatus(cwd)
  })

  ipcMain.handle(GIT_CHANNELS.unstage, async (_event, cwd: string, paths: string[]) => {
    await unstage(cwd, paths)

    return getStatus(cwd)
  })

  ipcMain.handle(GIT_CHANNELS.discard, async (_event, cwd: string, relativePath: string) => {
    const status = await discard(cwd, relativePath)

    return status
  })

  ipcMain.handle(GIT_CHANNELS.commitChanges, (_event, cwd: string, hash: string) => getCommitChanges(cwd, hash))

  ipcMain.handle(GIT_CHANNELS.commit, async (_event, cwd: string, message: string) => {
    await commit(cwd, message)

    return getStatus(cwd)
  })

  ipcMain.handle(GIT_CHANNELS.push, async (_event, cwd: string) => {
    await push(cwd)

  })

  ipcMain.handle(GIT_CHANNELS.pull, async (_event, cwd: string) => {
    await pull(cwd)

  })

  ipcMain.handle(GIT_CHANNELS.fileBaseline, (_event, cwd: string, relativePath: string) =>
    getFileBaseline(cwd, relativePath)
  )
}
