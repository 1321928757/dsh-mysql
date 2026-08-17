/**
 * dsh-mysql 宿主插件（单一行挂载，见 cordis.patch.yml）。
 *
 * 职责：
 *  1. 连接管理：$DSH_HOME/storages/dsh-mysql/connections.json 持久化多套
 *     MySQL 连接（名称/host/port/user/password/默认库/表白名单/写权限），
 *     按连接懒创建 mysql2 连接池（配置变更自动重建，dispose 全部回收）；
 *  2. 全局注册三个模型工具（所有 Agent 预设可见）：
 *     - mysql_query    只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN，单语句，
 *                      白名单表校验，SELECT 自动注入 MAX_EXECUTION_TIME 提示，
 *                      最多返回 MAX_ROWS 行）；
 *     - mysql_tables   查看当前连接可读表的结构（information_schema）；
 *     - mysql_execute  写操作（仅 INSERT/UPDATE/DELETE），连接必须显式开启
 *                      allowWrite（默认关闭），同样受白名单约束；
 *  3. 会话级连接选择：sessionId → connectionId 映射，由 Client 输入栏按钮
 *     经 Typert RPC 切换；工具执行时用 exec.agent.id 解析当前连接；
 *  4. systemPrompt 动态 section：每次提示词装配时注入「当前连接 + 可读表」
 *     上下文，所有预设的模型无需任何预设改动即可感知当前数据库；
 *  5. 提供 `mysql` 服务（Typert 网关）：连接 CRUD、测试、选择与表列表。
 *
 * 只通过 ctx API 使用宿主能力，不 import 任何 @deepseek-ai 运行时包，
 * 因此与宿主进程共享同一套运行时实例。
 */

import { createPool } from 'mysql2/promise'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  MAX_ROWS,
  stripSqlComments,
  classifyStatement,
  checkTableAllowlist,
  hasMultipleStatements,
  jsonSafe,
  normalizeTables,
} from './shared.js'

export const name = 'dsh-mysql'
export const inject = ['tools']

/** SELECT 注入的执行超时提示（MySQL 5.7.8+ 支持，秒级会被驱动换算为毫秒）。 */
const MAX_EXECUTION_MS = 15000
const POOL_CONNECTION_LIMIT = 3
const CONNECT_TIMEOUT_MS = 10000

// ── 配置存储（$DSH_HOME/storages/dsh-mysql/connections.json）──────────────

function storageDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'storages', 'dsh-mysql')
}

function storageFile() {
  return path.join(storageDir(), 'connections.json')
}

/** Host 是唯一写入方：内存缓存作为权威快照（section 文本提供器要求同步读取）。 */
let cachedConfigs = { connections: [] }
let loadedPromise = null

async function loadConfigsFromDisk() {
  try {
    const text = await fsp.readFile(storageFile(), 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.connections)) {
      return { connections: parsed.connections.map(normalizeConnection).filter((c) => c.name) }
    }
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'FS_NOT_FOUND')) return { connections: [] }
    console.error('[dsh-mysql] 读取连接配置失败', (err && err.message) || err)
  }
  return { connections: [] }
}

function ensureLoaded() {
  if (loadedPromise === null) {
    loadedPromise = loadConfigsFromDisk()
      .then((configs) => { cachedConfigs = configs; return configs })
      .catch((err) => {
        console.error('[dsh-mysql] 初始化连接配置失败', (err && err.message) || err)
        cachedConfigs = { connections: [] }
        return cachedConfigs
      })
  }
  return loadedPromise
}

async function persistConfigs(configs) {
  cachedConfigs = configs
  try {
    await fsp.mkdir(storageDir(), { recursive: true })
    const file = storageFile()
    const tmp = file + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(configs, null, 2), 'utf8')
    await fsp.rename(tmp, file)
  } catch (err) {
    console.error('[dsh-mysql] 保存连接配置失败', (err && err.message) || err)
    throw err
  }
}

// ── 连接配置归一化与对外视图 ───────────────────────────────────────────────

function normalizeConnection(input) {
  const raw = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : ''
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 64) : '',
    host: typeof raw.host === 'string' && raw.host.trim() ? raw.host.trim().slice(0, 255) : '127.0.0.1',
    port: Number.isFinite(Number(raw.port)) && Number(raw.port) > 0 ? Math.floor(Number(raw.port)) : 3306,
    user: typeof raw.user === 'string' ? raw.user.slice(0, 64) : 'root',
    password: typeof raw.password === 'string' ? raw.password : '',
    database: typeof raw.database === 'string' ? raw.database.trim().slice(0, 128) : '',
    tables: normalizeTables(raw.tables),
    allowWrite: raw.allowWrite === true,
  }
}

/** 对外安全视图：绝不回传密码，只回 hasPassword。 */
function publicView(c) {
  return {
    id: c.id,
    name: c.name,
    host: c.host,
    port: c.port,
    user: c.user,
    database: c.database,
    tables: c.tables.slice(),
    allowWrite: c.allowWrite,
    hasPassword: c.password.length > 0,
  }
}

// ── 连接池管理 ─────────────────────────────────────────────────────────────

const pools = new Map() // connectionId -> { fingerprint, pool }

function fingerprint(c) {
  return [c.host, String(c.port), c.user, c.password, c.database].join('\u0000')
}

async function getPool(configs, connId) {
  const cfg = configs.connections.find((c) => c.id === connId)
  if (cfg === undefined) return { error: '连接不存在：' + connId }
  const fp = fingerprint(cfg)
  const hit = pools.get(connId)
  if (hit !== undefined && hit.fingerprint === fp) return { pool: hit.pool, config: cfg }
  if (hit !== undefined) {
    pools.delete(connId)
    hit.pool.end().catch(() => {})
  }
  const pool = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database || undefined,
    connectTimeout: CONNECT_TIMEOUT_MS,
    waitForConnections: true,
    connectionLimit: POOL_CONNECTION_LIMIT,
    enableKeepAlive: true,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  })
  pools.set(connId, { fingerprint: fp, pool })
  return { pool, config: cfg }
}

async function dropPool(connId) {
  const hit = pools.get(connId)
  pools.delete(connId)
  if (hit !== undefined) await hit.pool.end().catch(() => {})
}

// ── 会话级连接选择 ─────────────────────────────────────────────────────────

const sessionSelection = new Map() // sessionId -> connectionId

function resolveSelection(configs, sessionId) {
  let connection = null
  if (typeof sessionId === 'string') {
    const connId = sessionSelection.get(sessionId)
    connection = configs.connections.find((c) => c.id === connId) || null
  }
  if (connection === null && configs.connections.length === 1) {
    // 只配置了一个连接：自动选中（并记录，让 UI 与工具行为一致）
    connection = configs.connections[0]
    if (typeof sessionId === 'string') sessionSelection.set(sessionId, connection.id)
  }
  return connection
}

// ── 查询执行 ───────────────────────────────────────────────────────────────

/** 为 SELECT 注入 MAX_EXECUTION_TIME 提示，防止无 LIMIT 的长查询拖垮连接。 */
function prependExecutionHint(sql, kind) {
  if (kind !== 'read') return sql
  if (/\/\*\+/i.test(sql)) return sql // 已自带优化器提示时不重复注入
  return sql.replace(/^(\s*)(select)/i, '$1$2 /*+ MAX_EXECUTION_TIME(' + MAX_EXECUTION_MS + ') */')
}

async function runQuery(pool, sql, params) {
  const [rows, fields] = await pool.query(sql, Array.isArray(params) ? params : [])
  const columns = Array.isArray(fields) ? fields.map((f) => f.name) : []
  const list = Array.isArray(rows) ? rows : []
  const truncated = list.length > MAX_ROWS
  const slice = truncated ? list.slice(0, MAX_ROWS) : list
  return {
    columns,
    rowCount: slice.length,
    totalRowCount: list.length,
    truncated,
    rows: slice.map(jsonSafe),
  }
}

/** 工具执行公共前置：解析会话 → 选中连接 → 连接池。 */
async function execCtx(exec) {
  const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : undefined
  const configs = await ensureLoaded()
  const connection = resolveSelection(configs, sessionId)
  if (connection === null) {
    if (configs.connections.length === 0) {
      return { error: '尚未配置任何 MySQL 连接：请打开 设置 → MySQL 数据库 添加连接。' }
    }
    return { error: '当前会话尚未选择数据库连接：请在输入栏点击 🐬 数据库按钮选择一个连接后再试。' }
  }
  const got = await getPool(configs, connection.id)
  if (got.error !== undefined) return { error: got.error }
  return { sessionId, configs, connection, pool: got.pool }
}

// ── 模型工具 ───────────────────────────────────────────────────────────────

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

function toolError(error) {
  return { ok: false, error: String(error) }
}

const mysqlQueryTool = {
  name: 'mysql_query',
  description:
    '对用户在输入栏选择的 MySQL 连接执行一条只读 SQL 查询（仅 SELECT/SHOW/DESCRIBE/EXPLAIN）。' +
    '表名受该连接配置的白名单限制（白名单为空则不限制）；禁止一次执行多条语句。' +
    '返回 { columns, rowCount, totalRowCount, truncated, rows }，最多返回 ' + MAX_ROWS + ' 行，' +
    'truncated=true 表示还有更多行。查询前请先用 mysql_tables 了解表结构，并尽量加 LIMIT 控制结果集。' +
    '写入操作一律使用 mysql_execute，不要传到这里。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      sql: { type: 'string', description: '一条 SELECT/SHOW/DESCRIBE/EXPLAIN SQL 语句。' },
      params: { type: 'array', description: '可选的位置参数，对应 SQL 中的 ? 占位符。' },
    },
    required: ['sql'],
  },
  output: OUTPUT,
  timeoutMs: 30000,
  async execute(args, exec) {
    const sql = stripSqlComments(typeof (args && args.sql) === 'string' ? args.sql : '').trim()
    if (!sql) return toolError('SQL 为空')
    const base = await execCtx(exec)
    if (base.error !== undefined) return toolError(base.error)
    const kind = classifyStatement(sql)
    if (kind !== 'read') {
      return toolError('mysql_query 只允许 SELECT/SHOW/DESCRIBE/EXPLAIN 语句；写入请使用 mysql_execute')
    }
    if (hasMultipleStatements(sql)) return toolError('不允许一次执行多条语句')
    const allow = checkTableAllowlist(sql, base.connection.tables)
    if (!allow.ok) return toolError('查询涉及白名单外的表：' + allow.denied.join(', '))
    try {
      const result = await runQuery(base.pool, prependExecutionHint(sql, kind), args && args.params)
      return { ok: true, connection: base.connection.name, ...result }
    } catch (err) {
      return toolError('查询失败：' + String((err && err.message) || err))
    }
  },
}

const mysqlTablesTool = {
  name: 'mysql_tables',
  description:
    '查看当前选中的 MySQL 连接中可读表的结构（表名、列名、类型、是否可空、键与注释），' +
    '受该连接白名单限制。参数 table 可模糊过滤表名；缺省返回全部可读表。' +
    '写 SQL 之前先用它确认字段名与类型，避免凭空猜测。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      table: { type: 'string', description: '可选：按表名模糊过滤（不区分大小写）。' },
    },
  },
  output: OUTPUT,
  timeoutMs: 15000,
  async execute(args, exec) {
    const base = await execCtx(exec)
    if (base.error !== undefined) return toolError(base.error)
    const filter = typeof (args && args.table) === 'string' ? args.table.trim().toLowerCase() : ''
    const allowed = base.connection.tables
    try {
      const [rows] = await base.pool.query(
        'SELECT table_name, column_name, column_type, is_nullable, column_key, column_comment ' +
        'FROM information_schema.columns WHERE table_schema = DATABASE() ' +
        'ORDER BY table_name, ordinal_position',
      )
      const byTable = new Map()
      for (const r of rows) {
        const t = String(r.table_name).toLowerCase()
        if (allowed.length > 0 && !allowed.includes(t)) continue
        if (filter && !t.includes(filter)) continue
        if (!byTable.has(t)) byTable.set(t, [])
        byTable.get(t).push({
          column: String(r.column_name),
          type: String(r.column_type),
          nullable: String(r.is_nullable).toUpperCase() === 'YES',
          key: r.column_key ? String(r.column_key) : '',
          comment: r.column_comment ? String(r.column_comment) : '',
        })
      }
      const tables = [...byTable.keys()].sort().map((t) => ({ name: t, columns: byTable.get(t) }))
      return { ok: true, connection: base.connection.name, tables }
    } catch (err) {
      return toolError('读取表结构失败：' + String((err && err.message) || err))
    }
  },
}

const mysqlExecuteTool = {
  name: 'mysql_execute',
  description:
    '对用户在输入栏选择的 MySQL 连接执行一条写 SQL（仅 INSERT/UPDATE/DELETE）。' +
    '只有当该连接在设置中显式开启了「允许写操作」时此工具才可用（默认关闭）。' +
    '表名受白名单限制；禁止一次执行多条语句；DDL（DROP/TRUNCATE/ALTER/CREATE 等）一律拒绝。' +
    '返回 { affectedRows, insertId }。写操作前务必先查库确认目标数据，值一律用 ? 占位符传参。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      sql: { type: 'string', description: '一条 INSERT/UPDATE/DELETE SQL 语句。' },
      params: { type: 'array', description: '可选的位置参数，对应 SQL 中的 ? 占位符。' },
    },
    required: ['sql'],
  },
  output: OUTPUT,
  timeoutMs: 30000,
  async execute(args, exec) {
    const sql = stripSqlComments(typeof (args && args.sql) === 'string' ? args.sql : '').trim()
    if (!sql) return toolError('SQL 为空')
    const base = await execCtx(exec)
    if (base.error !== undefined) return toolError(base.error)
    if (base.connection.allowWrite !== true) {
      return toolError('当前连接未开启写权限（allowWrite=false）：请在 设置 → MySQL 数据库 中为该连接开启「允许写操作」')
    }
    const kind = classifyStatement(sql)
    if (kind !== 'write-dml') {
      return toolError('mysql_execute 只允许 INSERT/UPDATE/DELETE 语句；DDL 与其它写操作一律拒绝')
    }
    if (hasMultipleStatements(sql)) return toolError('不允许一次执行多条语句')
    const allow = checkTableAllowlist(sql, base.connection.tables)
    if (!allow.ok) return toolError('写入涉及白名单外的表：' + allow.denied.join(', '))
    try {
      const [result] = await base.pool.execute(sql, Array.isArray(args && args.params) ? args.params : [])
      return {
        ok: true,
        connection: base.connection.name,
        affectedRows: (result && result.affectedRows) || 0,
        insertId: (result && result.insertId) || 0,
      }
    } catch (err) {
      return toolError('写入失败：' + String((err && err.message) || err))
    }
  },
}

// ── Typert 服务方法（Client 经网关调用）───────────────────────────────────

async function listConnections() {
  const configs = await ensureLoaded()
  return { ok: true, connections: configs.connections.map(publicView) }
}

async function getSelection(args) {
  const configs = await ensureLoaded()
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
  const connection = resolveSelection(configs, sessionId)
  return {
    ok: true,
    connectionId: connection ? connection.id : null,
    connections: configs.connections.map(publicView),
  }
}

async function selectConnection(args) {
  const configs = await ensureLoaded()
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
  const connectionId = args && typeof args.connectionId === 'string' ? args.connectionId : ''
  if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: '缺少会话标识' }
  const conn = configs.connections.find((c) => c.id === connectionId)
  if (conn === undefined) return { ok: false, error: '连接不存在：' + connectionId }
  sessionSelection.set(sessionId, connectionId)
  return { ok: true, connectionId, name: conn.name }
}

async function saveConnection(args) {
  const input = args && typeof args.connection === 'object' && !Array.isArray(args.connection) ? args.connection : null
  if (input === null) return { ok: false, error: '缺少连接配置' }
  const next = normalizeConnection(input)
  if (!next.name) return { ok: false, error: '连接名称不能为空' }
  const configs = await ensureLoaded()
  const existing = next.id ? configs.connections.find((c) => c.id === next.id) : undefined
  let id = next.id
  if (id === '') {
    id = 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }
  next.id = id
  if (existing !== undefined && (input.password === undefined || input.password === null || input.password === '')) {
    // 编辑时密码留空 = 保留原密码
    next.password = existing.password
  }
  const list = configs.connections.filter((c) => c.id !== id)
  list.push(next)
  try {
    await persistConfigs({ connections: list })
  } catch (err) {
    return { ok: false, error: '保存失败：' + String((err && err.message) || err) }
  }
  // 配置变更：丢弃旧池，下次使用时按新配置重建
  await dropPool(id)
  return { ok: true, connection: publicView(next) }
}

async function deleteConnection(args) {
  const connectionId = args && typeof args.connectionId === 'string' ? args.connectionId : ''
  const configs = await ensureLoaded()
  const list = configs.connections.filter((c) => c.id !== connectionId)
  if (list.length === configs.connections.length) return { ok: false, error: '连接不存在：' + connectionId }
  try {
    await persistConfigs({ connections: list })
  } catch (err) {
    return { ok: false, error: '删除失败：' + String((err && err.message) || err) }
  }
  await dropPool(connectionId)
  for (const [sid, cid] of sessionSelection) {
    if (cid === connectionId) sessionSelection.delete(sid)
  }
  return { ok: true }
}

async function testConnection(args) {
  const configs = await ensureLoaded()
  const input = args && typeof args.connection === 'object' && !Array.isArray(args.connection) ? args.connection : null
  let cfg
  if (input !== null && input.name !== undefined) {
    // 测试未保存的表单草稿
    cfg = normalizeConnection(input)
    if (cfg.id && (input.password === undefined || input.password === null || input.password === '')) {
      const existing = configs.connections.find((c) => c.id === cfg.id)
      if (existing !== undefined) cfg.password = existing.password
    }
  } else {
    const connectionId = args && typeof args.connectionId === 'string' ? args.connectionId : ''
    const existing = configs.connections.find((c) => c.id === connectionId)
    if (existing === undefined) return { ok: false, error: '连接不存在：' + connectionId }
    cfg = existing
  }
  let pool = null
  const started = Date.now()
  try {
    pool = createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database || undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
      connectionLimit: 1,
      multipleStatements: false,
    })
    const [rows] = await pool.query('SELECT 1 AS ok')
    return { ok: true, latencyMs: Date.now() - started, reached: !!(rows && rows[0]) }
  } catch (err) {
    return { ok: false, error: '连接失败：' + String((err && err.message) || err) }
  } finally {
    if (pool !== null) await pool.end().catch(() => {})
  }
}

async function listTables(args) {
  const configs = await ensureLoaded()
  const connectionId = args && typeof args.connectionId === 'string' ? args.connectionId : ''
  const cfg = configs.connections.find((c) => c.id === connectionId)
  if (cfg === undefined) return { ok: false, error: '连接不存在：' + connectionId }
  const got = await getPool(configs, connectionId)
  if (got.error !== undefined) return { ok: false, error: got.error }
  try {
    const [rows] = await got.pool.query(
      'SELECT table_name, table_comment FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name',
    )
    const allowed = cfg.tables
    const tables = rows
      .filter((r) => allowed.length === 0 || allowed.includes(String(r.table_name).toLowerCase()))
      .map((r) => ({ name: String(r.table_name), comment: r.table_comment ? String(r.table_comment) : '' }))
    return { ok: true, tables }
  } catch (err) {
    return { ok: false, error: '读取表列表失败：' + String((err && err.message) || err) }
  }
}

const service = {
  listConnections,
  getSelection,
  selectConnection,
  saveConnection,
  deleteConnection,
  testConnection,
  listTables,
}

// ── 插件主体 ───────────────────────────────────────────────────────────────

export function apply(ctx) {
  ensureLoaded() // 启动即加载（systemPrompt section 提供器同步读取内存缓存）

  // 三个全局工具：所有 Agent 预设的会话都可见
  ctx.tools.register(mysqlQueryTool)
  ctx.tools.register(mysqlTablesTool)
  ctx.tools.register(mysqlExecuteTool)

  // 动态 system prompt 段：每次装配时告知模型「当前连接 + 可读表」
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    systemPrompt.section({
      name: 'dsh-mysql-context',
      order: 200,
      text: (assemble) => {
        const agent = assemble && assemble.agent
        const sessionId = agent && typeof agent.id === 'string' ? agent.id : undefined
        if (cachedConfigs.connections.length === 0) return ''
        const connection = resolveSelection(cachedConfigs, sessionId)
        if (connection === null) {
          return 'MySQL 数据库：当前会话尚未选择连接。需要查库时，请提醒用户在输入栏点击 🐬 数据库按钮选择一个连接。'
        }
        return [
          'MySQL 数据库上下文（用户已在输入栏选定连接）：',
          '- 连接：' + connection.name + '（' + connection.host + ':' + connection.port + '/' + (connection.database || '未指定默认库') + '）',
          '- 可读表：' + (connection.tables.length > 0 ? connection.tables.join('、') : '全部（未配置白名单）'),
          '- 工具：mysql_query 只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN，单条语句，最多返回 ' + MAX_ROWS + ' 行）；mysql_tables 查看表结构；mysql_execute 写操作（仅 INSERT/UPDATE/DELETE，需连接开启写权限）',
          '- 表名受白名单限制，查询前先用 mysql_tables 确认结构，回答时附上实际执行的 SQL 与查到的字段值。',
        ].join('\n')
      },
    })
  }

  // 会话销毁时清理选择映射
  ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent
    if (agent && typeof agent.id === 'string') sessionSelection.delete(agent.id)
  })

  // Typert 服务提供（网关经 ./typert 清单暴露给客户端）
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'mysql', namespace: 'mysql' },
  })
  ctx.provide('mysql', service)

  // 回收全部连接池
  ctx.on('dispose', () => {
    for (const hit of pools.values()) hit.pool.end().catch(() => {})
    pools.clear()
  })

  console.log('[dsh-mysql] host mounted, connections =', cachedConfigs.connections.length)
}
