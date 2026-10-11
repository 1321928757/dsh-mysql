/**
 * dsh-mysql 纯函数工具集：SQL 语句分类、表白名单校验、JSON 安全转换。
 * 无任何外部依赖，Host（lib/index.js）与单元测试（test/shared.test.mjs）共用。
 */

/** mysql_query 单次返回的最大行数，超出则截断并在结果中标记 truncated。 */
export const MAX_ROWS = 2000

/** Read a row property by SQL field label, tolerating server/driver label casing. */
export function readRowField(row, fieldName) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return undefined
  if (Object.prototype.hasOwnProperty.call(row, fieldName)) return row[fieldName]
  const wanted = String(fieldName).toLowerCase()
  const actual = Object.keys(row).find((key) => key.toLowerCase() === wanted)
  return actual === undefined ? undefined : row[actual]
}

/** Group information_schema.columns rows, tolerating column-label casing differences. */
export function groupColumnMetadata(rows, allowedTables = [], tableFilter = '', defaultDatabase = '') {
  if (!Array.isArray(rows)) return { ok: false, error: '数据库驱动返回的行集合不是数组' }
  const allowed = Array.isArray(allowedTables) ? allowedTables.map((name) => String(name).toLowerCase()) : []
  const filter = typeof tableFilter === 'string' ? tableFilter.trim().toLowerCase() : ''
  const database = typeof defaultDatabase === 'string' ? defaultDatabase.trim().toLowerCase() : ''
  const byTable = new Map()
  for (const row of rows) {
    const tableName = readRowField(row, 'table_name')
    const columnName = readRowField(row, 'column_name')
    const columnType = readRowField(row, 'column_type')
    const isNullable = readRowField(row, 'is_nullable')
    if ([tableName, columnName, columnType, isNullable].some((value) => value === undefined || value === null)) {
      const fields = row && typeof row === 'object' ? Object.keys(row).join(', ') : typeof row
      return { ok: false, error: 'information_schema 返回行缺少必需字段（实际字段：' + fields + '）' }
    }
    const table = String(tableName).toLowerCase()
    const tableSchema = readRowField(row, 'table_schema')
    if (tableSchema !== undefined && tableSchema !== null && database && String(tableSchema).toLowerCase() !== database) continue
    if (allowed.length > 0 && !allowed.includes(table)) continue
    if (filter && !table.includes(filter)) continue
    if (!byTable.has(table)) byTable.set(table, [])
    const columnKey = readRowField(row, 'column_key')
    const columnComment = readRowField(row, 'column_comment')
    byTable.get(table).push({
      column: String(columnName),
      type: String(columnType),
      nullable: String(isNullable).toUpperCase() === 'YES',
      key: columnKey ? String(columnKey) : '',
      comment: columnComment ? String(columnComment) : '',
    })
  }
  const tables = [...byTable.keys()].sort().map((name) => ({ name, columns: byTable.get(name) }))
  return { ok: true, tables }
}

/**
 * 去掉 SQL 注释（-- 行注释、# 行注释、\/* *\/ 块注释），字符串字面量保持原样，
 * 用于语句分类与多语句检测。返回与输入等长的字符串（注释替换为空格）。
 */
export function stripSqlComments(sql) {
  if (typeof sql !== 'string') return ''
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') { out += ' '; i++ }
    } else if (c === '#') {
      while (i < n && sql[i] !== '\n') { out += ' '; i++ }
    } else if (c === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) { out += ' '; i++ }
      out += '  '
      i += 2
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c
      out += c
      i++
      while (i < n) {
        const ch = sql[i]
        if (ch === '\\' && q !== '`') {
          out += ch
          i++
          if (i < n) { out += sql[i]; i++ }
          continue
        }
        out += ch
        i++
        if (ch === q) {
          if (sql[i] === q) { out += q; i++; continue }
          break
        }
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * 把字符串字面量（'...' 与 "..."）替换为等长空格，但保留反引号标识符，
 * 供表名提取正则安全扫描（避免把字符串内容里的 FROM xxx 误判为表引用）。
 */
export function blankStrings(sql) {
  if (typeof sql !== 'string') return ''
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === '`') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '`') {
          if (sql[j + 1] === '`') { j += 2; continue }
          j++
          break
        }
        j++
      }
      out += sql.slice(i, j)
      i = j
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) {
        const ch = sql[j]
        if (ch === '\\') { j += 2; continue }
        if (ch === c) {
          if (sql[j + 1] === c) { j += 2; continue }
          j++
          break
        }
        j++
      }
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * 结构变更（DDL）判定：动词与对象词必须同时命中。
 *
 * 只按首词放行会把 `CREATE USER` / `DROP DATABASE` 这类账号与库级语句一起放进来 ——
 * 它们与表结构变更同为首词，但属于提权与库级操作，永久拒绝（不进 ddl 桶）。
 * 覆盖范围：CREATE/ALTER/DROP/RENAME/TRUNCATE 作用于 TABLE / VIEW / INDEX。
 */
const DDL_PATTERNS = [
  /^create\s+(?:or\s+replace\s+)?(?:(?:temporary|unique|fulltext|spatial)\s+)*(?:table|view|index)\b/i,
  /^alter\s+(?:(?:online|offline|ignore)\s+)*(?:table|view)\b/i,
  /^drop\s+(?:temporary\s+)?(?:table|view|index)\b/i,
  /^rename\s+tables?\b/i,
  /^truncate\s+(?:table\s+)?(?=[`A-Za-z0-9_$])/i,
]

function isDdlStatement(cleaned) {
  for (const re of DDL_PATTERNS) {
    if (re.test(cleaned)) return true
  }
  return false
}

/**
 * 语句分类：
 *  - read:       SELECT / SHOW / DESCRIBE / DESC / EXPLAIN
 *  - write-dml:  INSERT / UPDATE / DELETE
 *  - ddl:        CREATE / ALTER / DROP / RENAME / TRUNCATE 作用于 TABLE / VIEW / INDEX，
 *                即结构变更（要求连接显式开启 allowDdl，见 DDL_PATTERNS）
 *  - forbidden:  账号与权限类（CREATE|ALTER|DROP USER / ROLE、GRANT、REVOKE）、库级语句
 *                （CREATE|ALTER|DROP DATABASE）与 LOCK / UNLOCK / SET / USE / CALL /
 *                REPLACE / LOAD / HANDLER / DO 等 —— 与 allowDdl 无关，永久拒绝
 *  - unknown:    无法识别
 *  - empty:      空白
 */
export function classifyStatement(sql) {
  const cleaned = stripSqlComments(sql).trim()
  if (!cleaned) return 'empty'
  if (/^select\b/i.test(cleaned)) return 'read'
  if (/^show\b/i.test(cleaned)) return 'read'
  if (/^(describe|desc)\b/i.test(cleaned)) return 'read'
  if (/^explain\b/i.test(cleaned)) return 'read'
  if (/^insert\b/i.test(cleaned)) return 'write-dml'
  if (/^update\b/i.test(cleaned)) return 'write-dml'
  if (/^delete\b/i.test(cleaned)) return 'write-dml'
  if (isDdlStatement(cleaned)) return 'ddl'
  if (/^(drop|truncate|alter|create|rename|grant|revoke|lock|unlock|set|use|call|do|handler|load|replace|start|stop|kill|purge|reset|flush|analyze|optimize|repair|check)\b/i.test(cleaned)) return 'forbidden'
  return 'unknown'
}

/** 检测多语句：去掉注释与字符串内容后，除末尾分号外仍出现分号即视为多语句。 */
export function hasMultipleStatements(sql) {
  const cleaned = blankStrings(stripSqlComments(sql)).trim()
  const noTrailing = cleaned.replace(/;+\s*$/, '')
  return noTrailing.includes(';')
}

/** 提取 FROM / JOIN / UPDATE / INTO 后的表引用（小写表名；db. 前缀取最后一段）。 */
const TABLE_REF_RE = /\b(from|join|update|into)\s+((?:`[^`]+`|[A-Za-z0-9_$]+)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z0-9_$]+))*)/gi

export function extractTableRefs(sql) {
  const cleaned = blankStrings(stripSqlComments(sql))
  const names = new Set()
  let m
  TABLE_REF_RE.lastIndex = 0
  while ((m = TABLE_REF_RE.exec(cleaned)) !== null) {
    const ref = m[2].replace(/\s+/g, '')
    // 整体被一对反引号包裹 = 表名本身含点（如 `weird.name`），不按 db. 拆分
    if (/^`[^`]+`$/.test(ref)) {
      const table = ref.slice(1, -1).toLowerCase()
      if (table) names.add(table)
      continue
    }
    const parts = ref.split('.')
    let last = parts[parts.length - 1]
    if (last.startsWith('`') && last.endsWith('`')) last = last.slice(1, -1)
    const table = last.toLowerCase()
    if (table) names.add(table)
  }
  return [...names]
}

/**
 * 表名白名单归一化：字符串数组 → 纯小写表名（去反引号、去 db. 前缀、去重、截断）。
 * 空数组表示「不限制」。
 */
export function normalizeTables(tables) {
  if (!Array.isArray(tables)) return []
  const seen = new Set()
  const out = []
  for (const t of tables) {
    const s = String(t).trim().replace(/`/g, '')
    if (!s) continue
    const parts = s.split('.')
    const name = parts[parts.length - 1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out.slice(0, 200)
}

/**
 * 校验一组表名是否全部在白名单内。
 * 白名单为空 → 放行（不限制）；否则返回 { ok:false, denied: [...] }。
 * DML（SQL 提取）与 DDL（目标对象提取）共用同一套白名单语义。
 */
export function checkTableRefs(names, allowlist) {
  const list = normalizeTables(allowlist)
  if (list.length === 0) return { ok: true }
  const denied = []
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw).trim().replace(/`/g, '').toLowerCase()
    if (name && !list.includes(name) && !denied.includes(name)) denied.push(name)
  }
  return denied.length > 0 ? { ok: false, denied } : { ok: true }
}

/**
 * 校验 SQL 引用的表是否全部在白名单内（DML 路径，沿用 FROM/JOIN/UPDATE/INTO 提取）。
 * 白名单为空 → 放行（不限制）；否则返回 { ok:false, denied: [...] }。
 */
export function checkTableAllowlist(sql, allowlist) {
  return checkTableRefs(extractTableRefs(sql), allowlist)
}

// ── 结构变更（DDL）目标提取与跨库边界 ─────────────────────────────────────
//
// 白名单与库边界都必须看到 DDL 的目标对象，而 DDL 的语法形态与 DML 完全不同：
// `DROP TABLE t` / `ALTER TABLE t` / `TRUNCATE t` 里没有 FROM/JOIN/UPDATE/INTO，
// 走 extractTableRefs 会得到空集合 —— 校验会「空过」。这一节专门提取这些形态。

/** 标识符：反引号包裹或裸词。 */
const IDENT = '(?:`[^`]+`|[A-Za-z0-9_$]+)'
/** 可能带库名前缀的标识符：a.b / `a`.`b` / a。 */
const QUALIFIED = IDENT + '(?:\\s*\\.\\s*' + IDENT + ')*'

/** 把一个（可能带库名前缀的）标识符解析为 { raw, database, name }。 */
function parseRef(raw) {
  // 去掉点号两侧的语法空格，但保留反引号标识符内部的空格。
  const text = String(raw).trim().replace(/\s*\.\s*/g, '.')
  if (!text) return null
  // 整体被一对反引号包裹 = 名字本身含点，不按库名拆分
  if (/^`[^`]+`$/.test(text)) {
    return { raw: text, database: '', name: text.slice(1, -1).toLowerCase() }
  }
  const parts = text.split('.')
  const last = parts[parts.length - 1].replace(/`/g, '')
  const dbPart = parts.length >= 2 ? parts[parts.length - 2].replace(/`/g, '') : ''
  if (!last) return null
  return { raw: text, database: dbPart.toLowerCase(), name: last.toLowerCase() }
}

/** 逐个取出文本里的（可能带库名前缀的）标识符。 */
function collectRefs(text) {
  const out = []
  const re = new RegExp(QUALIFIED, 'g')
  let m
  while ((m = re.exec(text)) !== null) out.push(m[0])
  return out
}

/**
 * 提取结构变更语句的目标与来源引用，返回 { created, mutated, referenced }：
 *  - created：本次创建的新对象（CREATE TABLE / VIEW，CREATE INDEX 的索引名）
 *             —— 新建的名字不可能预先出现在白名单里，因此豁免白名单校验；
 *  - mutated：被修改/删除的目标（ALTER / DROP / TRUNCATE / RENAME，以及索引语句里
 *             `ON` 之后的那张表）—— 参与白名单校验；referenced 是 CREATE ... LIKE/AS SELECT
 *             等语句中的来源表（也参与库边界与白名单检查）。
 * 每项为 { raw, database, name }；database 为空表示语句未加库名前缀。
 */
export function extractDdlTargets(sql) {
  const cleaned = blankStrings(stripSqlComments(sql))
  const created = []
  const mutated = []
  const referenced = []
  const push = (bucket, raw) => {
    const ref = parseRef(raw)
    if (ref !== null && !bucket.some((r) => r.raw === ref.raw)) bucket.push(ref)
  }
  let m

  const alterHead = '\\balter\\s+(?:(?:online|offline|ignore)\\s+)*(?:table|view)\\s+(?:if\\s+exists\\s+)?'
  const alterRe = new RegExp(alterHead + '(' + QUALIFIED + ')', 'gi')
  while ((m = alterRe.exec(cleaned)) !== null) push(mutated, m[1])

  // ALTER TABLE ... RENAME [TO|AS] new_name also mutates the destination.
  // Ignore RENAME COLUMN / RENAME INDEX, whose following identifier is not a table.
  const alterRenameRe = new RegExp(alterHead + '(' + QUALIFIED + ')[\\s\\S]*?\\brename\\s+(?!(?:column|index)\\b)(?:(?:to|as)\\s+)?(' + QUALIFIED + ')', 'gi')
  while ((m = alterRenameRe.exec(cleaned)) !== null) { push(mutated, m[1]); push(mutated, m[2]) }

  const createRe = new RegExp('\\bcreate\\s+(?:or\\s+replace\\s+)?(?:temporary\\s+)?(?:table|view)\\s+(?:if\\s+not\\s+exists\\s+)?(' + QUALIFIED + ')', 'gi')
  while ((m = createRe.exec(cleaned)) !== null) push(created, m[1])

  const createIndexRe = new RegExp('\\bcreate\\s+(?:or\\s+replace\\s+)?(?:(?:unique|fulltext|spatial)\\s+)*index\\s+(' + QUALIFIED + ')\\s+on\\s+(' + QUALIFIED + ')', 'gi')
  while ((m = createIndexRe.exec(cleaned)) !== null) { push(created, m[1]); push(mutated, m[2]) }

  const dropRe = new RegExp('\\bdrop\\s+(?:temporary\\s+)?(?:table|view)\\s+(?:if\\s+exists\\s+)?(' + QUALIFIED + '(?:\\s*,\\s*' + QUALIFIED + ')*)', 'gi')
  while ((m = dropRe.exec(cleaned)) !== null) {
    for (const ref of collectRefs(m[1])) push(mutated, ref)
  }

  const dropIndexRe = new RegExp('\\bdrop\\s+index\\s+(' + QUALIFIED + ')\\s+on\\s+(' + QUALIFIED + ')', 'gi')
  while ((m = dropIndexRe.exec(cleaned)) !== null) push(mutated, m[2])

  const truncateRe = new RegExp('\\btruncate\\s+(?:table\\s+)?(' + QUALIFIED + ')', 'gi')
  while ((m = truncateRe.exec(cleaned)) !== null) push(mutated, m[1])

  // RENAME TABLE a TO b, c TO d —— 源名与目标名都是本次改动的对象
  const renameRe = new RegExp('(?:\\brename\\s+tables?\\s+|,\\s*)(' + QUALIFIED + ')\\s+to\\s+(' + QUALIFIED + ')', 'gi')
  while ((m = renameRe.exec(cleaned)) !== null) { push(mutated, m[1]); push(mutated, m[2]) }

  // Also scope data/schema sources referenced by CREATE ... AS SELECT or LIKE.
  const tableRefRe = /\b(from|join|update|into|references)\s+((?:`[^`]+`|[A-Za-z0-9_$]+)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z0-9_$]+))*)/gi
  tableRefRe.lastIndex = 0
  while ((m = tableRefRe.exec(cleaned)) !== null) push(referenced, m[2])
  const likeRe = new RegExp('\\blike\\s+(' + QUALIFIED + ')', 'gi')
  while ((m = likeRe.exec(cleaned)) !== null) push(referenced, m[1])

  return { created, mutated, referenced }
}

/**
 * 跨库边界：目标对象的库名前缀必须与连接的默认库一致（未加前缀视为默认库）。
 * 默认库为空时，任何显式带库名前缀的目标都被拒绝。
 * 返回 { ok:true } 或 { ok:false, denied: [原始目标...] }。
 */
export function checkDatabaseBoundary(refs, defaultDatabase) {
  const db = typeof defaultDatabase === 'string' ? defaultDatabase.trim().replace(/`/g, '').toLowerCase() : ''
  const denied = []
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (ref === null || typeof ref !== 'object') continue
    const qualified = typeof ref.database === 'string' ? ref.database : ''
    if (qualified && qualified !== db && !denied.includes(ref.raw)) denied.push(ref.raw)
  }
  return denied.length > 0 ? { ok: false, denied } : { ok: true }
}

/** 将 mysql2 行值转换为无损 JSON（Date/Buffer/bigint 安全）。 */
export function jsonSafe(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('base64')
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = jsonSafe(value[key])
    return out
  }
  return value
}

/**
 * 把驱动 / 服务端错误整理成一行可读文本。
 *
 * 背景：当 MySQL（或前置代理）返回 message 为空的错误包时，mysql2 的
 * `err.message` 与 `err.sqlMessage` 都会退化成空串或 `Unknown error <errno>`，
 * 而 `errno` / `code` / `sqlState` 仍然有效。此时 `String(err.message || err)`
 * 只会输出毫无信息量的「Error」/「Unknown error 1146」，把 1064、1146、1054
 * 这类关键线索丢掉。
 *
 * 规则：优先 message，缺失时退回 sqlMessage；**只有当 message 信息量为零**
 * （空串，或 mysql2 合成的 `Unknown error <errno>`）时才补上尚未出现的
 * `code` / `errno` / `sqlState`。完整可读的报错文本（ECONNREFUSED、ENOENT、
 * 真实 MySQL 错误描述）原样返回，不追加噪音。
 */
export function describeDbError(err) {
  if (err === null || err === undefined) return '未知错误'
  if (typeof err !== 'object') return String(err)
  const message = typeof err.message === 'string' ? err.message.trim() : ''
  const sqlMessage = typeof err.sqlMessage === 'string' ? err.sqlMessage.trim() : ''
  const detail = message !== '' ? message : sqlMessage
  const tags = [err.code, err.errno, err.sqlState]
    .map((part) => (part === undefined || part === null ? '' : String(part).trim()))
    .filter((part) => part !== '' && !detail.includes(part))
    .join(' ')
  const degenerate = detail === '' || /^unknown error \d+$/i.test(detail)
  if (!degenerate) return detail
  if (detail !== '' && tags !== '') return detail + '（' + tags + '）'
  if (tags !== '') return 'MySQL 错误（' + tags + '）'
  return detail !== '' ? detail : '未知错误'
}
