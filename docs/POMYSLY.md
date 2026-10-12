# Pomysły na później

## F. Wysyłanie pokoi z uwzględnieniem baterii (zapisane 2026-10-12)

Przed wysłaniem kolejnego pokoju sprawdzić, czy bateria wystarczy:
potrzeba = zmierzone zużycie pokoju (`bat_used` z historii, para pokój + tryb +
ssanie) + ~10% zapasu.

- Za mało baterii → robot zostaje w stacji i się ładuje do potrzebnego
  poziomu (ładowanie poniżej 40% jest najszybsze: ~1,1–1,5%/min) zamiast
  przerywać pokój w połowie i wracać.
- Opcja „kolejność wg baterii": przy niskim poziomie wysłać najpierw mniejszy
  pokój, który się zmieści, a duży (Salon ~30% przy mopowaniu) po doładowaniu.
- Opcja „pełne ładowanie przed mopowaniem": pierwszy pokój z mopem dopiero
  przy ≥95% — samo mopowanie mieszkania to ~90% baterii.

Dane potrzebne do tego zbiera 2.0.0-beta.23 (bateria w każdym przebiegu).
Warto wrócić, gdy każdy pokój ma ≥3 pomiary `bat_used`.
