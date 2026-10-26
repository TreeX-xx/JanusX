import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
const store = new ReviewStore(process.argv[2])
const service = new SuggestionService(store, Date.now, 0)
process.on('message', (request: { id: number; method: string; args: unknown[] }) => {
  try {
    if (request.method === 'exit') { store.close(); process.exit(0) }
    const method = service[request.method as keyof SuggestionService] as (...args: unknown[]) => unknown
    const result = method.apply(service, request.args)
    process.send?.({ id: request.id, result })
  } catch (error) { process.send?.({ id: request.id, error: (error as Error).message }) }
})
process.send?.({ ready: true })
