/**
 * DSH 0.2 Client Typert/Remote 描述符契约测试。
 *
 * 直接在沙箱内运行：node test/client-typert.test.mjs
 * （不要用 node --test —— 其子进程管道在沙箱内会 EPERM）
 *
 * 覆盖的运行时契约（DSH 0.2.0-rc.2 内置运行时源码）：
 *  - @deepseek-ai/dsh-typert-registry/lib/client.js
 *      validateInvocation() / validateCodec()：strict codec 必须提供 create() factory；
 *  - @deepseek-ai/dsh-api-gateway/lib/client.js
 *      validateContribution() / requireStrictInputs()：参数 codec 必须是 strict；
 *      prepareInvocation()：客户端按描述符参数个数逐个传参（位置参数）。
 *
 * 失败模式回归：只带 schema 字段的旧形态会让 Client fiber 激活失败，宿主报
 * 「web boot: 1 entry did not activate / dsh-mysql: failed」。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'lib', 'client.js')

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
async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log('✓ ' + name)
  } catch (err) {
    console.error('✗ ' + name)
    throw err
  }
}

// ── 被测运行时：真实 0.2 校验规则的本地镜像 ────────────────────────────────
const WIRE_NAME = /^[A-Za-z0-9_$.-]+$/

function validateWireName(subject, value) {
  if (value === '.' || value === '..' || typeof value !== 'string' || !WIRE_NAME.test(value)) {
    throw new Error(`typert: invalid ${subject} ${JSON.stringify(value)}`)
  }
}
function validateSegment(subject, value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('#')) {
    throw new Error(`typert: invalid ${subject} ${JSON.stringify(value)}`)
  }
}
function validateNonempty(subject, value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`typert: invalid ${subject}`)
}
/** 镜像 validateCodec：只有 create() factory 才算合格的 strict codec。 */
function validateCodec(codec, subject) {
  assert.equal(typeof codec, 'object', subject + ' codec must be an object')
  if (codec.mode === 'src-json') return
  validateNonempty(`${subject} type symbol`, codec.typeSymbol)
  if (typeof codec.create !== 'function') {
    throw new Error(`typert: ${subject} strict codec has no create() factory`)
  }
  for (const method of ['decode', 'encode']) {
    if (codec[method] !== undefined && typeof codec[method] !== 'function') {
      throw new Error(`typert: ${subject} ${method} must be a function`)
    }
  }
}
/** 镜像 validateInvocation + requireStrictInputs。 */
function validateClientContribution(contribution) {
  validateSegment('package name', contribution.package)
  assert.ok(Array.isArray(contribution.descriptors), 'descriptors must be an array')
  const endpoints = new Set()
  const ids = new Set()
  for (const descriptor of contribution.descriptors) {
    validateNonempty('invocation id', descriptor.id)
    validateSegment('invocation service key', descriptor.service)
    validateWireName('invocation namespace', descriptor.namespace)
    validateWireName('invocation method', descriptor.method)
    assert.ok(
      ['direct', 'context'].includes(descriptor.invocation && descriptor.invocation.kind),
      'invocation receiver kind must be "direct" or "context"',
    )
    validateCodec(descriptor.result, `${descriptor.id} result`)
    const wires = new Set()
    for (const parameter of descriptor.parameters) {
      validateWireName('parameter name', parameter.name)
      validateWireName('parameter wire field', parameter.wire)
      if (wires.has(parameter.wire)) throw new Error(`typert: repeats wire field "${parameter.wire}"`)
      wires.add(parameter.wire)
      assert.ok(['json', 'lookup'].includes(parameter.source), 'parameter source must be json or lookup')
      validateCodec(parameter.codec, `${descriptor.id} parameter ${parameter.name}`)
      if (parameter.codec.mode !== 'strict') {
        throw new Error(`client api: generated Remote ${descriptor.namespace}/${descriptor.method} field ${JSON.stringify(parameter.wire)} has no strict codec`)
      }
    }
    const endpoint = `${descriptor.namespace}/${descriptor.method}`
    if (endpoints.has(endpoint)) throw new Error(`typert: endpoint "${endpoint}" is already registered`)
    endpoints.add(endpoint)
    if (ids.has(descriptor.id)) throw new Error(`typert: invocation id "${descriptor.id}" is already registered`)
    ids.add(descriptor.id)
  }
}

// ── 在被控环境里物化 lib/client.js ─────────────────────────────────────────
const source = readFileSync(clientPath, 'utf8')
const bootEntries = []
const fakeWindow = { __ModuleLoader__: { load: (entry) => { bootEntries.push(entry) } } }
// lib/client.js 是无 import/export 的经典脚本，只在注册表登记 factory（懒物化）。
new Function('window', source)(fakeWindow)

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
  Fragment: 'Fragment',
}

test('bundle 通过 __ModuleLoader__ 以包名登记单个 factory', () => {
  assert.equal(bootEntries.length, 1)
  assert.equal(bootEntries[0].id, 'dsh-mysql')
  assert.equal(typeof bootEntries[0].factory, 'function')
})

const materialized = bootEntries[0].factory((specifier) => {
  if (specifier === 'react') return reactStub
  throw new Error(`client bundle required an unresolved specifier: ${specifier}`)
})

test('物化后导出 Cordis 插件形状（inject + apply）', () => {
  assert.deepEqual(materialized.inject, ['remote', 'timer'])
  assert.equal(typeof materialized.apply, 'function')
})

// ── 驱动 apply，捕获 contribution 与槽位注册 ───────────────────────────────
const METHODS = ['listConnections', 'getSelection', 'selectConnection', 'saveConnection', 'deleteConnection', 'testConnection', 'listTables']

function createHarness() {
  const state = { contribution: null, slots: [], effects: [], unmounted: 0, applied: 0 }
  const remote = {
    async $mount(contribution) {
      validateClientContribution(contribution)
      state.contribution = contribution
      return async () => { state.unmounted += 1 }
    },
  }
  const api = Object.fromEntries(METHODS.map((method) => [method, async () => ({ ok: true, value: {} })]))
  const slots = {
    inject(key, callback) {
      assert.equal(typeof callback, 'function')
      state.applied += 1
      callback()
      return () => {}
    },
    register(options, component) {
      state.slots.push({ options, component })
      return () => {}
    },
  }
  const ctx = {
    get: (key) => (key === 'slots' ? slots : key === 'remote' ? remote : key === 'remote.mysql' ? api : undefined),
    effect: (fn) => { state.effects.push(fn); return () => {} },
    timeout: () => () => {},
  }
  return { state, ctx }
}

const harness = createHarness()
await testAsync('apply() 在真实 0.2 校验规则下完成 Remote 挂载与槽位注册', async () => {
  await materialized.apply(harness.ctx)
  assert.equal(harness.state.contribution !== null, true, 'remote.$mount was never called')
  assert.equal(harness.state.slots.length, 2)
  assert.equal(harness.state.applied, 2)
})

const contribution = harness.state.contribution

test('contribution 身份与 7 个方法端点保持既有 wire 名称', () => {
  assert.equal(contribution.package, 'dsh-mysql')
  assert.deepEqual(contribution.descriptors.map((d) => d.method), METHODS)
  for (const descriptor of contribution.descriptors) {
    assert.equal(descriptor.id, 'dsh-mysql#mysql/' + descriptor.method)
    assert.equal(descriptor.service, 'mysql')
    assert.equal(descriptor.namespace, 'mysql')
    assert.deepEqual(descriptor.invocation, { kind: 'direct' })
  }
})

test('每个 codec 使用 strict create() factory，且不再保留旧 schema 字段', () => {
  for (const descriptor of contribution.descriptors) {
    assert.equal(descriptor.result.mode, 'strict')
    assert.equal(typeof descriptor.result.create, 'function')
    assert.equal(descriptor.result.schema, undefined)
    assert.equal(descriptor.parameters.length, 1)
    const parameter = descriptor.parameters[0]
    assert.equal(parameter.name, 'args')
    assert.equal(parameter.wire, 'args')
    assert.equal(parameter.source, 'json')
    assert.equal(parameter.codec.mode, 'strict')
    assert.equal(typeof parameter.codec.create, 'function')
    assert.equal(parameter.codec.schema, undefined)
    assert.equal(parameter.codec.typeSymbol, 'dsh-mysql#Args')
    assert.equal(descriptor.result.typeSymbol, 'dsh-mysql#Result')
  }
})

test('create() 返回可用于边界校验的 schema（parse + safeParse）', () => {
  for (const descriptor of contribution.descriptors) {
    for (const codec of [descriptor.result, descriptor.parameters[0].codec]) {
      const schema = codec.create()
      assert.equal(typeof schema.parse, 'function')
      assert.equal(typeof schema.safeParse, 'function')
      const payload = { ok: true, connections: [] }
      assert.deepEqual(schema.parse(payload), payload)
      assert.equal(schema.safeParse(payload).success, true)
      assert.equal(schema.safeParse(null).success, false)
      assert.equal(schema.safeParse([]).success, false)
      assert.throws(() => schema.parse('nope'))
    }
  }
})

test('单参数描述符与客户端 host.call 的位置参数调用形状一致', () => {
  // 网关 prepareInvocation 要求 values.length === descriptor.parameters.length，
  // 因此每个方法都必须是「一个 args 参数」，与 host.call(method, payload) 对应。
  for (const descriptor of contribution.descriptors) {
    assert.equal(descriptor.parameters.length, 1)
    assert.equal(descriptor.parameters[0].wire, 'args')
  }
})

test('旧 schema-only 形态会被同一套 0.2 规则拒绝（回归护栏）', () => {
  const legacy = {
    package: 'dsh-mysql',
    descriptors: [{
      id: 'dsh-mysql#mysql/listConnections',
      service: 'mysql',
      namespace: 'mysql',
      method: 'listConnections',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'args',
        wire: 'args',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-mysql#Args', schema: { parse: (v) => v } },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-mysql#Result', schema: { parse: (v) => v } },
    }],
  }
  assert.throws(() => validateClientContribution(legacy), /has no create\(\) factory/)
})

test('槽位注册符合 0.2 list 槽位契约（id 必填、order/label 可选）', () => {
  const KIND = { 'conversation.input.left': 'list', 'settings.section': 'list' }
  const seen = new Set()
  for (const { options } of harness.state.slots) {
    assert.equal(typeof options.name, 'string')
    assert.equal(KIND[options.name], 'list')
    assert.equal(typeof options.id, 'string', `list slot ${options.name} requires options.id`)
    assert.equal(typeof options.order, 'number')
    assert.equal(typeof options.label, 'string')
    const cell = `${options.name}#${options.id}#${options.priority || 0}`
    assert.equal(seen.has(cell), false, `duplicate list cell ${cell}`)
    seen.add(cell)
  }
  assert.deepEqual(
    harness.state.slots.map((s) => [s.options.name, s.options.id]),
    [['conversation.input.left', 'dsh-mysql'], ['settings.section', 'mysql']],
  )
})

test('Remote contribution 通过 ctx.effect 登记可逆卸载', () => {
  assert.equal(harness.state.effects.length, 1)
  const disposerFactory = harness.state.effects[0]
  assert.equal(typeof disposerFactory, 'function')
  const disposer = disposerFactory()
  assert.equal(typeof disposer, 'function')
})

await testAsync('缺少 slots / remote 服务时 apply() 保持惰性且不抛错', async () => {
  const empty = { get: () => undefined, effect: () => () => {}, timeout: () => () => {} }
  await materialized.apply(empty)
  const noMount = { get: (key) => (key === 'slots' ? { inject() {}, register() {} } : undefined), effect: () => () => {}, timeout: () => () => {} }
  await materialized.apply(noMount)
})

console.log('\n全部通过：' + passed + ' 组断言')
