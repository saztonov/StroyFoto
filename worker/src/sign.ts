import { AwsClient } from 'aws4fetch'

interface Env {
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET: string
}

const TTL_PUT_GET = 60 * 5 // 5 минут
const TTL_DELETE = 60

export interface SignedUrl {
  url: string
  method: 'PUT' | 'GET' | 'DELETE'
  headers: Record<string, string>
  expiresAt: number
}

/**
 * Считает SigV4 presigned URL к Cloudflare R2 (S3-совместимый endpoint).
 * Никаких сетевых вызовов в R2 здесь не делаем — только подпись.
 */
export async function presignR2(
  env: Env,
  op: 'put' | 'get' | 'delete',
  key: string,
  contentType?: string,
): Promise<SignedUrl> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  })

  const method = (op === 'put' ? 'PUT' : op === 'get' ? 'GET' : 'DELETE') as
    | 'PUT'
    | 'GET'
    | 'DELETE'
  const expires = op === 'delete' ? TTL_DELETE : TTL_PUT_GET

  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${encodeURI(
    key,
  )}?X-Amz-Expires=${expires}`

  // aws4fetch.sign возвращает объект Request с подписью в URL (для query-signed).
  const signedReq = await client.sign(
    new Request(endpoint, {
      method,
      headers:
        op === 'put' && contentType
          ? { 'Content-Type': contentType }
          : undefined,
    }),
    {
      aws: { signQuery: true },
    },
  )

  const headers: Record<string, string> = {}
  if (op === 'put' && contentType) headers['Content-Type'] = contentType

  return {
    url: signedReq.url,
    method,
    headers,
    expiresAt: Math.floor(Date.now() / 1000) + expires,
  }
}
