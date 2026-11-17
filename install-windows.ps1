# Installs this Herdr setup on Windows. Safe to run again: it changes only what differs.
#   .\install-windows.ps1                 install
#   .\install-windows.ps1 -DryRun         say what would change
#   .\install-windows.ps1 -NoApp          files, keys and settings only
#   .\install-windows.ps1 -AppHome <dir>  a Herdr home somewhere else
#   .\install-windows.ps1 -Backups        list the backups
#   .\install-windows.ps1 -Restore        put the newest backup's files back
#   .\install-windows.ps1 -Restore -Backup <name>   put another backup's files back
#
# The same steps as scripts/install.py (macOS and Linux); keep the two in step:
#   files     home\mods, home\layouts, home\themes are copied over when a file is
#             missing or differs. A file it replaces is kept under
#             <home>\.sashin92-herdr-backup\<time>\ first.
#   keys      home\keys.json is merged into the home's keys.json: its keys are set,
#             the rest stay. Whatever key closes a tab asks first from now on, and
#             a key this sets is taken out of the more specific "terminal" section.
#   settings  home\settings.json is merged into the home's settings.json.
#   app       with Herdr running: each mod is checked, the two always-on mods are
#             opened once per layout, the theme is picked and the layout is shown.
#
# A restore touches only files that differ and keeps what it replaces as a new
# backup, so it can be undone the same way. Files a run added stay where they are.

[CmdletBinding()]
param(
  [string]$AppHome,
  [switch]$DryRun,
  [switch]$NoApp,
  [switch]$Backups,
  [switch]$Restore,
  [string]$Backup
)

$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Repo 'home'
$Copied = @('mods', 'layouts', 'themes')
$ReplacedActions = @{ 'tab.close' = 'mod.open:confirm-close-tab' }
# Settings Windows doesn't read.
$SkippedSettings = @('option_as_alt')
$Layout = 'main-gap0'
$Theme = 'tomorrow-night'
$Kept = @('zoom-badge', 'agent-jump')
$KeptLayouts = @('main', $Layout)

$script:Changes = 0
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Say([string]$Mark, [string]$Text) { Write-Host "  $Mark $Text" }
function Changed([string]$Text) {
  $script:Changes++
  if ($DryRun) { Say '~' $Text } else { Say '+' $Text }
}

function Read-Json([string]$Path) {
  [System.IO.File]::ReadAllText($Path, $Utf8) | ConvertFrom-Json
}

function Write-Json([string]$Path, $Value) {
  if ($DryRun) { return }
  $tmp = "$Path.tmp-sashin92"
  [System.IO.File]::WriteAllText($tmp, (($Value | ConvertTo-Json -Depth 32) + "`n"), $Utf8)
  Move-Item -Force -LiteralPath $tmp -Destination $Path
}

# The object's shape as text, to tell whether a merge changed anything.
function Shape($Value) { $Value | ConvertTo-Json -Depth 32 -Compress }

# Whether a setting already is what we want. Herdr writes whole numbers back
# with a decimal point (1 becomes 1.0), so a setting is compared by value, not
# as text: that made every run replace settings.json.
function Same($A, $B) {
  if (($A -is [bool]) -or ($B -is [bool])) { return ($A -is [bool]) -and ($B -is [bool]) -and ($A -eq $B) }
  if (($A -is [pscustomobject]) -or ($B -is [pscustomobject]) -or ($A -is [array]) -or ($B -is [array])) { return (Shape $A) -eq (Shape $B) }
  return $A -eq $B
}

function Save-Replaced([string]$Path) {
  if ($DryRun -or -not (Test-Path -LiteralPath $Path)) { return }
  $rel = $Path.Substring($HerdrHome.Length).TrimStart('\', '/')
  $saved = Join-Path $script:BackupDir $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $saved) | Out-Null
  Copy-Item -LiteralPath $Path -Destination $saved -Force
}

function Has($Object, [string]$Name) {
  $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]
}
function Set-Prop($Object, [string]$Name, $Value) {
  if (Has $Object $Name) { $Object.PSObject.Properties[$Name].Value = $Value }
  else { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}

# --- where Herdr keeps its files ---
$candidates = @()
if ($AppHome) { $candidates += $AppHome }
elseif ($env:HERDR_APP_HOME) { $candidates += $env:HERDR_APP_HOME }
else {
  $candidates += (Join-Path $HOME '.config\herdr-app')
  if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'herdr-app') }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'herdr-app') }
}
$HerdrHome = $null
foreach ($c in $candidates) {
  if (Test-Path -LiteralPath (Join-Path $c 'keys.json')) { $HerdrHome = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $HerdrHome) {
  Write-Error ("No Herdr home with a keys.json in: " + ($candidates -join ', ') + ". Start Herdr once so it makes its home, or pass -AppHome <dir>.")
  exit 1
}
$BackupRoot = Join-Path $HerdrHome '.sashin92-herdr-backup'
# A folder of its own: a run in the same second as another (a restore right after an
# install) must not keep its files in the backup it is reading from.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stampName = $stamp
$stampCount = 1
while (Test-Path -LiteralPath (Join-Path $BackupRoot $stampName)) { $stampCount++; $stampName = "$stamp-$stampCount" }
$script:BackupDir = Join-Path $BackupRoot $stampName
if ($DryRun) { Write-Host "Herdr home: $HerdrHome  (dry run)" } else { Write-Host "Herdr home: $HerdrHome" }

# --- backups: list, restore ---
function Get-BackupNames {
  # Oldest first: by time, then by the number after it ("...-2", "...-10").
  if (-not (Test-Path -LiteralPath $BackupRoot)) { return @() }
  $byTime = @{ Expression = { ($_.Name -split '-')[0..1] -join '-' } }
  $byNumber = @{ Expression = { $parts = $_.Name -split '-'; if ($parts.Count -gt 2) { [int]$parts[2] } else { 1 } } }
  @(Get-ChildItem -LiteralPath $BackupRoot -Directory | Sort-Object $byTime, $byNumber | ForEach-Object { $_.Name })
}
function Get-BackupFiles([string]$Name) {
  $root = Join-Path $BackupRoot $Name
  @(Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName |
    ForEach-Object { $_.FullName.Substring($root.Length).TrimStart('\', '/') })
}

if ($Backup -and -not $Restore) { Write-Error '-Backup goes with -Restore'; exit 1 }

if ($Backups) {
  $names = Get-BackupNames
  if ($names.Count -eq 0) { Write-Host 'No backups yet: one is made when a run replaces a file.'; exit 0 }
  Write-Host 'backups (newest last)'
  foreach ($name in $names) {
    $files = Get-BackupFiles $name
    Write-Host "  $name  $($files.Count) file(s): $($files -join ', ')"
  }
  exit 0
}

if ($Restore) {
  $names = Get-BackupNames
  if ($names.Count -eq 0) { Write-Error 'No backups to restore from.'; exit 1 }
  if (-not $Backup) { $Backup = $names[-1] }
  elseif ($names -notcontains $Backup) { Write-Error "No backup named $Backup. There are: $($names -join ', ')"; exit 1 }
  Write-Host "restore from $Backup"
  $root = Join-Path $BackupRoot $Backup
  $same = 0
  foreach ($rel in (Get-BackupFiles $Backup)) {
    $src = Join-Path $root $rel
    $dst = Join-Path $HerdrHome $rel
    $exists = Test-Path -LiteralPath $dst
    if ($exists -and ((Get-FileHash -LiteralPath $dst).Hash -eq (Get-FileHash -LiteralPath $src).Hash)) { $same++; continue }
    if ($exists) { Changed "$rel (restored)" } else { Changed "$rel (put back)" }
    Save-Replaced $dst
    if (-not $DryRun) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
  }
  Say '=' "$same file(s) already the same"
  if ($script:Changes -eq 0) { Write-Host 'Nothing to change.' }
  elseif ($DryRun) { Write-Host "$($script:Changes) change(s) would be made." }
  else {
    $note = ''
    if (Test-Path -LiteralPath $script:BackupDir) { $note = " What they replaced is kept in $($script:BackupDir)" }
    Write-Host "$($script:Changes) change(s) made.$note"
  }
  exit 0
}

# --- files ---
Write-Host 'files'
$same = 0
foreach ($top in $Copied) {
  $root = Join-Path $Source $top
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($file in (Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName)) {
    $rel = $file.FullName.Substring($Source.Length).TrimStart('\', '/')
    $dst = Join-Path $HerdrHome $rel
    $exists = Test-Path -LiteralPath $dst
    if ($exists -and ((Get-FileHash -LiteralPath $dst).Hash -eq (Get-FileHash -LiteralPath $file.FullName).Hash)) { $same++; continue }
    if ($exists) { Changed "$rel (replaced)" } else { Changed "$rel (new)" }
    Save-Replaced $dst
    if (-not $DryRun) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination $dst -Force
    }
  }
}
Say '=' "$same files already the same"

# --- keys ---
Write-Host 'keys'
$keysPath = Join-Path $HerdrHome 'keys.json'
$keys = Read-Json $keysPath
$wanted = Read-Json (Join-Path $Source 'keys.json')
$before = Shape $keys
foreach ($section in $wanted.PSObject.Properties) {
  if (-not (Has $keys $section.Name)) { Set-Prop $keys $section.Name ([pscustomobject]@{}) }
  $mine = $keys.PSObject.Properties[$section.Name].Value
  foreach ($bind in $section.Value.PSObject.Properties) {
    if ((Has $mine $bind.Name) -and ($mine.PSObject.Properties[$bind.Name].Value -eq $bind.Value)) { continue }
    Say '.' "$($section.Name): $($bind.Name) -> $($bind.Value)"
    Set-Prop $mine $bind.Name $bind.Value
  }
}
foreach ($section in $keys.PSObject.Properties) {
  if ($section.Value -isnot [pscustomobject]) { continue }
  foreach ($bind in @($section.Value.PSObject.Properties)) {
    if (($bind.Value -is [string]) -and $ReplacedActions.ContainsKey($bind.Value)) {
      Say '.' "$($section.Name): $($bind.Name) -> $($ReplacedActions[$bind.Value]) (was $($bind.Value))"
      $bind.Value = $ReplacedActions[$bind.Value]
    }
  }
}
# "terminal" wins over "global" while a terminal has the keyboard.
if ((Has $keys 'terminal') -and (Has $wanted 'global')) {
  foreach ($bind in $wanted.global.PSObject.Properties) {
    if (Has $keys.terminal $bind.Name) {
      Say '.' "terminal: $($bind.Name) removed: global has it now"
      $keys.terminal.PSObject.Properties.Remove($bind.Name)
    }
  }
}
if ((Shape $keys) -eq $before) { Say '=' 'keys.json already has them' }
else { Changed 'keys.json'; Save-Replaced $keysPath; Write-Json $keysPath $keys }

# --- settings ---
Write-Host 'settings'
$settingsPath = Join-Path $HerdrHome 'settings.json'
if (Test-Path -LiteralPath $settingsPath) { $settings = Read-Json $settingsPath } else { $settings = [pscustomobject]@{} }
$wantedSettings = Read-Json (Join-Path $Source 'settings.json')
$settingsChanged = $false
foreach ($item in $wantedSettings.PSObject.Properties) {
  if ($SkippedSettings -contains $item.Name) { continue }
  $current = $null
  if (Has $settings $item.Name) { $current = $settings.PSObject.Properties[$item.Name].Value }
  if (($item.Value -is [pscustomobject]) -and ($current -is [pscustomobject])) {
    foreach ($inner in $item.Value.PSObject.Properties) {
      if ((Has $current $inner.Name) -and (Same $current.PSObject.Properties[$inner.Name].Value $inner.Value)) { continue }
      Set-Prop $current $inner.Name $inner.Value
      $settingsChanged = $true
    }
  } elseif (-not ((Has $settings $item.Name) -and (Same $current $item.Value))) {
    Set-Prop $settings $item.Name $item.Value
    $settingsChanged = $true
  }
}
if (-not $settingsChanged) { Say '=' 'settings.json already has them' }
else { Changed 'settings.json'; Save-Replaced $settingsPath; Write-Json $settingsPath $settings }

# --- the running app ---
function Invoke-App {
  # Runs herdr-app; returns its JSON, or $null when it failed or said "error".
  $exe = Get-Command 'herdr-app' -ErrorAction SilentlyContinue
  if (-not $exe) { return $null }
  try { $out = & $exe.Source @args 2>$null } catch { return $null }
  if ($LASTEXITCODE -ne 0) { return $null }
  try { $value = ($out -join "`n") | ConvertFrom-Json } catch { return $true }
  if (Has $value 'error') { return $null }
  return $value
}

$finished = $true
if (-not $NoApp) {
  Write-Host 'app'
  $status = Invoke-App status
  if (($null -eq $status) -or ($status -eq $true)) {
    Say '!' "Herdr isn't running (or herdr-app isn't on PATH): start Herdr and run this again to finish."
    $finished = $false
  } elseif ($DryRun) {
    Say '=' 'skipped in a dry run'
  } else {
    foreach ($mod in (Get-ChildItem -LiteralPath (Join-Path $Source 'mods') -Directory | Sort-Object Name)) {
      if ($null -eq (Invoke-App check (Join-Path (Join-Path $HerdrHome 'mods') $mod.Name))) {
        Say '!' "$($mod.Name) doesn't pass ``herdr-app check`` on this Herdr"
      }
    }
    foreach ($layoutName in $KeptLayouts) {
      # PowerShell names ignore case: this must not be called $kept, which is $Kept above.
      $registered = $null
      $windows = Join-Path $HerdrHome 'windows.json'
      if (Test-Path -LiteralPath $windows) {
        try { $all = Read-Json $windows; if ((Has $all 'kept') -and (Has $all.kept $layoutName)) { $registered = $all.kept.PSObject.Properties[$layoutName].Value } } catch { $registered = $null }
      }
      $missing = @($Kept | Where-Object { -not (Has $registered $_) })
      if ($missing.Count -eq 0) { continue }
      if ((Invoke-App status).layout -ne $layoutName) { Invoke-App do layout.switch --name $layoutName | Out-Null }
      foreach ($mod in $missing) {
        # mod.open toggles: open it only when it isn't.
        if (@((Invoke-App status).overlays) -notcontains $mod) { Invoke-App do mod.open --name $mod | Out-Null }
        if (@((Invoke-App status).overlays) -contains $mod) { Changed "$mod opened in the $layoutName layout" }
        else { Say '!' "$mod didn't open in the $layoutName layout" }
      }
    }
    if ((Invoke-App status).layout -ne $Layout) {
      if ($null -ne (Invoke-App do layout.switch --name $Layout)) { Changed "showing the $Layout layout" }
      else { Say '!' "couldn't show the $Layout layout" }
    }
    # The layout's dark theme, read from where Herdr keeps a layout's picks.
    $dark = $null
    $state = Join-Path (Join-Path (Join-Path $HerdrHome 'layouts') '.state') "$Layout.json"
    if (Test-Path -LiteralPath $state) {
      try {
        $picked = (Read-Json $state).theme
        if ($picked -is [string]) { $dark = $picked } elseif (Has $picked 'dark') { $dark = $picked.dark }
      } catch { $dark = $null }
    }
    if ($dark -ne $Theme) {
      if ($null -ne (Invoke-App do app.theme --name $Theme)) { Changed "theme $Theme" }
      else { Say '!' "couldn't pick the theme $Theme" }
    }
    Say '=' 'app is set'
  }
}

if ($script:Changes -eq 0) {
  if ($finished) { Write-Host 'Nothing to change.' } else { Write-Host 'Files, keys and settings are already in place.' }
} elseif ($DryRun) {
  Write-Host "$($script:Changes) change(s) would be made."
} else {
  $note = ''
  if (Test-Path -LiteralPath $script:BackupDir) { $note = " Replaced files are kept in $($script:BackupDir)" }
  Write-Host "$($script:Changes) change(s) made.$note"
}
