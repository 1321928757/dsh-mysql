# dsh-mysql

English | [中文](README.zh-CN.md)

MySQL connector plugin for DeepSeek Harness (DSH): configure multiple MySQL connections in the settings page — each with a **table allowlist** and a **write-permission switch** (default off) — then switch the active connection per session from a database button beside the composer. All agent presets immediately get `mysql_query` / `mysql_tables` / `mysql_execute` tools; no preset edits required.

- **Settings page** (`设置 → MySQL 数据库`): add / edit / delete / test connections — host, port, user, password, default database, per-connection table allowlist and write permission.
- **Composer button** (database icon, left of the input bar): pick the connection for the current session; switch any time. The active connection and its readable tables are appended to each turn's runtime-context snapshot, so the model always knows which database to query — the cached system-prompt prefix is never rewritten.
- **Global tools** (available under every agent preset):

| Tool | Purpose |
| --- | --- |
| `mysql_query` | Read-only single `SELECT/SHOW/DESCRIBE/EXPLAIN` against the selected connection. Table allowlist enforced, multi-statement rejected, `MAX_EXECUTION_TIME` hint injected into `SELECT`, up to `2000` rows returned with a `truncated` flag. |
| `mysql_tables` | Inspect the schema (tables, columns, types, keys, comments) of readable tables via `information_schema`. |
| `mysql_execute` | `INSERT/UPDATE/DELETE` only, and only when the connection has **allowWrite** enabled (default off). DDL (`DROP/TRUNCATE/ALTER/...`) and multi-statement SQL are always rejected. |

- Per-session selection is resolved through the tool execution context (`exec.agent`), so the model always queries the database you picked in the composer.
- Connections persist in `$DSH_HOME/storages/dsh-mysql/connections.json`; passwords only exist on your machine and are never sent back to the browser (the UI only sees `hasPassword`).

## Install

```powershell
dsh plugin --profile web add github:1321928757/dsh-mysql#v0.1.10
```

Or from npm (once published):

```powershell
dsh plugin --profile web add dsh-mysql
```

PowerShell one-liner (bootstraps pnpm, pins versions, self-checks):

```powershell
irm https://raw.githubusercontent.com/1321928757/dsh-mysql/v0.1.10/scripts/install.ps1 | iex
```

Restart `dsh web` (make sure the old process really exited). After the restart, open `设置 → MySQL 数据库`, add a connection and press `测试连接`; the database button appears on the left of the composer. Verify:

```powershell
dsh --profile web --dump-config | findstr dsh-mysql
```

Uninstall: `dsh plugin --profile web remove dsh-mysql`

> Requirements: DeepSeek Harness (Node ≥ 20). The package ships prebuilt JavaScript (dependencies: `mysql2`, `zod`), so git installs need no build approval. Connections are stored locally; nothing leaves your machine.

## Quick start

1. Open **Settings → MySQL 数据库** → `+ 添加连接`; fill in host / port / user / password / default database, optionally list the readable tables (comma separated), decide whether to enable write permission. Press `测试连接`, then `保存`.
2. In any conversation, click the database button on the left of the composer and pick the connection (per-session; a single configured connection is auto-selected).
3. Ask the agent anything about the database — it calls `mysql_tables` for the schema and `mysql_query` to read data; when the connection has write permission enabled, `mysql_execute` can run `INSERT/UPDATE/DELETE`.

## Screenshots

Settings page — connection cards with allowlist chips and read-only / writable badges:

![Settings page](assets/settings.png)

Per-session connection picker opened from the composer database button:

![Connection picker](assets/picker.png)

The agent querying the database with `mysql_query` inside a conversation:

![Query result in a conversation](assets/query.png)

## Safety model

- Tool-layer enforcement, defense in depth. For production, also create a dedicated MySQL account with only the needed privileges (ideally `SELECT` only) for the agent.
- `mysql_query` accepts only a single `SELECT/SHOW/DESCRIBE/EXPLAIN`; `mysql_execute` accepts only a single `INSERT/UPDATE/DELETE` and requires the per-connection `allowWrite` flag.
- Table allowlist: when a connection lists tables, every statement is rejected if it references a table outside the list (an empty list means "all tables").
- `SELECT` statements get a `MAX_EXECUTION_TIME(15000)` optimizer hint injected; result sets are capped at 2000 rows; multi-statement SQL and DDL are always rejected.
- Passwords are stored in plain text in `$DSH_HOME/storages/dsh-mysql/connections.json` on your machine — protect the file with OS permissions.

## How it works

- **Host bundle** (`lib/index.js`): lazy mysql2 connection pools (rebuilt automatically on config change), a per-session selection map, three global tools, and a `systemPrompt.context` dynamic section appended after the conversation; a Typert service `mysql` (connection CRUD / test / selection / table list) is exposed to the browser via `remote.mysql.*` RPC.
- **Browser bundle** (`lib/client.js`): the `conversation.input.left` slot hosts the database button and picker; the `settings.section` slot (id `mysql`) hosts the connection configuration page. All UI consumes `--dsw-*` theme tokens and follows the global light/dark theme.

## Migrating from a preset-embedded mysql tool

If a preset previously embedded `mysql_query`/`mysql_execute` (e.g. a row loading a local `mysql-tool.mjs`):

1. Install this plugin into the profile.
2. Remove the mysql tool row (and connection config) from the preset's `agent.cordis.yml`; keep the business persona text.
3. Restart `dsh web`, then recreate the connection in **Settings → MySQL 数据库**. Tool names are identical, so preset prompts that mention `mysql_query` keep working unchanged.

## Development

```powershell
node --check lib\index.js lib\shared.js lib\typert.host.js lib\client.js
node test\shared.test.mjs
pnpm pack
dsh plugin --profile web add .\dsh-mysql-0.1.10.tgz
# restart dsh web, then verify in the browser
```

## License

[MIT](LICENSE). Not affiliated with DeepSeek. Installing runs third-party code on your machine — review the source first.