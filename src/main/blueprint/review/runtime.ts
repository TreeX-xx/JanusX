// Desktop composition; the review domain belongs to the downloadable blueprint package.
import { app } from 'electron'
import { join } from 'node:path'
import { BlueprintReviewRuntime } from '../../../../plugins/blueprint/src/main/blueprint/review/service'
import { blueprintReviewModels } from './models'
import { WorkspaceSuggestionSources } from '../../../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { harnessNoteService } from '../../harness/service'
import { ReviewWorkspaceTracker } from '../../../../plugins/blueprint/src/main/blueprint/review/workspace-tracker'
import type { ReviewContext } from '../../../../plugins/blueprint/src/shared/blueprint-review'
export { BlueprintReviewRuntime } from '../../../../plugins/blueprint/src/main/blueprint/review/service'
let instance: BlueprintReviewRuntime | undefined
export function blueprintReviewRuntime(): BlueprintReviewRuntime {
  return instance ??= new BlueprintReviewRuntime(join(app.getPath('userData'), 'janusx', 'blueprint'), blueprintReviewModels, new WorkspaceSuggestionSources(harnessNoteService))
}
export async function shutdownBlueprintReview(): Promise<void> { workspaceTracker.stop(); await instance?.shutdown() }
const workspaceTracker = new ReviewWorkspaceTracker<ReviewContext>(
  root => blueprintReviewRuntime().sources.context(root),
  async context => {
    const runtime = blueprintReviewRuntime()
    runtime.automatic.watch(context.workspacePath)
    await runtime.reading.read(context)
  },
  root => instance?.automatic.unwatch(root),
)
export function trackBlueprintReviewWorkspace(root: string, active: boolean): void {
  workspaceTracker.track(root, active)
}
