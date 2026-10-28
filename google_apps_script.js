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
 * Holt oder erstellt das Tabellenblatt "Vehicle_Config" für Fahrzeugspezifikationen & THG
 */
function getVehicleConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Vehicle_Config");
  if (!sheet) {
    sheet = ss.insertSheet("Vehicle_Config");
    const headers = ["Parameter", "Wert", "Beschreibung", "Aktualisiert"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
    sheet.setFrozenRows(1);
    try {
      sheet.setColumnWidth(1, 170);
      sheet.setColumnWidth(2, 190);
      sheet.setColumnWidth(3, 270);
      sheet.setColumnWidth(4, 210);
    } catch (eW) {}
  }
  return sheet;
}

/**
 * Speichert Fahrzeug- und THG-Konfiguration in "Vehicle_Config"
 */
function saveVehicleConfigToSheet(config) {
  if (!config || typeof config !== "object") return;
  const sheet = getVehicleConfigSheet();
  const now = new Date().toISOString();

  const defs = [
    { key: "model", label: "Fahrzeugmodell", desc: "Modellbezeichnung", val: config.model || "" },
    { key: "batteryKwh", label: "Batteriekapazität (kWh)", desc: "Nettokapazität Akku", val: config.batteryKwh !== undefined ? config.batteryKwh : 52.0 },
    { key: "powerPs", label: "Leistung (PS)", desc: "Motorleistung in PS", val: config.powerPs !== undefined ? config.powerPs : 211 },
    { key: "currentOdo", label: "Aktueller km-Stand", desc: "Zuletzt erfasster Gesamtkilometerstand", val: config.currentOdo !== undefined ? config.currentOdo : 0 },
    { key: "currentSoc", label: "Aktueller SoC (%)", desc: "Zuletzt gemeldeter Batteriestand", val: config.currentSoc !== undefined ? config.currentSoc : "" },
    { key: "startOdo", label: "Start km-Stand", desc: "Kilometerstand bei Übernahme/Zulassung", val: config.startOdo !== undefined ? config.startOdo : 9 },
    { key: "thgYear", label: "THG Quote Jahr", desc: "Aktuelles Berechnungsjahr der THG-Quote", val: config.thgYear !== undefined ? config.thgYear : new Date().getFullYear() },
    { key: "thgAmount", label: "THG Quote Betrag (€)", desc: "Jahresprämie THG-Gutschrift", val: config.thgAmount !== undefined ? config.thgAmount : 110.00 },
    { key: "thgActive", label: "THG Quote Aktiv", desc: "Wird die THG-Quote mit Ladekosten gegengerechnet?", val: config.thgActive === true || config.thgActive === "true" ? "Ja" : "Nein" },
    { key: "thgStatus", label: "THG Status", desc: "Status der THG-Prämie (active/inactive)", val: config.thgStatus || "active" }
  ];

  // THG Quote Einträge pro Jahr speichern (z. B. thg_2025, thg_2026)
  if (config.thgByYear && typeof config.thgByYear === "object") {
    Object.keys(config.thgByYear).forEach(function(yr) {
      const item = config.thgByYear[yr];
      const amt = typeof item === "object" ? item.amount : Number(item);
      const isAct = typeof item === "object" ? (item.active !== false && item.status !== "inactive") : true;
      if (amt !== undefined && !isNaN(Number(amt))) {
        defs.push({
          key: "thg_" + yr,
          label: "THG Quote " + yr + " Betrag (€)",
          desc: "Jahresprämie THG-Gutschrift für " + yr,
          val: Number(amt)
        });
        defs.push({
          key: "thg_active_" + yr,
          label: "THG Quote " + yr + " Aktiv",
          desc: "Wird die THG-Quote für " + yr + " gegengerechnet?",
          val: isAct ? "Ja" : "Nein"
        });
      }
    });
  }

  const lastRow = sheet.getLastRow();
  const existingMap = {};
  if (lastRow > 1) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i][0]).trim();
      if (k) existingMap[k] = i + 2;
    }
  }

  defs.forEach(function(d) {
    const targetRow = existingMap[d.key] || existingMap[d.label];
    if (targetRow) {
      sheet.getRange(targetRow, 2).setValue(d.val);
      sheet.getRange(targetRow, 3).setValue(d.desc);
      sheet.getRange(targetRow, 4).setValue(now);
    } else {
      sheet.appendRow([d.key, d.val, d.desc, now]);
      existingMap[d.key] = sheet.getLastRow();
    }
  });
}

/**
 * Liest gespeicherte Fahrzeug- und THG-Konfiguration aus "Vehicle_Config"
 */
function getVehicleConfigFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Vehicle_Config");
  if (!sheet || sheet.getLastRow() <= 1) {
    return null;
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const config = { thgByYear: {} };
  for (let i = 0; i < rows.length; i++) {
    const key = String(rows[i][0] || "").trim();
    const val = rows[i][1];
    if (!key) continue;

    // THG Betrag pro Jahr erkennen (z. B. thg_2026 oder "THG Quote 2026 Betrag (€)")
    const thgYearMatch = key.match(/^thg_(\d{4})$/i) || key.match(/THG Quote (\d{4}) Betrag/i);
    if (thgYearMatch) {
      const yr = thgYearMatch[1];
      if (!config.thgByYear[yr]) config.thgByYear[yr] = {};
      config.thgByYear[yr].amount = parseNum(val);
      config.thgByYear[yr].year = parseInt(yr, 10);
    }

    // THG Status pro Jahr erkennen
    const thgActiveMatch = key.match(/^thg_active_(\d{4})$/i) || key.match(/THG Quote (\d{4}) Aktiv/i);
    if (thgActiveMatch) {
      const yr = thgActiveMatch[1];
      if (!config.thgByYear[yr]) config.thgByYear[yr] = {};
      config.thgByYear[yr].active = (val === true || String(val).toLowerCase() === "ja" || String(val).toLowerCase() === "true");
      config.thgByYear[yr].status = config.thgByYear[yr].active ? "active" : "inactive";
    }

    if (key === "model" || key === "Fahrzeugmodell") config.model = String(val);
    else if (key === "batteryKwh" || key.indexOf("Batteriekapazität") !== -1) config.batteryKwh = parseNum(val);
    else if (key === "powerPs" || key.indexOf("Leistung") !== -1) config.powerPs = parseNum(val);
    else if (key === "currentOdo" || key.indexOf("Aktueller km-Stand") !== -1) config.currentOdo = parseNum(val);
    else if (key === "currentSoc" || key.indexOf("Aktueller SoC") !== -1) config.currentSoc = (val !== "" && val !== null && val !== undefined) ? parseNum(val) : "";
    else if (key === "startOdo" || key.indexOf("Start km-Stand") !== -1) config.startOdo = parseNum(val);
    else if (key === "thgYear" || key.indexOf("THG Quote Jahr") !== -1) config.thgYear = parseNum(val);
    else if (key === "thgAmount" || key.indexOf("THG Quote Betrag") !== -1) config.thgAmount = parseNum(val);
    else if (key === "thgActive" || key.indexOf("THG Quote Aktiv") !== -1) config.thgActive = (val === true || String(val).toLowerCase() === "ja" || String(val).toLowerCase() === "true");
    else if (key === "thgStatus" || key.indexOf("THG Status") !== -1) config.thgStatus = String(val);
  }

  // Rückwärtskompatibilität: Falls thgYear & thgAmount gesetzt sind, im thgByYear eintragen
  if (config.thgYear && config.thgAmount !== undefined) {
    const yrStr = String(config.thgYear);
    if (!config.thgByYear[yrStr]) config.thgByYear[yrStr] = {};
    if (config.thgByYear[yrStr].amount === undefined) config.thgByYear[yrStr].amount = config.thgAmount;
    if (config.thgByYear[yrStr].active === undefined) config.thgByYear[yrStr].active = config.thgActive;
    config.thgByYear[yrStr].year = config.thgYear;
  }

  return config;
}

/**
 * Liest die vorhandenen Spaltenüberschriften aus Zeile 1
 * und baut eine dynamische Spalten-Zuordnungs-Map auf.
 */
function getHeaderColumnMap(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 14);
  let headers = [];
  
  if (sheet.getLastRow() >= 1) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  // Falls Zeile 1 noch völlig leer ist, Standard-Köpfe schreiben
  if (!headers || headers.every(h => !h || String(h).trim() === "")) {
    const defaultHeaders = [
      "ID", "Datum", "Ort", "kWh", "Preis (€/kWh)", "Gesamtkosten (€)", "PV-Ladung", "Notiz",
      "km-Stand", "Akkustand Start (%)", "Akkustand Ende (%)", "Gefahrene km", "Verbrauch (kWh/100km)", "Wirkungsgrad (%)", "Bezahlt"
    ];
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
    deltaKm: -1,
    consumption: -1,
    efficiency: -1,
    paid: -1,
    status: -1,
    updatedAt: -1,
    rawHeaders: headers
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").toLowerCase().trim();
    if (h === "id" || h.includes("kennung") || h.includes("vorgang") || h.includes("session")) {
      map.id = i;
    } else if (h.includes("datum") || h.includes("date") || h.includes("zeit")) {
      map.date = i;
    } else if (h.includes("ort") || h.includes("standort") || h.includes("location")) {
      map.location = i;
    } else if (h.includes("gesamtkosten") || (h.includes("kosten") && !h.includes("preis")) || h.includes("total")) {
      map.totalCost = i;
    } else if (h.includes("preis") || h.includes("price") || h.includes("cent")) {
      map.pricePerKwh = i;
    } else if (h.includes("verbrauch") || h.includes("consumption")) {
      map.consumption = i;
    } else if (h.includes("wirkungsgrad") || h.includes("effizienz") || h.includes("efficiency")) {
      map.efficiency = i;
    } else if (h.includes("delta") || h.includes("gefahren") || h.includes("strecke") || h.includes("distanz")) {
      map.deltaKm = i;
    } else if (h.includes("socstart") || h.includes("startsoc") || (h.includes("akku") && h.includes("start")) || (h.includes("start") && h.includes("%"))) {
      map.socStart = i;
    } else if (h.includes("soc") || (h.includes("akku") && (h.includes("ende") || h.includes("stand") || !h.includes("start"))) || h.includes("batterieladestand")) {
      map.soc = i;
    } else if (h === "kwh" || ((h.includes("kwh") || h.includes("menge") || h.includes("energie") || h.includes("lademenge")) && !h.includes("verbrauch") && !h.includes("preis") && !h.includes("kosten") && !h.includes("100km"))) {
      map.kwh = i;
    } else if (h.includes("pv") || h.includes("solar") || h.includes("sonne")) {
      map.pvSurplus = i;
    } else if (h.includes("notiz") || h.includes("note") || h.includes("bemerkung")) {
      map.notes = i;
    } else if ((h.includes("km") && !h.includes("gefahren") && !h.includes("delta") && !h.includes("verbrauch")) || h.includes("odo") || h.includes("kilometer")) {
      map.odometer = i;
    } else if (h.includes("bezahlt") || h.includes("zahlung") || h.includes("paid") || h.includes("zahlungsstatus")) {
      map.paid = i;
    } else if (h.includes("erfassung") || h.includes("vollständig") || h.includes("vollstaendig") || h === "status") {
      map.status = i;
    } else if (h.includes("updated") || h.includes("aktualisiert")) {
      map.updatedAt = i;
    }
  }

  // Falls noch keine Status-Spalte vorhanden ist, legen wir diese automatisch in Zeile 1 an
  if (map.status < 0 && sheet.getLastRow() >= 1) {
    const targetCol = Math.max(headers.length + 1, 15);
    sheet.getRange(1, targetCol).setValue("Status").setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
    headers[targetCol - 1] = "Status";
    map.status = targetCol - 1;
    map.rawHeaders = headers;
  }

  // Standard-Fallback: Spalte 1 (Index 0) ist die ID-Spalte
  if (map.id < 0) map.id = 0;

  // ZWINGENDE ISOLATION: colMap.kwh darf NIEMALS gleich colMap.consumption sein!
  // Spalte D ("kWh") MUSS eindeutig colMap.kwh sein.
  if (map.kwh < 0 || map.kwh === map.consumption) {
    let exactKwhIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      const hText = String(headers[i] || "").toLowerCase().trim();
      if (hText === "kwh" || hText === "kwh geladen" || hText === "geladen (kwh)" || hText === "lademenge (kwh)") {
        exactKwhIdx = i;
        break;
      }
    }
    map.kwh = exactKwhIdx >= 0 ? exactKwhIdx : (headers.length > 3 ? 3 : -1);
  }

  // Verbrauch (Spalte M) separat absichern
  if (map.consumption === map.kwh) {
    map.consumption = -1;
    for (let i = 0; i < headers.length; i++) {
      const hText = String(headers[i] || "").toLowerCase().trim();
      if (hText.includes("verbrauch") || hText.includes("consumption")) {
        map.consumption = i;
        break;
      }
    }
  }

  // Auto-Upgrade bestehender Tabellen: Fehlen km-Stand, Akkustand oder Bezahlt-Spalten, automatisch anfügen
  if (sheet.getLastRow() >= 1 && (map.odometer < 0 || map.socStart < 0 || map.soc < 0 || map.paid < 0)) {
    let curCols = sheet.getLastColumn();
    if (map.odometer < 0) {
      curCols++;
      sheet.getRange(1, curCols).setValue("km-Stand").setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
      map.odometer = curCols - 1;
      headers.push("km-Stand");
    }
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
    if (map.paid < 0) {
      curCols++;
      sheet.getRange(1, curCols).setValue("Bezahlt").setFontWeight("bold").setBackground("#1a2332").setFontColor("#c08051");
      map.paid = curCols - 1;
      headers.push("Bezahlt");
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
        hasVehicleConfig: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Vehicle_Config"),
        timestamp: new Date().toISOString()
      };
      return createOutput(pingResult, callback);
    }

    // 2. Fahrzeug-Konfiguration & THG abrufen
    if (action === "get_config" || action === "get_vehicle") {
      const cfg = getVehicleConfigFromSheet();
      return createOutput({ status: "success", action: "get_config", config: cfg }, callback);
    }

    // 3. Einzelnes Ereignis löschen (pro Ereignis, niemals alle Daten!)
    if (action === "delete") {
      const targetId = e && e.parameter ? (e.parameter.id || e.parameter.ID) : null;
      let count = 0;
      if (targetId) {
        count = deleteSessionById(sheet, colMap, targetId);
      }
      return createOutput({ status: "success", action: "delete", id: targetId, deleted: count }, callback);
    }

    // 4. Dummy-Zeilen (0 kWh) bereinigen
    if (action === "cleanup") {
      const count = cleanDummyRows(sheet, colMap);
      return createOutput({ status: "success", action: "cleanup", cleaned: count }, callback);
    }

    // 5. Ladedaten liefern
    const lastRow = sheet.getLastRow();
    const sessions = [];

    if (lastRow > 1) {
      const values = sheet.getRange(2, 1, lastRow - 1, colMap.rawHeaders.length).getValues();
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const idVal = colMap.id >= 0 ? row[colMap.id] : row[0];
        const dateVal = colMap.date >= 0 ? row[colMap.date] : row[1];
        if (!idVal && !dateVal) continue; // Leere Zeile überspringen

        let kwhVal = colMap.kwh >= 0 ? parseNum(row[colMap.kwh]) : 0;
        let consVal = colMap.consumption >= 0 ? parseNum(row[colMap.consumption]) : null;

        // Auto-Heal: Falls Spalte D (kWh) 0 oder leer ist, aber Spalte M fälschlicherweise den Wert enthält (z. B. 30):
        if (kwhVal <= 0 && consVal > 0 && colMap.kwh >= 0) {
          kwhVal = consVal;
          consVal = null;
          try {
            sheet.getRange(i + 2, colMap.kwh + 1).setValue(kwhVal);
            if (colMap.consumption >= 0) {
              sheet.getRange(i + 2, colMap.consumption + 1).setValue("");
            }
          } catch (eFix) {}
        }

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
        const deltaKmVal = colMap.deltaKm >= 0 ? parseNum(row[colMap.deltaKm]) : null;
        const effVal = colMap.efficiency >= 0 ? parseNum(row[colMap.efficiency]) : null;

        const isBayrhof = locVal.toLowerCase().indexOf("bayrhof") !== -1;
        let paidVal = true;
        if (colMap.paid >= 0) {
          const rawPaid = row[colMap.paid];
          if (rawPaid !== "" && rawPaid !== null && rawPaid !== undefined) {
            const sPaid = String(rawPaid).toLowerCase().trim();
            paidVal = (sPaid === "ja" || sPaid === "true" || sPaid === "1" || sPaid.indexOf("bezahlt") !== -1);
          } else {
            // Nur Bayrhofs wird summenabgerechnet (Default: offen), alles andere immer direkt bezahlt (true)
            paidVal = !isBayrhof;
          }
        } else {
          paidVal = !isBayrhof;
        }

        // Nur völlig leere Dummy-Zeilen ohne jegliche Daten oder ID überspringen
        const hasAnyData = Boolean(
          (idVal && String(idVal).trim() !== "") ||
          (dateVal && String(dateVal).trim() !== "") ||
          kwhVal > 0 ||
          odoVal > 0 ||
          (notesVal && String(notesVal).trim() !== "") ||
          (socVal !== null) ||
          (socStartVal !== null) ||
          priceVal > 0 ||
          totalVal > 0
        );
        if (!hasAnyData) {
          continue;
        }

        const rawStatus = (colMap.status >= 0 && row[colMap.status]) ? String(row[colMap.status]).trim() : null;
        const isComplete = rawStatus ? (rawStatus.indexOf("Vollständig") !== -1 && rawStatus.indexOf("Unvollständig") === -1) : Boolean(kwhVal > 0 && odoVal > 0 && totalVal > 0 && socVal !== null);

        sessions.push({
          id: String(idVal || ("ses_cloud_" + i)),
          ID: String(idVal || ("ses_cloud_" + i)),
          date: dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || new Date().toISOString()),
          Datum: dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || new Date().toISOString()),
          location: locVal,
          Ort: locVal,
          kwh: kwhVal,
          kWh: kwhVal,
          status: rawStatus || (isComplete ? "✓ Vollständig" : "⏳ Unvollständig"),
          Status: rawStatus || (isComplete ? "✓ Vollständig" : "⏳ Unvollständig"),
          isComplete: isComplete,
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
          "Akkustand Start (%)": socStartVal,
          deltaKm: deltaKmVal,
          "Gefahrene km": deltaKmVal,
          consumption: consVal,
          "Verbrauch (kWh/100km)": consVal,
          efficiency: effVal,
          "Wirkungsgrad (%)": effVal,
          paid: paidVal,
          bezahlt: paidVal,
          Bezahlt: paidVal ? (isBayrhof ? "Ja" : "Ja (Direkt)") : "Nein",
          "Zahlungsstatus": paidVal ? "Bezahlt" : "Offen"
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

    // AKTION: Fahrzeug-Konfiguration & THG speichern in Tabellenblatt "Vehicle_Config"
    if (action === "save_config" || action === "save_vehicle") {
      const cfg = payload.config || payload.vehicle || payload;
      saveVehicleConfigToSheet(cfg);
      return createOutput({ status: "success", action: "save_config", timestamp: new Date().toISOString() });
    }

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

    // AKTION: Zahlungsstatus aktualisieren (z.B. für Bayrhofs Sammelabrechnung)
    if (action === "mark_paid" || action === "update_payment") {
      const targetIds = Array.isArray(payload.ids) ? payload.ids.map(String) : (payload.id ? [String(payload.id)] : []);
      const paidState = payload.paid !== undefined ? (payload.paid === true || payload.paid === "true" || payload.paid === "Ja") : true;
      let updatedCount = 0;
      if (targetIds.length > 0 && colMap.paid >= 0 && sheet.getLastRow() > 1) {
        const numRows = sheet.getLastRow() - 1;
        const idColIdx = colMap.id >= 0 ? colMap.id + 1 : 1;
        const ids = sheet.getRange(2, idColIdx, numRows, 1).getValues();
        for (let r = 0; r < ids.length; r++) {
          const rowId = String(ids[r][0] || "").trim();
          if (targetIds.includes(rowId)) {
            sheet.getRange(r + 2, colMap.paid + 1).setValue(paidState ? "Ja" : "Nein");
            updatedCount++;
          }
        }
      }
      return createOutput({ status: "success", action: "mark_paid", count: updatedCount, ids: targetIds });
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

  const rawKwh = s.kwh !== undefined ? s.kwh : (s.kWh !== undefined ? s.kWh : (s.energie !== undefined ? s.energie : s.lademenge));
  const hasRawKwh = rawKwh !== undefined && rawKwh !== null && String(rawKwh).trim() !== "";
  const kwhNum = hasRawKwh ? parseNum(rawKwh) : 0;

  const rawPrice = s.preis !== undefined ? s.preis : (s.Preis !== undefined ? s.Preis : (s.pricePerKwh !== undefined ? s.pricePerKwh : (s.price !== undefined ? s.price : s["Preis (€/kWh)"])));
  const hasRawPrice = rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== "";
  const priceNum = hasRawPrice ? parseNum(rawPrice) : 0;

  const rawCost = s.kosten !== undefined ? s.kosten : (s.Kosten !== undefined ? s.Kosten : (s.totalCost !== undefined ? s.totalCost : (s.gesamtkosten !== undefined ? s.gesamtkosten : (s.Gesamtkosten !== undefined ? s.Gesamtkosten : s["Gesamtkosten (€)"]))));
  const hasRawCost = rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== "";
  const costNum = hasRawCost ? parseNum(rawCost) : ((hasRawKwh && hasRawPrice) ? Number((kwhNum * priceNum).toFixed(2)) : 0);

  const rawOdo = s.odometer !== undefined ? s.odometer : (s["km-Stand"] !== undefined ? s["km-Stand"] : (s.km !== undefined ? s.km : (s.kmStand !== undefined ? s.kmStand : s.kilometer)));
  const hasRawOdo = rawOdo !== undefined && rawOdo !== null && String(rawOdo).trim() !== "";
  const odoNum = hasRawOdo ? parseNum(rawOdo) : 0;

  const rawSoc = s.soc !== undefined ? s.soc : (s.SoC !== undefined ? s.SoC : (s.socEnd !== undefined ? s.socEnd : (s["Akkustand Ende (%)"] !== undefined ? s["Akkustand Ende (%)"] : null)));
  const hasRawSoc = (rawSoc !== null && rawSoc !== undefined && String(rawSoc).trim() !== "");
  const socNum = hasRawSoc ? parseNum(rawSoc) : null;

  const rawSocStart = s.socStart !== undefined ? s.socStart : (s.SoCStart !== undefined ? s.SoCStart : (s.startSoc !== undefined ? s.startSoc : (s["Akkustand Start (%)"] !== undefined ? s["Akkustand Start (%)"] : null)));
  const hasRawSocStart = (rawSocStart !== null && rawSocStart !== undefined && String(rawSocStart).trim() !== "");
  const socStartNum = hasRawSocStart ? parseNum(rawSocStart) : null;

  const notesStr = String(s.notiz || s.Notiz || s.notes || s.note || s.bemerkung || "");
  const id = String(s.id || s.ID || ("session_" + Date.now()));
  const dateStr = s.date || s.Datum || s.datum || s.timestamp || new Date().toISOString();

  // WICHTIG: Nur völlig leere Dummy-Einträge ohne jegliche ID oder Daten verwerfen
  const hasAnyData = Boolean(
    (s.id || s.ID) ||
    (hasRawKwh && kwhNum > 0) ||
    (hasRawOdo && odoNum > 0) ||
    hasRawSoc ||
    hasRawSocStart ||
    hasRawPrice ||
    hasRawCost ||
    notesStr.trim() !== ""
  );
  if (!hasAnyData) {
    return;
  }

  // Vollständigkeit prüfen:
  // Alle Felder optional! Nicht vollständig erfasste Ladungen dezent kennzeichnen:
  const isComplete = Boolean(
    (hasRawKwh && kwhNum > 0) &&
    (hasRawOdo && odoNum > 0) &&
    (hasRawCost || hasRawPrice) &&
    (hasRawSoc && socNum !== null && !isNaN(socNum))
  );
  const statusStr = isComplete ? "✓ Vollständig" : "⏳ Unvollständig";

  const lastRow = sheet.getLastRow();
  const numCols = colMap.rawHeaders.length;
  const rowData = new Array(numCols).fill("");

  const locStr = typeof s.location === 'object' 
    ? (s.location.name || 'Bayrhofs') 
    : String(s.ort || s.Ort || s.location || s.Location || s.standort || s.Standort || "Bayrhofs");

  const rawPv = s.pvSurplus !== undefined ? s.pvSurplus : (s.pv !== undefined ? s.pv : (s.pv_ladung !== undefined ? s.pv_ladung : s["PV-Ladung"]));
  const isPv = rawPv === true || rawPv === "true" || String(rawPv).toLowerCase() === "ja";

  // Zahlungsstatus bestimmen:
  const isBayrhof = locStr.toLowerCase().indexOf("bayrhof") !== -1;
  let isPaid = true;
  if (isBayrhof) {
    const rawPaid = s.paid !== undefined ? s.paid : (s.Bezahlt !== undefined ? s.Bezahlt : (s.bezahlt !== undefined ? s.bezahlt : false));
    isPaid = (rawPaid === true || rawPaid === "true" || String(rawPaid).toLowerCase() === "ja" || String(rawPaid).toLowerCase().indexOf("bezahlt") !== -1);
  } else {
    isPaid = true; // Andere Standorte sind immer direkt bezahlt
  }

  // Werte in die passenden Spalten schreiben (nicht erfasste Felder bleiben sauber "")
  if (colMap.id >= 0) rowData[colMap.id] = id;
  if (colMap.date >= 0) rowData[colMap.date] = dateStr;
  if (colMap.location >= 0) rowData[colMap.location] = locStr;
  if (colMap.kwh >= 0) rowData[colMap.kwh] = (hasRawKwh && kwhNum > 0) ? kwhNum : "";
  if (colMap.pricePerKwh >= 0) rowData[colMap.pricePerKwh] = (hasRawPrice && priceNum > 0) ? priceNum : "";
  if (colMap.totalCost >= 0) rowData[colMap.totalCost] = (hasRawCost || (hasRawKwh && hasRawPrice)) ? costNum : "";
  if (colMap.pvSurplus >= 0) rowData[colMap.pvSurplus] = isPv ? "Ja" : "Nein";
  if (colMap.notes >= 0) rowData[colMap.notes] = notesStr;
  if (colMap.odometer >= 0) rowData[colMap.odometer] = (hasRawOdo && odoNum > 0) ? odoNum : "";
  if (colMap.paid >= 0) rowData[colMap.paid] = isPaid ? (isBayrhof ? "Ja" : "Ja (Direkt)") : "Nein";

  if (colMap.socStart >= 0) rowData[colMap.socStart] = (socStartNum !== null && !isNaN(socStartNum)) ? socStartNum : "";
  if (colMap.soc >= 0) rowData[colMap.soc] = (socNum !== null && !isNaN(socNum)) ? socNum : "";
  if (colMap.deltaKm >= 0) {
    const dVal = parseNum(s.deltaKm || s["Gefahrene km"]);
    rowData[colMap.deltaKm] = (!isNaN(dVal) && dVal > 0) ? dVal : "";
  }
  if (colMap.consumption >= 0) {
    const cVal = parseNum(s.consumption || s["Verbrauch (kWh/100km)"]);
    rowData[colMap.consumption] = (!isNaN(cVal) && cVal > 0 && cVal !== kwhNum) ? cVal : "";
  }
  if (colMap.efficiency >= 0) {
    const eVal = parseNum(s.efficiency || s["Wirkungsgrad (%)"]);
    rowData[colMap.efficiency] = (!isNaN(eVal) && eVal > 0) ? eVal : "";
  }
  if (colMap.status >= 0) rowData[colMap.status] = statusStr;
  if (colMap.updatedAt >= 0) rowData[colMap.updatedAt] = new Date().toISOString();

  // Prüfen, ob ID bereits in der Tabelle existiert -> dann Update
  let targetRowIndex = -1;
  if (lastRow > 1) {
    const colIdx = colMap.id >= 0 ? colMap.id + 1 : 1;
    const ids = sheet.getRange(2, colIdx, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id.trim()) {
        targetRowIndex = i + 2;
        sheet.getRange(targetRowIndex, 1, 1, numCols).setValues([rowData]);
        break;
      }
    }
  }

  // Ansonsten neue Zeile anhängen
  if (targetRowIndex < 0) {
    sheet.appendRow(rowData);
    targetRowIndex = sheet.getLastRow();
  }

  // Dezent kennzeichnen: Unvollständige Ladungen erhalten eine dezente warme Pastelltönung (#fffbeb),
  // vollständige Ladungen den regulären neutralen Hintergrund (#ffffff).
  try {
    const rowRange = sheet.getRange(targetRowIndex, 1, 1, numCols);
    if (!isComplete) {
      rowRange.setBackground("#fffbeb");
    } else {
      rowRange.setBackground("#ffffff");
    }
  } catch (eColor) {}
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
 * Bereinigt fehlerhafte Dummy-Zeilen, die keinerlei ID oder Daten aufweisen
 */
function cleanDummyRows(sheet, colMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const numCols = Math.max(colMap.rawHeaders.length, sheet.getLastColumn(), 8);
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  let cleanedCount = 0;

  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const id = colMap.id >= 0 ? String(row[colMap.id] || "").trim() : "";
    const kwh = colMap.kwh >= 0 ? parseNum(row[colMap.kwh]) : 0;
    const price = colMap.pricePerKwh >= 0 ? parseNum(row[colMap.pricePerKwh]) : 0;
    const cost = colMap.totalCost >= 0 ? parseNum(row[colMap.totalCost]) : 0;
    const odo = colMap.odometer >= 0 ? parseNum(row[colMap.odometer]) : 0;
    const notes = colMap.notes >= 0 ? String(row[colMap.notes] || "").trim() : "";
    const soc = colMap.soc >= 0 ? row[colMap.soc] : null;

    // Nur Zeilen löschen, die keinerlei ID, kWh, km-Stand, Preis, Kosten, Notizen oder SoC besitzen
    const hasAnyData = Boolean(id || kwh > 0 || price > 0 || cost > 0 || odo > 0 || notes || (soc !== null && String(soc).trim() !== ""));
    if (!hasAnyData) {
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
