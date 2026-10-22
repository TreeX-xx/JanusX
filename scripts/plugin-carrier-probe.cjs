// Historical iframe experiment, superseded by the native carrier in src/main/plugins/runtime.ts.
// Note: .agents/notes/workbench/plugin-contract-v1.md — run with Electron, never the user's application profile.
const { app, BrowserWindow, protocol, session } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
protocol.registerSchemesAsPrivileged([{ scheme: 'janusx-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const results = {}
  const partition = session.fromPartition(`plugin-probe-${Date.now()}`, { cache: false })
  partition.protocol.handle('janusx-plugin', (request) => {
    const script = new URL(request.url).pathname.endsWith('.js')
    return new Response(script ? 'window.moduleLoaded = true' : '<html><script type="module" src="./entry.js"></script><body>Plugin probe</body></html>', { headers: {
      'Content-Type': script ? 'text/javascript' : 'text/html',
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "default-src 'none'; script-src janusx-plugin:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
    } })
  })
  const host = new BrowserWindow({ show: false, webPreferences: { session: partition, sandbox: true, nodeIntegration: false, contextIsolation: true } })
  await host.loadURL('data:text/html,<html><body>Host<iframe sandbox="allow-scripts" src="janusx-plugin://probe/g/1/index.html"></iframe></body></html>')
  const frame = host.webContents.mainFrame.frames[0]
  results.module = await frame.executeJavaScript('new Promise(r => { const t = setInterval(() => { if(window.moduleLoaded) { clearInterval(t); r(true) } }, 20); setTimeout(() => { clearInterval(t); r(false) }, 2000) })')
  results.hostProcess = host.webContents.mainFrame.processId
  results.pluginProcess = frame.processId
  results.noNode = await frame.executeJavaScript('typeof require === "undefined" && typeof process === "undefined" && typeof window.electron === "undefined"')
  results.opaqueOrigin = await frame.executeJavaScript('self.origin === "null"')
  results.sameProcess = results.hostProcess === results.pluginProcess
  let navigationBlocked = false
  host.webContents.on('will-frame-navigate', (event) => { if (!event.isMainFrame) { navigationBlocked = true; event.preventDefault() } })
  await frame.executeJavaScript('location.href="https://example.invalid/"; true')
  await new Promise(r => setTimeout(r, 300))
  results.navigationBlocked = navigationBlocked && frame.url.startsWith('janusx-plugin:')
  host.destroy()
  mkdirSync(resolve('artifacts/plugin-p2'), { recursive: true })
  writeFileSync(resolve('artifacts/plugin-p2/carrier-probe.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
