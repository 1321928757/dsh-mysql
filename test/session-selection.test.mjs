import assert from 'node:assert/strict'
import {
  resolveSelectedConnectionIds,
  resolveSelectedConnection,
  replaceSelectedConnectionIds,
  removeSelectedConnectionId,
} from '../lib/session-selection.js'

const connections = [
  { id: 'dev', name: 'Development' },
  { id: 'prod', name: 'Production' },
  { id: 'other', name: 'Other' },
]
const sessions = new Map()

assert.deepEqual(resolveSelectedConnectionIds(connections.slice(0, 1), 'one', sessions), ['dev'])
assert.deepEqual(resolveSelectedConnectionIds([], 'late-single', sessions), [])
assert.deepEqual(resolveSelectedConnectionIds(connections.slice(0, 1), 'late-single', sessions), ['dev'])
assert.deepEqual(resolveSelectedConnectionIds(connections, 'multi', sessions), [])
assert.deepEqual(resolveSelectedConnectionIds(connections, 'one', sessions), ['dev'])

assert.deepEqual(replaceSelectedConnectionIds(connections, 'multi', ['dev', 'prod'], sessions), {
  ok: true,
  connectionIds: ['dev', 'prod'],
})
assert.deepEqual(resolveSelectedConnection(connections, 'multi', 'prod', sessions), { connection: connections[1] })
assert.match(resolveSelectedConnection(connections, 'multi', '', sessions).error, /明确指定 connectionId/)
assert.match(resolveSelectedConnection(connections, 'multi', 'other', sessions).error, /未在当前会话选中/)
assert.match(resolveSelectedConnection(connections, 'multi', 'missing', sessions).error, /未在当前会话选中/)

assert.deepEqual(replaceSelectedConnectionIds(connections, 'multi', [], sessions), { ok: true, connectionIds: [] })
assert.deepEqual(resolveSelectedConnectionIds(connections.slice(0, 1), 'multi', sessions), [])
assert.match(resolveSelectedConnection(connections.slice(0, 1), 'multi', '', sessions).error, /尚未选择/)

assert.deepEqual(replaceSelectedConnectionIds(connections, 'one', ['prod'], sessions), { ok: true, connectionIds: ['prod'] })
assert.deepEqual(resolveSelectedConnection(connections, 'one', '', sessions), { connection: connections[1] })
assert.deepEqual(resolveSelectedConnectionIds(connections, 'multi', sessions), [])
assert.deepEqual(resolveSelectedConnectionIds(connections, 'one', sessions), ['prod'])

const beforeInvalidReplacement = resolveSelectedConnectionIds(connections, 'one', sessions)
assert.equal(replaceSelectedConnectionIds(connections, 'one', ['dev', 'missing'], sessions).ok, false)
assert.deepEqual(resolveSelectedConnectionIds(connections, 'one', sessions), beforeInvalidReplacement)
assert.equal(replaceSelectedConnectionIds(connections, '', [], sessions).ok, false)

removeSelectedConnectionId('prod', sessions)
assert.deepEqual(resolveSelectedConnectionIds(connections, 'one', sessions), [])
assert.deepEqual(resolveSelectedConnectionIds(connections, 'multi', sessions), [])

console.log('Session selection helpers passed: initialization, isolation, routing, clear, validation, cleanup')
