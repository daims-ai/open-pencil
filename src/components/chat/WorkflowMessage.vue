<script setup lang="ts">
import { isTextUIPart, isToolUIPart, getToolName } from 'ai'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'

import { AGENT_CONFIG, type WorkflowAgentID } from '@/composables/use-workflow-stream'

import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from 'ai'

const { message, agentId } = defineProps<{
  message: UIMessage
  agentId: WorkflowAgentID
}>()

const agentConfig = AGENT_CONFIG[agentId]

type ToolPart = Extract<UIMessagePart<UIDataTypes, UITools>, { toolCallId: string }>

function toolDisplayName(part: ToolPart): string {
  return getToolName(part)
    .replace(/^mcp__[^_]+__/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function hasErrorOutput(part: ToolPart): boolean {
  return (
    part.state === 'output-available' &&
    typeof part.output === 'object' &&
    part.output !== null &&
    'error' in part.output
  )
}

function toolState(part: ToolPart): 'pending' | 'done' | 'error' {
  if (part.state === 'output-error' || hasErrorOutput(part)) return 'error'
  if (part.state === 'output-available') return 'done'
  return 'pending'
}

function partKey(part: UIMessagePart<UIDataTypes, UITools>, index: number): string {
  if ('toolCallId' in part) return part.toolCallId
  return `part-${index}`
}
</script>

<template>
  <div
    :data-test-id="`workflow-message-${agentId}-${message.role}`"
    :class="message.role === 'user' ? 'flex justify-end' : ''"
  >
    <div class="min-w-0 space-y-1.5" :class="message.role === 'user' ? 'max-w-[85%]' : 'w-full'">
      <!-- Agent header for assistant messages -->
      <template v-if="message.role === 'assistant'">
        <div class="flex items-center gap-2 mb-1">
          <div
            class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
            :class="[agentConfig.bgColor, agentConfig.color]"
          >
            <icon-lucide-clipboard-list v-if="agentId === 'pm'" class="size-3" />
            <icon-lucide-palette v-else-if="agentId === 'designer'" class="size-3" />
            <icon-lucide-shield-check v-else-if="agentId === 'validator'" class="size-3" />
          </div>
          <span class="text-[10px] font-medium" :class="agentConfig.color">
            {{ agentConfig.label }}
          </span>
        </div>

        <div class="ml-7 space-y-1.5">
          <template v-for="(part, i) in message.parts" :key="partKey(part, i)">
            <!-- Tool call -->
            <div v-if="isToolUIPart(part)" class="rounded-lg border border-border bg-canvas p-2">
              <CollapsibleRoot>
                <CollapsibleTrigger
                  class="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-hover"
                >
                  <div
                    class="flex size-4 items-center justify-center rounded-full"
                    :class="{
                      'bg-accent/20 text-accent': toolState(part) === 'pending',
                      'bg-green-500/20 text-green-400': toolState(part) === 'done',
                      'bg-red-500/20 text-red-400': toolState(part) === 'error'
                    }"
                  >
                    <icon-lucide-loader-circle
                      v-if="toolState(part) === 'pending'"
                      class="size-3 animate-spin"
                    />
                    <icon-lucide-check v-else-if="toolState(part) === 'done'" class="size-3" />
                    <icon-lucide-triangle-alert v-else class="size-3" />
                  </div>
                  <span class="text-[11px] text-surface">
                    {{ toolDisplayName(part) }}
                  </span>
                  <span class="text-[10px] text-muted">
                    {{
                      toolState(part) === 'pending'
                        ? 'Running…'
                        : toolState(part) === 'done'
                          ? 'Done'
                          : 'Error'
                    }}
                  </span>
                  <icon-lucide-chevron-down
                    v-if="toolState(part) !== 'pending'"
                    class="ml-auto size-3 text-muted transition-transform [[data-state=open]>&]:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent
                  v-if="toolState(part) !== 'pending'"
                  class="data-[state=closed]:collapsible-up data-[state=open]:collapsible-down overflow-hidden text-[10px]"
                >
                  <pre class="mt-1 overflow-x-auto rounded bg-input p-2 text-muted">{{
                    part.state === 'output-error' && part.errorText
                      ? part.errorText
                      : hasErrorOutput(part)
                        ? (part.output as { error: string }).error
                        : JSON.stringify(part.output, null, 2)
                  }}</pre>
                </CollapsibleContent>
              </CollapsibleRoot>
            </div>

            <!-- Text -->
            <div
              v-else-if="isTextUIPart(part) && part.text"
              data-test-id="workflow-text-bubble"
              class="rounded-xl rounded-tl-md bg-hover px-3 py-2 text-xs leading-relaxed text-surface"
            >
              <Markdown :content="part.text" :mermaid="false" class="chat-markdown" />
            </div>
          </template>
        </div>
      </template>

      <!-- User message -->
      <div
        v-else-if="message.role === 'user'"
        data-test-id="workflow-user-bubble"
        class="rounded-xl rounded-br-md bg-accent px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-white"
      >
        {{
          message.parts
            .filter(isTextUIPart)
            .map((p) => p.text)
            .join('')
        }}
      </div>
    </div>
  </div>
</template>
