[CmdletBinding()]
param()

$platformRoot = Split-Path -Parent $PSScriptRoot
Push-Location $platformRoot
try {
  $env:DOCKER_CONFIG = Join-Path $platformRoot '.docker-cli'
  New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null
  if (-not (Test-Path '.env.local-docker')) {
    Write-Error 'platform/.env.local-docker is missing. Run scripts/local-up.ps1 first.'
    exit 1
  }
  # --profile mail so the optional mailbox container stops with the stack.
  & docker compose --env-file '.env.local-docker' -f 'compose.local.yaml' --profile mail down
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
