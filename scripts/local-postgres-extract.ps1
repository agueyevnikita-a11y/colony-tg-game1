param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskDestination = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
$taskZip = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($Archive))
try {
  foreach ($taskEntry in $taskZip.Entries) {
    # The server needs bin/lib/share; omit pgAdmin and unrelated installer tools.
    if ($taskEntry.FullName -notmatch '^pgsql/(bin|lib|share)/') { continue }
    $taskTarget = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($taskDestination, $taskEntry.FullName.Replace('/', '\')))
    if (-not $taskTarget.StartsWith($taskDestination, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
    if ($taskEntry.FullName.EndsWith('/')) {
      New-Item -ItemType Directory -Path $taskTarget -Force | Out-Null
    } else {
      New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($taskTarget)) -Force | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry, $taskTarget, $true)
    }
  }
} finally { $taskZip.Dispose() }
Write-Output 'Portable PostgreSQL server files extracted.'
