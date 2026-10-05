# Kontrakt: pomiar w kliencie (`src/pomiar/`)

## API modułu (`src/pomiar/pomiar.ts`)

```ts
export function startPomiaru(): () => void         // montuje nasłuchy; zwraca sprzątanie
export function odslona(ekran: Ekran, sciezka: string): void
export function produktowe(n: NazwaProduktowa, w?: Wlasciwosci): void
export function udostepnienie(element: string, kanal: KanalUdostepnienia): void
export function pomiarWylaczony(): boolean           // src/pomiar/zgoda.ts
export function ustawPomiar(wlaczony: boolean): void // src/pomiar/zgoda.ts
```

`src/pomiar/Pomiar.tsx` – komponent bez UI (`return null`), montowany raz w `src/App.tsx`
(faza integracji). Subskrybuje `subskrybuj` z `src/wynik/stan.ts`:

| Przejście stanu | Zdarzenie |
|---|---|
| zmiana `ekran` lub `wybrany` | `wyjscie` poprzedniej odsłony, potem `odslona` |
| `ekran` → `okolica` z `wybrany !== null` | `produktowe: karta_adresu` |
| `porownanie.length` rośnie | `produktowe: porownanie_dodaj` |
| `warstwa` zmienia się na ≠ `wynik` | `produktowe: warstwa_mapy { warstwa }` |
| `tryb` → `biznes` | `produktowe: tryb_biznes` |
| `ekran` → `miasto` | `produktowe: tryb_miasto` |

## Nazwy produktowe (zamknięta lista, parytet z `api/_zdarzenie-kontrakt.js`)

`wyszukanie` (`wynikow`: number, `rodzaj`: `adres|ulica|okolica`), `wyszukanie_bez_wyniku`
(`fraza`: string ≤ 80), `karta_adresu`, `porownanie_dodaj`, `warstwa_mapy` (`warstwa`: id),
`tryb_biznes`, `tryb_miasto`, `udostepnij`, `pomiar_wylaczony`.

Fraza: `toLowerCase`, `trim`, zbite spacje, ≤ 80 znaków; odrzucana (zamiast niej
`{ odrzucono: true }`), gdy pasuje do e-maila, 9+ cyfr z rzędu (telefon/PESEL) albo `@`.

## Oznaczenia w ekranach

- `data-sekcja="<klucz>"` (`^[a-z0-9_-]{1,48}$`) na sekcjach ekranów: karta adresu (etykieta,
  kategorie, źródła, mapa, co-by-to-zmieniło), wyszukiwarka, porównanie, Biznes.
- `data-cel="<cel>"` na przyciskach, których kliki mają się liczyć jako CTA (bez tego atrybutu
  liczone są wszystkie `button`, `a`, `[role=button]` w sekcji – nazwa celu z
  `aria-label`/tekstu, przycięta do 40 znaków).
- Furia: ≥ 3 kliknięcia w promieniu 30 px w 800 ms. Martwy: klik w element nieinteraktywny
  bez `data-cel` w sekcji (zgłaszany jako `klik` z rodzajem `martwy`).

## Transport

- Bufor ≤ 10 zdarzeń; wysyłka po 5 s bezczynności, przy zapełnieniu, przy `pagehide`
  i `visibilitychange: hidden` (raz – strażnik przed dublem).
- `navigator.sendBeacon('/api/zdarzenie', Blob(text/plain))`; fallback
  `fetch(..., { method: 'POST', keepalive: true })`; błędy tłumione.
- Przy `pomiarWylaczony()` – nic nie wychodzi, bufor czyszczony.

## Prywatność (niezmienniki pilnowane testami)

- Brak zapisu do `localStorage`/`sessionStorage`/ciasteczek poza kluczem
  `pomiar-wylaczony` (wyłącznie przy wyłączeniu).
- Z URL-a strony wychodzą wyłącznie `utm_source|utm_medium|utm_campaign` i NAZWA click-id.
- Referer: host bez `www.`; ścieżka tylko dla hostów publicznych (lista w `zrodlo.ts`),
  bez query i fragmentu.
