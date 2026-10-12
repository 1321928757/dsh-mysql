# dsh-mysql

<p align="center">
  <b>DeepSeek Harness 的 MySQL 连接与安全数据库工具</b><br />
  一次配置连接，每个会话可选一个或多个数据源，让 Agent 按工具调用路由到已选数据库。
</p>

<p align="center">
  <a href="https://github.com/1321928757/dsh-mysql/releases"><img src="https://img.shields.io/github/v/release/1321928757/dsh-mysql?style=flat-square&color=4d6bfe&logo=github" alt="GitHub 版本" /></a>
  <a href="https://github.com/1321928757/dsh-mysql"><img src="https://img.shields.io/github/stars/1321928757/dsh-mysql?style=flat-square&color=fbbf24&logo=github" alt="GitHub Stars" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT 许可证" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-插件-4d6bfe?style=flat-square" alt="DSH 插件" /></a>
</p>

[English](README.md) | 中文

`dsh-mysql` 是一个适用于 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的 profile bundle。它为 DSH 增加 MySQL 多连接设置页、输入栏旁的会话级连接选择器，以及四个带安全限制的数据库工具。无需修改任何 Agent 预设。

> **数据边界：**连接配置与密码保存在本机 DSH 存储中；当 Agent 调用数据库工具时，数据库表结构与查询结果会像普通工具结果一样发送给已配置的 LLM 服务商。

## 功能概览

| 入口 | 提供能力 |
| --- | --- |
| **设置 → MySQL 数据库** | 新增、编辑、删除、测试连接；配置主机、端口、用户名、密码、默认数据库、表访问范围、行写权限与独立的结构变更权限。 |
| **输入栏数据库按钮** | 为当前会话选择或取消选择一个或多个数据源，每次点击立即生效；输入栏胶囊显示单个名称或简洁的已选数量。 |
| **Agent 工具 + 运行时上下文** | 提供 `mysql_tables`、`mysql_query`、`mysql_execute`、`mysql_ddl`，并在每轮对话中列出当前会话已选数据源及各自权限。 |

## 功能特性

- **多连接管理：**可在同一套 DSH 中保存开发、测试、生产等不同数据源。
- **会话级多选：**每个会话可独立选择零个、一个或多个数据源，不影响其他会话；勾选或取消立即生效。取消最后一个后该会话的数据库工具不可用，需重新选择才能恢复；会话选择保存在运行时内存中，DSH 重启后不会恢复。
- **单次调用单一目标：**多选时 Agent 每次工具调用必须传入一个已选连接的 `connectionId`；只选一条时可省略。查询不会广播到多个数据源，也不会合并结果。
- **先看结构再查询：**`mysql_tables` 会返回可读表的列名、类型、可空性、键与注释，帮助 Agent 先确认结构。
- **默认只读：**行写权限与结构变更权限是相互独立的连接开关，均默认关闭，且各自需要单独风险确认。
- **受限结构变更：**`mysql_ddl` 与 `mysql_execute` 分离；改动/删除目标受表白名单约束，显式库名前缀必须与连接默认库一致。账号/权限语句与库级语句仍会被拒绝。
- **本地优先配置：**浏览器只接收包含 `hasPassword` 的安全连接视图，不会接收已保存的密码。
- **无需修改预设：**工具由 profile bundle 全局注册，所有 Agent 预设都可以使用。

## Agent 工具

| 工具 | 输入与行为 |
| --- | --- |
| `mysql_tables` | 通过 `information_schema` 列出一个已选数据源默认数据库中的表结构。多选时传 `connectionId`，单选可省略；可选 `table` 参数进行不区分大小写过滤，结果遵守目标数据源白名单。 |
| `mysql_query` | 在一个已选数据源执行一条只读 `SELECT`、`SHOW`、`DESCRIBE`/`DESC` 或 `EXPLAIN`，支持 `?` 位置参数。多选时传 `connectionId`，单选可省略。拒绝多语句 SQL，按目标数据源校验表范围，最多返回 2000 行序列化结果并用 `truncated` 标记截断。 |
| `mysql_execute` | 对一个已选数据源执行 `INSERT`、`UPDATE` 或 `DELETE`，支持 `?` 位置参数。多选时传 `connectionId`，单选可省略；要求目标连接开启 `allowWrite: true`。DDL、事务控制语句、多语句 SQL 及其他语句类型都会被拒绝。 |
| `mysql_ddl` | 在一个已选数据源执行一条作用于表、视图或索引的 `CREATE`/`ALTER`/`DROP`/`RENAME`/`TRUNCATE`。多选时传 `connectionId`，单选可省略。要求目标连接独立开启 `allowDdl: true`；改动/删除目标遵守其表白名单，显式库名前缀必须与其默认库一致。账号/权限语句与库级 DDL 永久拒绝。 |

结构变更权限需要单独开启并确认风险。授权后，可以直接提出建表需求，例如：

```text
请先用 mysql_tables 确认当前结构，然后在当前连接的默认数据库中创建表 `agent_notes`，包含自增主键 id、标题 title 和创建时间 created_at。先给出 CREATE TABLE SQL，再通过 mysql_ddl 执行；不要修改其他表。
```

如果连接配置了非空表白名单，之后要通过现有工具读取或写入新表，需先把该表加入白名单。

一个典型的只读请求：

```text
请先使用 mysql_tables 查看可用表结构，再使用 mysql_query 回答我的问题。不要修改数据。
```

### 多数据源路由示例

当一个会话同时选中多个数据源时，每次数据库调用都要明确路由到其中一个：

```text
请分别检查当前已选的两个数据源。对每个数据源先调用 mysql_tables，然后执行：
SELECT @@port AS server_port, DATABASE() AS database_name, VERSION() AS server_version
每次调用只传入一个已选的 connectionId，给每条结果标注数据源，不要广播，也不要合并结果。
```

选择器的每次点击都会立即更新当前会话的已选集合。配置了多个数据源的新会话初始为空；只配置一条时，会在会话首次初始化时自动选中；取消最后一条后会保持明确的空选择，直到用户重新选择。选择状态只保存在运行时内存中，DSH 重启后不会恢复。

## 环境要求与兼容性

- 需要带 **Web profile** 的 DSH 安装，以及 Node.js **20 或更高版本**。
- **需要 DSH 0.2.0-rc.2 及以上、低于 0.3.0。** 本插件 0.2.0 版把 Typert RPC 清单迁移到 DSH 0.2 的 strict codec 契约（`create()` factory），不再能在 DSH 0.1.x 上加载 —— 那种环境请使用插件 0.1.11。
- 需要能通过配置的 TCP 主机与端口访问 MySQL 兼容数据库服务。
- 当前连接表单支持主机、端口、用户名、密码、默认数据库、表白名单与写权限；没有提供 SSL/TLS、Unix socket / 命名管道或字符集配置项。
- `MAX_EXECUTION_TIME` 优化器提示面向支持该特性的 MySQL 版本（MySQL 5.7.8+）。MariaDB 对该提示的处理可能不同；`SHOW`、`DESCRIBE`、`EXPLAIN` 不会注入该提示。
- `mysql_tables` 使用 `DATABASE()` 查询当前默认库中的表。如果未配置默认数据库，表结构列表可能为空。

## 安装、更新与卸载

### 从 GitHub 安装

```powershell
dsh plugin --profile web add github:1321928757/dsh-mysql#v0.3.1
```

### 从 npm 安装

在 `dsh-mysql` 已发布到 npm 后，可以使用：

```powershell
dsh plugin --profile web add dsh-mysql
```

### PowerShell 一键安装

仓库提供 Windows 安装脚本：它会检查 `dsh` 是否在 PATH 中，在 `%USERPROFILE%\.dsh-tmp` 下准备固定版本的 pnpm 辅助程序，并把指定 GitHub 版本安装到 `web` profile：

```powershell
irm https://raw.githubusercontent.com/1321928757/dsh-mysql/v0.3.0/scripts/install.ps1 | iex
```

安装完成后重启 `dsh web`，再打开 **设置 → MySQL 数据库** 添加并测试一条或多条连接，最后通过输入栏旁的数据库按钮选择数据源。

验证插件是否进入当前 profile：

```powershell
dsh --profile web --dump-config | findstr dsh-mysql
```

卸载：

```powershell
dsh plugin --profile web remove dsh-mysql
```

<details>
<summary>更新或从本地 checkout 安装</summary>

从 GitHub 更新已安装的插件：

```powershell
dsh plugin --profile web update dsh-mysql@latest
```

本地开发时，建议先安装到单独的测试 profile：

```powershell
dsh plugin --profile demo add E:\path\to\dsh-mysql
dsh --profile demo --dump-config
```

</details>

## 快速开始

1. 打开 **设置 → MySQL 数据库**，点击 **添加连接**。填写主机、端口、用户名、密码和默认数据库；可选填可读表名，并且只在确有需要时开启写权限。测试连接通过后保存。
2. 打开一个会话，点击输入栏左侧的数据库按钮，为该会话选择或取消选择一个或多个数据源；每次点击立即生效，面板保持打开。只有一条连接时会在会话首次初始化时自动选中。多选时 Agent 每次工具调用通过 `connectionId` 选择一个目标；取消全部后，该会话的数据库工具不可用。选择状态不会跨 DSH 重启保留。
3. 直接询问数据库问题。Agent 可以先用 `mysql_tables` 查看结构，再用 `mysql_query` 读取数据；显式开启行写权限后才可使用 `mysql_execute`，独立开启结构变更权限后才可使用 `mysql_ddl`。

## 截图

以下截图均来自已加载插件的真实 DSH Web 页面。设置页中的连接名称和账号名称为示例值，截图不会展示密码。

### 配置数据库连接

设置页将连接信息、数据库范围和权限分组展示，默认是只读模式。添加连接表单将 **保存连接** 作为主要操作，而 **测试连接** 使用更低调的次要按钮样式。

![MySQL 设置页](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/settings.png)

表单会在已保存连接卡片下方展开，不需要离开设置页：

![添加 MySQL 连接表单](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/settings-add-form.png)

### 为会话选择数据源

即使尚未选择连接，输入栏也会显示数据库控制按钮；列表收起时，文字右侧显示向下箭头：

![未选择数据库连接的对话输入栏](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-no-connection.png)

点击按钮后，可以搜索并从已配置的连接中选择；列表展开时箭头会切换为向上箭头：

![会话级数据库连接选择器](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-picker.png)

只选一条连接时，输入栏会显示连接名称、绿色状态点和向下箭头；多选时胶囊只显示简短数量，不堆叠连接名称标签。面板沿用现有卡片列表和选中行样式，每次点击立即生效。所有已选数据源及各自权限会出现在发送给 Agent 的会话上下文中：

![会话上下文中的已选连接](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-context.png)

Agent 执行只读查询后，工具结果会显示在对话中：

![MySQL 查询结果](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-query.png)

## 安全与权限

插件提供多层工具限制，但不能替代数据库本身的权限控制。建议为 Agent 创建权限最小化的专用 MySQL 账号；如果只需要读取，推荐使用只有 `SELECT` 权限的账号。

| 防护项 | 实际强制行为 | 重要边界 |
| --- | --- | --- |
| 语句类型 | `mysql_query` 只接受读取语句；`mysql_execute` 只接受 `INSERT`/`UPDATE`/`DELETE`；`mysql_ddl` 接受受限的表/视图/索引结构变更。 | 工具层不是通用 SQL 控制台。 |
| 行写权限 | `mysql_execute` 要求当前连接的 `allowWrite` 开启。 | 按连接配置，默认关闭，并需单独风险确认。 |
| 结构变更权限 | `mysql_ddl` 要求独立的 `allowDdl` 开启；改动/删除目标遵守表白名单，显式库名前缀必须等于默认库。 | 默认关闭并需单独确认；账号/权限及库级语句仍拒绝。 |
| 多语句 SQL | 多条 SQL 与事务/控制语句拒绝。 | 每次结构变更调用至多执行一条语句。 |
| 表白名单 | 校验 `FROM`、`JOIN`、`UPDATE`、`INTO` 后识别出的表引用。留空表示不配置表限制。 | 这是词法检查，不是完整 SQL 解析器；例如 `DESCRIBE t`、`SHOW CREATE TABLE t` 不使用这些引用关键字，应配合数据库账号权限作为最终边界。 |
| 返回结果大小 | 序列化工具结果最多包含 2000 行，省略行时返回 `truncated: true`。 | 查询会先完成获取，再截断响应；这不是服务端扫描或网络传输上限。 |
| 凭据暴露 | 密码保存在本机 `connections.json`，浏览器只收到 `hasPassword`。 | 表结构、查询结果和工具参数仍会发送给配置的 LLM 服务商。 |

密码以明文保存在 `$DSH_HOME/storages/dsh-mysql/connections.json`。请使用操作系统文件权限保护该文件，不要将它提交或分享。

## 已知限制

- 每个会话独立选择零个、一个或多个数据源；更改不会影响其他会话。空选择会禁用该会话的数据库工具；选择状态为运行时内存状态，DSH 重启后重新初始化。
- 每次工具调用仅针对一个数据源；多选时必须指定 `connectionId`，不会向多个数据库广播或合并结果。
- `mysql_tables` 使用连接的 `DATABASE()` 值，只发现默认数据库中的表；未配置默认库时列表可能为空，也不会自动浏览其他数据库。
- 表白名单是轻量级实现，只检查常见的表引用位置，不解析 MySQL 的全部语法形式。
- 2000 行限制作用于数据库结果已经获取之后的 JSON 返回内容。
- `mysql_execute` 仍仅处理行写入，不提供事务管理或二次确认。`mysql_ddl` 也没有逐次确认；它通过按连接授权、表白名单和默认库边界约束。请使用权限范围足够窄的数据库账号。
- 连接配置面向 TCP 连接，界面没有 SSL/TLS、Unix socket / 命名管道或字符集选择项。

## 工作原理

```text
输入栏 / 设置页
        │  浏览器槽位 + Typert RPC（remote.mysql.*）
        ▼
Host mysql 服务
        │  会话级选择 + 懒加载 mysql2 连接池
        ├── 本地 JSON：$DSH_HOME/storages/dsh-mysql/connections.json
        └── systemPrompt.context：已选数据源 + 各自范围与权限
```

- **Host bundle（`lib/index.js`）**：注册四个模型工具，管理懒加载的 mysql2 连接池，持久化连接配置，维护每个会话的已选数据源集合，并提供 `mysql` 服务。已解析目标的工具结果会带上数据源名称和 `connectionId`；已解析目标的错误也会使用相同前缀，但不会暴露凭据。
- **Typert 清单（`lib/typert.host.js`）**：通过 `remote.mysql.*` 向浏览器暴露连接增删改查、测试、选择和表列表方法。
- **浏览器 bundle（`lib/client.js`）**：注册 `conversation.input.left` 数据库控件与 `settings.section` 连接管理页面；界面样式使用 DSH 的 `--dsw-*` 主题令牌。
- 已选数据源通过 `systemPrompt.context` 作为动态尾部上下文追加，因此调整选择集合不会重写稳定的系统提示词前缀缓存。多选时，上下文会要求模型每次工具调用只传入一个已选数据源的 `connectionId`。

## 从预设内嵌 MySQL 工具迁移

如果某个预设之前通过本地工具行内嵌了 `mysql_query` 或 `mysql_execute`：

1. 把本插件安装到对应 profile。
2. 从预设的 `agent.cordis.yml` 中删除旧的 MySQL 工具行与连接配置，保留业务 persona 文案。
3. 重启 `dsh web`，然后在 **设置 → MySQL 数据库** 重新创建连接。工具名称保持不变，原来提示词中提到这些工具的内容无需修改。

## 常见问题与故障排查

<details>
<summary><b>输入栏没有出现数据库按钮</b></summary>

安装或更新后需要重启 DSH Web 进程。然后执行 `dsh --profile web --dump-config | findstr dsh-mysql` 检查 profile 合成结果，并确认插件安装到你实际启动的同一个 profile。

</details>

<details>
<summary><b>提示“尚未配置任何 MySQL 连接”或“当前会话尚未选择数据库连接”</b></summary>

打开 **设置 → MySQL 数据库**，至少保存一个连接；回到会话后点击数据库按钮并选择一个或多个数据源。只有一条连接时会在会话首次初始化时自动选中；多个连接初始为空。若取消了全部选择，再选中任意数据源即可恢复工具访问。

</details>

<details>
<summary><b>测试连接失败</b></summary>

检查主机、端口、账号密码、默认数据库、服务器连通性，以及 MySQL 账号的网络访问权限。连接由 DSH Host 发起，而不是浏览器发起。启动诊断日志位于 `$DSH_HOME/storages/dsh-mysql/boot.log`。

</details>

<details>
<summary><b>表结构列表为空</b></summary>

在连接表单中设置默认数据库。`mysql_tables` 查询的是 `table_schema = DATABASE()`，不会自动枚举其他数据库中的表。

</details>

<details>
<summary><b>写操作、DDL、多语句或表白名单查询被拒绝</b></summary>

读取请使用 `mysql_query`，且每次只执行一条读取语句；行写入只能使用已开启 `allowWrite` 的连接执行单条 `INSERT`/`UPDATE`/`DELETE`。要改结构，需单独开启并确认 `allowDdl`，再使用 `mysql_ddl`；它仅接受作用于默认库表/视图/索引的 CREATE、ALTER、DROP、RENAME、TRUNCATE。账号/权限语句、库级 DDL、事务/控制语句、多条 SQL 以及超出配置表范围的引用仍会被拦截。表白名单是词法检查，数据库账号权限仍是最终边界。

</details>

<details>
<summary><b>浏览器能看到我的密码吗？</b></summary>

不能。浏览器只会收到包含 `hasPassword` 的安全连接视图，不会收到密码值。但本地 JSON 文件中仍以明文保存密码，请保护该文件。

</details>

## 开发与验证

逐个检查 JavaScript 文件，运行共享函数测试与 Typert 契约测试，然后打包本地构件：

```powershell
Get-ChildItem lib\*.js | ForEach-Object { node --check $_.FullName }
node test\shared.test.mjs
node test\typert.test.mjs
node test\client-typert.test.mjs
pnpm pack
```

`node test\typert.test.mjs` 校验 Host 侧 `./typert` 清单（7 个 strict `create()` codec）；`node test\client-typert.test.mjs` 在受控环境里物化 `lib/client.js`，按 DSH 0.2 的规则校验客户端 remote 描述符与槽位注册。

仓库还提供隔离的 DSH 0.2 验收脚本。它们绝不触碰既有 `dsh web` 实例：两者都使用一次性 `DSH_HOME`、一次性 profile 与一次性端口。

```powershell
pwsh -NoProfile -File scripts\dsh02-headless-smoke.ps1   # Host 组合、Typert loader、四个工具注册
pwsh -NoProfile -File scripts\dsh02-web-smoke.ps1        # 客户端 boot 图、槽位渲染、真实无头浏览器
pwsh -NoProfile -File scripts\dsh02-web-smoke.ps1 -RpcProbe   # 额外用真实 UI 打通 MySQL 的 RPC 面
```

`-RpcProbe` 会用真实浏览器驱动渲染出的 UI，逐个走通 `listConnections`、`saveConnection`、`testConnection`、`getSelection`、`selectConnection`、`deleteConnection`，并校验结构变更默认关闭、未单独确认风险时不能保存、编辑已授权连接时权限会保留、能力徽标可区分、明文密码从不进入 DOM、保存的连接在刷新页面后仍在，且探针结束后会自行删除连接。`listTables` 客户端从不调用（它服务于 Host 工具），因此由契约测试覆盖。

将打包结果安装到独立测试 profile，验证真实 bundle：

```powershell
dsh plugin --profile demo add .\dsh-mysql-0.3.1.tgz
dsh --profile demo --dump-config
```

发布新版本时，请同步更新 `package.json` 的版本号、`scripts/install.ps1` 中的 `$Rev`、两份 README 中的 tag 安装地址，以及发生截图变化时的 `screenshots.json`。**包版本与支持的 DSH 范围必须一起变更**：Typert codec 契约变更对旧运行时是破坏性的，因此版本号与 `engines.dsh` 范围要在同一次发布中更新。

## License

[MIT](LICENSE)。本项目与 DeepSeek 无关联。安装插件会在本机运行第三方代码，请在使用前审阅源码。
