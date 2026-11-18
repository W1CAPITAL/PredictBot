# Inicia apenas o BitNet oficial ja compilado, no loopback.
param(
  [string]$BitNetDir = "$env:USERPROFILE\BitNet",
  [string]$ModelPath = '',
  [ValidateRange(1, 4)][int]$Threads = 2,
  [ValidateRange(512, 4096)][int]$Context = 1024
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath "$BitNetDir\run_inference_server.py" -PathType Leaf)) {
  throw "BitNet nao encontrado em $BitNetDir. Obtenha microsoft/BitNet e compile conforme a documentacao."
}
if (-not $ModelPath) {
  $ModelPath = Join-Path $BitNetDir 'models\BitNet-b1.58-2B-4T\ggml-model-i2_s.gguf'
}
if (-not (Test-Path -LiteralPath $ModelPath -PathType Leaf)) {
  throw "Modelo GGUF nao encontrado: $ModelPath. Baixe os pesos separadamente."
}
$serverPaths = @(
  (Join-Path $BitNetDir 'build\bin\Release\llama-server.exe'),
  (Join-Path $BitNetDir 'build\bin\llama-server.exe')
)
if (-not ($serverPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })) {
  throw 'llama-server.exe nao encontrado. Compile o BitNet da Microsoft antes de iniciar.'
}
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python nao encontrado no PATH.' }
$ModelPath = (Resolve-Path -LiteralPath $ModelPath).Path
$env:OMP_NUM_THREADS = [string]$Threads
Push-Location -LiteralPath $BitNetDir
try {
  Write-Host "BitNet local em 127.0.0.1:8080, com $Threads threads e contexto $Context."
  & $python.Source 'run_inference_server.py' '-m' $ModelPath '-t' $Threads '-c' $Context '-n' '256' '--host' '127.0.0.1' '--port' '8080'
  if ($LASTEXITCODE -ne 0) { throw "BitNet terminou com codigo $LASTEXITCODE" }
} finally { Pop-Location }
