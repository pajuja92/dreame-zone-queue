# Logo integracji w Home Assistant

HA pobiera ikony integracji z centralnego repo `home-assistant/brands` —
lokalne pliki nie wystarczą. Aby ikona pojawiła się w UI:

1. Zrób fork https://github.com/home-assistant/brands
2. Skopiuj katalog `dreame_zone_queue/` (z tego folderu) do
   `custom_integrations/dreame_zone_queue/` w forku
   (pliki: `icon.png` 256x256, `icon@2x.png` 512x512)
3. Otwórz Pull Request. Po zmergowaniu i wyczyszczeniu cache
   (brands CDN + odświeżenie przeglądarki) ikona pojawi się w
   Ustawienia -> Urządzenia i usługi oraz w HACS.

Do czasu merge'a HA pokazuje domyślny placeholder — to normalne
dla każdej integracji custom.
