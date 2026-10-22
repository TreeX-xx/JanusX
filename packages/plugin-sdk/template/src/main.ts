import { connectPlugin, type PluginApi } from '@janusx/plugin-sdk'
import './style.css'

const status = document.querySelector<HTMLParagraphElement>('#status')!
const content = document.querySelector<HTMLPreElement>('#content')!
const remember = document.querySelector<HTMLButtonElement>('#remember')!
const controller = new AbortController()
let unsubscribe: (() => void) | undefined

// The same bundle previews independently and connects only inside an authorized host.
async function start(api: PluginApi) {
  const options = { signal: controller.signal }
  const context = await api.workspace.getContext(options)
  status.textContent = context.project?.name ?? 'No project context'
  if (!location.pathname.endsWith('summary.html')) {
    const file = await api.workspace.readText({ path: 'README.md' }, options)
    content.textContent = file.text
  }
  const watch = await api.storage.watch({ keys: ['project-name'] }, (values) => {
    if (values['project-name']?.found) content.textContent = String(values['project-name'].value)
  }, options)
  unsubscribe = watch.unsubscribe
  if (controller.signal.aborted) { unsubscribe(); return }
  if (watch.values['project-name']?.found) content.textContent = String(watch.values['project-name'].value)
  remember.disabled = false
  remember.onclick = () => {
    void api.storage.set({ key: 'project-name', value: context.project?.name ?? '' }, options)
      .catch((error: Error) => { status.textContent = error.message })
  }
}

if (window.parent !== window || window.location.protocol === 'janusx-plugin:') void connectPlugin().then(start).catch((error: Error) => { status.textContent = error.message })
else status.textContent = 'Standalone preview. Import this built directory in JanusX to use authorized project data.'
window.addEventListener('pagehide', () => { controller.abort(); unsubscribe?.() }, { once: true })
