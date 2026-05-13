import {
  IS_FROM_DAIMS,
  IS_TAURI,
  getLoadedFontData,
  loadFont as loadFontCore,
  markFontLoaded,
  styleToWeight,
  getDaimsFontProvider
} from '@open-pencil/core'

interface TauriFontFamily {
  family: string
  styles: string[]
}

let tauriFontsCache: TauriFontFamily[] | null = null

let tauriFontsPromise: Promise<TauriFontFamily[]> | null = null

async function getTauriFonts(): Promise<TauriFontFamily[]> {
  if (tauriFontsCache) return tauriFontsCache
  if (!tauriFontsPromise) {
    tauriFontsPromise = import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<TauriFontFamily[]>('list_system_fonts'))
      .then((fonts) => {
        tauriFontsCache = fonts
        return fonts
      })
      .catch(() => [])
  }
  return tauriFontsPromise
}

export function preloadFonts(): void {
  if (IS_TAURI) {
    void getTauriFonts().then(registerFontFaces)
  }
}

function registerFontFaces(fonts: TauriFontFamily[]): void {
  if (typeof document === 'undefined') return
  for (const { family } of fonts) {
    const face = new FontFace(family, `local("${family}")`)
    document.fonts.add(face)
  }
}

export async function listFamilies(): Promise<string[]> {
  if (IS_FROM_DAIMS) {
    return getDaimsFontProvider()?.listFamilies() ?? []
  }

  if (IS_TAURI) {
    const fonts = await getTauriFonts()
    return fonts.map((f) => f.family)
  }

  const { listFamilies: coreList } = await import('@open-pencil/core')
  return coreList()
}

export async function listFonts(): Promise<TauriFontFamily[]> {
  if (IS_TAURI) {
    return getTauriFonts()
  }
  return []
}

export async function loadFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
  const cached = getLoadedFontData(family, style)
  if (cached) return cached

  if (IS_FROM_DAIMS) {
    const provider = getDaimsFontProvider()
    if (!provider) return null
    const buffer = await provider.loadFont(family, style)
    if (!buffer) return null

    markFontLoaded(family, style, buffer)
    registerBrowserFontFace(family, style, buffer)

    return buffer
  }

  if (IS_TAURI) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const data = await invoke<number[]>('load_system_font', { family, style })
      const buffer = new Uint8Array(data).buffer

      markFontLoaded(family, style, buffer)
      registerBrowserFontFace(family, style, buffer)

      return buffer
    } catch {
      return loadFontCore(family, style)
    }
  }

  return loadFontCore(family, style)
}

function registerBrowserFontFace(family: string, style: string, buffer: ArrayBuffer): void {
  if (typeof document === 'undefined') return

  const weight = styleToWeight(style)
  const italic = style.toLowerCase().includes('italic') ? 'italic' : 'normal'
  const face = new FontFace(family, buffer, { weight: String(weight), style: italic })

  void face
    .load()
    .then(() => document.fonts.add(face))
    .catch(() => {
      console.warn(`Failed to load font "${family}" (${style})`)
    })
}
