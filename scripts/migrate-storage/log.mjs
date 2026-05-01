// Минималистичный цветной логгер + JSONL-журнал. Никаких сторонних
// зависимостей: ANSI-коды напрямую, fs.appendFileSync для журнала.
//
// Использование:
//   import { log } from './log.mjs'
//   log.info('всё ок')
//   log.success('перенесено')
//   log.warn('внимание')
//   log.error('упало', err)
//   log.bullet('шаг 1')
//
// JSONL-журнал ошибок (по умолчанию `migration-errors.jsonl` в cwd) пишется
// при `log.recordError(...)` и не зависит от консоли.

import fs from 'node:fs'
import path from 'node:path'

const isTTY = process.stdout.isTTY
const supportsColor = isTTY && process.env.NO_COLOR !== '1'

const c = {
  reset: supportsColor ? '\x1b[0m' : '',
  dim: supportsColor ? '\x1b[2m' : '',
  bold: supportsColor ? '\x1b[1m' : '',
  red: supportsColor ? '\x1b[31m' : '',
  green: supportsColor ? '\x1b[32m' : '',
  yellow: supportsColor ? '\x1b[33m' : '',
  blue: supportsColor ? '\x1b[34m' : '',
  magenta: supportsColor ? '\x1b[35m' : '',
  cyan: supportsColor ? '\x1b[36m' : '',
  gray: supportsColor ? '\x1b[90m' : '',
}

function ts() {
  return new Date().toISOString().slice(11, 19) // HH:MM:SS
}

function indent(text) {
  return String(text).split('\n').join('\n        ')
}

function fmtError(err) {
  if (!err) return ''
  if (err instanceof Error) {
    let out = err.stack ?? err.message
    // У `TypeError: fetch failed` (Node undici) реальная причина лежит в
    // `cause` — там DNS-ошибка, ECONNREFUSED, ETIMEDOUT и т.д. Без её
    // вывода диагностика становится бесполезной.
    if (err.cause) {
      const cause = err.cause instanceof Error
        ? `${err.cause.name}: ${err.cause.message}` +
          (err.cause.code ? ` [${err.cause.code}]` : '')
        : String(err.cause)
      out += `\n  cause: ${cause}`
    }
    return out
  }
  return typeof err === 'string' ? err : JSON.stringify(err)
}

let errorsLogPath = path.resolve(process.cwd(), 'migration-errors.jsonl')

export function setErrorsLogPath(p) {
  errorsLogPath = path.resolve(p)
}

export const log = {
  info(message, ...rest) {
    process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${c.cyan}info${c.reset}    ${message}\n`)
    if (rest.length) console.dir(rest.length === 1 ? rest[0] : rest, { depth: 6, colors: supportsColor })
  },
  success(message) {
    process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${c.green}ok${c.reset}      ${message}\n`)
  },
  warn(message, err) {
    process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${c.yellow}warn${c.reset}    ${message}\n`)
    if (err) process.stdout.write(`        ${c.dim}${indent(fmtError(err))}${c.reset}\n`)
  },
  error(message, err) {
    process.stderr.write(`${c.gray}[${ts()}]${c.reset} ${c.red}error${c.reset}   ${message}\n`)
    if (err) process.stderr.write(`        ${c.dim}${indent(fmtError(err))}${c.reset}\n`)
  },
  bullet(message) {
    process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${c.blue}»${c.reset}       ${message}\n`)
  },
  step(n, total, message) {
    process.stdout.write(`${c.gray}[${ts()}]${c.reset} ${c.magenta}step${c.reset}    ${c.bold}[${n}/${total}]${c.reset} ${message}\n`)
  },
  header(message) {
    const line = '─'.repeat(Math.max(8, message.length + 4))
    process.stdout.write(`\n${c.bold}${line}\n  ${message}\n${line}${c.reset}\n`)
  },
  raw(message) {
    process.stdout.write(message + '\n')
  },
  /**
   * Перезаписываемая прогресс-строка. Работает только в TTY; в pipe просто
   * пишем новую строку. Возвращает функцию завершения, которая ставит \n.
   */
  progress(label) {
    let lastLen = 0
    const write = (text) => {
      if (!isTTY) {
        process.stdout.write(`${label} ${text}\n`)
        return
      }
      // Очистка предыдущей строки + перевод каретки в начало.
      const out = `\r${label} ${text}`
      process.stdout.write(out)
      const padding = lastLen - out.length
      if (padding > 0) process.stdout.write(' '.repeat(padding))
      lastLen = out.length
    }
    return {
      update: write,
      done() {
        if (isTTY) process.stdout.write('\n')
      },
    }
  },
  /**
   * Пишет ошибку в JSONL-файл (по умолчанию migration-errors.jsonl). НИКОГДА
   * не выбрасывает — даже если запись провалилась, мы лишь предупредим в stderr.
   */
  recordError(payload) {
    try {
      const line = JSON.stringify({ at: new Date().toISOString(), ...payload }) + '\n'
      fs.appendFileSync(errorsLogPath, line, 'utf8')
    } catch (e) {
      process.stderr.write(`${c.red}cannot write ${errorsLogPath}:${c.reset} ${fmtError(e)}\n`)
    }
  },
  errorsLogPath() {
    return errorsLogPath
  },
}

export const colors = c
