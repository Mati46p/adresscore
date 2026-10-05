// Uruchom: node --test api/
// Klasyfikacja ruchu bez sieci: rodzina bota z UA, kanał wejścia, kraj z nagłówków.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  czyHostPubliczny,
  HOSTY_PUBLICZNE,
  kanal,
  kraj,
  naglowek,
  normalizujHost,
  RODZINY_BOTOW,
  rodzinaBota,
} from './_ruch.js'
import { KANALY, KLASY_BOTOW } from './_zdarzenie-kontrakt.js'

const CZLOWIEK = { czyBot: false, rodzina: null, klasa: null }

/** Prawdziwe przeglądarki ludzi – żadna nie może zostać uznana za bota. */
const LUDZIE = [
  [
    'Chrome na Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  [
    'Safari na iPhonie (ma AppleWebKit i Version/ jak Applebot)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  ],
  ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'],
  [
    'Edge na Androidzie',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0',
  ],
  [
    'Samsung Internet',
    'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  ],
  [
    'przeglądarka Yandex (YaBrowser, nie YandexBot)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 YaBrowser/23.11.0.0 Safari/537.36',
  ],
  [
    'przeglądarka DuckDuckGo (nie DuckDuckBot)',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 DuckDuckGo/5',
  ],
  [
    'Instagram w aplikacji',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.22.114 (iPhone14,5; iOS 17_2; pl_PL; pl; scale=3.00; 1170x2532; 540988233)',
  ],
  [
    'Facebook w aplikacji',
    'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/443.0.0.31.113;]',
  ],
  [
    'TikTok w aplikacji',
    'Mozilla/5.0 (Linux; Android 12; SM-A525F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 musical_ly_28.5.5 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/28.5.5 ByteLocale/pl-PL BytedanceWebview/d8a21c6',
  ],
  [
    'LinkedIn w aplikacji (LinkedInApp, nie LinkedInBot)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.30.1234',
  ],
  [
    'Twitter w aplikacji (TwitterAndroid, nie Twitterbot)',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 TwitterAndroid',
  ],
  [
    'telefon Cubot (nazwa kończy się na „bot”)',
    'Mozilla/5.0 (Linux; Android 11; CUBOT_KINGKONG_5_Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  ],
  [
    'telefon Cubot z odstępem w nazwie modelu',
    'Mozilla/5.0 (Linux; Android 10; Cubot P40) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  ],
]

/**
 * Po jednym prawdziwym (albo wiernie odtworzonym) UA na rodzinę: [UA, rodzina, klasa].
 * Test niżej pilnuje, że KAŻDA rodzina z listy ma tu swój przypadek.
 */
const BOTY = [
  // --- ai ---
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'oai-searchbot',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'chatgpt-user',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
    'gptbot',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
    'claude-searchbot',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    'claude-user',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'claudebot',
    'ai',
  ],
  ['Claude-Web/1.0', 'claude-web', 'ai'],
  ['anthropic-ai', 'anthropic-ai', 'ai'],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    'perplexity-user',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    'perplexitybot',
    'ai',
  ],
  ['Mozilla/5.0 (compatible; Google-Extended)', 'google-extended', 'ai'],
  ['Mozilla/5.0 (compatible; Google-CloudVertexBot)', 'google-cloudvertexbot', 'ai'],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    'applebot',
    'ai',
  ],
  ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'ccbot', 'ai'],
  [
    'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
    'bytespider',
    'ai',
  ],
  [
    'Mozilla/5.0 AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
    'amazonbot',
    'ai',
  ],
  [
    'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    'meta-externalagent',
    'ai',
  ],
  [
    'meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    'meta-externalfetcher',
    'ai',
  ],
  [
    'Mozilla/5.0 (compatible; FacebookBot/1.0; +https://developers.facebook.com/docs/sharing/webmasters/facebookbot/)',
    'facebookbot',
    'ai',
  ],
  ['DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)', 'duckassistbot', 'ai'],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)',
    'mistralai-user',
    'ai',
  ],
  ['cohere-ai', 'cohere-ai', 'ai'],
  ['Mozilla/5.0 (compatible; YouBot/1.0; +https://about.you.com/youbot/)', 'youbot', 'ai'],
  ['Mozilla/5.0 (compatible; Diffbot/0.1; +http://www.diffbot.com)', 'diffbot', 'ai'],
  ['Mozilla/5.0 (compatible; Timpibot/0.9; +www.timpi.io)', 'timpibot', 'ai'],
  ['Mozilla/5.0 (compatible; ImagesiftBot; +imagesift.com)', 'imagesiftbot', 'ai'],
  ['Mozilla/5.0 (compatible) AI2Bot (+https://www.allenai.org/crawler)', 'ai2bot', 'ai'],
  ['Mozilla/5.0 (compatible; omgili/0.5 +http://omgili.com)', 'omgilibot', 'ai'],

  // --- wyszukiwarka ---
  [
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'googlebot',
    'wyszukiwarka',
  ],
  ['Mozilla/5.0 (compatible; Google-InspectionTool/1.0)', 'google-inny', 'wyszukiwarka'],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    'bingbot',
    'wyszukiwarka',
  ],
  ['DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)', 'duckduckbot', 'wyszukiwarka'],
  ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'yandexbot', 'wyszukiwarka'],
  [
    'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
    'baiduspider',
    'wyszukiwarka',
  ],
  [
    'Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)',
    'sogou',
    'wyszukiwarka',
  ],
  [
    'Mozilla/5.0 (compatible; SeznamBot/4.0; +http://napoveda.seznam.cz/seznambot-intro/)',
    'seznambot',
    'wyszukiwarka',
  ],
  [
    'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
    'petalbot',
    'wyszukiwarka',
  ],
  ['Mozilla/5.0 (compatible; Qwantify/2.4w; +https://www.qwant.com/)', 'qwantify', 'wyszukiwarka'],
  [
    'Mozilla/5.0 (compatible; MojeekBot/0.11; +https://www.mojeek.com/bot.html)',
    'mojeekbot',
    'wyszukiwarka',
  ],
  [
    'Mozilla/5.0 (compatible; coccocbot-web/1.0; +http://help.coccoc.com/searchengine)',
    'coccocbot',
    'wyszukiwarka',
  ],
  [
    'Mozilla/5.0 (compatible; Exabot/3.0; +http://www.exabot.com/go/robot)',
    'exabot',
    'wyszukiwarka',
  ],
  [
    'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    'yahoo-slurp',
    'wyszukiwarka',
  ],

  // --- podglad ---
  [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'facebookexternalhit',
    'podglad',
  ],
  ['TelegramBot (like TwitterBot)', 'telegrambot', 'podglad'],
  ['Twitterbot/1.0', 'twitterbot', 'podglad'],
  ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'slackbot', 'podglad'],
  [
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'linkedinbot',
    'podglad',
  ],
  ['WhatsApp/2.23.20.0 A', 'whatsapp', 'podglad'],
  ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'discordbot', 'podglad'],
  ['Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5', 'skypeuripreview', 'podglad'],
  ['Pinterest/0.2 (+http://www.pinterest.com/bot.html)', 'pinterestbot', 'podglad'],
  ['Redditbot/1.0', 'redditbot', 'podglad'],
  ['http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)', 'mastodon', 'podglad'],
  ['Bluesky Cardyb/1.1', 'bluesky-cardyb', 'podglad'],
  ['Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)', 'embedly', 'podglad'],
  ['Iframely/1.3.1 (+https://iframely.com/docs/about)', 'iframely', 'podglad'],
  [
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534+ (KHTML, like Gecko) BingPreview/1.0b',
    'bingpreview',
    'podglad',
  ],

  // --- narzedzie ---
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    'headlesschrome',
    'narzedzie',
  ],
  [
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'lighthouse',
    'narzedzie',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36 Google Page Speed Insights',
    'pagespeed',
    'narzedzie',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PTST/240101.123456',
    'webpagetest',
    'narzedzie',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 GTmetrix',
    'gtmetrix',
    'narzedzie',
  ],
  [
    'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1',
    'phantomjs',
    'narzedzie',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Playwright/1.40 Safari/537.36',
    'automatyzacja',
    'narzedzie',
  ],
  ['curl/8.4.0', 'curl', 'narzedzie'],
  ['Wget/1.21.3', 'wget', 'narzedzie'],
  ['python-requests/2.31.0', 'python-requests', 'narzedzie'],
  ['Python-urllib/3.11', 'python-urllib', 'narzedzie'],
  ['python-httpx/0.25.0', 'python-httpx', 'narzedzie'],
  ['Python/3.11 aiohttp/3.9.1', 'aiohttp', 'narzedzie'],
  ['Scrapy/2.11.0 (+https://scrapy.org)', 'scrapy', 'narzedzie'],
  ['node-fetch/1.0 (+https://github.com/bitinn/node-fetch)', 'node-fetch', 'narzedzie'],
  ['axios/1.6.2', 'axios', 'narzedzie'],
  ['undici', 'undici', 'narzedzie'],
  ['node', 'node', 'narzedzie'],
  ['Go-http-client/1.1', 'go-http-client', 'narzedzie'],
  ['okhttp/4.12.0', 'okhttp', 'narzedzie'],
  ['Java/17.0.9', 'java', 'narzedzie'],
  ['libwww-perl/6.72', 'libwww-perl', 'narzedzie'],
  ['PHP/8.2.0', 'php', 'narzedzie'],
  ['GuzzleHttp/7', 'guzzle', 'narzedzie'],
  ['PostmanRuntime/7.36.0', 'postman', 'narzedzie'],
  ['HTTPie/3.2.2', 'httpie', 'narzedzie'],
  ['reqwest/0.11.22', 'reqwest', 'narzedzie'],
  [
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'semrushbot',
    'narzedzie',
  ],
  ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'ahrefsbot', 'narzedzie'],
  ['Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)', 'mj12bot', 'narzedzie'],
  [
    'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot; help@moz.com)',
    'dotbot',
    'narzedzie',
  ],
  ['Screaming Frog SEO Spider/19.0', 'screaming-frog', 'narzedzie'],
  ['Mozilla/5.0 (compatible; BLEXBot/1.0; +http://webmeup-crawler.com/)', 'blexbot', 'narzedzie'],
  [
    'Mozilla/5.0 (compatible; DataForSeoBot/1.0; +https://dataforseo.com/dataforseo-bot)',
    'dataforseobot',
    'narzedzie',
  ],
  [
    'serpstatbot/2.1 (advanced backlink tracking bot; https://serpstatbot.com/; abuse@serpstatbot.com)',
    'serpstatbot',
    'narzedzie',
  ],

  // --- monitoring ---
  [
    'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
    'uptimerobot',
    'monitoring',
  ],
  ['Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)', 'pingdom', 'monitoring'],
  ['StatusCake', 'statuscake', 'monitoring'],
  ['Site24x7', 'site24x7', 'monitoring'],
  ['Datadog/Synthetics', 'datadog', 'monitoring'],
  ['NewRelicPinger/1.0 (123456)', 'newrelic', 'monitoring'],
  ['Better Uptime Bot', 'betterstack', 'monitoring'],
  ['NodePing', 'nodeping', 'monitoring'],
  ['Freshping', 'freshping', 'monitoring'],
  ['HetrixTools Uptime Monitoring Bot. https://hetrixtools.com/', 'hetrixtools', 'monitoring'],
  ['Zabbix', 'zabbix', 'monitoring'],
  ['check_http/v2.3.3 (nagios-plugins 2.3.3)', 'nagios', 'monitoring'],
  ['kube-probe/1.28', 'kube-probe', 'monitoring'],
  [
    'GoogleStackdriverMonitoring-UptimeChecks(https://cloud.google.com/monitoring)',
    'stackdriver',
    'monitoring',
  ],
]

describe('rodzinaBota – ludzie', () => {
  for (const [opis, ua] of LUDZIE) {
    it(`${opis} → człowiek`, () => {
      assert.deepEqual(rodzinaBota(ua), CZLOWIEK)
    })
  }
})

describe('rodzinaBota – rodziny botów', () => {
  for (const [ua, rodzina, klasa] of BOTY) {
    it(`${rodzina} → ${klasa}`, () => {
      assert.deepEqual(rodzinaBota(ua), { czyBot: true, rodzina, klasa })
    })
  }

  it('każda rodzina z listy ma w tym teście swój przypadek', () => {
    const pokryte = new Set(BOTY.map(([, rodzina]) => rodzina))
    const braki = RODZINY_BOTOW.filter(({ rodzina }) => !pokryte.has(rodzina)).map((r) => r.rodzina)
    assert.deepEqual(braki, [])
  })

  it('test nie zawiera przypadków dla nieistniejących rodzin', () => {
    const znane = new Set(RODZINY_BOTOW.map(({ rodzina }) => rodzina))
    const obce = BOTY.filter(([, rodzina]) => !znane.has(rodzina)).map(([, rodzina]) => rodzina)
    assert.deepEqual(obce, [])
  })

  it('rodziny są unikalne, mają znaną klasę i mieszczą się w kolumnie (≤ 40 znaków)', () => {
    const nazwy = RODZINY_BOTOW.map(({ rodzina }) => rodzina)
    assert.equal(new Set(nazwy).size, nazwy.length)
    for (const { rodzina, klasa } of RODZINY_BOTOW) {
      assert.ok(KLASY_BOTOW.includes(klasa), `klasa ${klasa} rodziny ${rodzina}`)
      assert.match(rodzina, /^[a-z0-9][a-z0-9.-]{0,39}$/)
    }
  })

  it('po jednej rodzinie z listy na każdą klasę poza „inny” (ta jest dla botów spoza listy)', () => {
    const klasy = new Set(RODZINY_BOTOW.map(({ klasa }) => klasa))
    for (const klasa of KLASY_BOTOW.filter((k) => k !== 'inny')) assert.ok(klasy.has(klasa), klasa)
  })
})

describe('rodzinaBota – pułapki kolejności dopasowań', () => {
  it('TelegramBot (like TwitterBot) to telegram, nie twitter', () => {
    assert.equal(rodzinaBota('TelegramBot (like TwitterBot)').rodzina, 'telegrambot')
  })

  it('LinkedInBot z „Apache-HttpClient” w UA to podgląd linkedin, nie narzędzie Java', () => {
    const w = rodzinaBota(
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    )
    assert.deepEqual(w, { czyBot: true, rodzina: 'linkedinbot', klasa: 'podglad' })
  })

  it('Applebot to bot AI mimo Safari/Version w UA, a Safari bez „Applebot” to człowiek', () => {
    const applebot = BOTY.find(([, rodzina]) => rodzina === 'applebot')?.[0] ?? ''
    assert.equal(rodzinaBota(applebot).klasa, 'ai')
    const safari = LUDZIE.find(([opis]) => opis.startsWith('Safari'))?.[1] ?? ''
    assert.equal(rodzinaBota(safari).czyBot, false)
  })

  it('samo AppleWebKit nie robi z nikogo Applebota', () => {
    assert.equal(rodzinaBota('Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko)').czyBot, false)
  })

  it('Google-Extended nie jest Googlebotem, a Googlebot nie jest Google-Extended', () => {
    assert.deepEqual(rodzinaBota('Mozilla/5.0 (compatible; Google-Extended)'), {
      czyBot: true,
      rodzina: 'google-extended',
      klasa: 'ai',
    })
    assert.equal(rodzinaBota('Mozilla/5.0 (compatible; Googlebot/2.1)').rodzina, 'googlebot')
  })

  it('ChatGPT-User, GPTBot i OAI-SearchBot to trzy osobne rodziny', () => {
    assert.equal(rodzinaBota('ChatGPT-User/1.0').rodzina, 'chatgpt-user')
    assert.equal(rodzinaBota('GPTBot/1.1').rodzina, 'gptbot')
    assert.equal(rodzinaBota('OAI-SearchBot/1.0').rodzina, 'oai-searchbot')
  })

  it('Claude-User, ClaudeBot i Claude-SearchBot to trzy osobne rodziny', () => {
    assert.equal(rodzinaBota('Claude-User/1.0').rodzina, 'claude-user')
    assert.equal(rodzinaBota('ClaudeBot/1.0').rodzina, 'claudebot')
    assert.equal(rodzinaBota('Claude-SearchBot/1.0').rodzina, 'claude-searchbot')
  })

  it('Perplexity-User i PerplexityBot to dwie rodziny', () => {
    assert.equal(rodzinaBota('Perplexity-User/1.0').rodzina, 'perplexity-user')
    assert.equal(rodzinaBota('PerplexityBot/1.0').rodzina, 'perplexitybot')
  })

  it('meta-externalagent (AI) to nie facebookexternalhit (podgląd)', () => {
    assert.equal(rodzinaBota('meta-externalagent/1.1').klasa, 'ai')
    assert.equal(rodzinaBota('facebookexternalhit/1.1').klasa, 'podglad')
  })

  it('DuckDuckBot (wyszukiwarka) kontra DuckAssistBot (AI)', () => {
    assert.equal(rodzinaBota('DuckDuckBot/1.1').klasa, 'wyszukiwarka')
    assert.equal(rodzinaBota('DuckAssistBot/1.2').klasa, 'ai')
  })

  it('Wielkość liter nie ma znaczenia', () => {
    assert.equal(rodzinaBota('GPTBOT/1.1').rodzina, 'gptbot')
    assert.equal(rodzinaBota('CURL/8.0').rodzina, 'curl')
  })

  it('„curl” liczy się tylko jako program curl/…, nie jako fragment innej nazwy', () => {
    assert.equal(rodzinaBota('Mozilla/5.0 (X11; Linux x86_64) Securly/2.0').czyBot, false)
    assert.equal(rodzinaBota('Mozilla/5.0 (X11; Linux x86_64) curly-hair-fan/1.0').czyBot, false)
  })

  it('„node” to bot tylko jako cały UA (domyślny UA fetch w Node), nie jako fragment', () => {
    assert.equal(rodzinaBota('node').rodzina, 'node')
    assert.equal(
      rodzinaBota('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 nodebb-user').czyBot,
      false,
    )
  })
})

describe('rodzinaBota – brak UA i boty spoza listy', () => {
  for (const [opis, ua] of [
    ['undefined', undefined],
    ['null', null],
    ['pusty tekst', ''],
    ['same spacje', '   '],
    ['liczba zamiast tekstu', 42],
    ['obiekt zamiast tekstu', {}],
  ]) {
    it(`${opis} → bot narzędziowy „brak-ua”`, () => {
      assert.deepEqual(rodzinaBota(ua), { czyBot: true, rodzina: 'brak-ua', klasa: 'narzedzie' })
    })
  }

  it('nieznany bot z „Bot/” w nazwie → rodzina „nieznany”, klasa „inny”', () => {
    assert.deepEqual(rodzinaBota('Mozilla/5.0 (compatible; SomeRandomBot/2.1)'), {
      czyBot: true,
      rodzina: 'nieznany',
      klasa: 'inny',
    })
  })

  it('crawler z adresem kontaktowym „+https://” w UA też jest botem', () => {
    assert.equal(
      rodzinaBota('Mozilla/5.0 (compatible; Nowy/1.0; +https://example.org/info)').klasa,
      'inny',
    )
  })

  it('słowa crawler i spider łapią boty spoza listy', () => {
    assert.equal(rodzinaBota('MyCrawler/1.0').klasa, 'inny')
    assert.equal(rodzinaBota('ExampleSpider 2.0').klasa, 'inny')
  })

  it('wynik nie zawiera surowego UA ani jego fragmentów poza nazwą rodziny', () => {
    const ua = 'Mozilla/5.0 (compatible; ZnacznikUA-9f2c/1.0; SomeRandomBot/2.1)'
    const wynik = JSON.stringify(rodzinaBota(ua))
    assert.equal(wynik.includes('ZnacznikUA'), false)
    assert.equal(wynik.includes('Mozilla'), false)
  })

  it('bardzo długi UA nie zawiesza dopasowania (wzorce nie liczą po kilobajtach)', () => {
    const start = Date.now()
    rodzinaBota(`Mozilla/5.0 ${'x'.repeat(200_000)}`)
    rodzinaBota(`${'a '.repeat(100_000)}curl/8`)
    assert.ok(Date.now() - start < 500)
  })

  it('każde wywołanie oddaje świeży obiekt (wołający może go modyfikować)', () => {
    const a = rodzinaBota('curl/8.4.0')
    a.rodzina = 'zmienione'
    assert.equal(rodzinaBota('curl/8.4.0').rodzina, 'curl')
  })
})

describe('kanal – po jednym przypadku na kanał', () => {
  const WLASNY = 'adresscore.pl'

  it('bezposrednie: brak referera i znaczników', () => {
    assert.equal(kanal({ wlasnyHost: WLASNY }), 'bezposrednie')
    assert.equal(kanal({}), 'bezposrednie')
    assert.equal(kanal(), 'bezposrednie')
    assert.equal(kanal({ rh: '', us: '', um: '', ci: '', wlasnyHost: WLASNY }), 'bezposrednie')
  })

  it('wyszukiwarka: referer z Google, Bing, DuckDuckGo', () => {
    assert.equal(kanal({ rh: 'google.com', wlasnyHost: WLASNY }), 'wyszukiwarka')
    assert.equal(kanal({ rh: 'www.google.pl', wlasnyHost: WLASNY }), 'wyszukiwarka')
    assert.equal(kanal({ rh: 'google.co.uk', wlasnyHost: WLASNY }), 'wyszukiwarka')
    assert.equal(kanal({ rh: 'www.bing.com', wlasnyHost: WLASNY }), 'wyszukiwarka')
    assert.equal(kanal({ rh: 'duckduckgo.com', wlasnyHost: WLASNY }), 'wyszukiwarka')
    assert.equal(kanal({ rh: 'yandex.ru', wlasnyHost: WLASNY }), 'wyszukiwarka')
  })

  it('wyszukiwarka: aplikacja Google na Androidzie podaje pakiet zamiast hosta', () => {
    assert.equal(
      kanal({ rh: 'com.google.android.googlequicksearchbox', wlasnyHost: WLASNY }),
      'wyszukiwarka',
    )
  })

  it('social: referer z Facebooka, Instagrama, t.co, YouTube', () => {
    assert.equal(kanal({ rh: 'l.facebook.com', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ rh: 'm.facebook.com', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ rh: 'l.instagram.com', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ rh: 't.co', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ rh: 'm.youtube.com', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ rh: 'out.reddit.com', wlasnyHost: WLASNY }), 'social')
  })

  it('social: ?utm_source=facebook (scenariusz akceptacji historii 4)', () => {
    assert.equal(kanal({ us: 'facebook', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ us: 'Instagram', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ us: 'tiktok', um: 'bio', wlasnyHost: WLASNY }), 'social')
  })

  it('social: fbclid (Facebook dokleja go także do linków organicznych)', () => {
    assert.equal(kanal({ ci: 'fbclid', wlasnyHost: WLASNY }), 'social')
  })

  it('social: utm_medium=social bez znanego źródła', () => {
    assert.equal(kanal({ us: 'mojapartia', um: 'social', wlasnyHost: WLASNY }), 'social')
  })

  it('ai: referer z czatów modeli', () => {
    for (const host of [
      'chatgpt.com',
      'chat.openai.com',
      'www.perplexity.ai',
      'claude.ai',
      'gemini.google.com',
      'copilot.microsoft.com',
    ]) {
      assert.equal(kanal({ rh: host, wlasnyHost: WLASNY }), 'ai', host)
    }
  })

  it('ai: ChatGPT oznacza linki wychodzące utm_source=chatgpt.com', () => {
    assert.equal(kanal({ us: 'chatgpt.com', wlasnyHost: WLASNY }), 'ai')
  })

  it('kampania: płatny utm_medium (cpc, paid…) wygrywa nad źródłem social', () => {
    assert.equal(kanal({ um: 'cpc', wlasnyHost: WLASNY }), 'kampania')
    assert.equal(kanal({ um: 'CPC', us: 'facebook', wlasnyHost: WLASNY }), 'kampania')
    assert.equal(kanal({ um: 'paid_social', us: 'instagram', wlasnyHost: WLASNY }), 'kampania')
    assert.equal(kanal({ um: 'paidsearch', us: 'google', wlasnyHost: WLASNY }), 'kampania')
  })

  it('kampania: znaczniki reklamowe (gclid, msclkid, ttclid, li_fat_id)', () => {
    for (const ci of ['gclid', 'msclkid', 'ttclid', 'li_fat_id']) {
      assert.equal(kanal({ ci, wlasnyHost: WLASNY }), 'kampania', ci)
    }
  })

  it('kampania: link z własnym znacznikiem UTM, którego nie rozpoznajemy', () => {
    assert.equal(kanal({ us: 'newsletter', um: 'email', wlasnyHost: WLASNY }), 'kampania')
    assert.equal(kanal({ uc: 'wiosna', wlasnyHost: WLASNY }), 'kampania')
  })

  it('kampania: znacznik wygrywa z refererem (reklama na Facebooku ma referer l.facebook.com)', () => {
    assert.equal(kanal({ rh: 'l.facebook.com', um: 'cpc', wlasnyHost: WLASNY }), 'kampania')
  })

  it('odeslanie: referer z dowolnego innego serwisu', () => {
    assert.equal(kanal({ rh: 'blog.example.org', wlasnyHost: WLASNY }), 'odeslanie')
    assert.equal(kanal({ rh: 'wp.pl', wlasnyHost: WLASNY }), 'odeslanie')
  })

  it('odeslanie: utm_medium=referral', () => {
    assert.equal(kanal({ us: 'partner', um: 'referral', wlasnyHost: WLASNY }), 'odeslanie')
  })

  it('wewnetrzne: referer z własnego hosta (z www i bez, wielkość liter bez znaczenia)', () => {
    assert.equal(kanal({ rh: 'adresscore.pl', wlasnyHost: WLASNY }), 'wewnetrzne')
    assert.equal(kanal({ rh: 'www.adresscore.pl', wlasnyHost: WLASNY }), 'wewnetrzne')
    assert.equal(kanal({ rh: 'AdresScore.PL', wlasnyHost: 'www.adresscore.pl' }), 'wewnetrzne')
  })

  it('wewnetrzne: wlasnyHost może być listą hostów (kilka domen serwisu)', () => {
    const wlasne = ['adresscore.pl', 'adresscore.vercel.app']
    assert.equal(kanal({ rh: 'adresscore.vercel.app', wlasnyHost: wlasne }), 'wewnetrzne')
    assert.equal(kanal({ rh: 'adresscore.pl', wlasnyHost: wlasne }), 'wewnetrzne')
    assert.equal(kanal({ rh: 'inna.pl', wlasnyHost: wlasne }), 'odeslanie')
  })

  it('wewnetrzne: host z portem (localhost:5180)', () => {
    assert.equal(kanal({ rh: 'localhost:5180', wlasnyHost: 'localhost:5180' }), 'wewnetrzne')
  })

  it('własny host z doklejonym znacznikiem to wejście ze znacznika, nie wewnętrzne', () => {
    assert.equal(kanal({ rh: 'adresscore.pl', us: 'facebook', wlasnyHost: WLASNY }), 'social')
  })
})

describe('kanal – pułapki dopasowania hostów', () => {
  const WLASNY = 'adresscore.pl'

  it('mail.google.com, docs.google.com i news.google.com to nie wyszukiwarka', () => {
    for (const host of ['mail.google.com', 'docs.google.com', 'news.google.com']) {
      assert.equal(kanal({ rh: host, wlasnyHost: WLASNY }), 'odeslanie', host)
    }
  })

  it('gemini.google.com to AI, nie wyszukiwarka', () => {
    assert.equal(kanal({ rh: 'gemini.google.com', wlasnyHost: WLASNY }), 'ai')
  })

  it('domena z dopiskiem nie przechodzi za serwis (nietiktok.com, tiktok.com.evil.pl)', () => {
    assert.equal(kanal({ rh: 'nietiktok.com', wlasnyHost: WLASNY }), 'odeslanie')
    assert.equal(kanal({ rh: 'tiktok.com.evil.pl', wlasnyHost: WLASNY }), 'odeslanie')
    assert.equal(kanal({ rh: 'google.com.evil.pl', wlasnyHost: WLASNY }), 'odeslanie')
    assert.equal(kanal({ rh: 'dropbox.com', wlasnyHost: WLASNY }), 'odeslanie')
  })

  it('własny host jako podciąg obcego nie jest wewnętrzny', () => {
    assert.equal(kanal({ rh: 'adresscore.pl.evil.com', wlasnyHost: WLASNY }), 'odeslanie')
    assert.equal(kanal({ rh: 'xadresscore.pl', wlasnyHost: WLASNY }), 'odeslanie')
  })

  it('wielkość liter w znacznikach nie ma znaczenia', () => {
    assert.equal(kanal({ us: ' FaceBook ', wlasnyHost: WLASNY }), 'social')
    assert.equal(kanal({ um: ' Cpc ', wlasnyHost: WLASNY }), 'kampania')
    assert.equal(kanal({ ci: 'GCLID', wlasnyHost: WLASNY }), 'kampania')
  })

  it('wartości nietekstowe są ignorowane, nie rzucają', () => {
    assert.equal(kanal({ rh: 5, us: {}, um: [], ci: null, wlasnyHost: WLASNY }), 'bezposrednie')
  })

  it('zawsze zwraca jeden z siedmiu kanałów z kontraktu', () => {
    const wejscia = [
      {},
      { rh: 'google.com' },
      { rh: 'x.com' },
      { rh: 'claude.ai' },
      { um: 'cpc' },
      { rh: 'inny.pl' },
      { rh: 'adresscore.pl' },
      { us: 'cos' },
      { ci: 'fbclid' },
    ]
    for (const w of wejscia) {
      assert.ok(KANALY.includes(kanal({ ...w, wlasnyHost: 'adresscore.pl' })), JSON.stringify(w))
    }
  })
})

describe('kraj', () => {
  it('bierze cf-ipcountry', () => {
    assert.equal(kraj({ 'cf-ipcountry': 'PL' }), 'PL')
  })

  it('bez nagłówka Cloudflare bierze x-vercel-ip-country', () => {
    assert.equal(kraj({ 'x-vercel-ip-country': 'DE' }), 'DE')
  })

  it('Cloudflare ma pierwszeństwo przed Vercelem', () => {
    assert.equal(kraj({ 'cf-ipcountry': 'PL', 'x-vercel-ip-country': 'DE' }), 'PL')
  })

  it('XX (kraj nieznany) i T1 (Tor) → null', () => {
    assert.equal(kraj({ 'cf-ipcountry': 'XX' }), null)
    assert.equal(kraj({ 'cf-ipcountry': 'T1' }), null)
    assert.equal(kraj({ 'x-vercel-ip-country': 'XX' }), null)
  })

  it('zły wpis z Cloudflare nie zasłania dobrego z Vercela', () => {
    assert.equal(kraj({ 'cf-ipcountry': 'XX', 'x-vercel-ip-country': 'FR' }), 'FR')
  })

  it('tylko dwie litery: reszta → null', () => {
    for (const zly of ['', 'P', 'POL', '1A', 'P1', 'P L', 'ZZZ', '  ', '--']) {
      assert.equal(kraj({ 'cf-ipcountry': zly }), null, JSON.stringify(zly))
    }
  })

  it('małe litery i spacje są normalizowane do wielkich', () => {
    assert.equal(kraj({ 'cf-ipcountry': ' pl ' }), 'PL')
  })

  it('brak nagłówków albo ich dziwny kształt → null', () => {
    assert.equal(kraj({}), null)
    assert.equal(kraj(undefined), null)
    assert.equal(kraj(null), null)
    assert.equal(kraj({ 'cf-ipcountry': 5 }), null)
  })

  it('nagłówek powtórzony (tablica) → pierwsza wartość', () => {
    assert.equal(kraj({ 'cf-ipcountry': ['SE', 'NO'] }), 'SE')
  })

  it('obsługuje Headers z Fetch API i klucze w innej wielkości liter', () => {
    assert.equal(kraj(new Headers({ 'CF-IPCountry': 'CZ' })), 'CZ')
    assert.equal(kraj({ 'X-Vercel-IP-Country': 'SK' }), 'SK')
  })
})

describe('naglowek, normalizujHost, czyHostPubliczny', () => {
  it('naglowek: wartość tekstowa, tablica → pierwsza, brak → null', () => {
    assert.equal(naglowek({ origin: 'https://a.pl' }, 'origin'), 'https://a.pl')
    assert.equal(naglowek({ 'x-a': ['1', '2'] }, 'x-a'), '1')
    assert.equal(naglowek({}, 'origin'), null)
    assert.equal(naglowek(null, 'origin'), null)
    assert.equal(naglowek({ origin: 1 }, 'origin'), null)
    assert.equal(naglowek({ Origin: 'https://a.pl' }, 'origin'), 'https://a.pl')
    assert.equal(naglowek(new Headers({ Origin: 'https://a.pl' }), 'Origin'), 'https://a.pl')
  })

  it('normalizujHost: małe litery, bez www., bez końcowej kropki, port zostaje', () => {
    assert.equal(normalizujHost(' WWW.AdresScore.PL. '), 'adresscore.pl')
    assert.equal(normalizujHost('localhost:5180'), 'localhost:5180')
    assert.equal(normalizujHost(undefined), '')
    assert.equal(normalizujHost(42), '')
  })

  it('czyHostPubliczny: serwisy społecznościowe tak, czaty AI i wyszukiwarki nie', () => {
    assert.equal(czyHostPubliczny('t.co'), true)
    assert.equal(czyHostPubliczny('m.facebook.com'), true)
    assert.equal(czyHostPubliczny('www.reddit.com'), true)
    assert.equal(czyHostPubliczny('news.ycombinator.com'), true)
    // chatgpt.com/c/<id> to prywatna rozmowa; w ścieżce Google nie ma nic poza „/”.
    assert.equal(czyHostPubliczny('chatgpt.com'), false)
    assert.equal(czyHostPubliczny('google.com'), false)
    assert.equal(czyHostPubliczny('nietiktok.com'), false)
    assert.equal(czyHostPubliczny('intranet.firma.pl'), false)
  })

  it('HOSTY_PUBLICZNE: bez duplikatów i bez wielkich liter', () => {
    assert.equal(new Set(HOSTY_PUBLICZNE).size, HOSTY_PUBLICZNE.length)
    for (const host of HOSTY_PUBLICZNE) assert.equal(host, host.toLowerCase())
  })
})
