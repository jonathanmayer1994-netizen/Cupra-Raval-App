"""
Test Suite: Inversions-Hochnebel & Computer-Vision Sensor Fusion System
Verifiziert:
1. Clientseitige Pixel- & Kontrastanalyse (Offscreen-Canvas 64x48px, Luma, Sigma, Mean, BlueSkyRatio)
2. Nacht-Check (Mean < 40 -> Pause)
3. Dichter Nebel vs. Sonnenschein Klassifizierung (Sigma < 24 vs. Sigma > 50)
4. Multi-Elevation Delta Abgleich (Tal vs. Mittelstation vs. Gipfel, Inversionsobergrenze ~1.450m)
5. Sensor-Fusion & Forecast-Override (WMO 45 "Dichter Hochnebel" im Tal vs. "Sonnig über dem Nebelmeer" am Gipfel)
6. UI-Rendering: Webcam-Karten mit AI-Tags & Inversions-Monitor im Allgäu Solar-Adaptive Card
"""

import sys
import time
from playwright.sync_api import sync_playwright

def test_inversion_computer_vision_and_ui():
    passed = 0
    failed = 0

    def assert_eq(condition, msg):
        nonlocal passed, failed
        if condition:
            print(f"[PASSED] {msg}")
            passed += 1
        else:
            print(f"[FAILED] {msg}")
            failed += 1

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console messages
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        print("\n--- TEST 1: App laden & Skripte initialisieren ---")
        page.goto("http://127.0.0.1:8080/")
        page.wait_for_selector("#tab-weather", state="attached")
        time.sleep(2.0)

        assert_eq(len([e for e in console_errors if "InversionVision" in e or "SyntaxError" in e]) == 0,
                  "Keine Syntax- oder Ladefehler in Skripten")

        print("\n--- TEST 2: InversionVisionService Unit-Logik (Algorithm A & B) ---")
        # Test synthetic images & mathematical pixel classification
        vision_tests = page.evaluate("""() => {
            const V = window.InversionVisionService;
            if (!V) return { ok: false, err: 'InversionVisionService undefined' };

            // 1. Valley Fog Check
            const vCanvas = V.createSyntheticWebcamCanvas('valley_fog');
            const vRes = V.analyzeWebcamForFog(vCanvas);

            // 2. Peak Sun Check
            const pCanvas = V.createSyntheticWebcamCanvas('peak_sun');
            const pRes = V.analyzeWebcamForFog(pCanvas);

            // 3. Night Check
            const nCanvas = V.createSyntheticWebcamCanvas('night');
            const nRes = V.analyzeWebcamForFog(nCanvas);

            // 4. Multi-Elevation Comparison
            const camList = [
                { elevation: 720, tier: 'valley', analysis: vRes },
                { elevation: 1080, tier: 'mid', analysis: V.analyzeWebcamForFog(V.createSyntheticWebcamCanvas('mid_fog')) },
                { elevation: 2224, tier: 'peak', analysis: pRes }
            ];
            const tierComp = V.compareElevationTiers(camList);

            return {
                ok: true,
                valley: vRes,
                peak: pRes,
                night: nRes,
                tierComp: tierComp
            };
        }""")

        assert_eq(vision_tests.get("ok") is True, "InversionVisionService ist im Browser geladen und verfügbar")
        
        valley_res = vision_tests.get("valley", {})
        assert_eq(valley_res.get("isFoggy") is True, f"Talstufe als Nebel erkannt: isFoggy={valley_res.get('isFoggy')}")
        assert_eq(valley_res.get("contrastSigma", 99) < 24.0, f"Talstufe Kontrastmaß σ < 24: σ={valley_res.get('contrastSigma')}")
        assert_eq(valley_res.get("blueSkyRatio", 1.0) < 0.05, f"Talstufe BlueSkyRatio < 5%: blueSky={valley_res.get('blueSkyRatio')}")

        peak_res = vision_tests.get("peak", {})
        assert_eq(peak_res.get("isClear") is True, f"Gipfelstufe als Sonnig/Klar erkannt: isClear={peak_res.get('isClear')}")
        assert_eq(peak_res.get("contrastSigma", 0) > 50.0, f"Gipfelstufe Kontrastmaß σ > 50: σ={peak_res.get('contrastSigma')}")
        assert_eq(peak_res.get("blueSkyRatio", 0) >= 0.25, f"Gipfelstufe BlueSkyRatio >= 25%: blueSky={peak_res.get('blueSkyRatio')}")

        night_res = vision_tests.get("night", {})
        assert_eq(night_res.get("isNight") is True, f"Nacht-Check greift (Mean < 40): isNight={night_res.get('isNight')}, mean={night_res.get('meanLuma')}")
        assert_eq(night_res.get("status") == "night", f"Nacht-Status pausiert Analyse: status='{night_res.get('status')}'")

        tier_comp = vision_tests.get("tierComp", {})
        assert_eq(tier_comp.get("inversionDetected") is True, f"Multi-Elevation Inversion verifiziert: inversionDetected={tier_comp.get('inversionDetected')}")
        assert_eq(tier_comp.get("inversionCeilingMeters") == 1450, f"Inversionsobergrenze korrekt auf ~1.450 m ermittelt: ceiling={tier_comp.get('inversionCeilingMeters')}")

        print("\n--- TEST 3: Sensor-Fusion & Forecast-Override (Algorithm C) ---")
        fusion_tests = page.evaluate("""() => {
            const V = window.InversionVisionService;
            const forecastData = { weatherCode: 0, cloudCoverPct: 15, sunshineHours: 7.2 };
            const telemetry = { relativeHumidity: 88, windSpeedKmh: 5 };
            const tierComp = {
                inversionDetected: true,
                inversionCeilingMeters: 1450,
                valleyStatus: { isFoggy: true }
            };

            // 1. Tal-Standort (720m <= 1450m) -> WMO 45 Dichter Hochnebel
            const valleyOverride = V.detectInversionDiscrepancy(forecastData, telemetry, tierComp, 720);

            // 2. Berglage (2224m > 1450m) -> Sonnig über dem Nebelmeer
            const peakOverride = V.detectInversionDiscrepancy(forecastData, telemetry, tierComp, 2224);

            return {
                valley: valleyOverride,
                peak: peakOverride
            };
        }""")

        v_override = fusion_tests.get("valley", {})
        assert_eq(v_override.get("discrepancyDetected") is True, "Sensor-Fusion Diskrepanz im Tal erkannt")
        assert_eq(v_override.get("overriddenWeatherCode") == 45, f"Wettercode im Tal auf WMO 45 überschrieben: code={v_override.get('overriddenWeatherCode')}")
        assert_eq("1.450" in v_override.get("conditionText", ""), f"Zustandstext im Tal enthält Inversionsobergrenze: '{v_override.get('conditionText')}'")
        assert_eq(v_override.get("icon") == "🌫️", f"Icon im Tal auf Nebel gesetzt: icon='{v_override.get('icon')}'")
        assert_eq(v_override.get("sunshineDampened") is True, "Sonnenschein im Tal wurde gedämpft")

        p_override = fusion_tests.get("peak", {})
        assert_eq(p_override.get("discrepancyDetected") is True, "Sensor-Fusion für Gipfel aktiv")
        assert_eq(p_override.get("isAboveCeiling") is True, "Gipfel korrekt als ÜBER Inversionsdeckel eingestuft")
        assert_eq("Nebelmeer" in p_override.get("conditionText", ""), f"Gipfel meldet 'Sonnig über dem Nebelmeer': '{p_override.get('conditionText')}'")
        assert_eq("☀️🏔️" in p_override.get("icon", ""), f"Gipfel Icon ist Bergsonne: icon='{p_override.get('icon')}'")

        print("\n--- TEST 4: UI-Rendering in Tab 3 (Wetter & PV) ---")
        # Switch to Tab 3
        page.click('button[data-tab="weather"]')
        time.sleep(1)

        # Check if Solar-Adaptive Card exists
        adaptive_card = page.locator("#solarAdaptiveCard")
        assert_eq(adaptive_card.count() > 0, "solarAdaptiveCard im DOM vorhanden")

        # Open the Accordion
        page.click("#adaptiveAccordionToggle")
        time.sleep(0.5)

        is_expanded = page.evaluate("() => document.getElementById('solarAdaptiveCard').classList.contains('is-expanded')")
        assert_eq(is_expanded is True, "Allgäu Solar-Adaptive Card erfolgreich ausgeklappt")

        # Check Webcam Monitor elements
        wim_monitor = page.locator("#webcamInversionMonitor")
        assert_eq(wim_monitor.count() > 0, "webcamInversionMonitor im DOM vorhanden")

        status_pill = page.locator("#wimStatusPill").inner_text()
        assert_eq("Inversion" in status_pill, f"Status Pill zeigt Inversionsstatus: '{status_pill}'")

        ceiling_val = page.locator("#wimCeilingVal").inner_text()
        assert_eq("1.450" in ceiling_val, f"Deckelhöhe angezeigt: '{ceiling_val}'")

        # Verify the 3 elevation cards and canvases
        valley_card = page.locator("#webcamCardValley")
        assert_eq(valley_card.count() > 0, "Talstufe-Webcam-Karte vorhanden")
        ai_tag_valley = page.locator("#aiTagValley").inner_text()
        assert_eq("Hochnebel" in ai_tag_valley or "σ" in ai_tag_valley, f"Tal AI-Tag zeigt optischen Befund: '{ai_tag_valley}'")

        mid_card = page.locator("#webcamCardMid")
        assert_eq(mid_card.count() > 0, "Mittelstation-Webcam-Karte vorhanden")
        ai_tag_mid = page.locator("#aiTagMid").inner_text()
        assert_eq("Nebel" in ai_tag_mid or "σ" in ai_tag_mid, f"Mittel AI-Tag zeigt optischen Befund: '{ai_tag_mid}'")

        peak_card = page.locator("#webcamCardPeak")
        assert_eq(peak_card.count() > 0, "Gipfelstufe-Webcam-Karte vorhanden")
        ai_tag_peak = page.locator("#aiTagPeak").inner_text()
        assert_eq("Sonnig" in ai_tag_peak or "σ" in ai_tag_peak, f"Gipfel AI-Tag zeigt optischen Befund: '{ai_tag_peak}'")

        # Verify Canvases have pixel data drawn
        canvas_check = page.evaluate("""() => {
            const cValley = document.getElementById('canvasWebcamValley');
            const cPeak = document.getElementById('canvasWebcamPeak');
            if (!cValley || !cPeak) return false;
            const ctxV = cValley.getContext('2d');
            const ctxP = cPeak.getContext('2d');
            const pV = Array.from(ctxV.getImageData(0, 0, 1, 1).data);
            const pP = Array.from(ctxP.getImageData(0, 0, 1, 1).data);
            return pV[3] > 0 && pP[3] > 0;
        }""")
        assert_eq(canvas_check is True, "Offscreen-Canvas Pixel wurden erfolgreich in DOM-Canvases gerendert")

        # Verify Day 1 Forecast Card in Tab 3 shows Inversion override
        page.wait_for_function('() => document.querySelectorAll("#weatherPrimary4Container .day-forecast-card").length > 0')
        today_condition = page.evaluate("""() => {
            const firstCard = document.querySelector('#weatherPrimary4Container .day-forecast-card');
            if (!firstCard) return '';
            const cond = firstCard.querySelector('.day-condition-label');
            return cond ? cond.textContent : '';
        }""")
        print(f"Heute Zustand: '{today_condition}'")
        assert_eq("Hochnebel" in today_condition or "1.450" in today_condition or "Nebel" in today_condition,
                  f"Heute Tageskarte zeigt Inversions-Zustand: '{today_condition}'")

        # Take screenshot of the expanded webcam inversion monitor
        page.screenshot(path="/Users/jona/.gemini/antigravity/brain/87020218-9ff4-4f72-a4c9-3914438f697f/inversion_webcam_monitor_expanded.png")

        print(f"\n======================================================================")
        print(f"ERGEBNIS: {passed} PASSED, {failed} FAILED")
        print(f"======================================================================")

        browser.close()
        return failed == 0

if __name__ == "__main__":
    success = test_inversion_computer_vision_and_ui()
    sys.exit(0 if success else 1)
