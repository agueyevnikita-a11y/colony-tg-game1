#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this backup as root so archives remain root-owned.\n' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
backup_dir=/var/backups/colony

if [[ ! -f "$script_dir/.env" ]]; then
  printf 'Missing server environment file: %s/.env\n' "$script_dir" >&2
  exit 1
fi
if [[ -L "$backup_dir" ]]; then
  printf 'Refusing a symbolic-link backup directory: %s\n' "$backup_dir" >&2
  exit 1
fi

mkdir -p -- "$backup_dir"
chown root:root -- "$backup_dir"
chmod 0700 -- "$backup_dir"

# Coordinate the entire snapshot/checksum with the reviewed privacy worker.
# The worker acquires release.lock first, then data.lock; it must not invoke
# this script while already holding data.lock in another process.
lock_file=/var/lock/colony-data.lock
command -v flock >/dev/null || { printf 'Missing flock; backup was not started.\n' >&2; exit 1; }
if (set -o noclobber; : > "$lock_file") 2>/dev/null; then
  chmod 0600 -- "$lock_file"
fi
if [[ -L "$lock_file" || ! -f "$lock_file" || "$(stat -c %u -- "$lock_file")" != 0 ]]; then
  printf 'Refusing an unsafe COLONY data lock.\n' >&2
  exit 1
fi
if (( (8#$(stat -c %a -- "$lock_file") & 022) != 0 )); then
  printf 'COLONY data lock is writable by another user.\n' >&2
  exit 1
fi
exec 8>>"$lock_file"
flock --exclusive 8

compose=(docker compose --project-directory "$script_dir" --env-file "$script_dir/.env" -f "$script_dir/compose.yml")
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$(mktemp "$backup_dir/colony-${stamp}-XXXXXX.dump.partial")"
trap 'printf "Backup failed. Any incomplete archive remains private at %s\n" "$partial" >&2' ERR

"${compose[@]}" exec -T db sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$partial"
"${compose[@]}" exec -T db pg_restore --list < "$partial" > /dev/null

archive="${partial%.partial}"
if [[ -e "$archive" ]]; then
  printf 'Refusing to overwrite an existing archive: %s\n' "$archive" >&2
  exit 1
fi
mv -- "$partial" "$archive"
archive_name="${archive##*/}"
(
  cd -- "$backup_dir"
  sha256sum -- "$archive_name" > "$archive_name.sha256"
)
chmod 0600 -- "$archive" "$archive.sha256"
trap - ERR

printf 'Backup created: %s\nChecksum: %s.sha256\n' "$archive" "$archive"
printf 'Archive listing verified. A separate restore rehearsal is still required.\n'
printf 'No old archives were deleted. Monitor free disk space and copy verified archives off-server.\n'
