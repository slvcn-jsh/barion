#!/usr/bin/env pwsh
# E2E AI Fallback Test Runner
# Starts Expo web server and runs Playwright tests with mocked gateway

Write-Host "Starting Expo web server..." -ForegroundColor Cyan
$webProcess = Start-Process -FilePath "npm" -ArgumentList "run", "web", "--", "--web" -PassThru -NoNewWindow

Write-Host "Waiting for web server to be ready..." -ForegroundColor Cyan
$maxAttempts = 30
$attempt = 0
$ready = $false

while ($attempt -lt $maxAttempts -and -not $ready) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8081" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $ready = $true
            Write-Host "Web server ready!" -ForegroundColor Green
        }
    } catch {
        $attempt++
        Write-Host "." -NoNewline
    }
}

if (-not $ready) {
    Write-Host "`nWeb server failed to start within 60 seconds" -ForegroundColor Red
    Stop-Process -Id $webProcess.Id -Force
    exit 1
}

Write-Host "Running E2E AI fallback tests..." -ForegroundColor Cyan
npm run test:e2e:ai-fallback

$exitCode = $LASTEXITCODE

Write-Host "Stopping web server..." -ForegroundColor Cyan
Stop-Process -Id $webProcess.Id -Force

exit $exitCode
