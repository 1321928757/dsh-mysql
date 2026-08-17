# dsh-mysql

MySQL connector plugin for DeepSeek Harness. Configure multiple MySQL connections in the DSH settings page, switch the active connection per session from a button in the composer, and expose MySQL tools **globally to every agent preset** — no preset edits required.

[中文说明](./README.zh-CN.md)

## Features

- **Settings page** (`设置 → MySQL 数据库`): add / edit / delete / test connections — host, port, user, password, default database, per-connection **table allowlist** and **write permission** (default off).
- **Composer button** (🐬, left side of the input bar): pick the connection for the **current session only**; switch any time. The chosen connection and its readable tables are injected into the system prompt of every agent automatically.
- **Global tools** (available under every agent preset):

| Tool | Purpose |
| --- | --- |
| `mysql_query` | Read-only single-statement `SELECT/SHOW/DESCRIBE/EXPLAIN` against the selected connection. Table allowlist enforced, multi-statement rejected, `MAX_EXECUTION_TIME` hint injected into `SELECT`, max `2000` rows returned with a `truncated` flag. |
| `mysql_tables` | Inspect the schema (columns, types, keys, comments) of the readable tables via `information_schema`. |
| `mysql_execute` | `INSERT/UPDATE/DELETE` only, and only when the connection has **allowWrite** enabled (default off). DDL (`DROP/TRUNCATE/ALTER/...`) and multi-statement SQL are always rejected. |

- Per-session selection is resolved through the tool execution context (`exec.agent`), so the model always queries the database the user picked in the composer.
- All connection state persists locally in `$DSH_HOME/storages/dsh-mysql/connections.json`; passwords are stored in that file and never sent back to the browser UI (the UI only sees `hasPassword`).

## Install

```powershell
# From npm / GitHub (recommended once published)
dsh plugin --profile web add github:1321928757/dsh-mysql#v0.1.0

# Or from a local tarball
pnpm pack
dsh plugin --profile web add C:\path\to\dsh-mysql-0.1.0.tgz
```

Then **restart** `dsh web` (make sure the old process really exited). After the restart, open `设置 → MySQL 数据库`, add a connection and press `测试连接`.

## Quick start

1. Open **Settings → MySQL 数据库** → `+ 添加连接`; fill in host / port / user / password / default database, optionally list the readable tables (comma separated), decide whether to enable write permission. Press `测试连接`, then `保存`.
2. In any conversation, click the 🐬 button on the left of the composer and pick a connection (per-session).
3. Ask the agent anything about the database — it can call `mysql_tables` to inspect the schema and `mysql_query` to read data. When the connection has write permission enabled, `mysql_execute` can run `INSERT/UPDATE/DELETE`.

## Safety model

- Tool-layer enforcement, defense in depth. For production use, also create a dedicated MySQL account with only the needed privileges (ideally `SELECT` only) for the agent.
- `mysql_query` accepts only single `SELECT/SHOW/DESCRIBE/EXPLAIN`; `mysql_execute` accepts only single `INSERT/UPDATE/DELETE` and requires the per-connection `allowWrite` flag.
- Table allowlist: when a connection lists tables, every statement is checked and rejected if it references a table outside the list (an empty list means "all tables").
- `SELECT` statements get a `MAX_EXECUTION_TIME(15000)` optimizer hint injected; result sets are capped at 2000 rows.
- Passwords live in `$DSH_HOME/storages/dsh-mysql/connections.json` (plain text on the local machine). Use file permissions / a dedicated OS account to protect it.

## Migrating from a preset-embedded mysql tool

If a preset previously embedded `mysql_query`/`mysql_execute` (e.g. a row loading a local `mysql-tool.mjs`):

1. Install this plugin into the profile.
2. Remove the mysql tool row (and connection config) from the preset's `agent.cordis.yml`; keep the business persona text.
3. Restart `dsh web`, then recreate the connection in **Settings → MySQL 数据库**. The tool names are identical, so preset prompts that mention `mysql_query` keep working unchanged.

## Development

```powershell
node --check lib\index.js lib\shared.js lib\typert.host.js lib\client.js
node test\shared.test.mjs
pnpm pack
dsh plugin --profile web add .\dsh-mysql-0.1.0.tgz
# restart dsh web, then verify in the browser
```

## License

MIT
