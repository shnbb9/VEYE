[CmdletBinding()]
param(
  [switch]$DeepCache
)

$platformRoot = Split-Path -Parent $PSScriptRoot
$env:DOCKER_CONFIG = Join-Path $platformRoot '.docker-cli'
New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null

# This never stops containers, removes the database volume, or touches other projects.
& docker image prune --force --filter 'label=io.veye.local=true'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($DeepCache) {
  Write-Warning 'Removing only dangling VEYE-labelled build cache. The local database is preserved.'
  & docker builder prune --force --filter 'label=io.veye.local=true'
  exit $LASTEXITCODE
}
