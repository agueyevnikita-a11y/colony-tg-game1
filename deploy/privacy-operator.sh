#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset CDPATH ENV BASH_ENV COMPOSE_FILE COMPOSE_PROJECT_NAME DOCKER_HOST DOCKER_CONTEXT
if [[ "${EUID}" -ne 0 ]]; then printf 'Privacy operations require the server operator.\n' >&2; exit 1; fi
for command in docker flock stat readlink python3 curl; do command -v "$command" >/dev/null; done
operation="${1:-}"
case "$operation" in init|plan|erase-active|backup|retirement-plan|retire-backups|evidence|restore-sanitized|completion-template|complete) ;; *) printf 'Unknown or missing privacy operation.\n' >&2; exit 2;; esac

prepare_lock() {
  local filename="$1"
  if (set -o noclobber; : > "$filename") 2>/dev/null; then chmod 0600 -- "$filename"; fi
  [[ ! -L "$filename" && -f "$filename" && "$(stat -c %u -- "$filename")" == 0 && "$(stat -c %h -- "$filename")" == 1 && "$((8#$(stat -c %a -- "$filename") & 077))" == 0 ]] || { printf 'Unsafe privacy-operation lock.\n' >&2; exit 1; }
}
prepare_lock /var/lock/colony-release.lock
exec 9<>/var/lock/colony-release.lock
[[ "$(stat -c '%d:%i' /var/lock/colony-release.lock)" == "$(stat -Lc '%d:%i' /proc/$$/fd/9)" ]] || exit 1
flock -n 9 || { printf 'A deployment or privacy operation is already running.\n' >&2; exit 1; }
prepare_lock /var/lock/colony-data.lock
exec 8<>/var/lock/colony-data.lock
[[ "$(stat -c '%d:%i' /var/lock/colony-data.lock)" == "$(stat -Lc '%d:%i' /proc/$$/fd/8)" ]] || exit 1
flock -n 8 || { printf 'A backup or privacy operation is already running.\n' >&2; exit 1; }

[[ -L /opt/colony/current ]] || { printf 'Current release is not a managed link.\n' >&2; exit 1; }
release="$(readlink -f /opt/colony/current)"
[[ "$(dirname -- "$release")" == /opt/colony/releases && "$(basename -- "$release")" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ && -d "$release/deploy" && ! -L "$release" ]] || { printf 'Unexpected current release directory.\n' >&2; exit 1; }
shared_env=/opt/colony/shared/.env
[[ ! -L "$shared_env" && -f "$shared_env" && "$(stat -c %u "$shared_env")" == 0 && "$((8#$(stat -c %a "$shared_env") & 077))" == 0 ]] || { printf 'Unsafe shared environment.\n' >&2; exit 1; }
override="$release/deploy/release-image.compose.yml"
pinned_image="$(python3 - "$override" <<'PY'
import os,re,stat,sys
try:fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW)
except OSError:sys.exit('A reviewed pinned image override is required')
with os.fdopen(fd,'r',encoding='utf-8') as stream:
    info=os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)&0o022 or info.st_size>2048:
        sys.exit('Unsafe pinned image override')
    source=stream.read()
match=re.fullmatch(r'services:\s*\n  app:\s*\n    image: ([A-Za-z0-9][A-Za-z0-9._/@:-]{0,255})\s*\n  privacy-tools:\s*\n    image: ([A-Za-z0-9][A-Za-z0-9._/@:-]{0,255})\s*\n?',source)
if not match or match[1]!=match[2]:sys.exit('Application and privacy worker must use the same reviewed pinned image')
print(match[1])
PY
)"
compose=(docker compose --project-name colony-russia --project-directory "$release/deploy" -f "$release/deploy/compose.yml" -f "$release/deploy/https.compose.yml")
compose+=(-f "$override")
"${compose[@]}" config --quiet
services="$("${compose[@]}" --profile tools config --services)"
[[ $'\n'"$services"$'\n' == *$'\nprivacy-tools\n'* ]] || { printf 'This release does not provide the reviewed privacy worker.\n' >&2; exit 1; }
expected_image="$(docker image inspect "$pinned_image" --format '{{.Id}}')"
read_privacy_floor() {
python3 - /opt/colony/shared/privacy-capability-floor <<'PY'
import os,re,stat,sys
try:fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW)
except FileNotFoundError:print(0);sys.exit(0)
except OSError:sys.exit('Privacy capability floor is not readable safely')
with os.fdopen(fd,'r',encoding='ascii') as stream:
    info=os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>16:
        sys.exit('Unsafe privacy capability floor')
    value=stream.read().strip()
    if not re.fullmatch(r'[0-9]{1,6}',value):sys.exit('Invalid privacy capability floor')
    print(int(value))
PY
}
floor="$(read_privacy_floor)"
app_was_running=false
restart_needed=false
readiness_file=''
app_privacy_capability=0
check_ready() {
  local current_floor
  current_floor="$(read_privacy_floor)" || return 1
  (( current_floor >= floor )) || return 1
  curl --fail --silent --show-error --connect-timeout 3 --max-time 10 http://127.0.0.1:3000/api/ready > "$readiness_file" || return 1
  python3 - "$readiness_file" "$current_floor" <<'PY'
import json,sys
data=json.load(open(sys.argv[1],encoding='utf-8'))
capability=data.get('privacyCapability',0)
assert isinstance(capability,int) and not isinstance(capability,bool) and capability>=int(sys.argv[2]), 'Privacy capability below floor'
assert data.get('ok') is True and data.get('privacyStorage')=='ok' and all(value=='ok' for value in data.get('checks',{}).values()), 'Application or privacy journal is not ready'
PY
}
finish() {
  local code=$?
  trap - EXIT INT TERM HUP
  if [[ "$restart_needed" == true && "$app_was_running" == true ]]; then
    local restart_floor
    if ! restart_floor="$(read_privacy_floor)" || (( restart_floor < floor || app_privacy_capability < restart_floor )); then
      printf 'The exact application is below the current privacy floor or the floor cannot be verified; it remains stopped for operator review.\n' >&2
      code=1
    elif ! "${compose[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 180 app; then
      printf 'The exact privacy-capable application could not be restarted; immediate operator attention is required.\n' >&2
      code=1
    elif [[ "$(docker inspect "$("${compose[@]}" ps -q app)" --format '{{.Image}}')" != "$expected_image" ]] || ! check_ready; then
      printf 'The restarted privacy-capable application did not pass readiness; stopping it for operator review.\n' >&2
      "${compose[@]}" stop --timeout 30 app || true
      code=1
    fi
  fi
  if [[ -n "$readiness_file" && -f "$readiness_file" && ! -L "$readiness_file" ]]; then rm -- "$readiness_file"; fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

worker_environment=(-e PRIVACY_OPERATOR_LOCKED=1 -e "PRIVACY_OPERATOR_IMAGE_ID=$expected_image")
if [[ "$operation" == erase-active ]]; then
  (( floor >= 1 )) || { printf 'Install and verify the privacy capability floor before actual erasure.\n' >&2; exit 1; }
  app_id="$("${compose[@]}" ps --status running -q app)"
  [[ -n "$app_id" && "$app_id" != *$'\n'* && "$(docker inspect "$app_id" --format '{{.Image}}')" == "$expected_image" ]] || { printf 'The running application is not the exact reviewed image.\n' >&2; exit 1; }
  readiness_file="$(mktemp /run/colony-privacy-ready-XXXXXXXX)"
  check_ready
  app_privacy_capability="$(python3 - "$readiness_file" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding='utf-8'))['privacyCapability'])
PY
)"
  app_was_running=true
  restart_needed=true
  "${compose[@]}" stop --timeout 30 app
  [[ "$(docker inspect "$app_id" --format '{{.State.Running}}')" == false ]] || { printf 'Application is still running; erasure refused.\n' >&2; exit 1; }
  worker_environment+=(-e PRIVACY_OPERATOR_APP_STOPPED=1)
fi
"${compose[@]}" --profile tools run --rm --no-deps --pull never "${worker_environment[@]}" privacy-tools "$@"
