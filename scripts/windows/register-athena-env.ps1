[CmdletBinding()]
param(
  [string]$AppRoot,
  [string]$AthenaHome = [IO.Path]::Combine($HOME, ".athena"),
  [switch]$SkipPathUpdate,
  [string]$AthenaNode,
  [string]$AnthropicApiKey,
  [string]$AgentHubUrl,
  [string]$AgentHubKey
)

$ErrorActionPreference = "Stop"

function Set-UserEnvironmentVariable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  Set-Item -Path "Env:$Name" -Value $Value
}

function Add-ToUserPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathToAdd
  )

  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @()
  if (-not [string]::IsNullOrWhiteSpace($current)) {
    $entries = $current.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  if ($entries -notcontains $PathToAdd) {
    $updated = @($entries + $PathToAdd) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Resolve-NodePath {
  param(
    [string]$PreferredPath
  )

  if ($PreferredPath) {
    return (Resolve-Path $PreferredPath).Path
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  return $null
}

if (-not $AppRoot) {
  $AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$resolvedAppRoot = (Resolve-Path $AppRoot).Path
$releaseDir = Join-Path $resolvedAppRoot "release"
$resolvedNodePath = Resolve-NodePath -PreferredPath $AthenaNode

Set-UserEnvironmentVariable -Name "ATHENA_APP_ROOT" -Value $resolvedAppRoot
Set-UserEnvironmentVariable -Name "ATHENA_HOME" -Value $AthenaHome

if ($resolvedNodePath) {
  Set-UserEnvironmentVariable -Name "ATHENA_NODE" -Value $resolvedNodePath
}

if (-not $SkipPathUpdate -and (Test-Path $releaseDir)) {
  Add-ToUserPath -PathToAdd $releaseDir
}

if ($AnthropicApiKey) {
  Set-UserEnvironmentVariable -Name "ANTHROPIC_API_KEY" -Value $AnthropicApiKey
}

if ($AgentHubUrl) {
  Set-UserEnvironmentVariable -Name "AGENTHUB_URL" -Value $AgentHubUrl
}

if ($AgentHubKey) {
  Set-UserEnvironmentVariable -Name "AGENTHUB_KEY" -Value $AgentHubKey
}

Write-Host "Updated user environment variables:"
Write-Host "  ATHENA_APP_ROOT=$resolvedAppRoot"
Write-Host "  ATHENA_HOME=$AthenaHome"
if ($resolvedNodePath) {
  Write-Host "  ATHENA_NODE=$resolvedNodePath"
} else {
  Write-Host "  ATHENA_NODE=(not set; install Node.js 20+ or pass -AthenaNode)"
}
if (-not $SkipPathUpdate) {
  Write-Host "  PATH includes $releaseDir (if present)"
}
if ($AnthropicApiKey) {
  Write-Host "  ANTHROPIC_API_KEY=***"
}
if ($AgentHubUrl) {
  Write-Host "  AGENTHUB_URL=$AgentHubUrl"
}
if ($AgentHubKey) {
  Write-Host "  AGENTHUB_KEY=***"
}

Write-Host ""
Write-Host "Open a new PowerShell session before using the persisted values in other terminals."
