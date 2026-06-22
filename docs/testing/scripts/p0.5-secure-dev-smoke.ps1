# P0.5 secure-dev stack smoke test (requires Docker Desktop running).
# Usage: .\docs\testing\scripts\p0.5-secure-dev-smoke.ps1

$ErrorActionPreference = "Stop"
$SignalerRoot = Join-Path $PSScriptRoot "..\..\..\jam-signaler" | Resolve-Path

Write-Host "==> Starting secure-dev stack..."
Push-Location $SignalerRoot
docker compose -f docker-compose.secure-dev.yml up -d --build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Error "Docker compose failed. Is Docker Desktop running?"
}

Start-Sleep -Seconds 8

Write-Host "==> HTTP health (direct signaler :8080)"
$health = Invoke-RestMethod http://localhost:8080/health
if ($health.status -ne "ok") { throw "health check failed: $($health | ConvertTo-Json)" }
Write-Host "OK: $($health | ConvertTo-Json -Compress)"

Write-Host "==> Room token mint (ROOM_AUTH_SECRET enabled)"
$token = Invoke-RestMethod http://localhost:8080/room/smoke-test/token
if (-not $token.token.sig) { throw "token mint failed: $($token | ConvertTo-Json)" }
Write-Host "OK: exp=$($token.token.exp)"

Write-Host "==> HTTPS via Caddy (self-signed; -k)"
$httpsHealth = curl.exe -fsSk https://localhost/health 2>&1
if ($LASTEXITCODE -ne 0) { throw "Caddy HTTPS health failed: $httpsHealth" }
Write-Host "OK: $httpsHealth"

Write-Host "==> ICE servers with dynamic TURN"
$ice = Invoke-RestMethod http://localhost:8080/ice-servers
$turn = $ice.iceServers | Where-Object { $_.urls -match "^turn:" }
if ($turn.Count -lt 1) { throw "no TURN entries in ice-servers" }
Write-Host "OK: $($turn.Count) TURN server(s), ephemeral creds present"

Pop-Location
Write-Host "`nP0.5 secure-dev smoke: PASS"
