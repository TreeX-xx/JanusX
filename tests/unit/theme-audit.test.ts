import { describe, expect, it } from 'vitest'
// @ts-expect-error Build-time script is JavaScript, outside the app's TS compilation.
import { scanThemeSources, classifyFindings } from '../../scripts/theme-audit.mjs'

describe('theme audit', () => {
  it('scans plugin declarations while treating SVG selector attributes as identities', () => {
    const findings = scanThemeSources([
      { path: 'packages/plugin-sdk/theme.css', source: ':root { --shell-text: #fff; }' },
      { path: 'plugins/example/style.css', source: '[fill="#abc"] { fill: var(--shell-text); color: #123456; }' },
    ])
    expect(findings).toEqual([expect.objectContaining({ path: 'plugins/example/style.css', value: '#123456' })])
  })
  it('finds CSS, JSX and dynamic template colors with source locations, skipping comments', () => {
    const findings = scanThemeSources([
      { path: 'panel.css', source: '/* #fff */\n.p { background: #123456; color: rgba(0, 0, 0, .2); }\n[data-theme="custom"] .p {}' },
      { path: 'panel.tsx', source: '// #fff\nconst node = <div className={`bg-black/60 ${active ? "text-white" : "text-[var(--shell-text)]"}`} style={{ color: "#abcdef" }} />' },
      { path: 'tokens.css', source: ':root { --shell-text: #123; }' },
    ])
    expect(findings.filter((f: any) => f.value === '#fff')).toHaveLength(0)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'panel.css', line: 2, column: 18, value: '#123456' }),
      expect.objectContaining({ kind: 'theme-selector', value: 'custom' }),
      expect.objectContaining({ value: 'bg-black/60' }),
      expect.objectContaining({ value: 'text-white' }),
      expect.objectContaining({ value: '#abcdef' }),
    ]))
    expect(findings.some((f: any) => f.kind === 'undefined-variable')).toBe(false)
  })

  it('reports missing variables, including fallbacks, without claiming cascade coverage', () => {
    expect(scanThemeSources([{ path: 'a.css', source: '.a { color: var(--missing, white); }' }]))
      .toEqual([expect.objectContaining({ kind: 'undefined-variable', value: '--missing' })])
    expect(scanThemeSources([{ path: 'a.ts', source: 'const color = `var(--usage-${name})`' }])).toEqual([])
  })

  it('allows generated theme values but reports literal colors in components', () => {
    const findings = scanThemeSources([
      { path: 'src/renderer/src/styles/themes.generated.css', source: ':root { --shell-text: #fff; }' },
      { path: 'a.tsx', source: 'const style = { color: "var(--shell-text)", background: "black" }' },
    ])
    expect(findings).toEqual([expect.objectContaining({ value: 'black', kind: 'literal-color' })])
  })

  it('blocks new values and extra occurrences; exceptions require a reason and count', () => {
    const findings = scanThemeSources([{ path: 'a.css', source: '.a { color: #fff; background: #fff; border-color: #abc; }' }])
    const baseline = { legacy: { 'a.css': { 'literal-color:#fff': 1 } }, exceptions: [] }
    expect(classifyFindings(findings, baseline).map((f: any) => f.status)).toEqual(['legacy', 'new', 'new'])
    const allowed = { legacy: {}, exceptions: [{ path: 'a.css', key: 'literal-color:#fff', count: 1, reason: 'Document canvas' }] }
    expect(classifyFindings(findings, allowed).map((f: any) => f.status)).toEqual(['exception', 'new', 'new'])
    allowed.exceptions[0].reason = ''
    expect(classifyFindings(findings, allowed)[0].status).toBe('new')
  })
})
