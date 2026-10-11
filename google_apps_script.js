/**
 * ============================================================================
 * CUPRA RAVAL ENDURANCE - GOOGLE APPS SCRIPT BACKEND API
 * ============================================================================
 * 
 * ANLEITUNG ZUR EINRICHTUNG IN GOOGLE SHEETS:
 * 
 * 1. Öffne dein Google Sheet (oder erstelle ein neues leeres Google Sheet).
 * 2. Klicke im Menü oben auf: 'Erweiterungen' ➔ 'Apps Script'.
 * 3. Lösche den vorhandenen Code im Editor und füge diesen gesamten Code hier ein.
 * 4. Klicke oben auf das Disketten-Symbol 💾 (Speichern).
 * 
 * 5. BEREITSTELLUNG (WICHTIGSTER SCHRITT!):
 *    - Klicke oben rechts auf die blaue Schaltfläche 'Bereitstellen' ➔ 'Neue Bereitstellung'.
 *    - Klicke auf das Zahnrad ⚙️ neben "Typ auswählen" und wähle: 'Web-App'.
 *    - Beschreibung: "Cupra Raval Sync API"
 *    - Ausführen als: "Ich (<deine-email>)"
 *    - Wer hat Zugriff: "Jeder"  <--- EXTREM WICHTIG! NICHT "Nur ich"!
 *    - Klicke auf 'Bereitstellen'.
 *    - Bestätige die Google-Sicherheitsabfrage (Erweitert ➔ Zu ... wechseln).
 *    - Kopiere die Web-App-URL (endet auf /exec).
 * 
 * 6. Füge die URL in den Einstellungen der Cupra Raval PWA ein!
 * ============================================================================
 */

const SHEET_NAME = "Ladedaten";
const HEADERS = ["id", "date", "kwh", "odometer", "pricePerKwh", "totalCost", "location", "pvSurplus", "notes", "updatedAt"];

/**
 * Liefert das Tabellenblatt "Ladedaten". Erstellt es inkl. Kopfzeilen, falls noch nicht vorhanden.
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * GET-Handler: Liefert Ladedaten als JSON oder JSONP
 */
function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const action = e && e.parameter ? e.parameter.action : null;
    const callback = e && e.parameter ? e.parameter.callback : null;

    // Ping / Test-Endpunkt
    if (action === "ping") {
      const pingResult = {
        status: "success",
        message: "Cupra Raval Cloud API ist betriebsbereit!",
        version: "2.0",
        timestamp: new Date().toISOString(),
        rows: Math.max(0, sheet.getLastRow() - 1)
      };
      return createOutput(pingResult, callback);
    }

    // Ladedaten abrufen
    const lastRow = sheet.getLastRow();
    const sessions = [];

    if (lastRow > 1) {
      const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (!row[0] && !row[1]) continue; // Leerzeile überspringen

        sessions.push({
          id: String(row[0] || ("session_" + i)),
          date: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ""),
          kwh: parseNum(row[2]),
          odometer: parseNum(row[3]),
          pricePerKwh: parseNum(row[4]),
          totalCost: parseNum(row[5]),
          location: String(row[6] || "Bayrhofs"),
          pvSurplus: row[7] === true || String(row[7]).toLowerCase() === "true",
          notes: String(row[8] || ""),
          updatedAt: row[9] ? String(row[9]) : ""
        });
      }
    }

    // Nach Datum absteigend sortieren
    sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return createOutput(sessions, callback);
  } catch (err) {
    const errObj = { status: "error", message: err.toString() };
    const cb = e && e.parameter ? e.parameter.callback : null;
    return createOutput(errObj, cb);
  }
}

/**
 * POST-Handler: Speichert oder löscht Ladevorgänge
 */
function doPost(e) {
  try {
    const sheet = getOrCreateSheet();
    let payload = {};

    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || "create";

    // AKTION: Bulk Sync (mehrere Einträge auf einmal)
    if (action === "bulk_sync" || action === "bulk_upload") {
      const list = Array.isArray(payload.sessions) ? payload.sessions : [];
      let savedCount = 0;
      for (let i = 0; i < list.length; i++) {
        upsertSessionRow(sheet, list[i]);
        savedCount++;
      }
      return createOutput({ status: "success", action: "bulk_sync", count: savedCount });
    }

    // AKTION: Löschen
    if (action === "delete") {
      const targetId = payload.id;
      if (targetId) {
        deleteSessionRow(sheet, targetId);
      }
      return createOutput({ status: "success", action: "delete", id: targetId });
    }

    // AKTION: Speichern (Create oder Update)
    const session = payload.session || payload;
    upsertSessionRow(sheet, session);

    return createOutput({ status: "success", action: "save", id: session.id });
  } catch (err) {
    return createOutput({ status: "error", message: err.toString() });
  }
}

/**
 * Fügt einen Eintrag hinzu oder aktualisiert einen bestehenden anhand der ID
 */
function upsertSessionRow(sheet, session) {
  if (!session) return;
  const lastRow = sheet.getLastRow();
  const id = String(session.id || ("ses_" + Date.now()));
  const rowData = [
    id,
    session.date || new Date().toISOString(),
    parseNum(session.kwh),
    parseNum(session.odometer),
    parseNum(session.pricePerKwh),
    parseNum(session.totalCost),
    String(session.location || "Bayrhofs"),
    Boolean(session.pvSurplus),
    String(session.notes || ""),
    new Date().toISOString()
  ];

  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        sheet.getRange(i + 2, 1, 1, HEADERS.length).setValues([rowData]);
        return;
      }
    }
  }

  sheet.appendRow(rowData);
}

/**
 * Löscht eine Zeile anhand der ID
 */
function deleteSessionRow(sheet, targetId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(targetId)) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

/**
 * Hilfsfunktion: Wandelt Zahlen sicher um (auch mit deutschem Komma)
 */
function parseNum(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const cleaned = String(val).replace(",", ".").replace(/[^0-9.-]/g, "");
  return Number(cleaned) || 0;
}

/**
 * Erstellt die HTTP-Rückgabe (JSON oder JSONP)
 */
function createOutput(data, callback) {
  const jsonStr = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + jsonStr + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}
