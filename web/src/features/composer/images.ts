import type { PreparedImage } from './types.ts'
import { fitImageDimensions, shouldConvertImage } from './helpers.ts'
import { createPreparedImage } from './image-content.ts'
import { composerText } from './messages.ts'
import { LocalizedError } from './localized-error.ts'

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new LocalizedError(composerText().imageReadAgain))
    reader.onerror = () => reject(new LocalizedError(composerText().imageReadAgain))
    reader.onabort = () => reject(new LocalizedError(composerText().imageReadAborted))
    reader.readAsDataURL(file)
  })
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
      ? resolve(image)
      : reject(new LocalizedError(composerText().dimensionsUnreadable))
    image.onerror = () => reject(new LocalizedError(composerText().imageUnreadableConvert))
    image.src = dataUrl
  })
}

/** Browser-local preparation; the image is sent inline as base64, without upload RPC. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let previewUrl = await readDataUrl(file)
  const image = await decodeImage(previewUrl)
  const dimensions = fitImageDimensions(image.naturalWidth, image.naturalHeight)
  let mediaType = file.type
  let name = file.name || composerText().imageFallbackName

  if (shouldConvertImage(mediaType, image.naturalWidth, image.naturalHeight)) {
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new LocalizedError(composerText().imageConvertFailed)
    try {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      previewUrl = canvas.toDataURL('image/jpeg', 0.9)
      if (!previewUrl.startsWith('data:image/jpeg;base64,')) throw new Error('JPEG')
    } catch {
      throw new LocalizedError(composerText().imageConvertFailed)
    }
    mediaType = 'image/jpeg'
    name = `${name.replace(/\.[^.]+$/u, '') || composerText().imageFallbackName}.jpg`
  }

  return createPreparedImage({ name, previewUrl, ...dimensions, mediaType })
}
