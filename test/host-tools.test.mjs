import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mysql-host-test-'))
process.env.DSH_HOME = tempHome
const tools = new Map()
const listeners = new Map()
const contexts = new Map()
const service = new Map()
const connections = [
  { id: 'source-dev', name: 'Development', host: 'dev.local', port: 3306, user: 'test', password: 'secret', database: 'devdb', tables: ['allowed'], allowWrite: false, allowDdl: false },
  { id: 'source-prod', name: 'Production', host: 'prod.local', port: 3306, user: 'test', password: 'secret', database: 'proddb', tables: [], allowWrite: true, allowDdl: true },
]
await fs.mkdir(path.join(tempHome, 'storages', 'dsh-mysql'), { recursive: true })
await fs.writeFile(path.join(tempHome, 'storages', 'dsh-mysql', 'connections.json'), JSON.stringify({ connections }), 'utf8')

const ctx = {
  tools: { register: (tool) => tools.set(tool.name, tool) },
  get: (key) => key === 'systemPrompt' ? { context: (entry) => contexts.set(entry.name, entry.text) } : undefined,
  on: (event, fn) => listeners.set(event, fn),
  provide: (key, value) => service.set(key, value),
}
apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 20))

const mysql = service.get('mysql')
assert.ok(mysql)
const selection = (sessionId) => mysql.getSelection({ sessionId })
const replace = (sessionId, connectionIds) => mysql.selectConnection({ sessionId, connectionIds })

assert.equal(tools.size, 4)
for (const name of ['mysql_query', 'mysql_tables', 'mysql_execute', 'mysql_ddl']) {
  assert.equal(tools.get(name).parameters.properties.connectionId.type, 'string')
}

// 不变量：任何已注册工具的 schema 里，type === 'array' 的节点都必须带一个声明了 type 的 items。
// Gemini 原生 FunctionDeclaration 要求数组带带类型的 items，缺了（或给 {}）会让整个请求被 HTTP 400 拒绝。
// 递归遍历实际注册的 schema（而不是写死 params 名字），这样以后新增的数组参数也会被覆盖。
function assertTypedArrayItems(node, path, seen) {
  if (node === null || typeof node !== 'object') return
  if (seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertTypedArrayItems(child, path + '[' + index + ']', seen))
    return
  }
  if (node.type === 'array') {
    assert.ok(node.items !== null && typeof node.items === 'object' && !Array.isArray(node.items), path + ': array schema must declare an items object')
    assert.equal(typeof node.items.type, 'string', path + '.items: array items must declare a type')
    assert.ok(node.items.type.length > 0, path + '.items: array items type must not be empty')
  }
  for (const key of Object.keys(node)) assertTypedArrayItems(node[key], path + '.' + key, seen)
}
for (const [name, tool] of tools) {
  assertTypedArrayItems(tool.parameters, 'tools.' + name + '.parameters', new Set())
  const params = tool.parameters.properties.params
  if (params) assert.equal(params.items.type, 'string', name + ': params must declare string items')
}
const initial = await selection('multi')
assert.deepEqual(initial.connectionIds, [])
assert.equal(initial.connectionId, null)
assert.equal(initial.connections.some((item) => 'password' in item), false)

const single = await selection('single-auto')
assert.deepEqual(single.connectionIds, []) // multiple configured sources => new session empty
const only = [{ id: 'only', name: 'Only' }]
const { resolveSelectedConnectionIds } = await import('../lib/session-selection.js')
assert.deepEqual(resolveSelectedConnectionIds(only, 'one-only', new Map()), ['only'])
const lateOneState = new Map()
assert.deepEqual(resolveSelectedConnectionIds([], 'late-one', lateOneState), [])
assert.deepEqual(resolveSelectedConnectionIds(only, 'late-one', lateOneState), ['only'])

assert.equal((await replace('multi', ['source-dev', 'source-prod'])).ok, true)
assert.deepEqual((await selection('multi')).connectionIds, ['source-dev', 'source-prod'])
assert.equal((await selection('multi')).connectionId, null)
assert.equal((await tools.get('mysql_query').execute({ sql: 'SELECT 1' }, { agent: { id: 'multi' } })).ok, false)
assert.match((await tools.get('mysql_query').execute({ sql: 'SELECT 1', connectionId: 'unselected' }, { agent: { id: 'multi' } })).error, /未在当前会话选中/)

assert.equal((await replace('multi', ['source-dev'])).ok, true)
const queryTool = tools.get('mysql_query')
const queryNoDb = await queryTool.execute({ sql: 'SELECT 1' }, { agent: { id: 'multi' } })
assert.match(queryNoDb.error, /ENOTFOUND/)
// Rejected routing must occur before pool creation.
assert.equal((await queryTool.execute({ sql: 'SELECT 1', connectionId: 'source-prod' }, { agent: { id: 'multi' } })).ok, false)

assert.equal((await replace('multi', [])).ok, true)
assert.match((await queryTool.execute({ sql: 'SELECT 1' }, { agent: { id: 'multi' } })).error, /尚未选择/)
assert.equal((await selection('multi')).connectionIds.length, 0)

assert.equal((await replace('legacy', ['source-dev'])).connectionId, 'source-dev')
assert.equal((await mysql.selectConnection({ sessionId: 'legacy-scalar', connectionId: 'source-prod' })).connectionId, 'source-prod')
assert.equal((await selection('legacy-scalar')).connectionId, 'source-prod')
assert.equal((await replace('invalid', ['source-dev', 'missing'])).ok, false)
assert.deepEqual((await selection('invalid')).connectionIds, [])

const contextText = contexts.get('dsh-mysql-context')
const context = contextText({ agent: { id: 'multi' } })
assert.match(context, /尚未选择连接/)
assert.equal(context.includes('source-prod'), false)
await replace('multi', ['source-dev', 'source-prod'])
const multiContext = contextText({ agent: { id: 'multi' } })
assert.match(multiContext, /source-dev/)
assert.match(multiContext, /source-prod/)
assert.match(multiContext, /禁止广播/)
assert.equal(multiContext.includes('secret'), false)

const executeTool = tools.get('mysql_execute')
const ddlTool = tools.get('mysql_ddl')
const devWriteDenied = await executeTool.execute({ connectionId: 'source-dev', sql: 'UPDATE allowed SET id = 1' }, { agent: { id: 'multi' } })
assert.match(devWriteDenied.error, /Development.*allowWrite=false/)
const devTableDenied = await queryTool.execute({ connectionId: 'source-dev', sql: 'SELECT * FROM private_table' }, { agent: { id: 'multi' } })
assert.match(devTableDenied.error, /Development.*白名单外/)
const prodWriteAttempt = await executeTool.execute({ connectionId: 'source-prod', sql: 'UPDATE private_table SET id = 1' }, { agent: { id: 'multi' } })
assert.match(prodWriteAttempt.error, /Production.*ENOTFOUND/)
const prodDdlAttempt = await ddlTool.execute({ connectionId: 'source-prod', sql: 'CREATE TABLE probe (id INT)' }, { agent: { id: 'multi' } })
assert.match(prodDdlAttempt.error, /Production.*ENOTFOUND/)

listeners.get('agent/disposed')({ agent: { id: 'legacy' } })
const deleted = await mysql.deleteConnection({ connectionId: 'source-prod' })
assert.equal(deleted.ok, true)
assert.deepEqual((await selection('multi')).connectionIds, ['source-dev'])
await fs.rm(tempHome, { recursive: true, force: true })
console.log('Host tools and session routing tests passed')
