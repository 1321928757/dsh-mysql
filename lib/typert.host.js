/**
 * dsh-mysql Typert 清单（Host 侧）。
 * 由 @deepseek-ai/dsh-typert-loader 解析 exports["./typert"] 后自动注册，
 * 并逐字段强校验：
 *  - package 必须等于包名；
 *  - face 必须严格为 "host"；
 *  - codec schema 必须是 zod v4 实例（含 _zod + parse）。
 * zod 因此放在 dependencies。
 */
import { z } from 'zod'

const args$codec = { mode: 'strict', typeSymbol: 'dsh-mysql#Args', schema: z.record(z.string(), z.unknown()) }
const result$codec = { mode: 'strict', typeSymbol: 'dsh-mysql#Result', schema: z.record(z.string(), z.unknown()) }

const invocation = (method) => ({
  id: 'mysql/' + method,
  service: 'mysql',
  namespace: 'mysql',
  method,
  invocation: { kind: 'direct' },
  parameters: [
    { name: 'args', wire: 'args', source: 'json', codec: args$codec },
  ],
  result: result$codec,
})

export const TYPERT = {
  package: 'dsh-mysql', // 必须 == package.json 的 name
  face: 'host',         // 必须严格 "host"
  schemas: [],
  invocations: [
    invocation('listConnections'),
    invocation('getSelection'),
    invocation('selectConnection'),
    invocation('saveConnection'),
    invocation('deleteConnection'),
    invocation('testConnection'),
    invocation('listTables'),
  ],
}

export default TYPERT
