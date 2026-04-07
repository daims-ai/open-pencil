/**
 * Multi-agent workflow stream composable.
 * Merges messages from PM, Designer, Validator into a single timeline.
 */
import { computed, shallowRef, watch, triggerRef } from 'vue'

import { useTabChat, type ChatTabID } from './use-chat'

import type { UIMessage } from 'ai'

export type WorkflowAgentID = 'pm' | 'designer' | 'validator'

export interface WorkflowMessage {
  id: string
  agentId: WorkflowAgentID
  message: UIMessage
  timestamp: number
}

export const AGENT_CONFIG: Record<
  WorkflowAgentID,
  { label: string; color: string; bgColor: string; icon: string }
> = {
  pm: {
    label: 'PM',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: 'clipboard-list'
  },
  designer: {
    label: 'Designer',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    icon: 'palette'
  },
  validator: {
    label: 'Validator',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: 'shield-check'
  }
}

const WORKFLOW_AGENTS: WorkflowAgentID[] = ['pm', 'designer', 'validator']

const mergedMessages = shallowRef<WorkflowMessage[]>([])
const messageTimestamps = new Map<string, number>()

function getMessageKey(agentId: WorkflowAgentID, msgId: string): string {
  return `${agentId}:${msgId}`
}

function mergeAgentMessages(): WorkflowMessage[] {
  const allMessages: WorkflowMessage[] = []

  for (const agentId of WORKFLOW_AGENTS) {
    const chatRef = useTabChat(agentId as ChatTabID)
    const chat = chatRef.value
    if (!chat) continue

    for (const msg of chat.messages) {
      const key = getMessageKey(agentId, msg.id)
      let timestamp = messageTimestamps.get(key)
      if (!timestamp) {
        timestamp = Date.now()
        messageTimestamps.set(key, timestamp)
      }

      allMessages.push({
        id: key,
        agentId,
        message: msg,
        timestamp
      })
    }
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp)
  return allMessages
}

function refreshMergedMessages() {
  mergedMessages.value = mergeAgentMessages()
  triggerRef(mergedMessages)
}

let watchersInitialized = false

export function useWorkflowStream() {
  if (!watchersInitialized) {
    watchersInitialized = true

    for (const agentId of WORKFLOW_AGENTS) {
      const chatRef = useTabChat(agentId as ChatTabID)
      watch(
        () => chatRef.value?.messages,
        () => refreshMergedMessages(),
        { deep: true }
      )
      watch(chatRef, () => refreshMergedMessages())
    }
  }

  const messages = computed(() => mergedMessages.value)

  const anyAgentWorking = computed(() => {
    for (const agentId of WORKFLOW_AGENTS) {
      const chatRef = useTabChat(agentId as ChatTabID)
      const chat = chatRef.value
      if (chat && (chat.status === 'streaming' || chat.status === 'submitted')) {
        return agentId
      }
    }
    return null
  })

  const status = computed(() => {
    for (const agentId of WORKFLOW_AGENTS) {
      const chatRef = useTabChat(agentId as ChatTabID)
      const chat = chatRef.value
      if (chat && (chat.status === 'streaming' || chat.status === 'submitted')) {
        return chat.status
      }
    }
    return 'ready'
  })

  function clearAllAgents() {
    messageTimestamps.clear()
    mergedMessages.value = []
    triggerRef(mergedMessages)
  }

  return {
    messages,
    anyAgentWorking,
    status,
    clearAllAgents,
    AGENT_CONFIG
  }
}
