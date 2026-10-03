# adresscore – plan 8 etapów (HackYeah 2026, Smart City)

Mapa dla ludzi i okien Claude'a pracujących równolegle. **Przeczytaj ten plik i zadanie, które
bierzesz – nic więcej nie trzeba do startu.** Zadania to roadmapa, nie specyfikacja: kto bierze
zadanie, najpierw robi własny szczegółowy plan (pliki, kontrakt, testy), dopiero potem kod.

Termin: **niedziela 2026-10-04 10:00** (twardy koniec HackTribe 11:00). Checkpoint z draftem:
**sobota 20:00**. Oddajemy: tytuł, zespół, opis, **PDF do 10 slajdów** z linkiem do demo.
Ocena: pomysł 30%, związek z Smart City 20%, użyteczność 20%, design 20%, kompletność 10%.

## Decyzje (burza 2026-10-03)

- Zgłoszenie: tylko **Smart City**.
- Fokus: **Kraków** (+ gminy obwarzanka), reszta Polski pod mgłą wojny; inne duże miasta – dodatek.
- Wynik liczony **dla każdego adresu** (70 217 punktów MSIP); z góry heksy H3 ~65 m, w 3D kolor budynku.
- Etykieta A–G ze wszystkich kategorii: codzienność pieszo, transport, spokój i zdrowie,
  przyszłość okolicy, bezpieczeństwo i ryzyko. Brak danych = szara kategoria, nigdy zero.
- **Warstwa AI = JEV** (TypeSafe, klucz `JEV_API_KEY` tylko po stronie serwera, funkcja `api/`):
  „opisz siebie" → wagi, strażnik uchwał Rady Miasta Krakowa, „zapytaj o adres" → warstwa + liczba ze źródłem.
  JEV nigdy nie generuje liczb ani miejsc – wybiera z zamkniętych list. Zawsze z regułą zapasową.
- Dane: **pliki statyczne** liczone skryptem (Node + DuckDB spatial/h3) – licencja MSIP zakazuje
  ciągłego pośredniczenia w usługach miasta. Supabase tylko, gdy funkcja potrzebuje serwera.
- 3D: obrysy EGiB + wysokości GUGiK LoD1 (sprawdzić rocznik 2025), OSM tylko jako tymczasowe.
- Deploy: Vercel z gita, **tylko `main` i tylko commit z `[wdroz]`** w opisie (robi integrator).
- Szablon repo sprzed 11:00 ujawniamy w opisie zgłoszenia.

## Etapy – każdy kończy się działającą aplikacją

| # | Etap (milestone) | Działa po etapie | Kiedy |
|---|---|---|---|
| 1 | Fundament i kontrakty | mapa Krakowa z atrapą wyniku, kolejka zadań, skrypty nocne | do ~13:00 |
| 2 | Dane: rdzeń | adresy, budynki, hałas, komunikacja, zieleń/upał, powietrze w plikach | do ~17:00 |
| 3 | Wynik i karta adresu | wyszukiwarka, karta z etykietą A–G, źródła, pasek pewności | **checkpoint 20:00** |
| 4 | Warstwa AI – JEV | „opisz siebie" → wagi na żywo, „zapytaj o adres" | noc |
| 5 | Miasto 3D i lot | Polska we mgle → lot do Krakowa, budynki 3D w kolorze wyniku, cień (pora dnia/roku) | noc |
| 6 | Dane: drugi rzut | plan miejscowy, powódź, SCT, SPP, schrony, zdrowie, szkoły, RCN, pozwolenia, BO | noc |
| 7 | Działanie | strażnik uchwał (JEV), „co by to zmieniło", zł i godziny rocznie, 2030 duchy budynków | noc |
| 8 | Szlif i pitch | telefon/QR, wydajność, strona metody i etyki, PDF 10 slajdów, opis | 06:00–10:00 |

Etapy 4–7 zależą tylko od 1–3 i idą **równolegle**. Szczegółowe zadania: GitHub Issues z
milestone'em etapu (`pnpm zadanie lista`).

## Podział na ludzi – milestone na osobę

Każda osoba bierze milestone (etap) i jest jego **właścicielem**: rozpisuje go, pilnuje, scala.
Okna Claude'a pracują w nocy na tych samych zadaniach, w kolejności etapów.

| Tor | Katalogi na wyłączność |
|---|---|
| dane | `etl/**`, `public/dane/**` |
| mapa | `src/mapa/**`, `src/miasto3d/**` |
| karta | `src/karta/**`, `src/wynik/**` |
| ai | `api/**`, `src/ai/**` |
| pitch | `docs/pitch/**`, `src/strony/**` |
| integracja | `package.json`, `pnpm-lock.yaml`, `src/App.tsx`, `src/kontrakty/**`, `vercel.json` |

**Plików z toru `integracja` nie zmienia nikt poza integratorem.** Potrzebujesz zależności albo
zmiany kontraktu → zadanie z etykietą `zablokowane` i opis, czego potrzebujesz.

## Jak wziąć zadanie (człowiek albo okno)

```
pnpm zadanie lista            # gotowe zadania, wg etapu
pnpm zadanie wez [tor]        # rezerwuje atomowo (gałąź zajete/NN w gicie) i tworzy feat/NN-slug
# ... plan → kod → pnpm verify
pnpm zadanie scal             # rebase na main → verify → push na main (ponawia przy wyścigu)
```

Dwa okna nigdy nie wezmą tego samego zadania: rezerwacja to push gałęzi `zajete/NN` – drugi push
odbija się od gita.

## Noc – okna w tle

`pwsh scripts/noc.ps1 -Okna 12` – każde okno w pętli: `pnpm zadanie wez` → świeża sesja
`claude -p` (Opus, tryb auto) → plan → kod → `verify` → `scal`. Research danych na Sonnecie 5.5.
Limit planu → okno czeka i ponawia. Integrator co 2 h robi commit `[wdroz]`, o 6:00 raport poranny.
