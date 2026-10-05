import { Aplikacja } from '@/karta/Aplikacja'
// Rozszerzenie jest celowe: na Windows i macOS (system plików bez rozróżniania wielkości liter)
// "@/pomiar/Pomiar" myli się z plikiem pomiar.ts obok i TypeScript zgłasza TS1261.
import { Pomiar } from '@/pomiar/Pomiar.tsx'

export function App() {
  return (
    <>
      <Aplikacja />
      {/* Pomiar ruchu bez UI i bez ciasteczek – rusza na każdym ekranie poza panelem admina. */}
      <Pomiar />
    </>
  )
}
