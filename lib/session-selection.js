/**
 * Session-local selected connection helpers. The map intentionally distinguishes
 * an absent session from a stored empty Set: the latter means the user explicitly
 * cleared selection and must not trigger the single-connection default again.
 */
export function resolveSelectedConnectionIds(connections, sessionId, selections) {
  if (typeof sessionId !== 'string' || !sessionId) return []
  if (!selections.has(sessionId)) {
    const configured = Array.isArray(connections) ? connections : []
    // A session first rendered before any connections exist is still uninitialized;
    // adding its first connection should retain the historic auto-select behavior.
    if (configured.length === 0) return []
    const initial = configured.length === 1 ? [configured[0].id] : []
    selections.set(sessionId, new Set(initial))
  }
  const configured = new Set((Array.isArray(connections) ? connections : []).map((connection) => connection.id))
  const selected = selections.get(sessionId)
  for (const id of selected) {
    if (!configured.has(id)) selected.delete(id)
  }
  return [...selected]
}

export function resolveSelectedConnection(connections, sessionId, requestedId, selections) {
  const selectedIds = resolveSelectedConnectionIds(connections, sessionId, selections)
  if (selectedIds.length === 0) {
    return { error: (Array.isArray(connections) ? connections.length : 0) === 0
      ? '尚未配置任何 MySQL 连接：请打开 设置 → MySQL 数据库 添加连接。'
      : '当前会话尚未选择数据库连接：请在输入栏点击「数据库连接」按钮选择一个连接后再试。' }
  }
  let connectionId = typeof requestedId === 'string' && requestedId ? requestedId : ''
  if (!connectionId && selectedIds.length === 1) connectionId = selectedIds[0]
  if (!connectionId) return { error: '当前会话选择了多个数据源；请在本次 MySQL 工具调用中明确指定 connectionId。' }
  if (!selectedIds.includes(connectionId)) return { error: '目标连接未在当前会话选中：' + connectionId + '。请先在输入栏「数据库连接」中选择该连接。' }
  const connection = (Array.isArray(connections) ? connections : []).find((candidate) => candidate.id === connectionId)
  if (!connection) return { error: '连接不存在：' + connectionId }
  return { connection }
}

export function replaceSelectedConnectionIds(connections, sessionId, ids, selections) {
  if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: '缺少会话标识' }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    return { ok: false, error: '连接选择必须是有效的连接 ID 数组' }
  }
  const configured = new Set((Array.isArray(connections) ? connections : []).map((connection) => connection.id))
  const next = [...new Set(ids)]
  const missing = next.find((id) => !configured.has(id))
  if (missing !== undefined) return { ok: false, error: '连接不存在：' + missing }
  selections.set(sessionId, new Set(next))
  return { ok: true, connectionIds: next }
}

export function removeSelectedConnectionId(connectionId, selections) {
  for (const selected of selections.values()) selected.delete(connectionId)
}
