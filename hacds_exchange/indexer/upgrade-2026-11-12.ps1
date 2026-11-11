<#
.SYNOPSIS
    2026-11-12 审计修复的服务端升级（只重启，不重建计划任务）。

.DESCRIPTION
    本次服务端改动有两项：

    ① hacds_indexer.py  —— 新增 POST /api/diamond/details
       启动参数**没变**，所以覆盖文件 + 重启进程即可。

    ② hacds_build_server.py —— 新增 --trust-proxy（修审计 C-M5）
       这个参数必须出现在启动命令行里才生效，而命令行固化在
       hacds-build.start.ps1 中 → 必须改 wrapper。

    本脚本不重跑 install-services.ps1（那会重建全部 5 个计划任务，
    节点/隧道都会中断），只做：
        覆盖 wrapper 里的那一行 + 重启对应任务

    为什么不干脆重跑 install-services：
      - 节点和 cloudflared 重建会让 api/indexer/build 三个域名短暂 502
      - keeper 会等到下一个整点才跑（它本来就是定时任务）
      - 这里只需要改两行，没必要冒中断风险

.USAGE
    # 1) 先把两个 .py 和本脚本拷到 $BASE（C:\Users\Administrator\Desktop\oracle）
    # 2) 右键 → 以管理员身份运行，或：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\upgrade-2026-11-12.ps1

    加 -DryRun 只看会改什么，不动文件。
#>
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$BASE = 'C:\Users\Administrator\Desktop\oracle'

function Say($m) { Write-Host $m }

# ---------------------------------------------------------------------------
# 0. 前置检查
# ---------------------------------------------------------------------------
Say "=== 2026-11-12 审计修复升级 ==="
if (-not (Test-Path $BASE)) { throw "找不到 $BASE" }

foreach ($f in @('hacds_indexer.py', 'hacds_build_server.py')) {
    if (-not (Test-Path (Join-Path $BASE $f))) { throw "缺少 $f，请先把文件拷到 $BASE" }
}

# 确认拿到的是新版：新版才有这两个标记
$idxTxt = Get-Content (Join-Path $BASE 'hacds_indexer.py') -Raw
$bldTxt = Get-Content (Join-Path $BASE 'hacds_build_server.py') -Raw
if ($idxTxt -notmatch 'def do_POST') {
    throw "hacds_indexer.py 不是新版（没有 do_POST）—— 覆盖后再运行本脚本"
}
if ($bldTxt -notmatch 'trust.proxy') {
    throw "hacds_build_server.py 不是新版（没有 --trust-proxy）"
}
Say "✔ 两个 .py 都是新版"

# ---------------------------------------------------------------------------
# 1. 构建服务 wrapper：补 --trust-proxy
# ---------------------------------------------------------------------------
$bldWrapper = Join-Path $BASE 'hacds-build.start.ps1'
if (-not (Test-Path $bldWrapper)) {
    Say "⚠ 找不到 $bldWrapper —— 构建服务未安装？跳过这一步"
} else {
    $w = Get-Content $bldWrapper -Raw
    if ($w -match '--trust-proxy') {
        Say "✔ 构建服务 wrapper 已有 --trust-proxy，无需修改"
    } else {
        # 在 --txbuild "...\hacds_txbuild.exe" 之后插入。
        # 用正则只在 --txbuild 的参数后追加，不动其它行。
        # ⚠ 单引号包住替换串：双引号里 PowerShell 会把 $1 当自己的变量展开成空。
        $new = $w -replace '(hacds_txbuild\.exe"\s*)', '${1}--trust-proxy '
        if ($new -eq $w) {
            Say "⚠ 没找到 --txbuild 参数，请手工在启动命令里加 --trust-proxy"
        } else {
            if ($DryRun) {
                Say "[dry-run] 将修改 $bldWrapper：追加 --trust-proxy"
            } else {
                Copy-Item $bldWrapper "$bldWrapper.bak-20261112" -Force
                Set-Content -Path $bldWrapper -Value $new -Encoding UTF8
                Say "✔ 已修改 $bldWrapper（备份 .bak-20261112）"
            }
        }
    }
}

# ---------------------------------------------------------------------------
# 2. 重启两个服务
# ---------------------------------------------------------------------------
foreach ($t in @('hacds-indexer', 'hacds-build')) {
    $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if (-not $task) { Say "⚠ 计划任务 $t 不存在，跳过"; continue }
    if ($DryRun) { Say "[dry-run] 将重启 $t"; continue }

    Say "重启 $t …"
    # 先停：常驻任务的 wrapper 是一个 powershell 进程，Stop 会连子进程一起收掉
    Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    # 保险：wrapper 被停但 python 子进程可能还在，按脚本名精确匹配杀掉
    foreach ($py in @('hacds_indexer.py', 'hacds_build_server.py')) {
        Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*$py*" } |
            ForEach-Object {
                Say "  结束残留进程 PID=$($_.ProcessId) ($py)"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }
    Start-ScheduledTask -TaskName $t
    Say "✔ $t 已启动"
}

# ---------------------------------------------------------------------------
# 3. 自检
# ---------------------------------------------------------------------------
Say ""
Say "=== 自检（等服务起来，最多 40 秒）==="
if ($DryRun) { Say "[dry-run] 跳过自检"; return }

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-RestMethod 'http://127.0.0.1:8124/health' -TimeoutSec 3
        if ($r.ok) { Say "✔ 索引器在线，高度=$($r.head)"; $ok = $true; break }
    } catch { }
}
if (-not $ok) { Say "✘ 索引器未响应，查看 $BASE\logs\hacds-indexer.log" }

# 新端点：POST 应该返回 JSON（不再是 501）
try {
    $body = '{"names":["WTYUIA"]}'
    $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:8124/api/diamond/details' `
        -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8
    Say "✔ POST /api/diamond/details -> $($resp.StatusCode) $($resp.Content)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 501) {
        Say "✘ 仍是 501（不支持 POST）—— 索引器没换成新文件，或进程没重启"
    } else {
        Say "⚠ 端点返回 $code：$($_.Exception.Message)"
    }
}

try {
    $h = Invoke-RestMethod 'http://127.0.0.1:8125/health' -TimeoutSec 5
    if ($h.ok) { Say "✔ 构建服务在线 version=$($h.version)" }
} catch { Say "✘ 构建服务未响应，查看 $BASE\logs\hacds-build.log" }

Say ""
Say "完成。请再确认公网："
Say "  curl -X POST https://indexer.hacds.com/api/diamond/details -H 'Content-Type: application/json' -d '{`"names`":[`"WTYUIA`"]}'"
Say "  （返回 {\"ret\":0,...} 即成功；501 说明隧道那头还是旧进程）"
