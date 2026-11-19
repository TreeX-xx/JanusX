import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import release from '../../plugins/superagent/release.json' with { type: 'json' }

/** Exercise plugin-backed desktop flows with the official package in the test profile. */
export async function enableSuperAgentPlugin(application: ElectronApplication, page: Page) {
  const id = 'official.superagent'
  const installed = await page.evaluate(async id => {
    const result = await window.electron.plugins.request({ type: 'list' })
    if (!result.ok) throw new Error(result.code)
    return (result.data as import('../../src/shared/ipc/plugins').PluginHostSnapshot).plugins.find(plugin => plugin.manifest.id === id)
  }, id)
  if (installed?.enabled) return
  if (!installed) await importSuperAgentPlugin(application, page)
  expect(await page.evaluate(id => window.electron.plugins.request({ type: 'enable', id }), id)).toMatchObject({ ok: true })
}

async function importSuperAgentPlugin(application: ElectronApplication, page: Page) {
  const filename = basename(release.url)
  const version = basename(new URL('.', release.url).pathname).replace(/^v/, '')
  const archive = resolve('release', version, filename)
  if (existsSync(archive)) {
    const selectFile = await application.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
    try {
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, archive)
      expect(await page.evaluate(() => window.electron.plugins.request({ type: 'importPackage' }))).toMatchObject({ ok: true })
    } finally {
      await application.evaluate(({ dialog }, original) => { dialog.showOpenDialog = original }, selectFile)
      await selectFile.dispose()
    }
  } else {
    expect(await page.evaluate(() => window.electron.plugins.request({ type: 'catalogRefresh' }))).toMatchObject({ ok: true })
    expect(await page.evaluate(() => window.electron.plugins.request({ type: 'installOfficial', id: 'official.superagent' }))).toMatchObject({ ok: true })
  }
}
