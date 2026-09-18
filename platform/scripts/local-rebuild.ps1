[CmdletBinding()]
param()

$platformRoot = Split-Path -Parent $PSScriptRoot
Push-Location $platformRoot
try {
  $env:DOCKER_CONFIG = Join-Path $platformRoot '.docker-cli'
  New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null
  if (-not (Test-Path '.env.local-docker')) {
    Copy-Item '.env.local-docker.example' '.env.local-docker'
  }
  & docker compose --env-file '.env.local-docker' -f 'compose.local.yaml' build web api
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & docker compose --env-file '.env.local-docker' -f 'compose.local.yaml' up -d
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  # Safe routine cleanup: only dangling images that carry the VEYE-local label.
  & docker image prune --force --filter 'label=io.veye.local=true'
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
