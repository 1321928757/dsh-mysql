/**
 * dsh-mysql 纯函数单元测试（沙箱内直接运行：node test/shared.test.mjs；
 * 不要用 node --test —— 其子进程管道在沙箱内会 EPERM）。
 */
import assert from 'node:assert/strict'
import {
  MAX_ROWS,
  stripSqlComments,
  blankStrings,
  classifyStatement,
  hasMultipleStatements,
  extractTableRefs,
  normalizeTables,
  checkTableAllowlist,
  checkTableRefs,
  extractDdlTargets,
  checkDatabaseBoundary,
  jsonSafe,
  describeDbError,
  groupColumnMetadata,
} from '../lib/shared.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('✓ ' + name)
  } catch (err) {
    console.error('✗ ' + name)
    throw err
  }
}

// ── information_schema row metadata ─────────────────────────────────────────
test('groupColumnMetadata: case-insensitive mysql2 field labels', () => {
  const result = groupColumnMetadata([
    { TABLE_NAME: 'Users', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI', COLUMN_COMMENT: '' },
    { TABLE_NAME: 'Users', COLUMN_NAME: 'email', COLUMN_TYPE: 'varchar(64)', IS_NULLABLE: 'YES', COLUMN_KEY: '', COLUMN_COMMENT: 'mail' },
  ])
  assert.deepEqual(result, { ok: true, tables: [{ name: 'users', columns: [
    { column: 'id', type: 'int', nullable: false, key: 'PRI', comment: '' },
    { column: 'email', type: 'varchar(64)', nullable: true, key: '', comment: 'mail' },
  ] }] })
})
test('groupColumnMetadata: empty rows are a valid empty table list', () => {
  assert.deepEqual(groupColumnMetadata([]), { ok: true, tables: [] })
})
test('groupColumnMetadata: missing required fields fail closed instead of stringifying undefined', () => {
  const result = groupColumnMetadata([{ TABLE_NAME: 'broken', COLUMN: 'id' }])
  assert.equal(result.ok, false)
  assert.match(result.error, /缺少必需字段/)
  assert.doesNotMatch(JSON.stringify(result), /undefined/)
})
test('groupColumnMetadata: rows from another schema are excluded', () => {
  const rows = [
    { TABLE_SCHEMA: 'test', TABLE_NAME: 'shared', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO' },
    { TABLE_SCHEMA: 'other', TABLE_NAME: 'shared', COLUMN_NAME: 'secret', COLUMN_TYPE: 'varchar(8)', IS_NULLABLE: 'YES' },
  ]
  assert.deepEqual(groupColumnMetadata(rows, [], '', 'test'), { ok: true, tables: [{ name: 'shared', columns: [
    { column: 'id', type: 'int', nullable: false, key: '', comment: '' },
  ] }] })
})
test('groupColumnMetadata: allowlist and fuzzy filter remain in force', () => {
  const rows = [
    { TABLE_NAME: 'users', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO' },
    { TABLE_NAME: 'orders', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO' },
  ]
  assert.deepEqual(groupColumnMetadata(rows, ['users'], ''), { ok: true, tables: [{ name: 'users', columns: [
    { column: 'id', type: 'int', nullable: false, key: '', comment: '' },
  ] }] })
  assert.deepEqual(groupColumnMetadata(rows, [], 'order'), { ok: true, tables: [{ name: 'orders', columns: [
    { column: 'id', type: 'int', nullable: false, key: '', comment: '' },
  ] }] })
})

// ── classifyStatement ───────────────────────────────────────────────────────
test('classify: SELECT 归为 read', () => {
  assert.equal(classifyStatement('SELECT * FROM t'), 'read')
  assert.equal(classifyStatement('  \n select 1'), 'read')
  assert.equal(classifyStatement('SHOW TABLES'), 'read')
  assert.equal(classifyStatement('DESCRIBE t'), 'read')
  assert.equal(classifyStatement('DESC t'), 'read')
  assert.equal(classifyStatement('EXPLAIN SELECT 1'), 'read')
})

test('classify: 行注释与块注释不影响分类', () => {
  assert.equal(classifyStatement('-- 查询\nSELECT * FROM t'), 'read')
  assert.equal(classifyStatement('/* 开头注释 */ SELECT * FROM t'), 'read')
  assert.equal(classifyStatement('# mysql 注释\nUPDATE t SET a=1'), 'write-dml')
})

test('classify: DML 归为 write-dml', () => {
  assert.equal(classifyStatement('INSERT INTO t VALUES (1)'), 'write-dml')
  assert.equal(classifyStatement('UPDATE t SET a=1'), 'write-dml')
  assert.equal(classifyStatement('DELETE FROM t'), 'write-dml')
  assert.equal(classifyStatement('  '), 'empty')
})

test('classify: 结构变更归为 ddl（仅 allowDdl 连接可放行）', () => {
  assert.equal(classifyStatement('CREATE TABLE t (id INT)'), 'ddl')
  assert.equal(classifyStatement('create table t (id int)'), 'ddl')
  assert.equal(classifyStatement('CREATE TEMPORARY TABLE t (id INT)'), 'ddl')
  assert.equal(classifyStatement('CREATE OR REPLACE VIEW v AS SELECT 1'), 'ddl')
  assert.equal(classifyStatement('CREATE UNIQUE INDEX i ON t (a)'), 'ddl')
  assert.equal(classifyStatement('ALTER TABLE t ADD c INT'), 'ddl')
  assert.equal(classifyStatement('ALTER TABLE t DROP COLUMN c'), 'ddl')
  assert.equal(classifyStatement('ALTER VIEW v AS SELECT 1'), 'ddl')
  assert.equal(classifyStatement('DROP TABLE t'), 'ddl')
  assert.equal(classifyStatement('DROP TABLE IF EXISTS t'), 'ddl')
  assert.equal(classifyStatement('DROP VIEW v'), 'ddl')
  assert.equal(classifyStatement('DROP INDEX i ON t'), 'ddl')
  assert.equal(classifyStatement('RENAME TABLE a TO b'), 'ddl')
  assert.equal(classifyStatement('TRUNCATE t'), 'ddl')
  assert.equal(classifyStatement('TRUNCATE TABLE t'), 'ddl')
  assert.equal(classifyStatement('-- 建表\nCREATE TABLE t (id INT)'), 'ddl')
})

test('classify: 账号/权限类与库级语句永久 forbidden（与 allowDdl 无关）', () => {
  assert.equal(classifyStatement('CREATE USER u'), 'forbidden')
  assert.equal(classifyStatement('ALTER USER u IDENTIFIED BY x'), 'forbidden')
  assert.equal(classifyStatement('DROP USER u'), 'forbidden')
  assert.equal(classifyStatement('CREATE ROLE r'), 'forbidden')
  assert.equal(classifyStatement('DROP ROLE r'), 'forbidden')
  assert.equal(classifyStatement('GRANT ALL ON *.* TO u'), 'forbidden')
  assert.equal(classifyStatement('REVOKE ALL ON *.* FROM u'), 'forbidden')
  assert.equal(classifyStatement('CREATE DATABASE d'), 'forbidden')
  assert.equal(classifyStatement('ALTER DATABASE d'), 'forbidden')
  assert.equal(classifyStatement('DROP DATABASE d'), 'forbidden')
  assert.equal(classifyStatement('CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW SET @x=1'), 'forbidden')
  assert.equal(classifyStatement('SET SESSION x=1'), 'forbidden')
  assert.equal(classifyStatement('USE other'), 'forbidden')
  assert.equal(classifyStatement('CALL p()'), 'forbidden')
  assert.equal(classifyStatement('REPLACE INTO t VALUES (1)'), 'forbidden')
  assert.equal(classifyStatement('LOCK TABLES t WRITE'), 'forbidden')
})

// ── hasMultipleStatements ───────────────────────────────────────────────────
test('multi-statement: 单语句放行、多语句拒绝', () => {
  assert.equal(hasMultipleStatements('SELECT * FROM t'), false)
  assert.equal(hasMultipleStatements('SELECT * FROM t;'), false)
  assert.equal(hasMultipleStatements('SELECT * FROM t;  '), false)
  assert.equal(hasMultipleStatements("SELECT ';' FROM t"), false)
  assert.equal(hasMultipleStatements('SELECT 1; DROP TABLE t'), true)
  assert.equal(hasMultipleStatements('SELECT 1; SELECT 2'), true)
})

// ── extractTableRefs ────────────────────────────────────────────────────────
test('extractTableRefs: FROM/JOIN/UPDATE/INTO 与子查询', () => {
  assert.deepEqual(extractTableRefs('SELECT * FROM orders'), ['orders'])
  assert.deepEqual(extractTableRefs('SELECT * FROM a JOIN b ON a.id=b.id'), ['a', 'b'])
  assert.deepEqual(extractTableRefs('SELECT * FROM (SELECT * FROM inner_t) x'), ['inner_t'])
  assert.deepEqual(extractTableRefs('SELECT * FROM `weird.name`'), ['weird.name'])
  assert.deepEqual(extractTableRefs('SELECT * FROM db1.orders'), ['orders'])
  assert.deepEqual(extractTableRefs('UPDATE t SET a=1'), ['t'])
  assert.deepEqual(extractTableRefs('INSERT INTO t2 VALUES (1)'), ['t2'])
  assert.deepEqual(extractTableRefs('DELETE FROM t3 WHERE id=1'), ['t3'])
})

test('extractTableRefs: 字符串字面量中的 FROM 不被误判', () => {
  assert.deepEqual(extractTableRefs("SELECT 'FROM fake' AS x FROM real"), ['real'])
  assert.deepEqual(extractTableRefs('SELECT "update" FROM real'), ['real'])
})

test('extractTableRefs: 注释中的表名不被误判', () => {
  assert.deepEqual(extractTableRefs('SELECT * FROM real -- FROM fake\n'), ['real'])
})

// ── normalizeTables / checkTableAllowlist ───────────────────────────────────
test('normalizeTables: 小写化、去 db 前缀、去反引号、去重', () => {
  assert.deepEqual(normalizeTables(['Orders', 'db.B', '`C`', 'b']), ['orders', 'b', 'c'])
})

test('allowlist: 空白名单不限制，非空则强制', () => {
  assert.equal(checkTableAllowlist('SELECT * FROM anything', []).ok, true)
  const ok = checkTableAllowlist('SELECT * FROM a JOIN b ON a.id=b.id', ['a', 'b'])
  assert.equal(ok.ok, true)
  const bad = checkTableAllowlist('SELECT * FROM a JOIN c ON a.id=c.id', ['a', 'b'])
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.denied, ['c'])
  // 白名单大小写不敏感
  assert.equal(checkTableAllowlist('SELECT * FROM ORDERS', ['orders']).ok, true)
})

// ── stripSqlComments / blankStrings ─────────────────────────────────────────
test('stripSqlComments: 注释变空格、字符串原样', () => {
  const out = stripSqlComments("SELECT 1 -- tail\n-- head\nSELECT 'a--b' /* c */")
  assert.equal(out.includes('-- tail'), false)
  assert.equal(out.includes("'a--b'"), true)
  assert.equal(out.includes('/* c */'), false)
})

test('blankStrings: 字符串变空格、反引号保留', () => {
  const out = blankStrings("SELECT 'x', \"y\", `z` FROM t")
  assert.equal(out.includes("'x'"), false)
  assert.equal(out.includes('"y"'), false)
  assert.equal(out.includes('`z`'), true)
  assert.equal(out.length, "SELECT 'x', \"y\", `z` FROM t".length)
})

// ── jsonSafe ────────────────────────────────────────────────────────────────
test('jsonSafe: Date/BigInt/Buffer 安全', () => {
  const d = new Date('2026-01-02T03:04:05.000Z')
  const out = jsonSafe({ d, n: 1n, arr: [1n, { a: d }], s: 'x' })
  assert.equal(out.d, '2026-01-02T03:04:05.000Z')
  assert.equal(out.n, '1')
  assert.equal(out.arr[0], '1')
  assert.equal(out.arr[1].a, '2026-01-02T03:04:05.000Z')
  assert.equal(out.s, 'x')
})

test('jsonSafe: Buffer → base64', () => {
  const out = jsonSafe({ b: Buffer.from('hi') })
  assert.equal(out.b, 'aGk=')
})

// ── 补充：多语句边界（注释 / 字符串 / 尾部连续分号）──────────────────────
test('multi-statement: 注释与字符串内的分号不算多语句，尾部连续分号放行', () => {
  assert.equal(hasMultipleStatements('INSERT INTO t VALUES (1); -- 尾部注释'), false)
  assert.equal(hasMultipleStatements("UPDATE t SET a = ';'"), false)
  assert.equal(hasMultipleStatements('SELECT 1;;'), false)
  assert.equal(hasMultipleStatements('SELECT 1;SELECT 2'), true)
})

test('classify: EXPLAIN ANALYZE 归 read；未闭合块注释不炸', () => {
  assert.equal(classifyStatement('EXPLAIN ANALYZE SELECT 1'), 'read')
  assert.equal(classifyStatement('SELECT 1 /* 未闭合'), 'read')
})

// ── 补充：表引用提取（INSERT..SELECT / UPDATE JOIN / 反引号库名）────────────
test('extractTableRefs: INSERT..SELECT 双表、UPDATE JOIN、反引号库名', () => {
  assert.deepEqual(extractTableRefs('INSERT INTO t SELECT * FROM src'), ['t', 'src'])
  assert.deepEqual(extractTableRefs('DELETE FROM t WHERE id IN (SELECT id FROM src)'), ['t', 'src'])
  assert.deepEqual(extractTableRefs('UPDATE a JOIN b ON a.id=b.id SET a.x=1'), ['a', 'b'])
  assert.deepEqual(extractTableRefs('SELECT * FROM db1.`order`'), ['order'])
  assert.deepEqual(extractTableRefs('SELECT * FROM `db1`.`orders`'), ['orders'])
})

// ── 补充：白名单跨表校验 ───────────────────────────────────────────────────
test('allowlist: INSERT..SELECT / UPDATE JOIN 引用的表都要在白名单内', () => {
  assert.equal(checkTableAllowlist('INSERT INTO t SELECT * FROM src', ['t', 'src']).ok, true)
  const denied = checkTableAllowlist('INSERT INTO t SELECT * FROM src', ['t'])
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.denied, ['src'])
  assert.equal(checkTableAllowlist('UPDATE a JOIN b ON a.id=b.id SET a.x=1', ['a', 'b']).ok, true)
})

// ── 补充：结构变更目标提取与跨库边界 ────────────────────────────────────────
const ddlNames = (refs) => refs.map((r) => r.name)

test('extractDdlTargets: ALTER/DROP/TRUNCATE/RENAME 的目标', () => {
  assert.deepEqual(ddlNames(extractDdlTargets('ALTER TABLE t ADD c INT').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('ALTER TABLE IF EXISTS t ADD c INT').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('DROP TABLE t').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('DROP TABLE IF EXISTS a, b').mutated), ['a', 'b'])
  assert.deepEqual(ddlNames(extractDdlTargets('DROP TEMPORARY TABLE t').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('TRUNCATE t').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('TRUNCATE TABLE t').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('RENAME TABLE a TO b').mutated), ['a', 'b'])
  assert.deepEqual(ddlNames(extractDdlTargets('RENAME TABLE a TO b, c TO d').mutated), ['a', 'b', 'c', 'd'])
  assert.deepEqual(ddlNames(extractDdlTargets('ALTER TABLE t RENAME TO other.t2').mutated), ['t', 't2'])
  assert.deepEqual(ddlNames(extractDdlTargets('ALTER TABLE t RENAME AS other.t2').mutated), ['t', 't2'])
  assert.deepEqual(ddlNames(extractDdlTargets('ALTER TABLE t RENAME COLUMN a TO b').mutated), ['t'])
})

test('extractDdlTargets: 新建对象进 created，索引语句认 ON 之后的表', () => {
  const create = extractDdlTargets('CREATE TABLE t (id INT)')
  assert.deepEqual(ddlNames(create.created), ['t'])
  assert.deepEqual(create.mutated, [])
  assert.deepEqual(ddlNames(extractDdlTargets('CREATE VIEW v AS SELECT 1').created), ['v'])
  assert.deepEqual(ddlNames(extractDdlTargets('CREATE INDEX i ON t (a)').created), ['i'])
  assert.deepEqual(ddlNames(extractDdlTargets('CREATE INDEX i ON t (a)').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('CREATE UNIQUE INDEX i ON t (a)').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('DROP INDEX i ON t').mutated), ['t'])
  assert.deepEqual(ddlNames(extractDdlTargets('ALTER TABLE t DROP INDEX i').mutated), ['t'])
})

test('extractDdlTargets: CREATE TABLE .. AS SELECT 同时给出新表与来源表', () => {
  const sql = 'CREATE TABLE t AS SELECT * FROM src'
  const ddl = extractDdlTargets(sql)
  assert.deepEqual(ddlNames(ddl.created), ['t'])
  assert.deepEqual(extractTableRefs(sql), ['src'])
  assert.deepEqual(ddlNames(ddl.referenced), ['src'])
  assert.equal(checkDatabaseBoundary(ddl.referenced, 'shop').ok, true)
  assert.equal(checkDatabaseBoundary(extractDdlTargets('CREATE TABLE t AS SELECT * FROM other.src').referenced, 'shop').ok, false)
  assert.equal(checkDatabaseBoundary(extractDdlTargets('CREATE TABLE t LIKE other.src').referenced, 'shop').ok, false)
  assert.equal(checkDatabaseBoundary(extractDdlTargets('CREATE TABLE child (parent_id INT, FOREIGN KEY (parent_id) REFERENCES other.parent(id))').referenced, 'shop').ok, false)
  // 白名单只列 src：新表 t 豁免，来源表 src 必须命中
  const checked = checkTableRefs([...ddlNames(ddl.mutated), ...extractTableRefs(sql)], ['src'])
  assert.equal(checked.ok, true)
  const denied = checkTableRefs([...ddlNames(ddl.mutated), ...extractTableRefs(sql)], ['other'])
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.denied, ['src'])
})

test('extractDdlTargets: 反引号与库名前缀（含名字本身带点的整体反引号）', () => {
  const ref = extractDdlTargets('DROP TABLE `db1`.`Orders`').mutated[0]
  assert.equal(ref.name, 'orders')
  assert.equal(ref.database, 'db1')
  const renamed = extractDdlTargets('ALTER TABLE t RENAME TO `db1`.`new name`').mutated[1]
  assert.equal(renamed.database, 'db1')
  assert.equal(renamed.name, 'new name')
  const bare = extractDdlTargets('DROP TABLE db1.orders').mutated[0]
  assert.equal(bare.name, 'orders')
  assert.equal(bare.database, 'db1')
  const weird = extractDdlTargets('DROP TABLE `weird.name`').mutated[0]
  assert.equal(weird.name, 'weird.name')
  assert.equal(weird.database, '')
})

test('checkDatabaseBoundary: 未加前缀或本库放行，跨库拒绝', () => {
  assert.equal(checkDatabaseBoundary(extractDdlTargets('DROP TABLE t').mutated, 'shop').ok, true)
  assert.equal(checkDatabaseBoundary(extractDdlTargets('DROP TABLE shop.t').mutated, 'shop').ok, true)
  assert.equal(checkDatabaseBoundary(extractDdlTargets('DROP TABLE SHOP.t').mutated, 'shop').ok, true)
  const denied = checkDatabaseBoundary(extractDdlTargets('DROP TABLE other.t').mutated, 'shop')
  assert.equal(denied.ok, false)
  assert.deepEqual(denied.denied, ['other.t'])
  // 未配置默认库时，任何显式库名前缀都拒绝
  assert.equal(checkDatabaseBoundary(extractDdlTargets('DROP TABLE shop.t').mutated, '').ok, false)
  assert.equal(checkDatabaseBoundary(extractDdlTargets('DROP TABLE t').mutated, '').ok, true)
})

// ── 补充：归一化上限与 JSON 安全转换透传 ────────────────────────────────────
test('normalizeTables: 上限 200 张表', () => {
  const many = Array.from({ length: 210 }, (_, i) => 't' + i)
  assert.equal(normalizeTables(many).length, 200)
})

test('jsonSafe: undefined/null/普通对象原样透传（bigint/Date/Buffer 才转换）', () => {
  const out = jsonSafe({ u: undefined, n: null, deep: { x: 1 } })
  assert.equal(out.u, undefined)
  assert.equal(out.n, null)
  assert.deepEqual(out.deep, { x: 1 })
})

// ── describeDbError：message 为空时不能退化成「Error」──────────────────────
test('describeDbError: message 为空时补上 code/errno/sqlState（保持原有前缀不变）', () => {
  // 实测：这台 MySQL 对 ER_PARSE_ERROR 返回的包 message 为空，mysql2 的
  // message/sqlMessage 都是空串，此时只有 errno/code/sqlState 可用。
  const parseError = Object.assign(new Error(''), {
    code: 'ER_PARSE_ERROR',
    errno: 1064,
    sqlState: '42000',
    sqlMessage: '',
  })
  assert.equal(describeDbError(parseError), 'MySQL 错误（ER_PARSE_ERROR 1064 42000）')
})

test('describeDbError: message 为 "Unknown error N" 时补上缺失的线索，不重复 errno', () => {
  // 实测：这台 MySQL 的错误包 message 为空，mysql2 合成了 Unknown error <errno>。
  assert.equal(
    describeDbError(Object.assign(new Error('Unknown error 1146'), { code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlState: '42S02' })),
    'Unknown error 1146（ER_NO_SUCH_TABLE 42S02）',
  )
  assert.equal(
    describeDbError(Object.assign(new Error('Unknown error 1054'), { code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22' })),
    'Unknown error 1054（ER_BAD_FIELD_ERROR 42S22）',
  )
})

test('describeDbError: 完整 message 的报错原样返回（ECONNREFUSED / fs 错误 / 真实 MySQL 描述）', () => {
  assert.equal(
    describeDbError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED', errno: -4078, syscall: 'connect' })),
    'connect ECONNREFUSED 127.0.0.1:3306',
  )
  assert.equal(
    describeDbError(Object.assign(new Error("ENOENT: no such file or directory, open 'x.json'"), { code: 'ENOENT', errno: -4058 })),
    "ENOENT: no such file or directory, open 'x.json'",
  )
  assert.equal(
    describeDbError(Object.assign(new Error("Duplicate entry '1' for key 'PRIMARY'"), { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', sqlMessage: "Duplicate entry '1' for key 'PRIMARY'" })),
    "Duplicate entry '1' for key 'PRIMARY'",
  )
})

test('describeDbError: sqlMessage 兜底，非对象 / 空对象输入不抛错', () => {
  assert.equal(describeDbError(Object.assign(new Error(''), { sqlMessage: 'Table x does not exist', errno: 1146 })), 'Table x does not exist')
  assert.equal(describeDbError(Object.assign(new Error(''), { sqlMessage: 'Unknown error 1049', code: 'ER_BAD_DB_ERROR', errno: 1049, sqlState: '42000' })), 'Unknown error 1049（ER_BAD_DB_ERROR 42000）')
  assert.equal(describeDbError(null), '未知错误')
  assert.equal(describeDbError(undefined), '未知错误')
  assert.equal(describeDbError('boom'), 'boom')
  assert.equal(describeDbError(123), '123')
  assert.equal(describeDbError({}), '未知错误')
  assert.equal(describeDbError(new Error('')), '未知错误')
})

console.log('\n全部通过：' + passed + ' 组断言')
console.log('MAX_ROWS =', MAX_ROWS)
