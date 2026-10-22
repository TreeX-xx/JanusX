import type { KnowledgeRecallTrace } from '../../../../shared/knowledge'
import {
  dismissKnowledgePeek,
  EMPTY_ISLAND_KNOWLEDGE_PEEK,
  hideKnowledgePeek,
  invalidateKnowledgePeek,
  receiveKnowledgeTrace,
  replayKnowledgePeek,
  type IslandKnowledgePeekState,
} from './islandKnowledgePeek'
import type { IslandStage } from './islandInteraction'

export interface IslandControllerState {
  stage: IslandStage
  knowledge: IslandKnowledgePeekState
}

export const INITIAL_ISLAND_CONTROLLER_STATE: IslandControllerState = {
  stage: 'collapsed',
  knowledge: EMPTY_ISLAND_KNOWLEDGE_PEEK,
}

export function shouldPresentProductNotice(
  stage: IslandStage,
  noticeWorkspaceId: string | null,
  activeWorkspaceId: string | null,
): boolean {
  // peek 包含在内：产物落盘必须能从知识 peek 手里接管一级胶囊，
  // 否则知识召回进行中到达的产物通知会被静默吞掉。
  return (stage === 'collapsed' || stage === 'peek')
    && noticeWorkspaceId !== null
    && noticeWorkspaceId === activeWorkspaceId
}

export type IslandControllerAction =
  | { type: 'trace'; trace: KnowledgeRecallTrace | null }
  | { type: 'single-activate' }
  | { type: 'double-activate' }
  | { type: 'plugin-peek' }
  | { type: 'dismiss' }
  | { type: 'timeout'; version: number }
  | { type: 'product-notice' }
  | { type: 'product-expire' }
  | { type: 'invalidate' }
  | { type: 'terminal-changed' }

export function reduceIslandController(
  state: IslandControllerState,
  action: IslandControllerAction,
): IslandControllerState {
  switch (action.type) {
    case 'trace': {
      const knowledge = receiveKnowledgeTrace(state.knowledge, action.trace, state.stage)
      if (knowledge === state.knowledge) return state
      return {
        stage: knowledge.presentation === 'knowledge' && state.stage === 'collapsed' ? 'peek' : state.stage,
        knowledge,
      }
    }
    case 'single-activate': {
      if (state.stage === 'expanded') return state
      if (state.stage === 'peek') {
        return { stage: 'collapsed', knowledge: hideKnowledgePeek(state.knowledge) }
      }
      const knowledge = replayKnowledgePeek(state.knowledge, state.stage)
      return knowledge === state.knowledge ? state : { stage: 'peek', knowledge }
    }
    case 'double-activate':
      return {
        stage: state.stage === 'expanded' ? 'collapsed' : 'expanded',
        knowledge: hideKnowledgePeek(state.knowledge),
      }
    case 'plugin-peek':
      return { stage: 'peek', knowledge: hideKnowledgePeek(state.knowledge) }
    case 'dismiss':
      if (state.stage === 'collapsed') return state
      return { stage: 'collapsed', knowledge: hideKnowledgePeek(state.knowledge) }
    case 'timeout': {
      const knowledge = dismissKnowledgePeek(state.knowledge, action.version, state.stage)
      return knowledge === state.knowledge ? state : { stage: 'collapsed', knowledge }
    }
    case 'product-notice':
      return state.stage === 'collapsed' || state.stage === 'peek'
        ? { stage: 'peek', knowledge: hideKnowledgePeek(state.knowledge) }
        : state
    case 'product-expire':
      // Capsule-only expiry: the sticky notice stays alive so a later island
      // click still opens the product (Titlebar owns the store consumption).
      return state.stage === 'peek'
        ? { stage: 'collapsed', knowledge: hideKnowledgePeek(state.knowledge) }
        : state
    case 'invalidate':
      return {
        stage: state.stage === 'peek' ? 'collapsed' : state.stage,
        knowledge: invalidateKnowledgePeek(state.knowledge),
      }
    case 'terminal-changed':
      return state.stage === 'expanded'
        ? { stage: 'collapsed', knowledge: hideKnowledgePeek(state.knowledge) }
        : state
  }
}
