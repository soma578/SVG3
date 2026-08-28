param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

node (Join-Path $Here "apply-refactor.mjs") $RepoRoot

Push-Location (Join-Path $RepoRoot "frontend")
try {
  Write-Host ""
  Write-Host "== helper unit test =="
  node --test .\test\communitySharedAdapterAssets.test.mjs

  Write-Host ""
  Write-Host "== regenerate community compatibility =="
  npm run community-layers:catalog

  Write-Host ""
  Write-Host "== community checks =="
  npm run community-layers:check

  Write-Host ""
  Write-Host "== full node tests =="
  npm test
}
finally {
  Pop-Location
}
