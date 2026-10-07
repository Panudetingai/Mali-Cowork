# Profile Criterion bench workloads and open a flame graph (Windows-friendly).
# Usage (from repo root):
#   pwsh scripts/profile-rust-bench.ps1
#   pwsh scripts/profile-rust-bench.ps1 -Filter merge_sort
#   pwsh scripts/profile-rust-bench.ps1 -Filter schema

param(
    [string]$Filter = "merge_sort"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Tauri = Join-Path $Root "src-tauri"

Push-Location $Tauri
try {
    Write-Host "Building release bench binary..."
    cargo bench --bench perf --no-run 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $benchExe = Get-ChildItem -Path "target/release/deps" -Filter "perf-*.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $benchExe) {
        Write-Error "Could not find target/release/deps/perf-*.exe — run cargo bench --bench perf --no-run first."
    }

    $samply = Get-Command samply -ErrorAction SilentlyContinue
    if ($samply) {
        Write-Host "Recording with samply ($($benchExe.Name), filter: $Filter)..."
        samply record $benchExe.FullName $Filter
        exit $LASTEXITCODE
    }

    Write-Host @"

No 'samply' on PATH. Install it for flame graphs on Windows:

  cargo install samply

Then re-run this script. Meanwhile, run micro-benchmarks (HTML report):

  cd src-tauri
  cargo bench --bench perf -- $Filter

Criterion HTML: src-tauri/target/criterion/report/index.html

On WSL/Linux you can also use:

  cargo install flamegraph
  cargo flamegraph --bench perf -- $Filter

"@
    cargo bench --bench perf -- $Filter
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
