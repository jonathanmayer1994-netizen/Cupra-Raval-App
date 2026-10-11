import sys
import os
import time
from playwright.sync_api import sync_playwright

def run_tests():
    print("=" * 70)
    print("PLAYWRIGHT COMPREHENSIVE E2E TEST SUITE — CUPRA RAVAL DYNAMIC")
    print("=" * 70)

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

        # =====================================================================
        # SUITE 1: INITIAL PAGE LOAD & BRANDING
        # =====================================================================
        print("\n--- SUITE 1: Initial Page Load & Header Branding ---")
        page.goto("http://localhost:8080/", wait_until="networkidle")
        time.sleep(1)

        app_title = page.locator("#appHeaderTitle").inner_text()
        expected_title = "Cupra Raval Endurance Edition Dynamic"
        log_test(
            "1.1 Header App-Titel",
            app_title == expected_title,
            f"Erhalten: '{app_title}'"
        )

        header_sub_count = page.locator("#headerSubtitle").count()
        badge_box = page.locator(".brand-badge-bronze").bounding_box()
        title_box = page.locator("#appHeaderTitle").bounding_box()
        badge_mid_y = badge_box["y"] + (badge_box["height"] / 2.0)
        title_mid_y = title_box["y"] + (title_box["height"] / 2.0)
        diff_y = abs(badge_mid_y - title_mid_y)
        is_vertically_centered = diff_y <= 3.0
        log_test(
            "1.2 Header Subtitel entfernt & Titel mittig zum Bild",
            header_sub_count == 0 and is_vertically_centered,
            f"Subtitel count: {header_sub_count}, Delta Y-Zentrum: {diff_y:.2f}px"
        )

        app_icon_visible = page.locator(".brand-badge-app-icon").is_visible()
        log_test("1.3 App Icon im Header", app_icon_visible, "Sichtbar in der Bronze-Badge")

        dock_tabs_count = page.locator(".dock-tab-btn").count()
        log_test("1.4 Bottom Dock Tabs", dock_tabs_count == 4, f"4 Tabs vorhanden (gefunden: {dock_tabs_count})")

        fab_visible = page.locator("#fabAddCharge").is_visible()
        log_test("1.5 Zentraler (+) FAB Button", fab_visible, "Sichtbar und zentriert im Dock")

        # =====================================================================
        # SUITE 2: DASHBOARD KPIS & HERO BÜHNE
        # =====================================================================
        print("\n--- SUITE 2: Dashboard KPIs & Hero Fahrzeugbühne ---")
        month_cost = page.locator("#dashMonthCost").inner_text()
        year_cost = page.locator("#dashYearCost").inner_text()
        month_dist = page.locator("#dashMonthDistance").inner_text()
        year_dist = page.locator("#dashYearDistance").inner_text()
        avg_price = page.locator("#dashAvgPrice").inner_text()
        avg_cons = page.locator("#dashAvgCons").inner_text()

        log_test("2.1 Kosten KPIs (Monat & Jahr)", len(month_cost) > 0 and len(year_cost) > 0, f"Monat: {month_cost} €, Jahr: {year_cost} €")
        log_test("2.2 Fahrleistung KPIs (Monat & Jahr)", len(month_dist) > 0 and len(year_dist) > 0, f"Monat: {month_dist} km, Jahr: {year_dist} km")
        log_test("2.3 Effizienz KPIs (Preis & Verbrauch)", len(avg_price) > 0 and len(avg_cons) > 0, f"Preis: {avg_price} €/kWh, Verbrauch: {avg_cons}")

        hero_car_visible = page.locator("#dashboardCarImage").is_visible()
        model_name = page.locator("#cardCarModelName").inner_text()
        log_test("2.4 Hero Fahrzeugbild", hero_car_visible, "Bild geladen")
        log_test("2.5 Modellbezeichnung in Car Capsule", model_name == expected_title, f"Erhalten: '{model_name}'")

        bat_kwh = page.locator("#cardBatteryKwh").inner_text()
        power_ps = page.locator("#cardPowerPs").inner_text()
        odo_km = page.locator("#cardCurrentOdo").inner_text()
        log_test("2.6 Spezifikationen-Kapsel (Batterie, PS, km)", "52" in bat_kwh and "211" in power_ps and "km" in odo_km, f"Batterie: {bat_kwh}, Leistung: {power_ps}, km: {odo_km}")

        # Test Wetter-Widget Klick -> Navigiert zu Wetter-Tab
        page.locator("#dashPvPreviewCard").click()
        time.sleep(0.4)
        weather_tab_active = page.locator("#tab-weather").evaluate("el => el.classList.contains('active')")
        log_test("2.7 Dashboard Wetter-Widget Klick öffnet Wetter-Tab", weather_tab_active, "Tab 3 erfolgreich aktiv")

        # Zurück zu Dashboard
        page.locator('.dock-tab-btn[data-tab="dashboard"]').click()
        time.sleep(0.3)

        # =====================================================================
        # SUITE 3: KPI DETAIL MODALS (ALLE 4 TYPEN & BEIDE SEGMENTE)
        # =====================================================================
        print("\n--- SUITE 3: Alle 4 KPI Detail Modals & Resizing ---")
        kpi_triggers = [
            ("#dashYearCost", "Ladekosten Gesamtjahr", "year-cost"),
            ("#dashYearDistance", "Fahrleistung Gesamtjahr", "year-distance"),
            ("#dashAvgPrice", "Durchschnittlicher Strompreis", "avg-price"),
            ("#dashAvgCons", "Durchschnittlicher Verbrauch", "avg-consumption")
        ]

        for selector, title_label, kpi_type in kpi_triggers:
            page.locator(selector).click()
            time.sleep(0.4)

            modal_open = page.locator("#modalKpiDetail").evaluate("el => el.classList.contains('open')")
            dims = page.locator("#canvasKpiDetailChart").evaluate("""el => {
                const r = el.getBoundingClientRect();
                return { width: r.width, height: r.height };
            }""")
            log_test(
                f"3.{kpi_type} Modal & Chart ({title_label})",
                modal_open and dims["width"] > 250 and dims["height"] >= 200,
                f"Breite: {dims['width']:.1f}px, Höhe: {dims['height']:.1f}px"
            )

            # Test Segment Umschaltung
            page.locator('.kpi-detail-seg-picker button[data-subrange="timeline"]').click()
            time.sleep(0.3)
            dims_timeline = page.locator("#canvasKpiDetailChart").evaluate("""el => {
                const r = el.getBoundingClientRect();
                return { width: r.width, height: r.height };
            }""")
            log_test(
                f"3.{kpi_type} Umschaltung auf 'Alle Einträge'",
                dims_timeline["width"] > 250 and dims_timeline["height"] >= 200,
                f"Breite: {dims_timeline['width']:.1f}px, Höhe: {dims_timeline['height']:.1f}px"
            )

            # Close Modal
            page.locator("#btnCloseKpiDetailModal").click()
            time.sleep(0.2)

        # =====================================================================
        # SUITE 4: LADEVORGANG ERFASSEN FLOW (ZENTRALER FAB BUTTON)
        # =====================================================================
        print("\n--- SUITE 4: Ladevorgang erfassen Flow (FAB Modal) ---")
        try:
            prev_raw = page.locator("#dashMonthKwh").inner_text()
            prev_kwh = float(prev_raw.replace("kWh", "").replace("geladen", "").replace(",", ".").strip())
        except Exception:
            prev_kwh = 0.0

        page.locator("#fabAddCharge").click()
        time.sleep(0.4)
        add_modal_open = page.locator("#modalAddCharge").evaluate("el => el.classList.contains('open')")
        log_test("4.1 Modal Ladevorgang erfassen öffnet sich", add_modal_open, "Klasse .open vorhanden")

        # Open Location Picker Action Sheet
        page.locator("#btnOpenLocationPicker").click()
        time.sleep(0.3)
        picker_sheet_open = page.locator("#modalLocationPickerSheet").evaluate("el => el.classList.contains('open')")
        log_test("4.2 Standort-Auswahl Action Sheet öffnet sich", picker_sheet_open, "Standortliste sichtbar")

        # Select location (first .touch-picker-item)
        page.locator(".touch-picker-item").first.click()
        time.sleep(0.3)
        picker_sheet_closed = page.locator("#modalLocationPickerSheet").evaluate("el => !el.classList.contains('open')")
        log_test("4.3 Standort gewählt & Sheet schließt sich", picker_sheet_closed, "Erster Standort gewählt")

        # Fill inputs
        page.locator("#entryKwh").fill("42.5")
        page.locator("#entryOdometer").fill("12680")
        page.locator("#entryNotes").fill("Playwright E2E Testladung")
        time.sleep(0.2)

        # Submit charge entry form
        page.locator("#btnSaveEntry").click()
        time.sleep(0.6)

        add_modal_closed = page.locator("#modalAddCharge").evaluate("el => !el.classList.contains('open')")
        log_test("4.4 Ladevorgang gespeichert & Modal geschlossen", add_modal_closed, "Eintrag erfolgreich committet")

        # Verify Dashboard KPI updated
        updated_month_kwh = page.locator("#dashMonthKwh").inner_text()
        try:
            new_kwh = float(updated_month_kwh.replace("kWh", "").replace("geladen", "").replace(",", ".").strip())
        except Exception:
            new_kwh = 0.0
        log_test("4.5 Dashboard KPI mit neuer Ladung synchronisiert", new_kwh >= prev_kwh + 42.0, f"Monats-kWh: {updated_month_kwh}")

        # =====================================================================
        # SUITE 5: TAB 2: LADEN & HISTORIE + FILTER RAIL
        # =====================================================================
        print("\n--- SUITE 5: Tab 2: Ladehistorie & Standortfilter ---")
        page.locator('.dock-tab-btn[data-tab="charging"]').click()
        time.sleep(0.4)
        page.locator('.picker-seg[data-sub="history"]').click()
        time.sleep(0.3)

        stream_cards_count = page.locator(".session-swift-card").count()
        log_test("5.1 Ladehistorie Stream Items gerendert", stream_cards_count > 0, f"{stream_cards_count} Ladekarten in der Historie")

        # Test Filter Chips
        page.locator('.chip-filter[data-filter="pv"]').click()
        time.sleep(0.3)
        pv_filtered = page.locator('.chip-filter[data-filter="pv"]').evaluate("el => el.classList.contains('active')")
        log_test("5.2 Filterchip 'Nur PV' aktivierbar", pv_filtered, "Aktive Filterklasse gesetzt")

        page.locator('.chip-filter[data-filter="all"]').click()
        time.sleep(0.3)
        all_filtered = page.locator('.chip-filter[data-filter="all"]').evaluate("el => el.classList.contains('active')")
        log_test("5.3 Filterchip 'Alle' wiederhergestellt", all_filtered, "Alle Ladevorgänge wieder sichtbar")

        # =====================================================================
        # SUITE 6: TAB 2: AUSWERTUNGEN & CHARTS (BALKEN, LINIE, DONUTS)
        # =====================================================================
        print("\n--- SUITE 6: Tab 2: Auswertungs-Charts & Perioden-Umschaltung ---")
        page.locator('.picker-seg[data-sub="analytics"]').click()
        time.sleep(0.5)

        charging_dims = page.locator("#canvasChargingChart").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test("6.1 Haupt-Ladeverlauf Chart Dimensionen", charging_dims["width"] > 250 and charging_dims["height"] >= 180, f"{charging_dims['width']:.1f}px x {charging_dims['height']:.1f}px")

        # Test Period Pills
        page.locator('.period-pill[data-period="year"]').click()
        time.sleep(0.3)
        year_pill_act = page.locator('.period-pill[data-period="year"]').evaluate("el => el.classList.contains('active')")
        log_test("6.2 Perioden-Filter 'Monate im Jahr' umschaltbar", year_pill_act, "Aktive Klasse gesetzt")

        page.locator('.period-pill[data-period="month"]').click()
        time.sleep(0.3)

        loc_dims = page.locator("#canvasLocationDonut").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        src_dims = page.locator("#canvasSourceDonut").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test("6.3 Standort & Energiequellen Donut Charts", loc_dims["width"] > 50 and src_dims["width"] > 50, f"Standort: {loc_dims['width']:.1f}px, Quelle: {src_dims['width']:.1f}px")

        loc_legend_items = page.locator("#locationDonutLegend .donut-legend-item").count()
        src_legend_items = page.locator("#sourceDonutLegend .donut-legend-item").count()
        log_test("6.4 Donut Legenden mit Live-Prozenten", loc_legend_items > 0 and src_legend_items > 0, f"Standort-Legende: {loc_legend_items} Items, Quellen: {src_legend_items} Items")

        # =====================================================================
        # SUITE 7: TAB 3: WETTER & 24H KURVE MIT SONNENAUF-/-UNTERGANG
        # =====================================================================
        print("\n--- SUITE 7: Tab 3: Wetter, 14-Tage-Vorschau & 24h-Sonnenkurve ---")
        page.locator('.dock-tab-btn[data-tab="weather"]').click()
        time.sleep(0.5)

        weather_loc_text = page.locator("#weatherDisplayLocation").inner_text()
        log_test("7.1 Wetterstandort-Anzeige", "Bayrhofs" in weather_loc_text or "Kempten" in weather_loc_text or "GPS" in weather_loc_text, f"Text: '{weather_loc_text}'")

        day_cards_count = page.locator(".day-forecast-card").count()
        log_test("7.2 14-Tage Wetterprognose-Karten gerendert", day_cards_count >= 10, f"{day_cards_count} Tage in der Vorhersage")

        # Open 24h Hourly Forecast Modal
        page.locator(".day-forecast-card").first.click()
        time.sleep(0.5)
        hourly_open = page.locator("#modalHourlyWeather").evaluate("el => el.classList.contains('open')")
        log_test("7.3 24-Stunden Modal öffnet sich", hourly_open, "Klasse .open vorhanden")

        sunrise_v = page.locator("#hourlySunrise").inner_text()
        sunset_v = page.locator("#hourlySunset").inner_text()
        log_test("7.4 Sonnenaufgang & Sonnenuntergang im Header", ":" in sunrise_v and ":" in sunset_v, f"Aufgang: {sunrise_v}, Untergang: {sunset_v}")

        hourly_dims = page.locator("#canvasHourlyChart").evaluate("""el => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
        }""")
        log_test("7.5 24h-Kurve Canvas Dimensionen", hourly_dims["width"] > 250 and hourly_dims["height"] >= 180, f"{hourly_dims['width']:.1f}px x {hourly_dims['height']:.1f}px")

        curve_cfg = page.evaluate("""() => {
            const chartInstance = Chart.getChart(document.getElementById('canvasHourlyChart'));
            if (!chartInstance) return null;
            const ds = chartInstance.data.datasets[0];
            return { type: ds.type, tension: ds.tension, fill: ds.fill };
        }""")
        log_test("7.6 Sonnenstunden als weiche Spline-Kurve konfiguriert", curve_cfg and curve_cfg["type"] == "line" and curve_cfg["tension"] > 0.3, f"Typ: {curve_cfg['type']}, Tension: {curve_cfg['tension']}, Fill: {curve_cfg['fill']}")

        sun_event_badges = page.locator(".hourly-hour-card.sun-event-hour").count()
        log_test("7.7 Stündliche Kapseln markieren Sonnenaufgang & -untergang", sun_event_badges >= 2, f"{sun_event_badges} Kapseln hervorgehoben")

        page.locator("#btnCloseHourlyModal").click()
        time.sleep(0.3)

        # =====================================================================
        # SUITE 8: TAB 4: EINSTELLUNGEN & STANDORT-EDITOR (APPLE EDIT MODE)
        # =====================================================================
        print("\n--- SUITE 8: Tab 4: Einstellungen, Fahrzeugdaten & Apple Edit Mode ---")
        page.locator('.dock-tab-btn[data-tab="settings"]').click()
        time.sleep(0.4)

        # Sub-Tab 1: Fahrzeug Spezifikationen
        model_input_val = page.locator("#cfgModelName").input_value()
        odo_input_val = page.locator("#cfgCurrentOdo").input_value()
        log_test("8.1 Fahrzeug-Einstellungsformular geladen", model_input_val == expected_title, f"Modellname: '{model_input_val}'")
        log_test("8.1b Kilometerstand im Formular editierbar", page.locator("#cfgCurrentOdo").is_visible(), f"Odo-Input Wert: '{odo_input_val}'")

        # Test Kilometerstand editieren und speichern
        page.locator("#cfgCurrentOdo").fill("150")
        page.locator("#btnSaveVehicleSettings").click()
        time.sleep(0.3)
        card_odo_val = page.locator("#cardCurrentOdo").inner_text()
        log_test("8.1c Kilometerstand gespeichert und auf Dashboard aktualisiert", "150" in card_odo_val, f"Card km: '{card_odo_val}'")
        # Zurücksetzen auf 0
        page.locator("#cfgCurrentOdo").fill("0")
        page.locator("#btnSaveVehicleSettings").click()
        time.sleep(0.3)

        # Sub-Tab 2: Standorte & Apple Edit Mode
        page.locator('.picker-seg[data-settab="locations"]').click()
        time.sleep(0.3)

        edit_mode_btn = page.locator("#btnToggleLocationEditMode")
        edit_mode_btn.click()
        time.sleep(0.3)
        edit_mode_active = edit_mode_btn.evaluate("el => el.classList.contains('active-done')")
        log_test("8.2 Apple Edit Mode (Minimaler Stift) umschaltbar", edit_mode_active, "Bearbeitungsmodus aktiv (active-done)")

        # Turn edit mode off
        edit_mode_btn.click()
        time.sleep(0.2)

        # Open Neuer Standort Modal
        page.locator("#btnOpenNewLocationModal").click()
        time.sleep(0.3)
        loc_modal_open = page.locator("#modalEditLocation").evaluate("el => el.classList.contains('open')")
        log_test("8.3 Neuer Standort Modal öffnet sich", loc_modal_open, "Modal geöffnet")

        page.locator("#locEditName").fill("Tesla Supercharger Kempten")
        page.locator("#locEditPrice").fill("0.49")
        page.locator("#btnSaveLocationEdit").click()
        time.sleep(0.5)

        loc_modal_closed = page.locator("#modalEditLocation").evaluate("el => !el.classList.contains('open')")
        log_test("8.4 Neuer Standort gespeichert & Modal geschlossen", loc_modal_closed, "Standort hinzugefügt")

        # Sub-Tab 3: Backup & Datensicherheit
        page.locator('.picker-seg[data-settab="backup"]').click()
        time.sleep(0.3)
        export_btn_visible = page.locator("#btnExportJson").is_visible()
        demo_btn_visible = page.locator("#btnLoadSampleData").is_visible()
        log_test("8.5 Datensicherungs- und Demo-Aktionen vorhanden", export_btn_visible and demo_btn_visible, "Export- & Demodaten-Buttons bereit")

        # =====================================================================
        # SUITE 9: CONSOLE ERROR & EXCEPTION AUDIT
        # =====================================================================
        print("\n--- SUITE 9: Fehler- und Exception-Audit ---")
        log_test("9.1 Keine unhandled Exceptions oder Console Errors", len(errors) == 0, f"Fehlerliste: {errors}")

        browser.close()

    print("\n" + "=" * 70)
    passed_count = sum(1 for r in results if r["passed"])
    total_count = len(results)
    percentage = (passed_count / total_count) * 100
    print(f"GESAMTERGEBNIS: {passed_count}/{total_count} TESTS BESTANDEN ({percentage:.1f}%)")
    print("=" * 70)
    return passed_count == total_count

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
