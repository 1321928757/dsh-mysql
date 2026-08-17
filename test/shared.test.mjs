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
  jsonSafe,
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

test('classify: DML 归为 write-dml，DDL 归为 forbidden', () => {
  assert.equal(classifyStatement('INSERT INTO t VALUES (1)'), 'write-dml')
  assert.equal(classifyStatement('UPDATE t SET a=1'), 'write-dml')
  assert.equal(classifyStatement('DELETE FROM t'), 'write-dml')
  assert.equal(classifyStatement('DROP TABLE t'), 'forbidden')
  assert.equal(classifyStatement('TRUNCATE t'), 'forbidden')
  assert.equal(classifyStatement('ALTER TABLE t ADD c INT'), 'forbidden')
  assert.equal(classifyStatement('CREATE TABLE t (id INT)'), 'forbidden')
  assert.equal(classifyStatement('SET SESSION x=1'), 'forbidden')
  assert.equal(classifyStatement('REPLACE INTO t VALUES (1)'), 'forbidden')
  assert.equal(classifyStatement('  '), 'empty')
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

console.log('\n全部通过：' + passed + ' 组断言')
console.log('MAX_ROWS =', MAX_ROWS)
