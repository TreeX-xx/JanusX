import { describe, expect, it } from 'vitest'
import { messageRounds } from '../../src/renderer/src/components/janus/SuperAgentReply'
import { linkedHighlight } from '../../src/renderer/src/components/janus/SuperAgentPresentation'
import { normalizeMessageContext } from '../../src/shared/conversation-context'
import { normalizeJanusChatSnapshot, type JanusChatMessage } from '../../src/shared/ipc/janus-chat'
import { normalizeConversationTopic } from '../../src/shared/conversation-topics'
import { readWorkspaceFileDragData, setWorkspaceFileDragData, clearWorkspaceFileDragData } from '../../src/renderer/src/lib/terminal-file-reference'

const context = { text: 'Check this', references: [{ id:'ref',name:'file.ts',path:'/repo/file.ts',kind:'file' as const,quote:'const active = true' }] }
const message = (id: string, role: 'user' | 'assistant'): JanusChatMessage => ({ id,role,content:id,timestamp:1 })

describe('SuperAgent presentation identities and persisted context', () => {
  it('groups steering inputs with their reply, ignores reports, and keeps later rounds distinct', () => {
    const rounds = messageRounds([message('a','user'),message('b','user'),message('reply','assistant'),message('worker-report:1','assistant'),message('c','user'),message('last','assistant')])
    expect(rounds.get('reply')).toEqual({id:'a',inputIds:['a','b']})
    expect(rounds.get('last')).toEqual({id:'c',inputIds:['c']})
    expect(rounds.has('worker-report:1')).toBe(false)
    expect(linkedHighlight({roundId:'a',workIds:['work']},{roundId:'c',workIds:['work']})).toBe(false)
    expect(linkedHighlight({workIds:['work']},{roundId:'c',workIds:['work']})).toBe(true)
    expect(linkedHighlight({roundId:'a',workIds:[]},{roundId:'a',workIds:[]})).toBe(true)
  })
  it('preserves compact context on reload and excludes it from assistant messages', () => {
    const user = {...message('a','user'),content:'Check this file: /repo/file.ts',context}
    const selected = {providerId:'provider',modelId:'selected'}
    const snapshot = normalizeJanusChatSnapshot({ version:1,activeConversationId:'root',conversations:[{id:'root',title:'Chat',createdAt:1,updatedAt:1,superAgentModel:selected,messages:[user,{...message('b','assistant'),context}]}] })!
    expect(snapshot.conversations[0].superAgentModel).toEqual(selected)
    expect(snapshot.conversations[0].messages[0]).toEqual(user)
    expect(snapshot.conversations[0].messages[1].context).toBeUndefined()
    const topic = normalizeConversationTopic({rootId:'root',workspaceId:'repo',state:'ready',base:[user],inputs:[{message:user,state:'queued'}]})!
    expect(topic.base[0].context).toEqual(context)
    expect(topic.inputs[0].message.context).toEqual(context)
  })
  it('rejects malformed or oversized metadata without losing the expanded prompt', () => {
    for (const invalid of [null, {text:1,references:[]}, {...context,references:[{...context.references[0],quote:3}]}]) {
      expect(normalizeMessageContext(invalid)).toBeUndefined()
    }
    const normalized = normalizeMessageContext({...context,references:[{...context.references[0],bytes:[1,2],inline:true}]})!
    expect(normalized).toEqual(context)
    const references = Array.from({ length: 12 }, (_, index) => ({ ...context.references[0], id: String(index) }))
    expect(normalizeMessageContext({ ...context, references })?.references).toEqual(references)
  })
  it('preserves code quotes in the shared workspace drag payload', () => {
    const values = new Map<string,string>()
    const transfer = {setData:(key:string,value:string)=>values.set(key,value),getData:(key:string)=>values.get(key)??''} as DataTransfer
    try {
      setWorkspaceFileDragData(transfer,{type:'file',name:'file.ts',path:'src\\file.ts',workspacePath:'/repo',quote:context.references[0].quote})
      expect(readWorkspaceFileDragData(transfer)).toMatchObject({path:'src/file.ts',quote:'const active = true'})
    } finally { clearWorkspaceFileDragData() }
  })
})
