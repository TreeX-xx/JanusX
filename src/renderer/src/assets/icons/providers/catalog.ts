import openai from '../codex.svg'

const files = import.meta.glob<string>('./*.{svg,png}', { eager: true, import: 'default' })
const logos = new Map([['openai', openai]])
for (const [file, url] of Object.entries(files)) {
  const slug = file.slice(2, file.lastIndexOf('.')).replace(/-color$/, '')
  logos.set(slug, url)
}

const aliases = new Map([['moonshotai', 'moonshot'], ['meta-llama', 'meta']])

export function catalogVendorLogo(vendor: string): string | undefined {
  const slug = vendor.toLowerCase().replace(/^~/, '')
  return logos.get(aliases.get(slug) ?? slug)
}
