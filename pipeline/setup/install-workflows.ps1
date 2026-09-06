# =====================================================================
#  install-workflows.ps1 (2026-09-06) - copies pipeline\workflows\*.yml
#  into <project>\.github\workflows\, which is where GitHub insists on
#  finding them. Run via install-workflows.bat (double-click).
#
#  WHY: the pipeline zone owns the automations, so their SOURCE lives in
#  pipeline\workflows\ where Claude can read and edit it. The copy under
#  .github\ is GitHub's requirement (and the device bridge cannot write
#  there), so this script keeps the copy identical to the source.
#
#  It copies byte-for-byte except for one safety: a UTF-8 BOM at the start
#  of a .yml (Notepad sometimes adds one) is stripped, because GitHub's
#  YAML parser rejects it.
# =====================================================================
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # pipeline\setup\ -> the project root
$src  = Join-Path (Split-Path -Parent $PSScriptRoot) "workflows"
$dst  = Join-Path $root ".github\workflows"
$enc  = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path $src)) { Write-Host "no pipeline\workflows folder - nothing to install"; exit 1 }
New-Item -ItemType Directory -Force -Path $dst | Out-Null

$files = Get-ChildItem -Path $src -Filter *.yml
if ($files.Count -eq 0) { Write-Host "pipeline\workflows is empty - nothing to install"; exit 1 }

$changed = 0
foreach ($f in $files) {
  $text = [System.IO.File]::ReadAllText($f.FullName, $enc)
  if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }   # strip a BOM
  $target = Join-Path $dst $f.Name
  $old = if (Test-Path $target) { [System.IO.File]::ReadAllText($target, $enc) } else { $null }
  if ($old -ceq $text) {   # -ceq: case-SENSITIVE, unlike -eq
    Write-Host ("  unchanged  " + $f.Name)
  } else {
    [System.IO.File]::WriteAllText($target, $text, $enc)
    Write-Host ("  " + $(if ($null -eq $old) { "created    " } else { "updated    " }) + $f.Name)
    $changed++
  }
}

# anything in .github\workflows that has no source any more is reported, never deleted
foreach ($g in Get-ChildItem -Path $dst -Filter *.yml) {
  if (-not (Test-Path (Join-Path $src $g.Name))) {
    Write-Host ("  NO SOURCE  " + $g.Name + "   (exists only under .github - delete it by hand if it is obsolete)")
  }
}

Write-Host ""
if ($changed -eq 0) {
  Write-Host ".github\workflows already matches pipeline\workflows - nothing to commit."
} else {
  Write-Host ("$changed file(s) written. git status will show them under .github/workflows/.")
  Write-Host "Commit them TOGETHER with the pipeline\workflows change, push, and watch"
  Write-Host "the next run go green before calling the change done."
}
