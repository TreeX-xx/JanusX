import { ipcMain } from 'electron'
import { HOSTED_CHANNELS, type CreateReviewInput, type HostedTarget, type HostedQuery, type HostedItemKind, type HostedMutation } from '../../shared/ipc/hosted'
import { detectProvider, hostedConnection } from '../hosted/github'
import { worktreeMetaStore } from '../git/worktree-meta'
import { resolveHostedRepository, repositoryOverview, repositoryImage, browseRepository, repositoryDetail, repositoryDiscussion, mutateRepository } from '../hosted/repository'
import { startHostedLogin, readHostedLogin, inputHostedLogin, stopHostedLogin, stopHostedLoginsForOwner } from '../hosted/login'

export function registerHostedHandlers(): void {
  ipcMain.handle(HOSTED_CHANNELS.repository, (_event, workspacePath: string) => resolveHostedRepository(workspacePath))
  ipcMain.handle(HOSTED_CHANNELS.overview, (_event, target: HostedTarget) => repositoryOverview(target))
  ipcMain.handle(HOSTED_CHANNELS.image, (_event, target: HostedTarget, path: string, ref: string) => repositoryImage(target, path, ref))
  ipcMain.handle(HOSTED_CHANNELS.browse, (_event, target: HostedTarget, query: HostedQuery) => browseRepository(target, query))
  ipcMain.handle(HOSTED_CHANNELS.detail, (_event, target: HostedTarget, kind: HostedItemKind, number: number) => repositoryDetail(target, kind, number))
  ipcMain.handle(HOSTED_CHANNELS.discussion, (_event, target: HostedTarget, kind: HostedItemKind, number: number, page: number) => repositoryDiscussion(target, kind, number, page))
  ipcMain.handle(HOSTED_CHANNELS.mutate, (_event, target: HostedTarget, mutation: HostedMutation) => mutateRepository(target, mutation))
  const loginOwners = new Set<number>()
  ipcMain.handle(HOSTED_CHANNELS.loginStart, async (event, workspacePath: string) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Sign-in requires the application frame')
    const owner = event.sender.id
    if (!loginOwners.has(owner)) {
      loginOwners.add(owner)
      event.sender.once('destroyed', () => { stopHostedLoginsForOwner(owner); loginOwners.delete(owner) })
    }
    const session = await startHostedLogin(workspacePath, owner)
    if (event.sender.isDestroyed()) stopHostedLoginsForOwner(owner)
    return session
  })
  ipcMain.handle(HOSTED_CHANNELS.loginRead, (event, id: string) => readHostedLogin(id, event.sender.id))
  ipcMain.handle(HOSTED_CHANNELS.loginInput, (event, id: string, data: string) => inputHostedLogin(id, data, event.sender.id))
  ipcMain.handle(HOSTED_CHANNELS.loginStop, (event, id: string) => stopHostedLogin(id, event.sender.id))
  ipcMain.handle(HOSTED_CHANNELS.connection, async (_event, { workspacePath }: { workspacePath: string }) => {
    return hostedConnection(workspacePath)
  })
  ipcMain.handle(HOSTED_CHANNELS.detect, async (_event, { workspacePath }: { workspacePath: string }) => {
    const provider = await detectProvider(workspacePath)
    return provider?.id ?? null
  })

  ipcMain.handle(
    HOSTED_CHANNELS.listReviews,
    async (_event, { workspacePath, branch }: { workspacePath: string; branch: string }) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) return []
      return provider.listReviews(workspacePath, branch)
    },
  )

  ipcMain.handle(
    HOSTED_CHANNELS.checks,
    async (_event, { workspacePath, branch }: { workspacePath: string; branch: string }) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) return []
      return provider.getChecks(workspacePath, branch)
    },
  )

  ipcMain.handle(
    HOSTED_CHANNELS.failedLogs,
    async (_event, { workspacePath, branch }: { workspacePath: string; branch: string }) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) return []
      return provider.getFailedLogs(workspacePath, branch)
    },
  )

  ipcMain.handle(HOSTED_CHANNELS.createReview, async (_event, input: CreateReviewInput) => {
    const provider = await detectProvider(input.workspacePath)
    if (!provider) throw new Error('当前仓库未接入托管平台')
    const review = await provider.createReview(input.workspacePath, {
      title: input.title,
      body: input.body,
      base: input.base,
      head: input.head,
      draft: input.draft,
    })
    // Bind the review onto the worktree meta; never fails creation.
    if (input.worktreePath && Number.isFinite(review.number)) {
      const existing = await worktreeMetaStore.get(input.worktreePath).catch(() => null)
      await worktreeMetaStore
        .set(input.worktreePath, {
          startFrom: existing?.startFrom ?? input.base,
          branch: existing?.branch ?? input.head,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          provider: provider.id,
          ...(existing?.linkedIssue ? { linkedIssue: existing.linkedIssue } : {}),
          linkedReview: review.number,
          pushTarget: `origin/${input.head}`,
        })
        .catch(() => undefined)
    }
    return review
  })

  ipcMain.handle(
    HOSTED_CHANNELS.mergeReview,
    async (
      _event,
      {
        workspacePath,
        number,
        method,
      }: { workspacePath: string; number: number; method?: 'squash' | 'merge' | 'rebase' },
    ) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) throw new Error('当前仓库未接入托管平台')
      return provider.mergeReview(workspacePath, number, method)
    },
  )

  ipcMain.handle(
    HOSTED_CHANNELS.listIssues,
    async (_event, { workspacePath, query }: { workspacePath: string; query?: string }) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) return []
      return provider.listIssues(workspacePath, query)
    },
  )

  ipcMain.handle(
    HOSTED_CHANNELS.listComments,
    async (_event, { workspacePath, number }: { workspacePath: string; number: number }) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) return []
      return provider.listComments(workspacePath, number)
    },
  )

  ipcMain.handle(
    HOSTED_CHANNELS.postComment,
    async (_event, { workspacePath, number, body }: { workspacePath: string; number: number; body: string }) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) throw new Error('当前仓库未接入托管平台')
      return provider.postComment(workspacePath, number, body)
    },
  )

  ipcMain.handle(
    HOSTED_CHANNELS.setAutoMerge,
    async (
      _event,
      { workspacePath, number, enable }: { workspacePath: string; number: number; enable: boolean },
    ) => {
      const provider = await detectProvider(workspacePath)
      if (!provider) throw new Error('当前仓库未接入托管平台')
      return provider.setAutoMerge(workspacePath, number, enable)
    },
  )
}
