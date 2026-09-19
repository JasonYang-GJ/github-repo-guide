param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$url = 'http://127.0.0.1:4173'
$lock = New-Object Threading.Mutex($false, 'Local\GitHubRepoGuideLauncher4173')
$hasLock = $false
function Read-Health {
    try { return Invoke-RestMethod "$url/api/health" -TimeoutSec 2 } catch { return $null }
}
try {
    $hasLock = $lock.WaitOne(30000)
    if (-not $hasLock) { throw 'Another launcher is starting the app. Please try again shortly.' }
    $health = Read-Health
    if ($health -and $health.application_id -ne 'github-repo-guide-workbench-v1') {
        throw 'Port 4173 is running an older app or another program. Close its confirmed process before starting this version.'
    }
    if (-not $health) {
        $listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
        if ($listener) { throw 'Port 4173 is occupied. No process was stopped.' }
        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $logRoot = Join-Path $projectRoot 'output\launcher'
        New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        $entry = Join-Path $projectRoot 'dist\src\web\index.js'
        $needsBuild = -not (Test-Path -LiteralPath $entry)
        if (-not $needsBuild) {
            $builtAt = (Get-Item -LiteralPath $entry).LastWriteTimeUtc
            $newerSource = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -Recurse -Filter '*.ts' |
                Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
            $needsBuild = [bool]$newerSource
        }
        if ($needsBuild) {
            Push-Location $projectRoot
            try {
                & npm.cmd run build --silent *> (Join-Path $logRoot 'build.log')
                if ($LASTEXITCODE -ne 0) { throw 'Build failed. See output\launcher\build.log in the project folder.' }
            } finally { Pop-Location }
        }
        $launchId = [guid]::NewGuid().ToString('N')
        $oldPort = $env:PORT
        try {
            $env:PORT = '4173'
            $child = Start-Process -FilePath $nodePath -ArgumentList 'dist/src/web/index.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $logRoot "$launchId.out.log") -RedirectStandardError (Join-Path $logRoot "$launchId.err.log")
        } finally { $env:PORT = $oldPort }
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 250
            $health = Read-Health
            if ($health -and $health.application_id -eq 'github-repo-guide-workbench-v1') { break }
            if ($child.HasExited) { throw 'The local server exited. See output\launcher logs in the project folder.' }
        }
        if (-not $health -or $health.application_id -ne 'github-repo-guide-workbench-v1') { throw 'The local server did not become ready. See output\launcher logs.' }
    }
    if (-not $NoBrowser) { Start-Process $url }
    Write-Output 'READY http://127.0.0.1:4173'
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'GitHub Repo Guide', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($hasLock) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
