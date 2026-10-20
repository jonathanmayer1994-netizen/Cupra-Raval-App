/**
 * ============================================================================
 * CUPRA RAVAL ENDURANCE — GOOGLE APPS SCRIPT BACKEND (SMART AUTO-MAPPER)
 * Passt sich dynamisch an dein Tabellenblatt "Raval_App_DB" an!
 * ============================================================================
 * 
 * Unterstützt exakt dein Tabellen-Layout:
 * ID | Datum | Ort | kWh | Preis (€/kWh) | Gesamtkosten (€) | PV-Ladung | Notiz
 * sowie beliebige andere Spaltenanordnungen!
 */

/**
 * Holt das Ziel-Tabellenblatt (bevorzugt "Raval_App_DB", sonst "Ladedaten")
 */
function getTargetSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName("Raval_App_DB") 
      || ss.getSheetByName("Ladedaten") 
      || ss.getActiveSheet() 
      || ss.getSheets()[0];
}

/**
 * Liest die vorhandenen Spaltenüberschriften aus Zeile 1
 * und baut eine dynamische Spalten-Zuordnungs-Map auf.
 */
function getHeaderColumnMap(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 8);
  let headers = [];
  
  if (sheet.getLastRow() >= 1) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  // Falls Zeile 1 noch völlig leer ist, Standard-Köpfe schreiben
  if (!headers || headers.every(h => !h || String(h).trim() === "")) {
    const defaultHeaders = ["ID", "Datum", "Ort", "kWh", "Preis (€/kWh)", "Gesamtkosten (€)", "PV-Ladung", "Notiz", "km-Stand", "Akkustand Start (%)", "Akkustand Ende (%)"];
    sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    sheet.getRange(1, 1, 1, defaultHeaders.length).setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
    sheet.setFrozenRows(1);
    headers = defaultHeaders;
  }

  // Header-Index-Mapper (0-basiert)
  const map = {
    id: -1,
    date: -1,
    location: -1,
    kwh: -1,
    pricePerKwh: -1,
    totalCost: -1,
    pvSurplus: -1,
    notes: -1,
    odometer: -1,
    socStart: -1,
    soc: -1,
    updatedAt: -1,
    rawHeaders: headers
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").toLowerCase().trim();
    if (h === "id" || h.includes("kennung") || h.includes("vorgang") || h.includes("session")) map.id = i;
    else if (h.includes("datum") || h.includes("date") || h.includes("zeit")) map.date = i;
    else if (h.includes("ort") || h.includes("standort") || h.includes("location")) map.location = i;
    else if (h.includes("gesamtkosten") || (h.includes("kosten") && !h.includes("kwh")) || h.includes("total")) map.totalCost = i;
    else if (h.includes("preis") || h.includes("price") || h.includes("cent")) map.pricePerKwh = i;
    else if (h.includes("kwh") || h.includes("menge") || h.includes("energie") || h.includes("lademenge")) map.kwh = i;
    else if (h.includes("pv") || h.includes("solar") || h.includes("sonne")) map.pvSurplus = i;
    else if (h.includes("notiz") || h.includes("note") || h.includes("bemerkung")) map.notes = i;
    else if (h.includes("km") || h.includes("odo") || h.includes("kilometer")) map.odometer = i;
    else if (h.includes("socstart") || h.includes("startsoc") || (h.includes("akku") && h.includes("start")) || (h.includes("start") && h.includes("%"))) map.socStart = i;
    else if (h.includes("soc") || (h.includes("akku") && (h.includes("ende") || h.includes("stand") || !h.includes("start"))) || h.includes("batterieladestand")) map.soc = i;
    else if (h.includes("updated") || h.includes("stand")) map.updatedAt = i;
  }

  // Standard-Fallback: Spalte 1 (Index 0) ist die ID-Spalte
  if (map.id < 0) map.id = 0;

  // Auto-Upgrade bestehender Tabellen: Fehlen die Akkustand-Spalten, automatisch anfügen
  if (sheet.getLastRow() >= 1 && (map.socStart < 0 || map.soc < 0)) {
    let curCols = sheet.getLastColumn();
    if (map.socStart < 0) {
      curCols++;
      sheet.getRange(1, curCols).setValue("Akkustand Start (%)").setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
      map.socStart = curCols - 1;
      headers.push("Akkustand Start (%)");
    }
    if (map.soc < 0) {
      curCols++;
      sheet.getRange(1, curCols).setValue("Akkustand Ende (%)").setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
      map.soc = curCols - 1;
      headers.push("Akkustand Ende (%)");
    }
    map.rawHeaders = headers;
  }

  return map;
}

/**
 * GET-Handler: Liefert Ladedaten für die App, oder führt Aktionen (delete, ping, cleanup) aus.
 * Volle JSONP-Kompatibilität für iOS Safari PWAs.
 */
function doGet(e) {
  try {
    const sheet = getTargetSheet();
    const action = e && e.parameter ? e.parameter.action : null;
    const callback = e && e.parameter ? e.parameter.callback : null;
    const colMap = getHeaderColumnMap(sheet);

    // 1. Ping / Test-Endpunkt
    if (action === "ping") {
      const pingResult = {
        status: "success",
        message: "Cupra Raval Cloud API ist betriebsbereit!",
        sheetName: sheet.getName(),
        rows: Math.max(0, sheet.getLastRow() - 1),
        timestamp: new Date().toISOString()
      };
      return createOutput(pingResult, callback);
    }

    // 2. Einzelnes Ereignis löschen (pro Ereignis, niemals alle Daten!)
    if (action === "delete") {
      const targetId = e && e.parameter ? (e.parameter.id || e.parameter.ID) : null;
      let count = 0;
      if (targetId) {
        count = deleteSessionById(sheet, colMap, targetId);
      }
      return createOutput({ status: "success", action: "delete", id: targetId, deleted: count }, callback);
    }

    // 3. Dummy-Zeilen (0 kWh) bereinigen
    if (action === "cleanup") {
      const count = cleanDummyRows(sheet, colMap);
      return createOutput({ status: "success", action: "cleanup", cleaned: count }, callback);
    }

    // 4. Ladedaten liefern
    const lastRow = sheet.getLastRow();
    const sessions = [];

    if (lastRow > 1) {
      const values = sheet.getRange(2, 1, lastRow - 1, colMap.rawHeaders.length).getValues();
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const idVal = colMap.id >= 0 ? row[colMap.id] : row[0];
        const dateVal = colMap.date >= 0 ? row[colMap.date] : row[1];
        if (!idVal && !dateVal) continue; // Leere Zeile überspringen

        const kwhVal = colMap.kwh >= 0 ? parseNum(row[colMap.kwh]) : 0;
        const priceVal = colMap.pricePerKwh >= 0 ? parseNum(row[colMap.pricePerKwh]) : 0.35;
        const totalVal = colMap.totalCost >= 0 ? parseNum(row[colMap.totalCost]) : Number((kwhVal * priceVal).toFixed(2));
        const pvRaw = colMap.pvSurplus >= 0 ? row[colMap.pvSurplus] : false;
        const isPv = pvRaw === true || String(pvRaw).toLowerCase() === "true" || String(pvRaw).toLowerCase() === "ja";
        const locVal = colMap.location >= 0 ? String(row[colMap.location] || "Bayrhofs") : "Bayrhofs";
        const notesVal = colMap.notes >= 0 ? String(row[colMap.notes] || "") : "";
        const odoVal = colMap.odometer >= 0 ? parseNum(row[colMap.odometer]) : 0;
        const rawSoc = colMap.soc >= 0 ? row[colMap.soc] : null;
        const socVal = (rawSoc !== null && rawSoc !== undefined && String(rawSoc).trim() !== "") ? parseNum(rawSoc) : null;
        const rawSocStart = colMap.socStart >= 0 ? row[colMap.socStart] : null;
        const socStartVal = (rawSocStart !== null && rawSocStart !== undefined && String(rawSocStart).trim() !== "") ? parseNum(rawSocStart) : null;

        // Dummy-Zeilen mit 0 kWh überspringen
        if (kwhVal <= 0 && priceVal <= 0 && totalVal <= 0) {
          continue;
        }

        sessions.push({
          id: String(idVal || ("ses_cloud_" + i)),
          ID: String(idVal || ("ses_cloud_" + i)),
          date: dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || new Date().toISOString()),
          Datum: dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || new Date().toISOString()),
          location: locVal,
          Ort: locVal,
          kwh: kwhVal,
          kWh: kwhVal,
          pricePerKwh: priceVal,
          preis: priceVal,
          "Preis (€/kWh)": priceVal,
          totalCost: totalVal,
          kosten: totalVal,
          gesamtkosten: totalVal,
          "Gesamtkosten (€)": totalVal,
          pvSurplus: isPv,
          "PV-Ladung": isPv ? "Ja" : "Nein",
          notes: notesVal,
          notiz: notesVal,
          Notiz: notesVal,
          odometer: odoVal,
          "km-Stand": odoVal,
          soc: socVal,
          SoC: socVal,
          socEnd: socVal,
          "Akkustand Ende (%)": socVal,
          socStart: socStartVal,
          SoCStart: socStartVal,
          startSoc: socStartVal,
          "Akkustand Start (%)": socStartVal
        });
      }
    }

    // Sortierung nach Datum absteigend
    sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return createOutput(sessions, callback);
  } catch (err) {
    return createOutput({ status: "error", message: err.toString() }, e && e.parameter ? e.parameter.callback : null);
  }
}

/**
 * POST-Handler: Speichert, löscht oder aktualisiert Ladungen
 */
function doPost(e) {
  try {
    const sheet = getTargetSheet();
    let payload = {};

    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || (e && e.parameter && e.parameter.action) || "create";
    const colMap = getHeaderColumnMap(sheet);

    // AKTION: Löschen (Nur pro Ereignis, niemals alle Daten!)
    if (action === "delete") {
      const targetId = payload.id || payload.ID || (payload.session && (payload.session.id || payload.session.ID)) || (e && e.parameter && (e.parameter.id || e.parameter.ID));
      let count = 0;
      if (targetId) {
        count = deleteSessionById(sheet, colMap, targetId);
      }
      return createOutput({ status: "success", action: "delete", id: targetId, deleted: count });
    }

    // AKTION: Bereinigung unvollständiger Dummy-Zeilen
    if (action === "cleanup") {
      const count = cleanDummyRows(sheet, colMap);
      return createOutput({ status: "success", action: "cleanup", cleaned: count });
    }

    // AKTION: Bulk Sync (Array direkt oder in payload.sessions)
    if (action === "bulk_sync" || action === "bulk_upload" || Array.isArray(payload) || Array.isArray(payload.sessions)) {
      const list = Array.isArray(payload) ? payload : (Array.isArray(payload.sessions) ? payload.sessions : []);
      let savedCount = 0;
      for (let i = 0; i < list.length; i++) {
        upsertSessionWithMap(sheet, colMap, list[i]);
        savedCount++;
      }
      return createOutput({ status: "success", action: "bulk_sync", count: savedCount });
    }

    // AKTION: Einzelner Ladevorgang (Erstellen oder Aktualisieren)
    const session = payload.session || payload;
    upsertSessionWithMap(sheet, colMap, session);

    return createOutput({ status: "success", action: "save", id: session.id || session.ID });
  } catch (err) {
    return createOutput({ status: "error", message: err.toString() });
  }
}

/**
 * Fügt eine Zeile dynamisch anhand der Spalten-Zuordnung ein oder aktualisiert sie
 */
function upsertSessionWithMap(sheet, colMap, s) {
  if (!s) return;
  if (s.action === "delete" || s.action === "cleanup") return;

  const kwhNum = parseNum(s.kwh || s.kWh || s.energie || s.lademenge);
  const priceNum = parseNum(s.preis || s.Preis || s.pricePerKwh || s.price || s["Preis (€/kWh)"]);
  const costNum = parseNum(s.kosten || s.Kosten || s.totalCost || s.gesamtkosten || s.Gesamtkosten || s["Gesamtkosten (€)"]) || Number((kwhNum * priceNum).toFixed(2));

  // WICHTIG: Leere Dummy-Einträge ohne kWh, Preis und Kosten komplett ignorieren
  if (kwhNum <= 0 && priceNum <= 0 && costNum <= 0 && (!s.kwh && !s.kWh)) {
    return;
  }

  const lastRow = sheet.getLastRow();
  const numCols = colMap.rawHeaders.length;
  const rowData = new Array(numCols).fill("");

  const id = String(s.id || s.ID || ("session_" + Date.now()));
  const dateStr = s.date || s.Datum || s.datum || s.timestamp || new Date().toISOString();
  const locStr = typeof s.location === 'object' 
    ? (s.location.name || 'Bayrhofs') 
    : String(s.ort || s.Ort || s.location || s.Location || s.standort || s.Standort || "Bayrhofs");

  const rawPv = s.pvSurplus !== undefined ? s.pvSurplus : (s.pv !== undefined ? s.pv : (s.pv_ladung !== undefined ? s.pv_ladung : s["PV-Ladung"]));
  const isPv = rawPv === true || rawPv === "true" || String(rawPv).toLowerCase() === "ja";

  const notesStr = String(s.notiz || s.Notiz || s.notes || s.note || s.bemerkung || "");
  const odoNum = parseNum(s.odometer || s["km-Stand"] || s.km || s.kmStand || s.kilometer);

  // Werte in die passenden Spalten schreiben
  if (colMap.id >= 0) rowData[colMap.id] = id;
  if (colMap.date >= 0) rowData[colMap.date] = dateStr;
  if (colMap.location >= 0) rowData[colMap.location] = locStr;
  if (colMap.kwh >= 0) rowData[colMap.kwh] = kwhNum;
  if (colMap.pricePerKwh >= 0) rowData[colMap.pricePerKwh] = priceNum;
  if (colMap.totalCost >= 0) rowData[colMap.totalCost] = costNum;
  if (colMap.pvSurplus >= 0) rowData[colMap.pvSurplus] = isPv ? "Ja" : "Nein";
  if (colMap.notes >= 0) rowData[colMap.notes] = notesStr;
  if (colMap.odometer >= 0) rowData[colMap.odometer] = odoNum;

  const rawSoc = s.soc !== undefined ? s.soc : (s.SoC !== undefined ? s.SoC : (s.socEnd !== undefined ? s.socEnd : (s["Akkustand Ende (%)"] !== undefined ? s["Akkustand Ende (%)"] : null)));
  const socNum = (rawSoc !== null && rawSoc !== undefined && String(rawSoc).trim() !== "") ? parseNum(rawSoc) : null;
  const rawSocStart = s.socStart !== undefined ? s.socStart : (s.SoCStart !== undefined ? s.SoCStart : (s.startSoc !== undefined ? s.startSoc : (s["Akkustand Start (%)"] !== undefined ? s["Akkustand Start (%)"] : null)));
  const socStartNum = (rawSocStart !== null && rawSocStart !== undefined && String(rawSocStart).trim() !== "") ? parseNum(rawSocStart) : null;

  if (colMap.socStart >= 0) rowData[colMap.socStart] = (socStartNum !== null && !isNaN(socStartNum)) ? socStartNum : "";
  if (colMap.soc >= 0) rowData[colMap.soc] = (socNum !== null && !isNaN(socNum)) ? socNum : "";
  if (colMap.updatedAt >= 0) rowData[colMap.updatedAt] = new Date().toISOString();

  // Prüfen, ob ID bereits in der Tabelle existiert -> dann Update
  if (lastRow > 1) {
    const colIdx = colMap.id >= 0 ? colMap.id + 1 : 1;
    const ids = sheet.getRange(2, colIdx, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id.trim()) {
        sheet.getRange(i + 2, 1, 1, numCols).setValues([rowData]);
        return;
      }
    }
  }

  // Ansonsten neue Zeile anhängen
  sheet.appendRow(rowData);
}

/**
 * Löscht ein Ladeereignis anhand der ID — löscht nur exakt diese Zeile(n), NIEMALS alle Daten!
 * Rückwärts-Iteration stellt sicher, dass auch Dubletten sauber gelöscht werden, ohne Indexverschiebung.
 */
function deleteSessionById(sheet, colMap, targetId) {
  if (!targetId) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const numCols = Math.max(colMap.rawHeaders.length, sheet.getLastColumn(), 8);
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const target = String(targetId).trim();
  let deletedCount = 0;

  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const idInCol = colMap.id >= 0 ? String(row[colMap.id] || "").trim() : "";
    const idInFirstCol = String(row[0] || "").trim();

    if (idInCol === target || idInFirstCol === target) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return deletedCount;
}

/**
 * Bereinigt fehlerhafte Dummy-Zeilen mit 0 kWh, 0 Preis und 0 Kosten
 */
function cleanDummyRows(sheet, colMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const numCols = Math.max(colMap.rawHeaders.length, sheet.getLastColumn(), 8);
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  let cleanedCount = 0;

  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const kwh = colMap.kwh >= 0 ? parseNum(row[colMap.kwh]) : parseNum(row[3]);
    const price = colMap.pricePerKwh >= 0 ? parseNum(row[colMap.pricePerKwh]) : parseNum(row[4]);
    const cost = colMap.totalCost >= 0 ? parseNum(row[colMap.totalCost]) : parseNum(row[5]);

    if (kwh <= 0 && price <= 0 && cost <= 0) {
      sheet.deleteRow(i + 2);
      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * Zahlen sicher umwandeln (inkl. Kommazahlen)
 */
function parseNum(val) {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val).replace(",", ".").replace(/[^0-9.-]/g, "");
  return Number(cleaned) || 0;
}

/**
 * Gibt JSON oder JSONP zurück
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
