import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from './WorkbenchIcons'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element, Root } from 'hast'
import type { NoteBodySource } from './note-body'
const MARKDOWN_COMPONENTS: Components = { img: ({ alt }) => <span>[{alt ?? 'Image'}]</span> }
import { blueprintText as t } from './blueprint-text'

// Note: keep one Markdown tree so references and fenced code survive folding — see .agents/notes/blueprint/documents/module.md
function sectionize() {
  return (tree: Root) => {
    const headings = tree.children.filter((node): node is Element => node.type === 'element' && /^h[1-6]$/.test(node.tagName))
    if (!headings.length) return
    const depth = headings.some(node => node.tagName === 'h2') ? 2 : Math.min(...headings.map(node => Number(node.tagName[1])))
    const children: Root['children'] = []
    let section: Element | undefined
    for (const node of tree.children) {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName) && Number(node.tagName[1]) <= depth
        && !(node === headings[0] && node.tagName === 'h1' && depth === 2)) {
        section = { type: 'element', tagName: 'details', properties: { className: ['bp-note-chapter'], open: true },
          children: [{ type: 'element', tagName: 'summary', properties: {}, children: [node] }] }
        children.push(section)
      } else if (section && node.type !== 'doctype') section.children.push(node)
      else children.push(node)
    }
    tree.children = children
  }
}

export function revealNoteElement(target: HTMLElement) {
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
  }
  target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}

export function NoteMarkdown({ source, link }: { source: NoteBodySource; link?: Components['a'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const contents = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const contentsId = useId()
  const hasContents = source.view.headings.length > 1
  const [contentsOpen, setContentsOpen] = useState(false)
  const [activeAnchor, setActiveAnchor] = useState('')
  useEffect(() => {
    const menu = contents.current
    if (!menu) return
    menu.setAttribute('popover', 'auto')
    menu.hidePopover()
    const toggled = () => setContentsOpen(menu.matches(':popover-open'))
    const closeOnScroll = (event: Event) => { if (event.target instanceof Node && !menu.contains(event.target)) menu.hidePopover() }
    const closeOnResize = () => menu.hidePopover()
    menu.addEventListener('toggle', toggled)
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', closeOnResize)
    return () => {
      menu.removeEventListener('toggle', toggled)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [source.uri, hasContents])
  const showContents = () => {
    const menu = contents.current, button = trigger.current
    if (!menu || !button) return
    if (menu.matches(':popover-open')) { menu.hidePopover(); return }
    const rect = button.getBoundingClientRect(), width = Math.min(320, ref.current?.clientWidth ?? 320, window.innerWidth - 24)
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12, useBelow = below >= 200 || below >= above
    const height = Math.min(340, Math.max(100, useBelow ? below : above))
    menu.style.width = width + 'px'
    menu.style.maxHeight = height + 'px'
    menu.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px'
    menu.style.top = (useBelow ? rect.bottom + 6 : 12) + 'px'
    menu.showPopover()
    // maxHeight is only a limit; a short menu must still meet its trigger
    // when review expansion leaves room only above the button.
    if (!useBelow) menu.style.top = Math.max(12, rect.top - menu.offsetHeight - 6) + 'px'
    menu.querySelector<HTMLButtonElement>('nav button')?.focus({ preventScroll: true })
  }
  const components = useMemo(() => {
    const headings: Components = {}
    for (const Tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      headings[Tag] = ({ node, children }) => <Tag data-note-anchor={source.view.headings.find(heading => heading.line === node?.position?.start.line)?.anchor}>{children}</Tag>
    }
    return { ...MARKDOWN_COMPONENTS, ...headings, ...(link ? { a: link } : {}) }
  }, [source.view.headings, link])
  const fold = (open: boolean) => { ref.current?.querySelectorAll<HTMLDetailsElement>('.bp-note-chapter').forEach(section => { section.open = open }) }
  return <div ref={ref} className="bp-note-reader">
    {hasContents && <div className="bp-note-reader__tools">
      <button ref={trigger} type="button" className="bp-note-toc-trigger" aria-label={t('reader.contents')} aria-expanded={contentsOpen} aria-controls={contentsId} aria-haspopup="dialog" onClick={showContents}><ChevronRight className="bp-disclosure-chevron" size={14} aria-hidden="true" />{t('reader.contents')}</button>
      <div ref={contents} id={contentsId} className="bp-note-toc" role="dialog" aria-label={t('reader.contents')} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); contents.current?.hidePopover(); trigger.current?.focus() }
      }}><header><strong>{t('reader.contents')}</strong><span>{source.view.headings.length}</span><button type="button" className="bp-reader-card__icon" aria-label={t('attention.close')} onClick={() => { contents.current?.hidePopover(); trigger.current?.focus() }}><X size={14} aria-hidden="true" /></button></header><nav aria-label={t('reader.contents')}>
        {source.view.headings.map(heading => <button type="button" key={heading.anchor} aria-current={activeAnchor === heading.anchor ? 'location' : undefined} style={{ paddingInlineStart: 10 + (heading.depth - 1) * 12 }} onClick={() => {
          const target = [...(ref.current?.querySelectorAll<HTMLElement>('[data-note-anchor]') ?? [])].find(node => node.dataset.noteAnchor === heading.anchor)
          setActiveAnchor(heading.anchor); contents.current?.hidePopover(); trigger.current?.focus({ preventScroll: true })
          if (target) revealNoteElement(target)
        }}>{heading.text}</button>)}
      </nav></div>
      <div className="bp-note-reader__fold-actions">
        <button type="button" className="bp-reader-card__icon" title={t('reader.expandAll')} aria-label={t('reader.expandAll')} onClick={() => fold(true)}><ChevronsUpDown size={16} aria-hidden="true" /></button>
        <button type="button" className="bp-reader-card__icon" title={t('reader.collapseAll')} aria-label={t('reader.collapseAll')} onClick={() => fold(false)}><ChevronsDownUp size={16} aria-hidden="true" /></button>
      </div>
    </div>}
    <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[sectionize]}
      urlTransform={url => url.startsWith('note://') ? url : defaultUrlTransform(url)} components={components}>{source.body}</ReactMarkdown></div>
  </div>
}
