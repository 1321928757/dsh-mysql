# dsh-mysql

<p align="center">
  <b>MySQL connections and guarded database tools for DeepSeek Harness</b><br />
  Configure connections once, choose one or more per conversation, and let your agent route each call to a selected data source.
</p>

<p align="center">
  <a href="https://github.com/1321928757/dsh-mysql/releases"><img src="https://img.shields.io/github/v/release/1321928757/dsh-mysql?style=flat-square&color=4d6bfe&logo=github" alt="GitHub release" /></a>
  <a href="https://github.com/1321928757/dsh-mysql"><img src="https://img.shields.io/github/stars/1321928757/dsh-mysql?style=flat-square&color=fbbf24&logo=github" alt="GitHub stars" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT license" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-plugin-4d6bfe?style=flat-square" alt="DSH plugin" /></a>
</p>

English | [中文](README.zh-CN.md)

`dsh-mysql` is a profile bundle for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It adds a settings page for multiple MySQL connections, a per-session connection picker beside the composer, and four guarded tools that every agent preset can use. No preset edits are required.

> **Data boundary:** connection settings and passwords stay in your local DSH storage. Database schema and query results are sent to the LLM provider as ordinary tool output when the agent uses a database tool.

## At a glance

| Surface | What it provides |
| --- | --- |
| **Settings → MySQL 数据库** | Add, edit, delete, and test connections. Configure host, port, user, password, default database, table scope, row-write permission, and independent schema-change permission. |
| **Composer database button** | Select or deselect one or more data sources for the current session. Each click takes effect immediately; the composer pill shows the single name or a compact selected count. |
| **Agent tools + runtime context** | `mysql_tables`, `mysql_query`, `mysql_execute`, and `mysql_ddl`, plus a per-turn context snapshot listing this session's selected sources and capabilities. |

## Features

- **Multiple connections:** keep separate development, staging, or production data sources in one DSH installation.
- **Per-session multi-selection:** each conversation independently selects zero, one, or multiple sources. Select/deselect takes effect immediately; clearing the last selection leaves the session without database access until a source is selected again. A session with multiple configured sources starts empty; a sole configured source is auto-selected on first initialization. Selection is runtime-only and is not restored after a DSH restart.
- **One target per tool call:** when multiple sources are selected, the agent passes one selected `connectionId` to each tool call. A single selected source may be inferred. Queries are never broadcast or merged across sources.
- **Schema-first workflow:** `mysql_tables` exposes readable columns, types, nullability, keys, and comments before a query is written.
- **Read-only by default:** row-write access and schema-change access are independent per-connection settings, both disabled by default and each requiring its own risk acknowledgement.
- **Scoped schema changes:** `mysql_ddl` is separate from `mysql_execute`; changed/deleted targets are checked against the table allowlist, and explicit database qualifiers must match the connection's default database. Account/privilege and database-level statements remain refused.
- **Local-first configuration:** the browser receives a safe connection view with `hasPassword`, never the stored password.
- **No preset changes:** the tools are registered globally by the profile bundle and are available under every agent preset.

## Agent tools

| Tool | Accepted input and behavior |
| --- | --- |
| `mysql_tables` | Lists columns from one selected database through `information_schema`. Pass `connectionId` when multiple sources are selected; it may be omitted when exactly one is selected. Optional `table` filtering is case-insensitive. Results respect that source's table allowlist. |
| `mysql_query` | Executes one read-only `SELECT`, `SHOW`, `DESCRIBE`/`DESC`, or `EXPLAIN` statement against one selected source. Pass `connectionId` when multiple sources are selected; it may be omitted for a single selection. Optional `?` parameters are supported. It rejects multi-statement SQL, applies the target source's table-scope check, and returns up to 2,000 serialized rows with a `truncated` flag. |
| `mysql_execute` | Executes one `INSERT`, `UPDATE`, or `DELETE` statement against one selected source. Pass `connectionId` when multiple sources are selected; it may be omitted for a single selection. Requires that target's `allowWrite: true`; DDL, transaction-control statements, multi-statement SQL, and other statement types are rejected. |
| `mysql_ddl` | Executes one `CREATE`/`ALTER`/`DROP`/`RENAME`/`TRUNCATE` statement on tables, views, or indexes in one selected source. Pass `connectionId` when multiple sources are selected; it may be omitted for a single selection. It requires that target's independent `allowDdl: true` setting; changed/deleted targets obey its allowlist and all explicit database qualifiers must match its default database. Account/privilege statements and database-level DDL are always rejected. |

Schema changes require a separate opt-in and risk acknowledgement. Once enabled, you can ask the agent to create a table, for example:

```text
Inspect the current schema with mysql_tables, then create `agent_notes` in this connection's default database with an auto-increment id, title, and created_at timestamp. Show the CREATE TABLE SQL and execute it with mysql_ddl. Do not modify other tables.
```

If the connection has a non-empty table allowlist, add the new table to that list before asking the agent to read or write it with the existing tools.

A typical read-only request is:

```text
Use mysql_tables to inspect the available schema first, then use mysql_query to answer my question. Do not modify data.
```

### Multi-source routing example

When a conversation has more than one selected source, route every database call explicitly:

```text
Inspect both selected sources separately. For each source, call mysql_tables and then run:
SELECT @@port AS server_port, DATABASE() AS database_name, VERSION() AS server_version
Pass exactly one selected connectionId per call, label every result with its source, and do not merge or broadcast results.
```

The picker changes the session's selected set immediately. A session with multiple configured sources starts empty, a sole configured source is auto-selected on first initialization, and clearing the final source leaves the session explicitly empty until the user selects a source again. Selection is kept in memory and is not restored after a DSH restart.

## Requirements and compatibility

- A DSH installation with the **Web profile** and Node.js **20 or newer**.
- **DSH 0.2.0-rc.2 or newer, below 0.3.0.** Version 0.2.0 of this plugin migrates its Typert RPC manifest to the DSH 0.2 strict codec contract (`create()` factory) and no longer loads on DSH 0.1.x — use plugin 0.1.11 there.
- A MySQL-compatible server reachable through the configured TCP host and port.
- The connection form currently supports host, port, username, password, default database, table allowlist, and write permission. It does not expose SSL/TLS, Unix socket/named-pipe, or charset options.
- The `MAX_EXECUTION_TIME` optimizer hint is intended for MySQL versions that support it (MySQL 5.7.8+). MariaDB may handle this hint differently; `SHOW`, `DESCRIBE`, and `EXPLAIN` do not receive the hint.
- `mysql_tables` discovers tables in `DATABASE()`. Configure a default database if you want schema discovery; a connection without one can return an empty table list.

## Install, update, or remove

### Install from GitHub

```powershell
dsh plugin --profile web add github:1321928757/dsh-mysql#v0.3.2
```

### Install from npm

Use this after `dsh-mysql` is available in the npm registry:

```powershell
dsh plugin --profile web add dsh-mysql
```

### PowerShell installer

The repository also provides a Windows installer that checks for `dsh`, prepares a pinned pnpm helper under `%USERPROFILE%\.dsh-tmp`, and installs the selected GitHub tag into the `web` profile:

```powershell
irm https://raw.githubusercontent.com/1321928757/dsh-mysql/v0.3.0/scripts/install.ps1 | iex
```

After installation, restart `dsh web`. Then open **Settings → MySQL 数据库**, add and test one or more connections, and select them from the database button beside the composer.

Verify that the bundle is in the profile:

```powershell
dsh --profile web --dump-config | findstr dsh-mysql
```

Remove it with:

```powershell
dsh plugin --profile web remove dsh-mysql
```

<details>
<summary>Update or install from a local checkout</summary>

Update the installed package from GitHub:

```powershell
dsh plugin --profile web update dsh-mysql@latest
```

For local development, install the checkout or a packed tarball into a separate profile first:

```powershell
dsh plugin --profile demo add E:\path\to\dsh-mysql
dsh --profile demo --dump-config
```

</details>

## Quick start

1. Open **Settings → MySQL 数据库** and click **添加连接**. Fill in the host, port, username, password, and default database. Optionally add readable table names and enable write permission only when needed. Test the connection, then save it.
2. Open a conversation and click the database button on the left of the composer. Select or deselect one or more connections for that session; each click takes effect immediately and the picker stays open. If exactly one connection is configured, it is selected automatically when the session first initializes. With multiple selections, the agent chooses a target per tool call by `connectionId`; deselecting every source disables database tools for that session. Selection is not persisted across a DSH restart.
3. Ask a database question. The agent can inspect the schema with `mysql_tables`, read with `mysql_query`, use `mysql_execute` only for an explicitly writable connection, or use `mysql_ddl` only when the separate schema-change permission is enabled.

## Screenshots

The screenshots below were captured from the real DSH Web shell with the plugin loaded. Connection names and account names in the settings example are illustrative; passwords are not shown.

### Configure a connection

The settings page groups connection details, database scope, and permissions. Read-only is the default. The add-connection form keeps **保存连接** as the primary action, while **测试连接** remains a quieter secondary action.

![MySQL settings page](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/settings.png)

The form can be opened below the saved connection cards without leaving the settings page:

![Add MySQL connection form](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/settings-add-form.png)

### Select data sources for a session

The composer shows the database control even before a connection is selected. Its arrow points down while the picker is closed:

![Composer without a selected database connection](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-no-connection.png)

Click it to search and choose from the configured connections. The arrow points up while the list is expanded:

![Per-session database connection picker](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-picker.png)

After one connection is selected, its name, green status dot, and down arrow appear in the composer. With multiple selections, the compact composer pill shows the selected count instead of stacking connection-name chips. The picker uses the existing card layout and selected-row treatment; each change applies immediately. The selected sources and their individual capabilities are included in the conversation context shown to the agent:

![Selected connection in conversation context](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-context.png)

After the agent runs a read-only query, the tool result is displayed in the conversation:

![MySQL query result](https://raw.githubusercontent.com/1321928757/dsh-mysql/main/assets/conversation-query.png)

## Security and permissions

The plugin uses multiple guardrails, but it does not replace database permissions. Use a dedicated MySQL account with the least privileges possible; for read-only work, a `SELECT`-only account is recommended.

| Guardrail | What is enforced | Important boundary |
| --- | --- | --- |
| Statement type | `mysql_query` accepts read statements; `mysql_execute` accepts only `INSERT`/`UPDATE`/`DELETE`; `mysql_ddl` accepts the supported table/view/index schema changes. | The tool layer is not a general SQL console. |
| Row-write permission | `mysql_execute` requires the selected connection's `allowWrite` flag. | Per connection, default off, with a separate risk acknowledgement. |
| Schema-change permission | `mysql_ddl` requires the independent `allowDdl` flag; changed/deleted targets obey the allowlist, and explicit database qualifiers must match the default database. | Default off with a separate acknowledgement; account/privilege and database-level statements stay refused. |
| Multi-statement SQL | Multiple statements and transaction/control statements are rejected. | Schema changes are issued one statement per call. |
| Table allowlist | Checks table references detected after `FROM`, `JOIN`, `UPDATE`, and `INTO`. An empty list means no configured table restriction. | This is a lexical check, not a full SQL parser. Forms such as `DESCRIBE t` or `SHOW CREATE TABLE t` do not use those reference keywords; combine the allowlist with database-level grants. |
| Result size | The serialized tool response contains at most 2,000 rows and reports `truncated: true` when rows were omitted. | The query is fetched before the response is truncated; this is not a server-side scan or network limit. |
| Credential exposure | Passwords are stored in local `connections.json`; the browser receives only `hasPassword`. | Query results, schema, and tool arguments are still sent to the configured LLM provider. |

Passwords are stored as plain text in `$DSH_HOME/storages/dsh-mysql/connections.json`. Protect this file with operating-system permissions and do not commit or share it.

## Known limitations

- Each conversation session independently selects zero, one, or multiple database sources; changes do not affect other sessions. An empty selection disables database tools for that session. Selection state is kept in memory and reinitialized after a DSH restart.
- Each tool call targets exactly one source; when multiple sources are selected, `connectionId` is required. The plugin does not broadcast queries or merge results across databases.
- `mysql_tables` uses the connection's `DATABASE()` value, so schema discovery may be empty when no default database is configured. It does not browse arbitrary databases.
- The table allowlist is intentionally lightweight and checks common table-reference positions rather than parsing every MySQL grammar form.
- The 2,000-row limit applies to the returned JSON payload after the database response has been fetched.
- `mysql_execute` remains limited to row writes; it does not provide transaction management or a confirmation workflow. `mysql_ddl` has no per-call approval; it is guarded by a per-connection opt-in, allowlist, and default-database boundary. Use a narrowly scoped database account.
- Connection configuration is TCP-oriented and has no UI for SSL/TLS, Unix sockets/named pipes, or character-set selection.

## How it works

```text
Composer / Settings UI
        │  browser slot + Typert RPC (remote.mysql.*)
        ▼
Host mysql service
        │  per-session selection + lazy mysql2 pool
        ├── local JSON: $DSH_HOME/storages/dsh-mysql/connections.json
        └── systemPrompt.context: selected sources + per-source scopes/capabilities
```

- **Host bundle (`lib/index.js`)** registers the four model tools, manages lazy mysql2 pools, persists connections, tracks each session's selected source set, and provides the `mysql` service. Every resolved tool result includes the selected source name and `connectionId`; a resolved error is prefixed the same way without exposing credentials.
- **Typert manifest (`lib/typert.host.js`)** exposes connection CRUD, testing, selection, and table-list methods to the browser through `remote.mysql.*`.
- **Browser bundle (`lib/client.js`)** registers the `conversation.input.left` database control and the `settings.section` connection-management page. UI styles consume DSH `--dsw-*` theme tokens.
- The selected sources are added through `systemPrompt.context` as a dynamic tail section, so changing the selection set does not rewrite the stable cached system-prompt prefix. When multiple sources are selected, the context instructs the model to pass exactly one selected `connectionId` per tool call.

## Migrating from a preset-embedded MySQL tool

If a preset previously embedded `mysql_query` or `mysql_execute` through a local tool row:

1. Install this plugin into the profile.
2. Remove the old MySQL tool row and connection configuration from the preset's `agent.cordis.yml`; keep the business persona text.
3. Restart `dsh web`, then recreate the connection in **Settings → MySQL 数据库**. The tool names are unchanged, so prompts that mention them continue to work.

## FAQ and troubleshooting

<details>
<summary><b>The database button is missing</b></summary>

Restart the DSH Web process after installation or update. Then verify the profile composition with `dsh --profile web --dump-config | findstr dsh-mysql`. Make sure the plugin was installed into the same profile that you started.

</details>

<details>
<summary><b>“No MySQL connection is configured” or “this session has not selected a connection”</b></summary>

Open **Settings → MySQL 数据库** and save at least one connection. In the conversation, click the database button and select one or more sources for this session. A single saved source is auto-selected when the session first initializes; multiple configured sources start with none selected. If you have cleared all selections, select a source again to restore tool access.

</details>

<details>
<summary><b>Connection tests fail</b></summary>

Check the host and port, credentials, default database, server reachability, and the MySQL account's network permissions. The plugin connects from the DSH host, not from the browser. For startup diagnostics, inspect `$DSH_HOME/storages/dsh-mysql/boot.log`.

</details>

<details>
<summary><b>The table list is empty</b></summary>

Set a default database in the connection form. `mysql_tables` queries `information_schema.columns` for `table_schema = DATABASE()` and will not enumerate another schema automatically.

</details>

<details>
<summary><b>A write, DDL, multi-statement, or allowlist query was rejected</b></summary>

Use `mysql_query` for one read statement and `mysql_execute` only for one `INSERT`/`UPDATE`/`DELETE` when `allowWrite` is enabled. To change schema, enable the independent `allowDdl` permission with its acknowledgement and use `mysql_ddl`; it accepts only table/view/index CREATE, ALTER, DROP, RENAME, or TRUNCATE in the default database. Account/privilege statements, database-level DDL, transaction/control statements, multiple statements, and references outside the configured table scope remain blocked. The allowlist is a lexical check; database-level grants remain the final boundary.

</details>

<details>
<summary><b>Does the browser receive my password?</b></summary>

No. The browser receives a safe connection view containing `hasPassword`, not the password value. The local JSON file still stores the password in plain text, so protect that file.

</details>

## Development

Syntax-check each JavaScript file individually, run the shared-function and Typert contract tests, then pack a local artifact:

```powershell
Get-ChildItem lib\*.js | ForEach-Object { node --check $_.FullName }
node test\shared.test.mjs
node test\typert.test.mjs
node test\client-typert.test.mjs
pnpm pack
```

`node test\typert.test.mjs` validates the Host `./typert` manifest (seven strict `create()` codecs), and `node test\client-typert.test.mjs` materializes `lib/client.js` in a controlled environment to validate the Client remote descriptors and slot registrations against the DSH 0.2 rules.

The repository also ships isolated DSH 0.2 acceptance scripts. They never touch an existing `dsh web` instance: both use a throwaway `DSH_HOME`, a throwaway profile, and a one-shot port.

```powershell
pwsh -NoProfile -File scripts\dsh02-headless-smoke.ps1   # Host composition, Typert loader, tool registration
pwsh -NoProfile -File scripts\dsh02-web-smoke.ps1        # Client boot graph, slot rendering, real headless browser
pwsh -NoProfile -File scripts\dsh02-web-smoke.ps1 -RpcProbe   # ... plus a UI-driven pass over the MySQL RPC surface
```

`-RpcProbe` drives the rendered UI through a real browser to exercise `listConnections`, `saveConnection`, `testConnection`, `getSelection`, `selectConnection`, and `deleteConnection`, and checks that schema-change authorization defaults off, cannot be saved without its separate acknowledgement, is preserved when editing an authorized connection, that capability badges are distinguishable, the plaintext password never reaches the DOM, a saved connection survives a page reload, and the probe removes its own connection afterwards. `listTables` is never called by the client (it exists for the Host tools), so it is covered by the contract tests instead.

Install the packed artifact into a scratch profile and verify the real bundle:

```powershell
dsh plugin --profile demo add .\dsh-mysql-0.3.2.tgz
dsh --profile demo --dump-config
```

When releasing a new version, update the version in `package.json`, the `$Rev` value in `scripts/install.ps1`, the tagged install URLs in both README files, and `screenshots.json` if the screenshot set changes. **Package version and supported DSH range move together:** a Typert codec contract change is breaking for the older runtime, so bump the version and the `engines.dsh` range in the same release.

## License

[MIT](LICENSE). This project is not affiliated with DeepSeek. Installing the plugin runs third-party code on your machine; review the source before use.
