/**
 * dsh-mysql 隔离 Web 的 RPC 全链路探针。
 *
 * 通过 Chrome DevTools Protocol 驱动真实 UI，逐个打通客户端声明并在 UI 上可见的
 * 6 个 RPC 方法（第 7 个 `listTables` 客户端从不调用，由 test/typert.test.mjs 与
 * test/client-typert.test.mjs 的契约测试覆盖）：
 *
 *   - listConnections   打开 设置 → MySQL 数据库，空态文案渲染成功；
 *   - saveConnection    填写表单并保存，卡片出现、通知"已保存"，密码不落 DOM；
 *   - listConnections   刷新页面后卡片仍在（证明连接来自磁盘而非 React 状态）；
 *   - testConnection    无 3306 监听时优雅失败（connect ECONNREFUSED），无未捕获异常；
 *   - getSelection      输入栏控件渲染为 is-off 而非 is-warn；
 *   - selectConnection  在选择面板里点击连接，按钮转 is-on、面板关闭；
 *   - deleteConnection  删除并二次确认，回到空态。
 *
 * 探针自带清理：开始与结束都通过 UI 删除自己的连接，可重复运行；结束时
 * `connections.json` 不残留探针连接。
 *
 * 用法：node web-rpc-probe.mjs <url> <debugPort> [timeoutMs]
 * 输出一行 JSON；退出码始终为 0，由调用方按 verdict 判定。
 */
const [, , url, debugPortArg, timeoutArg] = process.argv
const debugPort = Number(debugPortArg)
const timeoutMs = Number(timeoutArg ?? 120000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const PROBE_NAME = 'dsh-mysql-rpc-probe'
const PROBE_PASSWORD = 'p@ssw0rd-probe-do-not-log'

const steps = []
function record(step, ok, detail) {
  steps.push({ step, ok: ok === true, detail: detail === undefined ? null : String(detail).slice(0, 400) })
}

// ── CDP 连接 ───────────────────────────────────────────────────────────────
let page
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    page = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (page !== undefined) break
  } catch { /* devtools endpoint not up yet */ }
  await sleep(250)
}
if (page === undefined) {
  console.log(JSON.stringify({ verdict: 'no-cdp-target', steps }, null, 2))
  process.exit(0)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
const consoleMessages = []
const exceptions = []
let nextId = 1
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleMessages.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 500))
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    exceptions.push((details.exception?.description ?? details.text ?? 'unknown').slice(0, 800))
  }
})
function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve)
  socket.addEventListener('error', () => reject(new Error('CDP socket error')))
})
await send('Runtime.enable')
await send('Page.enable')

const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value
const waitFor = async (expression, ms = 20000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await evaluate(expression) === true) return true
    await sleep(300)
  }
  return false
}
const settingsText = () => evaluate('(document.querySelector(".dsh-mysql-settings") || {}).innerText || ""')
/** 等设置页的 listConnections 结束（加载中… → 有内容/空态）。 */
const waitForSettingsSettled = async (ms = 15000) => {
  await waitFor(`/还没有配置任何连接|${PROBE_NAME}|连接失败/.test((document.querySelector('.dsh-mysql-settings') || {}).innerText || '')`, ms)
  return settingsText()
}
const clickInSettings = (text) => evaluate(`(() => {
  const scope = document.querySelector('.dsh-mysql-settings')
  if (scope === null) return false
  const el = Array.from(scope.querySelectorAll('button')).find((b) => (b.innerText || '').replace(/\\s+/g, '').includes(${JSON.stringify(text)}))
  if (el === undefined) return false
  el.click()
  return true
})()`)
const setField = (index, value) => evaluate(`(() => {
  const el = document.querySelectorAll('.dsh-mysql-settings .dsh-mysql-input')[${index}]
  if (el === undefined) return false
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
const openSettings = async () => {
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '设置')
    if (btn !== undefined) btn.click()
  })()`)
  await sleep(2000)
}
const openMysqlSection = async () => {
  await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('button'))
      .filter((b) => /MySQL/.test(b.textContent || '')).pop()
    if (target !== undefined) target.click()
  })()`)
  return waitFor('document.querySelectorAll(".dsh-mysql-settings").length >= 1', 15000)
}
/** 反复删除设置页里的连接，保证探针可重复运行。 */
async function deleteExistingConnections(max = 10) {
  let deleted = 0
  for (let i = 0; i < max; i++) {
    if (/还没有配置任何连接/.test(await settingsText())) break
    if (await clickInSettings('删除') !== true) break
    await sleep(500)
    if (await clickInSettings('确认删除') !== true) break
    deleted += 1
    await sleep(1500)
  }
  return deleted
}

// ── 阶段 0：客户端 boot 与输入栏控件（getSelection）────────────────────────
await send('Page.navigate', { url })
record('conversation.input.left 控件渲染（getSelection RPC）', await waitFor('document.querySelectorAll(".dsh-mysql-root").length >= 1', timeoutMs))
const btnClass = await evaluate('(document.querySelector(".dsh-mysql-btn") || {}).className')
record('控件为 is-off 而非 is-warn（getSelection 未报错）', btnClass === 'dsh-mysql-btn is-off', btnClass)

// ── 阶段 1：设置页分区（listConnections）───────────────────────────────────
await openSettings()
record('settings.section 分区渲染（listConnections RPC）', await openMysqlSection())
const removed = await deleteExistingConnections()
record('设置页为空态（无遗留连接）', /还没有配置任何连接/.test(await settingsText()), 'cleaned=' + removed)

// ── 阶段 2：新建并保存（saveConnection）────────────────────────────────────
record('点击「添加连接」', await clickInSettings('添加连接'))
record('连接表单出现', await waitFor('document.querySelectorAll(".dsh-mysql-settings .dsh-mysql-input").length >= 5', 10000))
await setField(0, PROBE_NAME)
await setField(1, '127.0.0.1')
await setField(2, '3306')
await setField(3, 'root')
await setField(4, PROBE_PASSWORD)
await setField(5, 'compat_probe')
record('点击「保存连接」（saveConnection RPC）', await clickInSettings('保存连接'))
const savedText = await (async () => {
  await waitFor(`/已保存：/.test((document.querySelector('.dsh-mysql-settings') || {}).innerText || '')`, 15000)
  return settingsText()
})()
record('保存通知与连接卡片出现', /已保存：/.test(savedText) && savedText.includes(PROBE_NAME), savedText.replace(/\s+/g, ' '))
record('明文密码未出现在 DOM', !savedText.includes(PROBE_PASSWORD))

// ── 阶段 3：刷新后仍在（持久化 → listConnections 读盘）────────────────────
await send('Page.reload')
// 等导航真正发生，避免在旧文档上做判断（旧 DOM 里 .dsh-mysql-root 仍然在）。
await sleep(2500)
const backAfterReload = await waitFor('document.querySelectorAll(".dsh-mysql-root").length >= 1', timeoutMs)
await openSettings()
const reopened = await openMysqlSection()
const reloadedText = reopened ? await waitForSettingsSettled() : ''
record(
  '刷新后连接仍在（connections.json 已落盘）',
  backAfterReload && reopened && reloadedText.includes(PROBE_NAME),
  'control=' + backAfterReload + ' section=' + reopened + ' text=' + reloadedText.replace(/\s+/g, ' '),
)

// ── 阶段 4：测试连接优雅失败（testConnection）─────────────────────────────
record('点击「测试连接」（testConnection RPC）', await clickInSettings('测试连接'))
const tested = await (async () => {
  await waitFor(`/ECONNREFUSED|连接失败/.test((document.querySelector('.dsh-mysql-settings') || {}).innerText || '')`, 20000)
  return settingsText()
})()
record('无 3306 监听时优雅失败且无未捕获异常', /ECONNREFUSED|连接失败/.test(tested), tested.replace(/\s+/g, ' '))

// ── 阶段 5：输入栏选择器（selectConnection）───────────────────────────────
await openSettings() // 再次点击「设置」= 收起设置面板
await sleep(1500)
record('点击输入栏数据库按钮', await evaluate(`(() => { const b = document.querySelector('.dsh-mysql-btn'); if (b === null) return false; b.click(); return true })()`))
record('连接选择面板出现', await waitFor('document.querySelectorAll(".dsh-mysql-panel").length >= 1', 10000))
record('点击连接项（selectConnection RPC）', await evaluate(`(() => {
  const item = document.querySelector('.dsh-mysql-item-main')
  if (item === null) return false
  item.click()
  return true
})()`))
await sleep(2500)
const selected = await evaluate(`(() => { const b = document.querySelector('.dsh-mysql-btn'); return b === null ? null : JSON.stringify({ cls: b.className, title: b.title }) })()`)
record('按钮转为选中态 is-on', /is-on/.test(selected || ''), selected)
record('选择后面板关闭', (await evaluate('document.querySelectorAll(".dsh-mysql-panel").length')) === 0)

// ── 阶段 6：删除（deleteConnection）并清理 ────────────────────────────────
await openSettings()
await openMysqlSection()
record('点击「删除」并二次确认（deleteConnection RPC）', (await deleteExistingConnections(3)) >= 1)
record('删除后回到空态（探针无残留）', /还没有配置任何连接/.test(await settingsText()))

socket.close()
const failed = steps.filter((s) => s.ok !== true)
console.log(JSON.stringify({
  verdict: failed.length === 0 ? 'ok' : 'rpc-failed',
  failed: failed.map((s) => s.step),
  steps,
  console: consoleMessages,
  exceptions,
}, null, 2))
