import time
from playwright.sync_api import sync_playwright

def run_payment_tests():
    print("=" * 70)
    print("E2E TESTS: BAYRHOFS ABRECHNUNG, ZAHLUNGSHISTORIE & THG-SPEICHERUNG")
    print("=" * 70)

    passed = 0
    failed = 0

    def log_test(name, condition, details=""):
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"[PASSED] {name}: {details}")
        else:
            failed += 1
            print(f"[FAILED] {name}: {details}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844})
        context.route("https://script.google.com/**", lambda route: route.abort())
        page = context.new_page()

        try:
            page.goto("http://localhost:8080/", wait_until="domcontentloaded")
            page.wait_for_function("() => window.appData && window.appData.sessions", timeout=5000)

            # 1. Beispieldaten laden für deterministische Testdaten
            print("\n--- TEST 1: Beispieldaten laden ---")
            page.evaluate("""() => {
                window.fetchCloudSessions = () => Promise.resolve();
                window.postCloudPaymentUpdate = () => Promise.resolve();
                const now = new Date();
                window.appData.sessions = [
                    {
                        id: "session_bayrhof_1",
                        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 10, 0).toISOString(),
                        kwh: 34.5,
                        odometer: 12400,
                        pricePerKwh: 0.15,
                        totalCost: 5.18,
                        location: "Bayrhofs",
                        pvSurplus: true,
                        notes: "Bayrhofs 1",
                        paid: false
                    },
                    {
                        id: "session_bayrhof_2",
                        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5, 14, 0).toISOString(),
                        kwh: 40.0,
                        odometer: 12200,
                        pricePerKwh: 0.15,
                        totalCost: 6.00,
                        location: "Bayrhofs",
                        pvSurplus: true,
                        notes: "Bayrhofs 2",
                        paid: false
                    },
                    {
                        id: "session_arbeit_1",
                        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 12, 0).toISOString(),
                        kwh: 25.0,
                        odometer: 12000,
                        pricePerKwh: 0.20,
                        totalCost: 5.00,
                        location: "Arbeit",
                        pvSurplus: false,
                        notes: "Arbeit Ladung",
                        paid: true
                    },
                    {
                        id: "session_zuhause_1",
                        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10, 20, 0).toISOString(),
                        kwh: 30.0,
                        odometer: 11800,
                        pricePerKwh: 0.32,
                        totalCost: 9.60,
                        location: "Zuhause",
                        pvSurplus: false,
                        notes: "Zuhause Ladung",
                        paid: true
                    }
                ];
                localStorage.setItem('cupra_raval_data', JSON.stringify(window.appData));
                window.renderAll();
            }""")
            time.sleep(0.3)

            # Tab 2: Laden öffnen
            page.locator('.dock-tab-btn[data-tab="charging"]').click()
            time.sleep(0.3)

            # 2. Prüfen des Segmented Pickers mit Subtab "Bayrhofs Abrechnung"
            print("\n--- TEST 2: Subtab 'Bayrhofs Abrechnung' vorhanden & wählbar ---")
            bay_tab_btn = page.locator('.picker-seg[data-sub="bayrhofs"]')
            tab_exists = bay_tab_btn.count() > 0
            log_test("2.1 Subtab 'Bayrhofs Abrechnung' vorhanden", tab_exists)

            # Badge auf Subtab prüfen (2 offene Ladungen)
            badge_text = page.locator("#segBadgeBayrhofs").inner_text()
            log_test("2.2 Badge am Subtab zeigt 2 offene Ladungen", "2" in badge_text, f"Badge: '{badge_text}'")

            # Auf Bayrhofs Abrechnung Tab wechseln
            bay_tab_btn.click()
            time.sleep(0.3)
            card_visible = page.locator("#bayrhofsReconcileCard").is_visible()
            log_test("2.3 Bayrhofs Abrechnung Subview sichtbar", card_visible)

            unpaid_sum_text = page.locator("#reconcileUnpaidSum").inner_text()
            unpaid_count_text = page.locator("#reconcileUnpaidCount").inner_text()
            log_test("2.4 Offener Betrag korrekt berechnet (11,18 € / 2 Ladungen)", "11,18" in unpaid_sum_text and "2" in unpaid_count_text, f"Summe: {unpaid_sum_text}, Count: {unpaid_count_text}")

            # 3. Wechsel zur 'Historie der Zahlungen' per Klick auf 'Bereits abgerechnet'
            print("\n--- TEST 3: Historie der Zahlungen per Klick auf 'Bereits abgerechnet' ---")
            # Klick auf pillFilterPaidBayrhofs ("Bereits abgerechnet")
            page.locator("#pillFilterPaidBayrhofs").click()
            time.sleep(0.3)

            history_visible = page.locator("#baySectionHistory").is_visible()
            open_hidden = not page.locator("#baySectionOpen").is_visible()
            history_btn_active = page.locator("#btnBayModeHistory").evaluate("el => el.classList.contains('active')")
            log_test("3.1 Klick auf 'Bereits abgerechnet' öffnet Zahlungshistorie", history_visible and open_hidden and history_btn_active)

            # Klick auf 'Offen bei Bayrhofs' wechselt zurück
            page.locator("#pillFilterUnpaidBayrhofs").click()
            time.sleep(0.3)

            history_hidden = not page.locator("#baySectionHistory").is_visible()
            open_visible = page.locator("#baySectionOpen").is_visible()
            open_btn_active = page.locator("#btnBayModeOpen").evaluate("el => el.classList.contains('active')")
            log_test("3.2 Klick auf 'Offen bei Bayrhofs' wechselt zurück zu offenen Ladungen", history_hidden and open_visible and open_btn_active)

            # 4. Offene Ladungsliste in Bayrhofs-Ansicht prüfen
            print("\n--- TEST 4: Liste offener Ladungen in Bayrhofs-Ansicht ---")
            open_cards_count = page.locator("#bayrhofsOpenStreamContainer .bayrhofs-session-card").count()
            log_test("4.1 Genau 2 offene Bayrhofs-Karten gerendert", open_cards_count == 2, f"Count: {open_cards_count}")

            # 5. Intelligenter Zahlungsabgleich (Smart Matching)
            print("\n--- TEST 5: Intelligenter Zahlungsabgleich (Smart Matching) ---")
            amount_input = page.locator("#inputReconcileAmount")
            amount_input.fill("5.18")
            page.locator("#btnRunReconcile").click()
            time.sleep(0.4)

            result_panel_visible = page.locator("#reconcileResultPanel").is_visible()
            badge_match_text = page.locator("#reconcileResultBadge").inner_text()
            log_test("5.1 Ergebnisbox sichtbar mit exakter Übereinstimmung", result_panel_visible and "Exakt" in badge_match_text, f"Badge: '{badge_match_text}'")

            cb_bay1 = page.locator('.reconcile-item-checkbox[data-id="session_bayrhof_1"]')
            cb_bay1_checked = cb_bay1.is_checked()
            cb_bay2 = page.locator('.reconcile-item-checkbox[data-id="session_bayrhof_2"]')
            cb_bay2_checked = cb_bay2.is_checked()
            log_test("5.2 Genau session_bayrhof_1 selektiert", cb_bay1_checked is True and cb_bay2_checked is False)

            diff_text = page.locator("#reconcileDiffDisplay").inner_text()
            log_test("5.3 Differenz ist 0,00 € (Exakt)", "0,00" in diff_text)

            # Als bezahlt verbuchen klicken
            page.locator("#btnConfirmReconcile").click()
            time.sleep(0.4)

            bay1_now_paid = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_1').paid")
            bay2_still_unpaid = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_2').paid")
            log_test("5.4 Verbuchen erfolgreich: Bayrhofs 1 bezahlt, Bayrhofs 2 noch offen", bay1_now_paid is True and bay2_still_unpaid is False)

            # Reconcile-Badge am Subtab muss jetzt 1 zeigen
            badge_after = page.locator("#segBadgeBayrhofs").inner_text()
            log_test("5.5 Subtab-Badge auf 1 reduziert", "1" in badge_after, f"Badge: '{badge_after}'")

            # 6. Historie der Zahlungen nach Verbuchung prüfen
            print("\n--- TEST 6: Zahlungshistorie enthält verbuchte Ladung ---")
            page.locator("#btnBayModeHistory").click()
            time.sleep(0.3)

            paid_card_bay1 = page.locator('#bayrhofsPaidStreamContainer .bayrhofs-session-card[data-id="session_bayrhof_1"]')
            paid_card_exists = paid_card_bay1.count() > 0
            log_test("6.1 Verbuchte Ladung session_bayrhof_1 ist in Zahlungshistorie vorhanden", paid_card_exists)

            # 7. Ladehistorie Subtab (Hauptstrom) und Filter
            print("\n--- TEST 7: Ladehistorie Subtab & Filterchips ---")
            page.locator('.picker-seg[data-sub="history"]').click()
            time.sleep(0.3)

            # Bayrhof 1 muss jetzt "✓ Bezahlt" zeigen
            card_bay1 = page.locator('#chargesStreamContainer .session-swift-card[data-id="session_bayrhof_1"]')
            badge_paid = card_bay1.locator(".pay-status-badge.paid").inner_text()
            log_test("7.1 Bayrhofs 1 zeigt '✓ Bezahlt'", "Bezahlt" in badge_paid)

            # Schnellfilter 'Bayrhofs Offen'
            unpaid_chip = page.locator('.chip-filter[data-filter="unpaid_bayrhofs"]')
            chip_exists = unpaid_chip.count() > 0
            log_test("7.2 Schnellfilter '⏳ Bayrhofs Offen' vorhanden", chip_exists)
            if chip_exists:
                unpaid_chip.click()
                time.sleep(0.3)
                cards_count = page.locator("#chargesStreamContainer .session-swift-card").count()
                first_card_id = page.locator("#chargesStreamContainer .session-swift-card").first.get_attribute("data-id")
                log_test("7.3 Filter zeigt genau die 1 offene Karte (session_bayrhof_2)", cards_count == 1 and first_card_id == "session_bayrhof_2", f"Count: {cards_count}, First: {first_card_id}")

            # 8. THG-Quote Jahres-Speicherung (thgByYear)
            print("\n--- TEST 8: THG-Quote Jahres-Speicherung (thgByYear) ---")
            # Settings Tab öffnen
            page.locator('.dock-tab-btn[data-tab="settings"]').click()
            time.sleep(0.3)

            # THG Quote 2026 auf 135.00 € setzen
            page.locator("#cfgThgYear").fill("2026")
            page.locator("#cfgThgAmount").fill("135.00")
            page.locator("#btnSaveVehicleSettings").click()
            time.sleep(0.3)

            thg_2026 = page.evaluate("() => window.appData.settings.thgByYear['2026']")
            log_test("8.1 THG für 2026 auf 135.00 € gespeichert", thg_2026 is not None and thg_2026.get("amount") == 135.0)

            # THG Quote 2025 auf 90.00 € setzen
            page.locator("#cfgThgYear").fill("2025")
            page.locator("#cfgThgAmount").fill("90.00")
            page.locator("#btnSaveVehicleSettings").click()
            time.sleep(0.3)

            thg_2025 = page.evaluate("() => window.appData.settings.thgByYear['2025']")
            log_test("8.2 THG für 2025 auf 90.00 € gespeichert", thg_2025 is not None and thg_2025.get("amount") == 90.0)

            # Zurück auf 2026 tippen -> muss automatisch 135.00 laden
            page.locator("#cfgThgYear").fill("2026")
            page.locator("#cfgThgYear").dispatch_event("input")
            time.sleep(0.2)
            auto_val_2026 = page.locator("#cfgThgAmount").input_value()
            log_test("8.3 Wechsel auf Jahr 2026 lädt dynamisch 135.00 €", "135" in auto_val_2026, f"Value: '{auto_val_2026}'")

            # Cloud-Config Merge Simulation (stellt sicher, dass 135 € nicht überschrieben wird)
            page.evaluate("""() => {
                const cloudConfig = {
                    model: 'Cupra Raval Endurance Edition Dynamic',
                    thgByYear: {
                        '2026': { year: 2026, amount: 135.00, active: true, status: 'active' },
                        '2025': { year: 2025, amount: 90.00, active: true, status: 'active' }
                    }
                };
                window.postCloudVehicleConfig();
            }""")
            time.sleep(0.3)

            final_2026_amt = page.evaluate("() => window.appData.settings.thgByYear['2026'].amount")
            log_test("8.4 THG-Wert für 2026 bleibt nach Cloud-Sync stabil auf 135.00 €", final_2026_amt == 135.0)

            # 8.5 App-Neustart / Reload Persistenz-Test
            page.reload()
            page.wait_for_function("() => window.appData")
            reloaded_thg = page.evaluate("() => window.appData.settings.thgByYear")
            has_2026 = reloaded_thg and "2026" in reloaded_thg and reloaded_thg["2026"].get("amount") == 135.0
            has_2025 = reloaded_thg and "2025" in reloaded_thg and reloaded_thg["2025"].get("amount") == 90.0
            log_test("8.5 THG-Quoten bleiben nach App-Neustart/Reload pro Jahr erhalten (2026: 135€, 2025: 90€)", has_2026 and has_2025)

            print("\n" + "=" * 70)
            print(f"ERGEBNIS: {passed} PASSED, {failed} FAILED")
            print("=" * 70)
            return failed == 0

        finally:
            context.close()
            browser.close()

if __name__ == "__main__":
    success = run_payment_tests()
    exit(0 if success else 1)
