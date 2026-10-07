# Hosting na Hetznerze (Coolify)

Stan od 2026-10-07: aplikacja stoi na serwerze Hetzner obok z-dykty (Coolify, projekt `adresscore`),
równolegle do Vercela. DNS adresscore.pl nadal wskazuje Vercel – przełączenie to osobna decyzja.

| Element | Wartość |
|---|---|
| Aplikacja Coolify | `adresscore` (uuid `klama2fggdmulqn2lqemd9al`), gałąź `main`, Dockerfile z korzenia |
| Adres testowy | http://adresscore.95.217.198.88.sslip.io |
| Limity | 4 GB RAM, 4 CPU (nie zjadają stosów z-dykty) |
| Serwer HTTP | `serwer/serwer.mjs`: statyki z `dist/`, rewrites z `vercel.json`, funkcje `api/*`, Range dla PMTiles |
| Zmienne | build: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; runtime: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JEV_API_KEY`, `ADRESSCORE_HOSTY` |

- Routing w `serwer/serwer.mjs` jest kopią reguł z `vercel.json`. Zmieniasz jedno, zmieniasz drugie.
- `SUPABASE_SERVICE_ROLE_KEY` trzeba dodać w Coolify. Bez niego pomiar ruchu przyjmuje zdarzenia, ale ich nie zapisuje.
- Przełączenie domeny: w Coolify ustaw domenę `https://adresscore.pl`, w DNS wskaż IP serwera, dodaj
  `www`. Dopiero po tym wyłącz deploy na Vercela (`wdroz.yml`).
