import { isSupportedImageMediaType } from './helpers.ts'
import { composerText } from './messages.ts'
import type { PreparedImage } from './types.ts'
import { LocalizedError } from './localized-error.ts'

// Images stay in this tab's memory, so IDs only need to be unique within this module.
let nextImageId = 0

export function createPreparedImage({ name, previewUrl, width, height, mediaType }: {
  name: string; previewUrl: string; width: number; height: number; mediaType: string
}): PreparedImage {
  if (!isSupportedImageMediaType(mediaType)) throw new LocalizedError(composerText().imageTypeUnsupported)
  const comma = previewUrl.indexOf(',')
  if (comma < 0 || !previewUrl.slice(0, comma).endsWith(';base64') || previewUrl.slice(comma + 1).length === 0) {
    throw new LocalizedError(composerText().imageDataUnreadable)
  }
  return {
    id: `composer-image-${++nextImageId}`, name, previewUrl, width, height,
    prompt: { type: 'image', mediaType, data: previewUrl.slice(comma + 1), name },
    attachment: { type: 'image', value: { previewUrl, name, width, height } },
  }
}
