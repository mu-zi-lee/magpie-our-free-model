import crypto from 'node:crypto'

/** 图片只在本次请求内存中存活，无任意路径读取或远程图片下载。 */
export const attachments = {
  async saveImage({ data, mediaType }) {
    const bytes = Buffer.from(data)
    let type, width, height
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      type = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
    } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) {
      type = 'image/gif'; width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8)
    } else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      type = 'image/jpeg'
      let offset = 2
      while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xff) break
        const marker = bytes[offset + 1]
        const length = bytes.readUInt16BE(offset + 2)
        if (length < 2 || offset + 2 + length > bytes.length) break
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
          height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break
        }
        offset += 2 + length
      }
    } else if (bytes.length >= 30 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
      type = 'image/webp'
      const format = bytes.subarray(12, 16).toString()
      if (format === 'VP8X') { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3) }
      else if (format === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) {
        width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff
      } else if (format === 'VP8L' && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21)
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1
      }
    }
    if (type !== mediaType || !width || !height) throw new Error('图片类型与字节不符，或缺少有效尺寸')
    if (width > 8192 || height > 8192 || bytes.length > 20 * 1024 * 1024) throw new Error('图片超出尺寸或大小限制')
    return { attachmentId: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, mediaType, width, height, bytes: bytes.length, data }
  },
  async readImage(ref) {
    if (!(ref?.data instanceof Uint8Array)) throw new Error('图片引用不属于当前请求')
    return { data: ref.data, ref }
  },
}
