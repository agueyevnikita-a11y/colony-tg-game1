#!/usr/bin/env bash
# Run only in the disposable, socket-free Linux fixture described below.
set -euo pipefail
umask 077

[[ "${COLONY_PRIVACY_HOST_FIXTURE:-}" == 1 && "${EUID}" == 0 && -f /.dockerenv && ! -e /var/run/docker.sock && ! -e /run/docker.sock ]] || {
  printf 'Refusing host-safety fixture outside an explicit socket-free root Docker container.\n' >&2; exit 90;
}
for executable in bash python3 flock stat readlink; do command -v "$executable" >/dev/null; done
python3 - <<'PY'
import os,pathlib,shutil,sys
def refuse():sys.exit('Refusing fixture: unexpected mounts, privileges or existing operator files')
if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'):refuse()
if {entry.name for entry in pathlib.Path('/sys/class/net').iterdir()}!={'lo'}:refuse()
capabilities=int(next(line.split(':',1)[1].strip() for line in open('/proc/self/status') if line.startswith('CapEff:')),16)
if capabilities & (1<<21):refuse() # A privileged/host-management container is not a test target.
allowed_files={'/etc/hosts','/etc/hostname','/etc/resolv.conf'}
source_readonly=False
for line in open('/proc/self/mountinfo',encoding='utf-8'):
    fields=line.split();point=fields[4].replace('\\040',' ');kind=fields[fields.index('-')+1]
    if point=='/':
        if kind not in ('overlay','fuse.overlayfs'):refuse()
    elif point=='/source' or point.startswith('/source/'):
        if 'ro' not in fields[5].split(','):refuse()
        if point=='/source':source_readonly=True
    elif point in allowed_files or point in ('/proc','/sys','/dev') or point.startswith(('/proc/','/sys/','/dev/')):pass
    else:refuse()
if not source_readonly or os.path.realpath('/source')!='/source':refuse()
if os.path.lexists('/opt/colony') or os.path.lexists('/usr/bin/docker') or os.path.lexists('/usr/bin/curl'):refuse()
if any(shutil.which(name,path='/usr/sbin:/usr/bin:/sbin:/bin') for name in ('docker','curl')):refuse()
source=pathlib.Path('/source/deploy/privacy-operator.sh')
if source.is_symlink() or not source.is_file():refuse()
PY

# Every writable path below is now proven to belong to this fresh container.
fixture_state="$(mktemp -d /tmp/colony-privacy-host-XXXXXXXX)"
export COLONY_PRIVACY_MOCK_STATE="$fixture_state"
export COLONY_PRIVACY_MOCK_IMAGE_ID="sha256:$(printf '%064d' 0 | tr 0 a)"
fixture_release=/opt/colony/releases/fixture
fixture_wrapper="$fixture_state/privacy-operator.sh"
mkdir -p "$fixture_release/deploy" /opt/colony/shared /var/lock
python3 - "$fixture_wrapper" <<'PY'
import pathlib,sys
source=pathlib.Path('/source/deploy/privacy-operator.sh').read_text(encoding='utf-8')
pathlib.Path(sys.argv[1]).write_text(source.replace('\r\n','\n'),encoding='utf-8')
PY
chmod 0700 "$fixture_wrapper"
bash -n "$fixture_wrapper"
ln -s "$fixture_release" /opt/colony/current
printf 'FIXTURE_ONLY_NOT_A_REAL_SECRET=1\n' > /opt/colony/shared/.env
printf 'services: {}\n' > "$fixture_release/deploy/compose.yml"
printf 'services: {}\n' > "$fixture_release/deploy/https.compose.yml"
touch "$fixture_state/trace"

cat > /usr/bin/docker <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[[ "${COLONY_PRIVACY_HOST_FIXTURE:-}" == 1 && -f /.dockerenv && ! -e /var/run/docker.sock ]] || exit 91
mock_state="${COLONY_PRIVACY_MOCK_STATE:?}"
mock_image="${COLONY_PRIVACY_MOCK_IMAGE_ID:?}"
[[ "$mock_state" == /tmp/colony-privacy-host-* && -d "$mock_state" ]] || exit 91
record_trace() { printf '%s\n' "$1" >> "$mock_state/trace"; }
if [[ "${1:-}" == image && "${2:-}" == inspect ]]; then
  [[ "${3:-}" == colony-russia:fixture-image && "${4:-}" == --format && "${5:-}" == '{{.Id}}' && "$#" == 5 ]] || exit 92
  printf '%s\n' "$mock_image"; exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  [[ "${2:-}" == fixture-app && "${3:-}" == --format && "$#" == 4 ]] || exit 92
  case "$4" in '{{.Image}}') printf '%s\n' "$mock_image";; '{{.State.Running}}') cat "$mock_state/running";; *) exit 92;; esac
  exit 0
fi
[[ "${1:-}" == compose ]] || exit 92
shift
has_override=false
has_tools_profile=false
while (( $# )); do
  case "$1" in
    --project-name|--project-directory) [[ $# -ge 2 ]] || exit 92; shift 2;;
    --profile) [[ $# -ge 2 ]] || exit 92; if [[ "$2" == tools ]]; then has_tools_profile=true; fi; shift 2;;
    -f) [[ $# -ge 2 ]] || exit 92; if [[ "$2" == /opt/colony/releases/fixture/deploy/release-image.compose.yml ]]; then has_override=true; fi; shift 2;;
    config|ps|stop|up|run) mock_action="$1"; shift; break;;
    *) exit 92;;
  esac
done
[[ "$has_override" == true ]] || { record_trace 'UNPINNED_COMPOSE'; exit 92; }
case "${mock_action:-}" in
  config)
    case "${1:-}" in --quiet) exit 0;; --services) printf 'app\n'; if [[ "$has_tools_profile" == true ]]; then printf 'privacy-tools\n'; fi; exit 0;; *) exit 92;; esac;;
  ps)
    [[ "${*: -1}" == app ]] || exit 92
    if [[ "$(cat "$mock_state/running")" == true ]]; then printf 'fixture-app\n'; fi;;
  stop)
    [[ "$*" == '--timeout 30 app' ]] || exit 92
    record_trace 'STOP colony-russia:fixture-image'
    printf 'false\n' > "$mock_state/running";;
  up)
    [[ "$*" == '-d --no-deps --no-build --pull never --wait --wait-timeout 180 app' ]] || exit 92
    record_trace 'RESTART colony-russia:fixture-image'
    printf 'true\n' > "$mock_state/running";;
  run)
    [[ "$has_tools_profile" == true ]] || exit 92
    locked=0;stopped=0;image_id='';pull_never=false
    while (( $# )); do
      case "$1" in
        --rm|--no-deps) shift;;
        --pull) [[ "${2:-}" == never ]] || exit 92; pull_never=true; shift 2;;
        -e)
          case "${2:-}" in PRIVACY_OPERATOR_LOCKED=1) locked=1;; PRIVACY_OPERATOR_APP_STOPPED=1) stopped=1;; PRIVACY_OPERATOR_IMAGE_ID=*) image_id="${2#*=}";; *) exit 92;; esac
          shift 2;;
        privacy-tools) shift; break;;
        *) exit 92;;
      esac
    done
    mock_operation="${1:-}"
    [[ "$locked" == 1 && "$image_id" == "$mock_image" && "$pull_never" == true ]] || { record_trace 'INVALID_WORKER_FLAGS'; exit 93; }
    if [[ "$mock_operation" == erase-active ]]; then
      [[ "$stopped" == 1 && "$(cat "$mock_state/running")" == false ]] || { record_trace 'WORKER_WITH_LIVE_APP'; exit 93; }
    fi
    record_trace "WORKER $mock_operation LOCKED=$locked STOPPED=$stopped IMAGE=$image_id"
    if [[ "$(cat "$mock_state/advance-floor")" == 1 ]]; then printf '2\n' > /opt/colony/shared/privacy-capability-floor; chmod 0600 /opt/colony/shared/privacy-capability-floor; fi
    exit "$(cat "$mock_state/worker-exit")";;
  *) exit 92;;
esac
MOCK_DOCKER

cat > /usr/bin/curl <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
[[ "${COLONY_PRIVACY_HOST_FIXTURE:-}" == 1 && -f /.dockerenv && ! -e /var/run/docker.sock ]] || exit 91
mock_state="${COLONY_PRIVACY_MOCK_STATE:?}"
[[ "$mock_state" == /tmp/colony-privacy-host-* && -d "$mock_state" && "${!#}" == http://127.0.0.1:3000/api/ready ]] || exit 94
[[ "$(cat "$mock_state/running")" == true ]] || exit 7
capability="$(cat "$mock_state/ready-capability")"
[[ "$capability" =~ ^[0-9]+$ ]] || exit 94
printf 'READY %s\n' "$capability" >> "$mock_state/trace"
printf '{"ok":true,"privacyCapability":%s,"privacyStorage":"ok","checks":{"configuration":"ok","database":"ok","schema":"ok"}}\n' "$capability"
MOCK_CURL
chmod 0755 /usr/bin/docker /usr/bin/curl
bash -n /usr/bin/docker
bash -n /usr/bin/curl

reset_fixture() {
  : > "$fixture_state/trace"
  printf 'true\n' > "$fixture_state/running"
  printf '1\n' > "$fixture_state/ready-capability"
  printf '0\n' > "$fixture_state/worker-exit"
  printf '0\n' > "$fixture_state/advance-floor"
  rm -f -- /opt/colony/shared/privacy-capability-floor
  printf '1\n' > /opt/colony/shared/privacy-capability-floor
  chmod 0600 /opt/colony/shared/privacy-capability-floor
  printf 'services:\n  app:\n    image: colony-russia:fixture-image\n  privacy-tools:\n    image: colony-russia:fixture-image\n' > "$fixture_release/deploy/release-image.compose.yml"
  chmod 0600 "$fixture_release/deploy/release-image.compose.yml"
}
run_wrapper() {
  if bash "$fixture_wrapper" "$@" > "$fixture_state/output.log" 2>&1; then wrapper_status=0; else wrapper_status=$?; fi
}
assert_result() {
  local scenario="$1"
  if ! python3 - "$fixture_state" "$scenario" "$wrapper_status" "$COLONY_PRIVACY_MOCK_IMAGE_ID" <<'PY'
import pathlib,sys
root=pathlib.Path(sys.argv[1]);scenario=sys.argv[2];code=int(sys.argv[3]);image=sys.argv[4]
trace=(root/'trace').read_text().splitlines();running=(root/'running').read_text().strip()
actions=[line for line in trace if not line.startswith('READY ')]
stop='STOP colony-russia:fixture-image';restart='RESTART colony-russia:fixture-image'
erase=f'WORKER erase-active LOCKED=1 STOPPED=1 IMAGE={image}'
if scenario in ('old-capability','floor-symlink','different-pins'):
    assert code!=0 and running=='true' and stop not in trace and restart not in trace
    assert not any(line.startswith('WORKER ') for line in trace)
    if scenario=='old-capability':assert trace and all(line=='READY 0' for line in trace)
    else:assert trace==[]
elif scenario=='worker-failure':
    assert code==37 and running=='true'
    assert actions==[stop,erase,restart],trace
    assert trace.index('READY 1')<trace.index(stop) and len(trace)-1-trace[::-1].index('READY 1')>trace.index(restart),trace
elif scenario=='raised-floor':
    assert code!=0 and running=='false'
    assert actions==[stop,erase] and trace.index('READY 1')<trace.index(stop),trace
    assert pathlib.Path('/opt/colony/shared/privacy-capability-floor').read_text().strip()=='2'
elif scenario=='plan-read-only':
    assert code==0 and running=='true'
    assert actions==[f'WORKER plan LOCKED=1 STOPPED=0 IMAGE={image}'],trace
else:raise AssertionError('Unknown fixture scenario')
PY
  then
    printf 'FAIL %s\n' "$scenario" >&2
    cat "$fixture_state/output.log" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$scenario"
}

reset_fixture
printf '0\n' > "$fixture_state/ready-capability"
run_wrapper erase-active --fixture-only
assert_result old-capability

reset_fixture
printf '1\n' > "$fixture_state/floor-target"
chmod 0600 "$fixture_state/floor-target"
rm -- /opt/colony/shared/privacy-capability-floor
ln -s "$fixture_state/floor-target" /opt/colony/shared/privacy-capability-floor
run_wrapper erase-active --fixture-only
assert_result floor-symlink

reset_fixture
printf 'services:\n  app:\n    image: colony-russia:fixture-image\n  privacy-tools:\n    image: colony-russia:other-image\n' > "$fixture_release/deploy/release-image.compose.yml"
run_wrapper erase-active --fixture-only
assert_result different-pins

reset_fixture
printf '37\n' > "$fixture_state/worker-exit"
run_wrapper erase-active --fixture-only
assert_result worker-failure

reset_fixture
printf '1\n' > "$fixture_state/advance-floor"
run_wrapper erase-active --fixture-only
assert_result raised-floor

reset_fixture
run_wrapper plan --fixture-only
assert_result plan-read-only

printf 'Host safety fixture: 6 scenarios passed; no Docker, database or network operation was executed.\n'
