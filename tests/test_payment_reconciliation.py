import time
from playwright.sync_api import sync_playwright

def run_payment_tests():
    print("=" * 70)
    print("E2E TESTS: BAYRHOFS ABRECHNUNG & ZAHLUNGSABGLEICH")
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
        page = context.new_page()

        try:
            page.goto("http://localhost:8080/", wait_until="domcontentloaded")
            page.wait_for_function("() => window.appData && window.appData.sessions", timeout=5000)

            # 1. Beispieldaten laden für deterministische Testdaten
            print("\n--- TEST 1: Beispieldaten laden ---")
            page.evaluate("""() => {
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

            # 2. Prüfen der Bayrhofs Reconcile Card
            print("\n--- TEST 2: Bayrhofs Abrechnung Card vorhanden & berechnet ---")
            card_visible = page.locator("#bayrhofsReconcileCard").is_visible()
            log_test("2.1 Reconcile Card sichtbar", card_visible)

            unpaid_sum_text = page.locator("#reconcileUnpaidSum").inner_text()
            unpaid_count_text = page.locator("#reconcileUnpaidCount").inner_text()
            # 5.18 + 6.00 = 11.18 €
            log_test("2.2 Offener Betrag korrekt berechnet (11,18 € / 2 Ladungen)", "11,18" in unpaid_sum_text and "2" in unpaid_count_text, f"Summe: {unpaid_sum_text}, Count: {unpaid_count_text}")

            # 3. Badges in den Karten prüfen
            print("\n--- TEST 3: Status-Badges in Ladekarten ---")
            # Bayrhof Karten müssen "⏳ Offen" haben
            card_bay1 = page.locator('.session-swift-card[data-id="session_bayrhof_1"]')
            bay1_badge = card_bay1.locator(".pay-status-badge.unpaid").inner_text()
            log_test("3.1 Bayrhofs Karte zeigt '⏳ Offen'", "Offen" in bay1_badge, f"Badge: '{bay1_badge}'")

            # Arbeit Karte muss "✓ Direkt bezahlt" haben
            card_arbeit = page.locator('.session-swift-card[data-id="session_arbeit_1"]')
            arbeit_badge = card_arbeit.locator(".pay-status-badge.direct").inner_text()
            log_test("3.2 Arbeit Karte zeigt '✓ Direkt bezahlt'", "Direkt bezahlt" in arbeit_badge, f"Badge: '{arbeit_badge}'")

            # 4. Quick Toggle Button
            print("\n--- TEST 4: Schnelles Umschalten über Button in Karte ---")
            toggle_btn = card_bay1.locator(".btn-pay-toggle")
            btn_text_before = toggle_btn.inner_text()
            log_test("4.1 Toggle-Button zeigt '💶 Als bezahlt'", "Als bezahlt" in btn_text_before)

            toggle_btn.click()
            time.sleep(0.4)

            # Nach Klick: Bayrhofs 1 muss jetzt bezahlt sein
            is_paid_after = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_1').paid")
            card_bay1_updated = page.locator('.session-swift-card[data-id="session_bayrhof_1"]')
            badge_paid = card_bay1_updated.locator(".pay-status-badge.paid").inner_text()
            log_test("4.2 Bayrhofs 1 nach Klick als bezahlt markiert", is_paid_after is True and "Bezahlt" in badge_paid)

            # Wieder zurück auf offen setzen
            toggle_btn_rev = card_bay1_updated.locator(".btn-pay-toggle")
            toggle_btn_rev.click()
            time.sleep(0.4)
            is_unpaid_again = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_1').paid")
            log_test("4.3 Bayrhofs 1 wieder auf offen zurückgesetzt", is_unpaid_again is False)

            # 5. Intelligenter Zahlungsabgleich (Smart Matching)
            print("\n--- TEST 5: Intelligenter Zahlungsabgleich (Smart Matching) ---")
            # Wir geben 5.18 € ein -> muss exakt session_bayrhof_1 treffen
            amount_input = page.locator("#inputReconcileAmount")
            amount_input.fill("5.18")
            page.locator("#btnRunReconcile").click()
            time.sleep(0.4)

            result_panel_visible = page.locator("#reconcileResultPanel").is_visible()
            badge_text = page.locator("#reconcileResultBadge").inner_text()
            log_test("5.1 Ergebnisbox sichtbar mit exakter Übereinstimmung", result_panel_visible and "Exakt" in badge_text, f"Badge: '{badge_text}'")

            # Checkbox für session_bayrhof_1 muss vorselektiert sein
            cb_bay1 = page.locator('.reconcile-item-checkbox[data-id="session_bayrhof_1"]')
            cb_bay1_checked = cb_bay1.is_checked()
            cb_bay2 = page.locator('.reconcile-item-checkbox[data-id="session_bayrhof_2"]')
            cb_bay2_checked = cb_bay2.is_checked()
            log_test("5.2 Genau session_bayrhof_1 selektiert", cb_bay1_checked is True and cb_bay2_checked is False)

            # Differenz Anzeige
            diff_text = page.locator("#reconcileDiffDisplay").inner_text()
            log_test("5.3 Differenz ist 0,00 € (Exakt)", "0,00" in diff_text)

            # Als bezahlt verbuchen klicken
            page.locator("#btnConfirmReconcile").click()
            time.sleep(0.4)

            # Prüfen ob session_bayrhof_1 nun paid: true ist
            bay1_now_paid = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_1').paid")
            bay2_still_unpaid = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_2').paid")
            log_test("5.4 Verbuchen erfolgreich: Bayrhofs 1 bezahlt, Bayrhofs 2 noch offen", bay1_now_paid is True and bay2_still_unpaid is False)

            # Neuer offener Betrag in Reconcile Card: 6.00 €
            unpaid_sum_after = page.locator("#reconcileUnpaidSum").inner_text()
            log_test("5.5 Reconcile-Übersicht aktualisiert (6,00 € offen)", "6,00" in unpaid_sum_after)

            # 6. Filterchip "Bayrhofs Offen"
            print("\n--- TEST 6: Filterchip 'Bayrhofs Offen' ---")
            unpaid_chip = page.locator('.chip-filter[data-filter="unpaid_bayrhofs"]')
            chip_exists = unpaid_chip.count() > 0
            log_test("6.1 Schnellfilter '⏳ Bayrhofs Offen' vorhanden", chip_exists)
            if chip_exists:
                unpaid_chip.click()
                time.sleep(0.3)
                cards_count = page.locator(".session-swift-card").count()
                first_card_id = page.locator(".session-swift-card").first.get_attribute("data-id")
                log_test("6.2 Filter zeigt nur 1 offene Karte (session_bayrhof_2)", cards_count == 1 and first_card_id == "session_bayrhof_2")

            # 7. Modal Ladevorgang erfassen / bearbeiten
            print("\n--- TEST 7: Zahlungsstatus im Lade-Modal ---")
            page.locator('.chip-filter[data-filter="all"]').click()
            time.sleep(0.3)

            # Öffne Bearbeiten für Bayrhofs 2
            card_bay2 = page.locator('.session-swift-card[data-id="session_bayrhof_2"]')
            card_bay2.locator(".btn-edit-charge").click()
            time.sleep(0.4)

            # Im Modal muss Zahlungsstatus-Checkbox existieren und nicht deaktiviert sein
            pay_cb = page.locator("#entryPaymentPaidCheckbox")
            cb_disabled = pay_cb.is_disabled()
            cb_val = pay_cb.is_checked()
            log_test("7.1 Bayrhofs Modal: Checkbox editierbar und offen", cb_disabled is False and cb_val is False)

            # Setze Haken auf bezahlt und speichere
            pay_cb.check()
            page.locator("#btnSaveEntry").click()
            time.sleep(0.4)

            bay2_now_paid = page.evaluate("() => window.appData.sessions.find(s => s.id === 'session_bayrhof_2').paid")
            log_test("7.2 Bayrhofs 2 über Modal als bezahlt gespeichert", bay2_now_paid is True)

            # Jetzt müssen alle Bayrhofs-Ladungen bezahlt sein -> Status Chip "Alles abgerechnet ✓"
            status_chip_text = page.locator("#reconcileStatusChip").inner_text()
            log_test("7.3 Status-Chip zeigt 'Alles abgerechnet ✓'", "Alles abgerechnet" in status_chip_text, f"Chip Text: '{status_chip_text}'")

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
