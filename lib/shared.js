/**
 * dsh-mysql 纯函数工具集：SQL 语句分类、表白名单校验、JSON 安全转换。
 * 无任何外部依赖，Host（lib/index.js）与单元测试（test/shared.test.mjs）共用。
 */

/** mysql_query 单次返回的最大行数，超出则截断并在结果中标记 truncated。 */
export const MAX_ROWS = 2000

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
 * 语句分类：
 *  - read:       SELECT / SHOW / DESCRIBE / DESC / EXPLAIN
 *  - write-dml:  INSERT / UPDATE / DELETE
 *  - forbidden:  DROP / TRUNCATE / ALTER / CREATE / RENAME / GRANT / REVOKE /
 *                LOCK / UNLOCK / SET / USE / CALL / REPLACE / LOAD / HANDLER / DO 等
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
 * 校验 SQL 引用的表是否全部在白名单内。
 * 白名单为空 → 放行（不限制）；否则返回 { ok:false, denied: [...] }。
 */
export function checkTableAllowlist(sql, allowlist) {
  const list = normalizeTables(allowlist)
  if (list.length === 0) return { ok: true }
  const refs = extractTableRefs(sql)
  const denied = refs.filter((t) => !list.includes(t))
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
