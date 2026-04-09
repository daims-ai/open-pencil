import { prepareWithSegments, walkLineRanges, layoutWithLines } from '@chenglou/pretext'

import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../constants'
import { defineTool } from './schema'

function buildFontString(
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
  italic?: boolean
): string {
  const style = italic ? 'italic ' : ''
  const weight = fontWeight !== 400 ? `${fontWeight} ` : ''
  return `${style}${weight}${fontSize}px "${fontFamily}"`
}

export const measureTextLayout = defineTool({
  name: 'measure_text_layout',
  description:
    'Measure the layout of a text node using pretext. Returns the width, height, and line count without requiring CanvasKit.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    maxWidth: {
      type: 'number',
      description:
        'Optional max width override. If not provided, uses node width or infinite for auto-width text.',
      required: false
    }
  },
  execute: async (figma, { id, maxWidth }) => {
    try {
      const node = figma.getNodeById(id)
      if (!node) return { error: `Node "${id}" not found` }
      if (node.type !== 'TEXT') return { error: `Node "${id}" is not a TEXT node` }

      const raw = figma.graph.getNode(id)
      if (!raw?.text) return { error: `Node "${id}" has no text content` }

      const fontSize = raw.fontSize || DEFAULT_FONT_SIZE
      const fontWeight = raw.fontWeight || 400
      const fontFamily = raw.fontFamily || DEFAULT_FONT_FAMILY
      const lineHeight = raw.lineHeight || fontSize * 1.2

      const font = buildFontString(fontSize, fontWeight, fontFamily, raw.italic)

      const layoutWidth =
        maxWidth !== undefined
          ? maxWidth
          : raw.textAutoResize === 'WIDTH_AND_HEIGHT'
            ? 1e6
            : raw.width || 1e6

      const prepared = prepareWithSegments(raw.text, font)

      let contentWidth = 0
      walkLineRanges(prepared, layoutWidth, (line) => {
        if (line.width > contentWidth) contentWidth = line.width
      })

      const result = layoutWithLines(prepared, layoutWidth, lineHeight)

      const finalWidth =
        raw.textAutoResize === 'WIDTH_AND_HEIGHT' ? Math.ceil(contentWidth) : Math.ceil(layoutWidth)

      return {
        width: finalWidth,
        height: Math.ceil(result.height),
        lineCount: result.lineCount,
        contentWidth: Math.ceil(contentWidth),
        lines: result.lines.map((line, i) => ({
          index: i,
          text: line.text,
          width: Math.ceil(line.width)
        })),
        fontSize,
        fontFamily,
        fontWeight,
        lineHeight,
        textAutoResize: raw.textAutoResize
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: `Failed to measure text layout: ${message}` }
    }
  }
})
