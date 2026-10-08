<#
.SYNOPSIS
  dsh-mysql 的隔离 Headless 验收（DSH 0.2.0-rc.2）。

.DESCRIPTION
  在一个一次性 profile / 一次性 DSH_HOME 上用 `dsh.cmd` 启动 headless 组合，验证
  Host 侧的兼容性，且完全不依赖 LLM、网络或既有的 3080 实例：

    1. 组合后的 profile 树里含 `dsh-mysql` 行，且 Typert loader 行存在；
    2. 进程 stdout 报告 `[dsh-mysql] host mounted`；
    3. 插件自己的 boot.log 报告工具注册（mysql_query / mysql_tables /
       mysql_execute）、`service mysql provided`、`apply complete`；
    4. stderr 没有 `typert-loader:` 注册失败。

.EXAMPLE
  pwsh -NoProfile -File scripts/dsh02-headless-smoke.ps1
#>
[CmdletBinding()]
param(
  [string]$CliPath = 'F:\dsh-desktop-official\resources\runtime\cli\bin\dsh.cmd',
  [string]$Profile = 'dsh-mysql-compat-headless',
  [string]$TestHome = '',
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ([string]::IsNullOrWhiteSpace($TestHome)) { $TestHome = Join-Path $repo '.tmp\dsh02-headless-home' }
$TestHome = [System.IO.Path]::GetFullPath($TestHome)
if (-not (Test-Path $CliPath)) { throw "DSH 0.2 CLI not found: $CliPath" }

New-Item -ItemType Directory -Force -Path $TestHome | Out-Null
$logDir = Join-Path $TestHome 'smoke-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$oldHome = $env:DSH_HOME
$server = $null
$failures = @()

function Stop-Tree([int]$ProcessId) {
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) { Stop-Tree -ProcessId $child.ProcessId }
  } catch { }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

try {
  $env:DSH_HOME = $TestHome
  Write-Host "==> isolated DSH_HOME: $TestHome"

  $profileJson = Join-Path $TestHome "profiles\$Profile\package.json"
  if (-not (Test-Path $profileJson)) {
    Write-Host "==> initializing profile '$Profile' from the shipped 'headless' template"
    & $CliPath --from-default-profile headless --profile $Profile --dump-config *> (Join-Path $logDir 'init.log')
    if (-not (Test-Path $profileJson)) { throw "Profile '$Profile' was not initialized (see init.log)" }
  }

  Write-Host "==> installing the local bundle into profile '$Profile'"
  & $CliPath plugin --profile $Profile add $repo *> (Join-Path $logDir 'plugin-add.log')
  if ($LASTEXITCODE -ne 0) { throw "Unable to install dsh-mysql into the isolated profile (exit $LASTEXITCODE)" }

  $config = & $CliPath --profile $Profile --dump-config 2>&1 | Out-String
  if ($config -notmatch '(?m)^- id: dsh-mysql\s*$') { throw 'The composed profile tree has no dsh-mysql row.' }
  if ($config -notmatch 'dsh-typert-loader') { $failures += 'the composed profile tree has no Typert loader row' }

  $bootLog = Join-Path $TestHome 'storages\dsh-mysql\boot.log'
  Remove-Item -Force $bootLog -ErrorAction SilentlyContinue

  Write-Host '==> booting the isolated headless composition'
  $out = Join-Path $logDir 'headless.stdout.log'
  $err = Join-Path $logDir 'headless.stderr.log'
  $server = Start-Process -FilePath $CliPath -ArgumentList @('--profile', $Profile) `
    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden

  $stdout = ''
  $stderr = ''
  for ($i = 0; $i -lt ($TimeoutSeconds * 2); $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $out) { $stdout = Get-Content $out -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $err) { $stderr = Get-Content $err -Raw -ErrorAction SilentlyContinue }
    if ($stdout -match '\[dsh-mysql\] host mounted' -and (Test-Path $bootLog)) { break }
    if ($server.HasExited) { break }
  }
  Write-Host '--- stdout ---'; Write-Host $stdout
  if (-not [string]::IsNullOrWhiteSpace($stderr)) { Write-Host '--- stderr ---'; Write-Host $stderr }

  if ($stdout -notmatch '\[dsh-mysql\] host mounted') { $failures += 'the Host row never reported a successful mount' }
  if ($stderr -match 'typert-loader:') { $failures += 'the Typert loader reported a dsh-mysql registration failure' }

  $boot = if (Test-Path $bootLog) { Get-Content $bootLog -Raw } else { '' }
  if ($boot -notmatch 'tools registered: mysql_query, mysql_tables, mysql_execute') { $failures += 'the Host never registered all three MySQL tools' }
  if ($boot -notmatch 'service mysql provided') { $failures += 'the Host never provided the mysql service' }
  if ($boot -notmatch 'apply complete') { $failures += 'the Host apply never completed' }

  if ($failures.Count -gt 0) {
    throw ("Isolated headless smoke failed:" + [Environment]::NewLine + ($failures -join [Environment]::NewLine))
  }
  Write-Host 'PASS: isolated DSH 0.2 Headless smoke test'
}
finally {
  if ($null -ne $server -and -not $server.HasExited) { Stop-Tree -ProcessId $server.Id }
  if ($null -eq $oldHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
  else { $env:DSH_HOME = $oldHome }
}
