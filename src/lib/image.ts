/**
 * Photographs are shrunk in the browser before they are uploaded.
 *
 * A camera JPEG is several megabytes of detail that no one looking at a card
 * on a phone will ever see. Downscaling here costs a few hundred milliseconds
 * on the machine that already has the file open, and saves the club storage,
 * bandwidth and load time on every visit afterwards.
 *
 * The result is a JPEG blob rather than a data URL: the image is uploaded to
 * object storage rather than carried inside the database row.
 */
const MAX_BYTES_HINT = 400 * 1024

export async function fileToOptimisedImage(
  file: File,
  maxEdge = 1400,
  quality = 0.82,
): Promise<Blob> {
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

  const encode = (q: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('This browser cannot process images.'))),
        'image/jpeg',
        q,
      )
    })

  // Step the quality down until the encoded image is a sensible size. The
  // measurement is of the bytes that will actually be uploaded.
  let q = quality
  let blob = await encode(q)
  while (blob.size > MAX_BYTES_HINT && q > 0.4) {
    q -= 0.1
    blob = await encode(q)
  }
  return blob
}
