import { readFile } from 'fs/promises'
import { describe, expect, it } from 'vitest'

describe('side panel collapse UI', () => {
  it('keeps both side panel surfaces mounted during width transitions', async () => {
    const [app, sidebar, globals, rightDock, rightDockStyles] = await Promise.all([
      readFile('src/renderer/src/App.tsx', 'utf8'),
      readFile('src/renderer/src/components/Sidebar.tsx', 'utf8'),
      readFile('src/renderer/src/styles/globals.css', 'utf8'),
      readFile('src/renderer/src/components/right-tools/RightDock.tsx', 'utf8'),
      readFile('src/renderer/src/components/right-tools/RightDock.module.css', 'utf8'),
    ])

    expect(app).toContain('${dockStyles.workbenchGrid}')
    expect(rightDockStyles).toContain('transition: grid-template-columns 240ms')
    expect(sidebar).toContain('className="workspace-sidebar__expanded"')
    expect(sidebar).toMatch(/className=(?:"|\{`)workspace-sidebar__collapsed/)
    expect(sidebar).not.toContain('{!sidebarCollapsed && (')
    expect(sidebar).not.toContain('{sidebarCollapsed && (')
    expect(globals).toContain(".workspace-sidebar[data-collapsed='true'] .workspace-sidebar__expanded")
    expect(rightDock).toContain('data-visible={motion.visible}')
    expect(rightDock).not.toMatch(/\s+hidden=\{!contentVisible\}/)
    expect(rightDockStyles).toContain(".panel[data-visible='false']")
    expect(rightDockStyles).not.toContain('.panel[hidden]')
  })

})
