export type IslandStage = 'collapsed' | 'peek' | 'expanded'
export type IslandInteractionAction = 'replay-knowledge' | 'collapse' | 'expand' | 'none'

const INTERACTIVE_DESCENDANT_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a[href]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(',')

export function isInteractiveIslandDescendant(target: EventTarget | null, island: Element): boolean {
  if (!(target instanceof Element)) return false
  const interactiveElement = target.closest(INTERACTIVE_DESCENDANT_SELECTOR)
  return interactiveElement !== null && interactiveElement !== island && island.contains(interactiveElement)
}

export function getSingleActivationAction(stage: IslandStage): IslandInteractionAction {
  if (stage === 'collapsed') return 'replay-knowledge'
  if (stage === 'peek') return 'collapse'
  return 'none'
}

export function getDoubleActivationAction(stage: IslandStage): IslandInteractionAction {
  return stage === 'expanded' ? 'collapse' : 'expand'
}

export type SingleActivationIntent = 'open-product' | 'default'

/**
 * A live product notice claims the single activation: clicking the island in
 * collapsed or peek stage opens the product workspace directly instead of
 * replaying/collapsing the capsule. The knowledge surface (recall result or
 * empty capsule) keeps its collapse semantics while it presents — the product
 * capsule yields to it visually, so the click must follow what is displayed.
 */
export function getSingleActivationIntent(input: {
  stage: IslandStage
  productNoticeAlive: boolean
  knowledgePresenting: boolean
}): SingleActivationIntent {
  if (input.stage !== 'expanded' && input.productNoticeAlive && !input.knowledgePresenting) {
    return 'open-product'
  }
  return 'default'
}

export function isDoubleTap(previousTapTime: number, now: number, delay: number): boolean {
  return previousTapTime > 0 && now - previousTapTime < delay
}

export interface TapPoint {
  x: number
  y: number
}

export function isDoubleTapWithinTolerance(
  previousTapTime: number,
  now: number,
  delay: number,
  previousPoint: TapPoint | null,
  currentPoint: TapPoint,
  tolerance: number,
): boolean {
  if (!isDoubleTap(previousTapTime, now, delay) || !previousPoint) return false
  return Math.hypot(currentPoint.x - previousPoint.x, currentPoint.y - previousPoint.y) <= tolerance
}
