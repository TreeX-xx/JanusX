// Real Electron smoke: production toast controller/component/CSS in an isolated host.
// Config storage and renderer routing are replaced; notification rendering is not.
import { build } from 'esbuild'
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve('artifacts/desktop-toast-visual')
await mkdir(join(root, 'main/chunks'), { recursive: true })
await mkdir(join(root, 'preload'), { recursive: true })
await mkdir(join(root, 'renderer'), { recursive: true })
await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'
    import {DesktopToastApp} from './src/renderer/src/components/DesktopToastApp'
    import './src/renderer/src/styles/globals.css'
    import './src/renderer/src/styles/themes.generated.css'
    createRoot(document.getElementById('root')).render(<DesktopToastApp />)
  ` },
  bundle: true, outfile: join(root, 'renderer/toast.js'), jsx: 'automatic',
  alias: { '@': resolve('src/renderer/src') },
  loader: { '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const html = (await readFile('src/renderer/index.html', 'utf8'))
  .replace('<title>JanusX</title>', '<title>JanusX Toast Visual Test</title><link rel="stylesheet" href="./toast.css">')
  .replace('./src/main.tsx', './toast.js')
await writeFile(join(root, 'renderer/index.html'), html)
await build({ entryPoints: ['src/preload/index.ts'], bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: join(root, 'preload/index.mjs') })
await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import {app, BrowserWindow, ipcMain} from 'electron'
    import {desktopToastWindow} from './src/main/notifications/desktop-toast-window'
    import {THEME_CHANNELS} from './src/shared/ipc/theme'
    app.setPath('userData', ${JSON.stringify(join(root, 'profile'))})
    globalThis.toastTheme = 'dark'
    ipcMain.handle(THEME_CHANNELS.get, () => globalThis.toastTheme)
    globalThis.toastTest = {controller: desktopToastWindow, errors: [], shown: [], frames: []}
    app.whenReady().then(() => { globalThis.toastTest.ready = true })
    app.on('window-all-closed', e => e.preventDefault())
  ` },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(root, 'main/chunks/smoke.cjs'),
  plugins: [{ name: 'isolated-toast-host', setup(b) {
    b.onLoad({ filter: /[/\\]config[/\\]service\.ts$/ }, () => ({ contents: 'export const configService = {getCachedTheme: () => globalThis.toastTheme}', loader: 'ts' }))
    b.onLoad({ filter: /[/\\]windows[/\\]renderer-loader\.ts$/ }, () => ({ contents: `
      import {join} from 'node:path'
      export const loadRendererWindow = (win, configure, query) => win.loadFile(join(__dirname, '../../renderer/index.html'), {query})
    `, loader: 'ts' }))
  } }],
})

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const application = await electron.launch({ args: [join(root, 'main/chunks/smoke.cjs')], env })
const results = []
try {
  const show = async (id, theme, timeoutMs = 5000) => application.evaluate(({ BrowserWindow }, { id, theme, timeoutMs }) => {
    globalThis.toastTheme = theme
    return globalThis.toastTest.controller.show({ id, type: 'completed', engine: 'Visual test', title: id, body: 'Rounded notification transparency check', createdAt: new Date().toISOString() }, {
      timeoutMs, onShown: async () => {
        if (id.includes('-repeat-')) {
          for (let index = 0; index < 6; index++) {
            const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
            const {width, height} = image.getSize()
            const bitmap = image.toBitmap()
            const pixel = (x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
            globalThis.toastTest.frames.push({id, index, corners: [pixel(0,0), pixel(width-1,0), pixel(0,height-1), pixel(width-1,height-1)], center: pixel(20,20)})
            await new Promise(r => setTimeout(r, 16))
          }
        }
        globalThis.toastTest.shown.push(id)
      }, onError: error => globalThis.toastTest.errors.push({ id, error }),
    })
  }, { id, theme, timeoutMs })
  const waitShown = async id => {
    const limit = Date.now() + 10000
    while (Date.now() < limit) {
      if (await application.evaluate((_, id) => globalThis.toastTest.shown.includes(id), id)) return
      await new Promise(r => setTimeout(r, 20))
    }
    throw Error('Not shown: ' + id)
  }
  const sample = async (id, theme) => {
    const result = await application.evaluate(async ({ BrowserWindow }, id) => {
      const win = BrowserWindow.getAllWindows()[0]
      const image = await win.webContents.capturePage()
      const { width, height } = image.getSize()
      const bitmap = image.toBitmap()
      const pixel = (x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
      const style = await win.webContents.executeJavaScript(`({title:document.querySelector('section')?.textContent, theme:document.documentElement.dataset.theme, html:getComputedStyle(document.documentElement).backgroundColor, body:getComputedStyle(document.body).backgroundColor, card:getComputedStyle(document.querySelector('section')).backgroundColor, animation:getComputedStyle(document.querySelector('section')).animationName})`)
      return { id, visible: win.isVisible(), width, height, corners: [pixel(0,0), pixel(width-1,0), pixel(0,height-1), pixel(width-1,height-1)], center: pixel(20,20), style, png: image.toPNG().toString('base64') }
    }, id)
    await writeFile(join(root, id + '.png'), Buffer.from(result.png, 'base64'))
    delete result.png
    results.push(result)
    assert.equal(result.visible, true)
    assert.equal(result.style.theme, theme)
    assert.ok(result.style.title.includes(id))
    assert.equal(result.style.animation, 'none')
    // The CSS drop shadow reaches the corners; a faint shadow is expected,
    // whereas an opaque white/gray rectangle has alpha 255.
    assert.ok(result.corners.every(p => p[3] < 64), JSON.stringify(result))
    assert.equal(result.center[3], 255)
  }
  for (const theme of ['dark', 'planche']) {
    for (let i = 0; i < 12; i++) {
      const id = `${theme}-repeat-${i}`
      await show(id, theme)
      await waitShown(id)
      await sample(id, theme)
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("window.electron.desktopToast.action('dismiss')"))
      const deadline = Date.now() + 3000
      while (await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) {
        assert.ok(Date.now() < deadline, 'Dismiss timed out: ' + id)
        await new Promise(r => setTimeout(r, 20))
      }
    }
    for (let i = 0; i < 20; i++) await show(`${theme}-burst-${i}`, theme)
    await waitShown(`${theme}-burst-19`)
    await sample(`${theme}-burst-19`, theme)
  }
  await show('automatic-timeout', 'dark', 250)
  await waitShown('automatic-timeout')
  const hideDeadline = Date.now() + 3000
  while (await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) {
    assert.ok(Date.now() < hideDeadline, 'Automatic hide timed out')
    await new Promise(r => setTimeout(r, 20))
  }
  const frames = await application.evaluate(() => globalThis.toastTest.frames)
  assert.equal(frames.length, 144)
  for (const frame of frames) {
    assert.ok(frame.corners.every(p => p[3] < 64), 'Opaque early-frame corner: ' + JSON.stringify(frame))
    assert.equal(frame.center[3], 255, 'Blank early frame: ' + JSON.stringify(frame))
  }
  const errors = await application.evaluate(() => globalThis.toastTest.errors)
  assert.deepEqual(errors, [])
  await writeFile(join(root, 'results.json'), JSON.stringify({ results, frames, errors }, null, 2))
  console.log(`PASS: ${results.length} captured images, ${frames.length} early frame samples; 24 hide/reopen cycles, 40 burst replacements, automatic hide; translucent corners and opaque themed cards.`)
  // Optional bounded observation period for Windows Graphics Capture.
  if (process.env.JANUSX_TOAST_VISUAL_HOLD === '1') {
    const theme = process.env.JANUSX_TOAST_VISUAL_THEME === 'planche' ? 'planche' : 'dark'
    await show('Windows compositor observation', theme, 55000)
    await waitShown('Windows compositor observation')
    console.log('OBSERVATION_READY')
    await new Promise(r => setTimeout(r, 50000))
  }
} finally {
  await writeFile(join(root, 'samples.json'), JSON.stringify(results, null, 2))
  await application.close()
}
