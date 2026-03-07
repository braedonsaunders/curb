$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Write-Log {
  param([string]$Message)
  Write-Host "[curb] $Message"
}

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue

  if ($node -and $npm) {
    return
  }

  Write-Log "Node.js was not found. Installing it first..."

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install nodejs-lts -y
  } else {
    throw "Unable to install Node.js automatically. Install Node.js 20+ and re-run this launcher."
  }

  $env:Path = "$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Programs\nodejs;$env:Path"
}

Ensure-Node

Set-Location $RootDir
& node "$RootDir\scripts\launch-curb.mjs"

if ($LASTEXITCODE -ne 0) {
  throw "Launcher failed with exit code $LASTEXITCODE."
}
