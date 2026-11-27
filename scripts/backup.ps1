param(
  [string]$Project = 'normocontrolcenter',
  [string]$Destination = (Join-Path (Get-Location) ('backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
)
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '^[a-z][a-z0-9_-]*$') { throw 'Invalid project name.' }
if (Test-Path -LiteralPath $Destination) { throw 'Backup destination already exists.' }
$folder = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $folder | Out-Null
$dbId = (docker compose -p $Project ps -q postgres).Trim()
if ($LASTEXITCODE -ne 0 -or -not $dbId) { throw 'PostgreSQL container is not running.' }
$uploadsVolume = "${Project}_uploads_data"
docker volume inspect $uploadsVolume *> $null
if ($LASTEXITCODE -ne 0) { throw 'Uploads volume is missing.' }
docker compose -p $Project stop app | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not stop application writes.' }
try {
  docker exec $dbId pg_dump -U normo -d normocontrol -Fc -f /tmp/ncc-backup.dump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
  docker cp "${dbId}:/tmp/ncc-backup.dump" (Join-Path $folder 'database.dump')
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy database dump.' }
  docker exec $dbId rm /tmp/ncc-backup.dump | Out-Null
  $countSql = "SELECT (SELECT COUNT(*) FROM users)||','||(SELECT COUNT(*) FROM submission_versions)||','||(SELECT COUNT(*) FROM receipts)"
  $counts = (docker exec $dbId psql -U normo -d normocontrol -Atc $countSql).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not read database counts.' }
  docker run --rm --mount "type=volume,src=$uploadsVolume,dst=/source,readonly" --mount "type=bind,src=$folder,dst=/backup" postgres:16-alpine tar -C /source -czf /backup/uploads.tar.gz .
  if ($LASTEXITCODE -ne 0) { throw 'Could not archive uploaded files.' }
  docker run --rm --mount "type=volume,src=$uploadsVolume,dst=/source,readonly" --mount "type=bind,src=$folder,dst=/backup" postgres:16-alpine sh -c 'cd /source && find . -type f -exec sha256sum {} \; > /backup/files.sha256'
  if ($LASTEXITCODE -ne 0) { throw 'Could not hash uploaded files.' }
  $manifest = [ordered]@{
    project = $Project
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    counts = $counts
    databaseSha256 = (Get-FileHash -LiteralPath (Join-Path $folder 'database.dump') -Algorithm SHA256).Hash.ToLowerInvariant()
    uploadsArchiveSha256 = (Get-FileHash -LiteralPath (Join-Path $folder 'uploads.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'manifest.json') -Encoding utf8
  Write-Output "BACKUP_OK $folder"
} finally {
  docker compose -p $Project start app | Out-Null
}
