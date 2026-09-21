/** Client-side downscale so an uploaded cover image stays small enough to live in the database. */
const MAX_BYTES_HINT = 400 * 1024

export async function fileToOptimisedDataUrl(
  file: File,
  maxEdge = 1400,
  quality = 0.82,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files can be uploaded.')
  }
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  let q = quality
  let dataUrl = canvas.toDataURL('image/jpeg', q)
  // Step the quality down until the encoded payload is a sensible size.
  while (dataUrl.length * 0.75 > MAX_BYTES_HINT && q > 0.4) {
    q -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', q)
  }
  return dataUrl
}

export function isInlineImage(src: string | null | undefined): boolean {
  return typeof src === 'string' && src.startsWith('data:image/')
}
