#!/usr/bin/env bash
# Install root-owned as /usr/local/sbin/colony-deploy; sudo may invoke only this file.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset CDPATH ENV BASH_ENV
[[ "$EUID" -eq 0 && "$#" -eq 1 ]] || { printf 'Restricted COLONY deployment command.\n' >&2; exit 2; }
if [[ "$1" =~ ^deploy\ ([0-9a-f]{40})\ ([1-9][0-9]{0,19})$ ]]; then
  exec /usr/local/lib/colony/release.sh "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi
printf 'Only deploy <full SHA> <successful main CI run ID> is allowed.\n' >&2
exit 2
