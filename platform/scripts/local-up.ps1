[CmdletBinding()]
param(
  [switch]$Build,
  # Also start the optional Mailpit development mailbox (`mail` profile).
  [switch]$Mail
)

$platformRoot = Split-Path -Parent $PSScriptRoot
Push-Location $platformRoot
try {
  $env:DOCKER_CONFIG = Join-Path $platformRoot '.docker-cli'
  New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null
  if (-not (Test-Path '.env.local-docker')) {
    Copy-Item '.env.local-docker.example' '.env.local-docker'
    Write-Host 'Created platform/.env.local-docker from the safe local example.'
  }
  $localConfig = Get-Content '.env.local-docker' | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ConvertFrom-StringData

  $arguments = @('compose', '--env-file', '.env.local-docker', '-f', 'compose.local.yaml')
  if ($Mail) { $arguments += @('--profile', 'mail') }
  $arguments += @('up', '-d')
  if ($Build) { $arguments += '--build' }
  & docker @arguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $psArguments = @('compose', '--env-file', '.env.local-docker', '-f', 'compose.local.yaml')
  if ($Mail) { $psArguments += @('--profile', 'mail') }
  $psArguments += 'ps'
  & docker @psArguments
  Write-Host ''
  Write-Host "VEYE web: http://localhost:$($localConfig.VEYE_WEB_HOST_PORT)"
  Write-Host "VEYE API: http://localhost:$($localConfig.VEYE_API_HOST_PORT)"
  Write-Host "PostgreSQL: localhost:$($localConfig.VEYE_DB_HOST_PORT)"
  if ($Mail) {
    Write-Host "Mailpit (development mailbox): http://localhost:$($localConfig.VEYE_MAIL_WEB_HOST_PORT)"
  } else {
    Write-Host 'Mailpit not started (add -Mail to catch verification/reset emails).'
  }
  Write-Host ''
  Write-Host 'Synthetic local demo accounts (see platform/README.md): cara.hogue@demo.veye.test (admin), aditya.demo@demo.veye.test and maya.demo@demo.veye.test (members).'
} finally {
  Pop-Location
}
