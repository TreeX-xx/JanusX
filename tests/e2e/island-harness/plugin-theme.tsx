import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, Background, MiniMap } from '@xyflow/react'
import { BlueprintNodeCard } from '../../../plugins/blueprint/src/ui/BlueprintNodeCard'
import type { BlueprintRFNodeType } from '../../../plugins/blueprint/src/ui/BlueprintNodeCard'
import '@xyflow/react/dist/style.css'
import '../../../plugins/blueprint/src/ui/style.css'
import '../../../plugins/blueprint/src/ui/blueprint.css'

const theme = new URLSearchParams(location.search).get('theme') ?? 'white'
document.documentElement.dataset.theme = theme
const nodes: BlueprintRFNodeType[] = [
  { id: 'one', type: 'blueprint', position: { x: 40, y: 60 }, data: { title: 'White theme', status: 'in-progress', nodeType: 'task', progress: 65 } },
  { id: 'two', type: 'blueprint', position: { x: 360, y: 60 }, data: { title: 'Shared palette', status: 'done', nodeType: 'task', progress: 100 } },
]
createRoot(document.getElementById('app')!).render(<main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
  <header style={{ padding: 20, display: 'flex', gap: 12 }}>
    <strong>Blueprint · theme integration</strong>
    {['dark', 'planche', 'white'].map(id => <button key={id} onClick={() => { document.documentElement.dataset.theme = id }}>{id}</button>)}
  </header>
  <div className="blueprint-view" style={{ flex: 1 }}>
    <ReactFlow nodes={nodes} nodeTypes={{ blueprint: BlueprintNodeCard }} fitView>
      <Background color="var(--shell-border)" />
      <MiniMap nodeColor="var(--shell-muted)" style={{ background: 'var(--shell-card)' }} />
    </ReactFlow>
  </div>
</main>)
