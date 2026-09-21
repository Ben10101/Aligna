$ErrorActionPreference = 'Stop'

function Get-PrincipalList {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ResolvedPath
  )

  $principals = New-Object System.Collections.Generic.List[string]
  $principals.Add(([System.Security.Principal.WindowsIdentity]::GetCurrent().Name))
  $principals.Add('BUILTIN\Administrators')
  $principals.Add('NT AUTHORITY\SYSTEM')

  try {
    $owner = (Get-Acl -LiteralPath $ResolvedPath).Owner
    if ($owner) {
      $principals.Add($owner)
    }
  } catch {
    Write-Host "Could not resolve owner for $ResolvedPath. Continuing with current identity, Administrators and SYSTEM."
  }

  return $principals | Select-Object -Unique
}

function Protect-Path {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath
  )

  if (-not (Test-Path -LiteralPath $TargetPath -ErrorAction SilentlyContinue)) {
    Write-Host "Skipping missing path: $TargetPath"
    return
  }

  $resolved = (Resolve-Path -LiteralPath $TargetPath).Path
  Write-Host "Hardening $resolved"
  $principals = Get-PrincipalList -ResolvedPath $resolved

  icacls $resolved /inheritance:r | Out-Null
  foreach ($principal in $principals) {
    icacls $resolved /grant:r "${principal}:(F)" | Out-Null
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

Protect-Path -TargetPath (Join-Path $repoRoot '.env')
Protect-Path -TargetPath (Join-Path $repoRoot 'backend\runtime')
Protect-Path -TargetPath (Join-Path $repoRoot 'backend\runtime\audit-log.ndjson')

Write-Host 'Local permission hardening completed.'
