// Głębokość przewinięcia dokumentu w procentach. Czysta arytmetyka – pomiary okna i dokumentu
// robi `pomiar.ts`, dzięki czemu reguły (próg 100%, krok 5, ucięcie) są testowalne bez DOM.

/**
 * Najgłębszy punkt, do którego dotarła dolna krawędź okna (`dno` = scrollY + wysokość okna,
 * w px od góry dokumentu), jako % wysokości dokumentu, w kroku 5.
 *
 * Dokument, który mieści się w oknie, jest przewinięty w 100% z definicji – nie ma czego
 * przewijać. Pierwszy ekran długiej strony bez ruchu daje ułamek (wysokość okna / dokumentu),
 * a nie 0: czytelnik widzi ten kawałek bez żadnego przewijania.
 *
 * DLACZEGO `dno` ZAMIAST PROCENTU W CHWILI POMIARU: ekran ładuje się leniwie, więc w chwili
 * otwarcia dokument bywa jeszcze krótki. Procent policzony wtedy byłby 100%, choć po dociągnięciu
 * treści strona jest długa. Pamiętamy więc piksele i dzielimy dopiero przy wysyłce, przez
 * wysokość dokumentu z tamtej chwili.
 */
export function procentPrzewiniecia(
  dno: number,
  wysokoscDokumentu: number,
  wysokoscOkna: number,
): number {
  if (![dno, wysokoscDokumentu, wysokoscOkna].every(Number.isFinite)) return 0
  if (wysokoscDokumentu <= wysokoscOkna + 1) return 100
  const udzial = Math.min(Math.max(dno, wysokoscOkna) / wysokoscDokumentu, 1)
  return Math.min(100, Math.round(udzial * 20) * 5)
}
