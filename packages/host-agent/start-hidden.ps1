# start-hidden.ps1 — Fase 6F.3.a
#
# Avvia @engine/host-agent in background, senza finestra visibile: da
# questo momento in poi il controllo di packages/server avviene dal
# pannello "Server locale" in basso nell'editor, mai da un terminale che
# potresti chiudere per errore.
#
# NOTA WINDOWS: fare doppio click direttamente su QUESTO file di solito lo
# APRE in un editor di testo invece di eseguirlo (comportamento di default
# di Windows/PowerShell, non un errore di questo script). Per lanciarlo
# davvero:
#   - doppio click su start-hidden.cmd, nella stessa cartella (consigliato), oppure
#   - tasto destro su questo file -> "Esegui con PowerShell"
#
# Se un'istanza è già in ascolto sulla porta dell'agente, questo script
# non ne avvia una seconda (rilancio accidentale = no-op, non un secondo
# processo duplicato).

$ErrorActionPreference = "Stop"
$hostAgentDir = $PSScriptRoot
$distEntry = Join-Path $hostAgentDir "dist\index.js"
$stdoutLog = Join-Path $hostAgentDir "host-agent.out.log"
$stderrLog = Join-Path $hostAgentDir "host-agent.err.log"

if (-not (Test-Path $distEntry)) {
    Write-Host "dist/index.js mancante — eseguo la build di @engine/host-agent..."
    Push-Location $hostAgentDir
    & pnpm build
    Pop-Location
}

$port = if ($env:HOST_AGENT_PORT) { $env:HOST_AGENT_PORT } else { 4100 }
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Un processo è già in ascolto sulla porta $port — host-agent sembra già avviato, non ne lancio un secondo."
    exit 0
}

$proc = Start-Process -FilePath "node" `
  -ArgumentList $distEntry `
  -WorkingDirectory $hostAgentDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Write-Host "host-agent avviato in background (nessuna finestra visibile), PID $($proc.Id)."
Write-Host "Log: $stdoutLog / $stderrLog"
Write-Host "Da qui in poi, controllo dal pannello 'Server locale' nell'editor."
