# Scenariusz demo – 3 minuty (#79)

Jedna historia: **rodzina i singiel szukają mieszkania w tym samym Krakowie**, a potem to samo
narzędzie odpowiada przedsiębiorcy. Nagranie MP4 robi człowiek – ten plik mówi, co klikać i co
mówić. Ekrany i nazwy przycisków sprawdzone na buildzie z `main` (2026-10-04).

Adres demo: **[do potwierdzenia]** (patrz `README.md`). Lokalnie: `pnpm build && pnpm exec vite preview`.

## Minutaż

| Czas | Ekran | Co klikać | Co mówić |
|---|---|---|---|
| 0:00–0:20 | Szukaj | nic – mapa heksów już widoczna | „Mieszkanie wybieramy na lata, a okolicę sprawdzamy na oko. adresscore składa rejestry publiczne w jedną etykietę A–G dla każdego z 176 684 adresów Krakowa i 13 gmin obwarzanka.” |
| 0:20–0:50 | Szukaj | profil **Rodzina z dziećmi** → chwila → **Singiel w centrum** | „To ta sama mapa. Rodzinie liczą się przedszkola, zieleń i cisza, singlowi – dojazd i centrum. Wagi się zmieniają, mapa przelicza się na żywo.” |
| 0:50–1:10 | Szukaj | pole **Opisz siebie**: „Mam dwoje dzieci i psa, nie mam samochodu” → **Przelicz mapę** | „Można też napisać o sobie zwykłym zdaniem. AI – JEV – zamienia opis na wagi, ale wybiera tylko z zamkniętych list. Liczb nie wymyśla nigdy.” |
| 1:10–1:40 | Karta okolicy | klik w heks w centrum albo wyszukaj **Grodzka 52** | „Karta adresu: wynik 0–100, etykieta A–G, pasek kompletności – na ilu warstwach stoi wynik. Przy każdej liczbie źródło i rozdzielczość: adres, heks, gmina. Brak danych jest szary, nigdy zero.” Opcjonalnie: **Zapytaj o ten adres** → „Jak głośno tu jest?” |
| 1:40–2:10 | Porównanie | **Porównaj** na karcie, wróć do mapy, **Dodaj do porównania** przy 2–4 ulicach z listy → zakładka **Porównanie** | „Dodajemy do pięciu okolic i porównujemy je wobec własnych priorytetów – radar i pełna tabela. Link można wysłać partnerowi.” |
| 2:10–2:40 | Dla biznesu | zakładka **Dla biznesu** → branża (np. Apteka) → postaw **A** i **B** na mapie | „Te same dane dla przedsiębiorcy: kolor mówi, ilu mieszkańców przypada na istniejący punkt. Stawiam do pięciu miejsc testowych i porównuję je ze sobą.” |
| 2:40–3:00 | Symulator dla miasta (albo Metoda i źródła) | jedno kliknięcie, bez wchodzenia w szczegóły | „A dla miasta – gdzie są luki w usługach i ile adresów zyska nowy przystanek czy przedszkole. Narzędzie naprawy, nie tablica wstydu. adresscore – sprawdź swój adres.” |

Zasada: mówimy tylko liczby, które widać na ekranie albo są w `zgloszenie.md`.

## Przygotowanie (przed nagraniem)

- [ ] Otworzyć adres demo raz online (Chrome, okno 1600×900 albo 1920×1080, zoom 100%),
      przejść przez wszystkie ekrany ze scenariusza – service worker zapisze aplikację, dane i kafle.
- [ ] Wyczyścić porównanie z poprzednich prób (albo zacząć w świeżym profilu po pierwszym otwarciu).
- [ ] Sprawdzić, czy JEV odpowiada (`Opisz siebie` zmienia mapę). Jeśli nie – działa reguła
      zapasowa; tekst lektora zostaje bez zmian.
- [ ] Wyłączyć powiadomienia systemowe, schować zakładki i rozszerzenia przeglądarki.
- [ ] Mikrofon: test 10 s, bez echa; nagrywać w ciszy.
- [ ] Nagranie: OBS albo systemowy rejestrator ekranu, 1080p, 30 kl./s, MP4 (H.264).
- [ ] Zmierzyć czas próby na sucho – cel 2:50, twardy limit 3:00.
- [ ] Po nagraniu: obejrzeć całość, sprawdzić dźwięk; wrzucić na YouTube jako „Niepubliczny”
      i wkleić link w polu „Your video presentation” (`zgloszenie.md`).

## Plan B – offline

Build produkcyjny rejestruje service worker (`public/sw.js`, `src/main.tsx`). Po jednym pełnym
przejściu online aplikacja, dane, fonty i kafle mapy działają bez sieci.

1. Na sali, zanim zabierzesz głos: otwórz demo online i przejdź scenariusz (rozgrzanie cache).
2. Sieć padła → odśwież kartę: aplikacja wstanie z cache. Pokazuj tylko ekrany, które były otwarte.
3. JEV wymaga sieci – offline „Opisz siebie” działa na regule zapasowej. Mów: „AI ma regułę
   zapasową, więc aplikacja działa nawet bez sieci”.
4. Gdy i to zawiedzie: lokalnie `pnpm build && pnpm exec vite preview` na laptopie (dane są w
   plikach statycznych, baza niepotrzebna) albo odtwórz nagranie MP4.
5. Ostatnia deska: PDF `adresscore.pdf` – slajdy 3, 4 i 7 mają zrzuty ekranów.

## Lista kontrolna w dniu pitchu

- [ ] Laptop podłączony do zasilania, rzutnik w 16:9, test HDMI.
- [ ] Karta z demo otwarta i rozgrzana, druga karta z PDF, plik MP4 na pulpicie.
- [ ] Telefon z QR (slajd 10) zeskanowany przez sieć komórkową – adres działa.
