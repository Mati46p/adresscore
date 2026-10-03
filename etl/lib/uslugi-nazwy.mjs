// Czy nazwa lokalu wygląda na dane osoby fizycznej (#104). Pliki punktów są publiczne, a małe salony,
// gabinety i sklepy bardzo często noszą imię i nazwisko właściciela („Anna Tyrka Hair Stylist",
// „Lek. Maciej Haberka"). Nazwa lokalu trafia do pliku tylko wtedy, gdy NIE wygląda na osobę.
// To heurystyka, nie gwarancja: samo nazwisko („Stawiarski") albo nietypowe imię przejdą. Dlatego
// z CEIDG nazw nie bierzemy w ogóle, a ta funkcja chroni nazwy z OSM, Overture i rejestrów.

const rozbij = (s) =>
  String(s ?? '')
    .split(/[\s.,;:"„”'`()\-–/&|]+/)
    .filter(Boolean)

const zlozone = (s) =>
  s
    .toLocaleLowerCase('pl')
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

const zbior = (tekst) => new Set(tekst.split(/\s+/).filter(Boolean))

/** Popularne polskie imiona (bez ogonków, małymi literami) – kobiece i męskie. */
const IMIONA = zbior(`
  anna maria katarzyna malgorzata agnieszka barbara ewa krystyna magdalena elzbieta joanna zofia teresa
  jadwiga danuta halina irena janina monika aleksandra beata dorota marta renata iwona grazyna jolanta
  urszula agata karolina justyna natalia paulina patrycja weronika julia oliwia maja zuzanna hanna helena
  alicja wanda bozena stanislawa lucyna gabriela edyta sylwia aneta izabela ilona kinga milena klaudia
  daria emilia wiktoria laura lena nikola olga basia kasia gosia magda ania asia ewelina jagoda lidia
  liliana malwina marlena marzena mirosława miroslawa nadia nina otylia pelagia roksana sabina sandra
  stefania tamara wioletta zenona
  jan andrzej piotr krzysztof stanislaw tomasz pawel jozef marcin marek michal grzegorz jerzy tadeusz
  adam lukasz zbigniew ryszard dariusz henryk mariusz kazimierz wojciech robert mateusz marian rafal
  jacek janusz miroslaw maciej slawomir jaroslaw kamil wieslaw roman wladyslaw jakub artur zdzislaw
  edward mieczyslaw damian dawid przemyslaw sebastian czeslaw leszek daniel waldemar bartosz szymon
  bogdan adrian filip konrad kacper patryk igor hubert oskar radoslaw antoni franciszek ignacy leon
  aleksander eryk dominik emil fabian gabriel gustaw lech maksymilian norbert olaf remigiusz stefan
  tymon witold zygmunt wiktor sylwester bronislaw bernard boguslaw bohdan cezary ireneusz lucjan
  marcel mikolaj nikodem oliwier rafal seweryn tobiasz wincenty
`)

/**
 * Słowa firmowe: same w sobie nie wskazują osoby („Studio", „Hair", „Apteka"), więc „imię + takie słowo"
 * („Marta Cafe", „Daria Fryzjerstwo i Kosmetyka") nie jest jeszcze nazwiskiem.
 */
const FIRMOWE = zbior(`
  salon salony studio centrum klinika gabinet gabinety apteka apteki sklep sklepy piekarnia piekarnie
  cukiernia kawiarnia fryzjer fryzjerski fryzjerska fryzjerskie fryzjerstwo fryzjerzy kosmetyka kosmetyczny
  kosmetyczna kosmetologia barber barbershop barbieria shop hair hairs hairdresser stylist styl style
  stylizacja spa nails nail beauty makeup make up medycyna medyczne medyczny medical clinic zdrowia
  rodzinna rodzinny rodzinne lekarz lekarze praktyka przychodnia poradnia punkt delikatesy market
  minimarket express mini super fryzjernia fryzury fryzur pracownia urody uroda cafe coffee kawa
  bakery piekarz piekarski cukiernicza dom domowe pod przy dla oraz and the krakow krakowie
  sp zoo sc sj jawna spolka ltd gmbh
  sw swiety swieta swietej swietego zdrowie nasz nasza nasze deli bis
  i w z u na do od o ze we
`)

const SLOWA_TYTULOW = zbior('lek lekarz dr mgr prof inz')

/** Tytuł naukowy lub zawodowy tuż przed wielką literą: „Lek. Maciej", „Dr Grzesiak", „mgr Andrzej". */
const TYTUL_I_NAZWISKO =
  /(?:^|[\s(])(?:[Ll]ek|[Ll]ekarz|[Dd]r|DR|[Mm]gr|MGR|[Pp]rof|[Ii]nż)\.?\s+(\p{Lu}\p{Ll}+)/gu
const INDYWIDUALNA = /\bindywidualn\w*\s+praktyk\w*/iu
/** Marki z „Dr" w nazwie, które nie są osobą (sieć aptek Dr.Max). */
const MARKA_Z_TYTULEM = /\bdr\.?\s*max\b/i

/**
 * Czy nazwa wygląda na osobę fizyczną: tytuł + nazwisko, „indywidualna praktyka" albo popularne imię
 * obok wielkoliterowego słowa, które nie jest ani imieniem, ani słowem firmowym („Barbara Żurek").
 */
export function wygladaNaOsobe(nazwa) {
  const n = String(nazwa ?? '')
  if (!n.trim()) return false
  if (MARKA_Z_TYTULEM.test(n)) return false
  if (INDYWIDUALNA.test(n)) return true
  // Tytuł i słowo po nim, które nie jest słowem firmowym („Dr Zdrowie" to nazwa, „Dr Grzesiak" to osoba).
  for (const m of n.matchAll(TYTUL_I_NAZWISKO)) if (!FIRMOWE.has(zlozone(m[1]))) return true
  const wielkie = rozbij(n).filter((s) => /^\p{Lu}\p{Ll}+/u.test(s))
  if (!wielkie.some((s) => IMIONA.has(zlozone(s)))) return false
  const inne = wielkie.filter((s) => {
    const z = zlozone(s)
    return !IMIONA.has(z) && !FIRMOWE.has(z) && !SLOWA_TYTULOW.has(z)
  })
  return inne.length > 0
}
