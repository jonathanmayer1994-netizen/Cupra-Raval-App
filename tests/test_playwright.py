import sys
import os
import time
from playwright.sync_api import sync_playwright

def run_tests():
    print("=" * 60)
    print("PLAYWRIGHT COMPREHENSIVE TEST SUITE — CUPRA RAVAL APP")
    print("=" * 60)

    results = []

    def log_test(name, passed, detail=""):
        status = "PASSED" if passed else "FAILED"
        print(f"[{status}] {name}: {detail}")
        results.append({"name": name, "passed": passed, "detail": detail})

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 393, "height": 852},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        # 1. NAVIGATION & BRANDING
        print("\n--- 1. App Laden & Header Branding ---")
        page.goto("http://localhost:8080/", wait_until="networkidle")
        time.sleep(1)

        app_title = page.locator("#appHeaderTitle").inner_text()
        expected_title = "Cupra Raval Endurance Edition Dynamic"
        log_test(
            "Header App-Titel",
            app_title == expected_title,
            f"Erhalten: '{app_title}'"
        )

        header_sub = page.locator("#headerSubtitle").inner_text()
        log_test(
            "Header Subtitel",
            "Ladeerfassung" in header_sub or "PV" in header_sub,
            f"Erhalten: '{header_sub}'"
        )

        # 2. KPI DETAIL MODAL TEST
        print("\n--- 2. KPI Detail Modal & Chart Rendering ---")
        page.locator("#dashYearCost").click()
        time.sleep(0.5)

        modal_open = page.locator("#modalKpiDetail").evaluate("el => el.classList.contains('open')")
        log_test("Modal KPI Detail öffnet sich", modal_open, "Klasse .open vorhanden")

        canvas_dims = page.locator("#canvasKpiDetailChart").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test(
            "KPI Chart Canvas Dimensionen",
            canvas_dims["width"] > 250 and canvas_dims["height"] >= 200,
            f"Breite: {canvas_dims['width']:.1f}px, Höhe: {canvas_dims['height']:.1f}px"
        )

        # Switch to "Alle Einträge"
        page.locator('.kpi-detail-seg-picker button[data-subrange="timeline"]').click()
        time.sleep(0.5)

        canvas_dims_timeline = page.locator("#canvasKpiDetailChart").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test(
            "KPI Chart nach Umschalten auf 'Alle Einträge'",
            canvas_dims_timeline["width"] > 250 and canvas_dims_timeline["height"] >= 200,
            f"Breite: {canvas_dims_timeline['width']:.1f}px, Höhe: {canvas_dims_timeline['height']:.1f}px"
        )

        page.locator("#btnCloseKpiDetailModal").click()
        time.sleep(0.3)
        modal_closed = page.locator("#modalKpiDetail").evaluate("el => !el.classList.contains('open')")
        log_test("Modal KPI Detail schließt sich", modal_closed, "Klasse .open entfernt")

        # 3. WETTER & 24H HOURLY CHART MIT SONNENKURVE & AUFGANG/UNTERGANG
        print("\n--- 3. Wetter & 24h-Kurve mit Sonnenauf- & -untergang ---")
        page.locator('.dock-tab-btn[data-tab="weather"]').click()
        time.sleep(0.6)

        page.locator(".day-forecast-card").first.click()
        time.sleep(0.6)

        hourly_modal_open = page.locator("#modalHourlyWeather").evaluate("el => el.classList.contains('open')")
        log_test("Stündliches Wetter-Modal öffnet sich", hourly_modal_open, "Klasse .open vorhanden")

        sunrise_txt = page.locator("#hourlySunrise").inner_text()
        sunset_txt = page.locator("#hourlySunset").inner_text()
        log_test("Sonnenaufgang-Anzeige", ":" in sunrise_txt and len(sunrise_txt) == 5, f"Uhrzeit: {sunrise_txt}")
        log_test("Sonnenuntergang-Anzeige", ":" in sunset_txt and len(sunset_txt) == 5, f"Uhrzeit: {sunset_txt}")

        hourly_canvas_dims = page.locator("#canvasHourlyChart").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test(
            "24h Chart Canvas Dimensionen",
            hourly_canvas_dims["width"] > 250 and hourly_canvas_dims["height"] >= 180,
            f"Breite: {hourly_canvas_dims['width']:.1f}px, Höhe: {hourly_canvas_dims['height']:.1f}px"
        )

        chart_type_check = page.evaluate("""() => {
            const canvas = document.getElementById('canvasHourlyChart');
            const chartInstance = Chart.getChart(canvas);
            if (!chartInstance) return { found: false };
            const ds0 = chartInstance.data.datasets[0];
            return {
                found: true,
                ds0_type: ds0.type,
                ds0_tension: ds0.tension
            };
        }""")
        log_test(
            "Sonnenverlauf ist als weiche Kurve (Line-Chart) konfiguriert",
            chart_type_check.get("ds0_type") == "line" and chart_type_check.get("ds0_tension") > 0,
            f"Dataset 0 Typ: {chart_type_check.get('ds0_type')}, Tension: {chart_type_check.get('ds0_tension')}"
        )

        page.locator("#btnCloseHourlyModal").click()
        time.sleep(0.3)

        # 4. TAB 2: AUSWERTUNGEN & CHARTS
        print("\n--- 4. Tab 2: Laden & Auswertungs-Charts ---")
        page.locator('.dock-tab-btn[data-tab="charging"]').click()
        time.sleep(0.4)
        page.locator('.picker-seg[data-sub="analytics"]').click()
        time.sleep(0.6)

        charging_chart_dims = page.locator("#canvasChargingChart").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test(
            "Haupt-Ladeverlauf Chart (Balken & Linie)",
            charging_chart_dims["width"] > 250 and charging_chart_dims["height"] >= 180,
            f"Breite: {charging_chart_dims['width']:.1f}px, Höhe: {charging_chart_dims['height']:.1f}px"
        )

        loc_donut_dims = page.locator("#canvasLocationDonut").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        src_donut_dims = page.locator("#canvasSourceDonut").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test(
            "Standort & Energiequelle Donut Charts",
            loc_donut_dims["width"] > 50 and src_donut_dims["width"] > 50,
            f"Standort-Donut: {loc_donut_dims['width']:.1f}px, Strom-Donut: {src_donut_dims['width']:.1f}px"
        )

        log_test("Keine unerwarteten JavaScript-Fehler", len(errors) == 0, f"Fehler: {errors}")
        browser.close()

    print("\n" + "=" * 60)
    passed_count = sum(1 for r in results if r["passed"])
    total_count = len(results)
    print(f"TEST RESULT SUMMARY: {passed_count}/{total_count} TESTS PASSED")
    print("=" * 60)
    return passed_count == total_count

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
