# dsh-mysql

<p align="center">
  <b>DeepSeek Harness 的 MySQL 连接与安全数据库工具</b><br />
  一次配置连接，按会话选择数据源，让 Agent 查询你当前选中的数据库。
</p>

<p align="center">
  <a href="https://github.com/1321928757/dsh-mysql/releases"><img src="https://img.shields.io/github/v/release/1321928757/dsh-mysql?style=flat-square&color=4d6bfe&logo=github" alt="GitHub 版本" /></a>
  <a href="https://github.com/1321928757/dsh-mysql"><img src="https://img.shields.io/github/stars/1321928757/dsh-mysql?style=flat-square&color=fbbf24&logo=github" alt="GitHub Stars" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT 许可证" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-插件-4d6bfe?style=flat-square" alt="DSH 插件" /></a>
</p>

[English](README.md) | 中文

`dsh-mysql` 是一个适用于 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的 profile bundle。它为 DSH 增加 MySQL 多连接设置页、输入栏旁的会话级连接选择器，以及三个带安全限制的数据库工具。无需修改任何 Agent 预设。

> **数据边界：**连接配置与密码保存在本机 DSH 存储中；当 Agent 调用数据库工具时，数据库表结构与查询结果会像普通工具结果一样发送给已配置的 LLM 服务商。

## 功能概览

| 入口 | 提供能力 |
| --- | --- |
| **设置 → MySQL 数据库** | 新增、编辑、删除、测试连接；配置主机、端口、用户名、密码、默认数据库、表访问范围与写权限。 |
| **输入栏数据库按钮** | 为当前会话选择连接。选中的连接会显示在输入栏旁，并可随时切换。 |
| **Agent 工具 + 运行时上下文** | 提供 `mysql_tables`、`mysql_query`、`mysql_execute`，并在每轮对话中注入当前连接与可读表范围。 |

## 功能特性

- **多连接管理：**可在同一套 DSH 中保存开发、测试、生产等不同数据源。
- **会话级选择：**一个会话切换连接不会悄悄影响其他会话。
- **先看结构再查询：**`mysql_tables` 会返回可读表的列名、类型、可空性、键与注释，帮助 Agent 先确认结构。
- **默认只读：**写权限是每个连接独立的显式开关，默认关闭。
- **本地优先配置：**浏览器只接收包含 `hasPassword` 的安全连接视图，不会接收已保存的密码。
- **无需修改预设：**工具由 profile bundle 全局注册，所有 Agent 预设都可以使用。

## Agent 工具

| 工具 | 输入与行为 |
| --- | --- |
| `mysql_tables` | 通过 `information_schema` 列出当前连接默认数据库中的表结构，可选 `table` 参数进行不区分大小写的表名过滤，结果遵守表白名单。 |
| `mysql_query` | 执行一条只读 `SELECT`、`SHOW`、`DESCRIBE`/`DESC` 或 `EXPLAIN`，支持 `?` 位置参数。拒绝多语句 SQL，执行表范围校验，最多返回 2000 行序列化结果，并通过 `truncated` 标记是否截断。开头为 `SELECT` 的语句会自动加入 `MAX_EXECUTION_TIME(15000)` 提示。 |
| `mysql_execute` | 执行一条 `INSERT`、`UPDATE` 或 `DELETE`，支持 `?` 位置参数。要求选中连接开启 `allowWrite: true`；DDL、事务控制语句、多语句 SQL 及其他语句类型都会被拒绝。 |

一个典型的只读请求：

```text
请先使用 mysql_tables 查看可用表结构，再使用 mysql_query 回答我的问题。不要修改数据。
```

## 环境要求与兼容性

- 需要带 **Web profile** 的 DSH 安装，以及 Node.js **20 或更高版本**。
- 需要能通过配置的 TCP 主机与端口访问 MySQL 兼容数据库服务。
- 当前连接表单支持主机、端口、用户名、密码、默认数据库、表白名单与写权限；没有提供 SSL/TLS、Unix socket / 命名管道或字符集配置项。
- `MAX_EXECUTION_TIME` 优化器提示面向支持该特性的 MySQL 版本（MySQL 5.7.8+）。MariaDB 对该提示的处理可能不同；`SHOW`、`DESCRIBE`、`EXPLAIN` 不会注入该提示。
- `mysql_tables` 使用 `DATABASE()` 查询当前默认库中的表。如果未配置默认数据库，表结构列表可能为空。

## 安装、更新与卸载

### 从 GitHub 安装

```powershell
dsh plugin --profile web add github:1321928757/dsh-mysql#v0.1.10
```

### 从 npm 安装

在 `dsh-mysql` 已发布到 npm 后，可以使用：

```powershell
dsh plugin --profile web add dsh-mysql
```

### PowerShell 一键安装

仓库提供 Windows 安装脚本：它会检查 `dsh` 是否在 PATH 中，在 `%USERPROFILE%\.dsh-tmp` 下准备固定版本的 pnpm 辅助程序，并把指定 GitHub 版本安装到 `web` profile：

```powershell
irm https://raw.githubusercontent.com/1321928757/dsh-mysql/v0.1.10/scripts/install.ps1 | iex
```

安装完成后重启 `dsh web`，再打开 **设置 → MySQL 数据库** 添加并测试连接，最后通过输入栏旁的数据库按钮选择连接。

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
2. 打开一个会话，点击输入栏左侧的数据库按钮，为当前会话选择连接。只有一个连接时会自动选中；有多个连接时需要手动选择。
3. 直接询问数据库问题。Agent 可以先用 `mysql_tables` 查看结构，再用 `mysql_query` 读取数据；只有显式开启写权限的连接才能使用 `mysql_execute`。

## 截图

### 配置数据库连接

设置页将连接信息、数据库范围和权限分组展示，默认是只读模式。

![MySQL 设置页](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/settings.png)

### 为会话选择连接

即使尚未选择连接，输入栏也会显示数据库控制按钮：

![未选择数据库连接的对话输入栏](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-no-connection.png)

点击按钮后，可以搜索并从已配置的连接中选择：

![会话级数据库连接选择器](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-picker.png)

选择后，输入栏会显示连接名称与状态：

![已选择数据库连接的对话输入栏](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-connected.png)

### 查看运行时上下文

当前连接与可读表范围会作为动态上下文追加到本轮对话：

![动态注入 Prompt 的数据库上下文](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-context.png)

### 让 Agent 查看并查询数据库

Agent 可以先查看表结构，再查询当前选中的数据库：

![Agent 在会话中查询 MySQL](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-query.png)

## 安全与权限

插件提供多层工具限制，但不能替代数据库本身的权限控制。建议为 Agent 创建权限最小化的专用 MySQL 账号；如果只需要读取，推荐使用只有 `SELECT` 权限的账号。

| 防护项 | 实际强制行为 | 重要边界 |
| --- | --- | --- |
| 语句类型 | `mysql_query` 只接受读取语句；`mysql_execute` 只接受 `INSERT`/`UPDATE`/`DELETE`。 | 工具层不是通用 SQL 控制台。 |
| 写权限 | `mysql_execute` 要求当前连接的 `allowWrite` 开启。 | 开关按连接配置，默认关闭。 |
| DDL 与多语句 | DDL、事务/控制语句和多条 SQL 一律拒绝。 | 表结构变更与事务请使用正常的数据库管理工具。 |
| 表白名单 | 校验 `FROM`、`JOIN`、`UPDATE`、`INTO` 后识别出的表引用。留空表示不配置表限制。 | 这是词法检查，不是完整 SQL 解析器；例如 `DESCRIBE t`、`SHOW CREATE TABLE t` 不使用这些引用关键字，应配合数据库账号权限作为最终边界。 |
| 返回结果大小 | 序列化工具结果最多包含 2000 行，省略行时返回 `truncated: true`。 | 查询会先完成获取，再截断响应；这不是服务端扫描或网络传输上限。 |
| 凭据暴露 | 密码保存在本机 `connections.json`，浏览器只收到 `hasPassword`。 | 表结构、查询结果和工具参数仍会发送给配置的 LLM 服务商。 |

密码以明文保存在 `$DSH_HOME/storages/dsh-mysql/connections.json`。请使用操作系统文件权限保护该文件，不要将它提交或分享。

## 已知限制

- 每个会话只有一个当前数据库连接；切换连接不会改变其他会话。
- `mysql_tables` 使用连接的 `DATABASE()` 值，只发现默认数据库中的表；未配置默认库时列表可能为空，也不会自动浏览其他数据库。
- 表白名单是轻量级实现，只检查常见的表引用位置，不解析 MySQL 的全部语法形式。
- 2000 行限制作用于数据库结果已经获取之后的 JSON 返回内容。
- `mysql_execute` 不提供事务管理、DDL 或二次确认流程。只有在数据库账号范围足够窄时才应开启写权限。
- 连接配置面向 TCP 连接，界面没有 SSL/TLS、Unix socket / 命名管道或字符集选择项。

## 工作原理

```text
输入栏 / 设置页
        │  浏览器槽位 + Typert RPC（remote.mysql.*）
        ▼
Host mysql 服务
        │  会话级选择 + 懒加载 mysql2 连接池
        ├── 本地 JSON：$DSH_HOME/storages/dsh-mysql/connections.json
        └── systemPrompt.context：当前连接 + 可读表范围
```

- **Host bundle（`lib/index.js`）**：注册三个模型工具，管理懒加载的 mysql2 连接池，持久化连接配置，维护会话级选择，并提供 `mysql` 服务。
- **Typert 清单（`lib/typert.host.js`）**：通过 `remote.mysql.*` 向浏览器暴露连接增删改查、测试、选择和表列表方法。
- **浏览器 bundle（`lib/client.js`）**：注册 `conversation.input.left` 数据库控件与 `settings.section` 连接管理页面；界面样式使用 DSH 的 `--dsw-*` 主题令牌。
- 当前连接通过 `systemPrompt.context` 作为动态尾部上下文追加，因此切换连接不会重写稳定的系统提示词前缀缓存。

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

打开 **设置 → MySQL 数据库**，至少保存一个连接；回到会话后点击数据库按钮并选择连接。只有一个连接时会自动选中，多个连接时需要手动选择。

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

读取请使用 `mysql_query`，且每次只执行一条读取语句；写入只能使用已开启 `allowWrite` 的连接执行单条 `INSERT`/`UPDATE`/`DELETE`。表结构变更、事务/控制语句、多条 SQL 以及超出配置表范围的引用会被主动拦截。请注意，表白名单是词法检查，数据库账号权限仍是最终边界。

</details>

<details>
<summary><b>浏览器能看到我的密码吗？</b></summary>

不能。浏览器只会收到包含 `hasPassword` 的安全连接视图，不会收到密码值。但本地 JSON 文件中仍以明文保存密码，请保护该文件。

</details>

## 开发与验证

逐个检查 JavaScript 文件，运行共享函数测试，然后打包本地构件：

```powershell
Get-ChildItem lib\*.js | ForEach-Object { node --check $_.FullName }
node test\shared.test.mjs
pnpm pack
```

将打包结果安装到独立测试 profile，验证真实 bundle：

```powershell
dsh plugin --profile demo add .\dsh-mysql-0.1.10.tgz
dsh --profile demo --dump-config
```

发布新版本时，请同步更新 `package.json` 的版本号、`scripts/install.ps1` 中的 `$Rev`、两份 README 中的 tag 安装地址，以及发生截图变化时的 `screenshots.json`。

## License

[MIT](LICENSE)。本项目与 DeepSeek 无关联。安装插件会在本机运行第三方代码，请在使用前审阅源码。
