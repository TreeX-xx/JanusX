// Note: .agents/notes/blueprint/navigation/module.md — preserve the original card shell while Notes are read.
import { CardSkeleton, cardIndexStyle } from './CardFrame'
import type { ReactNode } from 'react'
import { t } from './i18n'

export function WorkbenchLoading({ detailOpen, diagnostics }: { detailOpen: boolean; diagnostics?: ReactNode }) {
  return <>
    <div className="blueprint-workbench-toolbar blueprint-workbench-toolbar--loading"><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /><div className="blueprint-toolbar__spacer" />{diagnostics}</div>
    <div className="blueprint-workbench-body" data-detail-open={detailOpen ? 'true' : 'false'} data-janus-open="false" aria-busy="true">
      <div className="blueprint-workbench-detail-slot" data-open={detailOpen ? 'true' : 'false'} style={cardIndexStyle(1)}>
        {detailOpen && <aside className="note-detail bp-node-detail" data-visible="true"><CardSkeleton lines={7} label={t('正在读取原文…')} /></aside>}
      </div>
      <section className="blueprint-workbench-card blueprint-workbench-card--canvas" style={cardIndexStyle(detailOpen ? 2 : 1)}>
        <div className="blueprint-canvas-main blueprint-canvas-main--loading" role="status" aria-label={t('正在读取工作区…')}>
          <div className="blueprint-canvas-loading" />
        </div>
      </section>
    </div>
  </>
}
