import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

/**
 * Свежий инстанс приложения на каждый тест.
 *
 * @fastify/rate-limit держит счётчики в памяти инстанса, а на /login и
 * /register стоит лимит 10/мин. Переиспользование одного приложения на весь
 * файл упёрлось бы в 429 — поэтому пересоздаём, а не ослабляем лимит в
 * продовом коде ради тестов.
 */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp()
  await app.ready()
  return app
}

export interface TestSession {
  userId: string
  email: string
  accessToken: string
  refreshToken: string
}

let seq = 0

/** Регистрирует нового пользователя и возвращает его сессию. */
export async function registerUser(
  app: FastifyInstance,
  password = 'correct-horse',
): Promise<TestSession> {
  const email = `user${++seq}.${Date.now()}@example.com`
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, fullName: 'Тест Тестович' },
  })
  if (res.statusCode !== 200) {
    throw new Error(`register вернул ${res.statusCode}: ${res.body}`)
  }
  const body = res.json() as {
    session: { access_token: string; refresh_token: string; user: { id: string } }
  }
  return {
    userId: body.session.user.id,
    email,
    accessToken: body.session.access_token,
    refreshToken: body.session.refresh_token,
  }
}

/** Делает пользователя активным администратором. */
export async function makeAdmin(userId: string): Promise<void> {
  const { pool } = await import('../../src/db.js')
  await pool.query(
    `UPDATE profiles SET role = 'admin', is_active = true WHERE id = $1`,
    [userId],
  )
}
