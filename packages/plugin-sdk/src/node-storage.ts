/**
 * @file 安全持久化原语
 * @description 供主进程 JSON/NDJSON 存储层复用的写安全基础设施：
 *              - writeFileAtomic：temp + rename 原子写，防止退出/崩溃时文件截断
 *              - SerialQueue：promise 链写队列，串行化读-改-写，防止并发丢更新
 *              - ReentrantAsyncLock：基于 AsyncLocalStorage 的可重入异步锁，
 *                供内部方法互相调用的存储类（如 BlueprintStore）整体串行化
 *              模式与 companion/binding-store.ts、knowledge/audit-service.ts 一致。
 */

import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, data)
  await rename(temporaryPath, filePath)
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => operation())
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export class ReentrantAsyncLock {
  private readonly holding = new AsyncLocalStorage<true>()
  private readonly queue = new SerialQueue()

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.holding.getStore()) return operation()
    return this.queue.run(() => this.holding.run(true, operation))
  }
}
