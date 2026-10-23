/**
 * dsh-fs-retry — 给 `fs.writeText` 套一层「同参数重试」。
 *
 * 背景：Windows 上 `ReplaceFileW` 偶发 Win32 1175（ERROR_IO_PENDING / 目标被短暂占用），
 * dsh-fs-local 只对 ENOENT 退回 rename，其它一律抛错。实测同一目录连测 50 轮失败率 20–46%，
 * 而带退避重试后 0/50。这里在插件层补重试，不动安装文件、不碰 ctx.fs 的语义。
 *
 * 只重试 1175；其它错误原样抛出。参数与返回值完全照传，调用方无需改动。
 */

export const name = 'dsh-fs-retry'

export const inject = ['fs']

const ATTEMPTS = 8
const BASE_DELAY_MS = 12
const REPLACE_EIO = /Win32 1175|ReplaceFileW/i

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isReplaceEio(error) {
  const text = `${error?.message ?? error}`
  return REPLACE_EIO.test(text)
}

function wrap(holder, label, receiver) {
  const original = holder?.writeText
  if (typeof original !== 'function') return false
  if (original.__fsRetryWrapped) return true

  const wrapped = async function writeTextWithRetry(...args) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const self = this && typeof this === 'object' && this !== holder ? this : receiver ?? holder
        return await Reflect.apply(original, self, args)
      } catch (error) {
        if (attempt >= ATTEMPTS - 1 || !isReplaceEio(error)) throw error
        console.warn(`[fs-retry] ${label} 第 ${attempt + 1} 次遇到 1175，退避后重试`)
        await sleep(BASE_DELAY_MS * (attempt + 1))
      }
    }
  }
  wrapped.__fsRetryWrapped = true

  try {
    holder.writeText = wrapped
  } catch (error) {
    console.warn(`[fs-retry] 无法改写 ${label}.writeText：${error?.message ?? error}`)
    return false
  }
  return true
}

export function apply(ctx) {
  const fs = ctx.fs
  if (!fs) {
    console.warn('[fs-retry] 没拿到 ctx.fs，跳过')
    return
  }
  const proto = Object.getPrototypeOf(fs)
  const onProto = proto && proto !== Object.prototype ? wrap(proto, 'fs 原型', fs) : false
  const onInstance = wrap(fs, 'fs 实例', fs)
  console.info(`[fs-retry] 已装载（原型 ${onProto ? 'ok' : '-'} / 实例 ${onInstance ? 'ok' : '-'}，重试 ${ATTEMPTS} 次）`)
}
