import { ref, readonly, shallowRef, triggerRef } from 'vue'

import { IS_FROM_DAIMS, setDaimsFontProvider, setDaimsApiKey } from '@open-pencil/core'

export interface OpenPencilConfig {
  providerID: string
  apiKey: string
  modelID?: string
  daimsApiKey?: string
  prompt?: string
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
  path?: string
  thumbnailUrl: string
  data?: number[]
}

const externalConfig = ref<OpenPencilConfig | null>(null)
const configReceived = ref(false)
const daimsAssetImages = shallowRef<DaimsAssetImage[]>([])
let externalPromptConsumed = false

let fontRequestId = 0
const pendingFontRequests = new Map<number, (data: ArrayBuffer | null) => void>()

let pushedFontFamilies: string[] | null = null
let fontFamilyWaiters: Array<(families: string[]) => void> = []

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

    if (type === 'open-pencil:request-save-file') {
      void handleRequestSaveFile()
      return
    }

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

    if (type === 'open-pencil:font-data') {
      const { requestId, data } = payload as { requestId: number; data: number[] | null }
      const resolve = pendingFontRequests.get(requestId)
      if (resolve) {
        pendingFontRequests.delete(requestId)
        resolve(data ? new Uint8Array(data).buffer : null)
      }
      return
    }

    if (type === 'open-pencil:font-families') {
      const { families } = payload as { families: string[] }
      pushedFontFamilies = families
      for (const waiter of fontFamilyWaiters) {
        waiter(families)
      }
      fontFamilyWaiters = []
      return
    }

    if (type !== 'open-pencil:config') return

    const config = payload as OpenPencilConfig
    externalConfig.value = config
    configReceived.value = true

    if (config.daimsApiKey) {
      setDaimsApiKey(config.daimsApiKey)
    }

    for (const resolve of configResolvers) {
      resolve(config)
    }
    configResolvers = []
  })
}

async function handleRequestSaveFile() {
  const { getActiveEditorStore } = await import('@/stores/editor')
  try {
    await getActiveEditorStore().saveFigFile()
  } catch (e) {
    console.error('[electron-bridge] Failed to save .fig file:', e)
  }
}

async function handlePlaceAssetImage(asset: DaimsAssetImage) {
  if (!asset.data) return
  const { getActiveEditorStore } = await import('@/stores/editor')
  try {
    const store = getActiveEditorStore()
    const bytes = new Uint8Array(asset.data)
    const ext = asset.name.match(/\.(\w+)$/)?.[1] ?? 'png'
    const mimeSubtype = ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase()
    const file = new File([bytes], asset.name, { type: `image/${mimeSubtype}` })
    const center = store.viewportScreenCenter()
    const { x: cx, y: cy } = store.screenToCanvas(center.x, center.y)
    await store.placeImageFiles([file], cx, cy)
  } catch (e) {
    console.error('[electron-bridge] Failed to place asset image:', e)
  }
}

export function requestAssetImagePlace(assetId: number): void {
  const asset = daimsAssetImages.value.find((img) => img.id === assetId)
  postMessageToParent('open-pencil:request-asset-image', { id: assetId, path: asset?.path })
}

export function waitForExternalConfig(): Promise<OpenPencilConfig> {
  if (externalConfig.value) {
    return Promise.resolve(externalConfig.value)
  }

  return new Promise((resolve) => {
    configResolvers.push(resolve)
  })
}

export function consumeExternalPrompt(): string | null {
  const prompt = externalConfig.value?.prompt?.trim()
  if (!prompt || externalPromptConsumed) return null
  externalPromptConsumed = true
  return prompt
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
    consumeExternalPrompt,
    postMessageToParent,
    requestAssetImagePlace
  }
}

if (IS_FROM_DAIMS) {
  initPostMessageBridge()

  setDaimsFontProvider({
    loadFont: (family, style) =>
      new Promise((resolve) => {
        const id = fontRequestId++
        pendingFontRequests.set(id, resolve)
        postMessageToParent('open-pencil:request-font', { requestId: id, family, style })
      }),
    listFamilies: () => {
      if (pushedFontFamilies) return Promise.resolve(pushedFontFamilies)
      return new Promise((resolve) => {
        fontFamilyWaiters.push(resolve)
      })
    }
  })
}
