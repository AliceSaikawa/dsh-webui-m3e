import type { ImageAttachmentRef, PromptContentPart } from '../services.ts'

export interface MockImageLimits {
  maxImagesPerMessage: number; maxMessageImageBytes: number; maxImageBytes: number
  maxImagePixels: number; maxImageDimension: number
}
const defaults: MockImageLimits = { maxImagesPerMessage: 20, maxMessageImageBytes: 209715200, maxImageBytes: 20971520, maxImagePixels: 64e6, maxImageDimension: 8192 }
const invalid = (reason: string): never => { throw Object.assign(new Error('画像のデータを読み込めませんでした。'), { reason }) }

/** Browser-safe admission. Raster re-encoding/storage are intentionally not simulated. */
export function admitMockImages(parts: readonly PromptContentPart[], limits: Partial<MockImageLimits> = {}) {
  const policy = { ...defaults, ...limits }
  const images = parts.filter(part => part.type === 'image').map(part => {
    let bytes: string
    try { bytes = atob(part.data) } catch { return invalid('INVALID_IMAGE_BASE64') }
    if (!part.data || btoa(bytes) !== part.data) return invalid('INVALID_IMAGE_BASE64')
    return { part, data: Uint8Array.from(bytes, c => c.charCodeAt(0)) }
  })
  if (images.length > policy.maxImagesPerMessage) invalid('TOO_MANY_IMAGES')
  if (images.reduce((sum, image) => sum + image.data.length, 0) > policy.maxMessageImageBytes) invalid('IMAGES_TOO_LARGE')
  if (images.some(({ part }) => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(part.mediaType))) invalid('UNSUPPORTED_IMAGE_TYPE')
  return images.map(({ part, data }) => {
    if (data.length > policy.maxImageBytes) invalid('IMAGE_TOO_LARGE')
    const { mediaType, width, height } = dimensions(data)
    if (width * height > policy.maxImagePixels) invalid('IMAGE_TOO_MANY_PIXELS')
    if (Math.max(width, height) > policy.maxImageDimension) invalid('IMAGE_DIMENSION_TOO_LARGE')
    if (mediaType !== part.mediaType) invalid('IMAGE_TYPE_MISMATCH')
    return { data, facts: { mediaType, width, height, bytes: data.length, ...(part.name ? { name: part.name } : {}) } }
  })
}

function dimensions(data: Uint8Array): Pick<ImageAttachmentRef, 'width' | 'height' | 'mediaType'> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const text = (start: number, end: number) => String.fromCharCode(...data.slice(start, end))
  const result = (mediaType: ImageAttachmentRef['mediaType'], width: number, height: number) => {
    if (!width || !height) return invalid('INVALID_IMAGE')
    return { mediaType, width, height }
  }
  if (data.length >= 45 && data[0] === 137 && text(1, 8) === 'PNG\r\n\x1a\n' && text(12, 16) === 'IHDR' && text(data.length - 8, data.length - 4) === 'IEND') {
    return result('image/png', view.getUint32(16), view.getUint32(20))
  }
  if (data.length >= 14 && ['GIF87a', 'GIF89a'].includes(text(0, 6)) && data.at(-1) === 0x3b) return result('image/gif', view.getUint16(6, true), view.getUint16(8, true))
  if (data.length >= 30 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP' && view.getUint32(4, true) + 8 === data.length) {
    if (text(12, 16) === 'VP8X') return result('image/webp', 1 + (data[24]! | data[25]! << 8 | data[26]! << 16), 1 + (data[27]! | data[28]! << 8 | data[29]! << 16))
    if (text(12, 16) === 'VP8L' && data[20] === 0x2f) return result('image/webp', 1 + (view.getUint32(21, true) & 0x3fff), 1 + ((view.getUint32(21, true) >>> 14) & 0x3fff))
    if (text(12, 16) === 'VP8 ' && text(23, 26) === '\x9d\x01\x2a') return result('image/webp', view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9) {
    for (let offset = 2; offset + 8 < data.length;) {
      if (data[offset++] !== 0xff) break
      const marker = data[offset++]!
      if (marker === 0xff) { offset--; continue }
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > data.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return result('image/jpeg', view.getUint16(offset + 5), view.getUint16(offset + 3))
      offset += length
    }
  }
  return invalid('INVALID_IMAGE')
}
