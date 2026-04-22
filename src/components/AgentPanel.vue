<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { computed, markRaw, nextTick, ref, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/ai/acp-transport'
import { copyChatLog } from '@/ai/chat-debug'
import { clearToolLogEntries, didHitStepLimit } from '@/ai/tools'
import { activeTab } from '@/stores/tabs'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useAIChat, resetKeyChat, createOneOffChat } from '@/composables/use-chat'
import { useI18n } from '@open-pencil/vue'
import {
  getRetryCount,
  getWorkflowContext,
  getWorkflowHistory,
  parseDaimsWorkflow,
  setRetryCount,
  setSubAgentExecutor,
  setWorkflowContext,
  setWorkflowHistory
} from '@open-pencil/core'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import type { DaimsWorkflow, SubAgentConfig } from '@open-pencil/core'

const IS_DEV = import.meta.env.DEV

const { isConfigured, ensureChat, resetChat } = useAIChat()
const { dialogs } = useI18n()

const chat = ref<Chat<UIMessage> | null>(null)

interface WorkflowAgent {
  key: string
  label: string
  chat: Chat<UIMessage>
}

const workflowActive = ref(false)
const workflowAgents = ref<WorkflowAgent[]>([])
const activeAgentIndex = ref(0)

const activeWorkflowChat = computed(() => {
  if (!workflowActive.value || workflowAgents.value.length === 0) return null
  return workflowAgents.value[activeAgentIndex.value]?.chat ?? null
})

// Only initialize chat when on the Agent tab
if (activeTab.value?.id === 'agent') {
  ensureChat('agent').then((c) => {
    if (c) chat.value = markRaw(c)
  })
}
const messagesEnd = ref<HTMLDivElement>()
const debugCopied = ref(false)
const acpLogCopied = ref(false)
const initError = ref<string | null>(null)

const currentChat = computed(() => {
  if (workflowActive.value && activeWorkflowChat.value) {
    return activeWorkflowChat.value
  }
  return chat.value
})

const messages = computed(() => currentChat.value?.messages ?? [])
const status = computed(() => currentChat.value?.status ?? 'ready')
const isThinking = computed(() => {
  const s = status.value
  if (s !== 'submitted' && s !== 'streaming') return false
  if (messages.value.length === 0) return true
  const last = messages.value[messages.value.length - 1]
  if (last.role !== 'assistant') return true
  const parts = last.parts
  if (parts.length === 0) return true
  const lastPart = parts[parts.length - 1] as Record<string, unknown>
  if (lastPart.type === 'step-start') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-available') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-error') return true
  return s === 'submitted'
})

const showContinue = computed(() => {
  if (status.value !== 'ready') return false
  if (messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return last.role === 'assistant' && didHitStepLimit()
})

function scrollToBottom() {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
}

watch(messages, scrollToBottom, { deep: true })

watch(
  () => activeTab.value?.id,
  (newTabId) => {
    if (newTabId === 'agent') {
      ensureChat('agent').then((c) => {
        if (c) chat.value = markRaw(c)
      })
    }
  }
)

function buildSubAgentSystemPrompt(
  agentConfig: SubAgentConfig,
  common: Record<string, unknown>,
  retryCount: number,
  currentPageId: string
): string {
  const parts: string[] = []

  if (retryCount > 0) {
    parts.push(
      `# Retry Information\nThis is retry attempt #${retryCount}. Previous attempts have failed. Please be extra careful and thorough.`
    )
  }

  if (Object.keys(common).length > 0) {
    parts.push(`# Common rules\n${JSON.stringify(common, null, 2)}`)
  }

  if (currentPageId) {
    parts.push(`# Current page ID: ${currentPageId}`)
  }

  if (agentConfig.role) {
    parts.push(`# Role\n${agentConfig.role}`)
  }

  return parts.join('\n\n')
}

function isNestedWorkflowAgent(config: SubAgentConfig): boolean {
  return (
    config.isWorkflowCard === true &&
    Array.isArray(config.order) &&
    !!config.agent &&
    typeof config.agent === 'object'
  )
}

function buildAgentsMap(source: {
  order: string[]
  agent: Record<string, unknown>
}): Record<string, SubAgentConfig> {
  const map: Record<string, SubAgentConfig> = {}
  for (const key of source.order) {
    const raw = source.agent[key] as Record<string, unknown> | undefined
    if (
      raw &&
      typeof raw === 'object' &&
      raw.isWorkflowCard === true &&
      Array.isArray(raw.order) &&
      raw.agent &&
      typeof raw.agent === 'object'
    ) {
      map[key] = {
        key,
        role: typeof raw.role === 'string' ? raw.role : '',
        isWorkflowCard: true,
        order: raw.order as string[],
        agent: raw.agent as Record<string, unknown>,
        common: (raw.common as Record<string, unknown>) ?? {}
      }
    } else {
      map[key] = {
        key,
        role: (raw?.role as string) ?? '',
        workflow: raw?.workflow
      }
    }
  }
  return map
}

function buildLeafAgentMessage(agentConfig: SubAgentConfig, message: string): string {
  const copied: Record<string, unknown> = { ...agentConfig }
  delete copied.key
  delete copied.role
  delete copied.isWorkflowCard
  delete copied.order
  delete copied.agent
  delete copied.common
  return JSON.stringify({
    ...copied,
    ...(message ? { receivedMessage: message } : {})
  })
}

async function runOneOffAgentChat(
  agentKey: string,
  systemPrompt: string,
  initialText: string
): Promise<string> {
  const subChat = await createOneOffChat(agentKey, systemPrompt)
  if (!subChat) {
    throw new Error('Failed to create sub-agent chat')
  }

  return new Promise<string>((resolve, reject) => {
    let responseText = ''

    const unsubscribe = subChat.subscribe((state) => {
      const lastMessage = state.messages[state.messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        for (const part of lastMessage.parts) {
          if (part.type === 'text') {
            responseText = part.text
          }
        }
      }

      if (state.status === 'ready' && state.messages.length > 1) {
        unsubscribe()
        subChat.destroy()
        resolve(responseText)
      } else if (state.status === 'error') {
        unsubscribe()
        subChat.destroy()
        reject(new Error(state.error?.message ?? 'Sub-agent error'))
      }
    })

    subChat.sendMessage({ text: initialText }).catch((e: unknown) => {
      unsubscribe()
      subChat.destroy()
      reject(e)
    })
  })
}

async function runNestedWorkflowAsSubAgent(
  parentAgentKey: string,
  nestedConfig: SubAgentConfig,
  message: string,
  _parentRetryCount: number,
  currentPageId: string
): Promise<string> {
  if (!nestedConfig.order || !nestedConfig.agent) {
    throw new Error(`Nested workflow "${parentAgentKey}" is missing order/agent`)
  }

  const nestedAgentsMap = buildAgentsMap({
    order: nestedConfig.order,
    agent: nestedConfig.agent
  })
  const nestedCommon = nestedConfig.common ?? {}

  // Snapshot the parent scope so the nested workflow gets a fresh, isolated
  // context/history/retry counter. `create_sub_agent` tool calls made by the
  // nested PM and its descendants will only see their own scope; they cannot
  // read or mutate the parent's workflow history. On completion (success or
  // failure) we restore the parent scope so the outer PM resumes unaffected.
  const previousContext = getWorkflowContext()
  const previousHistory = getWorkflowHistory()
  const previousRetryCount = getRetryCount()

  setWorkflowContext({
    agents: nestedAgentsMap,
    common: nestedCommon
  })
  setWorkflowHistory([])
  setRetryCount(0)

  try {
    const firstKey = nestedConfig.order[0]
    const firstAgentConfig = nestedAgentsMap[firstKey]
    if (!firstAgentConfig) {
      throw new Error(`Nested workflow "${parentAgentKey}" has no entry agent`)
    }

    const systemPrompt = buildSubAgentSystemPrompt(
      firstAgentConfig,
      nestedCommon,
      // Nested scope starts with its own retry counter (0), independent of the
      // parent's retry state.
      0,
      currentPageId
    )

    const initialText = buildLeafAgentMessage(firstAgentConfig, message)
    return await runOneOffAgentChat(`${parentAgentKey}:${firstKey}`, systemPrompt, initialText)
  } finally {
    setWorkflowContext(previousContext)
    setWorkflowHistory(previousHistory)
    setRetryCount(previousRetryCount)
  }
}

async function runSubAgentFromContext(
  agentKey: string,
  message: string,
  retryCount: number,
  currentPageId: string
): Promise<string> {
  const ctx = getWorkflowContext()
  if (!ctx) {
    throw new Error('No workflow context available')
  }

  const agentConfig = ctx.agents[agentKey] as SubAgentConfig | undefined
  if (!agentConfig) {
    throw new Error(`Agent "${agentKey}" not found in workflow`)
  }

  if (isNestedWorkflowAgent(agentConfig)) {
    return runNestedWorkflowAsSubAgent(
      agentKey,
      agentConfig,
      message,
      retryCount,
      currentPageId
    )
  }

  const systemPrompt = buildSubAgentSystemPrompt(
    agentConfig,
    ctx.common,
    retryCount,
    currentPageId
  )
  const initialText = buildLeafAgentMessage(agentConfig, message)
  return runOneOffAgentChat(agentKey, systemPrompt, initialText)
}

async function initializeWorkflow(workflow: DaimsWorkflow, _rawText: string) {
  if (workflow.order.length === 0) return

  const firstKey = workflow.order[0]
  const firstRaw = workflow.agent[firstKey] as Record<string, unknown> | undefined
  const systemPrompt = (firstRaw?.role as string) ?? ''

  const chatInstance = await ensureChat(`workflow:${firstKey}`, systemPrompt)
  if (!chatInstance) return

  const agentsMap = buildAgentsMap({
    order: workflow.order,
    agent: workflow.agent
  })

  setWorkflowContext({
    agents: agentsMap,
    common: workflow.common ?? {}
  })

  setSubAgentExecutor(runSubAgentFromContext)

  workflowAgents.value = [
    {
      key: firstKey,
      label: firstKey.charAt(0).toUpperCase() + firstKey.slice(1),
      chat: markRaw(chatInstance)
    }
  ]
  workflowActive.value = true
  activeAgentIndex.value = 0

  // The top-level entry agent (usually PM) kicks off the workflow with its
  // own `workflow` field if present, otherwise it receives the same leaf-style
  // payload used for sub-agents.
  const firstAgentConfig = agentsMap[firstKey]
  const firstText = isNestedWorkflowAgent(firstAgentConfig)
    ? buildLeafAgentMessage(firstAgentConfig, '')
    : JSON.stringify(firstAgentConfig.workflow ?? {})
  chatInstance.sendMessage({ text: firstText }).catch((e: unknown) => {
    console.error('Chat error:', e)
  })
}

async function handleSubmit(text: string) {
  if (status.value === 'streaming' || status.value === 'submitted') return
  try {
    initError.value = null
    const c = await ensureChat('agent')
    if (c) chat.value = markRaw(c)
  } catch (e) {
    console.error('Failed to initialize chat:', e)
    initError.value = e instanceof Error ? e.message : String(e)
    return
  }

  // workflow 형식이 아니더라도 workflow가 활성화된 상태면 현재 에이전트로 메시지 전송
  if (workflowActive.value && activeWorkflowChat.value) {
    activeWorkflowChat.value.sendMessage({ text }).catch((e: unknown) => {
      console.error('Chat error:', e)
    })
    return
  }

  const workflow = await parseDaimsWorkflow(text)
  if (workflow) {
    await initializeWorkflow(workflow, text)
    return
  }

  chat.value?.sendMessage({ text }).catch((e: unknown) => {
    console.error('Chat error:', e)
  })
}

function handleStop() {
  if (workflowActive.value && activeWorkflowChat.value) {
    activeWorkflowChat.value.stop()
  } else {
    chat.value?.stop()
  }
}

async function handleCopyDebug() {
  await copyChatLog(messages.value)
  debugCopied.value = true
  setTimeout(() => {
    debugCopied.value = false
  }, 1500)
}

async function handleCopyAcpLog() {
  const text = getAcpDebugText()
  if (!text) return
  await navigator.clipboard.writeText(text)
  acpLogCopied.value = true
  setTimeout(() => {
    acpLogCopied.value = false
  }, 1500)
}

function handleClearChat() {
  if (workflowActive.value) {
    for (const agent of workflowAgents.value) {
      resetKeyChat(`workflow:${agent.key}`)
    }
    workflowAgents.value = []
    workflowActive.value = false
    activeAgentIndex.value = 0
    setWorkflowContext(null)
    setSubAgentExecutor(null)
  }
  chat.value = null
  resetKeyChat('agent')
  clearToolLogEntries()
  clearAcpDebugLog()
}
</script>

<template>
  <div data-test-id="agent-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ProviderSetup v-if="!isConfigured" />

    <template v-else>
      <!-- Workflow agent tabs -->
      <div
        v-if="workflowActive && workflowAgents.length > 1"
        class="flex shrink-0 gap-1 border-b border-border px-2 py-1.5"
      >
        <button
          v-for="(agent, index) in workflowAgents"
          :key="agent.key"
          class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            activeAgentIndex === index
              ? 'bg-accent text-white'
              : 'text-muted hover:bg-hover hover:text-surface'
          "
          @click="activeAgentIndex = index"
        >
          {{ agent.label }}
          <span
            v-if="agent.chat.status === 'streaming' || agent.chat.status === 'submitted'"
            class="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-current"
          />
        </button>
      </div>

      <ScrollAreaRoot class="min-h-0 flex-1">
        <ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
          <!-- Empty state -->
          <div
            v-if="messages.length === 0"
            data-test-id="agent-empty-state"
            class="flex h-full flex-col items-center justify-center gap-3 text-muted"
          >
            <icon-lucide-bot class="size-8 opacity-50" />
            <p class="text-center text-xs">{{ dialogs.describeCreateOrChange }}</p>
          </div>

          <!-- Messages -->
          <div v-else data-test-id="agent-messages" class="flex flex-col gap-3">
            <ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

            <!-- Thinking indicator: shown when AI is working but no visible activity -->
            <div v-if="isThinking" data-test-id="agent-typing-indicator" class="flex gap-2">
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
              >
                AGENT
              </div>
              <div class="flex items-center gap-1 py-2">
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 0ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 150ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 300ms"
                />
              </div>
            </div>

            <!-- Continue button when step limit reached -->
            <div v-if="showContinue" class="flex justify-center py-2">
              <button
                class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                @click="handleSubmit('Continue where you left off')"
              >
                <icon-lucide-play class="size-3" />
                Continue
              </button>
            </div>

            <div ref="messagesEnd" />
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
          <ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>

      <!-- Chat toolbar -->
      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
        <button
          v-if="IS_DEV"
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="handleCopyDebug"
        >
          <icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ debugCopied ? 'Copied' : 'Copy log' }}
        </button>
        <button
          v-if="IS_DEV && hasAcpDebugEntries()"
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="handleCopyAcpLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </button>
        <button
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          Clear
        </button>
      </div>

      <!-- Connection error banner -->
      <div
        v-if="initError"
        class="flex items-center gap-2 border-t border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400"
      >
        <icon-lucide-circle-alert class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ initError }}</span>
        <button class="shrink-0 text-red-300 hover:text-red-200" @click="initError = null">
          <icon-lucide-x class="size-3" />
        </button>
      </div>

      <ChatInput :status="status" @submit="handleSubmit" @stop="handleStop" />

      <ACPPermissionDialog />
    </template>
  </div>
</template>
