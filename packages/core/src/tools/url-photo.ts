import { defineTool } from './schema'

import type { FigmaAPI } from '../figma-api'

interface UrlPhotoRequest {
  id: string
  url: string
  width?: number
  height?: number
}

interface UrlPhotoResult {
  id: string
  photo?: {
    url: string
    width: number
    height: number
  }
  error?: string
}

async function applyPhotoFromUrl(figma: FigmaAPI, req: UrlPhotoRequest): Promise<UrlPhotoResult> {
  const node = figma.getNodeById(req.id)
  if (!node) return { id: req.id, error: 'Not found' }

  const children = 'children' in node ? (node as { children: unknown[] }).children : []
  if (children.length > 0) {
    return {
      id: req.id,
      error: `"${node.name}" has children — use a leaf shape`
    }
  }

  let imageBytes: Uint8Array
  let imgWidth: number
  let imgHeight: number
  try {
    const imgResp = await fetch(req.url)
    if (!imgResp.ok) return { id: req.id, error: `Download ${imgResp.status}` }
    imageBytes = new Uint8Array(await imgResp.arrayBuffer())

    imgWidth = req.width ?? node.width
    imgHeight = req.height ?? node.height
  } catch (err) {
    return {
      id: req.id,
      error: `Download: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const image = figma.createImage(imageBytes)
  node.fills = [
    {
      type: 'IMAGE',
      color: { r: 1, g: 1, b: 1, a: 1 },
      imageHash: image.hash,
      imageScaleMode: 'FILL',
      visible: true,
      opacity: 1
    }
  ]

  return {
    id: node.id,
    photo: {
      url: req.url,
      width: imgWidth,
      height: imgHeight
    }
  }
}

export const applyPhotoFromUrlTool = defineTool({
  name: 'apply_photo_from_url',
  mutates: true,
  description:
    'Apply a photo from a specific URL to nodes. Pass a JSON array — all fetched in parallel. ' +
    'Each item: {id, url, width?, height?}. Only works on leaf shapes (Rectangle/Ellipse).',
  params: {
    requests: {
      type: 'string',
      description:
        'JSON array: [{"id":"0:5","url":"https://example.com/photo.jpg"},{"id":"0:8","url":"https://example.com/image.png","width":1920,"height":1080}]',
      required: true
    }
  },
  execute: async (figma, { requests }) => {
    let reqs: UrlPhotoRequest[]
    try {
      const parsed = JSON.parse(String(requests))
      reqs = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return { error: 'Invalid JSON in requests' }
    }

    if (reqs.length === 0) return { error: 'Empty requests array' }

    const results = await Promise.all(reqs.map((r) => applyPhotoFromUrl(figma, r)))
    const ok = results.filter((r) => r.photo).length

    return { applied: ok, failed: results.length - ok, results }
  }
})
