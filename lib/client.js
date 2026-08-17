/**
 * dsh-mysql 浏览器端 bundle（单文件，经 __ModuleLoader__ 加载）。
 *
 * 提供两个界面：
 *  - conversation.input.left：🐬 数据库按钮 + 连接选择面板（会话级切换）；
 *  - settings.section（id: mysql）：连接配置页（增删改、测试连接、表白名单、写权限）。
 *
 * 数据通道：
 *  - remote.mysql.*（Typert RPC，见 ./typert.host.js 与下方 CONTRIBUTION）
 *    → 连接 CRUD / 测试 / 会话选择 / 表列表；
 *  - 宿主槽位 props（sessionId）→ 会话级选择的 key。
 *
 * 红线：网关返回 {ok, value|error} 包装，host.call 里必须解包。
 * 样式全部使用 --dsw-* 主题变量，跟随全局亮/暗主题。
 */

window.__ModuleLoader__.load({
  id: 'dsh-mysql',
  factory: (require) => {
    const React = require('react')

    // ── 样式注入（防重复，随插件卸载由宿主 HMR 驱动清理）─────────────────
    const css = `
      .dsh-mysql-root {
        display:inline-flex; align-items:center; gap:4px; position:relative;
        min-width:0; flex:0 1 auto;
        --dm-accent: color-mix(in srgb, var(--dsw-alias-brand-primary) 62%, #0D9488 38%);
        --dm-accent-soft: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
        --dm-ok: var(--dsw-alias-state-success-primary, #22c55e);
        --dm-warn: var(--dsw-alias-state-error-primary, #ef4444);
      }
      @supports not (background: color-mix(in srgb, red 50%, blue 50%)) {
        .dsh-mysql-root {
          --dm-accent: var(--dsw-alias-brand-primary);
          --dm-accent-soft: transparent;
        }
      }
      .dsh-mysql-btn {
        display:inline-flex; align-items:center; gap:5px;
        height:26px; padding:0 8px; font-size:12px; line-height:1; font-weight:600;
        max-width:132px; min-width:0; box-sizing:border-box;
        color:#fff; border:none; border-radius:8px; cursor:pointer;
        background:linear-gradient(135deg, var(--dm-accent), var(--dsw-alias-brand-primary));
        transition:all .18s ease;
      }
      .dsh-mysql-btn-label {
        max-width:96px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .dsh-mysql-btn.is-on { box-shadow:inset 0 0 0 1px rgba(255,255,255,.35); }
      .dsh-mysql-btn:hover:not(:disabled) { transform:translateY(-1px); }
      .dsh-mysql-btn:active:not(:disabled) { transform:scale(.98); }
      .dsh-mysql-btn:disabled { opacity:.45; cursor:not-allowed; }
      .dsh-mysql-btn:focus-visible { outline:2px solid var(--dm-accent); outline-offset:2px; }
      .dsh-mysql-err {
        color:var(--dm-warn); font-size:11px; max-width:120px; min-width:0; flex:0 1 auto;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .dsh-mysql-panel {
        position:absolute; bottom:calc(100% + 8px); right:0; z-index:150;
        width:min(340px, calc(100vw - 32px)); box-sizing:border-box; padding:0;
        max-height:min(480px, calc(100vh - 120px)); overflow-y:auto;
        background:var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
        border:1px solid var(--dsw-alias-border-l1); border-radius:12px;
        box-shadow:var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.18));
        color:var(--dsw-alias-label-primary); font-size:12px; line-height:18px; cursor:default;
        animation:dm-slide-in .18s ease-out;
      }
      @keyframes dm-slide-in {
        from { opacity:0; transform:translateY(-8px) scale(.97); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }
      .dsh-mysql-panel-header {
        display:flex; align-items:center; justify-content:space-between; gap:8px;
        padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l1);
        position:sticky; top:0; background:inherit; border-radius:12px 12px 0 0;
      }
      .dsh-mysql-panel-title { font-weight:600; font-size:13px; margin:0; }
      .dsh-mysql-panel-sub { color:var(--dsw-alias-label-secondary); font-size:11px; margin:0; }
      .dsh-mysql-panel-close {
        width:22px; height:22px; padding:0; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:6px; background:transparent; flex:none;
        color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1; cursor:pointer;
      }
      .dsh-mysql-panel-close:hover { color:var(--dsw-alias-label-primary); background:var(--dm-accent-soft); }
      .dsh-mysql-panel-body { padding:8px; display:flex; flex-direction:column; gap:6px; }
      .dsh-mysql-empty { padding:10px 8px; color:var(--dsw-alias-label-secondary); }
      .dsh-mysql-item {
        display:flex; flex-direction:column; gap:3px; padding:8px 10px;
        border:1px solid var(--dsw-alias-border-l1); border-radius:8px; cursor:pointer;
        transition:all .15s ease; text-align:left; width:100%; box-sizing:border-box;
        background:transparent; color:var(--dsw-alias-label-primary);
        font:inherit;
      }
      .dsh-mysql-item:hover { border-color:var(--dm-accent); background:var(--dm-accent-soft); }
      .dsh-mysql-item.is-selected { border-color:var(--dm-accent); background:var(--dm-accent-soft); }
      .dsh-mysql-item:focus-visible { outline:2px solid var(--dm-accent); outline-offset:1px; }
      .dsh-mysql-item-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .dsh-mysql-item-name { font-weight:600; }
      .dsh-mysql-badge {
        font-size:10px; line-height:1; padding:2px 6px; border-radius:999px;
        border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary);
      }
      .dsh-mysql-badge.w { color:var(--dm-warn); border-color:currentColor; }
      .dsh-mysql-badge.sel { color:var(--dm-ok); border-color:currentColor; }
      .dsh-mysql-item-sub { color:var(--dsw-alias-label-secondary); font-size:11px; word-break:break-all; }
      .dsh-mysql-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; }
      .dsh-mysql-chip {
        font-size:10px; line-height:1; padding:3px 7px; border-radius:6px;
        background:var(--dsw-alias-bg-input, transparent); border:1px solid var(--dsw-alias-border-l1);
        color:var(--dsw-alias-label-secondary); font-family:ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      .dsh-mysql-chip.more { border-style:dashed; }

      /* ── 设置页 ── */
      .dsh-mysql-settings { display:flex; flex-direction:column; gap:14px; padding:4px 2px 20px; }
      .dsh-mysql-settings-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .dsh-mysql-settings-title { font-size:15px; font-weight:600; margin:0; }
      .dsh-mysql-settings-desc { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; margin:0; }
      .dsh-mysql-card {
        border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:12px 14px;
        display:flex; flex-direction:column; gap:8px; background:var(--dsw-alias-bg-layer-1, transparent);
      }
      .dsh-mysql-card-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .dsh-mysql-card-name { font-weight:600; font-size:13px; }
      .dsh-mysql-card-sub { color:var(--dsw-alias-label-secondary); font-size:11px; word-break:break-all; }
      .dsh-mysql-card-actions { display:flex; gap:8px; flex-wrap:wrap; }
      .dsh-mysql-form { display:flex; flex-direction:column; gap:10px; }
      .dsh-mysql-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      @media (max-width: 560px) { .dsh-mysql-form-grid { grid-template-columns:1fr; } }
      .dsh-mysql-field { display:flex; flex-direction:column; gap:4px; }
      .dsh-mysql-field.wide { grid-column:1 / -1; }
      .dsh-mysql-field-label { color:var(--dsw-alias-label-secondary); font-size:11px; }
      .dsh-mysql-input {
        box-sizing:border-box; width:100%; font-size:12px; line-height:18px;
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-bg-input, transparent);
        border:1px solid var(--dsw-alias-border-l1); border-radius:6px; padding:6px 8px;
        outline:none; font-family:inherit;
        transition:border-color .15s ease, box-shadow .15s ease;
      }
      .dsh-mysql-input:focus {
        border-color:var(--dm-accent, var(--dsw-alias-brand-primary));
        box-shadow:0 0 0 3px var(--dm-accent-soft, transparent);
      }
      .dsh-mysql-check { display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; }
      .dsh-mysql-switch { accent-color:var(--dm-accent, var(--dsw-alias-brand-primary)); width:34px; height:18px; cursor:pointer; }
      .dsh-mysql-hint { color:var(--dsw-alias-label-secondary); font-size:11px; line-height:16px; margin:0; }
      .dsh-mysql-btn2 {
        height:26px; padding:0 12px; font-size:12px; line-height:1; cursor:pointer;
        border-radius:6px; border:1px solid var(--dsw-alias-border-l1);
        background:transparent; color:var(--dsw-alias-label-primary);
        transition:all .15s ease;
      }
      .dsh-mysql-btn2:hover:not(:disabled) { border-color:var(--dm-accent, var(--dsw-alias-brand-primary)); color:var(--dm-accent, var(--dsw-alias-brand-primary)); }
      .dsh-mysql-btn2.primary {
        background:var(--dm-accent, var(--dsw-alias-brand-primary));
        border-color:var(--dm-accent, var(--dsw-alias-brand-primary)); color:#fff;
      }
      .dsh-mysql-btn2.danger { color:var(--dm-warn); }
      .dsh-mysql-btn2.danger:hover:not(:disabled) { border-color:var(--dm-warn); color:var(--dm-warn); }
      .dsh-mysql-btn2:disabled { opacity:.45; cursor:not-allowed; }
      .dsh-mysql-btn2:focus-visible { outline:2px solid var(--dm-accent, var(--dsw-alias-brand-primary)); outline-offset:2px; }
      .dsh-mysql-msg { font-size:12px; padding:6px 10px; border-radius:6px; }
      .dsh-mysql-msg.ok { color:var(--dm-ok); background:color-mix(in srgb, var(--dm-ok) 12%, transparent); }
      .dsh-mysql-msg.err { color:var(--dm-warn); background:color-mix(in srgb, var(--dm-warn) 12%, transparent); }
      .dsh-mysql-test-ok { color:var(--dm-ok); font-size:12px; }
      .dsh-mysql-test-err { color:var(--dm-warn); font-size:12px; word-break:break-all; }
      @media (prefers-reduced-motion: reduce) {
        .dsh-mysql-panel { animation:none; }
        .dsh-mysql-root *, .dsh-mysql-settings * { transition:none !important; }
      }
      @media (prefers-contrast: high) {
        .dsh-mysql-input, .dsh-mysql-btn2, .dsh-mysql-item { border-width:2px; }
      }
    `
    const cssTagId = 'dsh-mysql/client.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mysql'
      tag.dataset.pluginCss = cssTagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── 客户端 codec（与 ./typert.host.js 清单一一对应；宽松校验）──────────
    function looseParse(v) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('dsh-mysql: 服务端数据非法')
      return v
    }
    const descriptor = (method) => ({
      id: 'dsh-mysql#mysql/' + method,
      service: 'mysql',
      namespace: 'mysql',
      method,
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'args', wire: 'args', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mysql#Args', schema: { parse: looseParse } } },
      ],
      result: { mode: 'strict', typeSymbol: 'dsh-mysql#Result', schema: { parse: looseParse } },
    })

    const METHODS = [
      'listConnections', 'getSelection', 'selectConnection',
      'saveConnection', 'deleteConnection', 'testConnection', 'listTables',
    ]
    const CONTRIBUTION = {
      package: 'dsh-mysql',
      descriptors: METHODS.map(descriptor),
    }

    // 同页两个组件（输入栏按钮 / 设置页）之间的配置变更通知
    const CONFIG_EVENT = 'dsh-mysql:config-changed'

    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const remote = ctx.get('remote')
      if (remote === undefined || typeof remote.$mount !== 'function') return
      const unmount = await remote.$mount(CONTRIBUTION)
      ctx.effect(() => () => { unmount() }, 'dsh-mysql: remote contribution')
      const api = ctx.get('remote.mysql')
      if (api === undefined) return

      // 红线：网关返回 {ok, value|error} 包装，必须解包成业务结果
      const host = {
        call: async (method, payload) => {
          const result = await api[method](payload)
          if (result === null || typeof result !== 'object') throw new Error('MySQL 服务无响应')
          if (result.ok !== true) {
            const detail = result.error !== undefined && result.error !== null
              ? (typeof result.error === 'string' ? result.error : result.error.message)
              : ''
            throw new Error(detail || '调用失败')
          }
          return result.value
        },
      }

      function notifyConfigChanged() {
        try { window.dispatchEvent(new CustomEvent(CONFIG_EVENT)) } catch (err) { /* ignore */ }
      }

      async function fetchConnections() {
        try {
          const res = await host.call('listConnections', {})
          if (res && res.ok === true && Array.isArray(res.connections)) return res.connections
        } catch (err) { /* ignore */ }
        return null
      }

      // ── 输入栏连接选择器 ────────────────────────────────────────────────
      function MysqlControl(props) {
        const sessionId = props && props.sessionId
        const [open, setOpen] = React.useState(false)
        const [busy, setBusy] = React.useState(false)
        const [connections, setConnections] = React.useState([])
        const [connectionId, setConnectionId] = React.useState(null)
        const [error, setError] = React.useState(null)

        const load = React.useCallback(async () => {
          try {
            const res = await host.call('getSelection', { sessionId })
            if (res && res.ok === true) {
              setConnections(Array.isArray(res.connections) ? res.connections : [])
              setConnectionId(res.connectionId !== undefined && res.connectionId !== null ? res.connectionId : null)
              setError(null)
            } else {
              setError((res && res.error) || '读取连接失败')
            }
          } catch (err) {
            setError(String((err && err.message) || err))
          }
        }, [sessionId])

        React.useEffect(() => { load() }, [load])
        React.useEffect(() => {
          const onChange = () => { load() }
          window.addEventListener(CONFIG_EVENT, onChange)
          return () => window.removeEventListener(CONFIG_EVENT, onChange)
        }, [load])

        // 外部点击 / Esc 关闭
        React.useEffect(() => {
          if (!open) return
          const onMouseDown = (e) => {
            if (!(e.target instanceof Element)) return
            if (e.target.closest('.dsh-mysql-root') === null) setOpen(false)
          }
          const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false) }
          document.addEventListener('mousedown', onMouseDown)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [open])

        const current = connections.find((c) => c.id === connectionId) || null

        const choose = async (id) => {
          setBusy(true)
          try {
            const res = await host.call('selectConnection', { sessionId, connectionId: id })
            if (res && res.ok === true) {
              setConnectionId(res.connectionId || id)
              setError(null)
            } else {
              setError((res && res.error) || '切换失败')
            }
          } catch (err) {
            setError(String((err && err.message) || err))
          } finally {
            setBusy(false)
            setOpen(false)
          }
        }

        return React.createElement(
          'span',
          { className: 'dsh-mysql-root' },
          React.createElement(
            'button', {
              type: 'button',
              className: 'dsh-mysql-btn' + (current ? ' is-on' : ''),
              title: current
                ? '当前连接：' + current.name + '（' + current.host + ':' + current.port + '/' + current.database + '）点击切换'
                : '选择当前会话使用的 MySQL 连接',
              disabled: busy,
              onClick: () => setOpen((v) => !v),
              onMouseDown: (e) => e.preventDefault(),
            },
            '🐬 ',
            React.createElement('span', { className: 'dsh-mysql-btn-label' }, current ? current.name : '数据库'),
          ),
          error ? React.createElement('span', { className: 'dsh-mysql-err', title: error }, error) : null,
          open ? React.createElement(
            'div', { className: 'dsh-mysql-panel', onClick: (e) => e.stopPropagation() },
            React.createElement(
              'div', { className: 'dsh-mysql-panel-header' },
              React.createElement(
                'div', null,
                React.createElement('div', { className: 'dsh-mysql-panel-title' }, '选择数据库连接'),
                React.createElement('div', { className: 'dsh-mysql-panel-sub' }, '仅对当前会话生效，随时可切换'),
              ),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-panel-close',
                title: '关闭',
                'aria-label': '关闭',
                onClick: () => setOpen(false),
              }, '✕'),
            ),
            React.createElement(
              'div', { className: 'dsh-mysql-panel-body' },
              connections.length === 0
                ? React.createElement(
                    'div', { className: 'dsh-mysql-empty' },
                    '还没有配置 MySQL 连接。请打开 设置 → MySQL 数据库 添加连接（主机、账号、可读表）。',
                  )
                : connections.map((c) => {
                    const selected = c.id === connectionId
                    const chips = Array.isArray(c.tables) ? c.tables : []
                    const showMore = chips.length > 8
                    const shown = showMore ? chips.slice(0, 8) : chips
                    return React.createElement(
                      'button', {
                        type: 'button',
                        key: c.id,
                        className: 'dsh-mysql-item' + (selected ? ' is-selected' : ''),
                        onClick: () => choose(c.id),
                        title: selected ? '当前连接' : '点击切换到此连接',
                      },
                      React.createElement(
                        'div', { className: 'dsh-mysql-item-head' },
                        React.createElement('span', { className: 'dsh-mysql-item-name' }, c.name),
                        selected ? React.createElement('span', { className: 'dsh-mysql-badge sel' }, '✓ 当前') : null,
                        c.allowWrite ? React.createElement('span', { className: 'dsh-mysql-badge w' }, '可写') : null,
                      ),
                      React.createElement(
                        'div', { className: 'dsh-mysql-item-sub' },
                        c.host + ':' + c.port + ' / ' + (c.database || '未指定默认库'),
                      ),
                      chips.length > 0
                        ? React.createElement(
                            'div', { className: 'dsh-mysql-chips' },
                            shown.map((t) => React.createElement('span', { key: t, className: 'dsh-mysql-chip' }, t)),
                            showMore ? React.createElement('span', { className: 'dsh-mysql-chip more' }, '+' + (chips.length - 8) + ' 表') : null,
                          )
                        : React.createElement(
                            'div', { className: 'dsh-mysql-chips' },
                            React.createElement('span', { className: 'dsh-mysql-chip' }, '全部表（未限制）'),
                          ),
                    )
                  }),
            ),
          ) : null,
        )
      }

      // ── 设置页：连接配置 ────────────────────────────────────────────────
      function blankDraft() {
        return { id: '', name: '', host: '127.0.0.1', port: '3306', user: 'root', password: '', database: '', tables: '', allowWrite: false }
      }

      function buildConnectionPayload(draft) {
        const tables = String(draft.tables || '')
          .split(/[,，;；\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
        return {
          id: draft.id || undefined,
          name: String(draft.name || '').trim(),
          host: String(draft.host || '').trim(),
          port: Number(draft.port),
          user: String(draft.user || '').trim(),
          password: draft.password === undefined ? undefined : String(draft.password),
          database: String(draft.database || '').trim(),
          tables,
          allowWrite: draft.allowWrite === true,
        }
      }

      function MysqlSettingsPage() {
        const [connections, setConnections] = React.useState(null) // null = 加载中
        const [loadError, setLoadError] = React.useState(null)
        const [draft, setDraft] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [message, setMessage] = React.useState(null)
        const [confirmId, setConfirmId] = React.useState(null)
        const [testResult, setTestResult] = React.useState(null)

        const load = React.useCallback(async () => {
          const list = await fetchConnections()
          if (list !== null) {
            setConnections(list)
            setLoadError(null)
          } else {
            setLoadError('连接列表加载失败：MySQL RPC 服务不可用（请确认插件已正确安装并重启 dsh web）。')
          }
        }, [])

        React.useEffect(() => {
          load()
          const onChange = () => { load() }
          window.addEventListener(CONFIG_EVENT, onChange)
          return () => window.removeEventListener(CONFIG_EVENT, onChange)
        }, [load])

        const startAdd = () => { setDraft(blankDraft()); setTestResult(null); setMessage(null) }
        const startEdit = (c) => {
          setDraft({
            id: c.id,
            name: c.name,
            host: c.host,
            port: String(c.port),
            user: c.user,
            password: '',
            database: c.database,
            tables: (c.tables || []).join(', '),
            allowWrite: c.allowWrite === true,
          })
          setTestResult(null)
          setMessage(null)
        }

        const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }))
        const setChecked = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.checked === true }))

        const save = async () => {
          if (!draft) return
          if (!String(draft.name || '').trim()) { setMessage({ kind: 'err', text: '连接名称不能为空' }); return }
          setBusy(true)
          setMessage(null)
          try {
            const res = await host.call('saveConnection', { connection: buildConnectionPayload(draft) })
            if (res && res.ok === true) {
              setDraft(null)
              setMessage({ kind: 'ok', text: '已保存：' + res.connection.name })
              await load()
              notifyConfigChanged()
            } else {
              setMessage({ kind: 'err', text: (res && res.error) || '保存失败' })
            }
          } catch (err) {
            setMessage({ kind: 'err', text: String((err && err.message) || err) })
          } finally {
            setBusy(false)
          }
        }

        const test = async () => {
          if (!draft) return
          setBusy(true)
          setTestResult(null)
          try {
            const res = await host.call('testConnection', { connection: buildConnectionPayload(draft) })
            setTestResult(res && res.ok === true
              ? { ok: true, latencyMs: res.latencyMs }
              : { ok: false, error: (res && res.error) || '连接失败' })
          } catch (err) {
            setTestResult({ ok: false, error: String((err && err.message) || err) })
          } finally {
            setBusy(false)
          }
        }

        const remove = async (c) => {
          if (confirmId !== c.id) { setConfirmId(c.id); return }
          setBusy(true)
          setMessage(null)
          try {
            const res = await host.call('deleteConnection', { connectionId: c.id })
            if (res && res.ok === true) {
              setMessage({ kind: 'ok', text: '已删除：' + c.name })
              await load()
              notifyConfigChanged()
            } else {
              setMessage({ kind: 'err', text: (res && res.error) || '删除失败' })
            }
          } catch (err) {
            setMessage({ kind: 'err', text: String((err && err.message) || err) })
          } finally {
            setBusy(false)
            setConfirmId(null)
          }
        }

        const editingExisting = draft !== null && draft.id !== ''

        return React.createElement(
          'div', { className: 'dsh-mysql-settings' },
          React.createElement(
            'div', { className: 'dsh-mysql-settings-head' },
            React.createElement(
              'div', null,
              React.createElement('h2', { className: 'dsh-mysql-settings-title' }, '🐬 MySQL 数据库连接'),
              React.createElement('p', { className: 'dsh-mysql-settings-desc' },
                '配置后，所有 Agent 预设的会话都能通过输入栏按钮选择连接，并使用 mysql_query / mysql_tables / mysql_execute 工具。连接信息保存在本机（' + 'DSH_HOME/storages/dsh-mysql/connections.json' + '）。'),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-mysql-btn2 primary',
              disabled: busy || draft !== null,
              onClick: startAdd,
            }, '+ 添加连接'),
          ),
          message ? React.createElement('div', { className: 'dsh-mysql-msg ' + message.kind }, message.text) : null,
          connections === null
            ? React.createElement('div', { className: 'dsh-mysql-empty' }, loadError || '加载中…')
            : connections.length === 0 && draft === null
              ? React.createElement('div', { className: 'dsh-mysql-empty' }, '还没有配置任何连接。点击「添加连接」开始。')
              : null,
          connections.map((c) => React.createElement(
            'div', { key: c.id, className: 'dsh-mysql-card' },
            React.createElement(
              'div', { className: 'dsh-mysql-card-head' },
              React.createElement('span', { className: 'dsh-mysql-card-name' }, c.name),
              c.allowWrite ? React.createElement('span', { className: 'dsh-mysql-badge w' }, '可写') : React.createElement('span', { className: 'dsh-mysql-badge' }, '只读'),
              c.tables.length > 0 ? React.createElement('span', { className: 'dsh-mysql-badge' }, '白名单 ' + c.tables.length + ' 张表') : React.createElement('span', { className: 'dsh-mysql-badge' }, '全部表'),
            ),
            React.createElement('div', { className: 'dsh-mysql-card-sub' },
              c.host + ':' + c.port + ' / ' + (c.database || '未指定默认库') + ' · 用户 ' + c.user + (c.hasPassword ? ' · 已存密码' : ' · 无密码')),
            c.tables.length > 0 ? React.createElement(
              'div', { className: 'dsh-mysql-chips' },
              c.tables.slice(0, 24).map((t) => React.createElement('span', { key: t, className: 'dsh-mysql-chip' }, t)),
              c.tables.length > 24 ? React.createElement('span', { className: 'dsh-mysql-chip more' }, '+' + (c.tables.length - 24) + ' 表') : null,
            ) : null,
            React.createElement(
              'div', { className: 'dsh-mysql-card-actions' },
              React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2', disabled: busy, onClick: () => startEdit(c) }, '编辑'),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-btn2',
                disabled: busy,
                onClick: async () => {
                  setBusy(true)
                  try {
                    const res = await host.call('testConnection', { connectionId: c.id })
                    setMessage(res && res.ok === true
                      ? { kind: 'ok', text: '连接正常：' + c.name + '（' + res.latencyMs + ' ms）' }
                      : { kind: 'err', text: (res && res.error) || '连接失败' })
                  } catch (err) {
                    setMessage({ kind: 'err', text: String((err && err.message) || err) })
                  } finally {
                    setBusy(false)
                  }
                },
              }, '测试'),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-btn2 danger',
                disabled: busy,
                onClick: () => remove(c),
              }, confirmId === c.id ? '确认删除？' : '删除'),
            ),
          )),
          draft !== null ? React.createElement(
            'div', { className: 'dsh-mysql-card' },
            React.createElement(
              'div', { className: 'dsh-mysql-card-head' },
              React.createElement('span', { className: 'dsh-mysql-card-name' }, draft.id ? '编辑连接' : '新建连接'),
            ),
            React.createElement(
              'div', { className: 'dsh-mysql-form' },
              React.createElement(
                'div', { className: 'dsh-mysql-form-grid' },
                React.createElement(
                  'div', { className: 'dsh-mysql-field wide' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '连接名称 *'),
                  React.createElement('input', { className: 'dsh-mysql-input', value: draft.name, placeholder: '例如：演示库（QA）', onChange: set('name') }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '主机'),
                  React.createElement('input', { className: 'dsh-mysql-input', value: draft.host, placeholder: '192.168.9.181', onChange: set('host') }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '端口'),
                  React.createElement('input', { className: 'dsh-mysql-input', type: 'number', min: 1, max: 65535, value: draft.port, onChange: set('port') }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '用户名'),
                  React.createElement('input', { className: 'dsh-mysql-input', value: draft.user, placeholder: 'root', onChange: set('user') }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, editingExisting ? '密码（留空保持不变）' : '密码'),
                  React.createElement('input', { className: 'dsh-mysql-input', type: 'password', value: draft.password, autoComplete: 'new-password', onChange: set('password') }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '默认数据库'),
                  React.createElement('input', { className: 'dsh-mysql-input', value: draft.database, placeholder: 'yd_wechat_rpa（可留空）', onChange: set('database') }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '只读模式'),
                  React.createElement('input', { className: 'dsh-mysql-input', value: '强制只读（工具层拦截写语句）', readOnly: true }),
                ),
                React.createElement(
                  'div', { className: 'dsh-mysql-field wide' },
                  React.createElement('span', { className: 'dsh-mysql-field-label' }, '可读表白名单（逗号分隔；留空 = 不限制，可读全部表）'),
                  React.createElement('input', { className: 'dsh-mysql-input', value: draft.tables, placeholder: 'rpa_task, rpa_order_group_binding', onChange: set('tables') }),
                ),
                React.createElement(
                  'label', { className: 'dsh-mysql-check wide' },
                  React.createElement('input', { className: 'dsh-mysql-switch', type: 'checkbox', checked: draft.allowWrite, onChange: setChecked('allowWrite') }),
                  React.createElement('span', null, '允许写操作（启用 mysql_execute 工具：仅 INSERT/UPDATE/DELETE，仍受白名单约束）'),
                ),
              ),
              React.createElement('p', { className: 'dsh-mysql-hint' },
                '写操作默认关闭。即使开启，DROP/TRUNCATE/ALTER 等 DDL 与多语句执行也一律被拒绝。'),
              React.createElement(
                'div', { className: 'dsh-mysql-card-actions' },
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2 primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2', disabled: busy, onClick: test }, busy ? '测试中…' : '测试连接'),
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2', disabled: busy, onClick: () => { setDraft(null); setTestResult(null) } }, '取消'),
              ),
              testResult !== null
                ? testResult.ok
                  ? React.createElement('span', { className: 'dsh-mysql-test-ok' }, '✓ 连接成功（' + testResult.latencyMs + ' ms）')
                  : React.createElement('span', { className: 'dsh-mysql-test-err' }, '✗ ' + testResult.error)
                : null,
            ),
          ) : null,
        )
      }

      // ── 槽位注册 ─────────────────────────────────────────────────────────
      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'dsh-mysql', order: 90, label: 'MySQL 数据库' },
        (props) => React.createElement(MysqlControl, props),
      ))

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'mysql', order: 25, label: 'MySQL 数据库' },
        () => React.createElement(MysqlSettingsPage),
      ))
    }

    return { inject: ['remote'], apply }
  },
})
