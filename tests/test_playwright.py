import sys
import os
import time
import json
import urllib.request
import urllib.parse
from playwright.sync_api import sync_playwright

GOOGLE_SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbwlKhi7dukN5p3UDlM-6sxg72zVH9is2jKN1Wh8H0WCSeCAGmm7tjH0DxhIclf0k5Qv/exec"

def cleanup_google_sheet(target_id=None, keyword="Playwright", api_url=GOOGLE_SHEETS_API_URL):
    deleted = []
    # 1. Direkter Aufruf mit target_id falls vorhanden
    if target_id:
        try:
            del_url = f"{api_url}?action=delete&id={urllib.parse.quote(str(target_id))}"
            req = urllib.request.Request(del_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp.read()
            deleted.append(target_id)
        except Exception as e:
            print(f"[CLEANUP] Direkter Delete-Aufruf per ID: {e}")

    # 2. Prüfen aller Zeilen im Google Sheet auf etwaige verbliebene Test-Einträge
    try:
        req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read().decode('utf-8')
            rows = json.loads(data) if data else []
            for row in rows:
                r_id = str(row.get('id') or row.get('ID') or '')
                r_notes = str(row.get('notes') or row.get('Notiz') or row.get('notiz') or '')
                if keyword in r_notes or (target_id and r_id == str(target_id)):
                    del_url = f"{api_url}?action=delete&id={urllib.parse.quote(r_id)}"
                    del_req = urllib.request.Request(del_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(del_req, timeout=20) as dr:
                        dr.read()
                    if r_id not in deleted:
                        deleted.append(r_id)
    except Exception as e:
        print(f"[CLEANUP] Sheet-Bereinigung Ausnahme: {e}")

    return deleted

def run_tests():
    print("=" * 70)
    print("PLAYWRIGHT COMPREHENSIVE E2E TEST SUITE — CUPRA RAVAL DYNAMIC")
    print("=" * 70)

    # Vor Beginn: Etwaige alte Testartefakte aus Google Sheet bereinigen
    cleanup_google_sheet(keyword="Playwright")

    results = []

    def log_test(name, passed, detail=""):
        status = "PASSED" if passed else "FAILED"
        print(f"[{status}] {name}: {detail}")
        results.append({"name": name, "passed": passed, "detail": detail})

    created_session_id = None

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
        page.on("dialog", lambda dialog: dialog.accept())

        try:
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

            # 4.3b: Verifiziere, dass nach Standortwahl Button-Untertitel und Preis exakt synchron sind mit dem Settings-Preis
            selected_sub = page.locator("#pickerSelectedSub").inner_text()
            entry_price_val = page.locator("#entryPrice").input_value()
            price_sync = (entry_price_val in selected_sub.replace(',', '.'))
            log_test("4.3b Ladeort Preis-Synchronisation: Button & Eingabefeld identisch", price_sync, f"Sub: '{selected_sub}', Input: '{entry_price_val}'")

            # Fill inputs
            page.locator("#entryKwh").fill("42.5")
            page.locator("#entryOdometer").fill("12680")
            page.locator("#entryNotes").fill("Playwright E2E Testladung")
            if page.locator("#entryBatterySoc").is_visible():
                page.locator("#entryBatterySoc").fill("82")
            time.sleep(0.2)

            # Submit charge entry form
            page.locator("#btnSaveEntry").click()
            time.sleep(0.6)

            add_modal_closed = page.locator("#modalAddCharge").evaluate("el => !el.classList.contains('open')")
            log_test("4.4 Ladevorgang gespeichert & Modal geschlossen", add_modal_closed, "Eintrag erfolgreich committet")

            # Session-ID des neuen Testeintrags sichern
            created_session_id = page.evaluate("""() => {
                try {
                    const raw = localStorage.getItem('cupra_raval_data');
                    if (!raw) return null;
                    const d = JSON.parse(raw);
                    const s = (d.sessions || []).find(x => (x.notes || '').includes('Playwright'));
                    return s ? s.id : null;
                } catch(e) { return null; }
            }""")

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

            # Test Filter Chips (Nur Ladeorte & Alle, kein 'Nur PV')
            pv_chip_count = page.locator('.chip-filter[data-filter="pv"]').count()
            log_test("5.2 Filterchip 'Nur PV' entfernt", pv_chip_count == 0, f"PV-Chip Count: {pv_chip_count}")

            bayrhofs_chip = page.locator('.chip-filter[data-filter="Bayrhofs"]')
            bayrhofs_chip_exists = bayrhofs_chip.count() > 0
            if bayrhofs_chip_exists:
                bayrhofs_chip.click()
                time.sleep(0.3)
                loc_filtered = bayrhofs_chip.evaluate("el => el.classList.contains('active')")
                log_test("5.2b Ladeort-Filter aktivierbar (Bayrhofs)", loc_filtered, "Aktive Filterklasse auf Ladeort gesetzt")

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

            # 7.1b: WeatherService API & 5 Open-Source Services vorhanden
            ws_check = page.evaluate("""() => {
                if (typeof window.WeatherService === 'undefined') return { ok: false, reason: 'WeatherService undefined' };
                const s = window.WeatherService;
                const hasMethods = typeof s.fetchConsensus === 'function' &&
                                   typeof s.fetchOpenMeteo === 'function' &&
                                   typeof s.fetchBrightSky === 'function' &&
                                   typeof s.fetchDwdAlerts === 'function' &&
                                   typeof s.fetchGeoSphereAustria === 'function' &&
                                   typeof s.fetchMetNorway === 'function';
                return {
                    ok: hasMethods,
                    ttl: s.CACHE_TTL_MS,
                    cacheKey: s.CACHE_KEY
                };
            }""")
            log_test("7.1b WeatherService Modul mit 5 Open-Source Diensten verfügbar", ws_check.get("ok") is True, f"Methoden vorhanden, TTL: {ws_check.get('ttl')}ms")

            # 7.1c: 5-Minuten Caching in localStorage
            cache_check = page.evaluate("""() => {
                const s = window.WeatherService;
                const ttl = s?.CACHE_TTL_MS;
                const cacheKey = s?.CACHE_KEY || 'cupra_raval_weather_service_cache_v6';
                const raw = localStorage.getItem(cacheKey);
                const parsed = raw ? JSON.parse(raw) : null;
                return {
                    ttlMatches5Min: ttl === 300000,
                    hasCachedData: !!(parsed && parsed.data && parsed.data.forecast14Days)
                };
            }""")
            log_test("7.1c 5-Minuten Cache im localStorage aktiv", cache_check.get("ttlMatches5Min") is True and cache_check.get("hasCachedData") is True, f"TTL: 5 Min (300.000 ms), Cached: {cache_check.get('hasCachedData')}")

            # 7.1d: Intelligente Lade-Empfehlung Card gerendert mit Cupra Raval NMC-Modell
            smart_card_visible = page.locator("#smartChargeCard").is_visible()
            smart_reco_title = page.locator(".smart-reco-main-title").inner_text()
            smart_time_val = page.locator("#smartRecoTimeVal").inner_text()
            log_test("7.1d Intelligente Lade-Empfehlung Card gerendert mit Cupra Raval NMC-Modell", smart_card_visible and len(smart_reco_title) > 0 and len(smart_time_val) > 0, f"Card sichtbar: {smart_card_visible}, Titel: '{smart_reco_title}', Slot: '{smart_time_val}'")

            # 7.1d2: 3-Tage Vorschau bei der intelligenten Lade-Empfehlung aktiv & interaktiv
            day_cards_count = page.locator("#smartReco3DayGrid .reco-3day-card").count()
            has_day0 = page.locator('.reco-3day-card[data-day-index="0"]').is_visible()
            has_day1 = page.locator('.reco-3day-card[data-day-index="1"]').is_visible()
            has_day2 = page.locator('.reco-3day-card[data-day-index="2"]').is_visible()
            
            # Klick auf Tag 2 und Prüfung der Slot-Aktualisierung
            page.locator('.reco-3day-card[data-day-index="2"]').click()
            time.sleep(0.3)
            time_val_d2 = page.locator("#smartRecoTimeVal").inner_text()
            card2_active = page.locator('.reco-3day-card[data-day-index="2"]').evaluate("el => el.classList.contains('active')")
            
            # Klick zurück auf Heute
            page.locator('.reco-3day-card[data-day-index="0"]').click()
            time.sleep(0.3)
            time_val_d0 = page.locator("#smartRecoTimeVal").inner_text()
            card0_active = page.locator('.reco-3day-card[data-day-index="0"]').evaluate("el => el.classList.contains('active')")
            
            log_test("7.1d2 3-Tage Vorschau bei intelligenter Empfehlung (Kompakt & Interaktiv)", 
                     day_cards_count == 3 and has_day0 and has_day1 and has_day2 and card2_active and card0_active,
                     f"Karten: {day_cards_count}, Tag 2: '{time_val_d2}', Heute: '{time_val_d0}'")

            # 7.1e: 4 NMC Telemetrie-Metriken aktiv (Akku, NMC-Effizienz, Fahrprofil, PV-Fenster)
            metric_bat = page.locator("#smartMetricBattery").inner_text()
            metric_nmc = page.locator("#smartMetricNmc").inner_text()
            metric_drv = page.locator("#smartMetricDriving").inner_text()
            metric_sol = page.locator("#smartMetricSolar").inner_text()
            has_metrics = "%" in metric_bat and "@" in metric_nmc and "kWh" in metric_drv and len(metric_sol) > 0
            log_test("7.1e 4 NMC Telemetrie-Metriken aktiv (Akku, NMC-Effizienz, Fahrprofil, PV-Fenster)", has_metrics, f"Akku: {metric_bat}, NMC: {metric_nmc}, Fahrprofil: {metric_drv}, Solar: {metric_sol}")

            # 7.1f: Standort-Filterleiste mit GPS als Default vorhanden
            loc_chips_count = page.locator("#weatherLocationFilterRail .weather-loc-chip").count()
            gps_chip_active = page.locator('.weather-loc-chip[data-loc-id="gps"]').evaluate("el => el.classList.contains('active')")
            log_test("7.1f Standort-Filterleiste mit GPS als Default vorhanden", loc_chips_count >= 4 and gps_chip_active, f"Chips: {loc_chips_count}, GPS aktiv: {gps_chip_active}")

            # 7.1g: Standort-Filterung: Bayrhofs aktivierbar (Unterwang 18 Kempten)
            page.locator('.weather-loc-chip[data-loc-id="loc_bayrhofs"]').click()
            time.sleep(0.5)
            bayrhofs_text = page.locator("#weatherDisplayLocation").inner_text()
            bayrhofs_active = page.locator('.weather-loc-chip[data-loc-id="loc_bayrhofs"]').evaluate("el => el.classList.contains('active')")
            log_test("7.1g Standort-Filterung: Bayrhofs aktivierbar (Unterwang 18 Kempten)", "Bayrhofs" in bayrhofs_text and "Unterwang" in bayrhofs_text and bayrhofs_active, f"Text: '{bayrhofs_text}'")

            # 7.1h: Standort-Filterung: Zuhause aktivierbar (Rubihornweg 1 Durach)
            page.locator('.weather-loc-chip[data-loc-id="loc_zuhause"]').click()
            time.sleep(0.5)
            zuhause_text = page.locator("#weatherDisplayLocation").inner_text()
            zuhause_active = page.locator('.weather-loc-chip[data-loc-id="loc_zuhause"]').evaluate("el => el.classList.contains('active')")
            log_test("7.1h Standort-Filterung: Zuhause aktivierbar (Rubihornweg 1 Durach)", "Zuhause" in zuhause_text and "Durach" in zuhause_text and zuhause_active, f"Text: '{zuhause_text}'")

            # 7.1i: Standort-Filterung: Arbeit aktivierbar (Thomas-Dachser-Straße 2 Kempten)
            page.locator('.weather-loc-chip[data-loc-id="loc_arbeit"]').click()
            time.sleep(0.5)
            arbeit_text = page.locator("#weatherDisplayLocation").inner_text()
            arbeit_active = page.locator('.weather-loc-chip[data-loc-id="loc_arbeit"]').evaluate("el => el.classList.contains('active')")
            log_test("7.1i Standort-Filterung: Arbeit aktivierbar (Thomas-Dachser-Straße 2 Kempten)", "Arbeit" in arbeit_text and ("Thomas-Dachser" in arbeit_text or "Kempten" in arbeit_text) and arbeit_active, f"Text: '{arbeit_text}'")

            # 7.1j: Standort-Filterung: Öffentlich aktivierbar mit variablem Suchfeld
            page.locator('.weather-loc-chip[data-loc-id="loc_oeffentlich"]').click()
            time.sleep(0.5)
            oeffentlich_text = page.locator("#weatherDisplayLocation").inner_text()
            var_box_visible = page.locator("#weatherVariableBox").is_visible()
            log_test("7.1j Standort-Filterung: Öffentlich aktivierbar mit variablem Suchfeld", "Öffentlich" in oeffentlich_text and var_box_visible, f"Text: '{oeffentlich_text}', Suchbox: {var_box_visible}")

            # 7.1k: Zurück zu GPS umschalten
            page.locator('.weather-loc-chip[data-loc-id="gps"]').click()
            time.sleep(0.5)
            gps_restored_text = page.locator("#weatherDisplayLocation").inner_text()
            gps_restored_active = page.locator('.weather-loc-chip[data-loc-id="gps"]').evaluate("el => el.classList.contains('active')")
            var_box_hidden = not page.locator("#weatherVariableBox").is_visible()
            log_test("7.1k Standort-Filterung: Zurück zu GPS umschalten", "GPS" in gps_restored_text and gps_restored_active and var_box_hidden, f"Text: '{gps_restored_text}', GPS aktiv: {gps_restored_active}")

            day_cards_count = page.locator(".day-forecast-card").count()
            log_test("7.2 14-Tage Wetterprognose-Karten gerendert", day_cards_count >= 10, f"{day_cards_count} Tage in der Vorhersage")

            solar_stat_count = page.locator(".day-forecast-card .day-solar-stat").count()
            log_test("7.2b Solar-PV Ertragskennzeichnung auf Tageskarten", solar_stat_count > 0, f"{solar_stat_count} Tage mit PV-Ertragsanzeige")

            # 7.2c: 100% aller Karten haben ein individuelles, nicht-leeres Emoji-Icon
            icons_check = page.evaluate("""() => {
                const icons = Array.from(document.querySelectorAll('.day-forecast-card .day-weather-icon')).map(el => el.textContent.trim());
                const allSet = icons.length > 0 && icons.every(ic => ic.length > 0 && !ic.includes('<svg'));
                const uniqueIcons = new Set(icons);
                return {
                    total: icons.length,
                    allSet,
                    uniqueCount: uniqueIcons.size,
                    iconsSample: icons.slice(0, 5)
                };
            }""")
            log_test("7.2c 100% aller Wetterkarten besitzen ein individuelles, valides Icon", icons_check.get("allSet") is True and icons_check.get("uniqueCount") >= 2, f"{icons_check.get('total')} Tage mit gesetzten Icons, {icons_check.get('uniqueCount')} unterschiedliche Icons: {icons_check.get('iconsSample')}")

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

            hourly_cards_count = page.locator(".hourly-hour-card").count()
            has_solar_ghi_chips = page.locator(".hourly-hour-card .hh-ghi-val").count() > 0
            log_test("7.7b Stündliche Detailkapseln mit 6-22h Bereich und Solarstrahlung (GHI)", hourly_cards_count == 17 and has_solar_ghi_chips, f"Kapseln: {hourly_cards_count} (6-22h = 17h), GHI-Werte vorhanden: {has_solar_ghi_chips}")

            # 7.7c: Aktuelle Uhrzeit-Markierung (JETZT) beim aktuellen Tag im Stundengraph
            modal_sub_text = page.locator("#hourlyModalSub").inner_text()
            has_now_legend = page.locator("#hourlyChartLegendBox").inner_text()
            now_badges_count = page.locator(".hourly-hour-card.is-current-hour").count()
            is_now_marked = "Aktuell" in modal_sub_text and "Jetzt" in has_now_legend and now_badges_count >= 1
            log_test("7.7c Stündlicher Wetterchart zeigt aktuelle Uhrzeit-Markierung (JETZT) beim aktuellen Tag", is_now_marked, f"Sub: '{modal_sub_text}', Jetzt im Chart/Legende: True, Aktuelle Stunde aktiv: {now_badges_count}")

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
            initial_odo = page.locator("#cfgCurrentOdo").input_value()
            log_test("8.1 Fahrzeug-Einstellungsformular geladen", model_input_val == expected_title, f"Modellname: '{model_input_val}'")
            log_test("8.1b Kilometerstand im Formular editierbar", page.locator("#cfgCurrentOdo").is_visible(), f"Odo-Input Wert: '{initial_odo}'")
            log_test("8.1b2 Akkustand (SoC) im Formular editierbar", page.locator("#cfgCurrentSoc").is_visible(), "Feld #cfgCurrentSoc vorhanden")

            # Test Kilometerstand editieren und speichern
            page.locator("#cfgCurrentOdo").fill("150")
            page.locator("#btnSaveVehicleSettings").click()
            time.sleep(0.3)
            card_odo_val = page.locator("#cardCurrentOdo").inner_text()
            log_test("8.1c Kilometerstand gespeichert und auf Dashboard aktualisiert", "150" in card_odo_val, f"Card km: '{card_odo_val}'")
            # Zurücksetzen auf Anfangswert
            page.locator("#cfgCurrentOdo").fill(initial_odo if initial_odo else "0")
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

            # 8.2b: Ladeorte-Liste zeigt gespeicherte Adressen
            loc_manage_text = page.locator("#locationsDragList").inner_text()
            has_addresses = "Unterwang" in loc_manage_text and "Rubihornweg" in loc_manage_text and ("Thomas-Dachser" in loc_manage_text or "Dachser" in loc_manage_text)
            log_test("8.2b Ladeorte-Liste zeigt Adressen (Unterwang, Rubihornweg, Dachser)", has_addresses, "Adressen in Standortzeilen sichtbar")

            # Open Neuer Standort Modal
            page.locator("#btnOpenNewLocationModal").click()
            time.sleep(0.3)
            loc_modal_open = page.locator("#modalEditLocation").evaluate("el => el.classList.contains('open')")
            has_addr_input = page.locator("#locEditAddress").count() == 1
            log_test("8.3 Neuer Standort Modal öffnet sich mit Adressfeld", loc_modal_open and has_addr_input, f"Modal geöffnet: {loc_modal_open}, Adressfeld: {has_addr_input}")

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

            # =====================================================================
            # SUITE 10: TEARDOWN & CLEANUP: LÖSCHEN AUS APP UND GOOGLE SHEET
            # =====================================================================
            print("\n--- SUITE 10: Teardown & Cleanup: Löschen aus App & Google Sheet ---")

            # 10.1: Ladevorgang über UI aus der App löschen
            page.locator('.dock-tab-btn[data-tab="charging"]').click()
            time.sleep(0.4)
            page.locator('.picker-seg[data-sub="history"]').click()
            time.sleep(0.3)

            del_btn = page.locator(".session-swift-card", has_text="Playwright E2E Testladung").locator(".btn-del-charge")
            charge_card_found = del_btn.count() > 0
            if charge_card_found:
                del_btn.first.click()
                time.sleep(0.8)

            card_remains = page.locator(".session-swift-card", has_text="Playwright E2E Testladung").count()
            storage_charge_clean = page.evaluate("""() => {
                try {
                    const raw = localStorage.getItem('cupra_raval_data');
                    if (!raw) return true;
                    const d = JSON.parse(raw);
                    return !(d.sessions || []).some(s => (s.notes || '').includes('Playwright'));
                } catch(e) { return false; }
            }""")
            log_test(
                "10.1 Test-Ladevorgang aus der App gelöscht",
                card_remains == 0 and storage_charge_clean,
                f"Karten verbleibend: {card_remains}, Storage sauber: {storage_charge_clean}"
            )

            # 10.2: Ladevorgang aus Google Sheet löschen und verifizieren
            time.sleep(1.0)
            cleanup_google_sheet(created_session_id, "Playwright")
            time.sleep(1.0)

            sheet_is_clean = False
            try:
                req = urllib.request.Request(GOOGLE_SHEETS_API_URL, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=20) as r:
                    cloud_rows = json.loads(r.read().decode('utf-8'))
                    sheet_is_clean = not any(
                        (r.get('id') == created_session_id) or ('Playwright' in str(r.get('notes', '')))
                        for r in cloud_rows
                    )
            except Exception as e:
                sheet_is_clean = False
            log_test(
                "10.2 Test-Ladevorgang aus Google Sheet entfernt",
                sheet_is_clean,
                "Google Sheet enthält keine Testeinträge mehr"
            )

            # 10.3: Test-Standort 'Tesla Supercharger Kempten' aus App löschen
            page.locator('.dock-tab-btn[data-tab="settings"]').click()
            time.sleep(0.4)
            page.locator('.picker-seg[data-settab="locations"]').click()
            time.sleep(0.3)

            edit_mode_btn = page.locator("#btnToggleLocationEditMode")
            if not edit_mode_btn.evaluate("el => el.classList.contains('active-done')"):
                edit_mode_btn.click()
                time.sleep(0.3)

            test_loc_row = page.locator(".loc-manage-row", has_text="Tesla Supercharger Kempten")
            if test_loc_row.count() > 0:
                test_loc_row.locator(".btn-del-circle").click()
                time.sleep(0.5)

            if edit_mode_btn.evaluate("el => el.classList.contains('active-done')"):
                edit_mode_btn.click()
                time.sleep(0.2)

            loc_remains = page.locator(".loc-manage-row", has_text="Tesla Supercharger Kempten").count()
            loc_storage_clean = page.evaluate("""() => {
                try {
                    const raw = localStorage.getItem('cupra_raval_data');
                    if (!raw) return true;
                    const d = JSON.parse(raw);
                    return !(d.settings?.locations || []).some(l => l.name.includes('Tesla Supercharger'));
                } catch(e) { return false; }
            }""")
            log_test(
                "10.3 Test-Standort aus App gelöscht",
                loc_remains == 0 and loc_storage_clean,
                f"Standorte verbleibend: {loc_remains}, Storage sauber: {loc_storage_clean}"
            )

            # 10.4: Dashboard KPIs wieder im Ursprungszustand verifizieren
            page.locator('.dock-tab-btn[data-tab="dashboard"]').click()
            time.sleep(0.4)
            final_month_kwh = page.locator("#dashMonthKwh").inner_text()
            try:
                clean_kwh = float(final_month_kwh.replace("kWh", "").replace("geladen", "").replace(",", ".").strip())
            except Exception:
                clean_kwh = 0.0
            log_test(
                "10.4 Dashboard KPIs wieder im Ursprungszustand",
                abs(clean_kwh - prev_kwh) < 0.1,
                f"Monats-kWh: {final_month_kwh} (Vorher: {prev_kwh})"
            )

            # =====================================================================
            # SUITE 11: PULL-DOWN-TO-REFRESH (LADEN & WETTER)
            # =====================================================================
            print("\n--- SUITE 11: iOS Pull-down-to-refresh (Laden & Wetter) ---")

            # 11.1: Tab 2 (Laden) öffnen & Ruhezustand prüfen
            page.locator('.dock-tab-btn[data-tab="charging"]').click()
            time.sleep(0.4)
            ptr_charging_present = page.locator("#ptrCharging").count() == 1
            ptr_charging_hidden = page.evaluate("""() => {
                const el = document.getElementById('ptrCharging');
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style.display === 'none' || parseFloat(style.height) === 0;
            }""")
            log_test(
                "11.1 Tab 2 (Laden): Pull-to-Refresh Banner vorhanden & im Ruhezustand eingeklappt",
                ptr_charging_present and ptr_charging_hidden,
                f"Present: {ptr_charging_present}, Eingeklappt: {ptr_charging_hidden}"
            )

            # 11.2: Touch-Geste nach unten simulieren auf Tab 2
            tab_charging_box = page.locator("#tab-charging").bounding_box()
            touch_x = tab_charging_box["x"] + (tab_charging_box["width"] / 2.0)
            touch_start_y = 100.0

            # Touchstart -> Touchmove (Herunterziehen um 95px für Schwellenwert-Überschreitung)
            page.evaluate("""({x, startY}) => {
                const target = document.getElementById('tab-charging');
                const tStart = new Touch({ identifier: 1, target: target, clientX: x, clientY: startY });
                window.dispatchEvent(new TouchEvent('touchstart', { touches: [tStart], changedTouches: [tStart], bubbles: true }));
                const tMove = new Touch({ identifier: 1, target: target, clientX: x, clientY: startY + 95 });
                window.dispatchEvent(new TouchEvent('touchmove', { touches: [tMove], changedTouches: [tMove], bubbles: true, cancelable: true }));
            }""", {"x": touch_x, "startY": touch_start_y})
            time.sleep(0.2)

            pulling_state = page.evaluate("""() => {
                const el = document.getElementById('ptrCharging');
                return {
                    visible: el.classList.contains('ptr-visible'),
                    threshold: el.classList.contains('ptr-threshold'),
                    height: parseFloat(el.style.height || 0)
                };
            }""")
            log_test(
                "11.2 Tab 2 (Laden): Touch-Pull nach unten aktiviert Rubber-Banding & Threshold",
                pulling_state["visible"] and pulling_state["threshold"] and pulling_state["height"] >= 50,
                f"Visible: {pulling_state['visible']}, Threshold: {pulling_state['threshold']}, Höhe: {pulling_state['height']:.1f}px"
            )

            # Finger wieder loslassen -> Löst Refresh aus
            page.evaluate("""() => {
                window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true }));
            }""")
            time.sleep(0.3)
            refresh_started = page.evaluate("""() => {
                const el = document.getElementById('ptrCharging');
                return el.classList.contains('ptr-refreshing') || el.classList.contains('ptr-success');
            }""")

            # Warten bis Google Sheets Sync vollständig beendet und eingeklappt ist (bis zu 7s für echten Cloud-Call)
            reset_state = False
            for _ in range(35):
                time.sleep(0.2)
                reset_state = page.evaluate("""() => {
                    const el = document.getElementById('ptrCharging');
                    return !el.classList.contains('ptr-visible') &&
                           !el.classList.contains('ptr-refreshing') &&
                           !el.classList.contains('ptr-success') &&
                           !el.classList.contains('ptr-collapsing');
                }""")
                if reset_state:
                    break

            log_test(
                "11.3 Tab 2 (Laden): Pull-to-Refresh synchronisiert & federt sauber zurück",
                refresh_started and reset_state,
                f"Refresh gestartet: {refresh_started}, Zurückgefedert: {reset_state}"
            )

            # 11.4: Tab 3 (Wetter) öffnen & Banner prüfen
            page.locator('.dock-tab-btn[data-tab="weather"]').click()
            time.sleep(0.5)
            ptr_weather_present = page.locator("#ptrWeather").count() == 1
            log_test(
                "11.4 Tab 3 (Wetter): Pull-to-Refresh Banner vorhanden",
                ptr_weather_present,
                f"Present: {ptr_weather_present}"
            )

            # 11.5: Touch-Pull auf Tab 3 (Wetter)
            page.evaluate("() => window.scrollTo(0, 0)")
            tab_weather_box = page.locator("#tab-weather").bounding_box()
            w_touch_x = tab_weather_box["x"] + (tab_weather_box["width"] / 2.0)
            w_touch_start_y = 100.0

            page.evaluate("""({x, startY}) => {
                const target = document.getElementById('tab-weather');
                const tStart = new Touch({ identifier: 2, target: target, clientX: x, clientY: startY });
                window.dispatchEvent(new TouchEvent('touchstart', { touches: [tStart], changedTouches: [tStart], bubbles: true }));
                const tMove = new Touch({ identifier: 2, target: target, clientX: x, clientY: startY + 95 });
                window.dispatchEvent(new TouchEvent('touchmove', { touches: [tMove], changedTouches: [tMove], bubbles: true, cancelable: true }));
            }""", {"x": w_touch_x, "startY": w_touch_start_y})
            time.sleep(0.2)

            w_pulling_state = page.evaluate("""() => {
                const el = document.getElementById('ptrWeather');
                return {
                    visible: el.classList.contains('ptr-visible'),
                    threshold: el.classList.contains('ptr-threshold')
                };
            }""")
            # Finger loslassen -> startet Wetter-Refresh
            page.evaluate("""() => {
                window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true }));
            }""")
            time.sleep(0.3)
            weather_refreshing_active = page.evaluate("""() => {
                const el = document.getElementById('ptrWeather');
                return el.classList.contains('ptr-refreshing') || el.classList.contains('ptr-success');
            }""")
            log_test(
                "11.5 Tab 3 (Wetter): Touch-Pull aktiviert Schwellenwert & startet Wetter-Refresh",
                w_pulling_state["visible"] and w_pulling_state["threshold"] and weather_refreshing_active,
                f"Threshold: {w_pulling_state['threshold']}, Refreshing: {weather_refreshing_active}"
            )

            # 11.6: Warten bis Wetter-Refresh fertiggestellt ist und Banner einklappt
            weather_done_state = False
            for _ in range(30):
                time.sleep(0.2)
                weather_done_state = page.evaluate("""() => {
                    const el = document.getElementById('ptrWeather');
                    return !el.classList.contains('ptr-visible') &&
                           !el.classList.contains('ptr-refreshing') &&
                           !el.classList.contains('ptr-success') &&
                           !el.classList.contains('ptr-collapsing');
                }""")
                if weather_done_state:
                    break

            log_test(
                "11.6 Tab 3 (Wetter): Wetterdaten aktualisiert & Banner wieder unsichtbar",
                weather_done_state,
                f"Abgeschlossen und eingeklappt: {weather_done_state}"
            )

        finally:
            # Sicherheitsnetz (Fail-Safe): Bereinigt selbst bei Test-Abbruch alle Spuren
            try:
                cleanup_google_sheet(created_session_id, "Playwright")
                if not page.is_closed():
                    page.evaluate("""() => {
                        try {
                            const raw = localStorage.getItem('cupra_raval_data');
                            if (!raw) return;
                            const d = JSON.parse(raw);
                            d.sessions = (d.sessions || []).filter(s => !(s.notes || '').includes('Playwright'));
                            if (d.settings && d.settings.locations) {
                                d.settings.locations = d.settings.locations.filter(l => !l.name.includes('Tesla Supercharger'));
                            }
                            localStorage.setItem('cupra_raval_data', JSON.stringify(d));
                        } catch(e) {}
                    }""")
            except Exception as cleanup_err:
                print(f"[FAILSAFE CLEANUP ERROR]: {cleanup_err}")

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

