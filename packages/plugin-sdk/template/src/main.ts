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
  if (context.configurationEditor) {
    remember.hidden = true
    let initial = await api.configuration.get(options)
    const editor = document.createElement('textarea')
    editor.setAttribute('aria-label', 'Configuration patch')
    editor.value = JSON.stringify(initial.overrides, null, 2)
    editor.style.cssText = 'width:100%;min-height:12rem'
    const submit = document.createElement('button')
    submit.textContent = 'Review configuration changes'
    const reload = document.createElement('button')
    reload.textContent = 'Reload configuration'
    reload.onclick = () => {
      void api.configuration.get(options).then(configuration => {
        initial = configuration; editor.value = JSON.stringify(configuration.overrides, null, 2); submit.disabled = false
        status.textContent = 'Configuration reloaded.'
      }).catch((error: Error) => { status.textContent = error.message })
    }
    status.textContent = 'Edit a JSON patch of declared settings. Null restores inheritance. The host reviews and saves.'
    content.after(editor, submit, reload)
    submit.onclick = () => {
      submit.disabled = true
      void Promise.resolve().then(() => api.configuration.propose({ expectedRevision: initial.revision, patch: JSON.parse(editor.value) }, options))
        .then(() => { status.textContent = 'Proposal sent to host settings. Review and save there. Reload configuration before making further changes.'; submit.disabled = false })
        .catch((error: Error) => { status.textContent = error.message; submit.disabled = false })
    }
    return
  }
  if (context.configuration) {
    const display = document.createElement('p')
    display.id = 'configuration'
    status.after(display)
    const show = (value: { values: Record<string, unknown> }) => { display.textContent = JSON.stringify(value.values) }
    const configuration = await api.configuration.watch(show, options)
    show(configuration.configuration)
    if (context.configurationNavigation) {
      const configure = document.createElement('button')
      configure.textContent = 'Configure plugin'
      configure.onclick = () => { void api.configuration.open(options).catch((error: Error) => { status.textContent = error.message }) }
      display.after(configure)
    }
  }
  if (context.document) {
    remember.hidden = true
    const file = await api.documents.readText(options)
    status.textContent = `${file.path} · read-only`
    content.textContent = file.text
    if (context.document.editable) {
      const editor = document.createElement('textarea')
      editor.setAttribute('aria-label', 'Document draft')
      editor.value = file.text
      editor.style.cssText = 'width:100%;min-height:12rem'
      const submit = document.createElement('button')
      submit.textContent = 'Send draft for review'
      content.after(editor, submit)
      status.textContent = `${file.path} · draft editor`
      submit.onclick = () => {
        submit.disabled = true
        void api.documents.applyEdit({ text: editor.value, expectedVersion: file.version }, options).then(() => {
          editor.readOnly = true
          status.textContent = 'Draft kept by JanusX. Review in the built-in editor to save.'
        }).catch((error: Error) => { status.textContent = error.message; submit.disabled = false })
      }
    }
    return
  }
  const navigation = document.createElement('nav')
  for (const [view, title] of [['details', 'Reference'], ['summary', 'Summary'], ['desk', 'Reference desk'], ['island', 'Reference tool']]) {
    const button = document.createElement('button')
    button.textContent = title
    button.onclick = () => { void api.views.open({ view }, options).catch((error: Error) => { status.textContent = error.message }) }
    navigation.append(button)
  }
  remember.after(navigation)
  status.textContent = context.project?.name ?? 'No project context'
  if (!location.pathname.endsWith('summary.html')) {
    const file = await api.workspace.readText({ path: 'README.md' }, options)
    content.textContent = file.text
    await api.island.update({ id: 'reference', status: { title: 'Reference ready', state: 'success', progress: 100, badge: 'README',
      description: context.project?.name ?? 'Project reference',
      preview: { text: file.text.slice(0, 240).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, ' ').trim() || 'README.md',
        rows: [{ label: 'Bytes', value: String(file.bytes) }] } } }, options)
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
