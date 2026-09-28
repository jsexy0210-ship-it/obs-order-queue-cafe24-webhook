param(
  [Parameter(Mandatory=$true)][string]$AppPath,
  [Parameter(Mandatory=$true)][string]$ArchivePath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$CommitSha
)
$ErrorActionPreference = "Stop"
$appRoot = (Resolve-Path $AppPath).Path
$dataPath = Join-Path $appRoot "data"
if (-not (Test-Path (Join-Path $dataPath "cardbreak.db"))) {
  throw "Existing production database not found. Refusing to create a replacement database."
}
if ((Get-Item $dataPath).LinkType) { throw "APP_PATH must reference the original production data directory." }
if ((& node --version) -cne "v22.18.0") { throw "Production SSH account must use Node.js 22.18.0." }
$pm2Command = (Get-Command pm2 -ErrorAction Stop).Source
$lock = [IO.File]::Open((Join-Path $appRoot ".mangotcg-deploy.lock"), 'OpenOrCreate', 'ReadWrite', 'None')
$originalLocation = Get-Location
try {
  $processListJson = & $pm2Command jlist 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect existing PM2 process." }
  $processes = @($processListJson | ConvertFrom-Json | Where-Object { $_.name -eq "mangotcg-admin" })
  if ($processes.Count -ne 1 -or $processes[0].pm2_env.status -ne "online") {
    throw "Expected one online mangotcg-admin process under this SSH account."
  }
  $previousCwd = $processes[0].pm2_env.pm_cwd
  $previousData = Get-Item (Join-Path $previousCwd "data")
  $actualData = if ($previousData.LinkType) { @($previousData.Target)[0] } else { $previousData.FullName }
  if ([IO.Path]::GetFullPath($actualData).TrimEnd('\') -ine [IO.Path]::GetFullPath($dataPath).TrimEnd('\')) {
    throw "Running process uses a different database. Deployment stopped."
  }
  $previousConfig = Join-Path $previousCwd "ecosystem.config.cjs"
  $previousEnv = Join-Path $previousCwd ".env.local"
  if (-not (Test-Path $previousConfig) -or -not (Test-Path $previousEnv)) {
    throw "Existing PM2 configuration or runtime environment file is missing."
  }
  $releaseRoot = Join-Path (Split-Path $appRoot -Parent) ((Split-Path $appRoot -Leaf) + "-releases")
  $release = Join-Path $releaseRoot ($CommitSha + "-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $release | Out-Null
  Expand-Archive -Path $ArchivePath -DestinationPath $release
  Set-Location $release
  Write-Host "Building isolated release $CommitSha"
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed. Existing process remains active." }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed. Existing process remains active." }

  # Build uses disposable data, never the live ledger. The running release then
  # receives a junction to the ORIGINAL data directory, not a database copy.
  $buildData = Join-Path $release "data"
  if (Test-Path $buildData) { Remove-Item $buildData -Recurse -Force }
  New-Item -ItemType Junction -Path $buildData -Target $dataPath | Out-Null
  Copy-Item $previousEnv (Join-Path $release ".env.local")

  try {
    & $pm2Command startOrReload (Join-Path $release "ecosystem.config.cjs") --only mangotcg-admin --update-env | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "PM2 release switch failed." }
    $healthy = $false
    foreach ($attempt in 1..10) {
      try {
        $response = Invoke-WebRequest "http://127.0.0.1:3000/admin/login" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
      } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $healthy) { throw "New release health check failed." }
    $afterJson = & $pm2Command jlist 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Cannot verify deployed PM2 process." }
    $after = @($afterJson | ConvertFrom-Json | Where-Object { $_.name -eq "mangotcg-admin" })
    if ($after.Count -ne 1 -or $after[0].pm2_env.pm_cwd -ine $release -or $after[0].pm2_env.status -ne "online") {
      throw "PM2 is not running the expected release."
    }
    & $pm2Command save | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "PM2 process persistence failed." }
    Write-Host "Deployment healthy: $CommitSha. Existing database and reward flags preserved."
  } catch {
    & $pm2Command startOrReload $previousConfig --only mangotcg-admin --update-env | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Deployment failed and automatic process rollback failed. Operator action required." }
    & $pm2Command save | Out-Null
    throw "Deployment failed; previous PM2 configuration restored. Database was not replaced."
  }
} finally {
  Set-Location $originalLocation
  $lock.Dispose()
}
