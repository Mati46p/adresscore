#!/usr/bin/env bash
# Wdrożenie produkcji: kolejka Deploy w Coolify (aplikacja `adresscore`, docs/hetzner.md) przez SSH
# i czekanie na wynik. Woła go globalny automat (`wdroz.mjs deploy`, pole `automat.deploy` w rejestrze).
# Coolify nie ma tu tokenu API, więc kolejkujemy przez `artisan tinker` w kontenerze panelu.
set -euo pipefail

HOST="${WDROZ_SSH:-zdykty-prod}"
APP="klama2fggdmulqn2lqemd9al"
SSH=(ssh -o BatchMode=yes -o ServerAliveInterval=30 "$HOST")

tinker() {
  "${SSH[@]}" "docker exec coolify php artisan tinker --execute=$(printf '%q' "$1")"
}

ODP=$(tinker "\$a=App\\Models\\Application::where('uuid','$APP')->first(); echo json_encode(queue_application_deployment(application: \$a, deployment_uuid: (string) new Visus\\Cuid2\\Cuid2(), force_rebuild: false));")
UUID=$(printf '%s' "$ODP" | grep -oE '"deployment_uuid":"[a-z0-9]+"' | cut -d'"' -f4)
[ -n "$UUID" ] || { echo "Coolify nie przyjął wdrożenia: $ODP" >&2; exit 1; }
echo "Wdrożenie w kolejce: $UUID"

# Budowanie trwa kilka minut; limit 20 min.
for _ in $(seq 1 120); do
  STAN=$(tinker "echo App\\Models\\ApplicationDeploymentQueue::where('deployment_uuid','$UUID')->value('status');" | tr -d '[:space:]')
  case "$STAN" in
    finished) echo "Wdrożenie zakończone."; exit 0 ;;
    failed|cancelled*) echo "Wdrożenie: $STAN (log w panelu Coolify)." >&2; exit 1 ;;
  esac
  sleep 10
done
echo "Wdrożenie nie skończyło się w 20 min." >&2
exit 1
