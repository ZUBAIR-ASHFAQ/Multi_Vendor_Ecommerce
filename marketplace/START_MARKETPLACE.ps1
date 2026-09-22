$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
if (-not (Test-Path (Join-Path $backend "package.json"))) {
    throw "Backend directory not found or invalid: $backend"
}

if (-not (Test-Path (Join-Path $frontend "package.json"))) {
    throw "Frontend directory not found or invalid: $frontend"
}

Write-Host ""
Write-Host "========================================"
Write-Host " Starting Multi-Vendor Marketplace"
Write-Host " Backend : http://localhost:4000"
Write-Host " Frontend: http://localhost:5174"
Write-Host "========================================"
Write-Host ""

# ------------------------------------------------------------
# Local development configuration.
#
# These values intentionally override stale variables inherited
# from previous PowerShell sessions.
# ------------------------------------------------------------

$env:NODE_ENV = "development"
$env:PRODUCT_MODERATION_REQUIRED = "true"

$env:DATABASE_URL =
    "postgresql://marketplace_dev:marketplace_dev@127.0.0.1:55435/marketplace_dev"

$env:REDIS_URL =
    "redis://127.0.0.1:56379"

$env:JWT_ACCESS_SECRET =
    "development-secret-key-at-least-32-characters-long"

$env:INTERNAL_API_KEY =
    "development-internal-key-at-least-32-characters"

$env:STORAGE_PROVIDER =
    "s3_compatible"

$env:STORAGE_BUCKET =
    "marketplace-dev"

$env:STORAGE_REGION =
    "us-east-1"

$env:STORAGE_ENDPOINT =
    "http://127.0.0.1:59010"

$env:STORAGE_ACCESS_KEY_ID =
    "marketplace-dev"

$env:STORAGE_SECRET_ACCESS_KEY =
    "marketplace-dev-secret"

$env:STORAGE_FORCE_PATH_STYLE =
    "true"

$env:STORAGE_SIGNED_URL_TTL_SECONDS =
    "900"

# Seller verification, store logos, and product images use the existing
# Module 21 signed-upload flow. Keep every development purpose explicit so
# production remains deployment-configured and fail-closed.
$env:DOCUMENT_UPLOAD_POLICY_JSON =
    '{"seller_verification":{"allowedMimeTypes":["application/pdf","image/png","image/jpeg"],"maxSizeBytes":5242880},"store_asset":{"allowedMimeTypes":["image/png","image/jpeg","image/webp"],"maxSizeBytes":5242880},"product_media":{"allowedMimeTypes":["image/png","image/jpeg","image/webp"],"maxSizeBytes":5242880}}'

# Stripe credentials are intentionally not set here. The backend loads backend/.env and
# the frontend loads frontend/.env.local, so this launcher must never overwrite real test keys
# with placeholders. Backend environment validation fails fast when the required Stripe secrets
# are missing.
$env:STRIPE_CURRENCY_EXPONENTS_JSON =
    '{"USD":2,"PKR":2}'

# Local development keeps real Stripe test credentials from backend/.env + frontend/.env.local,
# while email delivery and seller payouts use deterministic non-production adapters so those
# workflows can be exercised end to end without external provider accounts. Production rejects
# both deterministic modes.
$env:NOTIFICATION_EMAIL_PROVIDER_MODE =
    "deterministic_test"

$env:NOTIFICATION_EMAIL_FROM =
    "notifications@marketplace.local"

$env:PAYOUT_PROVIDER_MODE =
    "deterministic_test"

$env:PAYOUT_PROVIDER_TYPE =
    "local_dev"

$env:WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS =
    "0"

# Prevent stale provider-module settings inherited from an existing PowerShell session from
# changing deterministic local behavior.
Remove-Item Env:PAYOUT_PROVIDER_ADAPTER_MODULE -ErrorAction SilentlyContinue

$env:HOST = "0.0.0.0"
$env:PORT = "4000"

$env:CORS_ORIGINS =
    "http://localhost:5174"

$env:VITE_API_BASE_URL =
    "http://localhost:4000/api/v1"

$env:VITE_APP_NAME =
    "Marketplace"

# Enables development-only UI guidance for the deterministic payout adapter. This variable is
# browser-visible and carries no secret.
$env:VITE_LOCAL_DEMO_PROVIDERS =
    "true"

# Never allow the test database variable to affect normal development.
Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue

# ------------------------------------------------------------
# Check Docker first.
# ------------------------------------------------------------

docker info *> $null

if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is not running. Start Docker Desktop and run this launcher again."
}

# ------------------------------------------------------------
# Start the persistent development PostgreSQL, Redis, and S3-compatible storage.
# ------------------------------------------------------------

Set-Location $backend

Write-Host "Starting development database, Redis, and object storage..."

npm run dev:infra

if ($LASTEXITCODE -ne 0) {
    throw "Development Docker infrastructure failed to start."
}

# ------------------------------------------------------------
# Bring the database schema up to date.
# This is safe to run every time because the migration runner
# records previously applied migrations.
# ------------------------------------------------------------

Write-Host ""
Write-Host "Checking database migrations..."

npm run db:migrate

if ($LASTEXITCODE -ne 0) {
    throw "Database migration failed."
}

# ------------------------------------------------------------
# Seed administration/RBAC data.
# ------------------------------------------------------------

Write-Host ""
Write-Host "Checking administration seed data..."

npm run db:seed:administration

if ($LASTEXITCODE -ne 0) {
    throw "Administration seed failed."
}

# ------------------------------------------------------------
# Restart any existing development backend before launching.
# The backend reads upload/storage policy once at process startup, so reusing
# an older listener can leave new development configuration unapplied.
# ------------------------------------------------------------

$backendListeners = @(Get-NetTCPConnection `
    -LocalPort 4000 `
    -State Listen `
    -ErrorAction SilentlyContinue)

$frontendRunning = Get-NetTCPConnection `
    -LocalPort 5174 `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($backendListeners.Count -gt 0) {
    Write-Host ""
    Write-Host "Restarting existing backend on port 4000 to apply current development configuration..."

    $backendProcessIds = @(
        $backendListeners |
            Select-Object -ExpandProperty OwningProcess -Unique
    )

    foreach ($processId in $backendProcessIds) {
        Stop-Process -Id $processId -Force -ErrorAction Stop
    }

    Start-Sleep -Seconds 1
}

# ------------------------------------------------------------
# Start backend.
# Child PowerShell inherits the development environment above.
# ------------------------------------------------------------

Write-Host ""
Write-Host "Starting backend on port 4000..."

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-Command",
    "Set-Location '$backend'; npm run dev"
)

# Give backend a moment to initialize.
Start-Sleep -Seconds 3

# ------------------------------------------------------------
# Start frontend.
# ------------------------------------------------------------

if (-not $frontendRunning) {
    Write-Host "Starting frontend on port 5174..."

    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-Command",
        "Set-Location '$frontend'; npm run dev -- --port 5174"
    )
}
else {
    Write-Host "Frontend port 5174 is already running."
}

# Give Vite time to bind its port.
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Marketplace started."
Write-Host "Frontend: http://localhost:5174"
Write-Host "Backend : http://localhost:4000"
Write-Host ""

Start-Process "http://localhost:5174"

