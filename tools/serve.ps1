# =====================================================================
#  serve.ps1 — the no-dependencies fallback for serve.bat.
#  Serves ..\site on http://localhost:8080 using .NET's HttpListener,
#  which ships with Windows. Nothing to install.
#  A "localhost" prefix does not need administrator rights.
# =====================================================================
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\site")).Path.TrimEnd('\')
$guard = $root + [System.IO.Path]::DirectorySeparatorChar
$port = 8080

$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js"  = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8";  ".json"= "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() }
catch {
  Write-Host "Could not open port $port. Is something already using it?" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  hakesef shelanu - serving $root"
Write-Host ""
Write-Host "    the site         http://localhost:$port/"
Write-Host "    payments check   http://localhost:$port/tools/paidcheck.html"
Write-Host ""
Write-Host "  Close this window to stop. 404s are listed below."
Write-Host ""

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
  $file = Join-Path $root $rel
  if ((Test-Path $file) -and (Get-Item $file).PSIsContainer) { $file = Join-Path $file "index.html" }

  # never serve anything outside site\, however the path is spelled
  $full = [System.IO.Path]::GetFullPath($file)
  if (-not ($full.StartsWith($guard) -or $full -eq $root)) {
    $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue
  }

  if (Test-Path $full -PathType Leaf) {
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ext = [System.IO.Path]::GetExtension($full).ToLower()
    $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "text/plain; charset=utf-8" })
    $ctx.Response.Headers.Add("Cache-Control", "no-store")
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    Write-Host "  404  $rel"
    $ctx.Response.StatusCode = 404
    $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel")
    $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
  }
  $ctx.Response.Close()
}
