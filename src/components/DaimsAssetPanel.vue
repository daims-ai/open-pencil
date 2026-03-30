<script setup lang="ts">
import { computed, ref } from 'vue'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'

import { useElectronBridge } from '@/bridge/electron-bridge'

const { daimsAssetImages, requestAssetImagePlace } = useElectronBridge()
const query = ref('')
const placingId = ref<number | null>(null)

const filteredImages = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return daimsAssetImages.value
  return daimsAssetImages.value.filter((img) => img.name.toLowerCase().includes(q))
})

function handleImageClick(img: { id: number }) {
  placingId.value = img.id
  requestAssetImagePlace(img.id)
  setTimeout(() => { placingId.value = null }, 2000)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
      <icon-lucide-search class="size-3 shrink-0 text-muted" />
      <input
        v-model="query"
        placeholder="Search assets..."
        class="min-w-0 flex-1 bg-transparent text-xs text-surface outline-none placeholder:text-muted"
      />
    </div>

    <div
      v-if="daimsAssetImages.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
    >
      <icon-lucide-package class="size-8 text-muted" />
      <p class="text-xs text-muted">No assets</p>
      <p class="text-[10px] text-muted">Daims에서 이미지를 추가해주세요</p>
    </div>

    <div
      v-else-if="query && filteredImages.length === 0"
      class="flex flex-1 items-center justify-center px-4"
    >
      <p class="text-xs text-muted">No results for "{{ query }}"</p>
    </div>

    <div v-else class="scrollbar-thin flex-1 overflow-y-auto px-1 pb-1">
      <CollapsibleRoot default-open>
        <CollapsibleTrigger
          class="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] tracking-wider text-muted uppercase hover:text-surface"
        >
          <icon-lucide-chevron-down
            class="size-3 transition-transform [[data-state=closed]>&]:rotate-[-90deg]"
          />
          Images ({{ daimsAssetImages.length }})
        </CollapsibleTrigger>
        <CollapsibleContent>
          <button
            v-for="img in filteredImages"
            :key="img.id"
            class="group flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-hover"
            :class="{ 'opacity-50 pointer-events-none': placingId === img.id }"
            :title="`Click to place: ${img.name}`"
            @click="handleImageClick(img)"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-canvas"
            >
              <img
                :src="img.thumbnailUrl"
                :alt="img.name"
                class="max-h-full max-w-full object-contain"
              />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs text-surface">{{ img.name }}</p>
              <p class="text-[10px] text-muted">{{ img.width }} × {{ img.height }}</p>
            </div>
            <icon-lucide-plus
              class="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        </CollapsibleContent>
      </CollapsibleRoot>
    </div>
  </div>
</template>