import React from 'react'
import { createRoot } from 'react-dom/client'

const params = new URLSearchParams(location.search)
if (params.get('plugin') === 'cpa') await import('../../../plugins/cpa/src/ui/style.css')
else await import('../../../plugins/docker/src/ui/style.css')
document.documentElement.dataset.theme = params.get('theme') ?? 'white'

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 24, minHeight: '100%', background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}>
    <h1>Plugin native controls</h1>
    <nav>{['white', 'dark', 'planche'].map(theme => <button key={theme} onClick={() => { document.documentElement.dataset.theme = theme }}>{theme}</button>)}</nav>
    <label>Endpoint <input defaultValue="http://127.0.0.1:8317" /></label>
    <label>Mode <select defaultValue="local"><option value="local">Local</option><option value="remote">Remote</option></select></label>
    <label>Date <input type="date" defaultValue="2026-11-03" /></label>
  </main>,
)
