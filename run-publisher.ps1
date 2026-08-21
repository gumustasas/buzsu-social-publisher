$ErrorActionPreference = "Stop"
$projectPath = $PSScriptRoot
$logPath = Join-Path $projectPath "logs\publisher.log"
$lockPath = Join-Path $projectPath "logs\publisher.lock"

New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
if (Test-Path $lockPath) {
  $lockAge = (Get-Date) - (Get-Item $lockPath).LastWriteTime
  if ($lockAge.TotalMinutes -lt 10) { exit 0 }
  Remove-Item -LiteralPath $lockPath -Force
}

New-Item -ItemType File -Path $lockPath -Force | Out-Null
try {
  Push-Location $projectPath
  $env:ENABLE_LIVE_POSTING = "true"
  $env:SOCIAL_POST_LIMIT = "1"
  $env:MAX_PUBLISH_ATTEMPTS = "3"
  $env:ENABLE_FACEBOOK_STORIES = "true"
  npm run publish *>&1 | Out-File -LiteralPath $logPath -Append -Encoding utf8
} finally {
  Pop-Location
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
