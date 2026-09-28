$ErrorActionPreference = "Stop"

# Exercise the actual deployment environment-writing step with fake credentials
# and temporary files. No production API, database, or balance is accessed.
$workflow = Get-Content (Join-Path $PSScriptRoot "../.github/workflows/deploy-self-hosted.yml") -Raw
$match = [regex]::Match($workflow, '(?ms)^        run: \|\r?\n(?<script>.*?)(?=^      - name:)')
if (-not $match.Success) { throw "Deployment preparation step not found" }
$prepareScript = [scriptblock]::Create(($match.Groups["script"].Value -replace '(?m)^          ', ''))
$names = @(
  "GITHUB_WORKSPACE", "ADMIN_PRIMARY_ID", "ADMIN_PRIMARY_PASSWORD",
  "ADMIN_SECONDARY_ID", "ADMIN_SECONDARY_PASSWORD", "CAFE24_CLIENT_ID",
  "CAFE24_CLIENT_SECRET", "CAFE24_MALL_ID", "CAFE24_REDIRECT_URI",
  "CAFE24_REWARD_LIVE_ENABLED", "CAFE24_NATIVE_REWARDS_DISABLED",
  "CAFE24_TOKEN_ENCRYPTION_KEY", "CAFE24_WEBHOOK_TOKEN"
)
$saved = @{}
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mangotcg-reward-guard-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testDirectory | Out-Null

try {
  foreach ($name in $names) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, "test-placeholder")
  }
  $env:GITHUB_WORKSPACE = $testDirectory
  $envFile = Join-Path $testDirectory ".env.local"
  $cases = @(
    @{ Name = "first activation without file"; Old = $null; Live = "true"; Native = "true"; Block = $true },
    @{ Name = "new native flag with live enabled"; Old = "CAFE24_REWARD_LIVE_ENABLED=true"; Live = "true"; Native = "true"; Block = $true },
    @{ Name = "first activation from disabled"; Old = "CAFE24_REWARD_LIVE_ENABLED=false`nCAFE24_NATIVE_REWARDS_DISABLED=false"; Live = "true"; Native = "true"; Block = $true },
    @{ Name = "case-sensitive prior flags"; Old = "CAFE24_REWARD_LIVE_ENABLED=TRUE`nCAFE24_NATIVE_REWARDS_DISABLED=true"; Live = "true"; Native = "true"; Block = $true },
    @{ Name = "ordinary disabled deployment"; Old = $null; Live = "false"; Native = "false"; Block = $false },
    @{ Name = "native confirmation without payout"; Old = $null; Live = "false"; Native = "true"; Block = $false },
    @{ Name = "native guard still disabled"; Old = $null; Live = "true"; Native = "false"; Block = $false },
    @{ Name = "existing live deployment"; Old = "CAFE24_REWARD_LIVE_ENABLED=true`nCAFE24_NATIVE_REWARDS_DISABLED=true"; Live = "true"; Native = "true"; Block = $false }
  )
  foreach ($case in $cases) {
    Remove-Item $envFile -ErrorAction SilentlyContinue
    if ($null -ne $case.Old) { [IO.File]::WriteAllText($envFile, $case.Old) }
    $env:CAFE24_REWARD_LIVE_ENABLED = $case.Live
    $env:CAFE24_NATIVE_REWARDS_DISABLED = $case.Native
    $blocked = $false
    try { & $prepareScript | Out-Null } catch { $blocked = $true }
    if ($blocked -ne $case.Block) { throw "Unexpected guard result: $($case.Name)" }
    if ($case.Block) {
      if ($null -eq $case.Old) {
        if (Test-Path $envFile) { throw "Blocked deployment created environment file" }
      } elseif ([IO.File]::ReadAllText($envFile) -cne $case.Old) {
        throw "Blocked deployment changed environment file"
      }
    } else {
      $lines = [IO.File]::ReadAllLines($envFile)
      if ($lines -cnotcontains "CAFE24_REWARD_LIVE_ENABLED=$($case.Live)" -or
          $lines -cnotcontains "CAFE24_NATIVE_REWARDS_DISABLED=$($case.Native)") {
        throw "Allowed deployment lost reward flags"
      }
    }
    Write-Host "PASS: $($case.Name)"
  }
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
  Remove-Item $testDirectory -Recurse -Force
}
