import sys
import time
import json
import urllib.request
import urllib.parse
from playwright.sync_api import sync_playwright

GOOGLE_SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbwlKhi7dukN5p3UDlM-6sxg72zVH9is2jKN1Wh8H0WCSeCAGmm7tjH0DxhIclf0k5Qv/exec"

def cleanup_google_sheet(target_id=None, keyword="Teilladung", api_url=GOOGLE_SHEETS_API_URL):
    deleted = []
    if target_id:
        try:
            del_url = f"{api_url}?action=delete&id={urllib.parse.quote(str(target_id))}"
            req = urllib.request.Request(del_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp.read()
            deleted.append(target_id)
        except Exception as e:
            print(f"[CLEANUP] Delete per ID fehlgeschlagen: {e}")

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

def run_test():
    print("======================================================================")
    print("TEST: OPTIONALE FELDER & DEZENTE KENNZEICHNUNG UNVOLLSTÄNDIGER LADUNGEN")
    print("======================================================================")

    # Vorab-Bereinigung eventueller Reste
    cleanup_google_sheet(keyword="Teilladung")

    session_id = None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 393, "height": 852},
                is_mobile=True,
                has_touch=True
            )
            page = context.new_page()
            page.goto("http://localhost:8080/", wait_until="domcontentloaded")
            time.sleep(1)

            # Cloud-Uploads in Unit-Tests isolieren, um das Google Sheet nicht zu verschmutzen
            page.evaluate("""() => {
                window.postCloudSession = () => Promise.resolve();
                window.postCloudPaymentUpdate = () => Promise.resolve();
            }""")

            # 1. Beispieldaten leeren oder vorbereiten
            page.evaluate("() => { window.appData.sessions = []; window.saveData(); window.renderAll(); }")
            time.sleep(0.3)

            # 2. Modal öffnen
            page.locator('#fabAddCharge').click()
            time.sleep(0.5)

            # Prüfen: Kein Feld hat das required-Attribut mehr
            required_inputs = page.locator('#formChargeEntry input[required]').count()
            print(f"[TEST 1] Anzahl required Inputs im Formular: {required_inputs} (Erwartet: 0)")
            assert required_inputs == 0, f"Es gibt noch required inputs: {required_inputs}"

            # Prüfen: Akkustand Start & Ende sind initial leer
            init_soc_start = page.locator('#entryBatterySocStart').input_value()
            init_soc_end = page.locator('#entryBatterySoc').input_value()
            print(f"[TEST 1b] Initialer Akkustand Start ('{init_soc_start}') und Ende ('{init_soc_end}') sind leer")
            assert init_soc_start == "" and init_soc_end == "", f"Akkustand Start oder Ende nicht leer: start='{init_soc_start}', end='{init_soc_end}'"

            # 3. Teil-Ladung erfassen: NUR km-Stand und Start-Akkustand eingeben (Lademenge, Preis, End-SoC komplett leer lassen)
            page.locator('#entryOdometer').fill("12550")
            page.locator('#entryBatterySocStart').fill("18")
            page.locator('#entryNotes').fill("Teilladung Test")
            page.locator('#entryKwh').fill("")
            page.locator('#entryTotalCost').fill("")
            time.sleep(0.3)

            # Speichern klicken
            page.locator('#btnSaveEntry').click()
            time.sleep(0.8)

            # Prüfen: Modal schließt sich und Eintrag ist in sessions
            modal_open = page.locator('#modalAddCharge').evaluate("el => el.classList.contains('open')")
            print(f"[TEST 2] Modal nach Speichern der Teilladung geschlossen: {not modal_open}")
            assert not modal_open, "Modal hat sich nicht geschlossen!"

            created_session = page.evaluate("() => window.appData.sessions.find(s => s.notes === 'Teilladung Test')")
            print(f"[TEST 3] Session erfolgreich in appData gespeichert: {created_session is not None}")
            assert created_session is not None, "Neue Session nicht in appData gefunden!"
            session_id = created_session['id']

            # 4. Prüfen in der Ladehistorie (Tab charging)
            page.locator('.dock-tab-btn[data-tab="charging"]').click()
            time.sleep(0.4)

            card = page.locator(f'#chargesStreamContainer .session-swift-card[data-id="{session_id}"]')
            card_class = card.get_attribute("class")
            print(f"[TEST 4] Ladekarte besitzt Klasse 'is-incomplete': {'is-incomplete' in card_class}")
            assert 'is-incomplete' in card_class, f"Klasse 'is-incomplete' fehlt: {card_class}"

            badge = card.locator('.session-incomplete-badge')
            badge_count = badge.count()
            badge_text = badge.inner_text() if badge_count > 0 else ""
            print(f"[TEST 5] Dezent gestaltetes Badge sichtbar: '{badge_text}'")
            assert "Unvollständig" in badge_text, f"Badge Text ungültig: {badge_text}"

            edit_btn_text = card.locator('.btn-edit-charge').inner_text()
            print(f"[TEST 6] Button zeigt '✏️ Ergänzen': '{edit_btn_text}'")
            assert "Ergänzen" in edit_btn_text, f"Button Text ungültig: {edit_btn_text}"

            # 5. Nun auf '✏️ Ergänzen' klicken und die fehlenden Felder nachtragen
            card.locator('.btn-edit-charge').click()
            time.sleep(0.5)

            hint_visible = page.locator('#modalIncompleteHint').is_visible()
            hint_text = page.locator('#modalIncompleteText').inner_text()
            print(f"[TEST 7] Modal zeigt Hinweis auf unvollständige Ladung: '{hint_text}' (Sichtbar: {hint_visible})")
            assert hint_visible and "Unvollständig" in hint_text, "Hinweis im Modal nicht sichtbar"

            # Fehlende Daten ergänzen: kWh, Kosten, End-SoC
            page.locator('#entryKwh').fill("28.4")
            page.locator('#entryBatterySoc').fill("72")
            time.sleep(0.3)
            page.locator('#btnSaveEntry').click()
            time.sleep(0.8)

            # 6. Prüfen: Nun ist die Ladung vollständig!
            updated_card = page.locator(f'#chargesStreamContainer .session-swift-card[data-id="{session_id}"]')
            updated_card_class = updated_card.get_attribute("class")
            updated_badge_count = updated_card.locator('.session-incomplete-badge').count()
            updated_edit_btn_text = updated_card.locator('.btn-edit-charge').inner_text()

            print(f"[TEST 8] Klasse 'is-incomplete' entfernt: {'is-incomplete' not in updated_card_class}")
            assert 'is-incomplete' not in updated_card_class, "is-incomplete immer noch vorhanden!"

            print(f"[TEST 9] Badge 'Unvollständig' entfernt: {updated_badge_count == 0}")
            assert updated_badge_count == 0, "Badge noch vorhanden!"

            print(f"[TEST 10] Button zeigt jetzt wieder '✏️ Bearbeiten': '{updated_edit_btn_text}'")
            assert "Bearbeiten" in updated_edit_btn_text, f"Button Text nicht 'Bearbeiten': {updated_edit_btn_text}"

            # 7. Prüfen: formatSessionForCloud erzeugt korrektes Status-Feld
            cloud_payload = page.evaluate(f"() => window.formatSessionForCloud(window.appData.sessions.find(s => s.id === '{session_id}'))")
            print(f"[TEST 11] Cloud-Payload enthält Status = '{cloud_payload.get('Status')}'")
            assert "Vollständig" in cloud_payload.get('Status') and "Unvollständig" not in cloud_payload.get('Status'), f"Cloud Payload Status ungültig: {cloud_payload}"

            browser.close()
            print("\n======================================================================")
            print("ALLE 11 TESTS ERFOLGREICH BESTANDEN! (PASSED)")
            print("======================================================================")
            return True
    finally:
        # ZWINGENDE BEREINIGUNG: Stellt sicher, dass niemals Test-Artefakte im Sheet verbleiben
        cleanup_google_sheet(target_id=session_id, keyword="Teilladung")

if __name__ == '__main__':
    run_test()
