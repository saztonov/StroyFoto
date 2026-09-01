import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool, truncateAll } from './helpers/db.js'
import { createTestApp, registerUser } from './helpers/app.js'

let app: FastifyInstance

beforeEach(async () => {
  await truncateAll()
  app = await createTestApp()
})

afterEach(async () => {
  await app.close()
})

afterAll(async () => {
  await pool.end()
})

describe('регресс существующего auth', () => {
  it('register выдаёт сессию и создаёт неактивный профиль', async () => {
    const session = await registerUser(app)
    expect(session.accessToken).toBeTruthy()
    expect(session.refreshToken).toBeTruthy()

    const { rows } = await pool.query(
      'SELECT is_active FROM profiles WHERE id = $1',
      [session.userId],
    )
    expect(rows[0].is_active).toBe(false)
  })

  it('login с верным паролем выдаёт сессию, с неверным — 401', async () => {
    const { email } = await registerUser(app, 'correct-horse')

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'correct-horse' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().session.access_token).toBeTruthy()

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'wrong-password' },
    })
    expect(bad.statusCode).toBe(401)
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS')
  })

  it('refresh ротирует токен, logout его гасит', async () => {
    const session = await registerUser(app)

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: session.refreshToken },
    })
    expect(refreshed.statusCode).toBe(200)
    const next = refreshed.json().session.refresh_token
    expect(next).not.toBe(session.refreshToken)

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${refreshed.json().session.access_token}` },
      payload: { refresh_token: next },
    })
    expect(loggedOut.statusCode).toBe(200)

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: next },
    })
    expect(afterLogout.statusCode).toBe(401)
  })

  it('GET /api/auth/me принимает свежий access-токен', async () => {
    const session = await registerUser(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().session.user.id).toBe(session.userId)
  })
})

describe('session_version гасит выданные сессии', () => {
  it('access-JWT отвергается сразу после роста session_version', async () => {
    const session = await registerUser(app)

    const before = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(before.statusCode).toBe(200)

    // Именно это делают смена и сброс пароля.
    await pool.query(
      'UPDATE app_users SET session_version = session_version + 1 WHERE id = $1',
      [session.userId],
    )

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    // Без проверки sv токен жил бы ещё до ACCESS_TOKEN_TTL (15 минут).
    expect(after.statusCode).toBe(401)
  })

  it('refresh-токен с отставшим поколением не даёт сессию', async () => {
    const session = await registerUser(app)
    await pool.query(
      'UPDATE app_users SET session_version = session_version + 1 WHERE id = $1',
      [session.userId],
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: session.refreshToken },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('INVALID_REFRESH')
  })
})

describe('ротация refresh-токена', () => {
  it('после отзыва всех токенов refresh не создаёт живую строку', async () => {
    const session = await registerUser(app)

    // Ровно то, что сделает revokeAllForUser при смене пароля.
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1',
      [session.userId],
    )

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: session.refreshToken },
    })
    expect(res.statusCode).toBe(401)

    // Ключевая проверка: старый код вставлял новый токен ДО отзыва старого и
    // не смотрел на rowCount, поэтому «отзыв всех сессий» оставлял живую.
    const live = await pool.query(
      `SELECT count(*)::int AS n FROM refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [session.userId],
    )
    expect(live.rows[0].n).toBe(0)
  })

  it('повторное использование уже проротированного токена гасит цепочку', async () => {
    const session = await registerUser(app)

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: session.refreshToken },
    })
    expect(first.statusCode).toBe(200)

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: session.refreshToken },
    })
    expect(reuse.statusCode).toBe(401)

    const live = await pool.query(
      `SELECT count(*)::int AS n FROM refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [session.userId],
    )
    expect(live.rows[0].n).toBe(0)
  })
})
