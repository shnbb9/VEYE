[CmdletBinding()]
param()

Write-Warning 'This permanently deletes all LOCAL VEYE PostgreSQL data in the veye-local-pgdata volume.'
$confirmation = Read-Host 'Type RESET VEYE LOCAL DB to continue'
if ($confirmation -ne 'RESET VEYE LOCAL DB') {
  Write-Host 'Database reset cancelled.'
  exit 0
}

$platformRoot = Split-Path -Parent $PSScriptRoot
Push-Location $platformRoot
try {
  $env:DOCKER_CONFIG = Join-Path $platformRoot '.docker-cli'
  New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null
  if (Test-Path '.env.local-docker') {
    & docker compose --env-file '.env.local-docker' -f 'compose.local.yaml' down
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  & docker volume rm 'veye-local-pgdata'
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
