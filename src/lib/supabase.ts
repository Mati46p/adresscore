import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const kluczAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

// null zamiast wyjątku: mapa ma działać także bez bazy (podgląd, brak .env.local); panel pokazuje
// wtedy komunikat o braku konfiguracji, a nie błąd.
//
// Klient powstaje dopiero przy imporcie tego modułu, a importuje go wyłącznie chunk panelu
// (`src/panel/**`, ładowany po wejściu na `#/panel`). Odwiedzający serwis nigdy go nie ładują, więc
// nie dostają ani kodu autoryzacji, ani żadnych kluczy sesji w storage (pomiar jest bez ciasteczek).
//
// DLACZEGO PKCE (specs/001-panel-analityka, research.md R9): domyślny przepływ „implicit” oddaje
// tokeny w hashu adresu (`#access_token=…`), a router tej aplikacji żyje na hashu (`#/okolica/…`).
// Wiązałoby się to z kolizją: router skasowałby tokeny albo klient skasowałby stan routera. PKCE
// oddaje po powrocie krótkotrwały `?code=…` w query, który klient wymienia na sesję i sam usuwa z
// adresu, więc hash zostaje w całości dla routera. To też przepływ zalecany dla aplikacji SPA.
export const supabase =
  url && kluczAnon
    ? createClient(url, kluczAnon, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
      })
    : null
