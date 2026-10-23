import { apply } from './index.js'

let calls = 0
const makeFs = () => class FakeFs {
  constructor(failures) { this.failures = failures }
  async writeText(target, content) {
    calls += 1
    if (calls <= this.failures) throw new Error('ReplaceFileW EIO (Win32 1175): ' + target)
    return { target, content, calls }
  }
}
const sleeps = []
const ctx = { fs: new (makeFs())(2) }
apply(ctx)
const original = globalThis.setTimeout

// 1) 1175 两次后成功
const r = await ctx.fs.writeText('a.txt', 'hi')
console.assert(r.calls === 3, `期望第 3 次成功，实际 ${r.calls}`)
console.log('用例1 1175 自动重试:', r.calls === 3 ? 'PASS' : 'FAIL')

// 2) 非 1175 不重试
calls = 0
const ctx2 = { fs: new (makeFs())(0) }
ctx2.fs.writeText = async () => { calls += 1; throw new Error('ENOENT: no such file') }
apply(ctx2)
try { await ctx2.fs.writeText('b.txt', 'x') } catch (e) { /* 预期 */ }
console.log('用例2 非 1175 不重试:', calls === 1 ? 'PASS' : `FAIL(${calls})`)

// 3) 一直 1175 → 8 次后抛错，不无限循环
calls = 0
const ctx3 = { fs: new (makeFs())(Infinity) }
apply(ctx3)
const t0 = Date.now()
try { await ctx3.fs.writeText('c.txt', 'x'); console.log('用例3 FAIL 没抛错') }
catch (e) { console.log('用例3 8 次后放弃:', calls === 8 ? 'PASS' : `FAIL(${calls})`, `${Date.now() - t0}ms`) }
