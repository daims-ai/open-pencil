import { ref, readonly, shallowRef, triggerRef } from 'vue'

import { IS_FROM_DAIMS } from '@open-pencil/core'

export interface OpenPencilConfig {
  providerID: string
  apiKey: string
}

export interface OpenPencilMessage<T = unknown> {
  type: string
  payload: T
}

interface LoadFilePayload {
  fileName: string
  data: number[]
}

export interface DaimsAssetImage {
  id: number
  name: string
  thumbnailUrl: string
  width: number
  height: number
  data?: number[]
  tags: string[]
}

const externalConfig = ref<OpenPencilConfig | null>(null)
const configReceived = ref(false)
const daimsAssetImages = shallowRef<DaimsAssetImage[]>([])

let configResolvers: Array<(config: OpenPencilConfig) => void> = []

async function handleLoadFile(payload: LoadFilePayload) {
  const { getActiveEditorStore } = await import('@/stores/editor')
  try {
    const store = getActiveEditorStore()
    const bytes = new Uint8Array(payload.data)
    const file = new File([bytes], payload.fileName)
    await store.openFigFile(file)
  } catch (e) {
    console.error('[electron-bridge] Failed to load .fig file:', e)
  }
}

function initPostMessageBridge() {
  if (!IS_FROM_DAIMS) return

  window.addEventListener('message', (event: MessageEvent<OpenPencilMessage>) => {
    const { type, payload } = event.data

    if (type === 'open-pencil:load-file') {
      void handleLoadFile(payload as LoadFilePayload)
      return
    }

    if (type === 'open-pencil:asset-images') {
      daimsAssetImages.value = payload as DaimsAssetImage[]
      triggerRef(daimsAssetImages)
      return
    }

    if (type === 'open-pencil:asset-image-data') {
      void handlePlaceAssetImage(payload as DaimsAssetImage)
      return
    }

    if (type !== 'open-pencil:config') return

    const config = payload as OpenPencilConfig
    externalConfig.value = config
    configReceived.value = true

    for (const resolve of configResolvers) {
      resolve(config)
    }
    configResolvers = []
  })
}

async function handlePlaceAssetImage(asset: DaimsAssetImage) {
  if (!asset.data) return
  const { getActiveEditorStore } = await import('@/stores/editor')
  try {
    const store = getActiveEditorStore()
    const bytes = new Uint8Array(asset.data)
    const ext = asset.name.match(/\.(\w+)$/)?.[1] ?? 'png'
    const file = new File([bytes], asset.name, { type: `image/${ext}` })
    const center = store.viewportScreenCenter()
    const { x: cx, y: cy } = store.screenToCanvas(center.x, center.y)
    await store.placeImageFiles([file], cx, cy)
  } catch (e) {
    console.error('[electron-bridge] Failed to place asset image:', e)
  }
}

export function requestAssetImagePlace(assetId: number): void {
  postMessageToParent('open-pencil:request-asset-image', { id: assetId })
}

export function waitForExternalConfig(): Promise<OpenPencilConfig> {
  if (externalConfig.value) {
    return Promise.resolve(externalConfig.value)
  }

  return new Promise((resolve) => {
    configResolvers.push(resolve)
  })
}

export function postMessageToParent(type: string, payload: unknown): void {
  if (!IS_FROM_DAIMS) return
  window.parent.postMessage({ type, payload }, '*')
}

export function useElectronBridge() {
  return {
    externalConfig: readonly(externalConfig),
    configReceived: readonly(configReceived),
    daimsAssetImages: readonly(daimsAssetImages),
    waitForExternalConfig,
    postMessageToParent,
    requestAssetImagePlace
  }
}

if (IS_FROM_DAIMS) {
  initPostMessageBridge()
}
