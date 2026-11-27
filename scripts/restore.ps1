param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][string]$Project
)
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '^[a-z][a-z0-9_-]*$') { throw 'Invalid project name.' }
$folder = [IO.Path]::GetFullPath($Backup)
$manifestPath = Join-Path $folder 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Backup manifest is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($Project -eq $manifest.project) { throw 'Restore into the source project is prohibited. Use a fresh project name.' }
foreach ($file in @('database.dump', 'uploads.tar.gz', 'files.sha256')) {
  if (-not (Test-Path -LiteralPath (Join-Path $folder $file))) { throw "Backup file is missing: $file" }
}
if ((Get-FileHash -LiteralPath (Join-Path $folder 'database.dump') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.databaseSha256) { throw 'Database dump checksum mismatch.' }
if ((Get-FileHash -LiteralPath (Join-Path $folder 'uploads.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.uploadsArchiveSha256) { throw 'Uploads archive checksum mismatch.' }
$env:APP_PORT = if ($env:APP_PORT) { $env:APP_PORT } else { '3002' }
docker compose -p $Project up -d --wait postgres | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not start target PostgreSQL.' }
$dbId = (docker compose -p $Project ps -q postgres).Trim()
if (-not $dbId) { throw 'Target PostgreSQL is unavailable.' }
$tableCount = [string](docker exec $dbId psql -U normo -d normocontrol -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
$tableCount = $tableCount.Trim()
if ($LASTEXITCODE -ne 0 -or $tableCount -ne '0') { throw 'Target database is not empty.' }
$uploadsVolume = "${Project}_uploads_data"
$existingVolume = @(docker volume ls -q --filter "name=^${uploadsVolume}$")
if ($existingVolume -contains $uploadsVolume) { throw 'Target uploads volume already exists. Restore requires a fresh target.' }
docker volume create $uploadsVolume | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not create target uploads volume.' }
docker cp (Join-Path $folder 'database.dump') "${dbId}:/tmp/ncc-restore.dump"
if ($LASTEXITCODE -ne 0) { throw 'Could not copy database dump.' }
docker exec $dbId pg_restore -U normo -d normocontrol --no-owner --no-acl /tmp/ncc-restore.dump
if ($LASTEXITCODE -ne 0) { throw 'Database restore failed.' }
docker exec $dbId rm /tmp/ncc-restore.dump | Out-Null
docker run --rm --mount "type=volume,src=$uploadsVolume,dst=/target" --mount "type=bind,src=$folder,dst=/backup,readonly" postgres:16-alpine tar -C /target -xzf /backup/uploads.tar.gz
if ($LASTEXITCODE -ne 0) { throw 'Uploads restore failed.' }
docker run --rm --mount "type=volume,src=$uploadsVolume,dst=/target,readonly" --mount "type=bind,src=$folder,dst=/backup,readonly" postgres:16-alpine sh -c 'cd /target && sha256sum -c /backup/files.sha256'
if ($LASTEXITCODE -ne 0) { throw 'Uploaded file checksum mismatch.' }
$countSql = "SELECT (SELECT COUNT(*) FROM users)||','||(SELECT COUNT(*) FROM submission_versions)||','||(SELECT COUNT(*) FROM receipts)"
$counts = (docker exec $dbId psql -U normo -d normocontrol -Atc $countSql).Trim()
if ($LASTEXITCODE -ne 0 -or $counts -ne $manifest.counts) { throw 'Restored database row counts do not match the backup.' }
docker compose -p $Project up --build -d app | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not start restored application.' }
Write-Output "RESTORE_OK project=$Project counts=$counts port=$env:APP_PORT"
