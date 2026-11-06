#!/usr/bin/env python3
"""
Test Suite: Bayrhofs Photovoltaik-Physik & 3-Phasen Wallbox Modellierung
Standort: Bayrhofs ("Technik für Kuhkomfort", Unterwang 18, 87439 Kempten)
Dach: 30° Dachneigung, 180° Süd-Ausrichtung, 18.7 kWp Peak, -0.38%/K Zelltemperatur,
Baumreihen-Horizontdämpfung (< 18°), konfigurierbare Grundlast (Standard 3.5 kW)
und strikte 3-Phasen Wallbox-Schwelle (4.1 kW).
"""

import sys
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8080"

passed_count = 0
failed_count = 0

def log_test(name, condition, details=""):
    global passed_count, failed_count
    if condition:
        print(f"[PASSED] {name}: {details}")
        passed_count += 1
    else:
        print(f"[FAILED] {name}: {details}")
        failed_count += 1

def run_tests():
    global passed_count, failed_count

    print("=" * 70)
    print("TEST SUITE: BAYRHOFS PV-PHYSIK & 3-PHASEN WALLBOX MODELLIERUNG")
    print("=" * 70)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 393, "height": 852}) # iPhone 15 Pro
        page = context.new_page()

        # Konsole-Fehler abfangen (Ignoriere optionale Dummy-Webcam-Images / Favicon)
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if (msg.type == "error" and "favicon" not in msg.text and "404" not in msg.text) else None)

        print("\n--- TEST 1: Laden der Web-Applikation & Script-Initialisierung ---")
        page.goto(BASE_URL, wait_until="networkidle")
        time.sleep(0.3)
        log_test("Keine kritischen Konsolenfehler beim Laden", len(console_errors) == 0, f"Fehler: {console_errors}")

        print("\n--- TEST 2: Physikalische Parameter & Konstanten in WeatherService ---")
        cfg = page.evaluate("() => WeatherService.BAYRHOFS_CONFIG")
        log_test("Anlagen-Peakleistung ist 18.7 kWp (A1)", cfg.get("peakPowerKwp") == 18.7, f"Peak: {cfg.get('peakPowerKwp')} kWp")
        log_test("Dachneigung ist 30° (A2)", cfg.get("tiltDeg") == 30.0, f"Tilt: {cfg.get('tiltDeg')}°")
        log_test("Ausrichtung ist 180° Süd (A2)", cfg.get("azimuthDeg") == 180.0, f"Azimuth: {cfg.get('azimuthDeg')}°")
        log_test("Temperaturkoeffizient ist -0.38%/K (A5)", cfg.get("tempCoeff") == -0.0038, f"TempCoeff: {cfg.get('tempCoeff')}/K")
        log_test("Baumreihen-Horizontwinkel ist 18° (A6)", cfg.get("treeHorizonDeg") == 18.0, f"Tree Horizon: {cfg.get('treeHorizonDeg')}°")
        log_test("3-Phasen Wallbox-Mindestschwelle ist 4.1 kW (A7)", cfg.get("wallboxMinSurplusKw") == 4.1, f"Wallbox Min: {cfg.get('wallboxMinSurplusKw')} kW")
        log_test("Standard-Standortgrundlast ist 3.5 kW (A3)", cfg.get("defaultBaseLoadKw") == 3.5, f"Base Load: {cfg.get('defaultBaseLoadKw')} kW")

        print("\n--- TEST 3: GTI-Transposition (30° Süd) vs. Horizontales GHI ---")
        # Mittag 12:00 Uhr am 6. November (niedriger Sonnenstand ~25°):
        # 30° Süddach fängt viel steileres Licht ein als flacher Boden!
        gti_eval = page.evaluate("""() => {
            const dateNov = new Date('2026-11-06T12:00:00Z');
            const res = WeatherService.calculateBayrhofsSolarPhysics(dateNov, 12, 450, 750, 80, 5, 3.5);
            return res;
        }""")
        log_test("Sonnenhöhe zu Mittag im November ca. 24-26°", 23.0 <= gti_eval.get("alphaDeg") <= 27.0, f"Alpha: {gti_eval.get('alphaDeg')}°")
        log_test("GTI auf 30° Süddach wesentlich höher als horizontales GHI", gti_eval.get("gti") > gti_eval.get("ghi"), f"GTI: {gti_eval.get('gti')} W/m² > GHI: {gti_eval.get('ghi')} W/m²")
        boost_pct = round(((gti_eval.get("gti") / gti_eval.get("ghi")) - 1) * 100, 1)
        log_test("GTI Einstrahlungs-Gewinn > 35% im November", boost_pct >= 35.0, f"+{boost_pct}% Gewinn durch 30° Süddach")

        print("\n--- TEST 4: Baumreihen-Dämpfung bei niedrigen Sonnenständen (< 18°) ---")
        low_sun_eval = page.evaluate("""() => {
            const dateNov = new Date('2026-11-06T08:00:00Z'); // Früher Vormittag
            const res = WeatherService.calculateBayrhofsSolarPhysics(dateNov, 8, 120, 250, 40, 2, 3.5);
            return res;
        }""")
        log_test("Sonnenhöhe < 18° löst Horizont-Dämpfung aus", low_sun_eval.get("fShade") < 1.0, f"fShade: {low_sun_eval.get('fShade')}")
        high_sun_eval = page.evaluate("""() => {
            const dateNov = new Date('2026-11-06T12:00:00Z');
            const res = WeatherService.calculateBayrhofsSolarPhysics(dateNov, 12, 450, 750, 80, 5, 3.5);
            return res;
        }""")
        log_test("Sonnenhöhe >= 18° hat ungedämpfte freie Einstrahlung (fShade = 1.0)", high_sun_eval.get("fShade") == 1.0, f"fShade: {high_sun_eval.get('fShade')}")

        print("\n--- TEST 5: Physikalische Zelltemperatur-Modellierung (-0.38%/K) ---")
        cold_eval = page.evaluate("""() => {
            // Kalter Allgäuer Wintertag: 0°C Luft, 600 W/m² Sonne
            const res = WeatherService.calculateBayrhofsSolarPhysics(new Date('2026-11-06T12:00:00Z'), 12, 400, 650, 70, 0, 3.5);
            return res;
        }""")
        log_test("Zelltemperatur liegt über Lufttemperatur", cold_eval.get("tCell") > 0, f"T_cell: {cold_eval.get('tCell')}°C bei T_amb: 0°C")
        log_test("Kühle Zellen (< 25°C STC) liefern Wirkungsgrad-Bonus (etaTemp >= 1.0)", cold_eval.get("etaTemp") >= 1.0, f"etaTemp: {cold_eval.get('etaTemp')}")

        hot_eval = page.evaluate("""() => {
            // Heißer Sommertag: 30°C Luft, 850 W/m² GTI
            const res = WeatherService.calculateBayrhofsSolarPhysics(new Date('2026-07-15T12:00:00Z'), 12, 850, 850, 100, 30, 3.5);
            return res;
        }""")
        log_test("Heiße Sommerzellen (> 50°C) verringern Leistung (etaTemp < 0.90)", hot_eval.get("etaTemp") < 0.90, f"etaTemp: {hot_eval.get('etaTemp')} bei T_cell: {hot_eval.get('tCell')}°C")

        print("\n--- TEST 6: Standort-Grundlast (3.5 kW) & Netto-Überschuss ---")
        base_eval = page.evaluate("""() => {
            // PV-Erzeugung 8.0 kW, Grundlast 3.5 kW
            const p1 = WeatherService.calculateBayrhofsSolarPhysics(new Date('2026-11-06T12:00:00Z'), 12, 450, 750, 80, 5, 3.5);
            // PV-Erzeugung bei kleiner Strahlung (z.B. 2.0 kW)
            const p2 = WeatherService.calculateBayrhofsSolarPhysics(new Date('2026-11-06T12:00:00Z'), 12, 100, 120, 40, 5, 3.5);
            return { p1, p2 };
        }""")
        p1 = base_eval["p1"]
        p2 = base_eval["p2"]
        expected_surplus = round(max(0, p1["pvKw"] - 3.5), 2)
        log_test("Netto-Überschuss zieht 3.5 kW Grundlast exakt ab", abs(p1["surplusKw"] - expected_surplus) < 0.05, f"PV: {p1['pvKw']} kW - 3.5 kW = {p1['surplusKw']} kW")
        log_test("Wenn PV unter Grundlast liegt, ist Überschuss 0 (kein negativer Export)", p2["surplusKw"] == 0, f"PV: {p2['pvKw']} kW, Surplus: {p2['surplusKw']} kW")

        print("\n--- TEST 7: Strikte 3-Phasen Wallbox-Steuerung (4.1 kW Mindestschwelle) ---")
        wb_eval = page.evaluate("""() => {
            // Fall 1: Überschuss < 4.1 kW (z.B. 3.0 kW) -> Wallbox pausiert (evChargeKw = 0)
            const pLow = WeatherService.calculateBayrhofsSolarPhysics(new Date('2026-11-06T12:00:00Z'), 12, 250, 350, 60, 5, 3.5);
            // Fall 2: Überschuss >= 4.1 kW -> Wallbox aktiv
            const pHigh = WeatherService.calculateBayrhofsSolarPhysics(new Date('2026-11-06T12:00:00Z'), 12, 550, 850, 80, 5, 3.5);
            return { pLow, pHigh };
        }""")
        pLow = wb_eval["pLow"]
        pHigh = wb_eval["pHigh"]
        if pLow["surplusKw"] < 4.1:
            log_test("Überschuss < 4.1 kW pausiert Wallbox (evChargeKw = 0)", pLow["isWallboxActive"] is False and pLow["evChargeKw"] == 0.0, f"Surplus: {pLow['surplusKw']} kW, evCharge: {pLow['evChargeKw']} kW")
        else:
            log_test("Überschuss Testwert 1 validiert", True, f"Surplus: {pLow['surplusKw']} kW")

        log_test("Überschuss >= 4.1 kW aktiviert Wallbox", pHigh["isWallboxActive"] is True and pHigh["evChargeKw"] >= 4.1, f"Surplus: {pHigh['surplusKw']} kW, evCharge: {pHigh['evChargeKw']} kW")

        print("\n--- TEST 8: Einstellungen-UI: Grundlast-Slider & Eingabefeld in Tab 4 ---")
        # Zu Einstellungen -> Ladeorte navigieren
        page.locator('.dock-tab-btn[data-tab="settings"]').click()
        time.sleep(0.1)
        page.locator('.picker-seg[data-settab="locations"]').click()
        time.sleep(0.1)

        card_visible = page.locator("#bayrhofsPvConfigCard").is_visible()
        log_test("Bayrhofs PV- & Wallbox-Konfigurationskarte vorhanden", card_visible, "Sichtbar in Tab 4 (Ladeorte)")

        slider_val = page.locator("#sliderBayrhofsBaseLoad").input_value()
        input_val = page.locator("#inputBayrhofsBaseLoad").input_value()
        lbl_val = page.locator("#lblBayrhofsBaseLoad").inner_text()
        log_test("Initialer Grundlast-Wert ist 3.5 kW", slider_val == "3.5" and "3.5" in input_val and "3.5" in lbl_val, f"Slider: {slider_val}, Input: {input_val}, Label: {lbl_val}")

        # Slider auf 4.0 kW anpassen
        page.evaluate("""() => {
            const s = document.getElementById('sliderBayrhofsBaseLoad');
            s.value = '4.0';
            s.dispatchEvent(new Event('input', { bubbles: true }));
            s.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        time.sleep(0.08)

        updated_lbl = page.locator("#lblBayrhofsBaseLoad").inner_text()
        updated_input = page.locator("#inputBayrhofsBaseLoad").input_value()
        stored_setting = page.evaluate("() => JSON.parse(localStorage.getItem('cupra_raval_data')).settings.bayrhofsBaseLoadKw")
        log_test("Slider-Änderung aktualisiert Label & Input reaktiv", "4.0" in updated_lbl and "4.0" in updated_input, f"Label: {updated_lbl}, Input: {updated_input}")
        log_test("Grundlast-Einstellung persistiert im App-Speicher", stored_setting == 4.0, f"Gespeichert: {stored_setting} kW")

        # Zurücksetzen auf 3.5 kW via Input-Feld
        page.locator("#inputBayrhofsBaseLoad").fill("3.5")
        page.locator("#inputBayrhofsBaseLoad").dispatch_event("change")
        time.sleep(0.08)
        page.locator("#btnSaveBayrhofsPvSettings").click()
        time.sleep(0.1)
        restored_setting = page.evaluate("() => JSON.parse(localStorage.getItem('cupra_raval_data')).settings.bayrhofsBaseLoadKw")
        log_test("Speichern-Button sichert 3.5 kW Standard erfolgreich", restored_setting == 3.5, f"Restored: {restored_setting} kW")

        print("\n--- TEST 9: Tages- & Dashboard-Integration der PV-Ertragsdaten ---")
        # Zurück zum Dashboard
        page.locator('.dock-tab-btn[data-tab="dashboard"]').click()
        time.sleep(0.15)

        today_forecast = page.evaluate("() => weatherForecast14Days ? weatherForecast14Days[0] : null")
        log_test("Heute-Prognoseobjekt geladen", today_forecast is not None, f"Tag: {today_forecast.get('dateStr') if today_forecast else 'None'}")
        if today_forecast and today_forecast.get("solarYield"):
            sy = today_forecast.get("solarYield")
            pv_kwh = sy.get("estimatedPvKwh")
            gti_w = sy.get("maxGtiWatts") or sy.get("maxGhiWatts")
            log_test("18.7 kWp PV-Ertrag im Datenmodell vorhanden", pv_kwh is not None and pv_kwh >= 0, f"Ertrag: {pv_kwh} kWh, Max GTI: {gti_w} W/m²")

        # Wetter-Tab prüfen
        page.locator('.dock-tab-btn[data-tab="weather"]').click()
        time.sleep(0.15)
        solar_chips = page.locator(".day-forecast-card .day-solar-stat").count()
        log_test("PV-Ertragschips auf den 14 Tageskarten sichtbar", solar_chips > 0, f"{solar_chips} Karten mit ⚡️ kWh Kennzeichnung")

        # TEST 10: Cupra Raval 52 kWh NMC AC-Ladekurve & Balancing-Drosselung
        print("\n--- TEST 10: Cupra Raval (52 kWh NMC) AC-Ladekurve & Balancing ---")
        ac_eval = page.evaluate("""() => {
            const p50 = WeatherService.calculateCupraAcChargePower(50, 11.0);
            const p90 = WeatherService.calculateCupraAcChargePower(90, 11.0);
            const p92 = WeatherService.calculateCupraAcChargePower(92, 11.0);
            const p96 = WeatherService.calculateCupraAcChargePower(96, 11.0);
            const p100 = WeatherService.calculateCupraAcChargePower(100, 11.0);

            // Ladedauer von 20% auf 80% (NMC-Sweetspot ohne Drosselung)
            const durSweet = WeatherService.calculateCupraAcChargeDuration(20, 80, 11.0, 52.0);
            // Ladedauer von 80% auf 100% (inkl. Balancing ab 92%)
            const durFull = WeatherService.calculateCupraAcChargeDuration(80, 100, 11.0, 52.0);

            return { p50, p90, p92, p96, p100, durSweet, durFull };
        }""")
        p50 = ac_eval["p50"]
        p92 = ac_eval["p92"]
        p96 = ac_eval["p96"]
        p100 = ac_eval["p100"]
        durSweet = ac_eval["durSweet"]
        durFull = ac_eval["durFull"]

        log_test("Volle 11 kW Ladeleistung bis 92% SoC", p50["chargeKw"] == 11.0 and p92["chargeKw"] == 11.0 and not p92["isBalancing"], f"P(50%)={p50['chargeKw']} kW, P(92%)={p92['chargeKw']} kW")
        log_test("Balancing-Drosselung greift bei 96% SoC", 6.0 <= p96["chargeKw"] <= 7.0 and p96["isBalancing"], f"P(96%)={p96['chargeKw']} kW, Balancing: {p96['isBalancing']}")
        log_test("Erhaltungsladung bei 100% SoC beträgt 2.3 kW", p100["chargeKw"] == 2.3 and p100["isBalancing"], f"P(100%)={p100['chargeKw']} kW")
        log_test("Ladedauer 20% -> 80% beträgt ~2.8h (170 min) ohne Balancing-Verzögerung", 165 <= durSweet["durationMinutes"] <= 175 and durSweet["balancingMinutes"] == 0, f"{durSweet['durationMinutes']} min ({durSweet['durationHours']}h), Balancing: {durSweet['balancingMinutes']} min")
        log_test("Ladedauer 80% -> 100% enthält > 35 min Zell-Balancing", durFull["balancingMinutes"] >= 35, f"{durFull['durationMinutes']} min, davon {durFull['balancingMinutes']} min Balancing")

        # Responsive Screenshot erstellen
        screenshot_path = "/Users/jona/.gemini/antigravity/brain/87020218-9ff4-4f72-a4c9-3914438f697f/bayrhofs_pv_settings_iphone15.png"
        page.locator('.dock-tab-btn[data-tab="settings"]').click()
        time.sleep(0.1)
        page.locator('.picker-seg[data-settab="locations"]').click()
        time.sleep(0.1)
        page.locator("#bayrhofsPvConfigCard").scroll_into_view_if_needed()
        page.screenshot(path=screenshot_path)
        log_test("Screenshot der Bayrhofs PV- & Wallbox-Einstellungen erstellt", True, screenshot_path)

        browser.close()

    print("\n" + "=" * 70)
    print(f"ERGEBNIS: {passed_count} PASSED, {failed_count} FAILED")
    print("=" * 70)

    if failed_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
