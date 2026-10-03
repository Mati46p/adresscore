export const WYBORY_PREFIX = 'sejm2023_lista_'

export function czyWarstwaWyborow(id: string): boolean {
  return /^sejm2023_lista_\d+$/.test(id)
}

/** Zmiana komitetu przenosi aktualną wagę/kierunek/próg, aby filtr dotyczył wyboru. */
export function zmienKomitet(
  id: string,
  wagi: Readonly<Record<string, number>>,
  kierunki: Readonly<Record<string, 'wiecej-lepiej' | 'mniej-lepiej'>>,
  filtry: readonly { id: string; warunek: 'min' | 'max' | 'rowne-zero'; prog: number }[],
) {
  const poprzedni =
    Object.keys(wagi).find((klucz) => czyWarstwaWyborow(klucz) && (wagi[klucz] ?? 0) > 0) ??
    Object.keys(kierunki).find(czyWarstwaWyborow) ??
    filtry.find((f) => czyWarstwaWyborow(f.id))?.id
  const noweWagi = { ...wagi }
  const noweKierunki = { ...kierunki }
  for (const klucz of Object.keys(noweWagi)) if (czyWarstwaWyborow(klucz)) noweWagi[klucz] = 0
  for (const klucz of Object.keys(noweKierunki))
    if (czyWarstwaWyborow(klucz) && klucz !== id) delete noweKierunki[klucz]
  // Sam wybór komitetu nie włącza historycznych wyników do oceny adresu.
  // Przenosimy wagę tylko wtedy, gdy użytkownik wcześniej świadomie ją ustawił.
  noweWagi[id] = poprzedni ? (wagi[poprzedni] ?? 0) : 0
  if (poprzedni && kierunki[poprzedni]) noweKierunki[id] = kierunki[poprzedni]
  else noweKierunki[id] = 'wiecej-lepiej'
  const filtr = filtry.find((f) => f.id === poprzedni)
  return {
    wagi: noweWagi,
    kierunki: noweKierunki,
    filtry: [
      ...filtry.filter((f) => !czyWarstwaWyborow(f.id)),
      ...(filtr ? [{ ...filtr, id }] : []),
    ],
  }
}
