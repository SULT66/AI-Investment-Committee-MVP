<#
.SYNOPSIS
  Applies an AIC update archive: unpack, build, commit, push.

.DESCRIPTION
  Replaces the manual copy/build/commit/push cycle with one command.

  Deliberately cautious:
   - refuses to run outside the project folder
   - warns about changes you already had before it touches anything
   - builds BEFORE committing, so a broken update never reaches Azure
   - never force-pushes, never rewrites history

  ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI, so any
  accented or typographic character would corrupt the script.

.EXAMPLE
  .\update.ps1 aic-report.zip
  .\update.ps1 aic-report.zip -Message "Committee report"
  .\update.ps1 aic-report.zip -NoPush
  .\update.ps1 -BuildOnly
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Archive,

  [string]$Message,

  [switch]$NoPush,

  [switch]$BuildOnly
)

$ErrorActionPreference = "Stop"

function Write-Step { param($Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Ok   { param($Text) Write-Host "  OK   $Text" -ForegroundColor Green }
function Write-Warn { param($Text) Write-Host "  !    $Text" -ForegroundColor Yellow }
function Fail       { param($Text) Write-Host "`n  X    $Text`n" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- sanity
Write-Step "Checking the project"

if (-not (Test-Path "package.json")) {
  Fail "No package.json here. Run this from the project folder: cd C:\DeploingCI_CD\AI-Investment-Committee-MVP"
}

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
if ($pkg.name -ne "ai-investment-committee") {
  Fail "This is '$($pkg.name)', not the AIC project. Wrong folder?"
}
if (-not (Test-Path ".git")) { Fail "This folder is not a git repository." }
Write-Ok "AI Investment Committee project found"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Ok "On branch '$branch'"

$dirtyBefore = @(git status --porcelain | Where-Object { $_ -notmatch 'package-lock|tsbuildinfo' })
if ($dirtyBefore.Count -gt 0 -and -not $BuildOnly) {
  Write-Warn "You already have $($dirtyBefore.Count) uncommitted change(s):"
  $dirtyBefore | Select-Object -First 10 | ForEach-Object { Write-Host "         $_" }
  $answer = Read-Host "  Include them in this commit? (y/n)"
  if ($answer -ne "y") { Fail "Stopped. Commit or stash those changes first." }
}

# ---------------------------------------------------------------- unpack
if ($Archive) {
  Write-Step "Unpacking $Archive"

  if (-not (Test-Path $Archive)) {
    $inDownloads = Join-Path "$env:USERPROFILE\Downloads" $Archive
    if (Test-Path $inDownloads) {
      $Archive = $inDownloads
      Write-Ok "Found it in Downloads"
    }
    else {
      Fail "Archive not found: $Archive (also looked in $env:USERPROFILE\Downloads)"
    }
  }

  $staging = Join-Path $env:TEMP ("aic-update-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Path $staging -Force | Out-Null

  try {
    Expand-Archive -LiteralPath $Archive -DestinationPath $staging -Force

    $allowed = @("app", "lib", "components", "public", "docs", "prisma", ".github")

    # some archives wrap everything in a single folder; step into it
    $roots = @(Get-ChildItem -LiteralPath $staging)
    if ($roots.Count -eq 1 -and $roots[0].PSIsContainer -and ($allowed -notcontains $roots[0].Name)) {
      $staging = $roots[0].FullName
    }

    $copied = 0
    foreach ($item in Get-ChildItem -LiteralPath $staging) {
      if ($item.PSIsContainer -and ($allowed -contains $item.Name)) {
        Copy-Item -LiteralPath $item.FullName -Destination "." -Recurse -Force
        $files = @(Get-ChildItem -LiteralPath $item.FullName -Recurse -File)
        $copied = $copied + $files.Count
        Write-Ok "$($item.Name)/ ($($files.Count) file(s))"
      }
      elseif (-not $item.PSIsContainer) {
        Write-Warn "Skipped loose file '$($item.Name)'"
      }
      else {
        Write-Warn "Skipped unexpected folder '$($item.Name)'"
      }
    }

    if ($copied -eq 0) { Fail "Nothing was copied. Is this the right archive?" }
    Write-Ok "$copied file(s) applied"
  }
  finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------- build
Write-Step "Building (a failure here stops the deploy)"

npm run build
if ($LASTEXITCODE -ne 0) {
  Fail "Build failed. Nothing was committed, so the live site is untouched. Fix the error above and retry."
}
Write-Ok "Build succeeded"

if ($BuildOnly) {
  Write-Host "`nBuild-only run finished. Nothing committed.`n" -ForegroundColor Cyan
  exit 0
}

# ---------------------------------------------------------------- commit
Write-Step "Committing"

$changes = @(git status --porcelain)
if ($changes.Count -eq 0) {
  Write-Warn "No changes to commit. The project already matches this update."
  exit 0
}

if (-not $Message) {
  if ($Archive) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($Archive)
    $stem = $stem -replace '^aic-', ''
    $stem = $stem -replace '-', ' '
    $Message = (Get-Culture).TextInfo.ToTitleCase($stem)
  }
  else {
    $Message = "Update"
  }
}

git add -A
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Fail "Commit failed. See the message above." }
Write-Ok "Committed: $Message"

# ---------------------------------------------------------------- push
if ($NoPush) {
  Write-Host "`nCommitted locally. Run 'git push' when you are ready.`n" -ForegroundColor Cyan
  exit 0
}

Write-Step "Pushing to GitHub"
git push
if ($LASTEXITCODE -ne 0) {
  Write-Warn "Push rejected. The remote has commits you do not have locally."
  Write-Host "         Run: git pull    then: git push" -ForegroundColor Yellow
  exit 1
}
Write-Ok "Pushed"

Write-Host ""
Write-Host "Done. Azure is building now." -ForegroundColor Green
Write-Host "  Watch: https://github.com/SULT66/AI-Investment-Committee-MVP/actions"
Write-Host "  Then open the site with Ctrl+F5 (a normal refresh serves the cached version)."
Write-Host ""
