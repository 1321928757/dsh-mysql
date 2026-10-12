/**
 * dsh-mysql 浏览器端 bundle（单文件，经 __ModuleLoader__ 加载）。
 *
 * 提供两个界面：
 *  - conversation.input.left：数据库连接按钮（三态）+ 连接选择面板（会话级切换）；
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
      .dsh-mysql-root, .dsh-mysql-settings {
        /* 强调色完全跟随官方品牌蓝；绿色仅保留给连接状态（--dm-ok） */
        --dm-accent: var(--dsw-alias-brand-primary);
        --dm-accent-soft: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
        --dm-accent-border: color-mix(in srgb, var(--dm-accent) 40%, var(--dsw-alias-border-l1));
        --dm-ok: var(--dsw-alias-state-success-primary, #22c55e);
        --dm-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
        --dm-danger: var(--dsw-alias-state-error-primary, #ef4444);
        --dm-r-sm: 8px;   /* 输入框/按钮/标签 */
        --dm-r: 12px;     /* 面板/卡片/分组 */
        --dm-r-lg: 16px;  /* 大弹层（当前未用，保留刻度） */
        --dm-chips-bg: color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent);
        --dm-sel-bg: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent);
        --dm-on-bg: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
        --dm-soft-ok: color-mix(in srgb, var(--dm-ok) 12%, transparent);
        --dm-soft-warn: color-mix(in srgb, var(--dm-warn) 12%, transparent);
        --dm-soft-danger: color-mix(in srgb, var(--dm-danger) 12%, transparent);
      }
      @supports not (background: color-mix(in srgb, red 50%, blue 50%)) {
        .dsh-mysql-root, .dsh-mysql-settings {
          --dm-accent: var(--dsw-alias-brand-primary);
          --dm-accent-soft: transparent;
          --dm-accent-border: var(--dsw-alias-border-l1);
          --dm-chips-bg: transparent;
          --dm-sel-bg: transparent;
          --dm-on-bg: transparent;
          --dm-soft-ok: transparent;
          --dm-soft-warn: transparent;
          --dm-soft-danger: transparent;
        }
      }

      /* ── 输入栏按钮 ── */
      .dsh-mysql-root {
        display:inline-flex; align-items:center; gap:4px; position:relative;
        min-width:0; flex:0 1 auto;
        border-radius:24px;
        transition:background-color .18s ease, box-shadow .18s ease;
      }
      .dsh-mysql-root:hover:not(.is-disabled),
      .dsh-mysql-root.is-expanded:not(.is-disabled) {
        background:var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-mysql-btn {
        display:inline-flex; align-items:center; gap:6px;
        height:28px; padding:0 8px; font-size:13px; line-height:1; font-family:inherit;
        max-width:160px; min-width:112px; box-sizing:border-box;
        color:var(--dsw-alias-label-primary);
        border:0; border-radius:24px; cursor:pointer;
        background:transparent;
        transition:background-color .18s ease, color .18s ease, box-shadow .18s ease;
      }
      .dsh-mysql-btn-icon { flex:none; display:inline-flex; color:var(--dsw-alias-label-secondary); }
      .dsh-mysql-btn-label {
        flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; text-align:left;
      }
      .dsh-mysql-selection-count {
        flex:none; min-width:16px; height:16px; padding:0 4px; box-sizing:border-box;
        display:inline-flex; align-items:center; justify-content:center; border-radius:999px;
        background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-secondary);
        font-size:10px; font-weight:600; line-height:1;
      }
      .dsh-mysql-btn-caret {
        flex:none; display:inline-flex; color:var(--dsw-alias-label-secondary);
        transition:transform .15s ease;
      }
      .dsh-mysql-btn.is-expanded .dsh-mysql-btn-caret { transform:rotate(180deg); }
      .dsh-mysql-btn.is-on {
        /* 已连接：无边框 + 透明底，状态靠绿点/▾ 与图标表达 */
        background:transparent;
        border-color:transparent;
        color:var(--dsw-alias-label-primary);
        font-weight:600;
      }
      .dsh-mysql-btn.is-on .dsh-mysql-btn-icon,
      .dsh-mysql-btn.is-on .dsh-mysql-btn-caret { color:var(--dm-accent, var(--dsw-alias-brand-primary)); }
      .dsh-mysql-btn.is-off { color:var(--dsw-alias-label-secondary); font-weight:500; }
      .dsh-mysql-btn.is-warn {
        background:var(--dm-soft-danger);
        border-color:transparent;
        color:var(--dm-danger); font-weight:600;
      }
      .dsh-mysql-btn.is-warn .dsh-mysql-btn-icon { color:var(--dm-danger); }
      @supports not (background: color-mix(in srgb, red 50%, blue 50%)) {
        .dsh-mysql-btn.is-warn { background:var(--dsw-alias-bg-input, transparent); border-color:transparent; }
      }
      .dsh-mysql-btn .dsh-mysql-dot {
        flex:none; width:6px; height:6px; border-radius:50%;
        background:var(--dm-ok); box-shadow:0 0 0 3px var(--dm-soft-ok);
      }
      .dsh-mysql-btn:hover:not(:disabled),
      .dsh-mysql-btn.is-expanded:not(:disabled),
      .dsh-mysql-btn[aria-expanded="true"]:not(:disabled) {
        border-color:transparent;
        background:var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-mysql-btn:active:not(:disabled) { transform:none; }
      .dsh-mysql-btn:disabled { opacity:.45; cursor:not-allowed; }
      .dsh-mysql-btn:focus-visible {
        outline:0;
        box-shadow:0 0 0 2px var(--dsw-alias-border-l3, var(--dm-accent));
      }

      .dsh-mysql-spinner {
        flex:none; width:12px; height:12px; box-sizing:border-box;
        border:2px solid color-mix(in srgb, currentColor 35%, transparent);
        border-top-color:currentColor; border-radius:50%;
        animation:dm-spin .7s linear infinite;
      }
      @keyframes dm-spin { to { transform:rotate(360deg); } }

      /* 瞬态气泡（切换/管理引导反馈）——固定右下角，不遮挡输入内容 */
      .dsh-mysql-toast {
        position:fixed; right:16px; bottom:16px; z-index:3000;
        display:inline-flex; align-items:center; gap:6px;
        padding:8px 12px; font-size:12px; line-height:16px;
        max-width:min(320px, calc(100vw - 32px));
        border-radius:var(--dm-r-sm); pointer-events:none;
        background:var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
        border:1px solid var(--dsw-alias-border-l1);
        box-shadow:var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.18));
        color:var(--dsw-alias-label-primary);
        animation:dm-toast-in .2s ease-out;
      }
      .dsh-mysql-toast.ok { color:var(--dm-ok); }
      .dsh-mysql-toast.err { color:var(--dm-danger); }
      .dsh-mysql-toast.off { color:var(--dsw-alias-label-secondary); }
      .dsh-mysql-toast-icon { flex:none; display:inline-flex; }
      .dsh-mysql-toast-text { color:var(--dsw-alias-label-primary); white-space:normal; }
      @keyframes dm-toast-in {
        from { opacity:0; transform:translateX(14px); }
        to { opacity:1; transform:translateX(0); }
      }

      /* ── 连接选择面板 ── */
      .dsh-mysql-panel {
        position:absolute; bottom:calc(100% + 8px); right:0; z-index:150;
        width:min(400px, calc(100vw - 32px)); box-sizing:border-box; padding:0;
        max-height:min(520px, calc(100vh - 120px)); overflow-y:auto;
        background:var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2));
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r);
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
        padding:11px 14px; border-bottom:1px solid var(--dsw-alias-border-l1);
        position:sticky; top:0; background:inherit; border-radius:var(--dm-r) var(--dm-r) 0 0;
      }
      .dsh-mysql-panel-title { font-weight:600; font-size:13px; margin:0; }
      .dsh-mysql-panel-sub { color:var(--dsw-alias-label-secondary); font-size:11px; margin:0; }
      .dsh-mysql-panel-close {
        width:22px; height:22px; padding:0; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:6px; background:transparent; flex:none;
        color:var(--dsw-alias-label-secondary); cursor:pointer;
      }
      .dsh-mysql-panel-close:hover { color:var(--dsw-alias-label-primary); background:var(--dm-accent-soft); }

      .dsh-mysql-search { position:relative; margin:8px 10px 2px; }
      .dsh-mysql-search-icon {
        position:absolute; left:8px; top:50%; transform:translateY(-50%);
        display:inline-flex; color:var(--dsw-alias-label-secondary); pointer-events:none;
      }
      .dsh-mysql-search-input {
        box-sizing:border-box; width:100%; height:32px; padding:0 30px;
        font-size:12px; line-height:1; color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-bg-input, transparent);
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r-sm);
        outline:none; font-family:inherit;
        transition:border-color .15s ease, box-shadow .15s ease;
      }
      .dsh-mysql-search-input:focus {
        border-color:var(--dm-accent, var(--dsw-alias-brand-primary));
        box-shadow:0 0 0 3px var(--dm-accent-soft, transparent);
      }
      .dsh-mysql-search-input::placeholder { color:var(--dsw-alias-label-secondary); opacity:.8; }
      .dsh-mysql-search-close {
        position:absolute; right:6px; top:50%; transform:translateY(-50%);
        width:18px; height:18px; padding:0; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:5px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer;
      }
      .dsh-mysql-search-close:hover { color:var(--dsw-alias-label-primary); background:var(--dm-accent-soft); }

      .dsh-mysql-panel-body { padding:8px; display:flex; flex-direction:column; gap:6px; }
      .dsh-mysql-empty { padding:10px 8px; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:16px; }
      .dsh-mysql-empty .icon { display:inline-flex; vertical-align:-2px; margin-right:4px; }

      .dsh-mysql-item {
        position:relative; display:flex; flex-direction:row; gap:6px; padding:8px 10px 8px 12px;
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r);
        transition:border-color .15s ease, background-color .15s ease;
        width:100%; box-sizing:border-box;
        background:transparent; color:var(--dsw-alias-label-primary);
        font:inherit;
      }
      /* 选中/hover 统一为浅灰底，无多余强调样式 */
      .dsh-mysql-item:hover { border-color:var(--dsw-alias-border-l2, var(--dsw-alias-border-l1)); background:var(--dm-sel-bg); }
      .dsh-mysql-item.is-selected {
        border-color:var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
        background:var(--dm-sel-bg); box-shadow:none;
      }
      .dsh-mysql-item-main {
        display:flex; flex-direction:column; gap:3px; min-width:0; flex:1 1 auto;
        border:none; background:transparent; margin:0; padding:0; font:inherit; color:inherit;
        text-align:left; cursor:pointer; appearance:none;
      }
      .dsh-mysql-item-main:focus-visible { outline:2px solid var(--dm-accent); outline-offset:1px; border-radius:var(--dm-r-sm); }
      .dsh-mysql-item-head { display:flex; align-items:center; gap:6px; min-width:0; }
      .dsh-mysql-item-type { display:inline-flex; flex:none; color:var(--dsw-alias-label-secondary); }
      .dsh-mysql-item-name { font-weight:600; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1 1 auto; }
      .dsh-mysql-item-meta { display:flex; align-items:center; gap:8px; min-width:0; }
      .dsh-mysql-item-sub {
        flex:1 1 auto; min-width:0; color:var(--dsw-alias-label-secondary); font-size:11px;
        word-break:break-all; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      /* 状态行常驻：测试中/成功/失败切换时卡片高度不跳动 */
      .dsh-mysql-item-status {
        display:flex; align-items:center; gap:5px; min-height:17px;
        font-size:11px; line-height:15px; color:var(--dsw-alias-label-secondary);
      }
      .dsh-mysql-item-status .stext { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
      .dsh-mysql-item-status.ok { color:var(--dm-ok); }
      .dsh-mysql-item-status.err { color:var(--dm-danger); }
      .dsh-mysql-item-side {
        flex:none; display:flex; flex-direction:column; align-items:center;
        justify-content:flex-start; gap:4px; padding-top:2px;
      }

      .dsh-mysql-badge {
        font-size:10px; line-height:1; padding:2px 7px; border-radius:999px;
        border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary);
        white-space:nowrap; flex:none; display:inline-flex; align-items:center; gap:3px;
      }
      .dsh-mysql-badge.sel { color:var(--dm-ok); border-color:currentColor; background:var(--dm-soft-ok); }
      .dsh-mysql-badge.w { color:var(--dm-warn); border-color:currentColor; background:var(--dm-soft-warn); }
      /* 结构变更能力：用品牌色标识「另一种权限」，不占用错误红/写权限橙 */
      .dsh-mysql-badge.ddl { color:var(--dm-accent); border-color:var(--dm-accent-border); background:var(--dm-accent-soft); }
      .dsh-mysql-selection-check { width:16px; flex:none; display:inline-flex; align-items:center; justify-content:center; color:var(--dm-ok); }

      .dsh-mysql-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; align-items:center; }
      .dsh-mysql-chip {
        font-size:10px; line-height:1; padding:3px 7px; border-radius:6px;
        background:var(--dm-chips-bg);
        color:var(--dsw-alias-label-secondary); font-family:ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      .dsh-mysql-chip.w { color:var(--dm-warn); background:var(--dm-soft-warn); }
      .dsh-mysql-chip.ddl { color:var(--dm-accent); background:var(--dm-accent-soft); }
      .dsh-mysql-chip.more { border:1px dashed var(--dsw-alias-border-l1); background:transparent; }

      .dsh-mysql-icobtn {
        width:28px; height:28px; padding:0; flex:none; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:var(--dm-r-sm); background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer;
        transition:all .15s ease;
      }
      .dsh-mysql-icobtn:hover:not(:disabled) { color:var(--dm-accent, var(--dsw-alias-brand-primary)); background:var(--dm-accent-soft); }
      .dsh-mysql-icobtn:focus-visible { outline:2px solid var(--dm-accent); outline-offset:1px; }
      .dsh-mysql-icobtn:disabled { opacity:.45; cursor:not-allowed; }

      .dsh-mysql-panel-footer {
        display:flex; align-items:center; gap:8px;
        padding:8px 14px; border-top:1px solid var(--dsw-alias-border-l1);
        position:sticky; bottom:0; background:inherit; border-radius:0 0 var(--dm-r) var(--dm-r);
      }
      .dsh-mysql-link {
        display:inline-flex; align-items:center; gap:5px; padding:4px 2px;
        border:none; background:transparent; cursor:pointer; font:inherit;
        font-size:12px; font-weight:500; color:var(--dm-accent, var(--dsw-alias-brand-primary));
      }
      .dsh-mysql-link:hover { text-decoration:underline; }
      .dsh-mysql-link:focus-visible { outline:2px solid var(--dm-accent); outline-offset:2px; }

      /* ── 设置页 ── */
      .dsh-mysql-settings { display:flex; flex-direction:column; gap:12px; padding:4px 2px 20px; }
      /* 表单打开时预留页脚高度，最后一个字段可完整滚过粘性操作栏 */
      .dsh-mysql-settings.has-form { padding-bottom:88px; }
      .dsh-mysql-settings-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .dsh-mysql-settings-title { font-size:15px; font-weight:600; margin:0; }
      .dsh-mysql-settings-desc { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; margin:2px 0 0; }
      .dsh-mysql-settings-note { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size:11px; line-height:16px; margin:2px 0 0; opacity:.85; }
      .dsh-mysql-card {
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r); padding:16px;
        display:flex; flex-direction:column; gap:8px; background:var(--dsw-alias-bg-layer-1, transparent);
      }
      .dsh-mysql-card-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0; }
      .dsh-mysql-card-name { font-weight:600; font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dsh-mysql-card-fill { flex:1 1 auto; }
      .dsh-mysql-card-status { font-size:11px; font-weight:500; white-space:nowrap; }
      .dsh-mysql-card-status.ok { color:var(--dm-ok); }
      .dsh-mysql-card-status.err { color:var(--dm-danger); }
      .dsh-mysql-card-sub { color:var(--dsw-alias-label-secondary); font-size:11px; word-break:break-all; }
      .dsh-mysql-card-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px; }
      .dsh-mysql-card-actions .grow { flex:1 1 auto; }

      .dsh-mysql-btn2 {
        height:28px; padding:0 12px; font-size:12px; line-height:1; cursor:pointer;
        border-radius:var(--dm-r-sm); border:1px solid var(--dsw-alias-border-l1);
        background:transparent; color:var(--dsw-alias-label-primary); display:inline-flex; align-items:center; gap:5px;
        transition:background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .15s ease;
      }
      .dsh-mysql-btn2:hover:not(:disabled) { border-color:var(--dm-accent, var(--dsw-alias-brand-primary)); color:var(--dm-accent, var(--dsw-alias-brand-primary)); }
      .dsh-mysql-btn2.primary {
        background:var(--dm-accent, var(--dsw-alias-brand-primary));
        border-color:var(--dm-accent, var(--dsw-alias-brand-primary)); color:#fff;
      }
      .dsh-mysql-btn2.primary:hover:not(:disabled) { color:#fff; opacity:.92; }
      /* 页面级主要动作：保持可发现，但避免深色填充表面。 */
      .dsh-mysql-btn2.outline {
        border-color:var(--dsw-alias-border-l1);
        border-radius:14px;
        color:var(--dsw-alias-label-primary);
        background:transparent;
        font-weight:500;
      }
      .dsh-mysql-btn2.outline:hover:not(:disabled) {
        border-color:var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-mysql-btn2.outline:active:not(:disabled) {
        background:var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover));
      }
      /* 卡片级辅助动作：默认无边框，悬浮时仅显示轻量交互表面。 */
      .dsh-mysql-btn2.quiet {
        border-color:transparent;
        border-radius:14px;
        color:var(--dsw-alias-label-secondary);
        background:transparent;
        font-weight:400;
      }
      .dsh-mysql-btn2.quiet:hover:not(:disabled) {
        border-color:transparent;
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-mysql-btn2.quiet:active:not(:disabled) {
        background:var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover));
      }
      .dsh-mysql-btn2:disabled { opacity:.45; cursor:not-allowed; }
      .dsh-mysql-btn2:active:not(:disabled) { transform:scale(.98); }
      .dsh-mysql-btn2:focus-visible {
        outline:2px solid var(--dsw-alias-border-l3, var(--dm-accent, var(--dsw-alias-brand-primary)));
        outline-offset:2px;
      }

      .dsh-mysql-btn-text {
        height:26px; padding:0 8px; font-size:12px; line-height:1; cursor:pointer;
        border:none; background:transparent; color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
        border-radius:var(--dm-r-sm); transition:all .15s ease;
      }
      .dsh-mysql-btn-text:hover { color:var(--dsw-alias-label-secondary); }
      .dsh-mysql-btn-text.danger { color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
      .dsh-mysql-btn-text.danger:hover { color:var(--dm-danger); background:color-mix(in srgb, var(--dm-danger) 10%, transparent); }
      .dsh-mysql-btn-text.danger.confirm {
        color:var(--dm-danger); border:1px solid var(--dm-danger);
        background:color-mix(in srgb, var(--dm-danger) 10%, transparent); font-weight:600;
      }

      /* ── 表单 ── */
      .dsh-mysql-form { display:flex; flex-direction:column; gap:10px; }
      .dsh-mysql-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      @media (max-width: 560px) { .dsh-mysql-form-grid { grid-template-columns:1fr; } }
      .dsh-mysql-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
      .dsh-mysql-field.wide { grid-column:1 / -1; }
      .dsh-mysql-field-label { color:var(--dsw-alias-label-secondary); font-size:11px; }
      .dsh-mysql-input {
        box-sizing:border-box; width:100%; height:32px; font-size:12px; line-height:18px;
        color:var(--dsw-alias-label-primary);
        background:var(--dsw-alias-bg-input, transparent);
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r-sm); padding:0 9px;
        outline:none; font-family:inherit;
        transition:border-color .15s ease, box-shadow .15s ease;
      }
      .dsh-mysql-input:focus {
        border-color:var(--dm-accent, var(--dsw-alias-brand-primary));
        box-shadow:0 0 0 3px var(--dm-accent-soft, transparent);
      }
      .dsh-mysql-input::placeholder { color:var(--dsw-alias-label-secondary); opacity:.8; }
      .dsh-mysql-input[readonly] { color:var(--dsw-alias-label-secondary); background:transparent; }

      .dsh-mysql-passwrap { position:relative; }
      .dsh-mysql-passwrap .dsh-mysql-input { padding-right:32px; }
      .dsh-mysql-eye {
        position:absolute; right:5px; top:50%; transform:translateY(-50%);
        width:24px; height:24px; padding:0; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer;
      }
      .dsh-mysql-eye:hover { color:var(--dsw-alias-label-primary); background:var(--dm-accent-soft); }

      .dsh-mysql-group {
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r);
        padding:12px; display:flex; flex-direction:column; gap:10px;
      }
      .dsh-mysql-group-title {
        display:inline-flex; align-items:center; gap:6px;
        font-size:12px; font-weight:600; color:var(--dsw-alias-label-primary);
      }
      .dsh-mysql-group-title .icon { display:inline-flex; color:var(--dsw-alias-label-secondary); }
      /* 可折叠分组（权限与安全） */
      .dsh-mysql-group-head {
        display:flex; align-items:center; justify-content:space-between; gap:8px;
        width:100%; padding:2px 0; border:none; background:transparent;
        cursor:pointer; font:inherit; color:inherit; text-align:left;
      }
      .dsh-mysql-group-head:focus-visible { outline:2px solid var(--dm-accent); outline-offset:2px; border-radius:6px; }
      .dsh-mysql-group-summary { font-size:11px; font-weight:500; color:var(--dsw-alias-label-secondary); margin-right:8px; }
      .dsh-mysql-group-caret {
        display:inline-flex; vertical-align:-2px; color:var(--dsw-alias-label-secondary);
        transition:transform .18s ease;
      }
      .dsh-mysql-group-head.is-open .dsh-mysql-group-caret { transform:rotate(180deg); }
      .dsh-mysql-group-right { display:inline-flex; align-items:center; }
      .dsh-mysql-group-body { display:flex; flex-direction:column; gap:10px; }

      .dsh-mysql-radio {
        display:flex; align-items:flex-start; gap:8px; padding:8px 10px;
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r-sm); cursor:pointer;
        transition:all .15s ease; background:transparent;
      }
      .dsh-mysql-radio:hover { border-color:var(--dm-accent); }
      .dsh-mysql-radio.is-active { border-color:var(--dm-accent); background:var(--dm-accent-soft); }
      .dsh-mysql-radio-native { margin:2px 0 0; accent-color:var(--dm-accent, var(--dsw-alias-brand-primary)); flex:none; cursor:pointer; }
      .dsh-mysql-radio-body { display:flex; flex-direction:column; gap:2px; min-width:0; }
      .dsh-mysql-radio-title { font-size:12px; font-weight:500; }
      .dsh-mysql-radio-sub { font-size:11px; color:var(--dsw-alias-label-secondary); line-height:15px; }

      .dsh-mysql-risk {
        display:flex; align-items:flex-start; gap:8px; padding:10px 12px;
        border:1px solid color-mix(in srgb, var(--dm-warn) 45%, var(--dsw-alias-border-l1));
        background:var(--dm-soft-warn); border-radius:var(--dm-r-sm);
      }
      @supports not (background: color-mix(in srgb, red 50%, blue 50%)) {
        .dsh-mysql-risk { border:1px solid var(--dm-warn); background:transparent; }
      }
      .dsh-mysql-risk-icon { display:inline-flex; flex:none; color:var(--dm-warn); margin-top:1px; }
      .dsh-mysql-risk-text { display:flex; flex-direction:column; gap:3px; font-size:11px; line-height:16px; color:var(--dsw-alias-label-primary); }
      .dsh-mysql-risk-strong { color:var(--dm-warn); font-weight:600; }

      .dsh-mysql-check { display:flex; align-items:flex-start; gap:8px; padding:2px 0; cursor:pointer; }
      .dsh-mysql-check input { accent-color:var(--dm-accent, var(--dsw-alias-brand-primary)); width:14px; height:14px; margin:1px 0 0; flex:none; cursor:pointer; }
      .dsh-mysql-check span { font-size:12px; line-height:18px; }

      .dsh-mysql-hint { color:var(--dsw-alias-label-secondary); font-size:11px; line-height:16px; margin:0; }

      .dsh-mysql-tags {
        display:flex; flex-wrap:wrap; gap:6px; align-items:center;
        padding:4px 6px; min-height:32px; box-sizing:border-box;
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dm-r-sm);
        background:var(--dsw-alias-bg-input, transparent);
        transition:border-color .15s ease, box-shadow .15s ease;
      }
      .dsh-mysql-tags:focus-within {
        border-color:var(--dm-accent, var(--dsw-alias-brand-primary));
        box-shadow:0 0 0 3px var(--dm-accent-soft, transparent);
      }
      .dsh-mysql-tag {
        display:inline-flex; align-items:center; gap:4px;
        font-size:11px; line-height:1; padding:4px 6px 4px 8px; border-radius:6px;
        background:var(--dm-accent-soft); color:var(--dm-accent, var(--dsw-alias-brand-primary));
        font-family:ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      @supports not (background: color-mix(in srgb, red 50%, blue 50%)) {
        .dsh-mysql-tag { background:var(--dsw-alias-bg-input, transparent); border:1px solid var(--dsw-alias-border-l1); }
      }
      .dsh-mysql-tag-x {
        width:14px; height:14px; padding:0; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:4px; background:transparent; color:inherit; opacity:.7; cursor:pointer;
      }
      .dsh-mysql-tag-x:hover { opacity:1; background:color-mix(in srgb, currentColor 15%, transparent); }
      .dsh-mysql-taginput {
        flex:1 1 120px; min-width:100px; height:22px;
        border:none; outline:none; background:transparent;
        font-size:12px; color:var(--dsw-alias-label-primary); font-family:inherit;
      }
      .dsh-mysql-taginput::placeholder { color:var(--dsw-alias-label-secondary); opacity:.8; }

      .dsh-mysql-fielderr { color:var(--dm-danger); font-size:11px; line-height:15px; }
      .dsh-mysql-form-footer {
        position:sticky; bottom:0; z-index:5;
        display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        margin:2px -2px -2px; padding:10px 12px;
        background:var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, transparent));
        border-top:1px solid var(--dsw-alias-border-l1);
        border-radius:0 0 var(--dm-r) var(--dm-r);
      }

      .dsh-mysql-msg {
        font-size:12px; line-height:17px; padding:6px 30px 6px 10px;
        border-radius:var(--dm-r-sm); position:relative;
      }
      .dsh-mysql-msg.ok { color:var(--dm-ok); background:var(--dm-soft-ok); }
      .dsh-mysql-msg.err { color:var(--dm-danger); background:color-mix(in srgb, var(--dm-danger) 12%, transparent); }
      .dsh-mysql-msg-x {
        position:absolute; right:4px; top:50%; transform:translateY(-50%);
        width:20px; height:20px; padding:0; display:inline-flex; align-items:center; justify-content:center;
        border:none; border-radius:5px; background:transparent; color:inherit; opacity:.7; cursor:pointer;
      }
      .dsh-mysql-msg-x:hover { opacity:1; background:color-mix(in srgb, currentColor 14%, transparent); }
      .dsh-mysql-test-ok { color:var(--dm-ok); font-size:12px; display:inline-flex; align-items:center; gap:5px; }
      .dsh-mysql-test-err {
        color:var(--dm-danger); font-size:12px; word-break:break-all;
        display:inline-flex; align-items:center; gap:5px;
      }

      @media (prefers-reduced-motion: reduce) {
        .dsh-mysql-panel, .dsh-mysql-toast { animation:none; }
        .dsh-mysql-spinner { animation:none; }
        .dsh-mysql-root *, .dsh-mysql-settings * { transition:none !important; }
      }
      @media (prefers-contrast: high) {
        .dsh-mysql-input, .dsh-mysql-btn2, .dsh-mysql-item, .dsh-mysql-tags { border-width:2px; }
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

    // ── 客户端 codec（与 ./typert.host.js 清单一一对应）────────────────────
    // DSH 0.2 的 strict codec 契约（校验点：dsh-typert-registry/lib/client.js
    // validateCodec，由 remote.$mount → typert.remotes.register 触发）要求
    // 每个 codec 提供 create() factory：只带 schema 字段会被判为
    // "strict codec has no create() factory"，使整个 Client fiber 激活失败，
    // 在宿主表现为「web boot: 1 entry did not activate / dsh-mysql: failed」。
    // Client 侧只校验该 factory、不调用它（结果解码走可选的 codec.decode），
    // 因此这里返回一个宽松的 JSON 对象 schema，并同时保留 parse/safeParse。
    // 注意：Client bundle 不能 require('zod')——模块表只提供 shell seed 词与
    // boot 图模块，未命中的 specifier 会直接抛错，所以这里手写 schema。
    function looseParse(v) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('dsh-mysql: 服务端数据非法')
      return v
    }
    const jsonObjectSchema = () => ({
      parse: looseParse,
      safeParse: (value) => {
        try { return { success: true, data: looseParse(value) } }
        catch (error) { return { success: false, error } }
      },
    })
    const codec = (typeSymbol) => ({ mode: 'strict', typeSymbol, create: jsonObjectSchema })
    const descriptor = (method) => ({
      id: 'dsh-mysql#mysql/' + method,
      service: 'mysql',
      namespace: 'mysql',
      method,
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'args', wire: 'args', source: 'json', codec: codec('dsh-mysql#Args') },
      ],
      result: codec('dsh-mysql#Result'),
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

    // ── 内联 SVG 图标（统一 stroke=currentColor, 1.75px，不用 emoji）────────
    const svg = (size, className, children) => React.createElement('svg', {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.75,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: className || '',
      'aria-hidden': true,
    }, children)

    const IconDb = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('ellipse', { key: 'e', cx: 12, cy: 5, rx: 9, ry: 3 }),
      React.createElement('path', { key: 'p1', d: 'M3 5v14a9 3 0 0 0 18 0V5' }),
      React.createElement('path', { key: 'p2', d: 'M3 12a9 3 0 0 0 18 0' }),
    ])
    const IconServer = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('rect', { key: 'r1', x: 2, y: 2, width: 20, height: 8, rx: 2 }),
      React.createElement('rect', { key: 'r2', x: 2, y: 14, width: 20, height: 8, rx: 2 }),
      React.createElement('path', { key: 'd1', d: 'M6 6h.01' }),
      React.createElement('path', { key: 'd2', d: 'M6 18h.01' }),
    ])
    const IconSearch = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('circle', { key: 'c', cx: 11, cy: 11, r: 8 }),
      React.createElement('path', { key: 'p', d: 'm21 21-4.35-4.35' }),
    ])
    const IconPlus = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M5 12h14' }),
      React.createElement('path', { key: 'p2', d: 'M12 5v14' }),
    ])
    const IconCheck = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p', d: 'M20 6 9 17l-5-5' }),
    ])
    const IconClose = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M18 6 6 18' }),
      React.createElement('path', { key: 'p2', d: 'm6 6 12 12' }),
    ])
    const IconEye = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p', d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' }),
      React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3 }),
    ])
    const IconEyeOff = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }),
      React.createElement('path', { key: 'p2', d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }),
      React.createElement('path', { key: 'p3', d: 'M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }),
      React.createElement('path', { key: 'p4', d: 'm2 2 20 20' }),
    ])
    const IconEdit = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p', d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }),
    ])
    const IconTrash = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M3 6h18' }),
      React.createElement('path', { key: 'p2', d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }),
      React.createElement('path', { key: 'p3', d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }),
    ])
    const IconRefresh = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
      React.createElement('path', { key: 'p2', d: 'M21 3v5h-5' }),
      React.createElement('path', { key: 'p3', d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
      React.createElement('path', { key: 'p4', d: 'M8 16H3v5' }),
    ])
    const IconAlert = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }),
      React.createElement('path', { key: 'p2', d: 'M12 9v4' }),
      React.createElement('path', { key: 'p3', d: 'M12 17h.01' }),
    ])
    const IconArrowRight = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M5 12h14' }),
      React.createElement('path', { key: 'p2', d: 'm12 5 7 7-7 7' }),
    ])
    const IconChevronDown = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'm6 9 6 6 6-6' }),
    ])
    const IconSliders = (p) => svg((p && p.size) || 14, p && p.className, [
      React.createElement('path', { key: 'p1', d: 'M4 21v-7' }),
      React.createElement('path', { key: 'p2', d: 'M4 10V3' }),
      React.createElement('path', { key: 'p3', d: 'M12 21v-9' }),
      React.createElement('path', { key: 'p4', d: 'M12 8V3' }),
      React.createElement('path', { key: 'p5', d: 'M20 21v-5' }),
      React.createElement('path', { key: 'p6', d: 'M20 12V3' }),
      React.createElement('path', { key: 'p7', d: 'M1 14h6' }),
      React.createElement('path', { key: 'p8', d: 'M9 8h6' }),
      React.createElement('path', { key: 'p9', d: 'M17 16h6' }),
    ])

    // 相对时间：「刚刚 / X 秒前 / X 分钟前」
    function rel(at) {
      const diff = Date.now() - Number(at)
      if (!Number.isFinite(diff) || diff < 0) return '刚刚'
      if (diff < 60000) return Math.max(1, Math.floor(diff / 1000)) + ' 秒前'
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
      return Math.floor(diff / 3600000) + ' 小时前'
    }

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
        const sessionId = props && (props.sessionId || props.conversationId || props.conversation?.id || props.agentId || props.agent?.id || props.context?.sessionId || props.context?.agent?.id || props.context?.conversationId || props.id || 'dsh-mysql-default-session')
        const [open, setOpen] = React.useState(false)
        const [busy, setBusy] = React.useState(false)
        const [connections, setConnections] = React.useState([])
        const [connectionIds, setConnectionIds] = React.useState([])
        const [error, setError] = React.useState(null)
        const selectionQueueRef = React.useRef(Promise.resolve())
        const desiredSelectionRef = React.useRef([])
        const confirmedSelectionRef = React.useRef([])
        const selectionRevisionRef = React.useRef(0)
        const [query, setQuery] = React.useState('')
        const [toast, setToast] = React.useState(null)
        const [testState, setTestState] = React.useState({})
        const sessionKey = typeof sessionId === 'string' && sessionId ? sessionId : 'dsh-mysql-default-session'
        const toastRef = React.useRef(null)

        const flash = React.useCallback((text, kind) => {
          if (toastRef.current) { try { toastRef.current() } catch (err) {} toastRef.current = null }
          setToast({ text: text, kind: kind || 'ok' })
          toastRef.current = ctx.timeout(() => { setToast(null); toastRef.current = null }, 2200)
        }, [])
        React.useEffect(() => () => {
          if (toastRef.current) { try { toastRef.current() } catch (err) {} }
        }, [])

        const load = React.useCallback(async () => {
          try {
            await selectionQueueRef.current.catch(() => {})
            const res = await host.call('getSelection', { sessionId: sessionKey })
            if (res && res.ok === true) {
              const nextIds = Array.isArray(res.connectionIds)
                ? res.connectionIds.filter((id) => typeof id === 'string')
                : (res.connectionId ? [res.connectionId] : [])
              setConnections(Array.isArray(res.connections) ? res.connections : [])
              setConnectionIds(nextIds)
              desiredSelectionRef.current = nextIds.slice()
              confirmedSelectionRef.current = nextIds.slice()
              setError(null)
            } else {
              setError((res && res.error) || '读取连接失败')
            }
          } catch (err) {
            setError(String((err && err.message) || err))
          }
        }, [sessionKey])

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

        const selectedConnections = connectionIds.map((id) => connections.find((c) => c.id === id)).filter(Boolean)
        const current = selectedConnections.length === 1 ? selectedConnections[0] : null
        const keyword = String(query || '').trim().toLowerCase()
        const filtered = keyword
          ? connections.filter((c) =>
              String(c.name || '').toLowerCase().indexOf(keyword) >= 0 ||
              String(c.host || '').toLowerCase().indexOf(keyword) >= 0 ||
              String(c.database || '').toLowerCase().indexOf(keyword) >= 0)
          : connections

        const choose = (id) => {
          if (!connections.some((connection) => connection.id === id)) return
          const previous = desiredSelectionRef.current.slice()
          const next = previous.includes(id)
            ? previous.filter((selectedId) => selectedId !== id)
            : [...previous, id]
          desiredSelectionRef.current = next
          const revision = ++selectionRevisionRef.current
          setConnectionIds(next)
          setError(null)
          setBusy(true)
          selectionQueueRef.current = selectionQueueRef.current
            .catch(() => {})
            .then(async () => {
              try {
                const res = await host.call('selectConnection', { sessionId: sessionKey, connectionIds: next })
                if (!res || res.ok !== true) throw new Error((res && res.error) || '数据源选择失败')
                confirmedSelectionRef.current = next.slice()
                if (revision === selectionRevisionRef.current) {
                  desiredSelectionRef.current = next.slice()
                  setConnectionIds(next)
                  setError(null)
                  flash(next.includes(id) ? '已添加 ' + (connections.find((c) => c.id === id)?.name || '数据源') : '已移除 ' + (connections.find((c) => c.id === id)?.name || '数据源'), 'ok')
                }
                return res
              } catch (err) {
                if (revision === selectionRevisionRef.current) {
                  const confirmed = confirmedSelectionRef.current.slice()
                  desiredSelectionRef.current = confirmed
                  setConnectionIds(confirmed)
                  setError(String((err && err.message) || err))
                  flash('数据源选择未能保存：' + String((err && err.message) || err), 'err')
                }
                return null
              }
            })
            .finally(() => {
              if (revision === selectionRevisionRef.current) {
                setBusy(false)
                notifyConfigChanged()
              }
            })
        }

        const testCard = async (c) => {
          setTestState((s) => ({ ...s, [c.id]: { busy: true } }))
          try {
            const res = await host.call('testConnection', { connectionId: c.id })
            setTestState((s) => ({
              ...s,
              [c.id]: res && res.ok === true
                ? { busy: false, ok: true, text: '连接正常 · ' + res.latencyMs + 'ms' }
                : { busy: false, ok: false, text: '连接失败：' + ((res && res.error) || '') },
            }))
          } catch (err) {
            setTestState((s) => ({ ...s, [c.id]: { busy: false, ok: false, text: '连接失败：' + String((err && err.message) || err) } }))
          }
          notifyConfigChanged()
        }

        const onManage = () => {
          setOpen(false)
          flash('请打开左下角「设置 → MySQL 数据库」管理连接', 'off')
        }

        const typeIcon = (c) => (c.type === 'postgres' || c.type === 'sqlite' ? IconServer : IconDb)

        const renderItem = (c) => {
          const selected = connectionIds.includes(c.id)
          const chips = Array.isArray(c.tables) ? c.tables : []
          const showMore = chips.length > 6
          const shown = showMore ? chips.slice(0, 6) : chips
          const ts = testState[c.id]
          const testBusy = !!(ts && ts.busy)
          let statusIcon = null
          let statusNode = null
          let statusCls = ''
          if (testBusy) {
            statusNode = React.createElement('span', { className: 'stext' }, '测试连接中')
          } else if (ts) {
            statusIcon = ts.ok ? IconCheck({ size: 11 }) : IconAlert({ size: 11 })
            statusNode = React.createElement('span', { className: 'stext', title: ts.text },
              ts.text + (ts.ok ? '' : ' · 可重试'))
            statusCls = ts.ok ? 'ok' : 'err'
          } else if (c.lastTest) {
            statusIcon = c.lastTest.error != null ? IconAlert({ size: 11 }) : IconCheck({ size: 11 })
            statusNode = React.createElement('span', { className: 'stext' }, c.lastTest.error != null
              ? '上次测试：异常（' + rel(c.lastTest.at) + '）'
              : '上次测试：正常 · ' + c.lastTest.latencyMs + 'ms（' + rel(c.lastTest.at) + '）')
            statusCls = c.lastTest.error != null ? 'err' : 'ok'
          }
          return React.createElement(
            'div', { key: c.id, className: 'dsh-mysql-item' + (selected ? ' is-selected' : '') },
            React.createElement('span', { className: 'dsh-mysql-selection-check', 'aria-hidden': true }, selected ? IconCheck({ size: 11 }) : null),
            React.createElement(
              'button', {
                type: 'button',
                className: 'dsh-mysql-item-main',
                onClick: () => choose(c.id),
                'aria-pressed': selected,
                'aria-label': (selected ? '取消选择 ' : '选择 ') + c.name + '，' + c.host + ':' + c.port + '/' + (c.database || '未指定默认库'),
                title: selected ? '已选中；点击取消选择' : '点击选中此数据源',
              },
              React.createElement(
                'span', { className: 'dsh-mysql-item-head' },
                React.createElement('span', { className: 'dsh-mysql-item-type' }, typeIcon(c)),
                React.createElement('span', { className: 'dsh-mysql-item-name', title: c.name }, c.name),
                selected ? React.createElement('span', { className: 'dsh-mysql-badge sel' }, IconCheck({ size: 10 }), ' 已选择') : null,
              ),
              React.createElement(
                'span', { className: 'dsh-mysql-item-meta' },
                React.createElement('span', { className: 'dsh-mysql-item-sub' },
                  c.host + ':' + c.port + ' / ' + (c.database || '未指定默认库')),
              ),
              React.createElement(
                'div', { className: 'dsh-mysql-chips' },
                c.allowWrite
                  ? React.createElement('span', { className: 'dsh-mysql-chip w' }, '可写')
                  : React.createElement('span', { className: 'dsh-mysql-chip' }, '只读'),
                c.allowDdl
                  ? React.createElement('span', {
                    className: 'dsh-mysql-chip ddl',
                    title: '允许结构变更：CREATE / ALTER / DROP / RENAME / TRUNCATE',
                  }, '结构变更')
                  : null,
                chips.length > 0
                  ? shown.map((t) => React.createElement('span', { key: t, className: 'dsh-mysql-chip' }, t))
                  : React.createElement('span', { className: 'dsh-mysql-chip' }, '全部表'),
                showMore ? React.createElement('span', { className: 'dsh-mysql-chip more' }, '+' + (chips.length - 6) + ' 表') : null,
              ),
              // 状态行常驻：测试中 / 成功 / 失败 / 上次测试，高度稳定
              React.createElement(
                'span', { className: 'dsh-mysql-item-status ' + statusCls },
                statusIcon,
                statusNode,
              ),
            ),
            React.createElement(
              'div', { className: 'dsh-mysql-item-side' },
              React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-icobtn',
                title: (ts && ts.ok === false) ? '重试测试连接' : '测试连接',
                'aria-label': ((ts && ts.ok === false) ? '重试测试 ' : '测试 ') + c.name,
                disabled: testBusy,
                onClick: () => testCard(c),
              }, testBusy ? React.createElement('span', { className: 'dsh-mysql-spinner' }) : IconRefresh({ size: 13 })),
            ),
          )
        }

        const panelRef = React.useRef(null)
        const onPanelKeyDown = (e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
          const panel = panelRef.current
          if (!panel) return
          const mains = Array.prototype.slice.call(panel.querySelectorAll('button.dsh-mysql-item-main'))
          if (mains.length === 0) return
          const idx = mains.indexOf(document.activeElement)
          let next = 0
          if (e.key === 'ArrowDown') next = Math.min(mains.length - 1, (idx < 0 ? -1 : idx) + 1)
          else if (e.key === 'ArrowUp') next = Math.max(0, (idx < 0 ? 0 : idx) - 1)
          else if (e.key === 'Home') next = 0
          else if (e.key === 'End') next = mains.length - 1
          e.preventDefault()
          mains[next].focus()
        }

        // 连接名最多显示 6 个字符，超出省略（完整名称在 title 中）
        const shortName = (name) => {
          const chars = Array.from(String(name || '').trim())
          return chars.length > 6 ? chars.slice(0, 6).join('') + '…' : chars.join('')
        }
        const label = selectedConnections.length > 1
          ? '数据库 · ' + selectedConnections.length
          : (current ? shortName(current.name) : '数据库连接')
        const btnCls = 'dsh-mysql-btn' + (error !== null ? ' is-warn' : (selectedConnections.length > 0 ? ' is-on' : ' is-off')) + (open ? ' is-expanded' : '')
        const title = selectedConnections.length > 1
          ? '当前会话已选择 ' + selectedConnections.length + ' 个数据源：' + selectedConnections.map((connection) => connection.name).join('、') + '。点击管理本会话的数据源'
          : (current
            ? '当前连接：' + current.name + '（' + current.host + ':' + current.port + '/' + (current.database || '未指定默认库') + '）· ' + (current.allowWrite ? '可写' : '只读') + (current.allowDdl ? ' · 可改结构' : '') + '。点击管理本会话的数据源'
            : '当前会话未选择数据源。点击选择一个或多个 MySQL 数据源')

        return React.createElement(
          'span',
          {
             className: 'dsh-mysql-root' + (open ? ' is-expanded' : '') + (busy ? ' is-disabled' : ''),
             style: open && !busy ? { background: 'var(--dsw-alias-interactive-bg-hover)' } : undefined,
           },
          React.createElement(
            'button', {
              type: 'button',
              className: btnCls,
              title: title,
              'aria-label': selectedConnections.length > 1
                ? '当前会话已选择 ' + selectedConnections.length + ' 个数据库数据源，点击管理选择'
                : (current ? '当前数据库连接：' + current.name + '，点击管理选择' : '当前会话未选择数据库连接，点击选择数据源'),
              disabled: false,
              onClick: () => setOpen((v) => !v),
              onMouseDown: (e) => e.preventDefault(),
              'aria-expanded': open,
              'aria-haspopup': 'dialog',
            },
            busy
              ? React.createElement('span', { className: 'dsh-mysql-spinner' })
              : React.createElement('span', { className: 'dsh-mysql-btn-icon' }, IconDb({ size: 13 })),
            current !== null && error === null
              ? React.createElement('span', { className: 'dsh-mysql-dot' })
              : null,
            React.createElement('span', { className: 'dsh-mysql-btn-label' }, label),
            selectedConnections.length > 1 ? React.createElement('span', { className: 'dsh-mysql-selection-count', 'aria-hidden': true }, String(selectedConnections.length)) : null,
            React.createElement('span', { className: 'dsh-mysql-btn-caret', 'aria-hidden': true }, IconChevronDown({ size: 11 })),
          ),
          toast ? React.createElement('div', { className: 'dsh-mysql-toast ' + toast.kind, role: 'status', 'aria-live': 'polite' },
            React.createElement('span', { className: 'dsh-mysql-toast-icon' },
              toast.kind === 'ok' ? IconCheck({ size: 13 })
                : (toast.kind === 'err' ? IconAlert({ size: 13 }) : IconSliders({ size: 13 }))),
            React.createElement('span', { className: 'dsh-mysql-toast-text' }, toast.text),
          ) : null,
          open ? React.createElement(
            'div', {
              className: 'dsh-mysql-panel',
              role: 'dialog',
              'aria-label': '选择数据库连接',
              ref: panelRef,
              onClick: (e) => e.stopPropagation(),
              onKeyDown: onPanelKeyDown,
            },
            React.createElement(
              'div', { className: 'dsh-mysql-panel-header' },
              React.createElement(
                'div', null,
                React.createElement('div', { className: 'dsh-mysql-panel-title' }, '选择数据源'),
                React.createElement('div', { className: 'dsh-mysql-panel-sub', 'aria-live': 'polite' }, selectedConnections.length === 0 ? '尚未选择数据源 · 勾选后立即生效' : ('当前已选 ' + selectedConnections.length + ' 个 · 点击条目可添加或移除')),
              ),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-panel-close',
                title: '关闭',
                'aria-label': '关闭',
                onClick: () => setOpen(false),
              }, IconClose({ size: 12 })),
            ),
            connections.length >= 3 ? React.createElement(
              'div', { className: 'dsh-mysql-search' },
              React.createElement('span', { className: 'dsh-mysql-search-icon' }, IconSearch({ size: 12 })),
              React.createElement('input', {
                className: 'dsh-mysql-search-input',
                value: query,
                placeholder: '搜索连接名称、主机或数据库',
                'aria-label': '搜索连接名称、主机或数据库',
                onChange: (e) => setQuery(e.target.value),
              }),
              query ? React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-search-close',
                title: '清除搜索',
                'aria-label': '清除搜索',
                onClick: () => setQuery(''),
              }, IconClose({ size: 10 })) : null,
            ) : null,
            React.createElement(
              'div', { className: 'dsh-mysql-panel-body' },
              connections.length === 0
                ? React.createElement(
                    'div', { className: 'dsh-mysql-empty' },
                    React.createElement('span', { className: 'icon' }, IconDb({ size: 13 })),
                    '还没有配置数据库连接。请打开 设置 → MySQL 数据库 添加连接（主机、账号、可读表）。',
                  )
                : filtered.length === 0
                  ? React.createElement('div', { className: 'dsh-mysql-empty' }, '没有匹配「' + query + '」的连接')
                  : filtered.map(renderItem),
            ),
            React.createElement(
              'div', { className: 'dsh-mysql-panel-footer' },
              React.createElement('button', {
                type: 'button',
                className: 'dsh-mysql-link',
                onClick: onManage,
              }, IconSliders({ size: 12 }), '管理数据库连接', IconArrowRight({ size: 11 })),
            ),
          ) : null,
        )
      }

      // ── 设置页：连接配置 ────────────────────────────────────────────────
      function blankDraft() {
        return {
          id: '', name: '', host: '127.0.0.1', port: '3306', user: 'root', password: '',
          database: '', tables: [], tableMode: 'all',
          allowWrite: false, riskConfirmed: false,
          allowDdl: false, ddlRiskConfirmed: false,
        }
      }

      function buildConnectionPayload(draft) {
        return {
          id: draft.id || undefined,
          name: String(draft.name || '').trim(),
          host: String(draft.host || '').trim(),
          port: Number(draft.port),
          user: String(draft.user || '').trim(),
          password: draft.password === undefined ? undefined : String(draft.password),
          database: String(draft.database || '').trim(),
          tables: draft.tableMode === 'list' ? (draft.tables || []).slice() : [],
          allowWrite: draft.allowWrite === true && draft.riskConfirmed === true,
          allowDdl: draft.allowDdl === true && draft.ddlRiskConfirmed === true,
          // Host verifies this explicit consent bit before persisting allowDdl.
          ddlRiskConfirmed: draft.ddlRiskConfirmed === true,
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
        const [showPwd, setShowPwd] = React.useState(false)
        const [tagInput, setTagInput] = React.useState('')
        const [testingId, setTestingId] = React.useState(null)
        const [permOpen, setPermOpen] = React.useState(false)
        const snapshotRef = React.useRef('')
        const msgTimerRef = React.useRef(null)

        // 消息条：成功类自动消失（5s），所有消息均可手动关闭
        const showMessage = React.useCallback((m) => {
          if (msgTimerRef.current) { try { msgTimerRef.current() } catch (err) {} msgTimerRef.current = null }
          setMessage(m)
          if (m && m.kind === 'ok') {
            msgTimerRef.current = ctx.timeout(() => { setMessage(null); msgTimerRef.current = null }, 5000)
          }
        }, [])
        React.useEffect(() => () => {
          if (msgTimerRef.current) { try { msgTimerRef.current() } catch (err) {} }
        }, [])

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

        const startAdd = () => {
          const d = blankDraft()
          setDraft(d)
          snapshotRef.current = JSON.stringify(d)
          setPermOpen(false)
          setTestResult(null)
          setMessage(null)
          setShowPwd(false)
          setTagInput('')
        }
        const startEdit = (c) => {
          const tables = Array.isArray(c.tables) ? c.tables.slice() : []
          const d = {
            id: c.id,
            name: c.name,
            host: c.host,
            port: String(c.port),
            user: c.user,
            password: '',
            database: c.database,
            tables: tables,
            tableMode: tables.length > 0 ? 'list' : 'all',
            allowWrite: c.allowWrite === true,
            riskConfirmed: c.allowWrite === true, // 存量可写连接：延续现有权限，不做新增风险确认
            allowDdl: c.allowDdl === true,
            ddlRiskConfirmed: c.allowDdl === true, // 同上：已授权的存量连接不再要求重新确认
          }
          setDraft(d)
          snapshotRef.current = JSON.stringify(d)
          setPermOpen(c.allowWrite === true || c.allowDdl === true)
          setTestResult(null)
          setMessage(null)
          setShowPwd(false)
          setTagInput('')
        }
        const cancel = () => {
          // 有未保存修改时先确认，避免误关丢数据
          if (draft !== null && JSON.stringify(draft) !== snapshotRef.current) {
            if (!window.confirm('有未保存的修改，确定放弃？')) return
          }
          setDraft(null)
          setTestResult(null)
          setTagInput('')
          setShowPwd(false)
        }

        // 勾选「读写」或「允许结构变更」时自动展开权限与安全组
        React.useEffect(() => {
          if (draft !== null && (draft.allowWrite === true || draft.allowDdl === true)) setPermOpen(true)
        }, [draft !== null && draft.allowWrite === true, draft !== null && draft.allowDdl === true])

        const setField = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }))
        const setInput = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }))

        const commitTag = (raw) => {
          const parts = String(raw || '').split(/[,，;；]+/)
          setDraft((d) => {
            const next = (d.tables || []).slice()
            for (const orig of parts) {
              const t = String(orig).trim().replace(/`/g, '').toLowerCase()
              if (!t) continue
              const name = t.split('.').pop()
              if (!name || next.indexOf(name) >= 0) continue
              if (next.length >= 200) break
              next.push(name)
            }
            return { ...d, tables: next }
          })
          setTagInput('')
        }
        const removeTag = (name) => {
          setDraft((d) => ({ ...d, tables: (d.tables || []).filter((t) => t !== name) }))
        }

        const save = async () => {
          if (!draft) return
          if (!String(draft.name || '').trim()) { showMessage({ kind: 'err', text: '连接名称不能为空' }); return }
          if (draft.allowWrite === true && draft.riskConfirmed !== true) {
            showMessage({ kind: 'err', text: '开启读写权限前，请先勾选风险确认' })
            return
          }
          if (draft.allowDdl === true && draft.ddlRiskConfirmed !== true) {
            showMessage({ kind: 'err', text: '开启结构变更权限前，请先勾选风险确认' })
            return
          }
          if (draft.tableMode === 'list' && (draft.tables || []).length === 0) {
            showMessage({ kind: 'err', text: '「仅允许以下表」至少需要一张表；需要不限表请选择「全部表」' })
            return
          }
          setBusy(true)
          setMessage(null)
          try {
            const res = await host.call('saveConnection', { connection: buildConnectionPayload(draft) })
            if (res && res.ok === true) {
              snapshotRef.current = JSON.stringify(draft)
              cancel()
              showMessage({ kind: 'ok', text: '已保存：' + res.connection.name })
              await load()
              notifyConfigChanged()
            } else {
              showMessage({ kind: 'err', text: (res && res.error) || '保存失败' })
            }
          } catch (err) {
            showMessage({ kind: 'err', text: String((err && err.message) || err) })
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
              ? { ok: true, text: '连接成功 · 延迟 ' + res.latencyMs + 'ms' }
              : { ok: false, text: (res && res.error) || '连接失败' })
          } catch (err) {
            setTestResult({ ok: false, text: String((err && err.message) || err) })
          } finally {
            setBusy(false)
          }
        }

        const testSaved = async (c) => {
          setTestingId(c.id)
          setMessage(null)
          try {
            const res = await host.call('testConnection', { connectionId: c.id })
            showMessage(res && res.ok === true
              ? { kind: 'ok', text: '连接正常：' + c.name + '（' + res.latencyMs + ' ms）' }
              : { kind: 'err', text: (res && res.error) || '连接失败' })
          } catch (err) {
            showMessage({ kind: 'err', text: String((err && err.message) || err) })
          } finally {
            setTestingId(null)
            await load()
            notifyConfigChanged()
          }
        }

        const remove = async (c) => {
          if (confirmId !== c.id) { setConfirmId(c.id); return }
          setBusy(true)
          setMessage(null)
          try {
            const res = await host.call('deleteConnection', { connectionId: c.id })
            if (res && res.ok === true) {
              showMessage({ kind: 'ok', text: '已删除：' + c.name })
              await load()
              notifyConfigChanged()
            } else {
              showMessage({ kind: 'err', text: (res && res.error) || '删除失败' })
            }
          } catch (err) {
            showMessage({ kind: 'err', text: String((err && err.message) || err) })
          } finally {
            setBusy(false)
            setConfirmId(null)
          }
        }

        const editingExisting = draft !== null && draft.id !== ''

        const RadioOption = (p) => React.createElement(
          'label', { className: 'dsh-mysql-radio' + (p.checked ? ' is-active' : '') },
          React.createElement('input', {
            type: 'radio',
            name: p.name,
            className: 'dsh-mysql-radio-native',
            checked: p.checked,
            onChange: p.onChange,
          }),
          React.createElement('div', { className: 'dsh-mysql-radio-body' }, p.children),
        )

        const fieldLabel = (text) => React.createElement('span', { className: 'dsh-mysql-field-label' }, text)

        return React.createElement(
          'div', { className: 'dsh-mysql-settings' + (draft !== null ? ' has-form' : '') },
          React.createElement(
            'div', { className: 'dsh-mysql-settings-head' },
            React.createElement(
              'div', null,
              React.createElement('h2', { className: 'dsh-mysql-settings-title' }, 'MySQL 数据库连接'),
              React.createElement('p', { className: 'dsh-mysql-settings-desc' }, '管理 Agent 可使用的 MySQL 数据源'),
              React.createElement('p', { className: 'dsh-mysql-settings-note' }, '连接信息保存在本机 DSH_HOME/storages/dsh-mysql/connections.json'),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-mysql-btn2 outline',
              disabled: busy || draft !== null,
              onClick: startAdd,
            }, IconPlus({ size: 13 }), ' 添加连接'),
          ),
          message ? React.createElement('div', { className: 'dsh-mysql-msg ' + message.kind },
            React.createElement('span', null, message.text),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-mysql-msg-x',
              title: '关闭',
              'aria-label': '关闭通知',
              onClick: () => setMessage(null),
            }, IconClose({ size: 10 })),
          ) : null,
          connections === null
            ? React.createElement('div', { className: 'dsh-mysql-empty' }, loadError || '加载中…')
            : connections.length === 0 && draft === null
              ? React.createElement('div', { className: 'dsh-mysql-empty' }, '还没有配置任何连接。点击「添加连接」开始。')
              : null,
          Array.isArray(connections) ? connections.map((c) => {
            const st = c.lastTest
            return React.createElement(
              'div', { key: c.id, className: 'dsh-mysql-card' },
              React.createElement(
                'div', { className: 'dsh-mysql-card-head' },
                React.createElement('span', { className: 'dsh-mysql-card-name', title: c.name }, c.name),
                c.allowWrite
                  ? React.createElement('span', { className: 'dsh-mysql-badge w' }, '可写')
                  : React.createElement('span', { className: 'dsh-mysql-badge' }, '只读'),
                c.allowDdl
                  ? React.createElement('span', {
                    className: 'dsh-mysql-badge ddl',
                    title: '允许结构变更：CREATE / ALTER / DROP / RENAME / TRUNCATE',
                  }, '结构变更')
                  : null,
                c.tables.length > 0
                  ? React.createElement('span', { className: 'dsh-mysql-badge' }, '白名单 ' + c.tables.length + ' 张表')
                  : React.createElement('span', { className: 'dsh-mysql-badge' }, '全部表'),
                React.createElement('span', { className: 'dsh-mysql-card-fill' }),
                st ? React.createElement('span', {
                  className: 'dsh-mysql-card-status ' + (st.error != null ? 'err' : 'ok'),
                  title: st.error != null ? st.error : ('延迟 ' + st.latencyMs + 'ms'),
                }, st.error != null
                  ? '● 连接异常 · ' + rel(st.at)
                  : '● 连接正常 · ' + rel(st.at)) : null,
              ),
              React.createElement('div', { className: 'dsh-mysql-card-sub' },
                c.host + ':' + c.port + ' / ' + (c.database || '未指定默认库') + ' · 用户 ' + c.user +
                (c.hasPassword ? ' · 密码已保存' : ' · 无密码')),
              c.tables.length > 0 ? React.createElement(
                'div', { className: 'dsh-mysql-chips' },
                c.tables.slice(0, 16).map((t) => React.createElement('span', { key: t, className: 'dsh-mysql-chip' }, t)),
                c.tables.length > 16 ? React.createElement('span', { className: 'dsh-mysql-chip more' }, '+' + (c.tables.length - 16) + ' 表') : null,
              ) : null,
              React.createElement(
                'div', { className: 'dsh-mysql-card-actions' },
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-mysql-btn2 quiet',
                  disabled: busy || draft !== null || testingId === c.id,
                  onClick: () => testSaved(c),
                },
                  testingId === c.id ? React.createElement('span', { className: 'dsh-mysql-spinner' }) : null,
                  '测试连接'),
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2', disabled: busy || draft !== null, onClick: () => startEdit(c) }, '编辑'),
                React.createElement('span', { className: 'grow' }),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-mysql-btn-text danger' + (confirmId === c.id ? ' confirm' : ''),
                  disabled: busy,
                  onClick: () => remove(c),
                }, confirmId === c.id ? '确认删除？' : '删除'),
              ),
            )
          }) : null,
          draft !== null ? React.createElement(
            'div', { className: 'dsh-mysql-card' },
            React.createElement(
              'span', { className: 'dsh-mysql-card-name' }, draft.id ? '编辑连接' : '添加数据库连接',
            ),
            React.createElement(
              'div', { className: 'dsh-mysql-form' },
              // ── 组1：基本信息 ──
              React.createElement(
                'div', { className: 'dsh-mysql-group' },
                React.createElement('div', { className: 'dsh-mysql-group-title' },
                  React.createElement('span', { className: 'icon' }, IconSliders({ size: 12 })),
                  React.createElement('span', null, '基本信息')),
                React.createElement(
                  'div', { className: 'dsh-mysql-form-grid' },
                  React.createElement(
                    'div', { className: 'dsh-mysql-field wide' },
                    fieldLabel('连接名称 *'),
                    React.createElement('input', { className: 'dsh-mysql-input', value: draft.name, placeholder: '例如：演示库（QA）', onChange: setInput('name') }),
                  ),
                  React.createElement(
                    'div', { className: 'dsh-mysql-field' },
                    fieldLabel('主机'),
                    React.createElement('input', { className: 'dsh-mysql-input', value: draft.host, placeholder: '192.168.9.181', onChange: setInput('host') }),
                  ),
                  React.createElement(
                    'div', { className: 'dsh-mysql-field' },
                    fieldLabel('端口'),
                    React.createElement('input', { className: 'dsh-mysql-input', type: 'number', min: 1, max: 65535, value: draft.port, onChange: setInput('port') }),
                  ),
                  React.createElement(
                    'div', { className: 'dsh-mysql-field' },
                    fieldLabel('用户名'),
                    React.createElement('input', { className: 'dsh-mysql-input', value: draft.user, placeholder: 'root', onChange: setInput('user') }),
                  ),
                  React.createElement(
                    'div', { className: 'dsh-mysql-field' },
                    fieldLabel(editingExisting ? '密码（留空保持不变）' : '密码'),
                    React.createElement(
                      'div', { className: 'dsh-mysql-passwrap' },
                      React.createElement('input', {
                        className: 'dsh-mysql-input',
                        type: showPwd ? 'text' : 'password',
                        value: draft.password,
                        autoComplete: 'new-password',
                        placeholder: showPwd ? '' : '••••••',
                        onChange: setInput('password'),
                      }),
                      React.createElement('button', {
                        type: 'button',
                        className: 'dsh-mysql-eye',
                        title: showPwd ? '隐藏密码' : '显示密码',
                        'aria-label': showPwd ? '隐藏密码' : '显示密码',
                        onClick: () => setShowPwd((v) => !v),
                      }, showPwd ? IconEyeOff({ size: 13 }) : IconEye({ size: 13 })),
                    ),
                  ),
                ),
              ),
              // ── 组2：数据库范围 ──
              React.createElement(
                'div', { className: 'dsh-mysql-group' },
                React.createElement('div', { className: 'dsh-mysql-group-title' },
                  React.createElement('span', { className: 'icon' }, IconDb({ size: 12 })),
                  React.createElement('span', null, '数据库范围')),
                React.createElement(
                  'div', { className: 'dsh-mysql-form-grid' },
                  React.createElement(
                    'div', { className: 'dsh-mysql-field' },
                    fieldLabel('默认数据库'),
                    React.createElement('input', { className: 'dsh-mysql-input', value: draft.database, placeholder: 'yd_wechat_rpa（可留空）', onChange: setInput('database') }),
                  ),
                ),
                fieldLabel('表访问范围'),
                React.createElement(RadioOption, {
                  name: 'dsh-mysql-tablemode',
                  checked: draft.tableMode !== 'list',
                  onChange: () => setField('tableMode')('all'),
                },
                  React.createElement('span', { className: 'dsh-mysql-radio-title' }, '全部表'),
                  React.createElement('span', { className: 'dsh-mysql-radio-sub' }, '不限制，可读全部表'),
                ),
                React.createElement(RadioOption, {
                  name: 'dsh-mysql-tablemode',
                  checked: draft.tableMode === 'list',
                  onChange: () => setField('tableMode')('list'),
                },
                  React.createElement('span', { className: 'dsh-mysql-radio-title' }, '仅允许以下表'),
                  React.createElement('span', { className: 'dsh-mysql-radio-sub' }, '输入表名后回车或逗号添加，最多 200 张'),
                ),
                draft.tableMode === 'list' ? React.createElement(
                  'div', { className: 'dsh-mysql-tags' },
                  (draft.tables || []).map((t) => React.createElement(
                    'span', { key: t, className: 'dsh-mysql-tag' },
                    t,
                    React.createElement('button', {
                      type: 'button',
                      className: 'dsh-mysql-tag-x',
                      title: '移除 ' + t,
                      'aria-label': '移除 ' + t,
                      onClick: () => removeTag(t),
                    }, IconClose({ size: 9 })),
                  )),
                  React.createElement('input', {
                    className: 'dsh-mysql-taginput',
                    value: tagInput,
                    placeholder: '添加表名…',
                    'aria-label': '添加表名',
                    onChange: (e) => setTagInput(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTag(tagInput) }
                    },
                    onBlur: () => { if (tagInput) commitTag(tagInput) },
                  }),
                ) : null,
                draft.tableMode === 'list' && (draft.tables || []).length === 0
                  ? React.createElement('div', { className: 'dsh-mysql-fielderr' }, '请添加至少一张表，或选择「全部表」')
                  : null,
              ),
              // ── 组3：权限与安全（可折叠，减少首次配置信息压力）──
              React.createElement(
                'div', { className: 'dsh-mysql-group' },
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-mysql-group-head' + (permOpen ? ' is-open' : ''),
                  'aria-expanded': permOpen,
                  onClick: () => setPermOpen((v) => !v),
                },
                  React.createElement('div', { className: 'dsh-mysql-group-title' },
                    React.createElement('span', { className: 'icon' }, IconAlert({ size: 12 })),
                    React.createElement('span', null, '权限与安全')),
                  React.createElement('span', { className: 'dsh-mysql-group-right' },
                    React.createElement('span', { className: 'dsh-mysql-group-summary' },
                      (draft.allowWrite === true ? (draft.riskConfirmed === true ? '读写 · 已确认' : '读写') : '只读') +
                      (draft.allowDdl === true ? ' · 结构变更' : '')),
                    React.createElement('span', { className: 'dsh-mysql-group-caret' }, IconChevronDown({ size: 14 })))),
                permOpen ? React.createElement(
                  'div', { className: 'dsh-mysql-group-body' },
                  fieldLabel('访问模式'),
                  React.createElement(RadioOption, {
                    name: 'dsh-mysql-access',
                    checked: draft.allowWrite !== true,
                    onChange: () => setDraft((d) => ({ ...d, allowWrite: false, riskConfirmed: false })),
                  },
                    React.createElement('span', { className: 'dsh-mysql-radio-title' }, '只读（推荐）'),
                    React.createElement('span', { className: 'dsh-mysql-radio-sub' }, '默认安全：仅允许 SELECT / SHOW / DESCRIBE / EXPLAIN 查询'),
                  ),
                  React.createElement(RadioOption, {
                    name: 'dsh-mysql-access',
                    checked: draft.allowWrite === true,
                    onChange: () => setDraft((d) => ({ ...d, allowWrite: true, riskConfirmed: d.riskConfirmed })),
                  },
                    React.createElement('span', { className: 'dsh-mysql-radio-title' }, '读写（允许 Agent 执行写操作）'),
                    React.createElement('span', { className: 'dsh-mysql-radio-sub' }, '开启 mysql_execute：仅 INSERT / UPDATE / DELETE'),
                  ),
                  draft.allowWrite === true ? React.createElement(
                    'div', { className: 'dsh-mysql-risk' },
                    React.createElement('span', { className: 'dsh-mysql-risk-icon' }, IconAlert({ size: 14 })),
                    React.createElement('div', { className: 'dsh-mysql-risk-text' },
                      React.createElement('span', { className: 'dsh-mysql-risk-strong' }, '写操作有风险'),
                      React.createElement('span', null, '开启后，Agent 可能执行 INSERT、UPDATE、DELETE 等操作，修改数据库数据。建议仅用于测试数据库。'),
                    ),
                  ) : null,
                  draft.allowWrite === true ? React.createElement(
                    'label', { className: 'dsh-mysql-check' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: draft.riskConfirmed === true,
                      onChange: (e) => setDraft((d) => ({ ...d, riskConfirmed: e.target.checked === true })),
                    }),
                    React.createElement('span', null, '我了解风险，允许 Agent 执行写操作'),
                  ) : null,
                  // ── 结构变更（DDL）授权：与写权限相互独立 ──
                  fieldLabel('结构变更'),
                  React.createElement('label', { className: 'dsh-mysql-check' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: draft.allowDdl === true,
                      onChange: (e) => setDraft((d) => ({
                        ...d,
                        allowDdl: e.target.checked === true,
                        ddlRiskConfirmed: e.target.checked === true ? d.ddlRiskConfirmed : false,
                      })),
                    }),
                    React.createElement('span', null, '允许 Agent 执行结构变更（DDL）'),
                  ),
                  React.createElement('p', { className: 'dsh-mysql-hint' },
                    '开启后 mysql_ddl 可用：CREATE / ALTER / DROP / RENAME / TRUNCATE 作用于表、视图、索引，与写权限相互独立。'),
                  draft.allowDdl === true ? React.createElement(
                    'div', { className: 'dsh-mysql-risk' },
                    React.createElement('span', { className: 'dsh-mysql-risk-icon' }, IconAlert({ size: 14 })),
                    React.createElement('div', { className: 'dsh-mysql-risk-text' },
                      React.createElement('span', { className: 'dsh-mysql-risk-strong' }, '结构变更不可回滚'),
                      React.createElement('span', null, 'DROP / TRUNCATE 会删除表与数据，ALTER 可能重写表结构。改 / 删目标受表白名单限制，且只能在连接的默认库内执行；建议仅用于测试库或确有必要的库。'),
                    ),
                  ) : null,
                  draft.allowDdl === true ? React.createElement(
                    'label', { className: 'dsh-mysql-check' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: draft.ddlRiskConfirmed === true,
                      onChange: (e) => setDraft((d) => ({ ...d, ddlRiskConfirmed: e.target.checked === true })),
                    }),
                    React.createElement('span', null, '我了解风险，允许 Agent 执行结构变更（DDL）'),
                  ) : null,
                  React.createElement('p', { className: 'dsh-mysql-hint' },
                    '未开启写权限时 mysql_execute 会拒绝，未开启结构变更权限时 mysql_ddl 会拒绝。即使开启，账号与权限类语句（CREATE USER、GRANT 等）、库级语句（CREATE / ALTER / DROP DATABASE）与多语句执行也一律被拒绝。'),
                ) : null,
              ),
              // ── 测试结果 + 固定操作栏 ──
              testResult !== null ? React.createElement(
                'div', null,
                testResult.ok
                  ? React.createElement('span', { className: 'dsh-mysql-test-ok' }, IconCheck({ size: 12 }), testResult.text)
                  : React.createElement('span', { className: 'dsh-mysql-test-err' }, IconAlert({ size: 12 }), testResult.text),
              ) : null,
              React.createElement(
                'div', { className: 'dsh-mysql-form-footer' },
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2 primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存连接'),
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2 quiet', disabled: busy, onClick: test }, busy ? '测试中…' : '测试连接'),
                React.createElement('button', { type: 'button', className: 'dsh-mysql-btn2', disabled: busy, onClick: cancel }, '取消'),
              ),
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

    return { inject: ['remote', 'timer'], apply }
  },
})