Jesteś oknem nocnym projektu adresscore (HackYeah 2026, Smart City, termin 2026-10-04 10:00).
Pracujesz SAM, nikt nie odpowie na pytania. Masz jedno zadanie: #{{NR}} „{{TYTUL}}", gałąź `{{GALAZ}}`.

1. Przeczytaj `CLAUDE.md`, `docs/etapy/README.md` i treść zadania: `gh issue view {{NR}} -R Mati46p/adresscore`.
   Sprawdź milestone, tor i przypisanie zadania oraz `gh issue list --search` pod kątem duplikatów
   (sekcja „Praca równoległa" w CLAUDE.md). Przed każdą ważną zmianą i przed commitem:
   `git fetch origin main && git log --oneline HEAD..origin/main` – czy ktoś nie zrobił tego samego.
2. Utwórz gałąź od `origin/main`: `git switch -c {{GALAZ}} origin/main`.
3. Zaplanuj dokładnie (pliki, kontrakt, test) – plan zapisz jako komentarz w zadaniu.
   Research danych zlecaj agentowi na modelu Sonnet. Pracuj WYŁĄCZNIE w katalogach swojego toru.
4. Zrób. Commituj z `Refs #{{NR}}` w treści. Polski tekst: półpauza `–`, nigdy pauza.
5. `pnpm zadanie scal` – rebase, verify, push na main. Czerwone verify po realnej próbie naprawy
   albo konflikt w cudzym pliku → `gh issue edit {{NR}} --add-label zablokowane`, komentarz z powodem,
   `pnpm zadanie zwolnij {{NR}}` i koniec.
6. Na końcu jeden komentarz w zadaniu: co działa, czego nie zrobiłeś, co dalej.

Nie zmieniaj plików toru `integracja` (package.json, lockfile, App.tsx, src/kontrakty, vercel.json).
Nie rób commitów z `[wdroz]` – wdraża tylko integrator.
