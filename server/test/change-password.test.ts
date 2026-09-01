import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool, truncateAll } from './helpers/db.js'
import { createTestApp, registerUser, type TestSession } from './helpers/app.js'

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

function changePassword(
  session: TestSession,
  current: string,
  next: string,
  token = session.accessToken,
) {
  return app.inject({
    method: 'POST',
    url: '/api/profile/password',
    headers: { authorization: `Bearer ${token}` },
    payload: { current_password: current, new_password: next },
  })
}

describe('смена пароля', () => {
  it('меняет пароль, гасит старые сессии и оставляет текущее устройство в приложении', async () => {
    const session = await registerUser(app, 'old-password')

    const res = await changePassword(session, 'old-password', 'new-password')
    expect(res.statusCode).toBe(200)

    const next = res.json().session
    expect(next.access_token).toBeTruthy()
    expect(next.refresh_token).not.toBe(session.refreshToken)

    // Новый access-токен работает…
    const withNew = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${next.access_token}` },
    })
    expect(withNew.statusCode).toBe(200)

    // …а старый мёртв сразу, а не через ACCESS_TOKEN_TTL.
    const withOld = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(withOld.statusCode).toBe(401)

    // Старый refresh-токен тоже отозван.
    const oldRefresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: session.refreshToken },
    })
    expect(oldRefresh.statusCode).toBe(401)
  })

  it('вход работает по новому паролю и не работает по старому', async () => {
    const session = await registerUser(app, 'old-password')
    expect((await changePassword(session, 'old-password', 'new-password')).statusCode).toBe(200)

    const withNew = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: session.email, password: 'new-password' },
    })
    expect(withNew.statusCode).toBe(200)

    const withOld = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: session.email, password: 'old-password' },
    })
    expect(withOld.statusCode).toBe(401)
  })

  it('неверный текущий пароль даёт 400, а не 401', async () => {
    const session = await registerUser(app, 'old-password')

    const res = await changePassword(session, 'wrong-password', 'new-password')

    // Именно 400: на 401 клиент запустил бы прозрачный refresh с ротацией
    // токена — то есть опечатка ломала бы параллельную вкладку.
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_CURRENT_PASSWORD')

    // Сессия при этом должна остаться рабочей.
    const stillIn = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(stillIn.statusCode).toBe(200)
  })

  it('новый пароль, совпадающий с текущим, отвергается', async () => {
    const session = await registerUser(app, 'old-password')
    const res = await changePassword(session, 'old-password', 'old-password')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('PASSWORD_SAME')
  })
})

describe('политика паролей', () => {
  it('короткий пароль отвергается кодом WEAK_PASSWORD', async () => {
    const session = await registerUser(app, 'old-password')
    const res = await changePassword(session, 'old-password', 'kor')
    expect(res.statusCode).toBe(400)
    // Не VALIDATION_ERROR: клиенту нужен конкретный текст про длину.
    expect(res.json().error.code).toBe('WEAK_PASSWORD')
  })

  it('register тоже отдаёт WEAK_PASSWORD, а не VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'short@example.com', password: 'kor' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('WEAK_PASSWORD')
  })

  it('пароль длиннее 72 байт отвергается, а не обрезается bcrypt-ом', async () => {
    const session = await registerUser(app, 'old-password')

    // 73 байта в ASCII.
    const tooLong = 'a'.repeat(73)
    const res = await changePassword(session, 'old-password', tooLong)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('PASSWORD_TOO_LONG')

    // Кириллица — 2 байта на символ: 37 символов это уже 74 байта.
    const cyrillic = 'п'.repeat(37)
    expect(Buffer.byteLength(cyrillic, 'utf8')).toBeGreaterThan(72)
    const res2 = await changePassword(session, 'old-password', cyrillic)
    expect(res2.statusCode).toBe(400)
    expect(res2.json().error.code).toBe('PASSWORD_TOO_LONG')
  })

  it('пароль ровно в 72 байта принимается', async () => {
    const session = await registerUser(app, 'old-password')
    const exact = 'a'.repeat(72)
    const res = await changePassword(session, 'old-password', exact)
    expect(res.statusCode).toBe(200)
  })
})

describe('конкурентная смена пароля', () => {
  it('две параллельные смены не могут обе завершиться успехом', async () => {
    const session = await registerUser(app, 'old-password')

    const [a, b] = await Promise.all([
      changePassword(session, 'old-password', 'first-password'),
      changePassword(session, 'old-password', 'second-password'),
    ])

    const okCount = [a, b].filter((r) => r.statusCode === 200).length
    // Главный инвариант — ровно один успех.
    expect(okCount).toBe(1)

    // У проигравшего три законных исхода, и какой именно — зависит от того,
    // насколько далеко он успел пройти до коммита победителя:
    //   401 — его authenticate случился уже после роста session_version;
    //   409 PASSWORD_CHANGED_CONCURRENTLY — прочитал старый хэш, но проиграл CAS;
    //   400 INVALID_CURRENT_PASSWORD — прочитал уже обновлённый хэш, и его
    //       «текущий пароль» действительно перестал быть текущим.
    const loser = a.statusCode === 200 ? b : a
    expect([400, 401, 409]).toContain(loser.statusCode)
    if (loser.statusCode !== 401) {
      expect([
        'PASSWORD_CHANGED_CONCURRENTLY',
        'INVALID_CURRENT_PASSWORD',
      ]).toContain(loser.json().error.code)
    }

    // Победивший пароль должен реально работать — «потерянных» смен нет.
    const winner = a.statusCode === 200 ? 'first-password' : 'second-password'
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: session.email, password: winner },
    })
    expect(login.statusCode).toBe(200)
  })
})
