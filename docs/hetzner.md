# Hosting na Hetznerze (Coolify)

Stan od 2026-10-07: aplikacja stoi na serwerze Hetzner obok z-dykty (Coolify, projekt `adresscore`),
jako produkcja adresscore.pl i www (DNS w home.pl wskazuje 95.217.198.88, HTTPS z Let's Encrypt
przez Traefik).

| Element | Wartość |
|---|---|
| Aplikacja Coolify | `adresscore` (uuid `klama2fggdmulqn2lqemd9al`), gałąź `main`, Dockerfile z korzenia |
| Adres testowy | http://adresscore.95.217.198.88.sslip.io |
| Limity | 4 GB RAM, 4 CPU (nie zjadają stosów z-dykty) |
| Serwer HTTP | `serwer/serwer.mjs`: statyki z `dist/`, rewrites z `vercel.json`, funkcje `api/*`, Range dla PMTiles |
| Zmienne | build: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; runtime: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JEV_API_KEY`, `ADRESSCORE_HOSTY` |

- Routing w `serwer/serwer.mjs` jest kopią reguł z `vercel.json`. Zmieniasz jedno, zmieniasz drugie.
- `SUPABASE_SERVICE_ROLE_KEY` musi pochodzić z tego samego projektu co `SUPABASE_URL`; inny klucz
  daje 401, a brak migracji analityki na bazie daje 404 (w logu kontenera: „zapis nieudany").
- Wdrożenie: Coolify → aplikacja `adresscore` → Deploy. Zmiana domen i zmiennych wymaga Deploy,
  sam Restart nie ładuje nowego środowiska.
- Powrót na Vercel (awaria): DNS w home.pl z powrotem na Vercel i ręczny bieg `wdroz`
  (workflow_dispatch).

## Dane miast

Od #237 dane ETL (`public/dane`, ok. 1,5 GB i rosnące) **nie leżą w gicie ani w obrazie**. Źródłem
prawdy są pliki lokalne z `etl/`, a na serwerze leży ich kopia na trwałym wolumenie. Mechanizm jest
ten sam co dla mapy (`MAPA_DIR`, `public/mapa/README.md`).

| Element | Wartość |
|---|---|
| Wolumen Coolify | trwały katalog hosta montowany do kontenera jako `/data/dane` (Coolify → aplikacja → Storages) |
| Zmienna runtime | `DANE_DIR=/data/dane` |
| Serwowanie | `serwer/serwer.mjs`: `/dane/<plik>` czytane z `DANE_DIR` przed `dist/`; te same adresy co dotąd, front i SW bez zmian |
| Układ plików | jak `public/dane`: `adresy.json`, `wskazniki/`, `miasta/<slug>/…`, plus `manifest.json` i `miasta/<slug>/manifest.json` |
| Wysyłka | `pnpm dane:wyslij` (`scripts/dane-wyslij.mjs`), tar przez SSH, przyrostowo |

**Wysyłka lokalne → serwer**

```sh
pnpm dane:wyslij -- --dry-run          # lista zmian, nic nie jedzie
pnpm dane:wyslij                        # nowe i zmienione pliki
pnpm dane:wyslij -- miasta/lodz         # tylko jedno miasto
```

- Dostęp SSH jak w `scripts/wdroz-coolify.mjs`: alias z `WDROZ_SSH` (domyślnie `zdykty-prod`).
- Katalog na serwerze: `DANE_ZDALNY` (domyślnie `/data/adresscore/dane`). **To ma być ścieżka hosta
  wskazana w Storages aplikacji jako źródło montowania do `/data/dane`** – integrator ustawia obie
  strony tak samo (domyślna ścieżka jest umowna, nie sprawdzona na serwerze).
- Plik jedzie, gdy nie ma go na serwerze albo różni się rozmiarem lub czasem modyfikacji. Skrypt
  niczego nie kasuje; usunięte miasto czyścisz ręcznie na wolumenie.
- Manifesty warstw składa skrypt lokalnie (`scripts/manifest-danych.mjs`, ta sama logika co wtyczka
  Vite w `pnpm dev`) i wysyła razem z danymi, bo obraz ich nie zawiera. Po dodaniu warstwy albo miasta
  uruchom wysyłkę ponownie.
- Serwer czyta pliki od ręki, więc po wysyłce nie trzeba restartu ani Deploy.

**Build w Dockerze bez danych**: `.dockerignore` wyklucza `public/dane`. `scripts/generuj-katalog.mjs`
bez `public/dane/adresy.json` składa mapy witryny i `llms.txt` z indeksu SEO w gicie
(`api/_seo-index.json.gz`), więc **indeks trzeba odświeżyć lokalnie** (`pnpm build` z danymi) i
zacommitować, gdy zmieniają się dane Krakowa. Lokalnie `public/dane` jest w `.gitignore`: `pnpm dev`
serwuje je z dysku jak dotąd.

**Wdrożenie tej zmiany (kolejność)**: 1) utwórz wolumen i `DANE_DIR` w Coolify, 2) `pnpm dane:wyslij`,
3) dopiero potem Deploy – wcześniejszy Deploy zostawiłby `/dane/*` bez plików (404).
Nowe zbiory dochodzą już tylko przez wysyłkę. Historia gita nadal zawiera stare pliki (bez
przepisywania, osobna decyzja).
