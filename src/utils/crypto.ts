/** SHA-256 哈希，返回十六进制字符串。 */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 生成随机 API Key：mw_ + 32 位随机 */
export function generateApiKey(_type: 'readonly' | 'readwrite'): string {
  const random = crypto.getRandomValues(new Uint8Array(24))
  const chars = [...random]
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 32)
  return `mw_${chars}`
}
