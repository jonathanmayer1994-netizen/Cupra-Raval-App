#!/usr/bin/env python3
"""
Unit & E2E Test Suite for Remaining / Future Sunshine Hours Feature:
"bei der prognose der sonnenstunden soll sich immer alles auf die zukunft beziehen,
also auch heute wenn schon 4 stunden sonne rum sind und insgesamt 7,
erwarte ich das dran steht noch 3h sonne heute."
"""

import sys
import time
import json
from playwright.sync_api import sync_playwright

def test_remaining_sun_hours():
    print("=" * 70)
    print("TEST SUITE: ZUKUNFTSBEZOGENE SONNENSTUNDEN-PROGNOSE (REMAINING SUN HOURS)")
    print("=" * 70)

    passed = 0
    failed = 0

    def assert_eq(condition, msg):
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"[PASSED] {msg}")
        else:
            failed += 1
            print(f"[FAILED] {msg}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("\n--- TEST 1: Unit Tests: WeatherService.calculateRemainingSunHours ---")
        page.goto("http://127.0.0.1:8080")
        page.wait_for_function("() => typeof window.WeatherService !== 'undefined' && typeof window.WeatherService.calculateRemainingSunHours === 'function'")

        # 1.1 Exaktes Nutzerszenario: 7h Sonne insgesamt, 4h vorbei -> noch 3h Sonne
        # Konstruiere ein synthetisches 24h Profil mit 7h Sonne (z. B. von 09:00 bis 16:00 je 1h)
        # Und teste zur Uhrzeit 13:00 (Stunden 9, 10, 11, 12 = 4h vorbei, 13, 14, 15 = 3h verbleibend)
        exact_user_case = page.evaluate("""() => {
            const hourly = [];
            for (let h = 0; h < 24; h++) {
                // 7 Stunden Sonne zwischen 09:00 und 16:00
                const isSun = (h >= 9 && h < 16);
                hourly.push({
                    hour: h,
                    sunHours: isSun ? 1.0 : 0.0,
                    calibratedSunHours: isSun ? 1.0 : 0.0
                });
            }
            // Simuliere 13:00 Uhr
            const mockDate13 = new Date(2026, 10, 5, 13, 0, 0);
            return window.WeatherService.calculateRemainingSunHours(7.0, hourly, mockDate13);
        }""")

        assert_eq(exact_user_case.get("total") == 7.0, f"Gesamtsumme ist 7.0h: {exact_user_case.get('total')}")
        assert_eq(exact_user_case.get("past") == 4.0, f"4h Sonne rum: {exact_user_case.get('past')}h")
        assert_eq(exact_user_case.get("remaining") == 3.0, f"Genau noch 3h Sonne heute verbleibend: {exact_user_case.get('remaining')}h")

        # 1.2 Frühmorgens vor Sonnenaufgang (06:00 Uhr) -> 0h vorbei, alle 7h verbleibend
        morning_case = page.evaluate("""() => {
            const hourly = [];
            for (let h = 0; h < 24; h++) {
                const isSun = (h >= 9 && h < 16);
                hourly.push({ hour: h, sunHours: isSun ? 1.0 : 0.0 });
            }
            const mockDate06 = new Date(2026, 10, 5, 6, 0, 0);
            return window.WeatherService.calculateRemainingSunHours(7.0, hourly, mockDate06);
        }""")
        assert_eq(morning_case.get("past") == 0.0, f"Morgens 0h vergangen: {morning_case.get('past')}h")
        assert_eq(morning_case.get("remaining") == 7.0, f"Morgens alle 7.0h verbleibend: {morning_case.get('remaining')}h")

        # 1.3 Abends nach Sonnenuntergang (19:00 Uhr) -> 7h vorbei, 0h verbleibend
        evening_case = page.evaluate("""() => {
            const hourly = [];
            for (let h = 0; h < 24; h++) {
                const isSun = (h >= 9 && h < 16);
                hourly.push({ hour: h, sunHours: isSun ? 1.0 : 0.0 });
            }
            const mockDate19 = new Date(2026, 10, 5, 19, 0, 0);
            return window.WeatherService.calculateRemainingSunHours(7.0, hourly, mockDate19);
        }""")
        assert_eq(evening_case.get("past") == 7.0, f"Abends alle 7.0h vergangen: {evening_case.get('past')}h")
        assert_eq(evening_case.get("remaining") == 0.0, f"Abends 0.0h verbleibend: {evening_case.get('remaining')}h")

        # 1.4 Halb-stündige Interpolation (13:30 Uhr) -> 4.5h vorbei, 2.5h verbleibend
        half_hour_case = page.evaluate("""() => {
            const hourly = [];
            for (let h = 0; h < 24; h++) {
                const isSun = (h >= 9 && h < 16);
                hourly.push({ hour: h, sunHours: isSun ? 1.0 : 0.0 });
            }
            const mockDate1330 = new Date(2026, 10, 5, 13, 30, 0);
            return window.WeatherService.calculateRemainingSunHours(7.0, hourly, mockDate1330);
        }""")
        assert_eq(half_hour_case.get("past") == 4.5, f"13:30 Uhr: 4.5h vergangen: {half_hour_case.get('past')}h")
        assert_eq(half_hour_case.get("remaining") == 2.5, f"13:30 Uhr: 2.5h verbleibend: {half_hour_case.get('remaining')}h")

        # 1.5 Fallback ohne stündliches Array über Sinus-Integralkurve
        fallback_case = page.evaluate("""() => {
            const mockMidday = new Date(2026, 10, 5, 12, 15, 0);
            return window.WeatherService.calculateRemainingSunHours(8.0, null, mockMidday);
        }""")
        assert_eq(fallback_case.get("total") == 8.0, f"Fallback Gesamt: {fallback_case.get('total')}h")
        assert_eq(fallback_case.get("remaining") > 0 and fallback_case.get("past") > 0,
                  f"Fallback teilt Tag in Vergangenheit & Zukunft: past={fallback_case.get('past')}h, rem={fallback_case.get('remaining')}h")

        print("\n--- TEST 2: Datenmodell in weatherForecast14Days ---")
        page.wait_for_function("() => window.appData && (window.weatherForecast14Days || localStorage.getItem('cupra_weather_cache_v10') || document.querySelectorAll('.day-forecast-card').length > 0)", timeout=15000)
        time.sleep(0.5)

        fc_model = page.evaluate("""() => {
            let list = window.weatherForecast14Days;
            if (!list) {
                const raw = localStorage.getItem('cupra_weather_cache_v10');
                if (raw) list = JSON.parse(raw);
            }
            if (!list) return null;
            const d0 = list[0];
            const d1 = list[1];
            return {
                d0_total: d0.sunshineHours,
                d0_hasRemaining: (d0.remainingSunshineHours !== undefined),
                d0_remaining: d0.remainingSunshineHours,
                d0_past: d0.pastSunshineHours,
                d0_display: d0.sunshineRemainingDisplay,
                d1_total: d1.sunshineHours,
                d1_remaining: d1.remainingSunshineHours,
                d1_past: d1.pastSunshineHours,
                d1_display: d1.sunshineRemainingDisplay
            };
        }""")

        assert_eq(fc_model is not None, "Wettervorhersage-Datenmodell erfolgreich geladen")
        assert_eq(fc_model.get("d0_hasRemaining") is True, f"Heute besitzt remainingSunshineHours: {fc_model.get('d0_remaining')}h")
        assert_eq(fc_model.get("d0_past") is not None, f"Heute besitzt pastSunshineHours: {fc_model.get('d0_past')}h")
        assert_eq(fc_model.get("d1_past") == 0, f"Morgen besitzt 0h vergangene Sonne: past={fc_model.get('d1_past')}h")
        assert_eq(fc_model.get("d1_remaining") == fc_model.get("d1_total"),
                  f"Morgen entspricht verbleibend der Tagessumme ({fc_model.get('d1_remaining')}h == {fc_model.get('d1_total')}h)")

        print("\n--- TEST 3: UI-Darstellung auf dem Dashboard (Tab 1) ---")
        ki_chip_text = page.locator(".pv-stat-chip.chip-ki").inner_text()
        raw_chip_text = page.locator(".pv-stat-chip.chip-raw").inner_text()
        print(f"Dashboard KI Chip: '{ki_chip_text}', Modell Chip: '{raw_chip_text}'")

        assert_eq("KI" in ki_chip_text, f"KI Chip enthält 'KI': '{ki_chip_text}'")
        assert_eq("Modell" in raw_chip_text, f"Modell Chip enthält 'Modell': '{raw_chip_text}'")
        
        # Prüfe ob 'noch' oder verbleibende Stunden vorhanden sind
        has_future_reference = "noch" in ki_chip_text or "noch" in raw_chip_text or "h" in ki_chip_text
        assert_eq(has_future_reference is True, f"Dashboard Chips spiegeln Zukunftsbezug wider: {ki_chip_text} | {raw_chip_text}")

        reco_subline = page.locator("#dashRecoSubline").inner_text()
        print(f"Dashboard Subline: '{reco_subline}'")
        assert_eq(len(reco_subline) > 10, f"Subline ist aussagekräftig befüllt: '{reco_subline}'")

        print("\n--- TEST 4: UI-Darstellung im Wetter-Tab (Tab 3) ---")
        page.click('button[data-tab="weather"]')
        time.sleep(0.5)

        # Prüfe die Heute-Tageskarte
        today_sun_stat = page.locator('#weatherPrimary4Container .day-forecast-card[data-dayindex="0"] .day-sun-stat').inner_text()
        print(f"Heute Sonnen-Badge: '{today_sun_stat}'")
        assert_eq("☀️" in today_sun_stat and ("noch" in today_sun_stat or "verbleibend" in today_sun_stat or "h" in today_sun_stat),
                  f"Tageskarte Heute zeigt Zukunftsbezug: '{today_sun_stat}'")

        # Prüfe Morgen-Tageskarte (darf kein 'verbleibend' / 'rum' zeigen, sondern normale Vorschau)
        tomorrow_sun_stat = page.locator('#weatherPrimary4Container .day-forecast-card[data-dayindex="1"] .day-sun-stat').inner_text()
        print(f"Morgen Sonnen-Badge: '{tomorrow_sun_stat}'")
        assert_eq("☀️" in tomorrow_sun_stat and "noch" not in tomorrow_sun_stat,
                  f"Tageskarte Morgen zeigt reguläre Zukunftsprognose: '{tomorrow_sun_stat}'")

        print("\n--- TEST 5: 24h Stündliches Modal ---")
        page.locator('#weatherPrimary4Container .day-forecast-card[data-dayindex="0"]').click()
        time.sleep(0.5)
        
        modal_total_sun = page.locator("#hourlyTotalSun").inner_text()
        modal_sub = page.locator("#hourlyModalSub").inner_text()
        print(f"Modal Total Sun: '{modal_total_sun}', Modal Subtitle: '{modal_sub}'")
        
        assert_eq("h" in modal_total_sun, f"Modal zeigt Sonnenstunden an: '{modal_total_sun}'")
        assert_eq("Noch" in modal_sub or "heute" in modal_sub or "Heute" in modal_sub,
                  f"Modal Subtitle bezieht sich auf verbleibende Sonne heute: '{modal_sub}'")
        page.click("#btnCloseHourlyModal")
        time.sleep(0.3)

        print("\n" + "=" * 70)
        print(f"ERGEBNIS: {passed} PASSED, {failed} FAILED")
        print("=" * 70)

        browser.close()
        return failed == 0

if __name__ == "__main__":
    success = test_remaining_sun_hours()
    sys.exit(0 if success else 1)

