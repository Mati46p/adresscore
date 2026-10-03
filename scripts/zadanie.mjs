#!/usr/bin/env node
// Kolejka zadań dla ludzi i okien Claude'a pracujących równolegle.
// Dlaczego rezerwacja przez gałąź `zajete/NN`: etykiety i przypisania w GitHubie nie są
// atomowe – dwa okna w tej samej sekundzie wzięłyby to samo. Push nowej gałęzi z unikalnym
// commitem odbija się od gita, gdy ktoś był pierwszy (non-fast-forward), więc to jest zamek.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { hostname } from 'node:os'

const REPO = 'Mati46p/adresscore'
const GH = existsSync('C:/Program Files/GitHub CLI/gh.exe')
  ? 'C:/Program Files/GitHub CLI/gh.exe'
  : 'gh'
const KTO =
  process.env.OKNO ?? `${process.env.USERNAME ?? process.env.USER ?? 'ktos'}@${hostname()}`

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const git = (...a) => sh('git', a)
const gh = (...a) => sh(GH, a)
const sprobuj = (fn) => {
  try {
    return { ok: true, out: fn() }
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message) }
  }
}

function zadania() {
  // REST zamiast `gh issue list`: GraphQL jest zablokowany w sesjach Claude'a w chmurze.
  const json = gh(
    'api',
    '--paginate',
    '--slurp',
    `repos/${REPO}/issues?state=open&labels=gotowe&per_page=100`,
  )
  return JSON.parse(json)
    .flat()
    .filter((z) => !z.pull_request)
    .map((z) => ({
      nr: z.number,
      tytul: z.title,
      etykiety: z.labels.map((l) => l.name),
      przypisani: z.assignees.map((a) => a.login),
      // \d+, bo „E10” czytane jako E1 wskakiwało na początek kolejki
      etap: Number(/^E(\d+)/.exec(z.milestone?.title ?? '')?.[1] ?? 99),
    }))
    .sort((a, b) => a.etap - b.etap || a.nr - b.nr)
}

const komentarz = (nr, tresc) =>
  gh('api', '-X', 'POST', `repos/${REPO}/issues/${nr}/comments`, '-f', `body=${tresc}`)
function etykiety(nr, dodaj, usun) {
  gh('api', '-X', 'POST', `repos/${REPO}/issues/${nr}/labels`, '-f', `labels[]=${dodaj}`)
  sprobuj(() => gh('api', '-X', 'DELETE', `repos/${REPO}/issues/${nr}/labels/${usun}`))
}

function zajete() {
  const r = sprobuj(() => git('ls-remote', '--heads', 'origin', 'zajete/*'))
  return new Set(
    (r.ok ? r.out : '')
      .split('\n')
      .map((l) => Number(l.split('zajete/')[1]))
      .filter(Boolean),
  )
}

const slug = (t) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

function lista() {
  const z = zajete()
  for (const t of zadania()) {
    const tor = t.etykiety.find((e) => e.startsWith('tor:')) ?? ''
    console.log(
      `${z.has(t.nr) ? 'ZAJĘTE' : 'wolne '}  E${t.etap}  #${t.nr}  ${tor.padEnd(14)} ${t.tytul}${t.przypisani.length ? '  @' + t.przypisani.join(',') : ''}`,
    )
  }
}

function wez(tor) {
  git('fetch', '-q', 'origin', 'main')
  const z = zajete()
  // Zadanie przypisane komuś innemu ma właściciela – nie dublujemy cudzej pracy.
  const ja = sprobuj(() => gh('api', 'user', '--jq', '.login')).out
  const kandydaci = zadania().filter(
    (t) =>
      !z.has(t.nr) &&
      (t.przypisani.length === 0 || t.przypisani.includes(ja)) &&
      !t.etykiety.includes('zablokowane') &&
      (!tor || t.etykiety.includes(`tor:${tor}`)),
  )
  for (const t of kandydaci) {
    // Unikalny commit = zamek. Dwa okna dają różne commity, więc drugi push to non-fast-forward.
    const drzewo = git('rev-parse', 'origin/main^{tree}')
    const commit = sh('git', [
      'commit-tree',
      drzewo,
      '-p',
      'origin/main',
      '-m',
      `zajete #${t.nr} przez ${KTO} ${new Date().toISOString()}`,
    ])
    const push = sprobuj(() => git('push', '-q', 'origin', `${commit}:refs/heads/zajete/${t.nr}`))
    if (!push.ok) continue
    const galaz = `feat/${t.nr}-${slug(t.tytul)}`
    sprobuj(() => etykiety(t.nr, 'w-toku', 'gotowe'))
    sprobuj(() => komentarz(t.nr, `W toku: ${KTO}, gałąź \`${galaz}\`.`))
    console.log(JSON.stringify({ nr: t.nr, tytul: t.tytul, galaz }))
    return
  }
  console.log(
    JSON.stringify({
      nr: null,
      powod: tor ? `brak wolnych zadań w torze ${tor}` : 'brak wolnych zadań',
    }),
  )
  process.exitCode = 3
}

function scal() {
  const galaz = git('rev-parse', '--abbrev-ref', 'HEAD')
  const nr = /^feat\/(\d+)-/.exec(galaz)?.[1]
  if (!nr) throw new Error(`Gałąź ${galaz} nie wygląda na feat/NN-slug`)
  if (git('status', '--porcelain'))
    throw new Error('Niezacommitowane zmiany – najpierw commit z "Refs #NN"')
  for (let proba = 1; proba <= 5; proba++) {
    git('fetch', '-q', 'origin', 'main')
    const rebase = sprobuj(() => git('rebase', 'origin/main'))
    if (!rebase.ok) {
      sprobuj(() => git('rebase', '--abort'))
      throw new Error(
        `Konflikt przy rebase na main – rozwiąż ręcznie (Twoje pliki) albo zgłoś blokadę.\n${rebase.out}`,
      )
    }
    // verify na stanie, który faktycznie wejdzie do main
    execFileSync('pnpm', ['verify'], { stdio: 'inherit', shell: true })
    const push = sprobuj(() => git('push', 'origin', 'HEAD:main'))
    if (push.ok) {
      sprobuj(() => git('push', '-q', 'origin', '--delete', `zajete/${nr}`))
      sprobuj(() => komentarz(nr, `Scalone do main (${KTO}).`))
      sprobuj(() =>
        gh(
          'api',
          '-X',
          'PATCH',
          `repos/${REPO}/issues/${nr}`,
          '-f',
          'state=closed',
          '-f',
          'state_reason=completed',
        ),
      )
      console.log(`Scalone #${nr} do main (próba ${proba}).`)
      return
    }
    console.log(`main się przesunął – próba ${proba + 1}`)
  }
  throw new Error('Pięć wyścigów z rzędu – spróbuj za chwilę')
}

function zwolnij(nr) {
  sprobuj(() => git('push', '-q', 'origin', '--delete', `zajete/${nr}`))
  sprobuj(() => etykiety(nr, 'gotowe', 'w-toku'))
  console.log(`Zwolnione #${nr}`)
}

const [polecenie, arg] = process.argv.slice(2)
const mapa = { lista, wez, scal, zwolnij }
if (!mapa[polecenie]) {
  console.log('Użycie: pnpm zadanie lista | wez [tor] | scal | zwolnij <nr>')
  process.exit(1)
}
mapa[polecenie](arg)
