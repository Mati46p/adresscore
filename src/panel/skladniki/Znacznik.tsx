// Znacznik stanu: słowo i znak w kapsułce (ocena Web Vitals, status biegu zestawienia). Znaczenie
// niesie ZAWSZE tekst i znak, a kolor tylko je wzmacnia: stan nigdy nie jest przekazany samym
// kolorem (WCAG 1.4.1), a tekst na własnym tle ma ≥ 6,6:1.
import type { ReactNode } from 'react'

export type TonZnacznika = 'dobra' | 'uwaga' | 'zla' | 'neutralna'

const ZNAK: Readonly<Record<TonZnacznika, string>> = {
  dobra: '✓',
  uwaga: '!',
  zla: '✕',
  neutralna: '•',
}

export function Znacznik({ ton, children }: { ton: TonZnacznika; children: ReactNode }) {
  return (
    <span className="panel-znacznik" data-ton={ton}>
      <span aria-hidden="true">{ZNAK[ton]}</span>
      <span>{children}</span>
    </span>
  )
}
