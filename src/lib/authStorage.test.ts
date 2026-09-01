import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSessionRecord } from '@/lib/db'

/**
 * IndexedDB подменяем управляемым моком: важна не сама запись, а то, что
 * медленная операция, начатая раньше, не может завершиться последней и
 * затереть более свежую сессию.
 */
const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  putDelayMs: 0,
}))

vi.mock('@/lib/db', () => ({
  getDB: async () => ({
    put: async (_store: string, record: AuthSessionRecord) => {
      if (h.putDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, h.putDelayMs))
      }
      h.store.set('session', record)
    },
    get: async () => h.store.get('session'),
    delete: async () => {
      h.store.delete('session')
    },
  }),
}))

type AuthStorage = typeof import('@/lib/authStorage')
let mod: AuthStorage

function input(token: string) {
  return {
    userId: `user-${token}`,
    email: `${token}@example.com`,
    refreshToken: token,
    refreshExpiresAt: Date.now() + 60_000,
    persistent: true,
  }
}

beforeEach(async () => {
  h.store.clear()
  h.putDelayMs = 0
  sessionStorage.clear()
  // Свежий модуль на каждый тест: sessionEpoch живёт в модульной области.
  vi.resetModules()
  mod = await import('@/lib/authStorage')
})

describe('epoch-guard', () => {
  it('условная запись с устаревшим поколением не применяется', async () => {
    const stale = mod.getSessionEpoch()
    await mod.saveAuthSession(input('new'))

    const commit = vi.fn()
    const applied = await mod.saveAuthSessionIfCurrent(input('stale'), stale, commit)

    expect(applied).toBe(false)
    expect(commit).not.toHaveBeenCalled()
    expect((await mod.loadAuthSession())?.refreshToken).toBe('new')
  })

  it('условная запись с актуальным поколением применяется вместе с commit', async () => {
    const epoch = mod.getSessionEpoch()
    const commit = vi.fn()

    const applied = await mod.saveAuthSessionIfCurrent(input('fresh'), epoch, commit)

    expect(applied).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    expect((await mod.loadAuthSession())?.refreshToken).toBe('fresh')
  })
})

describe('сериализация мутаций', () => {
  it('зависший refresh не затирает сессию, выданную позже', async () => {
    // Сценарий из ревью: tryRefresh прошёл проверку, начал долгую запись в IDB,
    // а в это время сброс пароля записал новую сессию.
    const staleEpoch = mod.getSessionEpoch()
    h.putDelayMs = 50

    const slowRefresh = mod.saveAuthSessionIfCurrent(input('from-refresh'), staleEpoch)
    // Безусловная запись — логин/сброс пароля, она обязана победить.
    const reset = mod.saveAuthSession(input('from-reset'))

    const [applied] = await Promise.all([slowRefresh, reset])

    const finalToken = (await mod.loadAuthSession())?.refreshToken
    // Победитель определяется порядком в очереди, но итог обязан быть
    // согласованным: если refresh успел записаться первым, сброс перезаписал
    // его следом; если первым был сброс — refresh увидел смену поколения.
    expect(finalToken).toBe('from-reset')
    if (applied) {
      // refresh отработал раньше сброса — поколение выросло дважды.
      expect(mod.getSessionEpoch()).toBe(staleEpoch + 2)
    } else {
      expect(mod.getSessionEpoch()).toBe(staleEpoch + 1)
    }
  })

  it('упавшая операция не обрывает очередь', async () => {
    const boom = mod
      .withSessionLock(async () => {
        throw new Error('boom')
      })
      .catch(() => 'handled')

    const after = mod.saveAuthSession(input('after-failure'))

    expect(await boom).toBe('handled')
    await after
    expect((await mod.loadAuthSession())?.refreshToken).toBe('after-failure')
  })

  it('clearAuthSessionIfCurrent не гасит уже обновлённую сессию', async () => {
    const stale = mod.getSessionEpoch()
    await mod.saveAuthSession(input('live'))

    const cleared = await mod.clearAuthSessionIfCurrent(stale)

    expect(cleared).toBe(false)
    expect((await mod.loadAuthSession())?.refreshToken).toBe('live')
  })
})
