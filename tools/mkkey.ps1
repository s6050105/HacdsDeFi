<#
.SYNOPSIS
  在 Windows 上安全录入私钥，写出文件并收紧到「仅属主」访问
  （NTFS ACL 层面等价于 chmod 0600：只有当前用户可以读写）。

.DESCRIPTION
  * 交互输入默认不回显（Read-Host -AsSecureString），私钥不进命令行、不进历史。
  * 写文件时用原子改名；写完立刻清除继承的 ACE，只留当前用户的「读取+写入」。
  * 只报告长度与路径，绝不打印私钥内容。

.PARAMETER Out
  输出文件路径。默认 %USERPROFILE%\hacash_keys\deployer.key

.PARAMETER Verify
  只检查指定文件的 ACL 是否已收紧，不写入任何东西。

.PARAMETER Check
  自检：在临时目录锁一个文件并验证 ACL 生效。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File mkkey.ps1
.EXAMPLE
  powershell -File mkkey.ps1 -Out D:\keys\hacds.key
.EXAMPLE
  powershell -File mkkey.ps1 -Verify D:\keys\hacds.key
.EXAMPLE
  # 脚本化（从管道读；注意别把它留进历史）：
  "1f2e...（64 hex）" | powershell -File mkkey.ps1 -Out D:\keys\hacds.key
#>
[CmdletBinding()]
param(
    [string]$Out,
    [string]$Verify,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

# 控制台按 UTF-8 输出，避免中文在 UTF-8 终端（Git-Bash / Windows Terminal）乱码
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

# 私钥格式：64 位十六进制（32 字节），可带 0x 前缀
$HEX64 = '^[0-9a-f]{64}$'
$ME = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name   # 形如 DOMAIN\user

function Write-Info($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host $m -ForegroundColor Green }
function Write-Warn2($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m)        { Write-Host $m -ForegroundColor Red; exit 1 }

# ---- 收紧文件：禁止继承，只留当前用户 读+写（0600 等价）----
function Protect-File([string]$Path) {
    try {
        $acl  = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)   # 断开继承并移除继承来的 ACE
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    $ME, 'Read,Write', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $Path -AclObject $acl
    } catch {
        # 退路：用 Windows 自带 icacls
        & icacls $Path /inheritance:r /grant:r "${ME}:(R,W)" | Out-Null
    }
}

# ---- 收紧目录：只属主可进（0700 等价）----
function Protect-Dir([string]$Path) {
    try {
        $acl  = New-Object System.Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    $ME, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $Path -AclObject $acl
    } catch {
        & icacls $Path /inheritance:r /grant:r "${ME}:(OI)(CI)F" | Out-Null
    }
}

# ---- 读取生效中的 ACE 主体 ----
function Get-Principals([string]$Path) {
    (Get-Acl -LiteralPath $Path).Access |
        ForEach-Object { $_.IdentityReference.Value }
}

# ---- 判定是否已私有：不得出现 Everyone / Users / Authenticated Users 等广域主体 ----
function Test-Private([string]$Path) {
    $bad = Get-Principals $Path | Where-Object {
        $_ -match '(^|\\)(Everyone|Users|INTERACTIVE)$' -or $_ -match 'Authenticated Users$'
    }
    return (-not $bad)
}

function Show-Acl([string]$Path) {
    Write-Host "  ACL:"
    (Get-Acl -LiteralPath $Path).Access | ForEach-Object {
        Write-Host ("    {0} : {1}" -f $_.IdentityReference.Value, $_.FileSystemRights)
    }
}

function Invoke-Verify([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Die "文件不存在: $Path" }
    Write-Info "检查文件: $Path"
    Show-Acl $Path
    if (Test-Private $Path) {
        Write-Ok "  OK  访问已收紧（未发现 Everyone/Users/Authenticated 等广域主体）"
        exit 0
    } else {
        Write-Warn2 "  BAD 仍可被其他主体读取，建议执行:"
        Write-Warn2 ("      icacls `"{0}`" /inheritance:r /grant:r `"{1}:(R,W)`"" -f $Path, $ME)
        exit 1
    }
}

function Invoke-Check {
    $d = Join-Path ([System.IO.Path]::GetTempPath()) ("mkkey_" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $d | Out-Null
    $f = Join-Path $d 'k'
    [System.IO.File]::WriteAllText($f, "x`n")
    Protect-File $f
    Write-Info "自检目录: $d"
    Show-Acl $f
    if (Test-Private $f) { Write-Ok "  OK  自检通过：收紧后仅属主可见" }
    else { Die "自检失败" }
    Remove-Item -Recurse -Force $d | Out-Null
    exit 0
}

# ---------------- 主流程 ----------------
if ($Check)  { Invoke-Check }
if ($Verify) { Invoke-Verify $Verify }

if (-not $Out -or $Out.Trim() -eq '') {
    $Out = Join-Path $env:USERPROFILE 'hacash_keys\deployer.key'
}
$Out = [System.IO.Path]::GetFullPath($Out)

# 读私钥：管道优先；否则交互式掩码输入（不回显）
$plain = $null
if ([Console]::IsInputRedirected) {
    Write-Info "从 stdin 读取私钥…"
    $plain = [Console]::In.ReadLine()
} else {
    Write-Info "粘贴私钥（64 位 hex，可带 0x 前缀；输入不回显），回车结束："
    $sec = Read-Host -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try   { $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# 归一化：去空白、去 0x 前缀、转小写
$key = ($plain -replace '\s','') -replace '^0[xX]',''
$key = $key.ToLower()
$plain = $null   # 尽快丢弃原始输入

if ([string]::IsNullOrEmpty($key)) { Die "未读到内容。" }
if ($key -notmatch $HEX64)         { Die "格式不对：期望 64 位十六进制（32 字节），实际长度 $($key.Length)。" }
if ($key -eq ('0' * 64))           { Die "私钥为全 0，明显无效。" }
$distinct = ([char[]]$key | Sort-Object -Unique).Count
if ($distinct -le 2) { Write-Warn2 "警告：私钥字符种类极少，可能是占位/测试值——请确认。" }

# 写文件（原子改名 + 收紧）
$dir = [System.IO.Path]::GetDirectoryName($Out)
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
Protect-Dir $dir

if (Test-Path -LiteralPath $Out) {
    Write-Warn2 "文件已存在: $Out"
    if ([Console]::IsInputRedirected) {
        Die "文件已存在（非交互模式不覆盖）。"
    }
    $ans = Read-Host "覆盖？(y/N)"
    if ($ans -notmatch '^[yY]') { Die "已取消，未改动。" }
}

$tmp = "$Out.tmp.$PID"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, ($key + "`n"), $utf8NoBom)
Protect-File $tmp
Move-Item -LiteralPath $tmp -Destination $Out -Force
Protect-File $Out
$key = $null

Write-Host ""
Write-Ok "OK  已写入: $Out"
Write-Host "  长度: 64 hex（未显示内容）"
Show-Acl $Out
if (Test-Private $Out) {
    Write-Ok ("  OK  访问已收紧：仅当前用户 {0} 可读写（0600 等价）" -f $ME)
} else {
    Write-Warn2 "  BAD 收紧未完全生效，请手动执行:"
    Write-Warn2 ("      icacls `"{0}`" /inheritance:r /grant:r `"{1}:(R,W)`"" -f $Out, $ME)
}
Write-Host ""
Write-Host "提示：Windows 下管理员账户仍可通过『取得所有权』读取任何文件——"
Write-Host "      若威胁模型包含本机管理员，请改用 BitLocker 全盘加密或独占账户。"
