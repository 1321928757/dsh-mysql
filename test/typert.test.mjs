/**
 * DSH 0.2 Typert manifest contract tests.
 * Run directly with the bundled/current Node runtime.
 */
import assert from 'node:assert/strict'
import { TYPERT } from '../lib/typert.host.js'

assert.equal(TYPERT.package, 'dsh-mysql')
assert.equal(TYPERT.face, 'host')
assert.ok(Array.isArray(TYPERT.schemas))
assert.ok(Array.isArray(TYPERT.invocations))
assert.equal(TYPERT.invocations.length, 7)

const expectedMethods = [
  'listConnections',
  'getSelection',
  'selectConnection',
  'saveConnection',
  'deleteConnection',
  'testConnection',
  'listTables',
]
assert.deepEqual(TYPERT.invocations.map((entry) => entry.method), expectedMethods)

for (const invocation of TYPERT.invocations) {
  assert.equal(invocation.id, 'mysql/' + invocation.method)
  assert.equal(invocation.service, 'mysql')
  assert.equal(invocation.namespace, 'mysql')
  assert.deepEqual(invocation.invocation, { kind: 'direct' })
  assert.equal(invocation.parameters.length, 1)
  const parameter = invocation.parameters[0]
  assert.equal(parameter.name, 'args')
  assert.equal(parameter.wire, 'args')
  assert.equal(parameter.source, 'json')
  assert.equal(parameter.codec.mode, 'strict')
  assert.equal(typeof parameter.codec.create, 'function')
  assert.equal(parameter.codec.schema, undefined)
  assert.ok(parameter.codec.create().safeParse({}).success)
  assert.equal(invocation.result.mode, 'strict')
  assert.equal(typeof invocation.result.create, 'function')
  assert.equal(invocation.result.schema, undefined)
  assert.ok(invocation.result.create().safeParse({ ok: true }).success)
}

assert.equal(TYPERT.model.services.length, 1)
assert.equal(TYPERT.model.services[0].key, 'mysql')
assert.deepEqual(
  TYPERT.model.services[0].members.map((member) => member.name),
  expectedMethods,
)
assert.deepEqual(TYPERT.model.events, [])
assert.deepEqual(TYPERT.model.objects, [])

console.log('Typert manifest contract passed:', expectedMethods.length, 'methods')
