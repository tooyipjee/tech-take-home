#!/usr/bin/env bash
# Live fault injection for the demo. Weakens one rule in transaction-authorization so the
# room can see whether the tests notice; --restore puts it back. Never commit the injected state.
#
#   docs/demo/inject-fault.sh ownership        # any customer may debit any account
#   docs/demo/inject-fault.sh daily-limit      # the limit check is off by one boundary
#   docs/demo/inject-fault.sh audit-masking    # audit events carry the raw customer id
#   docs/demo/inject-fault.sh --restore
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=services/java/transaction-authorization/src/main/java/com/example/bank/txauth
SVC=$SRC/AuthorizationService.java

banner() { printf '\n\033[1;33m[INJECTED FAULT] %s\033[0m\n\n' "$1"; }

case "${1:-}" in
  ownership)
    sed -i 's|if (!account.ownerCustomerId().equals(request.customerId())) {|if (false \&\& !account.ownerCustomerId().equals(request.customerId())) { // INJECTED FAULT|' "$SVC"
    banner "ownership check disabled in AuthorizationService.java" ;;
  daily-limit)
    sed -i 's|if (spent + request.amountCents() > account.dailyLimitCents()) {|if (spent + request.amountCents() > account.dailyLimitCents() + 1) { // INJECTED FAULT|' "$SVC"
    banner "daily limit now allows one request past the ceiling" ;;
  audit-masking)
    sed -i 's|Masking.mask(request.customerId()),|request.customerId(), // INJECTED FAULT|' "$SVC"
    banner "audit events now carry the unmasked customer id" ;;
  --restore)
    git checkout -- "$SRC"
    printf '\n\033[1;32m[RESTORED] %s\033[0m\n\n' "$SRC" ;;
  *)
    echo "usage: $0 ownership|daily-limit|audit-masking|--restore" >&2; exit 2 ;;
esac

git --no-pager diff --stat -- "$SRC" || true
