<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { markRaw, nextTick, ref, watch } from 'vue'

import { clearAcpDebugLog } from '@/ai/acp-transport'
import { clearToolLogEntries, loadWorkflowConfig } from '@/ai/tools'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import WorkflowMessage from '@/components/chat/WorkflowMessage.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useAIChat, resetTabChat } from '@/composables/use-chat'
import { useWorkflowStream, AGENT_CONFIG } from '@/composables/use-workflow-stream'
import { useI18n } from '@open-pencil/vue'
import { isWorkflowJson, buildPMStartMessage } from '@open-pencil/core'

import type { WorkflowConfig } from '@open-pencil/core'
import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'

const { isConfigured, ensureChat } = useAIChat()
const { messages, anyAgentWorking, status, clearAllAgents } = useWorkflowStream()
const { dialogs } = useI18n()

const pmChat = ref<Chat<UIMessage> | null>(null)
const messagesEnd = ref<HTMLDivElement>()
const initError = ref<string | null>(null)
const workflowLoaded = ref(false)

ensureChat('pm').then((c) => {
  if (c) pmChat.value = markRaw(c)
})

function scrollToBottom() {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
}

watch(messages, scrollToBottom, { deep: true })

async function handleSubmit(text: string) {
  if (status.value === 'streaming' || status.value === 'submitted') return

  try {
    initError.value = null
    const c = await ensureChat('pm')
    if (c) pmChat.value = markRaw(c)
  } catch (e) {
    console.error('Failed to initialize chat:', e)
    initError.value = e instanceof Error ? e.message : String(e)
    return
  }

  const parsedConfig = isWorkflowJson(text)
  if (parsedConfig) {
    loadWorkflowConfig(parsedConfig)
    workflowLoaded.value = true

    const pmStartMessage = buildPMStartMessage(parsedConfig)
    pmChat.value?.sendMessage({ text: pmStartMessage }).catch((e: unknown) => {
      console.error('Chat error:', e)
    })
    return
  }

  pmChat.value?.sendMessage({ text }).catch((e: unknown) => {
    console.error('Chat error:', e)
  })
}

function handleStop() {
  pmChat.value?.stop()
}

function handleClearChat() {
  resetTabChat('pm')
  resetTabChat('designer')
  resetTabChat('validator')
  clearAllAgents()
  clearToolLogEntries()
  clearAcpDebugLog()
  pmChat.value = null
  ensureChat('pm').then((c) => {
    if (c) pmChat.value = markRaw(c)
  })
}
</script>

<template>
  <div
    data-test-id="workflow-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden select-text"
  >
    <ProviderSetup v-if="!isConfigured" />

    <template v-else>
      <ScrollAreaRoot class="min-h-0 flex-1">
        <ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
          <!-- Empty state -->
          <div
            v-if="messages.length === 0"
            data-test-id="workflow-empty-state"
            class="flex h-full flex-col items-center justify-center gap-4 text-muted"
          >
            <div class="flex items-center gap-3">
              <div
                v-for="(config, agentId) in AGENT_CONFIG"
                :key="agentId"
                class="flex flex-col items-center gap-1"
              >
                <div
                  class="flex size-8 items-center justify-center rounded-full"
                  :class="config.bgColor"
                >
                  <icon-lucide-clipboard-list
                    v-if="agentId === 'pm'"
                    class="size-4"
                    :class="config.color"
                  />
                  <icon-lucide-palette
                    v-else-if="agentId === 'designer'"
                    class="size-4"
                    :class="config.color"
                  />
                  <icon-lucide-shield-check
                    v-else-if="agentId === 'validator'"
                    class="size-4"
                    :class="config.color"
                  />
                </div>
                <span class="text-[10px]" :class="config.color">{{ config.label }}</span>
              </div>
            </div>
            <p class="text-center text-xs">Paste a workflow JSON to start</p>
            <p class="text-center text-[10px] text-muted/60">
              PM → Designer → Validator (each agent sees only its own context)
            </p>
          </div>

          <!-- Messages -->
          <div v-else data-test-id="workflow-messages" class="flex flex-col gap-3">
            <WorkflowMessage
              v-for="item in messages"
              :key="item.id"
              :message="item.message"
              :agent-id="item.agentId"
            />

            <!-- Thinking indicator -->
            <div
              v-if="anyAgentWorking"
              data-test-id="workflow-typing-indicator"
              class="flex items-center gap-2"
            >
              <div
                class="flex size-5 shrink-0 items-center justify-center rounded-full"
                :class="[
                  AGENT_CONFIG[anyAgentWorking].bgColor,
                  AGENT_CONFIG[anyAgentWorking].color
                ]"
              >
                <icon-lucide-clipboard-list v-if="anyAgentWorking === 'pm'" class="size-3" />
                <icon-lucide-palette v-else-if="anyAgentWorking === 'designer'" class="size-3" />
                <icon-lucide-shield-check
                  v-else-if="anyAgentWorking === 'validator'"
                  class="size-3"
                />
              </div>
              <span class="text-[10px]" :class="AGENT_CONFIG[anyAgentWorking].color">
                {{ AGENT_CONFIG[anyAgentWorking].label }}
              </span>
              <div class="flex items-center gap-1">
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
        <div class="flex flex-1 items-center gap-2 text-[10px] text-muted">
          <span>Agents:</span>
          <span
            v-for="(config, agentId) in AGENT_CONFIG"
            :key="agentId"
            class="flex items-center gap-1"
          >
            <span class="size-2 rounded-full" :class="config.bgColor" />
            <span :class="anyAgentWorking === agentId ? config.color : ''">
              {{ config.label }}
            </span>
          </span>
        </div>
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
