# stroyfoto-signer

Минимальный доверенный Cloudflare Worker для StroyFoto. Единственная задача —
выдавать короткоживущие presigned URL к **приватному** Cloudflare R2 для фото
отчётов и PDF-планов. Доменной бизнес-логики тут нет, проверка прав
делегирована Supabase RLS.

## Архитектура доступа

```
Browser/PWA  ── Bearer JWT ──►  Worker /sign
                                 1) verify JWT через Supabase JWKS (RS/ES)
                                 2) regex-валидация object key
                                 3) проверка прав через Supabase REST + RLS
                                    (с тем же клиентским JWT, без service_role)
                                 4) подпись SigV4 для R2 (aws4fetch)
                                 ◄─── { url, method, headers, expiresAt }
Browser  ── PUT/GET ──►  R2 (приватный bucket)
```

- TTL подписи: 5 минут для PUT/GET, 1 минута для DELETE.
- Bucket остаётся приватным, никакого public access.
- Service role Supabase и R2 secrets **никогда** не покидают Worker.

## Контракт `POST /sign`

Заголовки: `Authorization: Bearer <supabase_access_token>`, `Content-Type: application/json`.

```jsonc
{
  "op": "put" | "get" | "delete",
  "kind": "photo" | "photo_thumb" | "plan",
  "key": "photos/<reportId>/<photoId>.jpg",
  "reportId": "<uuid>",        // для photo / photo_thumb
  "projectId": "<uuid>",       // для plan
  "planId": "<uuid>",          // для plan
  "contentType": "image/jpeg"  // только для op=put: image/jpeg | application/pdf
}
```

Ответ:

```json
{
  "url": "https://<acc>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-...",
  "method": "PUT",
  "headers": { "Content-Type": "image/jpeg" },
  "expiresAt": 1700000000
}
```

Ошибки: `400` неправильный body / key, `401` нет/невалидный JWT, `403` нет
доступа по RLS, `502` Supabase REST недоступен, `500` прочее.

## Object keys

Детерминированные, client-generated, валидируются регексом:

```
photos/{reportId}/{photoId}.jpg
photos/{reportId}/{photoId}-thumb.jpg
plans/{projectId}/{planId}.pdf
```

## Переменные окружения (secrets)

Все ставятся через `wrangler secret put <NAME>`:

| Переменная             | Назначение                                                                |
| ---------------------- | ------------------------------------------------------------------------- |
| `SUPABASE_URL`         | URL Supabase-проекта (для JWKS и PostgREST). Публичный.                   |
| `SUPABASE_ANON_KEY`    | anon JWT, нужен как `apikey` header в PostgREST. Публичный по дизайну.    |
| `R2_ACCOUNT_ID`        | Cloudflare account id.                                                    |
| `R2_ACCESS_KEY_ID`     | R2 access key (роль: object read/write на bucket).                        |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key.                                                     |
| `R2_BUCKET`            | Имя приватного bucket'а.                                                  |
| `ALLOWED_ORIGINS`      | CSV origin'ов фронта, например: `https://stroyfoto.example.com,http://localhost:5173`. |

## Деплой

```bash
cd worker
npm install

# Один раз — авторизация в Cloudflare:
npx wrangler login

# Прописать секреты:
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
npx wrangler secret put ALLOWED_ORIGINS

npx wrangler deploy
```

URL воркера (`https://stroyfoto-signer.<account>.workers.dev` или ваш custom
domain) положите в `VITE_PRESIGN_URL` фронтенда.

## CORS на bucket R2

В Cloudflare Dashboard → R2 → ваш bucket → Settings → CORS Policy:

```json
[
  {
    "AllowedOrigins": ["https://stroyfoto.example.com", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

## Требования к Supabase

Проект Supabase должен использовать **асимметричную подпись JWT**
(Project Settings → API → JWT Signing Keys → "Use new asymmetric keys"),
чтобы Worker мог проверять токены через публичный JWKS endpoint без секретов.

## Локальная разработка

```bash
npx wrangler dev
```

Wrangler поднимет Worker на `http://127.0.0.1:8787`. Установите фронт-эндовый
`VITE_PRESIGN_URL=http://127.0.0.1:8787` для отладки.
