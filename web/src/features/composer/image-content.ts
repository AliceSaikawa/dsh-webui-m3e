import { isSupportedImageMediaType } from './helpers.ts'
import type { PreparedImage } from './types.ts'

// Images stay in this tab's memory, so IDs only need to be unique within this module.
let nextImageId = 0

export function createPreparedImage({ name, previewUrl, width, height, mediaType }: {
  name: string; previewUrl: string; width: number; height: number; mediaType: string
}): PreparedImage {
  if (!isSupportedImageMediaType(mediaType)) throw new Error('この画像形式には対応していません。')
  const comma = previewUrl.indexOf(',')
  if (comma < 0 || !previewUrl.slice(0, comma).endsWith(';base64') || previewUrl.slice(comma + 1).length === 0) {
    throw new Error('画像のデータを読み取れませんでした。')
  }
  return {
    id: `composer-image-${++nextImageId}`, name, previewUrl, width, height,
    prompt: { type: 'image', mediaType, data: previewUrl.slice(comma + 1), name },
    attachment: { type: 'image', value: { previewUrl, name, width, height } },
  }
}
