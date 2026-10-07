# วิธีใช้ (เปิดแอป Mali Cowork ไว้ก่อน แล้วรัน):
#   powershell -ExecutionPolicy Bypass -File .\mali-threads.ps1 -Seconds 60
# ระหว่างที่สคริปต์ทำงาน ให้ทำ scenario ที่ต้องการวัดในแอป
param(
  [int]$Seconds = 60,
  [double]$Interval = 1,
  [string]$Match = "Mali",          # กรอง msedgewebview2 ให้เหลือเฉพาะของแอปนี้
  [string]$Out = "mali-threads.csv",
  [switch]$Live,                    # โหมด realtime: โชว์ Top live ทุก Interval จนกว่าจะกด Ctrl+C
  [int]$Top = 15,                   # จำนวนแถวที่โชว์ในโหมด Live
  [double]$CritPct = 15,            # เกณฑ์แดงเข้ม (% ของ 1 core ในช่วง Interval)
  [double]$HighPct = 4              # เกณฑ์แดงอ่อน (% ของ 1 core ในช่วง Interval)
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ThrUtil {
  [DllImport("kernel32.dll")] static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
  [DllImport("kernel32.dll")] static extern int GetThreadDescription(IntPtr h, out IntPtr desc);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  public static string Name(int tid) {
    IntPtr h = OpenThread(0x0800, false, (uint)tid);
    if (h == IntPtr.Zero) return "";
    try {
      IntPtr d;
      if (GetThreadDescription(h, out d) >= 0 && d != IntPtr.Zero) {
        string s = Marshal.PtrToStringUni(d);
        LocalFree(d);
        return s;
      }
    } finally { CloseHandle(h); }
    return "";
  }
}
"@

$t = @{}        # key = pid:tid  -> สะสม CPU วินาที
$last = @{}     # key -> CPU time ล่าสุด
$nameCache = @{} # tid -> thread description (cache ไม่ให้เรียก DLL ทุกรอบ)
$sw = [Diagnostics.Stopwatch]::StartNew()

function Get-Role($c) {
  $cmd = $c.CommandLine
  if ($cmd -and $cmd -match '--type=([\w-]+)') { return $Matches[1] }
  if ($c.Name -like 'msedgewebview2*') { return 'webview-browser' }
  if ($c.Name -like 'mali-mcp-runner*') { return 'sidecar' }
  if ($c.Name -match 'crashpad') { return 'crashpad-handler' }
  return 'rust-app'
}

function Get-StatusColor($pct) {
  if ($pct -ge $CritPct) { return 'Red' }
  if ($pct -ge $HighPct) { return 'DarkRed' }
  if ($pct -ge 1) { return 'Yellow' }
  return $null
}

function Collect-Tick($tickDelta, [ref]$liveRows) {
  $procs = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -match '^(Mali|mali-mcp-runner|msedgewebview2)' }
  $tick = @()
  foreach ($c in $procs) {
    if ($c.Name -like 'msedgewebview2*' -and $c.CommandLine -notmatch $Match) { continue }
    $p = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $role = Get-Role $c
    foreach ($th in $p.Threads) {
      try { $cpu = $th.TotalProcessorTime.TotalSeconds } catch { continue }
      $key = "$($p.Id):$($th.Id)"
      if (-not $t.ContainsKey($key)) {
        $t[$key] = [pscustomobject]@{ Role=$role; Pid=$p.Id; Tid=$th.Id; Name=''; CpuSec=0.0 }
        $last[$key] = $cpu   # ฐานเริ่มต้น ไม่นับ CPU ก่อนเริ่มวัด
        if (-not $nameCache.ContainsKey($th.Id)) {
          $n = [ThrUtil]::Name($th.Id)
          $nameCache[$th.Id] = $n
        }
        $t[$key].Name = $nameCache[$th.Id]
      }
      $delta = $cpu - $last[$key]
      if ($delta -lt 0) { $delta = 0 }  # กัน thread reuse / counter reset
      if ($delta -gt 0) { $t[$key].CpuSec += $delta }
      $last[$key] = $cpu
      if ($tickDelta -gt 0 -and $delta -gt 0) {
        $pct = $delta / $tickDelta * 100
        $nm = $t[$key].Name
        if (-not $nm) { $nm = '(no name)' }
        $tick += [pscustomobject]@{
          Role=$role; Pid=$p.Id; Tid=$th.Id; Name=$nm
          Delta=[math]::Round($delta,3); Pct=[math]::Round($pct,1)
        }
      }
    }
  }
  $liveRows.Value = $tick | Sort-Object Pct -Descending
}

function Show-Live($tickRows, $elapsedSec) {
  Clear-Host
  Write-Host "Mali threads LIVE — elapsed $([math]::Round($elapsedSec))s | interval ${Interval}s | Top $Top | แดงเข้ม>=${CritPct}% แดงอ่อน>=${HighPct}% | Ctrl+C เพื่อหยุด+บันทึก" -ForegroundColor Cyan
  Write-Host ("{0,-14} {1,-7} {2,-7} {3,-34} {4,7} {5,8}" -f "Role","Pid","Tid","Name","Delta(s)","%1core")
  $i = 0
  foreach ($r in $tickRows) {
    if (++$i -gt $Top) { break }
    $color = Get-StatusColor $r.Pct
    $line = ("{0,-14} {1,-7} {2,-7} {3,-34} {4,7} {5,8}" -f $r.Role,$r.Pid,$r.Tid,$r.Name,$r.Delta,$r.Pct)
    if ($color) { Write-Host $line -ForegroundColor $color }
    else { Write-Host $line }
  }
  if ($i -eq 0) { Write-Host "(idle — ไม่มี thread ใช้ CPU ในช่วงนี้)" -ForegroundColor DarkGray }
}

function Export-Result($elapsed) {
  $rows = $t.Values | ForEach-Object {
    [pscustomobject]@{
      Role = $_.Role; Pid = $_.Pid; Tid = $_.Tid
      Name = if ($_.Name) { $_.Name } else { '(no name)' }
      CpuSec = [math]::Round($_.CpuSec, 2)
      AvgPctOfOneCore = [math]::Round($_.CpuSec / $elapsed * 100, 1)
    }
  } | Sort-Object CpuSec -Descending
  $rows | Export-Csv $Out -NoTypeInformation -Encoding UTF8
  Write-Host "`n=== รวมตามส่วนของแอป (ช่วง $([math]::Round($elapsed)) วินาที) ==="
  $rows | Group-Object Role | ForEach-Object {
    [pscustomobject]@{
      Role = $_.Name
      CpuSec = [math]::Round(($_.Group | Measure-Object CpuSec -Sum).Sum, 2)
      AvgPctOfOneCore = [math]::Round(($_.Group | Measure-Object AvgPctOfOneCore -Sum).Sum, 1)
    }
  } | Sort-Object CpuSec -Descending | Format-Table -AutoSize
  Write-Host "=== 25 เธรดที่กิน CPU มากสุด ==="
  $rows | Select-Object -First 25 | Format-Table -AutoSize
  Write-Host "บันทึกทั้งหมดที่: $Out"
}

if ($Live) {
  Write-Host "โหมด LIVE realtime ทุก ${Interval}s — ทำ scenario ในแอปได้เลย กด Ctrl+C เพื่อหยุด+บันทึก $Out"
  $liveTick = $null
  try {
    while ($true) {
      $tickStart = [Diagnostics.Stopwatch]::StartNew()
      Start-Sleep -Milliseconds ([int]($Interval * 1000))
      Collect-Tick $tickStart.Elapsed.TotalSeconds ([ref]$liveTick)
      Show-Live $liveTick $sw.Elapsed.TotalSeconds
    }
  } finally {
    Export-Result $sw.Elapsed.TotalSeconds
  }
  return
}

Write-Host "กำลังเก็บข้อมูล $Seconds วินาที... ทำ scenario ในแอปได้เลย"
while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
  $tickStart = [Diagnostics.Stopwatch]::StartNew()
  Collect-Tick 0 ([ref]$null)
  $wait = [int]($Interval * 1000) - [int]$tickStart.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}

Export-Result $sw.Elapsed.TotalSeconds