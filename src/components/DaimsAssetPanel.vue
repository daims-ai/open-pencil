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
  return daimsAssetImages.value.filter(
    (img) =>
      img.name.toLowerCase().includes(q) || img.tags.some((tag) => tag.toLowerCase().includes(q))
  )
})

function handleImageClick(img: { id: number }) {
  placingId.value = img.id
  requestAssetImagePlace(img.id)
  setTimeout(() => {
    placingId.value = null
  }, 2000)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
      <icon-lucide-search class="size-3 shrink-0 text-muted" />
      <input
        v-model="query"
        placeholder="Input name or tag..."
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
          Images ({{ filteredImages.length }})
        </CollapsibleTrigger>
        <CollapsibleContent class="grid grid-cols-3 gap-1 p-1">
          <button
            v-for="img in filteredImages"
            :key="img.id"
            class="aspect-square overflow-hidden rounded border border-border bg-canvas transition-opacity hover:opacity-80"
            :class="{ 'opacity-50 pointer-events-none': placingId === img.id }"
            :title="`Click to place: ${img.name}`"
            @click="handleImageClick(img)"
          >
            <img :src="img.thumbnailUrl" :alt="img.name" class="size-full object-contain" />
          </button>
        </CollapsibleContent>
      </CollapsibleRoot>
    </div>
  </div>
</template>
