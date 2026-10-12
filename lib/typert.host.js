/**
 * dsh-mysql Typert 清单（Host 侧）。
 * 由 @deepseek-ai/dsh-typert-loader 解析 exports["./typert"] 后自动注册，
 * 并逐字段强校验（loader：dsh-typert-loader/lib/index.js validateTypertManifest）：
 *  - package 必须等于包名；
 *  - face 必须严格为 "host"；
 *  - codec 必须是 strict 且提供 DSH 0.2 要求的 create() factory；
 *    create() 由 dsh-api-gateway/lib/index.js 的 decode() 真正调用
 *    （codec.create().parse(value)），dsh-typert-loader 的 requireStrictCodec
 *    也要求 create 是函数，所以它必须返回带 .parse 的 zod v4 实例；
 *  - TYPERT.model 必须存在（services/events/objects 至少是空数组）——
 *    缺失会导致整个 typert-loader 行激活失败、所有插件的 RPC 路由不可用。
 * zod 因此放在 dependencies。
 */
import { z } from 'zod'

const args$codec = { mode: 'strict', typeSymbol: 'dsh-mysql#Args', create: () => z.record(z.string(), z.unknown()) }
const result$codec = { mode: 'strict', typeSymbol: 'dsh-mysql#Result', create: () => z.record(z.string(), z.unknown()) }

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

const member = (name, signature, summary, jsDoc) => ({
  kind: 'method',
  name,
  signature,
  summary,
  jsDoc,
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
  model: {
    services: [
      {
        description: 'dsh-mysql MySQL 连接服务 (ctx.mysql)：连接 CRUD、连通性测试、会话级选择与表列表。MySQL connection service (ctx.mysql): connection CRUD, connectivity testing, per-session selection and table listing.',
        summary: 'dsh-mysql MySQL 连接服务 (dsh-mysql MySQL connection service)。',
        tags: [],
        jsDoc: '/** dsh-mysql MySQL 连接服务 (ctx.mysql)。dsh-mysql MySQL connection service (ctx.mysql). */',
        key: 'mysql',
        exportName: 'MysqlService',
        members: [
          member(
            'listConnections',
            'listConnections(): Promise<object>',
            '列出全部连接的安全视图（不含密码）。List all connections without passwords.',
            '/**\n * 列出全部连接（安全视图：密码仅回传 hasPassword）。\n * @returns { ok:true, connections } 或 { ok:false, error }\n */',
          ),
          member(
            'getSelection',
            'getSelection(args: object): Promise<object>',
            '读取会话当前选中的数据源 ID 集合与全部连接列表。Read selected source IDs and all connections for a session.',
            '/**\n * @param args - { sessionId }\n * @returns { ok:true, connectionIds, connectionId (legacy scalar when exactly one selected), connections } 或 { ok:false, error }\n */',
          ),
          member(
            'selectConnection',
            'selectConnection(args: object): Promise<object>',
            '为当前会话原子替换已选数据源集合（会话级，支持空数组取消全部选择）。Replace a session source set.',
            '/**\n * @param args - { sessionId, connectionIds: string[] }；旧调用可传 connectionId 单值\n * @returns { ok:true, connectionIds, connectionId (legacy scalar when exactly one selected), names } 或 { ok:false, error }\n */',
          ),
          member(
            'saveConnection',
            'saveConnection(args: object): Promise<object>',
            '新增或更新连接（编辑时密码留空 = 保留原密码）。Create or update a connection.',
            '/**\n * @param args - { connection: { id?, name, host, port, user, password, database, tables, allowWrite, allowDdl, ddlRiskConfirmed } }\n * @returns { ok:true, connection } 或 { ok:false, error }\n */',
          ),
          member(
            'deleteConnection',
            'deleteConnection(args: object): Promise<object>',
            '删除连接并回收其连接池与会话选择。Delete a connection, its pool and selections.',
            '/**\n * @param args - { connectionId }\n * @returns { ok:true } 或 { ok:false, error }\n */',
          ),
          member(
            'testConnection',
            'testConnection(args: object): Promise<object>',
            '测试已保存连接或未保存的表单草稿连通性。Test a saved connection or a form draft.',
            '/**\n * @param args - { connectionId } 或 { connection: 草稿 }\n * @returns { ok:true, latencyMs } 或 { ok:false, error }\n */',
          ),
          member(
            'listTables',
            'listTables(args: object): Promise<object>',
            '读取连接可读表列表（information_schema，受白名单约束）。List readable tables for a connection.',
            '/**\n * @param args - { connectionId }\n * @returns { ok:true, tables } 或 { ok:false, error }\n */',
          ),
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
