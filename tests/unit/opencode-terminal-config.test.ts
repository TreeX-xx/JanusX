import { expect, it } from 'vitest'
import { openCodeTerminalConfig } from '../../src/main/terminal/opencode-conversation'

it('disables native tabs for a managed terminal without changing process configuration', () => {
  const before = process.env.OPENCODE_CLI_CONFIG_CONTENT
  expect(JSON.parse(openCodeTerminalConfig())).toEqual({ tabs: { enabled: false, mode: 'off' } })
  expect(process.env.OPENCODE_CLI_CONFIG_CONTENT).toBe(before)
})

it('preserves unrelated CLI preferences and accepts native JSONC syntax', () => {
  const content = '{ /* existing options */ "theme": "flexoki", "keybinds": { "leader": "ctrl+a" }, "tabs": { "mode": "on", "enabled": true, "layout": "vertical", }, }'
  expect(JSON.parse(openCodeTerminalConfig(content))).toEqual({ theme: 'flexoki', keybinds: { leader: 'ctrl+a' }, tabs: { mode: 'off', enabled: false, layout: 'vertical' } })
})

it.each(['{', '[]', 'null', '{"tabs":true}'])('rejects malformed configuration without silently replacing it: %s', content => {
  expect(() => openCodeTerminalConfig(content)).toThrow('Invalid OPENCODE_CLI_CONFIG_CONTENT')
})
