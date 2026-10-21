// Wdrożenie produkcji: kolejka Deploy w Coolify (aplikacja `adresscore`, docs/hetzner.md) przez SSH
// i czekanie na wynik. Woła go globalny automat (`wdroz.mjs deploy`, pole `automat.deploy` w rejestrze).
// Coolify nie ma tu tokenu API, więc kolejkujemy przez `artisan tinker` w kontenerze panelu.
// Node, nie bash: na Windows `bash` z PATH bywa pustym WSL.
import { spawnSync } from 'node:child_process'
import { setTimeout as czekaj } from 'node:timers/promises'

const HOST = process.env.WDROZ_SSH ?? 'zdykty-prod'
const APP = 'klama2fggdmulqn2lqemd9al'

function tinker(php) {
  // Kod PHP idzie przez stdin, więc nie ma cudzysłowów do ucieczki w ssh ani w powłoce serwera.
  const r = spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ServerAliveInterval=30',
      HOST,
      'docker exec -i coolify php artisan tinker',
    ],
    { input: `${php}\n`, encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error(`ssh: kod ${r.status} ${r.stderr ?? ''}`)
  return r.stdout
}

const odp = tinker(
  `$a=App\\Models\\Application::where('uuid','${APP}')->first(); echo json_encode(queue_application_deployment(application: $a, deployment_uuid: (string) new Visus\\Cuid2\\Cuid2(), force_rebuild: false));`,
)
const uuid = odp.match(/"deployment_uuid":"([a-z0-9]+)"/)?.[1]
if (!uuid) {
  console.error(`Coolify nie przyjął wdrożenia: ${odp}`)
  process.exit(1)
}
console.log(`Wdrożenie w kolejce: ${uuid}`)

// Budowanie trwa kilka minut; limit 20 min.
for (let i = 0; i < 120; i++) {
  await czekaj(10_000)
  const stan = tinker(
    `echo 'STAN='.App\\Models\\ApplicationDeploymentQueue::where('deployment_uuid','${uuid}')->value('status');`,
  ).match(/STAN=([a-z_-]+)/)?.[1]
  if (stan === 'finished') {
    console.log('Wdrożenie zakończone.')
    process.exit(0)
  }
  if (stan === 'failed' || stan?.startsWith('cancelled')) {
    console.error(`Wdrożenie: ${stan} (log w panelu Coolify).`)
    process.exit(1)
  }
}
console.error('Wdrożenie nie skończyło się w 20 min.')
process.exit(1)
