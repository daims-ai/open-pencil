<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'
import { useEditorStore } from '@/stores/editor'

import AgentPanel from './AgentPanel.vue'
import ChatPanel from './ChatPanel.vue'
import CodePanel from './CodePanel.vue'
import DesignPanel from './DesignPanel.vue'
import ZoomDropdown from './ZoomDropdown.vue'

const store = useEditorStore()
const { panels } = useI18n()
</script>

<template>
  <aside
    data-test-id="properties-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
    style="contain: paint layout style"
  >
    <TabsRoot :model-value="store.state.activeRibbonTab" class="flex min-h-0 flex-1 flex-col">
      <TabsList class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <TabsTrigger
          value="design"
          data-test-id="properties-tab-design"
          class="rounded px-2.5 py-1 text-xs text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
          @click="
            () => {
              store.state.activeRibbonTab = 'panels'
              store.state.panelMode = 'design'
            }
          "
        >
          {{ panels.design }}
        </TabsTrigger>
        <TabsTrigger
          value="code"
          data-test-id="properties-tab-code"
          class="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
          @click="
            () => {
              store.state.activeRibbonTab = 'code'
            }
          "
        >
          <icon-lucide-code class="size-3" />
          {{ panels.code }}
        </TabsTrigger>
        <TabsTrigger
          value="ai"
          data-test-id="properties-tab-ai"
          class="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
          @click="
            () => {
              store.state.activeRibbonTab = 'ai'
            }
          "
        >
          <icon-lucide-sparkles class="size-3" />
          {{ panels.ai }}
        </TabsTrigger>
        <TabsTrigger
          value="agent"
          data-test-id="properties-tab-agent"
          class="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
          @click="
            () => {
              store.state.activeRibbonTab = 'agent'
            }
          "
        >
          <icon-lucide-bot class="size-3" />
          Agent
        </TabsTrigger>
        <ZoomDropdown
          v-if="store.state.activeRibbonTab === 'panels' && store.state.panelMode === 'design'"
        />
      </TabsList>

      <TabsContent
        value="design"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="store.state.activeRibbonTab !== 'panels' || store.state.panelMode !== 'design'"
      >
        <DesignPanel />
      </TabsContent>

      <TabsContent
        value="code"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="store.state.activeRibbonTab !== 'code'"
      >
        <CodePanel />
      </TabsContent>

      <TabsContent
        value="ai"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="store.state.activeRibbonTab !== 'ai'"
      >
        <ChatPanel />
      </TabsContent>

      <TabsContent
        value="agent"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="store.state.activeRibbonTab !== 'agent'"
      >
        <AgentPanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
