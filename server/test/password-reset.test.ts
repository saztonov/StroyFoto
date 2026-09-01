import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool, truncateAll } from './helpers/db.js'
import {
  createTestApp,
  makeAdmin,
  registerUser,
  type TestSession,
} from './helpers/app.js'

let app: FastifyInstance
let admin: TestSession

beforeEach(async () => {
  await truncateAll()
  app = await createTestApp()
  admin = await registerUser(app, 'admin-password')
  await makeAdmin(admin.userId)
})
afterEach(async () => {
  await app.close()
})
afterAll(async () => {
  await pool.end()
})

function requestReset(email: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/password-reset/request',
    payload: { email },
  })
}

async function issueLink(userId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/password-resets',
    headers: { authorization: `Bearer ${admin.accessToken}` },
    payload: { user_id: userId },
  })
  if (res.statusCode !== 200) {
    throw new Error(`выдача ссылки вернула ${res.statusCode}: ${res.body}`)
  }
  return res.json().token as string
}

function confirmReset(token: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/password-reset/confirm',
    payload: { token, password },
  })
}

function checkToken(token: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/password-reset/check',
    payload: { token },
  })
}

/** Сдвигает время последней заявки назад, чтобы обойти cooldown. */
async function ageRequest(userId: string) {
  await pool.query(
    `UPDATE password_reset_requests
        SET last_requested_at = now() - interval '1 hour'
      WHERE user_id = $1`,
    [userId],
  )
}

describe('заявка пользователя', () => {
  it('неизвестный адрес не отличим от известного и не создаёт строк', async () => {
    const user = await registerUser(app)

    const known = await requestReset(user.email)
    const unknown = await requestReset('nobody@example.com')

    expect(known.statusCode).toBe(202)
    expect(unknown.statusCode).toBe(202)
    expect(unknown.body).toBe(known.body)

    const { rows } = await pool.query(
      'SELECT user_id FROM password_reset_requests',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(user.userId)
  })

  it('заявка от неактивного пользователя всё равно создаётся', async () => {
    // Ожидание активации и восстановление доступа — разные вещи.
    const user = await registerUser(app)
    const { rows } = await pool.query(
      'SELECT is_active FROM profiles WHERE id = $1',
      [user.userId],
    )
    expect(rows[0].is_active).toBe(false)

    await requestReset(user.email)
    const created = await pool.query(
      'SELECT status FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )
    expect(created.rows[0].status).toBe('pending')
  })

  it('повтор внутри cooldown не растит счётчик, после — растит', async () => {
    const user = await registerUser(app)
    await requestReset(user.email)
    await requestReset(user.email)

    let counter = await pool.query<{ request_count: number }>(
      'SELECT request_count FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )
    expect(counter.rows[0].request_count).toBe(1)

    await ageRequest(user.userId)
    await requestReset(user.email)

    counter = await pool.query(
      'SELECT request_count FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )
    expect(counter.rows[0].request_count).toBe(2)
  })
})

describe('жизненный цикл ссылки', () => {
  it('проверка ссылки не расходует её', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)

    const first = await checkToken(token)
    const second = await checkToken(token)
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    // Адрес маскирован: ссылка ходит мессенджерами.
    expect(first.json().email_masked).toContain('****@')
    expect(first.json().email_masked).not.toBe(user.email)

    // И после двух проверок ссылка всё ещё рабочая.
    expect((await confirmReset(token, 'brand-new-password')).statusCode).toBe(200)
  })

  it('сброс меняет пароль, гасит все сессии и помечает заявку использованной', async () => {
    const user = await registerUser(app, 'old-password')
    const token = await issueLink(user.userId)

    const before = await pool.query<{ session_version: number }>(
      'SELECT session_version FROM app_users WHERE id = $1',
      [user.userId],
    )

    const res = await confirmReset(token, 'brand-new-password')
    expect(res.statusCode).toBe(200)
    expect(res.json().session.refresh_token).toBeTruthy()

    const row = await pool.query(
      `SELECT status, used_at, token_hash FROM password_reset_requests
        WHERE user_id = $1`,
      [user.userId],
    )
    expect(row.rows[0].status).toBe('used')
    expect(row.rows[0].used_at).not.toBeNull()
    // Хэш намеренно НЕ обнуляется: по нему отличаем «уже использована» от
    // «такой ссылки не существует».
    expect(row.rows[0].token_hash).not.toBeNull()

    const after = await pool.query<{ session_version: number }>(
      'SELECT session_version FROM app_users WHERE id = $1',
      [user.userId],
    )
    expect(after.rows[0].session_version).toBe(before.rows[0].session_version + 1)

    // Старый access-токен мёртв сразу.
    const withOld = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${user.accessToken}` },
    })
    expect(withOld.statusCode).toBe(401)

    // Вход по новому паролю работает, по старому — нет.
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'brand-new-password' },
    })
    expect(newLogin.statusCode).toBe(200)
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'old-password' },
    })
    expect(oldLogin.statusCode).toBe(401)
  })

  it('повторное использование ссылки отвергается с отдельным кодом', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)

    expect((await confirmReset(token, 'brand-new-password')).statusCode).toBe(200)

    const again = await confirmReset(token, 'another-password')
    expect(again.statusCode).toBe(410)
    expect(again.json().error.code).toBe('RESET_TOKEN_USED')
  })

  it('истёкшая ссылка отвергается', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)
    await pool.query(
      `UPDATE password_reset_requests
          SET token_expires_at = now() - interval '1 minute'
        WHERE user_id = $1`,
      [user.userId],
    )

    const res = await confirmReset(token, 'brand-new-password')
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe('RESET_TOKEN_EXPIRED')
  })

  it('несуществующая ссылка отвергается как недействительная', async () => {
    const res = await confirmReset('definitely-not-a-real-token', 'brand-new-password')
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('RESET_TOKEN_INVALID')
  })

  it('выдача новой ссылки гасит предыдущую', async () => {
    const user = await registerUser(app)
    const first = await issueLink(user.userId)
    const second = await issueLink(user.userId)
    expect(second).not.toBe(first)

    const oldOne = await confirmReset(first, 'brand-new-password')
    expect(oldOne.statusCode).toBe(404)
    expect((await confirmReset(second, 'brand-new-password')).statusCode).toBe(200)
  })

  it('повторная заявка гасит уже выданную ссылку и возвращает строку в очередь', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)
    await ageRequest(user.userId)

    // Пользователь говорит «ссылка не дошла» и просит заново.
    expect((await requestReset(user.email)).statusCode).toBe(202)

    const row = await pool.query(
      'SELECT status, token_hash FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )
    expect(row.rows[0].status).toBe('pending')
    expect(row.rows[0].token_hash).toBeNull()

    const dead = await confirmReset(token, 'brand-new-password')
    expect(dead.statusCode).toBe(404)
  })
})

describe('очередь администратора', () => {
  it('обычный пользователь не видит и не выдаёт заявки', async () => {
    const user = await registerUser(app)
    await pool.query(`UPDATE profiles SET is_active = true WHERE id = $1`, [
      user.userId,
    ])

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/password-resets',
      headers: { authorization: `Bearer ${user.accessToken}` },
    })
    expect(list.statusCode).toBe(403)

    const issue = await app.inject({
      method: 'POST',
      url: '/api/admin/password-resets',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { user_id: user.userId },
    })
    expect(issue.statusCode).toBe(403)
  })

  it('в списке видно заявку с ФИО, адресом и признаком истёкшей ссылки', async () => {
    const user = await registerUser(app)
    await requestReset(user.email)

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/password-resets',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    })
    expect(list.statusCode).toBe(200)
    const requests = list.json().requests as Array<Record<string, unknown>>
    const mine = requests.find((r) => r.user_id === user.userId)!
    expect(mine.email).toBe(user.email)
    expect(mine.full_name).toBe('Тест Тестович')
    expect(mine.status).toBe('pending')
    expect(mine.link_expired).toBe(false)
  })

  it('отклонённую заявку нельзя отклонить повторно, ссылка перестаёт работать', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )
    const id = rows[0].id

    const cancel = async () =>
      app.inject({
        method: 'POST',
        url: `/api/admin/password-resets/${id}/cancel`,
        headers: { authorization: `Bearer ${admin.accessToken}` },
      })

    expect((await cancel()).statusCode).toBe(200)

    const again = await cancel()
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('RESET_ALREADY_CLOSED')

    expect((await confirmReset(token, 'brand-new-password')).statusCode).toBe(404)
  })
})

describe('конкурентные сценарии', () => {
  it('два одновременных подтверждения одной ссылки: ровно один успех', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)

    const [a, b] = await Promise.all([
      confirmReset(token, 'first-password'),
      confirmReset(token, 'second-password'),
    ])

    const okCount = [a, b].filter((r) => r.statusCode === 200).length
    expect(okCount).toBe(1)
    const loser = a.statusCode === 200 ? b : a
    expect(loser.json().error.code).toBe('RESET_TOKEN_USED')

    const winner = a.statusCode === 200 ? 'first-password' : 'second-password'
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: winner },
    })
    expect(login.statusCode).toBe(200)
  })

  it('отмена и подтверждение одновременно: побеждает ровно одна операция', async () => {
    const user = await registerUser(app)
    const token = await issueLink(user.userId)
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )

    const [confirmed, cancelled] = await Promise.all([
      confirmReset(token, 'brand-new-password'),
      app.inject({
        method: 'POST',
        url: `/api/admin/password-resets/${rows[0].id}/cancel`,
        headers: { authorization: `Bearer ${admin.accessToken}` },
      }),
    ])

    // Обе не могут преуспеть: иначе пароль сменён по «отменённой» заявке.
    const okCount = [confirmed, cancelled].filter((r) => r.statusCode === 200).length
    expect(okCount).toBe(1)

    const final = await pool.query<{ status: string }>(
      'SELECT status FROM password_reset_requests WHERE user_id = $1',
      [user.userId],
    )
    expect(['used', 'cancelled']).toContain(final.rows[0].status)
    // Состояние согласовано: пароль сменился тогда и только тогда, когда
    // победило подтверждение.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'brand-new-password' },
    })
    expect(login.statusCode).toBe(confirmed.statusCode === 200 ? 200 : 401)
  })

  it('сброс обесценивает refresh-токен, полученный до него', async () => {
    const user = await registerUser(app, 'old-password')
    const token = await issueLink(user.userId)

    expect((await confirmReset(token, 'brand-new-password')).statusCode).toBe(200)

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refresh_token: user.refreshToken },
    })
    expect(res.statusCode).toBe(401)
  })
})
