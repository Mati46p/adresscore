import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const kluczAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

// null zamiast wyjątku: mapa ma działać także bez bazy (podgląd, brak .env.local).
export const supabase = url && kluczAnon ? createClient(url, kluczAnon) : null
