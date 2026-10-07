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
