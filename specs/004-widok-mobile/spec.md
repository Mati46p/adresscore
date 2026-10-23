# Spec 004: Widok Web/Mobile (#248)

## Problem
Telefon 390 px: poziomy scroll strony, podwójny scroll, mapa ~270 px przykryta legendą
i etykietami, cele 22–36 px, 13 breakpointów. Desktop: mapa ~55% wysokości, nagłówek 101 px
niesticky, brak tokenów odstępów, cieni, ruchu i z-index.

## Historie
- **US1 (P1)** Na telefonie mapa zajmuje cały ekran, a panel to dolny arkusz z 3 stanami
  (zwinięty / pół / pełny) – decyzja właściciela 2026-10-23.
- **US2 (P1)** Na desktopie mapa ma pełną wysokość prawej kolumny; ranking to zakładka panelu.
- **US3 (P2)** Każdy element klikalny ≥ 44×44 px; zero poziomego scrolla; jeden kontener
  przewijania na kolumnę; pod `prefers-reduced-motion` brak animacji.

## Wymagania
- FR-001 Tokeny w `src/styles.css`: odstępy, pismo, promienie, cienie, ruch, z-index.
- FR-002 Trzy breakpointy: 640 / 1024 / 1440 (`src/lib/punktyLamania.ts` dla JS).
- FR-003 Arkusz bez nowych zależności, dostępny z klawiatury (uchwyt = przycisk, Esc zwija).
- FR-004 Wybrany adres zawsze widoczny nad krawędzią arkusza (padding mapy).
- FR-005 Wszystkie `data-cel` (analityka) zachowane.

Plan: [plan.md](plan.md), zadania: [tasks.md](tasks.md).
