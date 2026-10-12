/**
 * dsh-mysql 宿主插件（单一行挂载，见 cordis.patch.yml）。
 *
 * 职责：
 *  1. 连接管理：$DSH_HOME/storages/dsh-mysql/connections.json 持久化多套
 *     MySQL 连接（名称/host/port/user/password/默认库/表白名单/写权限/结构变更权限），
 *     按连接懒创建 mysql2 连接池（配置变更自动重建，dispose 全部回收）；
 *  2. 全局注册四个模型工具（所有 Agent 预设可见）：
 *     - mysql_query    只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN，单语句，
 *                      白名单表校验，SELECT 自动注入 MAX_EXECUTION_TIME 提示，
 *                      最多返回 MAX_ROWS 行）；
 *     - mysql_tables   查看当前连接可读表的结构（information_schema），兼容驱动返回的大写字段标签，
 *                      缺少必需元数据时明确失败，不伪造 undefined 表结构；
 *     - mysql_execute  写操作（仅 INSERT/UPDATE/DELETE），连接必须显式开启
 *                      allowWrite（默认关闭），同样受白名单约束；
 *     - mysql_ddl      结构变更（CREATE/ALTER/DROP/RENAME/TRUNCATE 作用于表、视图、
 *                      索引），连接必须显式开启 allowDdl（默认关闭）；账号与权限类
 *                      语句、库级语句永久拒绝，改/删目标受白名单约束，仅限默认库；
 *                      走文本协议（pool.query），因为 MySQL 对部分 DDL 不支持
 *                      预处理协议（ER_UNSUPPORTED_PS 1295）；
 *  3. 会话级数据源选择：sessionId → Set<connectionId>，由 Client 输入栏按钮
 *     经 Typert RPC 立即增删；工具按单次调用的 connectionId 路由至一个已选源；
 *  4. systemPrompt 动态 section：每次提示词装配时注入「已选数据源 + 各自能力」
 *     上下文，所有预设的模型无需任何预设改动即可感知可用数据库；
 *  5. 提供 `mysql` 服务（Typert 网关）：连接 CRUD、测试、选择与表列表。
 *
 * 只通过 ctx API 使用宿主能力，不 import 任何 @deepseek-ai 运行时包，
 * 因此与宿主进程共享同一套运行时实例。
 */

import { createPool } from 'mysql2/promise'
import { promises as fsp, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  resolveSelectedConnectionIds,
  replaceSelectedConnectionIds,
  removeSelectedConnectionId,
  resolveSelectedConnection,
} from './session-selection.js'
import {
  MAX_ROWS,
  stripSqlComments,
  classifyStatement,
  checkTableAllowlist,
  checkTableRefs,
  extractTableRefs,
  extractDdlTargets,
  checkDatabaseBoundary,
  hasMultipleStatements,
  jsonSafe,
  normalizeTables,
  describeDbError,
  groupColumnMetadata,
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

/** 启动诊断日志（$DSH_HOME/storages/dsh-mysql/boot.log），尽力而为。 */
function bootLog(line) {
  try {
    mkdirSync(storageDir(), { recursive: true })
    appendFileSync(path.join(storageDir(), 'boot.log'), new Date().toISOString() + ' ' + line + '\n', 'utf8')
  } catch (err) { /* 诊断日志失败不影响插件 */ }
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
    bootLog('load failed: ' + describeDbError(err))
    console.error('[dsh-mysql] 读取连接配置失败', describeDbError(err))
  }
  return { connections: [] }
}

function ensureLoaded() {
  if (loadedPromise === null) {
    loadedPromise = loadConfigsFromDisk()
      .then((configs) => { cachedConfigs = configs })
      .catch((err) => {
        console.error('[dsh-mysql] 初始化连接配置失败', describeDbError(err))
        cachedConfigs = { connections: [] }
      })
  }
  // loadedPromise 只作为一次性「已加载」门闩；每次调用都解析到当前 cachedConfigs，
  // 保证保存/删除后所有读取路径立即可见最新快照（修复旧版返回启动时旧快照的问题）。
  return loadedPromise.then(() => cachedConfigs)
}

async function persistConfigs(configs) {
  const previous = cachedConfigs
  cachedConfigs = configs
  try {
    await fsp.mkdir(storageDir(), { recursive: true })
    const file = storageFile()
    const tmp = file + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(configs, null, 2), 'utf8')
    await fsp.rename(tmp, file)
  } catch (err) {
    cachedConfigs = previous // 写盘失败：内存回滚，与磁盘保持一致
    console.error('[dsh-mysql] 保存连接配置失败', describeDbError(err))
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
    // 结构变更权限：默认关闭；旧配置没有该字段 → false（无需迁移）
    allowDdl: raw.allowDdl === true,
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
    allowDdl: c.allowDdl,
    hasPassword: c.password.length > 0,
    lastTest: lastTest.get(c.id) || null,
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
    // 原样保留 MySQL 返回的日期/时间字符串，避免 mysql2 按本机时区转 Date 后
    // 再由 jsonSafe 的 toISOString() 转成 UTC，造成 DATETIME/TIMESTAMP 时区偏移。
    dateStrings: true,
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

// ── 会话级数据源选择 ───────────────────────────────────────────────────────

const sessionSelection = new Map() // sessionId -> Set<connectionId>; absent != explicitly empty
const lastTest = new Map() // connectionId -> { at, latencyMs, error }（内存态：dsh web 重启后重置）

function resolveSelectedIds(configs, sessionId) {
  return resolveSelectedConnectionIds(configs.connections, sessionId, sessionSelection)
}

function resolveSelectedConnections(configs, sessionId) {
  const selectedIds = resolveSelectedIds(configs, sessionId)
  return selectedIds
    .map((id) => configs.connections.find((connection) => connection.id === id))
    .filter(Boolean)
}

function resolveToolConnection(configs, sessionId, requestedId) {
  return resolveSelectedConnection(configs.connections, sessionId, requestedId, sessionSelection)
}

function selectionResult(configs, sessionId) {
  const connectionIds = resolveSelectedIds(configs, sessionId)
  return {
    connectionIds,
    // Legacy scalar field remains populated only when routing is unambiguous.
    connectionId: connectionIds.length === 1 ? connectionIds[0] : null,
  }
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

/** 工具执行公共前置：解析会话 → 验证所选目标 → 连接池。 */
async function execCtx(exec, args) {
  const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : undefined
  const configs = await ensureLoaded()
  const resolved = resolveToolConnection(configs, sessionId, args && args.connectionId)
  if (resolved.error !== undefined) return { error: resolved.error }
  const connection = resolved.connection
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

function connectionToolError(connection, error) {
  return toolError('数据源「' + connection.name + '」（connectionId=' + connection.id + '）：' + String(error))
}

const mysqlQueryTool = {
  name: 'mysql_query',
  description:
    '在当前会话已选数据源上执行一条只读 SQL（仅 SELECT/SHOW/DESCRIBE/EXPLAIN，单条语句），受目标数据源表白名单限制（空名单=不限制）。' +
    '多选数据源时必须通过 connectionId 指定其中一个目标；仅选中一个时可省略。返回 { columns, rowCount, totalRowCount, truncated, rows }，最多 ' + MAX_ROWS + ' 行。查询前先用 mysql_tables 确认结构；写操作用 mysql_execute。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      connectionId: { type: 'string', description: '多选数据源时必填：选择当前会话已选的一个数据源 ID。' },
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
    const base = await execCtx(exec, args)
    if (base.error !== undefined) return toolError(base.error)
    const kind = classifyStatement(sql)
    if (kind !== 'read') {
      return connectionToolError(base.connection, 'mysql_query 只允许 SELECT/SHOW/DESCRIBE/EXPLAIN 语句；写入请使用 mysql_execute，结构变更请使用 mysql_ddl')
    }
    if (hasMultipleStatements(sql)) return connectionToolError(base.connection, '不允许一次执行多条语句')
    const allow = checkTableAllowlist(sql, base.connection.tables)
    if (!allow.ok) return connectionToolError(base.connection, '查询涉及白名单外的表：' + allow.denied.join(', '))
    try {
      const result = await runQuery(base.pool, prependExecutionHint(sql, kind), args && args.params)
      return { ok: true, connection: base.connection.name, connectionId: base.connection.id, ...result }
    } catch (err) {
      return connectionToolError(base.connection, '查询失败：' + describeDbError(err))
    }
  },
}

const mysqlTablesTool = {
  name: 'mysql_tables',
  description:
    '列出当前会话已选数据源的可读表结构（表名/列名/类型/可否空/键/注释），受该数据源白名单限制；多选时必须用 connectionId 指定目标，单选可省略；table 参数可模糊过滤，缺省返回全部。' +
    '写 SQL 前先用它确认字段名与类型，避免凭空猜测。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      connectionId: { type: 'string', description: '多选数据源时必填：选择当前会话已选的一个数据源 ID。' },
      table: { type: 'string', description: '可选：按表名模糊过滤（不区分大小写）。' },
    },
  },
  output: OUTPUT,
  timeoutMs: 15000,
  async execute(args, exec) {
    const base = await execCtx(exec, args)
    if (base.error !== undefined) return toolError(base.error)
    const filter = typeof (args && args.table) === 'string' ? args.table.trim().toLowerCase() : ''
    const allowed = base.connection.tables
    try {
      const [rows] = await base.pool.query(
        'SELECT table_schema, table_name, column_name, column_type, is_nullable, column_key, column_comment ' +
        'FROM information_schema.columns WHERE table_schema = DATABASE() ' +
        'ORDER BY table_name, ordinal_position',
      )
      const grouped = groupColumnMetadata(rows, allowed, filter, base.connection.database)
      if (!grouped.ok) return connectionToolError(base.connection, '读取表结构失败：' + grouped.error)
      return { ok: true, connection: base.connection.name, connectionId: base.connection.id, tables: grouped.tables }
    } catch (err) {
      return connectionToolError(base.connection, '读取表结构失败：' + describeDbError(err))
    }
  },
}

const mysqlExecuteTool = {
  name: 'mysql_execute',
  description:
    '对当前会话已选数据源执行一条写 SQL（仅 INSERT/UPDATE/DELETE，单条语句）。多选时必须用 connectionId 指定一个已选目标，单选可省略。仅当目标连接显式开启「允许写操作」时可用（默认关闭）；' +
    '表名受目标数据源白名单限制；结构变更（DDL）与多语句一律拒绝（DDL 请用 mysql_ddl）。返回 { affectedRows, insertId }。写前先查库确认目标数据，值用 ? 占位符传参。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      connectionId: { type: 'string', description: '多选数据源时必填：选择当前会话已选的一个数据源 ID。' },
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
    const base = await execCtx(exec, args)
    if (base.error !== undefined) return toolError(base.error)
    if (base.connection.allowWrite !== true) {
      return connectionToolError(base.connection, '当前连接未开启写权限（allowWrite=false）：请在 设置 → MySQL 数据库 中为该连接开启「允许 Agent 执行写操作」')
    }
    const kind = classifyStatement(sql)
    if (kind !== 'write-dml') {
      return connectionToolError(base.connection, 'mysql_execute 只允许 INSERT/UPDATE/DELETE 语句；结构变更（DDL）请使用 mysql_ddl，其它写操作一律拒绝')
    }
    if (hasMultipleStatements(sql)) return connectionToolError(base.connection, '不允许一次执行多条语句')
    const allow = checkTableAllowlist(sql, base.connection.tables)
    if (!allow.ok) return connectionToolError(base.connection, '写入涉及白名单外的表：' + allow.denied.join(', '))
    try {
      const [result] = await base.pool.execute(sql, Array.isArray(args && args.params) ? args.params : [])
      return {
        ok: true,
        connection: base.connection.name,
        connectionId: base.connection.id,
        affectedRows: (result && result.affectedRows) || 0,
        insertId: (result && result.insertId) || 0,
      }
    } catch (err) {
      return connectionToolError(base.connection, '写入失败：' + describeDbError(err))
    }
  },
}

const mysqlDdlTool = {
  name: 'mysql_ddl',
  description:
    '对当前会话已选数据源执行一条结构变更 SQL（仅 CREATE/ALTER/DROP/RENAME/TRUNCATE 作用于表、视图、索引，单条语句）。多选时必须用 connectionId 指定一个已选目标，单选可省略。' +
    '仅当目标连接显式开启「允许结构变更（DDL）」时可用（默认关闭）；DDL 不可回滚，执行前先用 mysql_tables 确认现有结构。' +
    '账号与权限类语句（CREATE/ALTER/DROP USER、CREATE/DROP ROLE、GRANT、REVOKE）与库级语句（CREATE/ALTER/DROP DATABASE）永久拒绝；' +
    'ALTER/RENAME/DROP/TRUNCATE 的目标表受白名单限制（空名单=不限制），CREATE 新表无需预先加入白名单；目标只能是当前连接的默认库，跨库目标一律拒绝。' +
    '返回 { affectedRows, warningCount }。值可用 ? 占位符传参，表名/列名等标识符不能用占位符。',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      connectionId: { type: 'string', description: '多选数据源时必填：选择当前会话已选的一个数据源 ID。' },
      sql: { type: 'string', description: '一条 CREATE/ALTER/DROP/RENAME/TRUNCATE SQL 语句（作用于表、视图、索引）。' },
      params: { type: 'array', description: '可选的位置参数，对应 SQL 中的 ? 占位符。' },
    },
    required: ['sql'],
  },
  output: OUTPUT,
  timeoutMs: 30000,
  async execute(args, exec) {
    const sql = stripSqlComments(typeof (args && args.sql) === 'string' ? args.sql : '').trim()
    if (!sql) return toolError('SQL 为空')
    const base = await execCtx(exec, args)
    if (base.error !== undefined) return toolError(base.error)
    if (base.connection.allowDdl !== true) {
      return connectionToolError(base.connection, '当前连接未开启结构变更权限（allowDdl=false）：请在 设置 → MySQL 数据库 → 权限与安全 中为该连接开启「允许结构变更（DDL）」')
    }
    const kind = classifyStatement(sql)
    if (kind !== 'ddl') {
      return connectionToolError(base.connection, 'mysql_ddl 只允许 CREATE/ALTER/DROP/RENAME/TRUNCATE 作用于表、视图、索引；账号与权限类语句、库级语句与其它语句一律拒绝')
    }
    if (hasMultipleStatements(sql)) return connectionToolError(base.connection, '不允许一次执行多条语句')
    const ddl = extractDdlTargets(sql)
    const boundary = checkDatabaseBoundary([...ddl.created, ...ddl.mutated, ...ddl.referenced], base.connection.database)
    if (!boundary.ok) {
      const scope = base.connection.database ? '（' + base.connection.database + '）' : '（连接未配置默认库）'
      return connectionToolError(base.connection, '结构变更只能作用于当前连接的默认库' + scope + '，跨库目标被拒绝：' + boundary.denied.join(', '))
    }
    // 新建对象豁免白名单（新名字不可能预先在白名单里）；改/删目标与语句读到的表都要命中
    const targets = checkTableRefs(ddl.mutated.map((r) => r.name), base.connection.tables)
    if (!targets.ok) return connectionToolError(base.connection, '结构变更涉及白名单外的表：' + targets.denied.join(', '))
    const reads = checkTableRefs(
      [...extractTableRefs(sql), ...ddl.referenced.map((ref) => ref.name)],
      base.connection.tables,
    )
    if (!reads.ok) return connectionToolError(base.connection, '结构变更涉及白名单外的表：' + reads.denied.join(', '))
    try {
      // 文本协议（pool.query）：MySQL 对部分 DDL 直接返回 ER_UNSUPPORTED_PS 1295，
      // 不能走 mysql_execute 使用的预处理协议。
      const [result] = await base.pool.query(sql, Array.isArray(args && args.params) ? args.params : [])
      const header = result !== null && typeof result === 'object' && !Array.isArray(result) ? result : null
      return {
        ok: true,
        connection: base.connection.name,
        connectionId: base.connection.id,
        affectedRows: header && typeof header.affectedRows === 'number' ? header.affectedRows : 0,
        warningCount: header && typeof header.warningStatus === 'number' ? header.warningStatus : 0,
      }
    } catch (err) {
      return connectionToolError(base.connection, '结构变更失败：' + describeDbError(err))
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
  return {
    ok: true,
    ...selectionResult(configs, sessionId),
    connections: configs.connections.map(publicView),
  }
}

async function selectConnection(args) {
  const configs = await ensureLoaded()
  const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
  const ids = args && Array.isArray(args.connectionIds)
    ? args.connectionIds
    : (args && typeof args.connectionId === 'string' && args.connectionId ? [args.connectionId] : null)
  const replaced = replaceSelectedConnectionIds(configs.connections, sessionId, ids, sessionSelection)
  if (!replaced.ok) return replaced
  const selected = configs.connections.filter((connection) => replaced.connectionIds.includes(connection.id))
  return {
    ok: true,
    ...selectionResult(configs, sessionId),
    name: selected.length === 1 ? selected[0].name : undefined,
    names: selected.map((connection) => connection.name),
  }
}

async function saveConnection(args) {
  const input = args && typeof args.connection === 'object' && !Array.isArray(args.connection) ? args.connection : null
  if (input === null) return { ok: false, error: '缺少连接配置' }
  // Host-side validation complements the UI gate: a direct RPC caller cannot
  // persist schema-change authorization without sending the explicit consent bit.
  if (input.allowDdl === true && input.ddlRiskConfirmed !== true) {
    return { ok: false, error: '开启结构变更权限前，请先勾选风险确认' }
  }
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
    return { ok: false, error: '保存失败：' + describeDbError(err) }
  }
  // 配置变更：丢弃旧池，下次使用时按新配置重建
  await dropPool(id)
  lastTest.delete(id) // 配置已变，旧的测试状态失效
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
    return { ok: false, error: '删除失败：' + describeDbError(err) }
  }
  await dropPool(connectionId)
  lastTest.delete(connectionId)
  removeSelectedConnectionId(connectionId, sessionSelection)
  return { ok: true }
}

async function testConnection(args) {
  const configs = await ensureLoaded()
  const input = args && typeof args.connection === 'object' && !Array.isArray(args.connection) ? args.connection : null
  let cfg
  let testId = null
  if (input !== null && input.name !== undefined) {
    // 测试未保存的表单草稿（不记录状态）
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
    testId = existing.id
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
    const latencyMs = Date.now() - started
    if (testId !== null) lastTest.set(testId, { at: Date.now(), latencyMs, error: null })
    return { ok: true, latencyMs, reached: !!(rows && rows[0]) }
  } catch (err) {
    const message = '连接失败：' + describeDbError(err)
    if (testId !== null) lastTest.set(testId, { at: Date.now(), latencyMs: null, error: message })
    return { ok: false, error: message }
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
    return { ok: false, error: '读取表列表失败：' + describeDbError(err) }
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
  bootLog('apply start; storage file: ' + storageFile())
  ensureLoaded() // 启动即加载（systemPrompt section 提供器同步读取内存缓存）
  ensureLoaded().then((c) => bootLog('configs loaded: ' + c.connections.length)).catch(() => {})

  // 四个全局工具：所有 Agent 预设的会话都可见。
  // 分段防护：任何一段失败只记录日志，不拖垮其余注册。
  try {
    ctx.tools.register(mysqlQueryTool)
    ctx.tools.register(mysqlTablesTool)
    ctx.tools.register(mysqlExecuteTool)
    ctx.tools.register(mysqlDdlTool)
    bootLog('tools registered: mysql_query, mysql_tables, mysql_execute, mysql_ddl')
  } catch (err) {
    bootLog('tools register FAILED: ' + describeDbError(err))
    console.error('[dsh-mysql] tools register failed', err)
  }

  // 动态 MySQL 上下文：走 systemPrompt.context（对话尾部的运行时上下文快照），
  // 不写入系统提示词前缀 —— 改变会话数据源集合/编辑配置不会让前缀缓存失效。
  try {
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== undefined && typeof systemPrompt.context === 'function') {
      systemPrompt.context({
        name: 'dsh-mysql-context',
        order: 200,
        text: (assemble) => {
          const agent = assemble && assemble.agent
          const sessionId = agent && typeof agent.id === 'string' ? agent.id : undefined
          if (cachedConfigs.connections.length === 0) return ''
          const connections = resolveSelectedConnections(cachedConfigs, sessionId)
          if (connections.length === 0) {
            return 'MySQL 数据库：当前会话尚未选择连接。需要查库时，请提醒用户在输入栏点击「数据库连接」按钮选择一个或多个连接。'
          }
          const multiple = connections.length > 1
          return [
            'MySQL 数据库上下文（以下仅列出用户为当前会话选定的数据源）：',
            ...connections.flatMap((connection) => [
              '- 数据源：' + connection.name + '（connectionId=' + connection.id + '；' + connection.host + ':' + connection.port + '/' + (connection.database || '未指定默认库') + '）',
              '  可读表：' + (connection.tables.length > 0 ? connection.tables.join('、') : '全部（未配置白名单）') + '；行写入：' + (connection.allowWrite ? '已允许' : '未允许') + '；结构变更：' + (connection.allowDdl ? '已允许' : '未允许'),
            ]),
            multiple
              ? '- 重要：每次调用 mysql_tables、mysql_query、mysql_execute 或 mysql_ddl，必须传入且仅传入一个上述已选数据源的 connectionId；禁止广播到多个数据源。'
              : '- 仅选中一个数据源，可省略工具参数 connectionId；也可显式传入上方 ID。',
            '- 工具：mysql_query 只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN，单条语句，最多返回 ' + MAX_ROWS + ' 行）；mysql_tables 查看表结构；mysql_execute 写操作（仅 INSERT/UPDATE/DELETE，需目标连接开启写权限）；mysql_ddl 结构变更（CREATE/ALTER/DROP/RENAME/TRUNCATE，需目标连接开启结构变更权限）。',
            '- DDL 目标受对应数据源的表白名单限制（空白名单=不限），且只能在其默认库内执行；查询前先用 mysql_tables 确认结构，回答时附上实际执行的 SQL 与查到的字段值。',
          ].join('\n')
        },
      })
      bootLog('systemPrompt context registered')
    }
  } catch (err) {
    bootLog('systemPrompt context FAILED: ' + describeDbError(err))
    console.error('[dsh-mysql] systemPrompt context failed', err)
  }

  // 会话销毁时清理所选数据源集合
  ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent
    if (agent && typeof agent.id === 'string') sessionSelection.delete(agent.id)
  })

  // Typert 服务提供（网关经 ./typert 清单暴露给客户端）
  try {
    Object.defineProperty(service, 'typertRemote', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: { service, serviceKey: 'mysql', namespace: 'mysql' },
    })
    ctx.provide('mysql', service)
    bootLog('service mysql provided')
  } catch (err) {
    bootLog('provide mysql FAILED: ' + describeDbError(err))
    console.error('[dsh-mysql] provide mysql failed', err)
  }

  // 回收全部连接池
  ctx.on('dispose', () => {
    for (const hit of pools.values()) hit.pool.end().catch(() => {})
    pools.clear()
  })

  bootLog('apply complete')
  console.log('[dsh-mysql] host mounted, connections =', cachedConfigs.connections.length)
}
