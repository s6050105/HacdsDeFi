# =============================================================================
# install-services.ps1 —— 把 hacds 的五个后台服务注册成 Windows 开机自启动
#
# 用法（必须以管理员身份运行 PowerShell）：
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#   .\install-services.ps1
#
# 卸载：
#   .\install-services.ps1 -Uninstall
#
# 为什么用计划任务而不是 NSSM：
#   · 系统自带，不引入第三方依赖
#   · 原生支持「开机启动 + 失败重试 + 指定工作目录」
#   · 日志走 PowerShell 重定向，出问题可直接看文件
#
# ⚠ 顺序很重要：节点必须最先起（其他四个都依赖它的 :8082）。
#   计划任务用 AtStartup 触发器本身有先后竞争，所以每个服务脚本里
#   都带了「等待依赖就绪」的循环，而不是靠 sleep 赌时间。
# =============================================================================

param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# ---- 路径（全部在同一个目录下，按用户确认）----
$BASE = 'C:\Users\Administrator\Desktop\oracle'

$NODE_EXE      = Join-Path $BASE 'hacash_fullnode_windows.exe'
$CLOUDFLARED   = Join-Path $BASE 'cloudflared.exe'
$INDEXER_PY    = Join-Path $BASE 'hacds_indexer.py'
$BUILD_PY      = Join-Path $BASE 'hacds_build_server.py'
$KEEPER_PY     = Join-Path $BASE 'hacds_keeper.py'
$TXBUILD       = Join-Path $BASE 'hacds_txbuild.exe'
$KEYFILE       = Join-Path $BASE '1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu.key'

$KEEPER_ADDR   = '1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu'
$CONTRACT      = 'T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH'

$LOGDIR        = Join-Path $BASE 'logs'

# ⚠ 2026-11-12 安全审计：这里原先硬编码了一个**真实可用的** Cloudflare
#   Tunnel Token（base64 解出含账号 ID / 隧道 ID / 隧道密钥）。
#   拿到它即可在任意机器接入同一条隧道，接管 api/indexer/build.hacds.com
#   的全部流量 —— 而官网下发的正是「未签名 txbody」，中间人可改收款地址。
#
#   已改为从环境变量读取，仓库内不再保存任何令牌。
#   该令牌必须在 Cloudflare 后台**重新生成**（旧的视为已泄露）。
#
#   用法：
#     $env:CF_TUNNEL_TOKEN = '<新令牌>'
#     .\install-services.ps1 -Install
$TUNNEL_TOKEN  = $env:CF_TUNNEL_TOKEN
if (-not $TUNNEL_TOKEN) {
    Write-Host '缺少 CF_TUNNEL_TOKEN 环境变量（Cloudflare Tunnel 令牌）。' -ForegroundColor Red
    Write-Host '  在 Cloudflare Zero Trust → Networks → Tunnels 里复制令牌，然后：' -ForegroundColor Yellow
    Write-Host '  $env:CF_TUNNEL_TOKEN = ''<token>''' -ForegroundColor Yellow
    if (-not $Uninstall) { exit 1 }
}

$TASKS = @('hacds-node', 'hacds-tunnel', 'hacds-indexer', 'hacds-build', 'hacds-keeper')

# ---- 卸载 ----
if ($Uninstall) {
    foreach ($t in $TASKS) {
        $existed = $false
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
            Write-Host "已移除: $t"
            $existed = $true
        }
        if (-not $existed) { Write-Host "不存在: $t" }
    }
    Write-Host "`n卸载完成。日志目录保留在 $LOGDIR"
    return
}

# ---- 安装前检查 ----
Write-Host "=== 检查文件 ===" -ForegroundColor Cyan
$required = @{
    '节点'       = $NODE_EXE
    'cloudflared'= $CLOUDFLARED
    '索引器'     = $INDEXER_PY
    '构建服务'   = $BUILD_PY
    'keeper'     = $KEEPER_PY
    'txbuild'    = $TXBUILD
    'keeper私钥' = $KEYFILE
}
$missing = @()
foreach ($k in $required.Keys) {
    $p = $required[$k]
    if (Test-Path $p) {
        Write-Host ("  OK   {0,-10} {1}" -f $k, $p)
    } else {
        Write-Host ("  MISS {0,-10} {1}" -f $k, $p) -ForegroundColor Red
        $missing += $k
    }
}
if ($missing.Count -gt 0) {
    throw "缺少必需文件：$($missing -join ', ')。请先补齐再安装。"
}

# 私钥格式校验（必须 64 位十六进制）
$keyRaw = (Get-Content $KEYFILE -Raw).Trim()
if ($keyRaw -notmatch '^(0x)?[0-9a-fA-F]{64}$') {
    throw "私钥文件不是 64 位十六进制：$KEYFILE（实际长度 $($keyRaw.Length)）"
}
Write-Host "  OK   私钥格式 64 hex" -ForegroundColor Green

# python 解释器路径（计划任务里不能用裸 python，PATH 可能不同）
$PYTHON = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $PYTHON) { throw "找不到 python，请确认已安装并加入 PATH" }
$PYTHON = $PYTHON.Source
Write-Host "  OK   python   $PYTHON"

if (-not (Test-Path $LOGDIR)) { New-Item -ItemType Directory -Path $LOGDIR | Out-Null }
Write-Host "  OK   日志目录 $LOGDIR"

# ---- 删旧任务（幂等）----
foreach ($t in $TASKS) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
        Write-Host "清理旧任务: $t"
    }
}

# ---- 停掉手工启动的旧进程 ----
#
# 之前手工在 PowerShell 窗口里跑的节点/索引器会占着 8082/8124，
# 新任务起来会 Bind 失败。这里主动停掉，由计划任务统一接管。
# ⚠ 只停「占用我们这几个端口」的进程，不碰其它 Python / 无关进程。
Write-Host "`n=== 停止占用端口的旧进程 ===" -ForegroundColor Cyan
$ourPorts = @(8082, 8124, 8125)
$toStop = @{}
foreach ($p in $ourPorts) {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if ($procId -and $procId -notin @(0, 4)) {
            $pr = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($pr) {
                $key = "$($pr.ProcessName) (PID $procId)"
                if (-not $toStop.ContainsKey($procId)) {
                    $toStop[$procId] = $pr.ProcessName
                    Write-Host ("  端口 {0} 被 {1} 占用，将停止" -f $p, $key) -ForegroundColor Yellow
                }
            }
        }
    }
}
if ($toStop.Count -eq 0) {
    Write-Host "  无需停止" -ForegroundColor Green
} else {
    foreach ($procId in $toStop.Keys) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host ("  已停止 PID {0} ({1})" -f $procId, $toStop[$procId]) -ForegroundColor Green
        } catch {
            Write-Host ("  停止 PID {0} 失败：{1}" -f $procId, $_.Exception.Message) -ForegroundColor Red
        }
    }
    Start-Sleep -Seconds 3
}

# =============================================================================
# 生成各服务的启动包装脚本
#
# 为什么不直接把 exe 交给计划任务：
#   · 需要工作目录（节点要读同目录的 hacash.config.ini）
#   · 需要环境变量（keeper 的 HACDS_KEEPER_KEY）
#   · 需要「等依赖就绪再起」的逻辑
#   · 需要日志重定向（计划任务本身不收集 stdout）
# =============================================================================

function Write-Wrapper {
    param([string]$Name, [string]$Body)
    $path = Join-Path $BASE "$Name.start.ps1"
    $header = @"
# 由 install-services.ps1 生成 —— 不要手改，重新运行安装脚本即可覆盖。
`$ErrorActionPreference = 'Continue'
`$BASE = '$BASE'
Set-Location `$BASE
New-Item -ItemType Directory -Force -Path '$LOGDIR' | Out-Null
`$log = Join-Path '$LOGDIR' '$Name.log'
function Say(`$m) { (`$m | Tee-Object -FilePath `$log -Append) }
"@
    Set-Content -Path $path -Value ($header + "`n" + $Body) -Encoding UTF8
    Write-Host "  生成 $path"
}

# ---- ① 节点 ----
Write-Wrapper -Name 'hacds-node' -Body @'
Say "=== 启动全节点 $(Get-Date -Format s) ==="
& "$BASE\hacash_fullnode_windows.exe" 2>&1 | ForEach-Object { Say $_ }
Say "=== 节点退出，exit=$LASTEXITCODE ==="
'@

# ---- ② cloudflared ----
Write-Wrapper -Name 'hacds-tunnel' -Body @"
Say "=== 启动 cloudflared `$(Get-Date -Format s) ==="
`$tok = '$TUNNEL_TOKEN'
& "`$BASE\cloudflared.exe" tunnel --no-autoupdate run --token `$tok 2>&1 | ForEach-Object { Say `$_ }
Say "=== cloudflared 退出，exit=`$LASTEXITCODE ==="
"@

# ---- ③ 索引器 ----
# 等节点就绪：索引器启动会立刻 GET /query/block/height/latest
Write-Wrapper -Name 'hacds-indexer' -Body @"
Say "=== 等待节点就绪 ==="
for (`$i = 0; `$i -lt 120; `$i++) {
    try {
        `$r = Invoke-RestMethod 'http://127.0.0.1:8082/query/block/height/latest' -TimeoutSec 3
        if (`$r.ret -eq 0) { Say "节点就绪，高度=`$(`$r.height)"; break }
    } catch { }
    Start-Sleep -Seconds 5
}
Say "=== 启动索引器 `$(Get-Date -Format s) ==="
& '$PYTHON' "`$BASE\hacds_indexer.py" serve --node http://127.0.0.1:8082 --host 127.0.0.1 --port 8124 --read-only --interval 60 --window 500 --workers 4 2>&1 | ForEach-Object { Say `$_ }
Say "=== 索引器退出，exit=`$LASTEXITCODE ==="
"@

# ---- ④ 构建服务 ----
Write-Wrapper -Name 'hacds-build' -Body @"
Say "=== 启动构建服务 `$(Get-Date -Format s) ==="
& '$PYTHON' "`$BASE\hacds_build_server.py" --port 8125 --host 127.0.0.1 --contract $CONTRACT --txbuild "`$BASE\hacds_txbuild.exe" --trust-proxy 2>&1 | ForEach-Object { Say `$_ }
Say "=== 构建服务退出，exit=`$LASTEXITCODE ==="
"@

# ---- ⑤ keeper（真续租，需要私钥）----
#
# ⚠ keeper 的 run 是「跑一轮就退出」，不是常驻服务
#   （cmd_run → _collect_jobs → _execute → return，没有 while True）。
#   所以它**不能**用开机自启 + 失败重启的模式 —— 那样只会开机跑一次，
#   之后再也不续租。正确做法是**定时任务**：每小时跑一轮。
#
Write-Wrapper -Name 'hacds-keeper' -Body @"
Say "=== keeper 一轮 `$(Get-Date -Format s) ==="
# 依赖未就绪就跳过本轮（计划任务下次还会来），不要在这里死等
`$okNode = `$false; `$okIdx = `$false
try { `$r = Invoke-RestMethod 'http://127.0.0.1:8082/query/block/height/latest' -TimeoutSec 5; if (`$r.ret -eq 0) { `$okNode = `$true } } catch { }
try { `$r2 = Invoke-RestMethod 'http://127.0.0.1:8124/health' -TimeoutSec 5; if (`$r2.ok) { `$okIdx = `$true } } catch { }
if (-not (`$okNode -and `$okIdx)) {
    Say "依赖未就绪（node=`$okNode indexer=`$okIdx），跳过本轮"
    exit 0
}
`$env:HACDS_KEEPER_KEY = '$KEYFILE'
& '$PYTHON' "`$BASE\hacds_keeper.py" run --indexer http://127.0.0.1:8124 --node http://127.0.0.1:8082 --main $KEEPER_ADDR --contract $CONTRACT --txbuild "`$BASE\hacds_txbuild.exe" 2>&1 | ForEach-Object { Say `$_ }
Say "=== keeper 本轮结束，exit=`$LASTEXITCODE ==="
"@

# =============================================================================
# 注册计划任务
#
# 关键设置：
#   · AtStartup       —— 开机即启，不要求用户登录
#   · SYSTEM 账户     —— 不依赖任何登录会话
#   · RestartOnFailure—— 进程崩溃后自动重起（间隔 1 分钟，无限次）
#   · ExecutionTimeLimit 0 —— 不因"运行超时"被系统杀掉（默认 3 天会被砍）
#   · 不设 StartWhenAvailable 之外的等待，避免开机卡慢
# =============================================================================

Write-Host "`n=== 注册计划任务 ===" -ForegroundColor Cyan

foreach ($t in $TASKS) {
    $script = Join-Path $BASE "$t.start.ps1"
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
        -WorkingDirectory $BASE

    # SYSTEM 运行，最高权限（不依赖任何用户登录）
    $principal = New-ScheduledTaskPrincipal `
        -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

    if ($t -eq 'hacds-keeper') {
        # ---- keeper：定时任务，开机 5 分钟后首次，之后每小时一轮 ----
        # 不能做成常驻：cmd_run 是「跑一轮就退出」的设计。
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $trigger.Delay = 'PT5M'
        $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
            -RepetitionInterval (New-TimeSpan -Hours 1)
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
            -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $t -Action $action `
            -Trigger @($trigger, $t2) -Principal $principal -Settings $settings `
            -Description "hacds $t（每小时一轮，真提交续租）" | Out-Null
    } else {
        # ---- 常驻服务：开机启动 + 崩溃自动重起 ----
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $t -Action $action -Trigger $trigger `
            -Principal $principal -Settings $settings `
            -Description "hacds $t（由 install-services.ps1 注册）" | Out-Null
    }
    Write-Host "  OK   $t"
}

# =============================================================================
# 立即启动（按依赖顺序，节点先）
# =============================================================================
Write-Host "`n=== 立即启动 ===" -ForegroundColor Cyan
$order = @('hacds-node', 'hacds-tunnel', 'hacds-indexer', 'hacds-build', 'hacds-keeper')
foreach ($t in $order) {
    Start-ScheduledTask -TaskName $t
    $delay = if ($t -eq 'hacds-node') { 12 } else { 2 }
    Write-Host "  启动 $t（等待 ${delay}s）"
    Start-Sleep -Seconds $delay
}

Write-Host "`n=== 完成 ===" -ForegroundColor Green
Write-Host @"

已注册 5 个开机自启动任务（SYSTEM 账户，不依赖登录）：
  hacds-node      全节点         http://127.0.0.1:8082
  hacds-tunnel    Cloudflare 隧道
  hacds-indexer   索引器         http://127.0.0.1:8124
  hacds-build     构建服务       http://127.0.0.1:8125
  hacds-keeper    存储续租（真提交，使用私钥）

状态检查：
  Get-ScheduledTask -TaskName 'hacds-*' | Format-Table TaskName,State

日志：
  $LOGDIR\hacds-*.log

验证对外服务：
  curl https://node.hacds.com/query/block/height/latest
  curl https://indexer.hacds.com/health
  curl https://build.hacds.com/health

卸载：
  .\install-services.ps1 -Uninstall

⚠ keeper 会真的提交续租交易（消耗 HAC 手续费）。
"@
