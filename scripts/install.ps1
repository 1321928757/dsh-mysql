# dsh-mysql 一键安装器（PowerShell）
# 用法：右键「使用 PowerShell 运行」，或在终端执行 .\install.ps1
# 固定 pnpm 版本避免平台差异（dsh-prompt-polish 同款策略）

$ErrorActionPreference = 'Stop'

# ── 版本（发布时三处同步：package.json / install.ps1 / README）───────────
$Owner = '1321928757'
$Repo = 'dsh-mysql'
$Rev = 'v0.1.4' #dsh-mysql v0.1.4

$Profile = 'web'

Write-Host "==> dsh-mysql $Rev 安装到 profile: $Profile" -ForegroundColor Cyan

# 1. 确认 dsh CLI 可用
if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Error '未找到 dsh 命令，请先安装 DeepSeek Harness 并确保 dsh 在 PATH 中。'
  exit 1
}

# 2. 固定 pnpm 版本（避免 profile 内 pnpm 版本漂移）
$pnpm = Join-Path $env:USERPROFILE '.dsh-tmp\pnpm.cmd'
$pnpmDir = Split-Path $pnpm
if (-not (Test-Path $pnpm)) {
  Write-Host '==> 准备固定版本 pnpm ...' -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $pnpmDir | Out-Null
  & npm install --prefix $pnpmDir pnpm@9.15.0 | Out-Null
}

# 3. 安装插件（github 源）
Write-Host "==> dsh plugin --profile $Profile add github:${Owner}/${Repo}#$Rev" -ForegroundColor Cyan
& dsh plugin --profile $Profile add "github:${Owner}/${Repo}#$Rev"

Write-Host ''
Write-Host '==> 安装完成。请重启 dsh web（确认旧进程已退出）后，' -ForegroundColor Green
Write-Host '    打开 设置 -> MySQL 数据库 添加连接，并在输入栏左侧的 🐬 按钮选择连接。' -ForegroundColor Green
