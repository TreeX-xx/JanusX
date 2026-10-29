import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Layers, Monitor, TerminalSquare } from 'lucide-react'
import { useLocale } from './i18n'
import type { DockerTarget, EnvironmentState } from '../shared/docker'

export function EnvironmentSelect({ environment, disabled, onSelect }: {
  environment: EnvironmentState; disabled: boolean; onSelect(target: DockerTarget): void
}) {
  const t = useLocale(), id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [active, setActive] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 })
  const target = environment.target, value = target.kind === 'wsl' ? `wsl:${target.distribution}` : target.kind
  const names = environment.distributions.map(item => item.name)
  if (target.kind === 'wsl' && !names.includes(target.distribution)) names.push(target.distribution)
  const options = [
    { value: 'local', label: t('existingDocker'), description: t('localEnvironmentSummary'), icon: Monitor, group: '' },
    ...(environment.windows ? [
      ...names.map(name => ({ value: `wsl:${name}`, label: name, description: t('wslEnvironmentSummary'), icon: TerminalSquare, group: t('existingWsl') })),
      { value: 'managed', label: t('dedicatedEnvironment'), description: t('managedEnvironmentSummary'), icon: Layers, group: '' },
    ] : []),
  ]
  const selectedIndex = Math.max(0, options.findIndex(item => item.value === value)), selected = options[selectedIndex], Icon = selected.icon
  const expanded = open && !disabled
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const show = () => { if (!disabled) { setActive(selectedIndex); setOpen(true) } }
  const choose = (index: number) => {
    const item = options[index]; if (!item) return
    setOpen(false); trigger.current?.focus()
    if (item.value !== value) onSelect(item.value.startsWith('wsl:') ? { kind: 'wsl', distribution: item.value.slice(4) } : { kind: item.value as 'local' | 'managed' })
  }
  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect(), gap = 6, edge = 8
      const below = window.innerHeight - rect.bottom - gap - edge, above = rect.top - gap - edge
      const height = Math.min(340, options.length * 58 + (names.length ? 56 : 24))
      const up = below < height && above > below, maxHeight = Math.max(0, Math.min(height, up ? above : below))
      const width = Math.min(rect.width, window.innerWidth - edge * 2)
      setPosition({ top: up ? rect.top - gap - maxHeight : rect.bottom + gap, left: Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)), width, maxHeight })
    }
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place() }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true) }
  }, [expanded, options.length, names.length])
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [expanded])
  useEffect(() => { if (expanded) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [expanded, active, id])
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!expanded) { show(); return }
      setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (expanded) choose(active); else show()
    } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
  }
  return <>
    <button ref={trigger} className="environment-trigger" type="button" role="combobox" aria-label={t('environment')} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded ? `${id}-${active}` : undefined} disabled={disabled} onKeyDown={keyboard} onBlur={() => setOpen(false)} onClick={() => { if (expanded) setOpen(false); else show() }}>
      <Icon size={17}/><span className="environment-option-copy"><strong title={selected.label}>{selected.label}</strong><small>{selected.description}</small></span><ChevronDown size={14} className="environment-chevron"/>
    </button>
    {expanded && createPortal(<div ref={menu} id={id} role="listbox" aria-label={t('environment')} className="environment-menu" style={position} onPointerDown={event => event.preventDefault()}>
      {options.map((item, index) => {
        const ItemIcon = item.icon
        return <div key={item.value}>
          {item.group && options[index - 1]?.group !== item.group && <div className="environment-group">{item.group}</div>}
          {item.value === 'managed' && <div className="environment-separator"/>}
          <div role="option" id={`${id}-${index}`} aria-selected={item.value === value} data-active={index === active} className="environment-option" onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
            <ItemIcon size={16}/><span className="environment-option-copy"><strong title={item.label}>{item.label}</strong><small>{item.description}</small></span>{item.value === value && <Check size={14} className="environment-check"/>}
          </div>
        </div>
      })}
    </div>, document.body)}
  </>
}
