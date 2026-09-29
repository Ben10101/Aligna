<#
.SYNOPSIS
    Instala e prepara o Aligna para execução local no Windows.
.DESCRIPTION
    Verifica Node.js e Python, configura o .env da raiz, instala as dependências,
    gera o Prisma Client e aplica as migrações versionadas do MySQL.
.PARAMETER Unattended
    Executa sem solicitar confirmação inicial.
.PARAMETER SkipDB
    Não valida nem aplica as migrações do banco.
.PARAMETER SkipFrontendBuild
    Não compila o frontend.
#>
param(
    [switch]$Unattended,
    [switch]$SkipDB,
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Green }
function Write-Info { param([string]$Message) Write-Host "    $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "AVISO: $Message" -ForegroundColor Yellow }
function Stop-Install { param([string]$Message) Write-Host "ERRO: $Message" -ForegroundColor Red; exit 1 }

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FailureMessage (código $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }
}

function New-RandomSecret {
    param([int]$ByteCount = 48)
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-EnvValue {
    param([string[]]$Lines, [string]$Name)
    $prefix = "$Name="
    foreach ($line in $Lines) {
        if ($line.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            return $line.Substring($prefix.Length).Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Set-EnvValue {
    param([System.Collections.Generic.List[string]]$Lines, [string]$Name, [string]$Value)
    $prefix = "$Name="
    $found = $false
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i].StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            if (-not $found) { $Lines[$i] = "$prefix$Value"; $found = $true }
            else { $Lines.RemoveAt($i); $i-- }
        }
    }
    if (-not $found) { $Lines.Add("$prefix$Value") }
}

$ROOT_DIR = $PSScriptRoot
$BACKEND_DIR = Join-Path $ROOT_DIR 'backend'
$FRONTEND_DIR = Join-Path $ROOT_DIR 'frontend'
$ENV_FILE = Join-Path $ROOT_DIR '.env'
$ENV_EXAMPLE = Join-Path $ROOT_DIR '.env.example'

if (-not (Test-Path (Join-Path $BACKEND_DIR 'package.json')) -or
    -not (Test-Path (Join-Path $FRONTEND_DIR 'package.json'))) {
    Stop-Install "Não encontrei backend e frontend em '$ROOT_DIR'. Execute este script na pasta do projeto."
}

Write-Host ''
Write-Host 'Aligna | Instalador local' -ForegroundColor Magenta
Write-Host "Projeto: $ROOT_DIR" -ForegroundColor DarkGray
if (-not $Unattended) {
    $confirm = Read-Host 'Continuar com a instalação? (S/n)'
    if ($confirm -match '^[nN]') { Write-Host 'Instalação cancelada.'; exit 0 }
}

Write-Step '1/6 — Verificando pré-requisitos'
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node) { Stop-Install 'Node.js 20 ou superior não encontrado. Instale em https://nodejs.org/ e abra um novo terminal.' }
if (-not $npm) { Stop-Install 'npm não encontrado. Reinstale o Node.js e abra um novo terminal.' }
$nodeVersionText = (& node -p 'process.versions.node').Trim()
$nodeVersion = [version]$nodeVersionText
Write-Info "Node.js $nodeVersionText"
if ($nodeVersion.Major -lt 20) { Stop-Install "O projeto requer Node.js 20 ou superior; encontrado $nodeVersionText." }
Write-Info "npm $((& npm --version).Trim())"

$pythonCommand = $null
foreach ($candidate in @('python', 'py')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $pythonCommand = $candidate; break }
}
if (-not $pythonCommand) { Stop-Install 'Python 3.10 ou superior não encontrado. Instale em https://www.python.org/downloads/.' }
$pythonVersionText = (& $pythonCommand -c 'import sys; print("{}.{}.{}".format(*sys.version_info[:3]))').Trim()
$pythonVersion = [version]$pythonVersionText
Write-Info "Python $pythonVersionText ($pythonCommand)"
if ($pythonVersion -lt [version]'3.10') { Stop-Install "O projeto requer Python 3.10 ou superior; encontrado $pythonVersionText." }
$venvPath = Join-Path $ROOT_DIR '.venv'
$venvPython = Join-Path $venvPath 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Invoke-Native $pythonCommand @('-m', 'venv', $venvPath) $ROOT_DIR 'Falha ao criar o ambiente virtual Python'
}

Write-Step '2/6 — Configurando variáveis de ambiente'
if (-not (Test-Path $ENV_FILE)) {
    if (-not (Test-Path $ENV_EXAMPLE)) { Stop-Install "Arquivo de exemplo não encontrado: $ENV_EXAMPLE" }
    Copy-Item -LiteralPath $ENV_EXAMPLE -Destination $ENV_FILE
    Write-Info 'Arquivo .env criado a partir de .env.example.'
} else {
    Write-Info 'Arquivo .env existente será preservado.'
}

$envLines = [System.Collections.Generic.List[string]]::new()
foreach ($line in (Get-Content -LiteralPath $ENV_FILE)) { $envLines.Add([string]$line) }
$accessSecret = Get-EnvValue $envLines.ToArray() 'AUTH_ACCESS_SECRET'
if ([string]::IsNullOrWhiteSpace($accessSecret) -or $accessSecret -match '^(change-me|replace-me|your[-_])') {
    Set-EnvValue $envLines 'AUTH_ACCESS_SECRET' (New-RandomSecret)
    Write-Info 'AUTH_ACCESS_SECRET foi gerado.'
}
$aiSecret = Get-EnvValue $envLines.ToArray() 'AI_SETTINGS_SECRET'
if ([string]::IsNullOrWhiteSpace($aiSecret) -or $aiSecret -match '^(change-me|replace-me|your[-_])') {
    Set-EnvValue $envLines 'AI_SETTINGS_SECRET' (New-RandomSecret)
    Write-Info 'AI_SETTINGS_SECRET foi gerado.'
}
if (-not (Get-EnvValue $envLines.ToArray() 'DATABASE_URL')) {
    Set-EnvValue $envLines 'DATABASE_URL' 'mysql://root@localhost:3306/ai_factory'
    Write-Info 'DATABASE_URL local padrão foi adicionada.'
}
Set-EnvValue $envLines 'PYTHON_CMD' $venvPython
Set-Content -LiteralPath $ENV_FILE -Value $envLines.ToArray() -Encoding UTF8
Write-Info 'Edite .env para configurar uma chave de provedor de IA antes de executar agentes.'

Write-Step '3/6 — Instalando dependências Node.js'
foreach ($packageDir in @($BACKEND_DIR, $FRONTEND_DIR)) {
    $lockFile = Join-Path $packageDir 'package-lock.json'
    if (Test-Path $lockFile) {
        Invoke-Native 'npm' @('ci', '--no-audit', '--no-fund') $packageDir "Falha ao instalar dependências em '$packageDir'"
    } else {
        Invoke-Native 'npm' @('install', '--no-audit', '--no-fund') $packageDir "Falha ao instalar dependências em '$packageDir'"
    }
    Write-Info "Dependências instaladas: $(Split-Path -Leaf $packageDir)."
}

Write-Step '4/6 — Instalando dependências Python'
$requirements = Join-Path $ROOT_DIR 'requirements.txt'
if (Test-Path $requirements) {
    Invoke-Native $venvPython @('-m', 'pip', 'install', '-r', $requirements) $ROOT_DIR 'Falha ao instalar dependências Python'
    Write-Info 'Dependências Python instaladas.'
} else {
    Write-Warn 'requirements.txt não encontrado; dependências Python foram ignoradas.'
}

Write-Step '5/6 — Preparando banco de dados'
if ($SkipDB) {
    Write-Warn 'Etapa ignorada por -SkipDB.'
} else {
    Invoke-Native 'npm' @('run', 'prisma:generate') $BACKEND_DIR 'Falha ao gerar Prisma Client'
    Invoke-Native 'npm' @('run', 'prisma:migrate:deploy') $BACKEND_DIR 'Falha ao aplicar migrações. Confira DATABASE_URL, disponibilidade do MySQL e permissões do usuário.'
    Write-Info 'Prisma Client gerado e migrações aplicadas.'
}

Write-Step '6/6 — Compilando frontend'
if ($SkipFrontendBuild) {
    Write-Warn 'Etapa ignorada por -SkipFrontendBuild.'
} else {
    Invoke-Native 'npm' @('run', 'build') $FRONTEND_DIR 'Falha ao compilar o frontend'
    Write-Info 'Frontend compilado em frontend/dist.'
}

Write-Host ''
Write-Host 'Instalação concluída.' -ForegroundColor Green
Write-Host 'Para iniciar o backend, execute em um terminal:' -ForegroundColor White
Write-Host '  cd backend; npm run dev' -ForegroundColor Cyan
Write-Host 'Para iniciar o frontend, execute em outro terminal:' -ForegroundColor White
Write-Host '  cd frontend; npm run dev' -ForegroundColor Cyan
Write-Host 'Frontend: http://localhost:5173 | API: http://localhost:3001/api | Health: http://localhost:3001/health' -ForegroundColor Yellow
