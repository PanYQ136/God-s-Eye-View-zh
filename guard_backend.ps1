# GodsEyeView backend guard - runs every minute via Task Scheduler.
# Probes the local GEV server; if it is down, restarts the GodsEyeViewBackend task.
# Keep this file pure ASCII (no BOM): PowerShell on this box misreads UTF-8 without BOM.
$ErrorActionPreference = 'SilentlyContinue'
$log = 'D:\Hermes\gev-guard.log'
$probe = 'http://127.0.0.1:4173/api/cyclones'

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $log -Value $line -Encoding ASCII
    # keep the log bounded
    $fi = Get-Item $log
    if ($fi.Length -gt 512KB) {
        $tail = Get-Content $log -Tail 500
        Set-Content -Path $log -Value $tail -Encoding ASCII
    }
}

$ok = $false
try {
    $r = Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 6
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { $ok = $true }
} catch {
    $ok = $false
}

if (-not $ok) {
    Write-Log "PROBE FAIL - restarting GodsEyeViewBackend"
    schtasks /run /tn "GodsEyeViewBackend" | Out-Null
    Start-Sleep -Seconds 12
    $ok2 = $false
    try {
        $r2 = Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 8
        if ($r2.StatusCode -ge 200 -and $r2.StatusCode -lt 400) { $ok2 = $true }
    } catch { $ok2 = $false }
    if ($ok2) { Write-Log "RECOVERED" } else { Write-Log "STILL DOWN after restart" }
}
