<#
.SYNOPSIS
  dsh-mysql 的隔离 Web 验收（DSH 0.2.0-rc.2）。

.DESCRIPTION
  在一个一次性 profile / 一次性端口 / 一次性 DSH_HOME 上启动 `dsh web`，然后用
  无头浏览器（Chrome 或 Edge，走 CDP）验证：

    1. Web 服务返回 200，客户端 boot 图里含 `dsh-mysql`；
    2. boot 遮罩没有报告 "Failed to load plugins"；
    3. `conversation.input.left` 贡献渲染出了连接控件（即 Client bundle 被物化、
       slot 注册成功、`getSelection` RPC 走通），且控件不是 RPC 失败态 `is-warn`。

  加 `-RpcProbe` 时，还会在同一个实例上用 `scripts/web-rpc-probe.mjs` 驱动真实 UI，
  逐个打通 UI 上可见的 6 个 RPC 方法（listConnections / saveConnection /
  testConnection / getSelection / selectConnection / deleteConnection），
  并验证密码不落 DOM、刷新后连接仍在（落盘）、删除后回到空态。第 7 个方法
  `listTables` 客户端从不调用，由契约测试覆盖。

  绝不触碰用户现有的 3080 实例：脚本拒绝 3080 端口，使用独立 DSH_HOME 与独立
  浏览器 user-data-dir，结束时只清理自己启动的进程。

.EXAMPLE
  pwsh -NoProfile -File scripts/dsh02-web-smoke.ps1
.EXAMPLE
  pwsh -NoProfile -File scripts/dsh02-web-smoke.ps1 -RpcProbe
#>
[CmdletBinding()]
param(
  [string]$CliPath = 'F:\dsh-desktop-official\resources\runtime\cli\bin\dsh.cmd',
  [string]$Profile = 'dsh-mysql-compat-web',
  [int]$Port = 33180,
  [int]$DebugPort = 9333,
  [string]$TestHome = '',
  [string]$BrowserPath = '',
  [int]$TimeoutSeconds = 90,
  [switch]$RpcProbe
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$probe = Join-Path $PSScriptRoot 'web-boot-probe.mjs'
$rpcProbePath = Join-Path $PSScriptRoot 'web-rpc-probe.mjs'

if ([string]::IsNullOrWhiteSpace($TestHome)) { $TestHome = Join-Path $repo '.tmp\dsh02-web-home' }
$TestHome = [System.IO.Path]::GetFullPath($TestHome)
if ($Port -eq 3080 -or $DebugPort -eq 3080) { throw 'Refusing to use the legacy 3080 port.' }
if (-not (Test-Path $CliPath)) { throw "DSH 0.2 CLI not found: $CliPath" }
if (-not (Test-Path $probe)) { throw "Web boot probe not found: $probe" }
if ($RpcProbe -and -not (Test-Path $rpcProbePath)) { throw "Web RPC probe not found: $rpcProbePath" }

if ([string]::IsNullOrWhiteSpace($BrowserPath)) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  $BrowserPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($BrowserPath) -or -not (Test-Path $BrowserPath)) {
  throw 'No headless browser found; pass -BrowserPath <chrome.exe|msedge.exe>.'
}

New-Item -ItemType Directory -Force -Path $TestHome | Out-Null
$logDir = Join-Path $TestHome 'smoke-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$browserProfile = Join-Path $TestHome 'browser-profile'

$oldHome = $env:DSH_HOME
$server = $null
$browser = $null
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
    Write-Host "==> initializing profile '$Profile' from the shipped 'web' template"
    & $CliPath --from-default-profile web --profile $Profile --dump-config *> (Join-Path $logDir 'init.log')
    if (-not (Test-Path $profileJson)) { throw "Profile '$Profile' was not initialized (see init.log)" }
  }

  Write-Host "==> installing the local bundle into profile '$Profile'"
  & $CliPath plugin --profile $Profile add $repo *> (Join-Path $logDir 'plugin-add.log')
  if ($LASTEXITCODE -ne 0) { throw "Unable to install dsh-mysql into the isolated profile (exit $LASTEXITCODE)" }

  $config = & $CliPath --profile $Profile --dump-config 2>&1 | Out-String
  if ($config -notmatch '(?m)^- id: dsh-mysql\s*$') { throw 'The composed profile tree has no dsh-mysql row.' }

  Write-Host "==> starting isolated web instance on port $Port"
  $serverOut = Join-Path $logDir 'web.stdout.log'
  $serverErr = Join-Path $logDir 'web.stderr.log'
  $server = Start-Process -FilePath $CliPath -ArgumentList @('--profile', $Profile, '--no-open', '--port', "$Port") `
    -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru -WindowStyle Hidden

  $url = $null
  for ($i = 0; $i -lt ($TimeoutSeconds * 2); $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $serverOut) {
      $match = Select-String -Path $serverOut -Pattern 'dsh web:\s*(\S+)' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($match) { $url = $match.Matches[0].Groups[1].Value.Trim(); break }
    }
    if ($server.HasExited) { throw "The isolated web process exited early (code $($server.ExitCode)); see $serverErr" }
  }
  if ([string]::IsNullOrWhiteSpace($url)) { throw "The isolated web instance never reported a URL; see $serverOut" }

  Write-Host "==> serving $url"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
  if ($response.StatusCode -ne 200) { throw "Isolated web returned HTTP $($response.StatusCode)" }
  if ($response.Content -notmatch '__DSH_BOOT__') { throw 'The served document carries no __DSH_BOOT__ manifest.' }

  Write-Host "==> booting a headless browser and probing the client graph"
  Remove-Item -Recurse -Force $browserProfile -ErrorAction SilentlyContinue
  $browser = Start-Process -FilePath $BrowserPath -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    "--remote-debugging-port=$DebugPort", '--remote-allow-origins=*',
    "--user-data-dir=$browserProfile", 'about:blank'
  ) -PassThru -WindowStyle Hidden

  $probeRaw = & node $probe $url $DebugPort ($TimeoutSeconds * 1000) 2>&1 | Out-String
  $probeRaw | Set-Content (Join-Path $logDir 'probe.json')
  $probeResult = $null
  try { $probeResult = $probeRaw | ConvertFrom-Json } catch { throw "The browser probe returned unparsable output:$([Environment]::NewLine)$probeRaw" }

  Write-Host ("    verdict: " + $probeResult.verdict)
  if ($null -ne $probeResult.snapshot) {
    Write-Host ("    entries: " + $probeResult.snapshot.entryCount + ", mysql control: " + $probeResult.snapshot.mysqlControl)
  }

  if ($probeResult.verdict -ne 'ok') {
    $failures += "client boot verdict was '$($probeResult.verdict)' (expected 'ok')"
    if ($null -ne $probeResult.snapshot -and $probeResult.snapshot.bootText) {
      $failures += "boot overlay text: $($probeResult.snapshot.bootText)"
    }
  } else {
    if ($probeResult.snapshot.hasMysqlEntry -ne $true) { $failures += 'dsh-mysql is missing from the client boot graph' }
    if ($probeResult.snapshot.failedPlugins -eq $true) { $failures += 'the boot overlay reported failed plugins' }
    if ($probeResult.snapshot.mysqlControl -lt 1) { $failures += 'the conversation.input.left contribution did not render' }
    if ($probeResult.snapshot.mysqlControlWarn -gt 0) { $failures += 'the input-bar control rendered in the RPC error state (is-warn)' }
  }
  if ($probeResult.console.Count -gt 0) { $failures += "renderer console errors: $($probeResult.console -join ' | ')" }
  if ($probeResult.exceptions.Count -gt 0) { $failures += "uncaught renderer exceptions: $($probeResult.exceptions -join ' | ')" }

  if ($RpcProbe) {
    Write-Host '==> driving the MySQL RPC surface through the rendered UI'
    $rpcRaw = & node $rpcProbePath $url $DebugPort 120000 2>&1 | Out-String
    $rpcRaw | Set-Content (Join-Path $logDir 'rpc-probe.json')
    $rpcResult = $null
    try { $rpcResult = $rpcRaw | ConvertFrom-Json } catch { throw "The RPC probe returned unparsable output:$([Environment]::NewLine)$rpcRaw" }
    Write-Host ("    rpc verdict: " + $rpcResult.verdict)
    foreach ($step in $rpcResult.steps) {
      Write-Host ("      " + $(if ($step.ok) { '[ok]  ' } else { '[FAIL]' }) + ' ' + $step.step)
    }
    if ($rpcResult.verdict -ne 'ok') {
      foreach ($step in $rpcResult.failed) { $failures += "RPC probe step failed: $step" }
    }
    if ($rpcResult.console.Count -gt 0) { $failures += "renderer console errors during RPC probe: $($rpcResult.console -join ' | ')" }
    if ($rpcResult.exceptions.Count -gt 0) { $failures += "uncaught renderer exceptions during RPC probe: $($rpcResult.exceptions -join ' | ')" }
  }

  if ($failures.Count -gt 0) {
    throw ("Isolated web smoke failed:" + [Environment]::NewLine + ($failures -join [Environment]::NewLine))
  }
  Write-Host 'PASS: isolated DSH 0.2 Web smoke test'
}
finally {
  if ($null -ne $browser -and -not $browser.HasExited) { Stop-Tree -ProcessId $browser.Id }
  if ($null -ne $server -and -not $server.HasExited) { Stop-Tree -ProcessId $server.Id }
  if ($null -eq $oldHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
  else { $env:DSH_HOME = $oldHome }
}
