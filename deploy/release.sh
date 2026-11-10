#!/usr/bin/env bash
# Install a reviewed copy as /usr/local/lib/colony/release.sh. Never execute the downloaded copy.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset CDPATH ENV BASH_ENV COMPOSE_FILE COMPOSE_PROJECT_NAME DOCKER_HOST DOCKER_CONTEXT

repo=agueyevnikita-a11y/colony-tg-game1
root=/opt/colony
shared_env="$root/shared/.env"
sha="${1:-}"
run_id="${2:-}"
[[ "$EUID" -eq 0 && "$#" -eq 2 && "$sha" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[1-9][0-9]{0,19}$ ]] || {
  printf 'Usage (root): release.sh <full commit SHA> <successful CI run ID>\n' >&2; exit 2;
}
for command in python3 curl docker flock cmp sha256sum; do command -v "$command" >/dev/null; done
[[ -f "$shared_env" && ! -L "$shared_env" ]] || { printf 'Missing protected shared environment file.\n' >&2; exit 1; }
[[ "$(stat -c %u "$shared_env")" == 0 ]] || { printf 'Shared environment must be root-owned.\n' >&2; exit 1; }
[[ "$((8#$(stat -c %a "$shared_env") & 077))" == 0 ]] || { printf 'Shared environment permissions are too broad.\n' >&2; exit 1; }
exec 9>/var/lock/colony-release.lock
flock -n 9 || { printf 'Another COLONY release is in progress.\n' >&2; exit 1; }
old_release="$(readlink -f -- "$root/current")"
[[ -L "$root/current" && "$old_release" == "$root/releases/"* && -d "$old_release/deploy" ]] || { printf 'Unexpected current release path.\n' >&2; exit 1; }
work="$(mktemp -d "$root/shared/release-check-XXXXXXXX")"
chmod 0700 "$work"
candidate="colony-candidate-${sha:0:12}"
image="colony-russia:release-$sha"
release="$root/releases/github-$sha"
success=false
activation_started=false
candidate_started=false
old_compose=(docker compose --project-name colony-russia --project-directory "$old_release/deploy" --env-file "$shared_env" -f "$old_release/deploy/compose.yml" -f "$old_release/deploy/https.compose.yml")
rollback_compose=()
new_compose=()

verify_ci() {
  python3 - "$repo" "$sha" "$run_id" <<'PY'
import json, sys, urllib.request
repo, sha, run_id = sys.argv[1:]
def get(path):
    request=urllib.request.Request('https://api.github.com/repos/'+repo+path,headers={'Accept':'application/vnd.github+json','User-Agent':'COLONY-deploy','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)
run=get('/actions/runs/'+run_id)
assert run.get('status')=='completed' and run.get('conclusion')=='success', 'CI did not succeed'
assert run.get('event')=='push' and run.get('head_branch')=='main', 'Only main push CI may deploy'
assert run.get('path')=='.github/workflows/ci.yml', 'Unexpected workflow path'
assert run.get('head_sha')==sha, 'CI commit mismatch'
assert run.get('repository',{}).get('full_name')==repo and run.get('head_repository',{}).get('full_name')==repo, 'Repository mismatch'
assert get('/git/ref/heads/main').get('object',{}).get('sha')==sha, 'Commit is no longer current main'
print('Verified successful main CI and exact current commit '+sha)
PY
}

check_http() {
  local base="$1"
  for endpoint in health/live health ready; do
    curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$base/api/$endpoint" > "$work/health.json" || return 1
    python3 - "$work/health.json" "$version" <<'PY' || return 1
import json,sys
with open(sys.argv[1]) as stream:data=json.load(stream)
assert data.get('ok') is True and data.get('service')=='colony' and data.get('version')==sys.argv[2], 'Health or version mismatch'
assert all(value=='ok' for value in data.get('checks',{}).values()), 'Readiness checks failed'
PY
  done
}

read_flags() {
  "${old_compose[@]}" exec -T db sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1' <<'SQL'
SELECT jsonb_build_object(
  'system_settings',(SELECT coalesce(jsonb_object_agg(setting_key,value ORDER BY setting_key),'{}'::jsonb) FROM system_settings WHERE setting_key IN ('maintenance','beta_required')),
  'feature_flags',(SELECT coalesce(jsonb_agg(jsonb_build_object('flag_key',flag_key,'enabled',enabled,'rollout_percent',rollout_percent) ORDER BY flag_key),'[]'::jsonb) FROM feature_flags),
  'feature_flag_overrides',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'flag_key',flag_key,'enabled',enabled) ORDER BY user_id,flag_key),'[]'::jsonb) FROM feature_flag_overrides)
)::text;
SQL
}

read_counts() {
  "${old_compose[@]}" exec -T db sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1' <<'SQL'
SELECT jsonb_build_object('users',(SELECT count(*) FROM users),'purchases',(SELECT count(*) FROM purchases),'alliances',(SELECT count(*) FROM alliances))::text;
SQL
}

check_counts() {
  python3 - "$work/counts-before.json" "$1" <<'PY'
import json,sys
with open(sys.argv[1]) as stream:before=json.load(stream)
with open(sys.argv[2]) as stream:after=json.load(stream)
for table in ('users','purchases','alliances'):
    assert isinstance(before.get(table),int) and before[table]>=0 and isinstance(after.get(table),int), 'Invalid database count'
    assert after[table]>=before[table], 'Row count decreased for '+table+'; operator review required'
print('Existing users, purchases and alliances have not decreased.')
PY
}

db_volume() {
  docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$1"
}

finish() {
  local code=$?
  trap - EXIT INT TERM HUP
  if [[ "$success" != true && "$activation_started" == true ]]; then
    printf 'Release failed; restoring the previous application image. Database is not restored or replaced.\n' >&2
    if "${rollback_compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 app; then
      ln -s -- "$old_release" "$root/current.rollback-$sha"
      mv -Tf -- "$root/current.rollback-$sha" "$root/current"
      printf 'Previous application restored; verify its health before retrying.\n' >&2
    else
      printf 'Automatic application rollback failed; operator attention required.\n' >&2
    fi
  fi
  if [[ "$candidate_started" == true ]]; then docker rm --force "$candidate" >/dev/null 2>&1 || true; fi
  printf 'Release diagnostics retained at %s; old releases, images, backups and volumes were not deleted.\n' "$work"
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

verify_ci
"${old_compose[@]}" config --quiet
db_before="$("${old_compose[@]}" ps -q db)"
app_before="$("${old_compose[@]}" ps -q app)"
[[ -n "$db_before" && -n "$app_before" && "$db_before" != *$'\n'* && "$app_before" != *$'\n'* ]] || { printf 'Expected one running application and existing database.\n' >&2; exit 1; }
db_volume_before="$(db_volume "$db_before")"
[[ "$db_volume_before" == volume\|* ]] || { printf 'Expected a persistent named PostgreSQL volume.\n' >&2; exit 1; }
printf '%s\n' "$db_before" > "$work/database-container-before.txt"
printf '%s\n' "$db_volume_before" > "$work/database-volume-before.txt"
old_image="$(docker inspect --format '{{.Image}}' "$app_before")"
rollback_tag="colony-russia:before-${sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
docker image tag "$old_image" "$rollback_tag"
printf 'services:\n  app:\n    image: %s\n' "$rollback_tag" > "$work/rollback.compose.yml"
rollback_compose=("${old_compose[@]}" -f "$work/rollback.compose.yml")
read_flags > "$work/flags-before.json"
read_counts > "$work/counts-before.json"

if [[ -e "$release" ]]; then
  [[ ! -L "$release" && -f "$release/.colony-release-sha" && "$(cat "$release/.colony-release-sha")" == "$sha" ]] || { printf 'Existing release directory is not verified.\n' >&2; exit 1; }
else
  curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 --max-time 180 --max-filesize 314572800 "https://codeload.github.com/$repo/tar.gz/$sha" > "$work/source.tar.gz"
  mkdir -- "$release"
  python3 - "$work/source.tar.gz" "$release" "$sha" <<'PY'
import pathlib,shutil,sys,tarfile
archive,destination,sha=sys.argv[1:]
base=pathlib.Path(destination)
expected='colony-tg-game1-'+sha
with tarfile.open(archive,'r:gz') as source:
    members=source.getmembers()
    assert sum(m.size for m in members)<314572800, 'Source archive is too large'
    for member in members:
        path=pathlib.PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts and path.parts[0]==expected, 'Unsafe archive path'
        assert member.isdir() or member.isfile(), 'Links and special files are refused'
        relative=pathlib.Path(*path.parts[1:])
        if not relative.parts:continue
        assert all(not p.startswith('.env') or p=='.env.example' for p in relative.parts), 'Environment file in source archive'
        assert not any(p in ('.git','.local-data','.local-tools','node_modules') for p in relative.parts), 'Private or generated source path'
        target=base/relative
        if member.isdir():target.mkdir(parents=True,exist_ok=True)
        else:
            target.parent.mkdir(parents=True,exist_ok=True)
            with source.extractfile(member) as incoming,open(target,'xb') as output:shutil.copyfileobj(incoming,output)
            target.chmod(0o644)
PY
  printf '%s\n' "$sha" > "$release/.colony-release-sha"
fi

# Changes requiring migrations or infrastructure edits need a separately reviewed manual release.
for file in db/schema.sql Dockerfile deploy/compose.yml deploy/https.compose.yml deploy/Caddyfile deploy/provision-app-role.mjs deploy/backup.sh; do
  [[ -f "$old_release/$file" && -f "$release/$file" ]] && cmp --silent -- "$old_release/$file" "$release/$file" || { printf 'Manual review required for infrastructure/schema change: %s\n' "$file" >&2; exit 1; }
done
for file in deploy/release.sh deploy/ssh-deploy-command.sh; do
  if [[ -f "$old_release/$file" ]]; then cmp --silent -- "$old_release/$file" "$release/$file" || { printf 'Manual review required for deployment-control change: %s\n' "$file" >&2; exit 1; }; fi
done
if [[ -L "$release/deploy/.env" ]]; then
  [[ "$(readlink -f "$release/deploy/.env")" == "$shared_env" ]] || { printf 'Unexpected release environment link.\n' >&2; exit 1; }
elif [[ -e "$release/deploy/.env" ]]; then
  printf 'Unexpected release environment file.\n' >&2; exit 1
else
  ln -s -- "$shared_env" "$release/deploy/.env"
fi
printf 'services:\n  app:\n    image: %s\n' "$image" > "$release/deploy/release-image.compose.yml"
new_compose=(docker compose --project-name colony-russia --project-directory "$release/deploy" --env-file "$shared_env" -f "$release/deploy/compose.yml" -f "$release/deploy/https.compose.yml" -f "$release/deploy/release-image.compose.yml")
"${new_compose[@]}" config --quiet
version="$(python3 - "$release/package.json" <<'PY'
import json,re,sys
with open(sys.argv[1]) as stream:value=json.load(stream)['version']
assert re.fullmatch(r'[0-9][A-Za-z0-9.+-]{0,63}',value), 'Invalid version'
print(value)
PY
)"
"${new_compose[@]}" build app
"${new_compose[@]}" run --detach --no-deps --name "$candidate" --publish 127.0.0.1:3301:3000 app >/dev/null
candidate_started=true
candidate_ok=false
candidate_deadline=$((SECONDS+180))
while (( SECONDS < candidate_deadline )); do
  if check_http http://127.0.0.1:3301 >/dev/null 2>&1; then candidate_ok=true; break; fi
  sleep 2
done
[[ "$candidate_ok" == true ]] || { printf 'Candidate health/readiness failed; running application unchanged.\n' >&2; exit 1; }
docker rm --force "$candidate" >/dev/null
candidate_started=false
verify_ci
bash "$old_release/deploy/backup.sh"
read_flags > "$work/flags-pre-activation.json"
cmp --silent "$work/flags-before.json" "$work/flags-pre-activation.json" || { printf 'Access/payment/notification flags changed during preparation; review before deploying.\n' >&2; exit 1; }
read_counts > "$work/counts-pre-activation.json"
check_counts "$work/counts-pre-activation.json"
activation_started=true
"${new_compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 app
check_http http://127.0.0.1:3000
read_flags > "$work/flags-after.json"
cmp --silent "$work/flags-before.json" "$work/flags-after.json" || { printf 'Flags differ after activation.\n' >&2; exit 1; }
read_counts > "$work/counts-after.json"
check_counts "$work/counts-after.json"
[[ "$("${new_compose[@]}" ps -q db)" == "$db_before" ]] || { printf 'Database container identity changed unexpectedly.\n' >&2; exit 1; }
[[ "$(db_volume "$db_before")" == "$db_volume_before" ]] || { printf 'PostgreSQL volume identity changed unexpectedly.\n' >&2; exit 1; }
ln -s -- "$release" "$root/current.next-$sha"
mv -Tf -- "$root/current.next-$sha" "$root/current"
printf '%s\n' "$run_id" > "$release/.colony-ci-run"
success=true
printf 'COLONY %s deployed from %s; database and closed-mode flags preserved.\n' "$version" "$sha"
