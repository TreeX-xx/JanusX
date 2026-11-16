import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, FileText, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './SuperAgentParallel.module.css'

export type ParallelView = 'panes' | 'history' | 'conversation'
type Phase = 'preparing' | 'splitting' | 'analyzing' | 'gathering' | 'held' | 'merging' | 'merged'

/** Layout only: every pane continues to render its real conversation controller.
 * Reading modes: .agents/notes/agent/superagent-interface.md#多输入话题与调度
 */
export function SuperAgentParallel({ id, active, busy, attention, continued, branches, toolbarHost, onViewChange, locating, children }: {
  id: string; active: boolean; busy: boolean; attention: boolean; continued: boolean
  branches: Array<{id:string;title:string}>; toolbarHost: HTMLDivElement | null
  onViewChange(id:string,view:ParallelView):void; children: ReactNode[]
  locating: {id:string;version:number;after:boolean}|null
}) {
  const { t } = useTranslation('janus')
  const [phase,setPhase]=useState<Phase>(active && busy && !continued ? 'preparing':'merged')
  const [history,setHistory]=useState(false),[selected,setSelected]=useState(0),[width,setWidth]=useState(0)
  const [ratios,setRatios]=useState({x:.5,y:.5})
  const root=useRef<HTMLDivElement>(null),reading=useRef(false),positions=useRef<number[]>([])
  const intentionalMerge=useRef(false)
  const inspected=useRef(false)
  const current=useRef({attention,history,branches});current.current={attention,history,branches}
  const drag=useRef<{axis:'x'|'y';pointerId:number}|null>(null)
  const view:ParallelView=phase==='merged'?'conversation':history?'history':'panes'
  const narrow=width>0 && (width<620 || branches.length>4),rows=branches.length>2?2:1
  const moving=['preparing','splitting','gathering','merging'].includes(phase)
  const protect=()=>{reading.current=true;if(phase==='merging'&&!intentionalMerge.current)setPhase('held')}
  useLayoutEffect(()=>{
    const element=root.current
    if (!element) return
    const observer=new ResizeObserver(()=>setWidth(element.clientWidth))
    observer.observe(element);setWidth(element.clientWidth)
    return()=>observer.disconnect()
  },[])
  useEffect(()=>{
    if (!active) {setPhase('merged');return}
    if(busy&&['gathering','held','merging'].includes(phase)){intentionalMerge.current=false;setPhase('analyzing');return}
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches
    let next:Phase|undefined,delay=0
    if (phase==='preparing') {next='splitting';delay=350}
    if (phase==='splitting') {next='analyzing';delay=reduced?0:560}
    if (phase==='analyzing' && !busy) {next='gathering';delay=0}
    if (phase==='gathering') delay=650
    if (phase==='merging') {next='merged';delay=reduced?300:1000}
    if (!next && phase!=='gathering') return
    const timer=setTimeout(()=>setPhase(phase==='gathering'
      ? reading.current || current.current.attention || current.current.history ? 'held':'merging' : next!),delay)
    return()=>clearTimeout(timer)
  },[active,phase,busy])
  useLayoutEffect(()=>{
    if(!active||inspected.current)return
    inspected.current=true
    if(phase==='preparing'&&root.current?.closest<HTMLElement>('.janus-chat-messages')?.dataset.following==='false'){
      reading.current=true;setHistory(true)
    }
  },[active,phase])
  useLayoutEffect(()=>{if(active)onViewChange(id,view)},[active,id,onViewChange,view])
  useLayoutEffect(()=>{
    if (view!=='panes') return
    const bodies=root.current?.querySelectorAll<HTMLElement>('[data-topic-body]')
    if (!reading.current) bodies?.forEach(body=>{body.scrollTop=body.scrollHeight})
  },[children,view])
  const showHistory=()=>{
    positions.current=[...root.current!.querySelectorAll<HTMLElement>('[data-topic-body]')].map(body=>body.scrollTop)
    protect();setHistory(true)
  }
  const returnFromHistory=()=>{
    setHistory(false)
    requestAnimationFrame(()=>root.current?.querySelectorAll<HTMLElement>('[data-topic-body]').forEach((body,index)=>{body.scrollTop=positions.current[index]??0}))
  }
  useLayoutEffect(()=>{
    if(!active||!locating)return
    reading.current=true
    const message=root.current?.querySelector(`[data-user-message="${CSS.escape(locating.id)}"]`)
    if(message){
      const topicId=message.closest<HTMLElement>('[data-topic-id]')?.dataset.topicId
      const index=current.current.branches.findIndex(branch=>branch.id===topicId)
      if(index>=0)setSelected(index)
      setHistory(false)
    }else setHistory(!locating.after)
  },[active,locating])
  const merge=()=>{intentionalMerge.current=true;protect();setHistory(false);setPhase('merging')}
  const resize=(axis:'x'|'y',value:number)=>setRatios(previous=>({...previous,[axis]:Math.max(.35,Math.min(.65,value))}))
  const separator=(axis:'x'|'y')=><div className={axis==='x'?styles.columnDivider:styles.rowDivider} role="separator"
    aria-label={t(axis==='x'?'topics.resizeColumns':'topics.resizeRows')} aria-orientation={axis==='x'?'vertical':'horizontal'}
    aria-valuemin={35} aria-valuemax={65} aria-valuenow={Math.round(ratios[axis]*100)} tabIndex={0}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();protect();drag.current={axis,pointerId:event.pointerId};event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId)}}
    onPointerMove={event=>{if(!drag.current||!event.currentTarget.hasPointerCapture(event.pointerId))return;const rect=root.current!.querySelector('[data-parallel-grid]')!.getBoundingClientRect();resize(axis,axis==='x'?(event.clientX-rect.left)/rect.width:(event.clientY-rect.top)/rect.height)}}
    onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);drag.current=null}}
    onLostPointerCapture={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}
    onDoubleClick={()=>resize(axis,.5)} onKeyDown={event=>{const keys=axis==='x'?['ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown'];if(![...keys,'Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();protect();resize(axis,event.key==='Home'?.5:ratios[axis]+(event.key===keys[1]?.05:-.05))}} />
  return <div ref={root} className={styles.stage} data-parallel-section="" data-parallel-stage={id} data-phase={phase} data-view={view}
    data-settled={!busy} data-narrow={narrow} data-rows={rows} aria-label={t('topics.parallelRunning')}
    onWheelCapture={protect} onPointerDownCapture={event=>{if((event.target as Element).closest('[data-topic-body]'))protect()}}
    onFocusCapture={event=>{if((event.target as Element).closest('[data-parallel-grid]'))protect()}}
    onKeyDownCapture={event=>{if(['PageUp','Home','ArrowUp'].includes(event.key))protect()}}
    onMouseUp={()=>{if(!getSelection()?.isCollapsed)protect()}}>
    {active&&view!=='conversation'&&toolbarHost&&createPortal(<div className={styles.toolbar}>
      {history?<button type="button" onClick={returnFromHistory}><ArrowLeft size={13}/>{t('topics.backToAnalysis')}</button>
        :<button type="button" onClick={showHistory}><FileText size={13}/>{t('topics.history')}</button>}
    </div>,toolbarHost)}
    {narrow&&view==='panes'&&<nav className={styles.tabs} aria-label={t('topics.selectBranch')}>
      {branches.map((branch,index)=><button key={branch.id} type="button" aria-pressed={selected===index} aria-controls={'topic-'+branch.id} onClick={()=>{protect();setSelected(index)}}>{branch.title}</button>)}
    </nav>}
    <div className={styles.grid} data-parallel-grid="" hidden={view==='history'} data-expanded={!['preparing','merging'].includes(phase)}
      style={{'--parallel-left':ratios.x+'fr','--parallel-right':1-ratios.x+'fr','--parallel-top':ratios.y+'fr','--parallel-bottom':1-ratios.y+'fr'} as CSSProperties}>
      {branches.map((branch,index)=><div className={styles.pane} key={branch.id} hidden={view==='panes'&&narrow&&selected!==index}
        {...(view==='panes'&&narrow&&selected!==index?{inert:''}:{})}
        style={view==='panes'&&!narrow?{gridColumn:index%2*2+1,gridRow:Math.floor(index/2)*2+1}:undefined}>{children[index]}</div>)}
      {view==='panes'&&!narrow&&<>{separator('x')}{rows===2&&separator('y')}</>}
    </div>
    {view==='panes'&&<div className={styles.status} role="status" aria-live="polite" data-busy={moving}>
      {moving&&<LoaderCircle size={13} className={styles.spinner}/>}
      <span>{t(phase==='held'&&attention?'topics.analysisNeedsAttention':'topics.phase.'+phase)}</span>
      {phase==='held'&&<button type="button" data-parallel-merge="" onClick={merge}>{t('topics.returnUnified')}<ArrowRight size={13}/></button>}
    </div>}
  </div>
}
