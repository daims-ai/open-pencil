/**
 * Bridge between delegate tools and chat system.
 *
 * This module breaks the circular dependency between tools.ts and use-chat.ts
 * by providing a late-bound registry for the delegate handler.
 */

import type { DelegateAgentID, DelegateResponse } from '@open-pencil/core'

export type DelegateSender = (
  agentId: DelegateAgentID,
  message: string
) => Promise<DelegateResponse>

let delegateSender: DelegateSender | null = null

export function setDelegateSender(sender: DelegateSender | null): void {
  delegateSender = sender
}

export function getDelegateSender(): DelegateSender | null {
  return delegateSender
}
