/**
 * dsh-mysql 隔离 Web 客户端启动探针。
 *
 * 通过 Chrome DevTools Protocol 打开由 `dsh web` 服务的隔离实例，等待客户端
 * 组合完成，然后判定：
 *   - boot 图里包含 `dsh-mysql`；
 *   - 启动遮罩没有报告 "Failed to load plugins"；
 *   - `conversation.input.left` 贡献真的渲染出了数据库连接控件（证明 Client
 *     bundle 被物化、slot 注册成功、`getSelection` RPC 走通）。
 *
 * 用法：node web-boot-probe.mjs <url> <debugPort> [timeoutMs]
 * 输出一行 JSON；退出码始终为 0，由调用方按 verdict 判定。
 */
const [, , url, debugPortArg, timeoutArg] = process.argv
const debugPort = Number(debugPortArg)
const timeoutMs = Number(timeoutArg ?? 60000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let page
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    const list = await response.json()
    page = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
    if (page !== undefined) break
  } catch { /* devtools endpoint not up yet */ }
  await sleep(250)
}
if (page === undefined) {
  console.log(JSON.stringify({ verdict: 'no-cdp-target' }))
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
    consoleMessages.push(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 500))
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
await send('Log.enable')

const PROBE = `(() => {
  const boot = document.querySelector('[data-dsh-boot]')
  const bootText = boot === null ? null : boot.innerText
  const graph = window.__DSH_BOOT__
  const entries = graph && Array.isArray(graph.entries) ? graph.entries.map((e) => e.id) : null
  return JSON.stringify({
    href: location.href,
    graphReady: entries !== null,
    hasMysqlEntry: entries !== null && entries.includes('dsh-mysql'),
    entryCount: entries === null ? 0 : entries.length,
    bootOverlay: boot !== null,
    failedPlugins: bootText !== null && /Failed to load plugins/i.test(bootText),
    bootText: bootText === null ? null : bootText.replace(/\\s+/g, ' ').slice(0, 300),
    mysqlControl: document.querySelectorAll('.dsh-mysql-root').length,
    mysqlControlWarn: document.querySelectorAll('.dsh-mysql-btn.is-warn').length,
  })
})()`

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  return result.result?.value
}

await send('Page.navigate', { url })

const deadline = Date.now() + timeoutMs
let snapshot = null
let verdict = 'timeout'
while (Date.now() < deadline) {
  await sleep(500)
  try {
    const raw = await evaluate(PROBE)
    if (typeof raw !== 'string') continue
    snapshot = JSON.parse(raw)
  } catch { continue }
  if (snapshot.failedPlugins === true) { verdict = 'boot-failed'; break }
  if (snapshot.hasMysqlEntry !== true) continue
  if (snapshot.mysqlControl >= 1) { verdict = 'ok'; break }
}

socket.close()
console.log(JSON.stringify({ verdict, snapshot, console: consoleMessages, exceptions }, null, 2))
