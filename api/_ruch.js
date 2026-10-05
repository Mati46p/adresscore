// Klasyfikacja ruchu po stronie serwera: rodzina bota z User-Agenta, kanał wejścia, kraj.
// Wszystko to CZYSTE funkcje (bez I/O), więc `api/_ruch.test.js` pokrywa je bez sieci.
//
// DLACZEGO NA SERWERZE. Endpoint jest publiczny, więc klient nie jest dowodem: lista hostów
// i reguł żyje w jednym miejscu i zmienia się bez wdrażania klienta (research.md R4, R5).
//
// PRYWATNOŚĆ. `rodzinaBota` dostaje surowy User-Agent i oddaje WYŁĄCZNIE nazwę rodziny
// z zamkniętej listy. Surowy UA nie wychodzi z tej funkcji w żadnej postaci: ani w wyniku,
// ani w logu. To ta sama gwarancja co w `_odcisk.js`.

/* -------------------------------------------------------------------------- */
/* Nagłówki                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Wartość nagłówka jako tekst albo null. Węzeł Node daje obiekt z małymi literami w kluczach,
 * ale test albo inny serwer może podać `Headers` (Fetch API) czy klucze w innej wielkości –
 * obsługujemy wszystkie trzy, żeby adapter nie musiał niczego normalizować. Nagłówek
 * powtórzony (tablica) → pierwsza wartość.
 */
export function naglowek(naglowki, nazwa) {
  if (!naglowki || typeof naglowki !== 'object') return null
  const klucz = nazwa.toLowerCase()
  let wartosc
  if (typeof naglowki.get === 'function') {
    wartosc = naglowki.get(klucz)
  } else {
    wartosc = naglowki[klucz]
    if (wartosc === undefined) {
      const inny = Object.keys(naglowki).find((k) => k.toLowerCase() === klucz)
      if (inny !== undefined) wartosc = naglowki[inny]
    }
  }
  if (Array.isArray(wartosc)) wartosc = wartosc[0]
  return typeof wartosc === 'string' ? wartosc : null
}

/* -------------------------------------------------------------------------- */
/* Kraj                                                                        */
/* -------------------------------------------------------------------------- */

/** Nagłówki kraju w kolejności pewności: Cloudflare przed Coolify, potem Vercel (research.md R3). */
const NAGLOWKI_KRAJU = ['cf-ipcountry', 'x-vercel-ip-country']
/** `XX` = Cloudflare nie zna kraju, `T1` = Tor. Żadne z tych nie jest krajem. */
const KRAJE_NIEZNANE = new Set(['XX', 'T1'])

/**
 * Kod kraju ISO z nagłówka hostingu albo null. Pierwszy NAGŁÓWEK Z POPRAWNĄ wartością wygrywa
 * (zły wpis z Cloudflare nie zasłania dobrego z Vercela). Wartość normalizujemy do wielkich
 * liter – check w bazie wymaga `^[A-Z]{2}$`, a proxy bywają nieuważne. Bez bazy GeoIP.
 */
export function kraj(naglowki) {
  for (const nazwa of NAGLOWKI_KRAJU) {
    const kod = naglowek(naglowki, nazwa)?.trim().toUpperCase()
    if (kod && /^[A-Z]{2}$/.test(kod) && !KRAJE_NIEZNANE.has(kod)) return kod
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Boty                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Reguły w KOLEJNOŚCI dopasowania: pierwsza pasująca wygrywa, więc konkretne przed ogólnymi.
 * `[rodzina, klasa, wzorzec]`. Rodzina to krótki slug (≤ 40 znaków, check w bazie), klasa
 * z `KLASY_BOTOW`. Wzorce są bez flagi `g` (wspólny `lastIndex` robiłby wyniki zależne od
 * kolejności wywołań).
 *
 * Pułapki, które tu mają swoje miejsce w kolejności (każda ma test):
 * - `TelegramBot (like TwitterBot)` zawiera `TwitterBot`, więc telegram stoi przed twitterem;
 * - `LinkedInBot` podaje w UA `Apache-HttpClient`, więc podglądy stoją przed narzędziami;
 * - `Applebot` ma w UA `Version/… Safari/…` jak zwykły Safari, a każda przeglądarka WebKit
 *   ma `AppleWebKit` – dlatego wzorzec to `applebot`, nigdy `apple`;
 * - `Google-Extended` to osobny token od `Googlebot`, a `ChatGPT-User` od `GPTBot`;
 * - `curl` tylko jako `curl/` po granicy słowa, żeby nazwa zawierająca „curl” nie była botem.
 */
const REGULY = [
  // --- Crawlery i agenci modeli AI (rozliczamy decyzję „wpuszczamy dla cytowań”) ---
  ['oai-searchbot', 'ai', /oai-searchbot/i],
  ['chatgpt-user', 'ai', /chatgpt-user/i],
  ['gptbot', 'ai', /gptbot/i],
  ['claude-searchbot', 'ai', /claude-searchbot/i],
  ['claude-user', 'ai', /claude-user/i],
  ['claudebot', 'ai', /claudebot/i],
  ['claude-web', 'ai', /claude-web/i],
  ['anthropic-ai', 'ai', /anthropic-ai/i],
  ['perplexity-user', 'ai', /perplexity-user/i],
  ['perplexitybot', 'ai', /perplexitybot/i],
  // Token z robots.txt; w prawdziwym UA nie występuje, ale logi proxy czasem go niosą.
  ['google-extended', 'ai', /google-extended/i],
  ['google-cloudvertexbot', 'ai', /google-cloudvertexbot/i],
  ['applebot', 'ai', /applebot/i],
  ['ccbot', 'ai', /ccbot/i],
  ['bytespider', 'ai', /bytespider/i],
  ['amazonbot', 'ai', /amazonbot/i],
  ['meta-externalagent', 'ai', /meta-externalagent/i],
  ['meta-externalfetcher', 'ai', /meta-externalfetcher/i],
  ['facebookbot', 'ai', /facebookbot/i],
  ['duckassistbot', 'ai', /duckassistbot/i],
  ['mistralai-user', 'ai', /mistralai-user/i],
  ['cohere-ai', 'ai', /cohere-ai/i],
  ['youbot', 'ai', /youbot/i],
  ['diffbot', 'ai', /diffbot/i],
  ['timpibot', 'ai', /timpibot/i],
  ['imagesiftbot', 'ai', /imagesiftbot/i],
  ['ai2bot', 'ai', /ai2bot/i],
  ['omgilibot', 'ai', /omgili/i],

  // --- Wyszukiwarki ---
  ['googlebot', 'wyszukiwarka', /googlebot/i],
  [
    'google-inny',
    'wyszukiwarka',
    /google-inspectiontool|googleother|adsbot-google|mediapartners-google|apis-google|feedfetcher-google|google-read-aloud|storebot-google|google-site-verification/i,
  ],
  ['bingbot', 'wyszukiwarka', /bingbot|msnbot|adidxbot/i],
  ['duckduckbot', 'wyszukiwarka', /duckduckbot|duckduckgo-favicons-bot/i],
  [
    'yandexbot',
    'wyszukiwarka',
    /yandex[a-z]*bot|yandex(?:images|video|media|blogs|favicons|webmaster|pagechecker|metrika|turbo|direct|adnet|sitelinks|verticals)/i,
  ],
  ['baiduspider', 'wyszukiwarka', /baiduspider/i],
  ['sogou', 'wyszukiwarka', /sogou[a-z ]*spider/i],
  ['seznambot', 'wyszukiwarka', /seznambot/i],
  ['petalbot', 'wyszukiwarka', /petalbot|aspiegelbot/i],
  ['qwantify', 'wyszukiwarka', /qwantify/i],
  ['mojeekbot', 'wyszukiwarka', /mojeekbot/i],
  ['coccocbot', 'wyszukiwarka', /coccocbot/i],
  ['exabot', 'wyszukiwarka', /exabot/i],
  ['yahoo-slurp', 'wyszukiwarka', /slurp/i],

  // --- Podglądy linków (komunikatory, serwisy społecznościowe) ---
  ['facebookexternalhit', 'podglad', /facebookexternalhit|facebot\b/i],
  ['telegrambot', 'podglad', /telegrambot/i],
  ['twitterbot', 'podglad', /twitterbot/i],
  ['slackbot', 'podglad', /slackbot|slack-imgproxy/i],
  ['linkedinbot', 'podglad', /linkedinbot/i],
  ['whatsapp', 'podglad', /whatsapp\/\d/i],
  ['discordbot', 'podglad', /discordbot/i],
  ['skypeuripreview', 'podglad', /skypeuripreview/i],
  ['pinterestbot', 'podglad', /pinterestbot|pinterest\/\d/i],
  ['redditbot', 'podglad', /redditbot/i],
  ['mastodon', 'podglad', /mastodon\/\d/i],
  ['bluesky-cardyb', 'podglad', /cardyb/i],
  ['embedly', 'podglad', /embedly/i],
  ['iframely', 'podglad', /iframely/i],
  ['bingpreview', 'podglad', /bingpreview/i],

  // --- Narzędzia i przeglądarki bez głowy ---
  // HeadlessChrome to Puppeteer, Playwright, usługi zrzutów ekranu i Lighthouse. Wykonuje JS,
  // więc odpala nasz pomiar, a człowiekiem nie jest. Fałszywie dodatni wynik kosztuje zero
  // (człowiek nie uruchamia przeglądarki w trybie headless), a bez tej reguły sztuczny ruch
  // zawyżałby unikalnych. Dlatego bot klasy `narzedzie`.
  ['headlesschrome', 'narzedzie', /headlesschrome/i],
  ['lighthouse', 'narzedzie', /lighthouse/i],
  ['pagespeed', 'narzedzie', /page speed insights|pagespeed/i],
  ['webpagetest', 'narzedzie', /ptst\/\d|webpagetest/i],
  ['gtmetrix', 'narzedzie', /gtmetrix/i],
  ['phantomjs', 'narzedzie', /phantomjs/i],
  ['automatyzacja', 'narzedzie', /puppeteer|playwright|selenium|cypress/i],
  ['curl', 'narzedzie', /(?:^|[^a-z0-9])curl\//i],
  ['wget', 'narzedzie', /(?:^|[^a-z0-9])wget\//i],
  ['python-requests', 'narzedzie', /python-requests/i],
  ['python-urllib', 'narzedzie', /python-urllib/i],
  ['python-httpx', 'narzedzie', /python-httpx/i],
  ['aiohttp', 'narzedzie', /aiohttp/i],
  ['scrapy', 'narzedzie', /scrapy/i],
  ['node-fetch', 'narzedzie', /node-fetch/i],
  ['axios', 'narzedzie', /(?:^|[^a-z0-9])axios\//i],
  ['undici', 'narzedzie', /undici/i],
  // Globalny fetch w Node 18+ przedstawia się samym „node”.
  ['node', 'narzedzie', /^node$/i],
  ['go-http-client', 'narzedzie', /go-http-client/i],
  ['okhttp', 'narzedzie', /okhttp/i],
  ['java', 'narzedzie', /^java\/|apache-httpclient|java-http-client/i],
  ['libwww-perl', 'narzedzie', /libwww-perl/i],
  ['php', 'narzedzie', /^php\//i],
  ['guzzle', 'narzedzie', /guzzlehttp/i],
  ['postman', 'narzedzie', /postmanruntime/i],
  ['httpie', 'narzedzie', /httpie/i],
  ['reqwest', 'narzedzie', /reqwest/i],
  // Crawlery narzędzi SEO.
  ['semrushbot', 'narzedzie', /semrushbot/i],
  ['ahrefsbot', 'narzedzie', /ahrefsbot|ahrefssiteaudit/i],
  ['mj12bot', 'narzedzie', /mj12bot/i],
  ['dotbot', 'narzedzie', /dotbot|rogerbot/i],
  ['screaming-frog', 'narzedzie', /screaming frog/i],
  ['blexbot', 'narzedzie', /blexbot/i],
  ['dataforseobot', 'narzedzie', /dataforseobot/i],
  ['serpstatbot', 'narzedzie', /serpstatbot/i],

  // --- Monitoring dostępności ---
  ['uptimerobot', 'monitoring', /uptimerobot/i],
  ['pingdom', 'monitoring', /pingdom/i],
  ['statuscake', 'monitoring', /statuscake/i],
  ['site24x7', 'monitoring', /site24x7/i],
  ['datadog', 'monitoring', /datadog/i],
  ['newrelic', 'monitoring', /newrelic/i],
  ['betterstack', 'monitoring', /betterstack|better uptime|betteruptime/i],
  ['nodeping', 'monitoring', /nodeping/i],
  ['freshping', 'monitoring', /freshping/i],
  ['hetrixtools', 'monitoring', /hetrixtools/i],
  ['zabbix', 'monitoring', /zabbix/i],
  ['nagios', 'monitoring', /nagios/i],
  ['kube-probe', 'monitoring', /kube-probe/i],
  ['stackdriver', 'monitoring', /stackdriver/i],
]

/**
 * Ostatnia deska ratunku dla botów spoza listy: słowa, które w UA przeglądarki człowieka
 * praktycznie się nie pojawiają, oraz adres kontaktowy `+http(s)://`, który podaje każdy
 * porządny crawler. `bot` jako sufiks po granicy słowa łapie `FooBot/1.0`, ale NIE łapie
 * marki telefonów Cubot (`Cubot P40`) – prosty wzorzec `bot` (jak w z-dykty) uznawał
 * ich właścicieli za roboty.
 */
const BOT_OGOLNY =
  /(?<!cu)bot\b|crawl|spider|scraper|archiver|fetcher|checker|validator|monitor|\+https?:\/\//i

/** Ile znaków UA przeglądamy; reszta to szum, a wzorce nie mają liczyć po kilobajtach. */
const MAX_UA_DO_DOPASOWANIA = 1024

/** Rodziny rozpoznawane po nazwie (do testu pokrycia i do przeglądu listy). */
export const RODZINY_BOTOW = Object.freeze(
  REGULY.map(([rodzina, klasa]) => Object.freeze({ rodzina, klasa })),
)

/**
 * Rozpoznaje bota po User-Agencie. Zwraca `{ czyBot, rodzina, klasa }`:
 * - człowiek: `{ false, null, null }`;
 * - pusty albo brakujący UA: bot klasy `narzedzie`, rodzina `brak-ua` – przeglądarka zawsze
 *   się przedstawia, więc brak UA to skrypt;
 * - bot spoza listy: rodzina `nieznany`, klasa `inny` (jedna pozycja w tabeli crawlerów
 *   zamiast surowych ciągów, których zresztą zapisywać nie wolno).
 */
export function rodzinaBota(ua) {
  if (typeof ua !== 'string' || ua.trim() === '') {
    return { czyBot: true, rodzina: 'brak-ua', klasa: 'narzedzie' }
  }
  const tekst = ua.length > MAX_UA_DO_DOPASOWANIA ? ua.slice(0, MAX_UA_DO_DOPASOWANIA) : ua
  for (const [rodzina, klasa, wzorzec] of REGULY) {
    if (wzorzec.test(tekst)) return { czyBot: true, rodzina, klasa }
  }
  if (BOT_OGOLNY.test(tekst)) return { czyBot: true, rodzina: 'nieznany', klasa: 'inny' }
  return { czyBot: false, rodzina: null, klasa: null }
}

/* -------------------------------------------------------------------------- */
/* Hosty i kanał wejścia                                                       */
/* -------------------------------------------------------------------------- */

/** Host małymi literami, bez końcowej kropki i bez `www.` (port zostaje). */
export function normalizujHost(host) {
  if (typeof host !== 'string') return ''
  return host
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '')
}

const bezPortu = (host) => host.replace(/:\d{1,5}$/, '')
/** `host` to `domena` albo jej subdomena (nie: `nietiktok.com` dla `tiktok.com`). */
const pasujeDomena = (host, domena) => host === domena || host.endsWith(`.${domena}`)
const naLiscie = (host, domeny) => domeny.some((d) => pasujeDomena(host, d))

/**
 * Hosty, dla których ścieżka referera jest identyfikatorem treści PUBLICZNEJ (post, wątek).
 * Dla pozostałych zapisujemy sam host: nagłówek `Referer` bywa nośnikiem cudzych danych
 * (ścieżki intranetu, tokeny w webmailu). Czaty AI są poza listą celowo: `chatgpt.com/c/<id>`
 * to prywatna rozmowa. Lista jak w z-dykty (lib/zrodla-ruchu.ts); klient ma własną kopię
 * w src/pomiar/zrodlo.ts, a serwer przycina po raz drugi, bo klientowi nie wolno ufać.
 */
export const HOSTY_PUBLICZNE = Object.freeze([
  't.co',
  'x.com',
  'twitter.com',
  'facebook.com',
  'fb.me',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'redd.it',
  'wykop.pl',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'lnkd.in',
  'news.ycombinator.com',
  'bsky.app',
  'mastodon.social',
  'threads.net',
  'threads.com',
  'medium.com',
  'substack.com',
])

/** Czy dla tego hosta wolno zachować ścieżkę referera. */
export function czyHostPubliczny(host) {
  return naLiscie(bezPortu(normalizujHost(host)), HOSTY_PUBLICZNE)
}

const DOMENY_AI = [
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'you.com',
  'poe.com',
  'grok.com',
  'meta.ai',
  'chat.mistral.ai',
  'chat.deepseek.com',
  'phind.com',
  'duck.ai',
]

// Google tylko jako `google.<tld>`: `mail.google.com`, `docs.google.com` czy `news.google.com`
// to nie wyszukiwarka, a dopasowanie po sufiksie `google.com` uznałoby je za nią.
const WZORCE_SZUKAREK = [
  /^google\.[a-z]{2,3}(?:\.[a-z]{2})?$/,
  /^yandex\.[a-z]{2,3}(?:\.[a-z]{2})?$/,
]
// Aplikacja Google na Androidzie podaje jako referer identyfikator pakietu, nie host.
const DOKLADNE_SZUKARKI = new Set(['com.google.android.googlequicksearchbox'])
const DOMENY_SZUKAREK = [
  'bing.com',
  'duckduckgo.com',
  'search.yahoo.com',
  'ecosia.org',
  'search.brave.com',
  'qwant.com',
  'startpage.com',
  'ask.com',
  'baidu.com',
  'seznam.cz',
  'search.naver.com',
]

const DOMENY_SOCIAL = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  't.co',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'lnkd.in',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'reddit.com',
  'redd.it',
  'pinterest.com',
  'pin.it',
  'threads.net',
  'threads.com',
  'bsky.app',
  'mastodon.social',
  'news.ycombinator.com',
  'wykop.pl',
  't.me',
  'telegram.me',
  'telegram.org',
  'whatsapp.com',
  'wa.me',
  'discord.com',
  'discordapp.com',
  'snapchat.com',
  'vk.com',
  'tumblr.com',
  'messenger.com',
]

/** Kanał po samym hoście: `ai` | `wyszukiwarka` | `social` albo null (nieznany host). AI pierwsze. */
function kanalHosta(hostZPortem) {
  const host = bezPortu(hostZPortem)
  if (naLiscie(host, DOMENY_AI)) return 'ai'
  if (
    DOKLADNE_SZUKARKI.has(host) ||
    WZORCE_SZUKAREK.some((wzorzec) => wzorzec.test(host)) ||
    naLiscie(host, DOMENY_SZUKAREK)
  ) {
    return 'wyszukiwarka'
  }
  if (naLiscie(host, DOMENY_SOCIAL)) return 'social'
  return null
}

// `utm_source` bywa nazwą („facebook”) albo hostem („chatgpt.com” – tak ChatGPT oznacza
// linki wychodzące).
const ZRODLA_AI = new Set([
  'chatgpt',
  'openai',
  'perplexity',
  'claude',
  'gemini',
  'copilot',
  'bard',
  'grok',
  'deepseek',
  'mistral',
  'poe',
  'phind',
])
const ZRODLA_SZUKAREK = new Set([
  'google',
  'bing',
  'duckduckgo',
  'ddg',
  'yahoo',
  'yandex',
  'baidu',
  'ecosia',
  'brave',
  'qwant',
  'startpage',
  'seznam',
])
const ZRODLA_SOCIAL = new Set([
  'facebook',
  'fb',
  'instagram',
  'ig',
  'tiktok',
  'twitter',
  'x',
  'linkedin',
  'youtube',
  'yt',
  'reddit',
  'pinterest',
  'threads',
  'bluesky',
  'bsky',
  'mastodon',
  'wykop',
  'telegram',
  'whatsapp',
  'discord',
  'snapchat',
  'vk',
  'tumblr',
  'messenger',
  'hn',
])

function kanalZeZrodlaUtm(zrodlo) {
  if (!zrodlo) return null
  const token = zrodlo.replace(/^www\./, '')
  if (token.includes('.')) {
    const poHoscie = kanalHosta(token)
    if (poHoscie) return poHoscie
  }
  const rdzen = token.split('.')[0] ?? ''
  if (ZRODLA_AI.has(rdzen)) return 'ai'
  if (ZRODLA_SZUKAREK.has(rdzen)) return 'wyszukiwarka'
  if (ZRODLA_SOCIAL.has(rdzen)) return 'social'
  return null
}

/** `utm_medium` oznaczający płatną kampanię (R5: cpc/paid → kampania). */
const MEDIUM_PLATNE =
  /^(?:cpc|ppc|cpm|cpv|cpa|cpl|display|banner|retargeting|remarketing|sponsored|ads?|affiliate|paid.*|.*[-_ ]paid)$/
const MEDIUM_SOCIAL = /^(?:social|social[-_ ]?media|social[-_ ]?network|sm|organic[-_ ]?social)$/

function kanalZMedium(medium) {
  if (MEDIUM_SOCIAL.test(medium)) return 'social'
  if (medium === 'referral') return 'odeslanie'
  if (medium === 'organic') return 'wyszukiwarka'
  return null
}

/**
 * Identyfikatory kliknięcia dokładane WYŁĄCZNIE do reklam: gclid (Google Ads), msclkid
 * (Microsoft Ads), ttclid (TikTok Ads), li_fat_id (LinkedIn Ads) → `kampania`. `fbclid`
 * Facebook dokleja do KAŻDEGO linku wychodzącego, także organicznego, więc to `social`.
 * Zapisujemy tylko nazwę parametru; wartość jest unikalna per kliknięcie, czyli byłaby
 * trwałym identyfikatorem człowieka.
 */
const CLICK_ID_REKLAMOWE = new Set(['gclid', 'msclkid', 'ttclid', 'li_fat_id'])

const maly = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '')

/**
 * Kanał wejścia dla odsłony (research.md R5). Sygnały w kolejności pewności:
 *  1. płatny `utm_medium` albo reklamowy click-id → `kampania`;
 *  2. `utm_source` rozpoznany jako AI / wyszukiwarka / social → ten kanał;
 *  3. `utm_medium` (social, referral, organic), potem `fbclid` → `social`;
 *  4. jakikolwiek inny znacznik UTM → `kampania` (ktoś świadomie oznaczył link);
 *  5. referer: brak → `bezposrednie`, własny host → `wewnetrzne`, AI / wyszukiwarka / social
 *     wg hosta, każdy inny host → `odeslanie`.
 * Znacznik w adresie wygrywa z refererem, bo mówi, kto link oznaczył, a referer bywa
 * pośrednikiem (płatna reklama na Facebooku ma referer `l.facebook.com`, czyli „social”).
 * `wlasnyHost` to host albo lista hostów serwisu; `www.` nie ma znaczenia. Zawsze zwraca
 * jedną z siedmiu wartości z `KANALY`.
 */
export function kanal({ rh, us, um, uc, ci, wlasnyHost } = {}) {
  const zrodlo = maly(us)
  const medium = maly(um)
  const kampania = maly(uc)
  const clickId = maly(ci)

  if (medium && MEDIUM_PLATNE.test(medium)) return 'kampania'
  if (CLICK_ID_REKLAMOWE.has(clickId)) return 'kampania'
  const poZrodle = kanalZeZrodlaUtm(zrodlo)
  if (poZrodle) return poZrodle
  const poMedium = kanalZMedium(medium)
  if (poMedium) return poMedium
  if (clickId === 'fbclid') return 'social'
  if (zrodlo || medium || kampania) return 'kampania'

  const hostZPortem = normalizujHost(rh)
  if (!hostZPortem) return 'bezposrednie'
  const host = bezPortu(hostZPortem)
  const wlasne = [wlasnyHost ?? []].flat().map(normalizujHost).filter(Boolean)
  if (wlasne.some((w) => w === hostZPortem || w === host)) return 'wewnetrzne'
  return kanalHosta(hostZPortem) ?? 'odeslanie'
}
