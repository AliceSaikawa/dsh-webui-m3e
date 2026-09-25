import type { PreparedImage } from './types.ts'
import { fitImageDimensions, isSupportedImageMediaType, shouldConvertImage } from './helpers.ts'

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('画像を読み込めませんでした。もう一度選んでください。'))
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。もう一度選んでください。'))
    reader.onabort = () => reject(new Error('画像の読み込みが中断されました。'))
    reader.readAsDataURL(file)
  })
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
      ? resolve(image)
      : reject(new Error('画像の大きさを読み取れませんでした。'))
    image.onerror = () => reject(new Error('この画像を読み込めませんでした。PNG または JPEG に変換して選び直してください。'))
    image.src = dataUrl
  })
}

/** Browser-local preparation; the image is sent inline as base64, without upload RPC. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let previewUrl = await readDataUrl(file)
  const image = await decodeImage(previewUrl)
  const dimensions = fitImageDimensions(image.naturalWidth, image.naturalHeight)
  let mediaType = file.type
  let name = file.name || '画像'

  if (shouldConvertImage(mediaType, image.naturalWidth, image.naturalHeight)) {
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画像を変換できませんでした。PNG または JPEG を選んでください。')
    try {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      previewUrl = canvas.toDataURL('image/jpeg', 0.9)
      if (!previewUrl.startsWith('data:image/jpeg;base64,')) throw new Error('JPEG')
    } catch {
      throw new Error('画像を変換できませんでした。PNG または JPEG を選んでください。')
    }
    mediaType = 'image/jpeg'
    name = `${name.replace(/\.[^.]+$/u, '') || '画像'}.jpg`
  }

  if (!isSupportedImageMediaType(mediaType)) throw new Error('この画像形式には対応していません。')
  const comma = previewUrl.indexOf(',')
  if (comma < 0 || !previewUrl.slice(0, comma).endsWith(';base64') || previewUrl.slice(comma + 1).length === 0) {
    throw new Error('画像のデータを読み取れませんでした。')
  }
  const { width, height } = dimensions
  return {
    id: crypto.randomUUID(), name, previewUrl, width, height,
    prompt: { type: 'image', mediaType, data: previewUrl.slice(comma + 1), name },
    attachment: { type: 'image', value: { previewUrl, name, width, height } },
  }
}
