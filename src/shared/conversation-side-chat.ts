export interface NativeSideChatOwner {
  terminalId: string
  threadId: string
}

export type NativeSideChatCommand =
  | { type: 'ask'; owner: NativeSideChatOwner; requestId: string; text: string }
  | { type: 'stop'; owner: NativeSideChatOwner; requestId: string }
  | { type: 'dispose'; owner: NativeSideChatOwner }

export interface NativeSideChatUpdate {
  owner: NativeSideChatOwner
  requestId: string
  text: string
}

export type NativeSideChatResult = { status: 'done' | 'stopped'; text: string }
