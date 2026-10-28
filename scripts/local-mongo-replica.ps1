# Enables a single-node replica set (rs0) on the locally installed MongoDB Windows service.
# Phase 3 workflow transitions use MongoDB transactions, which require replica-set mode.
# The script is idempotent: it backs up mongod.cfg once and skips the edit if it is already applied.
# Run it from an elevated PowerShell prompt, then call rs.initiate() against the mongod instance.

$ErrorActionPreference = 'Stop'

$cfg = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg'
if (-not (Test-Path $cfg)) { throw "mongod.cfg not found at $cfg" }

$backup = "$cfg.obsidian-backup"
if (-not (Test-Path $backup)) {
  Copy-Item $cfg $backup -Force
  Write-Host "Backup written: $backup"
} else {
  Write-Host "Backup already exists: $backup"
}

$content = Get-Content -Raw $cfg
if ($content -match '(?m)^\s*replication:') {
  Write-Host 'replication section already present - config unchanged'
} else {
  $block = "replication:`r`n  replSetName: rs0"
  if ($content -match '(?m)^#replication:\s*$') {
    $content = [regex]::Replace($content, '(?m)^#replication:\s*$', $block)
  } else {
    $content = $content.TrimEnd() + "`r`n`r`n" + $block + "`r`n"
  }
  Set-Content -Path $cfg -Value $content -NoNewline
  Write-Host 'Added replication.replSetName = rs0'
}

Restart-Service MongoDB -Force
Start-Sleep -Seconds 3
Get-Service MongoDB | Select-Object Name, Status | Format-Table
