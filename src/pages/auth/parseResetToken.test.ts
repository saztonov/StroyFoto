import { describe, expect, it } from 'vitest'
import { parseResetToken } from '@/pages/auth/parseResetToken'

describe('parseResetToken', () => {
  it('достаёт токен из фрагмента', () => {
    expect(parseResetToken('#token=abc123')).toBe('abc123')
    expect(parseResetToken('token=abc123')).toBe('abc123')
  })

  it('не путается в нескольких параметрах', () => {
    expect(parseResetToken('#foo=1&token=abc123&bar=2')).toBe('abc123')
  })

  it('возвращает null, когда токена нет', () => {
    expect(parseResetToken('')).toBeNull()
    expect(parseResetToken('#')).toBeNull()
    expect(parseResetToken('#other=1')).toBeNull()
    expect(parseResetToken('#token=')).toBeNull()
  })

  it('переживает base64url без искажений', () => {
    // Именно такой алфавит у generateRawToken: base64url безопасен в URL,
    // но содержит «-» и «_», которые легко потерять при наивном парсинге.
    const token = 'aB3-_x9ZqQ-mN_0pR4sT6uV8wX1yZ2aB3cD4eF5gH6i'
    expect(parseResetToken(`#token=${token}`)).toBe(token)
  })
})
