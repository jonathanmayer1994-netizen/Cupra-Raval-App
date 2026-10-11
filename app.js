/**
 * CUPRA RAVAL CHARGE — SWIFTUI LIQUID GLASS ENGINE V3
 * Modell: Cupra Raval Endurance Edition Dynamic
 * 4 Tabs + 1 Center FAB | Bayrhofs PV-Logik | Stündlicher Wettergraph | Apple Edit Mode
 */

(() => {
  'use strict';

  // =========================================================================
  // KONSTANTEN & DATENMODELL (SCHEMA V3)
  // =========================================================================
  const STORAGE_KEY = 'cupra_raval_data';
  const WEATHER_CACHE_KEY = 'cupra_weather_cache_v5';
  const CURRENT_SCHEMA = 3;
  const DEFAULT_GOOGLE_SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbw27RV9W5_1iLmnEd4eBBpcxd2eGLYau0W8X6-LXFzUDZ85DyzJIKz2TlAoi0QD8YGW/exec';
  const OLD_BLOCKED_URL = 'https://script.google.com/macros/s/AKfycbwlKhi7dukN5p3UDlM-6sxg72zVH9is2jKN1Wh8H0WCSeCAGmm7tjH0DxhIclf0k5Qv/exec';

  const DEFAULT_LOCATIONS = [
    { id: "loc_bayrhofs", name: "Bayrhofs", icon: "🏢", powerType: "pv", kwhPrice: 0.15 },
    { id: "loc_arbeit", name: "Arbeit", icon: "💼", powerType: "pv", kwhPrice: 0.20 },
    { id: "loc_zuhause", name: "Zuhause", icon: "🏠", powerType: "grid", kwhPrice: 0.32 },
    { id: "loc_oeffentlich", name: "Öffentlich", icon: "⚡️", powerType: "grid", kwhPrice: 0.59 }
  ];

  const DEFAULT_DATA = {
    schemaVersion: CURRENT_SCHEMA,
    lastUpdated: new Date().toISOString(),
    vehicle: {
      model: "Cupra Raval Endurance Edition Dynamic",
      batteryKwh: 52.0,
      powerPs: 211,
      currentOdo: 12450
    },
    settings: {
      currency: "€",
      locations: JSON.parse(JSON.stringify(DEFAULT_LOCATIONS)),
      googleSheetsUrl: DEFAULT_GOOGLE_SHEETS_API_URL,
      weatherGps: {
        name: "GPS: Bayrhofs / Kempten",
        lat: 47.72,
        lon: 10.31
      },
      pvThresholdSunshineHours: 4.5
    },
    sessions: [],
    pendingSyncQueue: []
  };

  const AVAILABLE_ICONS = ['🏢', '🏠', '⚡️', '☀️', '🔌', '💼', '🅿️', '🌲', '🚗', '🔋'];

  // State
  let appData = null;
  let activeTab = 'dashboard';
  let activeChargingSub = 'history';
  let activeSettingsSub = 'car';
  let activeChargingFilter = 'all';
  let activeAnalyticsPeriod = 'month';

  let weatherForecast14Days = null;
  let isWeatherExpanded = false;
  let isLocationsEditMode = false;
  let currentSyncState = 'synced';

  // Chart Instanzen
  let chartMain = null;
  let chartLocDonut = null;
  let chartSrcDonut = null;
  let chartHourly = null;

  // DOM Cache
  const DOM = {};

  // =========================================================================
  // INITIALISIERUNG
  // =========================================================================
  window.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    initStorage();
    initWeatherCache();
    setupEvents();
    renderAll();
    autoRequestGpsAndFetchWeather();
    fetchCloudSessions(false);
  });

  function cacheDom() {
    // Header & Cloud Sync
    DOM.appHeaderTitle = document.getElementById('appHeaderTitle');
    DOM.btnSyncCloud = document.getElementById('btnSyncCloud');
    DOM.syncStatusIcon = document.getElementById('syncStatusIcon');
    DOM.syncStatusText = document.getElementById('syncStatusText');
    DOM.btnManualCloudSync = document.getElementById('btnManualCloudSync');
    DOM.cloudSettingsIndicator = document.getElementById('cloudSettingsIndicator');
    DOM.cloudSettingsDot = document.getElementById('cloudSettingsDot');
    DOM.cloudSettingsLabel = document.getElementById('cloudSettingsLabel');
    DOM.cloudLastSyncTime = document.getElementById('cloudLastSyncTime');
    DOM.cloudDiagBox = document.getElementById('cloudDiagBox');
    DOM.cloudDiagIcon = document.getElementById('cloudDiagIcon');
    DOM.cloudDiagText = document.getElementById('cloudDiagText');
    DOM.btnTestCloudConnection = document.getElementById('btnTestCloudConnection');
    DOM.btnBulkUploadCloud = document.getElementById('btnBulkUploadCloud');
    DOM.inputCloudApiUrl = document.getElementById('inputCloudApiUrl');
    DOM.btnSaveCloudUrl = document.getElementById('btnSaveCloudUrl');
    DOM.btnResetCloudUrl = document.getElementById('btnResetCloudUrl');
    DOM.btnCopyScriptCode = document.getElementById('btnCopyScriptCode');
    DOM.btnCleanCloudSheet = document.getElementById('btnCleanCloudSheet');

    // Navigation Dock
    DOM.dockTabBtns = document.querySelectorAll('.dock-tab-btn');
    DOM.tabViews = document.querySelectorAll('.tab-view');
    DOM.fabAddCharge = document.getElementById('fabAddCharge');

    // Dashboard
    DOM.currentMonthYearTag = document.getElementById('currentMonthYearTag');
    DOM.dashMonthCost = document.getElementById('dashMonthCost');
    DOM.dashMonthKwh = document.getElementById('dashMonthKwh');
    DOM.dashYearCost = document.getElementById('dashYearCost');
    DOM.dashYearKwh = document.getElementById('dashYearKwh');
    DOM.dashMonthDistance = document.getElementById('dashMonthDistance');
    DOM.dashMonthDistanceSub = document.getElementById('dashMonthDistanceSub');
    DOM.dashYearDistance = document.getElementById('dashYearDistance');
    DOM.dashYearDistanceSub = document.getElementById('dashYearDistanceSub');
    DOM.dashAvgPrice = document.getElementById('dashAvgPrice');
    DOM.dashPvShareSub = document.getElementById('dashPvShareSub');
    DOM.dashAvgCons = document.getElementById('dashAvgCons');
    DOM.dashAvgCost100 = document.getElementById('dashAvgCost100');

    DOM.dashPvPreviewCard = document.getElementById('dashPvPreviewCard');
    DOM.dashPvIconCircle = document.getElementById('dashPvIconCircle');
    DOM.dashRecoHeadline = document.getElementById('dashRecoHeadline');
    DOM.dashRecoSubline = document.getElementById('dashRecoSubline');
    DOM.dashRecoBadge = document.getElementById('dashRecoBadge');

    DOM.cardCarModelName = document.getElementById('cardCarModelName');
    DOM.cardBatteryKwh = document.getElementById('cardBatteryKwh');
    DOM.cardPowerPs = document.getElementById('cardPowerPs');
    DOM.cardCurrentOdo = document.getElementById('cardCurrentOdo');
    DOM.dashboardLiveStatus = document.getElementById('dashboardLiveStatus');

    // Charging Tab
    DOM.chargingSegPickers = document.querySelectorAll('.picker-seg[data-sub]');
    DOM.chargingSubViews = document.querySelectorAll('.charging-sub-view');
    DOM.chargingFilterRail = document.getElementById('chargingFilterRail');
    DOM.chargesStreamContainer = document.getElementById('chargesStreamContainer');

    // Analytics
    DOM.periodPills = document.querySelectorAll('.period-pill');
    DOM.analyticsSubtitle = document.getElementById('analyticsSubtitle');
    DOM.canvasChargingChart = document.getElementById('canvasChargingChart');
    DOM.canvasLocationDonut = document.getElementById('canvasLocationDonut');
    DOM.canvasSourceDonut = document.getElementById('canvasSourceDonut');
    DOM.locationDonutLegend = document.getElementById('locationDonutLegend');
    DOM.sourceDonutLegend = document.getElementById('sourceDonutLegend');

    // Weather Tab
    DOM.weatherDisplayLocation = document.getElementById('weatherDisplayLocation');
    DOM.btnRefreshWeather = document.getElementById('btnRefreshWeather');
    DOM.pvSummaryRecommendationText = document.getElementById('pvSummaryRecommendationText');
    DOM.weatherPrimary4Container = document.getElementById('weatherPrimary4Container');
    DOM.weatherExtendedContainer = document.getElementById('weatherExtendedContainer');
    DOM.btnToggleExtendedForecast = document.getElementById('btnToggleExtendedForecast');
    DOM.toggleForecastText = document.getElementById('toggleForecastText');
    DOM.toggleForecastArrow = document.getElementById('toggleForecastArrow');
    DOM.forecastDaysCountBadge = document.getElementById('forecastDaysCountBadge');

    // Settings Tab
    DOM.settingsSubBtns = document.querySelectorAll('.settings-sub-nav .picker-seg');
    DOM.settingsSubPanes = document.querySelectorAll('.settings-sub-pane');
    DOM.cfgModelName = document.getElementById('cfgModelName');
    DOM.cfgBatteryCap = document.getElementById('cfgBatteryCap');
    DOM.cfgPower = document.getElementById('cfgPower');
    DOM.btnSaveVehicleSettings = document.getElementById('btnSaveVehicleSettings');
    DOM.btnToggleLocationEditMode = document.getElementById('btnToggleLocationEditMode');
    DOM.editModeIcon = document.getElementById('editModeIcon');
    DOM.editModeText = document.getElementById('editModeText');
    DOM.locationsModeHint = document.getElementById('locationsModeHint');
    DOM.locationsDragList = document.getElementById('locationsDragList');
    DOM.btnOpenNewLocationModal = document.getElementById('btnOpenNewLocationModal');
    DOM.btnExportJson = document.getElementById('btnExportJson');
    DOM.importJsonInput = document.getElementById('importJsonInput');
    DOM.btnLoadSampleData = document.getElementById('btnLoadSampleData');
    DOM.btnWipeAllData = document.getElementById('btnWipeAllData');

    // Charge Entry Modal
    DOM.modalAddCharge = document.getElementById('modalAddCharge');
    DOM.btnCloseModalCharge = document.getElementById('btnCloseModalCharge');
    DOM.btnCancelEntry = document.getElementById('btnCancelEntry');
    DOM.formChargeEntry = document.getElementById('formChargeEntry');
    DOM.entryEditId = document.getElementById('entryEditId');
    DOM.modalChargeTitle = document.getElementById('modalChargeTitle');
    DOM.entryDateTime = document.getElementById('entryDateTime');
    DOM.btnOpenLocationPicker = document.getElementById('btnOpenLocationPicker');
    DOM.pickerSelectedIcon = document.getElementById('pickerSelectedIcon');
    DOM.pickerSelectedTitle = document.getElementById('pickerSelectedTitle');
    DOM.pickerSelectedSub = document.getElementById('pickerSelectedSub');
    DOM.entryLocationId = document.getElementById('entryLocationId');
    DOM.entryKwh = document.getElementById('entryKwh');
    DOM.entryOdometer = document.getElementById('entryOdometer');
    DOM.entryDeltaKmTag = document.getElementById('entryDeltaKmTag');
    DOM.entryPrice = document.getElementById('entryPrice');
    DOM.entryTotalCost = document.getElementById('entryTotalCost');
    DOM.entryNotes = document.getElementById('entryNotes');

    // Location Picker Sheet
    DOM.modalLocationPickerSheet = document.getElementById('modalLocationPickerSheet');
    DOM.btnCloseLocationPickerSheet = document.getElementById('btnCloseLocationPickerSheet');
    DOM.pickerLocationsList = document.getElementById('pickerLocationsList');

    // Location Editor Modal
    DOM.modalEditLocation = document.getElementById('modalEditLocation');
    DOM.modalEditLocationTitle = document.getElementById('modalEditLocationTitle');
    DOM.btnCloseEditLocationModal = document.getElementById('btnCloseEditLocationModal');
    DOM.btnCancelLocationEdit = document.getElementById('btnCancelLocationEdit');
    DOM.formLocationEditor = document.getElementById('formLocationEditor');
    DOM.locEditId = document.getElementById('locEditId');
    DOM.locEditName = document.getElementById('locEditName');
    DOM.iconPickerGrid = document.getElementById('iconPickerGrid');
    DOM.locEditIcon = document.getElementById('locEditIcon');
    DOM.locPowerTypePicker = document.getElementById('locPowerTypePicker');
    DOM.locEditPowerType = document.getElementById('locEditPowerType');
    DOM.locEditPrice = document.getElementById('locEditPrice');

    // Hourly Weather Modal
    DOM.modalHourlyWeather = document.getElementById('modalHourlyWeather');
    DOM.hourlyModalTitle = document.getElementById('hourlyModalTitle');
    DOM.hourlyModalSub = document.getElementById('hourlyModalSub');
    DOM.btnCloseHourlyModal = document.getElementById('btnCloseHourlyModal');
    DOM.hourlyTotalSun = document.getElementById('hourlyTotalSun');
    DOM.hourlySunrise = document.getElementById('hourlySunrise');
    DOM.hourlySunset = document.getElementById('hourlySunset');
    DOM.hourlyTotalRain = document.getElementById('hourlyTotalRain');
    DOM.hourlyTempRange = document.getElementById('hourlyTempRange');
    DOM.hourlyDecisionIcon = document.getElementById('hourlyDecisionIcon');
    DOM.hourlyDecisionTitle = document.getElementById('hourlyDecisionTitle');
    DOM.hourlyDecisionDesc = document.getElementById('hourlyDecisionDesc');
    DOM.canvasHourlyChart = document.getElementById('canvasHourlyChart');
    DOM.hourlyChartLegendBox = document.getElementById('hourlyChartLegendBox');
    DOM.hourlyHoursScroll = document.getElementById('hourlyHoursScroll');

    // KPI Detail Modal & Chart
    DOM.modalKpiDetail = document.getElementById('modalKpiDetail');
    DOM.btnCloseKpiDetailModal = document.getElementById('btnCloseKpiDetailModal');
    DOM.kpiDetailTitle = document.getElementById('kpiDetailTitle');
    DOM.kpiDetailSub = document.getElementById('kpiDetailSub');
    DOM.kpiDetailStatsRow = document.getElementById('kpiDetailStatsRow');
    DOM.kpiDetailSegmentPicker = document.getElementById('kpiDetailSegmentPicker');
    DOM.kpiChartTitle = document.getElementById('kpiChartTitle');
    DOM.kpiChartLegendBox = document.getElementById('kpiChartLegendBox');
    DOM.canvasKpiDetailChart = document.getElementById('canvasKpiDetailChart');
    DOM.kpiHistoryListTitle = document.getElementById('kpiHistoryListTitle');
    DOM.kpiHistoryListItems = document.getElementById('kpiHistoryListItems');

    // Toast
    DOM.swiftToast = document.getElementById('swiftToast');
    DOM.swiftToastMsg = document.getElementById('swiftToastMsg');
  }

  // =========================================================================
  // LOCALSTORAGE & MIGRATION (SCHEMA V3)
  // =========================================================================
  function initStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
        saveData();
      } else {
        const parsed = JSON.parse(raw);
        appData = sanitizeAndMigrate(parsed);
        saveData();
      }
    } catch (e) {
      appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
      saveData();
    }
  }

  function sanitizeAndMigrate(data) {
    if (!data || typeof data !== 'object') {
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }

    const res = {
      schemaVersion: CURRENT_SCHEMA,
      lastUpdated: new Date().toISOString(),
      vehicle: {
        model: (data.vehicle && data.vehicle.model) || DEFAULT_DATA.vehicle.model,
        batteryKwh: Number((data.vehicle && data.vehicle.batteryKwh) || DEFAULT_DATA.vehicle.batteryKwh),
        powerPs: Number((data.vehicle && data.vehicle.powerPs) || DEFAULT_DATA.vehicle.powerPs),
        currentOdo: Number((data.vehicle && data.vehicle.currentOdo) || DEFAULT_DATA.vehicle.currentOdo)
      },
      settings: {
        currency: "€",
        locations: [],
        googleSheetsUrl: (() => {
          const raw = (data.settings && data.settings.googleSheetsUrl && String(data.settings.googleSheetsUrl).trim()) || DEFAULT_GOOGLE_SHEETS_API_URL;
          return raw === OLD_BLOCKED_URL ? DEFAULT_GOOGLE_SHEETS_API_URL : raw;
        })(),
        weatherGps: {
          name: (data.settings && data.settings.weatherGps && data.settings.weatherGps.name) || DEFAULT_DATA.settings.weatherGps.name,
          lat: Number((data.settings && data.settings.weatherGps && data.settings.weatherGps.lat) ?? DEFAULT_DATA.settings.weatherGps.lat),
          lon: Number((data.settings && data.settings.weatherGps && data.settings.weatherGps.lon) ?? DEFAULT_DATA.settings.weatherGps.lon)
        },
        pvThresholdSunshineHours: Number((data.settings && data.settings.pvThresholdSunshineHours) ?? DEFAULT_DATA.settings.pvThresholdSunshineHours)
      },
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      pendingSyncQueue: Array.isArray(data.pendingSyncQueue) ? data.pendingSyncQueue : []
    };

    // Locations Migration
    if (data.settings && Array.isArray(data.settings.locations) && data.settings.locations.length > 0) {
      res.settings.locations = data.settings.locations.map((item, idx) => {
        if (typeof item === 'string') {
          const isPv = (item.toLowerCase().includes('bayrhofs') || item.toLowerCase().includes('arbeit'));
          const price = isPv ? 0.15 : (item.toLowerCase().includes('zuhause') ? 0.32 : 0.59);
          const icon = item.toLowerCase().includes('bayrhofs') ? '🏢' : (item.toLowerCase().includes('arbeit') ? '💼' : (item.toLowerCase().includes('zuhause') ? '🏠' : '⚡️'));
          return { id: `loc_${idx}_${Date.now()}`, name: item, icon, powerType: isPv ? 'pv' : 'grid', kwhPrice: price };
        }
        return {
          id: item.id || `loc_${idx}_${Date.now()}`,
          name: item.name || `Standort ${idx + 1}`,
          icon: item.icon || '🏢',
          powerType: item.powerType === 'pv' ? 'pv' : 'grid',
          kwhPrice: Number(item.kwhPrice) || 0.30
        };
      });
    } else {
      res.settings.locations = JSON.parse(JSON.stringify(DEFAULT_LOCATIONS));
    }

    // Sessions Migration & Filter out invalid dummy rows
    res.sessions = res.sessions
      .filter(s => {
        const id = String(s.id || s.ID || '');
        const kwh = Number(s.kwh || s.kWh || 0);
        const price = Number(s.pricePerKwh || s.preis || 0);
        const cost = Number(s.totalCost || s.kosten || 0);
        if (id.includes('d8074cf3') || (kwh <= 0 && price <= 0 && cost <= 0)) {
          return false;
        }
        return true;
      })
      .map((s, idx) => {
        const locName = typeof s.location === 'object' ? s.location.name : (s.location || s.Ort || s.ort || 'Bayrhofs');
        const matchingLoc = res.settings.locations.find(l => l.name === locName);
        const isPv = s.pvSurplus !== undefined ? Boolean(s.pvSurplus) : (matchingLoc ? matchingLoc.powerType === 'pv' : false);
        const price = Number(s.pricePerKwh || s.preis) || (matchingLoc ? matchingLoc.kwhPrice : 0.35);
        const kwh = Number(s.kwh || s.kWh) || 0;
        const total = Number(s.totalCost || s.kosten) || Number((kwh * price).toFixed(2));

        return {
          id: s.id || `session_${Date.now()}_${idx}`,
          date: s.date || s.Datum || s.datum || new Date().toISOString(),
          kwh,
          odometer: Number(s.odometer || s['km-Stand']) || 0,
          pricePerKwh: price,
          totalCost: total,
          location: locName,
          pvSurplus: isPv,
          notes: String(s.notes || s.notiz || s.Notiz || '')
        };
      });

    res.sessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Höchsten km-Stand als aktuellen Odometer
    const maxOdo = res.sessions.reduce((max, s) => Math.max(max, s.odometer || 0), res.vehicle.currentOdo);
    res.vehicle.currentOdo = maxOdo;

    return res;
  }

  function saveData() {
    try {
      appData.lastUpdated = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
      showToast('⚠️ Speicherfehler');
    }
  }

  function initWeatherCache() {
    try {
      const cached = localStorage.getItem(WEATHER_CACHE_KEY);
      if (cached) weatherForecast14Days = JSON.parse(cached);
    } catch (_) {}
  }

  function saveWeatherCache(data) {
    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  // =========================================================================
  // GOOGLE SHEETS CLOUD-BACKEND SYNC & MULTI-TRANSPORT ENGINE
  // =========================================================================
  function getCloudApiUrl() {
    return (appData && appData.settings && appData.settings.googleSheetsUrl && appData.settings.googleSheetsUrl.trim()) || DEFAULT_GOOGLE_SHEETS_API_URL;
  }

  function showCloudDiag(type, icon, message) {
    if (!DOM.cloudDiagBox) return;
    if (type === 'none') {
      DOM.cloudDiagBox.classList.add('hidden');
      return;
    }
    DOM.cloudDiagBox.className = 'cloud-diag-box ' + (type === 'success' ? 'success' : (type === 'warning' ? 'warning' : ''));
    if (DOM.cloudDiagIcon) DOM.cloudDiagIcon.textContent = icon;
    if (DOM.cloudDiagText) DOM.cloudDiagText.innerHTML = message;
    DOM.cloudDiagBox.classList.remove('hidden');
  }

  function parseNum(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const cleaned = String(val).replace(',', '.').replace(/[^0-9.-]/g, '');
    return Number(cleaned) || 0;
  }

  function isValidSession(s) {
    if (!s) return false;
    const id = String(s.id || s.ID || '');
    const kwh = parseNum(s.kwh || s.kWh);
    const price = parseNum(s.pricePerKwh || s.preis);
    const cost = parseNum(s.totalCost || s.kosten);

    // 1. Spezifische Dummy-Einträge aus früheren Fehlübertragungen entfernen
    if (id.includes('d8074cf3') || id.includes('4b9be1ef')) return false;

    // 2. Test-Einträge aus Debugging entfernen
    if (id.startsWith('test_') || id.startsWith('pv_')) return false;

    // 3. Dummy-Einträge ohne kWh, Preis und Kosten verwerfen
    if (kwh <= 0 && price <= 0 && cost <= 0) return false;

    return true;
  }

  function mapRawSession(s, idx) {
    const locName = typeof s.location === 'object'
      ? (s.location.name || 'Bayrhofs')
      : String(s.Ort || s.ort || s.location || s.Location || s.standort || s.Standort || 'Bayrhofs');

    const matchingLoc = (appData && appData.settings && appData.settings.locations
      ? appData.settings.locations.find(l => l.name.toLowerCase() === locName.toLowerCase())
      : null);

    const rawPv = s['PV-Ladung'] !== undefined ? s['PV-Ladung'] : (s.pvSurplus !== undefined ? s.pvSurplus : (s.pv !== undefined ? s.pv : s.pv_ladung));
    let isPv = false;
    if (rawPv === true || rawPv === 'true' || String(rawPv).toLowerCase() === 'ja') {
      isPv = true;
    } else if (matchingLoc && matchingLoc.powerType === 'pv') {
      isPv = true;
    }

    const price = parseNum(s.pricePerKwh || s.preis || s.Preis || s['Preis (€/kWh)']) || (matchingLoc ? matchingLoc.kwhPrice : 0.35);
    const kwh = parseNum(s.kwh || s.kWh || s.energie || s.lademenge);
    const cost = parseNum(s.totalCost || s.kosten || s.Kosten || s.gesamtkosten || s['Gesamtkosten (€)']) || Number((kwh * price).toFixed(2));
    const rawDate = s.date || s.Datum || s.datum || s.timestamp || new Date().toISOString();
    const notesStr = String(s.notes || s.notiz || s.Notiz || s.notizen || s.bemerkung || '');
    const odoNum = parseNum(s.odometer || s.km || s.kmstand || s['km-Stand'] || s.kilometer);

    return {
      id: String(s.id || s.ID || `session_cloud_${idx}_${Date.now()}`),
      date: new Date(rawDate).toISOString(),
      kwh,
      odometer: odoNum,
      pricePerKwh: price,
      totalCost: cost,
      location: locName,
      pvSurplus: Boolean(isPv),
      notes: notesStr
    };
  }

  function extractSessionsFromPayload(parsed) {
    if (!parsed) return [];
    let list = null;

    if (Array.isArray(parsed)) {
      // Erkennung von 2D-Tabellen-Arrays [[Kopfzeilen], [Zeile 1], ...]
      if (parsed.length > 0 && Array.isArray(parsed[0])) {
        const headers = parsed[0].map(h => String(h).toLowerCase().trim());
        return parsed.slice(1).map((row, idx) => {
          const obj = {};
          headers.forEach((h, hIdx) => { obj[h] = row[hIdx]; });
          return mapRawSession(obj, idx);
        }).filter(isValidSession);
      }
      list = parsed;
    } else if (parsed && Array.isArray(parsed.data)) {
      list = parsed.data;
    } else if (parsed && Array.isArray(parsed.sessions)) {
      list = parsed.sessions;
    } else if (parsed && Array.isArray(parsed.rows)) {
      list = parsed.rows;
    } else if (parsed && Array.isArray(parsed.items)) {
      list = parsed.items;
    }

    if (!list || !Array.isArray(list)) return [];
    return list.map((s, idx) => mapRawSession(s, idx)).filter(isValidSession);
  }

  function mergeSessions(cloudSessions) {
    if (!cloudSessions) return false;

    // Nur gültige Cloud-Sessions berücksichtigen (keine 0 kWh Dummy-Zeilen)
    const validCloud = cloudSessions.filter(isValidSession);

    // Identifiziere lokale Sessions, die noch in der Offline-Queue liegen und noch nicht hochgeladen wurden
    const pendingIds = new Set(
      (appData.pendingSyncQueue || []).map(item => item.id || item.ID || (item.session && (item.session.id || item.session.ID))).filter(Boolean)
    );

    const pendingLocal = (appData.sessions || []).filter(s => pendingIds.has(s.id) && isValidSession(s));

    // Die Cloud-Sessions sind die alleinige Referenz ("Single Source of Truth")
    // Alle iPhones haben exakt denselben Datenbestand!
    const map = new Map();

    validCloud.forEach(cs => {
      map.set(cs.id, cs);
    });

    // Noch ungesendete lokale Einträge behalten
    pendingLocal.forEach(ps => {
      if (!map.has(ps.id)) {
        map.set(ps.id, ps);
      }
    });

    appData.sessions = Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Höchsten km-Stand synchronisieren
    const maxOdo = appData.sessions.reduce((max, s) => Math.max(max, s.odometer || 0), appData.vehicle.currentOdo);
    appData.vehicle.currentOdo = maxOdo;

    saveData();
    renderAll();
    return true;
  }

  function fetchWithJsonp(url, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const callbackName = 'cupraJsonpCb_' + Math.floor(Math.random() * 1000000);
      const script = document.createElement('script');
      const sep = url.includes('?') ? '&' : '?';
      const fullUrl = `${url}${sep}callback=${callbackName}&_t=${Date.now()}`;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP Timeout (Google Sheets Antwort zu langsam)'));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[callbackName];
      }

      window[callbackName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP Ladefehler (Zugriff verweigert oder ungültige URL)'));
      };

      script.src = fullUrl;
      document.head.appendChild(script);
    });
  }

  function setSyncStatus(state) {
    currentSyncState = state;
    if (DOM.btnSyncCloud) {
      DOM.btnSyncCloud.classList.remove('syncing', 'saving', 'synced', 'offline');

      if (state === 'syncing') {
        DOM.btnSyncCloud.classList.add('syncing');
        if (DOM.syncStatusIcon) DOM.syncStatusIcon.textContent = '🔄';
        if (DOM.syncStatusText) DOM.syncStatusText.textContent = 'Lädt...';
      } else if (state === 'saving') {
        DOM.btnSyncCloud.classList.add('saving');
        if (DOM.syncStatusIcon) DOM.syncStatusIcon.textContent = '⏳';
        if (DOM.syncStatusText) DOM.syncStatusText.textContent = 'Speichert...';
      } else if (state === 'synced') {
        DOM.btnSyncCloud.classList.add('synced');
        if (DOM.syncStatusIcon) DOM.syncStatusIcon.textContent = '☁️';
        if (DOM.syncStatusText) DOM.syncStatusText.textContent = 'Sync';
      } else {
        DOM.btnSyncCloud.classList.add('offline');
        if (DOM.syncStatusIcon) DOM.syncStatusIcon.textContent = '☁️';
        if (DOM.syncStatusText) DOM.syncStatusText.textContent = 'Sync';
      }
    }

    if (DOM.cloudSettingsDot) {
      DOM.cloudSettingsDot.className = 'cloud-status-dot ' + (state === 'syncing' || state === 'saving' ? 'syncing' : (state === 'synced' ? 'online' : ''));
    }

    if (DOM.cloudSettingsLabel) {
      if (state === 'syncing') {
        DOM.cloudSettingsLabel.textContent = 'Synchronisiere mit Google Sheets...';
      } else if (state === 'saving') {
        DOM.cloudSettingsLabel.textContent = 'Speichert in Google Sheets...';
      } else if (state === 'synced') {
        DOM.cloudSettingsLabel.textContent = 'Google Sheets synchronisiert';
      } else {
        DOM.cloudSettingsLabel.textContent = 'Lokaler Cache aktiv';
      }
    }

    if (state === 'synced' && DOM.cloudLastSyncTime) {
      const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      DOM.cloudLastSyncTime.textContent = `Heute ${timeStr}`;
    }
  }

  async function fetchCloudSessions(isManual = false) {
    setSyncStatus('syncing');
    if (isManual) {
      showToast('☁️ Synchronisiere mit Google Sheets...');
    }

    const apiUrl = getCloudApiUrl();
    let rawData = null;
    let fetchError = null;

    // 1. Primär: Moderner fetch mit Redirect-Follow
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);

      const response = await fetch(apiUrl, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      if (!text || text.trim().startsWith('<')) {
        if (text && (text.includes('Sie benötigen Zugriff') || text.includes('accounts.google.com') || text.includes('drive-logo'))) {
          throw new Error('AUTH_403: Google Apps Script Freigabe steht auf "Nur ich". Bitte auf "Jeder" stellen!');
        }
        throw new Error('Antwort ist HTML statt JSON.');
      }

      rawData = JSON.parse(text);
    } catch (err) {
      fetchError = err;
      console.warn('Standard Fetch nicht erfolgreich, prüfe Fallback:', err.message);
    }

    // 2. Fallback: JSONP Transport (umgeht CORS-Einschränkungen im Browser)
    if (!rawData && (!fetchError || !fetchError.message.startsWith('AUTH_403'))) {
      try {
        rawData = await fetchWithJsonp(apiUrl, 5000);
      } catch (jsonpErr) {
        console.warn('JSONP Fallback nicht erfolgreich:', jsonpErr.message);
      }
    }

    // 3. Auswertung und Speicherung
    if (rawData) {
      const parsedList = extractSessionsFromPayload(rawData);

      if (parsedList.length > 0) {
        mergeSessions(parsedList);
        setSyncStatus('synced');
        showCloudDiag('success', '✅', `Google Sheets verbunden: <strong>${parsedList.length} Ladevorgänge</strong> synchronisiert.`);
        if (isManual) {
          triggerHaptic();
          showToast(`☁️ ${parsedList.length} Ladevorgänge synchronisiert ✓`);
        }
        flushPendingSyncQueue();
        return;
      } else {
        // Tabelle ist online, aber noch leer
        setSyncStatus('synced');
        showCloudDiag('success', '✅', 'Google Sheets ist verbunden (Tabelle ist noch leer). Tippe auf "Lokale Daten hochladen", um bestehende Ladungen zu übertragen.');
        if (isManual) {
          showToast('☁️ Google Sheets verbunden (Tabelle leer)');
        }
        flushPendingSyncQueue();
        return;
      }
    }

    // 4. Diagnose & Fehlermeldung
    setSyncStatus('offline');
    const errMsg = fetchError ? fetchError.message : 'Verbindungsaufbau fehlgeschlagen';
    console.warn('Google Sheets Sync Status:', errMsg);

    if (errMsg.includes('AUTH_403') || errMsg.includes('403') || errMsg.includes('Zugriff')) {
      showCloudDiag('warning', '⚠️', '<strong>Google Sheets Zugriff verweigert (403):</strong><br>In Google Apps Script muss die Freigabe auf <em>"Wer hat Zugriff: <strong>Jeder</strong>"</em> stehen. Aktuell blockiert Google den Zugriff.');
      if (isManual) {
        showToast('⚠️ Google 403: Freigabe auf "Jeder" stellen!');
      }
    } else if (!navigator.onLine) {
      showCloudDiag('warning', '📡', '<strong>Offline:</strong> Keine aktive Internetverbindung. Die App verwendet den lokalen Speicher.');
      if (isManual) {
        showToast('⚠️ Keine Internetverbindung – Lokaler Cache aktiv');
      }
    } else {
      showCloudDiag('warning', '⚠️', '<strong>Cloud nicht erreichbar:</strong> Google Apps Script antwortet nicht oder blockiert die Verbindung. Prüfe URL und Freigabe ("Jeder").');
      if (isManual) {
        showToast('⚠️ Cloud nicht erreichbar – Lokaler Cache aktiv');
      }
    }
  }

  function formatSessionForCloud(s) {
    const kwh = parseNum(s.kwh || s.kWh);
    const price = parseNum(s.pricePerKwh || s.preis);
    const cost = parseNum(s.totalCost || s.kosten) || Number((kwh * price).toFixed(2));
    const isPv = Boolean(s.pvSurplus);
    const loc = typeof s.location === 'object'
      ? (s.location.name || 'Bayrhofs')
      : String(s.location || s.Ort || s.ort || 'Bayrhofs');
    const dateStr = s.date || s.Datum || new Date().toISOString();
    const id = String(s.id || s.ID || ('session_' + Date.now()));
    const notes = String(s.notes || s.notiz || s.Notiz || '');
    const odo = parseNum(s.odometer || s['km-Stand']);

    return {
      id,
      ID: id,
      date: dateStr,
      Datum: dateStr,
      timestamp: dateStr,
      location: loc,
      Location: loc,
      ort: loc,
      Ort: loc,
      standort: loc,
      kwh,
      kWh: kwh,
      energie: kwh,
      pricePerKwh: price,
      preis: price,
      Preis: price,
      'Preis (€/kWh)': price,
      totalCost: cost,
      kosten: cost,
      Kosten: cost,
      gesamtkosten: cost,
      Gesamtkosten: cost,
      'Gesamtkosten (€)': cost,
      pvSurplus: isPv,
      pv: isPv,
      pv_ladung: isPv ? 'Ja' : 'Nein',
      'PV-Ladung': isPv ? 'Ja' : 'Nein',
      notes,
      notiz: notes,
      Notiz: notes,
      odometer: odo,
      km: odo,
      'km-Stand': odo
    };
  }

  async function deleteCloudSession(id) {
    if (!id) return;
    setSyncStatus('saving');
    const apiUrl = getCloudApiUrl();

    // Reiner Lösch-Befehl: niemals kWh, Ort oder 0-Werte mitsenden!
    const payload = {
      action: 'delete',
      id: String(id),
      ID: String(id),
      timestamp: new Date().toISOString()
    };

    // Entferne diesen Eintrag auch aus der lokalen Offline-Queue
    if (appData.pendingSyncQueue && appData.pendingSyncQueue.length > 0) {
      appData.pendingSyncQueue = appData.pendingSyncQueue.filter(item => {
        const itemId = item.id || item.ID || (item.session && (item.session.id || item.session.ID));
        return itemId !== id;
      });
      saveData();
    }

    try {
      // 1. Primär: POST
      await fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('POST Delete Fehler, versuche GET Fallback:', err);
    }

    // 2. Sekundär / Verstärkung: GET (wird von Google Apps Script garantiert ohne CORS-Probleme verarbeitet)
    try {
      const getUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}action=delete&id=${encodeURIComponent(id)}`;
      await fetchWithJsonp(getUrl, 4000);
    } catch (_) {
      // Ignoriere JSONP Timeout bei erfolgreichem POST
    }

    setSyncStatus('synced');

    // Nach dem Löschen: Aktualisiere synchron den Datenstand von Google Sheets
    setTimeout(() => {
      fetchCloudSessions(false);
    }, 600);
  }

  async function cleanCloudSheet() {
    if (!confirm('Möchtest du fehlerhafte Dummy-Zeilen (0 kWh) aus deinem Google Sheet bereinigen? Gültige Ladevorgänge bleiben vollständig erhalten.')) {
      return;
    }

    setSyncStatus('saving');
    showToast('🧹 Bereinige Google Sheet...');
    const apiUrl = getCloudApiUrl();

    try {
      await fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'cleanup' })
      });
    } catch (err) {
      console.warn('Cleanup POST Fehler:', err);
    }

    try {
      const getUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}action=cleanup`;
      await fetchWithJsonp(getUrl, 4000);
    } catch (_) {}

    setTimeout(() => {
      fetchCloudSessions(true);
      showToast('✅ Google Sheet bereinigt');
    }, 1000);
  }

  async function postCloudSession(session, action = 'create') {
    if (action === 'delete') {
      const targetId = session.id || session.ID;
      return deleteCloudSession(targetId);
    }

    setSyncStatus('saving');
    const apiUrl = getCloudApiUrl();
    const formatted = formatSessionForCloud(session);
    const payload = {
      action,
      timestamp: new Date().toISOString(),
      ...formatted,
      session: formatted
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      await fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      setTimeout(() => {
        if (!DOM.cloudDiagBox || DOM.cloudDiagBox.classList.contains('hidden') || DOM.cloudDiagBox.classList.contains('success')) {
          setSyncStatus('synced');
        }
      }, 700);
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('Google Sheets POST Fehler, speichere in Offline-Queue:', err);
      appData.pendingSyncQueue = appData.pendingSyncQueue || [];
      appData.pendingSyncQueue.push(payload);
      saveData();
      setSyncStatus('offline');
    }
  }

  async function flushPendingSyncQueue() {
    if (!appData.pendingSyncQueue || appData.pendingSyncQueue.length === 0) return;
    const queue = [...appData.pendingSyncQueue];
    const apiUrl = getCloudApiUrl();

    for (const item of queue) {
      try {
        await fetch(apiUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item)
        });
        appData.pendingSyncQueue = (appData.pendingSyncQueue || []).filter(q => q.id !== item.id);
        saveData();
      } catch (err) {
        console.warn('Queue-Flush pausiert:', err);
        break;
      }
    }
  }

  async function bulkUploadToCloud() {
    const validSessions = (appData.sessions || []).filter(isValidSession);
    if (validSessions.length === 0) {
      showToast('ℹ️ Keine gültigen lokalen Ladedaten zum Hochladen vorhanden');
      return;
    }

    if (!confirm(`Möchtest du alle ${validSessions.length} lokalen Ladevorgänge jetzt in Google Sheets übertragen?`)) {
      return;
    }

    setSyncStatus('saving');
    showToast(`☁️ Übertrage ${validSessions.length} Einträge in dein Google Sheet...`);
    const apiUrl = getCloudApiUrl();

    let successCount = 0;
    try {
      // Sequentiell einzeln senden:
      // 100% kompatibel mit Apps Script, verhindert Dummy-Zeilen durch Bulk-Payloads
      for (let i = 0; i < validSessions.length; i++) {
        const formatted = formatSessionForCloud(validSessions[i]);
        await fetch(apiUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(formatted)
        });
        successCount++;
        if (i < validSessions.length - 1) {
          await new Promise(r => setTimeout(r, 180));
        }
      }

      triggerHaptic();
      setSyncStatus('synced');
      showToast(`☁️ Alle ${successCount} Ladevorgänge erfolgreich an Google Sheets gesendet! ✓`);
      showCloudDiag('success', '✅', `Alle <strong>${successCount} lokalen Ladevorgänge</strong> wurden an Google Sheets übertragen.`);
    } catch (err) {
      setSyncStatus('offline');
      showToast('⚠️ Fehler beim Hochladen in die Cloud');
      showCloudDiag('warning', '⚠️', 'Fehler beim Senden: ' + err.message);
    }
  }

  async function testCloudConnection() {
    triggerHaptic();
    showToast('🔍 Teste Google Sheets Verbindung...');
    showCloudDiag('none');

    const apiUrl = getCloudApiUrl();
    const testUrl = apiUrl + (apiUrl.includes('?') ? '&' : '?') + 'action=ping&_t=' + Date.now();

    try {
      const resp = await fetch(testUrl, { method: 'GET', redirect: 'follow', cache: 'no-store' });
      const text = await resp.text();

      if (text.startsWith('<')) {
        if (text.includes('Sie benötigen Zugriff') || text.includes('accounts.google.com') || text.includes('Zugriff verweigert')) {
          showCloudDiag('warning', '⚠️', '<strong>Test fehlgeschlagen (403 Zugriff verweigert):</strong><br>Google blockiert die Verbindung ("Sie benötigen Zugriff").<br><strong>Lösung:</strong> Prüfe in Apps Script die Web-App Freigabe: <em>"Ausführen als: Ich"</em> und <em>"Wer hat Zugriff: <strong>Jeder</strong>"</em> (siehe Anleitung unten).');
          showToast('⚠️ Google 403: Berechtigung fehlt');
          return;
        }
        showCloudDiag('warning', '⚠️', 'Google antwortete mit HTML statt JSON. Prüfe die Web-App Freigabe.');
        showToast('⚠️ Ungültiges Antwortformat');
        return;
      }

      const json = JSON.parse(text);
      showCloudDiag('success', '✅', `<strong>Verbindung erfolgreich!</strong><br>${json.message || 'API antwortet einwandfrei.'} (${json.rows !== undefined ? json.rows + ' Zeilen in Google Sheet' : 'Bereit'})`);
      setSyncStatus('synced');
      showToast('✅ Verbindung erfolgreich!');
    } catch (e) {
      try {
        const jsonpData = await fetchWithJsonp(testUrl, 4500);
        showCloudDiag('success', '✅', `<strong>Verbindung erfolgreich über JSONP!</strong><br>${jsonpData.message || 'API antwortet einwandfrei.'}`);
        setSyncStatus('synced');
        showToast('✅ Verbindung erfolgreich!');
      } catch (err) {
        if (!navigator.onLine) {
          showCloudDiag('warning', '📡', '<strong>Offline:</strong> Kein Internet vorhanden.');
        } else {
          showCloudDiag('warning', '⚠️', '<strong>Verbindung fehlgeschlagen:</strong> CORS-Fehler oder Google 403 Zugriffsbeschränkung.<br>Stelle sicher, dass in Apps Script <em>"Wer hat Zugriff: <strong>Jeder</strong>"</em> ausgewählt ist.');
        }
        showToast('⚠️ Verbindungstest fehlgeschlagen');
      }
    }
  }

  function handleSaveCloudUrl() {
    if (!DOM.inputCloudApiUrl) return;
    const url = DOM.inputCloudApiUrl.value.trim();
    if (!url) {
      showToast('⚠️ Bitte eine gültige Web-App URL eingeben');
      return;
    }
    appData.settings.googleSheetsUrl = url;
    saveData();
    triggerHaptic();
    showToast('☁️ Web-App URL gespeichert ✓');
    testCloudConnection();
  }

  function handleResetCloudUrl() {
    if (DOM.inputCloudApiUrl) {
      DOM.inputCloudApiUrl.value = DEFAULT_GOOGLE_SHEETS_API_URL;
    }
    appData.settings.googleSheetsUrl = DEFAULT_GOOGLE_SHEETS_API_URL;
    saveData();
    triggerHaptic();
    showToast('Standard Google-Sheets URL wiederhergestellt');
  }

  const APPS_SCRIPT_SOURCE_CODE = `/**
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
    const defaultHeaders = ["ID", "Datum", "Ort", "kWh", "Preis (€/kWh)", "Gesamtkosten (€)", "PV-Ladung", "Notiz", "km-Stand"];
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
    updatedAt: -1,
    rawHeaders: headers
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").toLowerCase().trim();
    if (h === "id" || h.includes("kennung") || h.includes("vorgang") || h.includes("session")) map.id = i;
    else if (h.includes("datum") || h.includes("date") || h.includes("zeit")) map.date = i;
    else if (h.includes("ort") || h.includes("standort") || h.includes("location")) map.location = i;
    else if (h.includes("kwh") || h.includes("menge") || h.includes("energie") || h.includes("lademenge")) map.kwh = i;
    else if (h.includes("preis") || h.includes("price")) map.pricePerKwh = i;
    else if (h.includes("gesamtkosten") || h.includes("kosten") || h.includes("cost") || h.includes("total")) map.totalCost = i;
    else if (h.includes("pv") || h.includes("solar") || h.includes("sonne")) map.pvSurplus = i;
    else if (h.includes("notiz") || h.includes("note") || h.includes("bemerkung")) map.notes = i;
    else if (h.includes("km") || h.includes("odo") || h.includes("kilometer")) map.odometer = i;
    else if (h.includes("updated") || h.includes("stand")) map.updatedAt = i;
  }

  // Standard-Fallback: Spalte 1 (Index 0) ist die ID-Spalte
  if (map.id < 0) map.id = 0;

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
          "km-Stand": odoVal
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
}`;

  function handleCopyScriptCode() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(APPS_SCRIPT_SOURCE_CODE).then(() => {
        triggerHaptic();
        showToast('📋 Apps-Script-Code in Zwischenablage kopiert! ✓');
      }).catch(() => {
        fallbackCopyText(APPS_SCRIPT_SOURCE_CODE);
      });
    } else {
      fallbackCopyText(APPS_SCRIPT_SOURCE_CODE);
    }
  }

  function fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      triggerHaptic();
      showToast('📋 Apps-Script-Code in Zwischenablage kopiert! ✓');
    } catch (_) {
      showToast('⚠️ Kopieren nicht unterstützt');
    }
    document.body.removeChild(textArea);
  }

  // =========================================================================
  // NAVIGATION & TAB SWITCHING
  // =========================================================================
  function switchMainTab(tabId) {
    activeTab = tabId;

    DOM.dockTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    DOM.tabViews.forEach(v => {
      v.classList.toggle('active', v.id === `tab-${tabId}`);
    });

    triggerHaptic();

    if (tabId === 'charging') {
      if (activeChargingSub === 'analytics') renderAnalyticsCharts();
      else renderChargesStream();
    } else if (tabId === 'weather') {
      renderWeatherViews();
    }
  }

  function switchChargingSub(subId) {
    activeChargingSub = subId;

    DOM.chargingSegPickers.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-sub') === subId);
    });

    DOM.chargingSubViews.forEach(v => {
      v.classList.toggle('active', v.id === `sub-${subId}`);
    });

    triggerHaptic();

    if (subId === 'analytics') {
      setTimeout(() => renderAnalyticsCharts(), 50);
    } else {
      renderChargesStream();
    }
  }

  function switchSettingsSub(subId) {
    activeSettingsSub = subId;

    DOM.settingsSubBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-settab') === subId);
    });

    DOM.settingsSubPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `settab-${subId}`);
    });

    triggerHaptic();
  }

  function triggerHaptic() {
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (_) {}
    }
  }

  // =========================================================================
  // EVENT LISTENERS SETUP
  // =========================================================================
  function setupEvents() {
    DOM.dockTabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchMainTab(btn.getAttribute('data-tab')));
    });

    // ZENTRALER (+) BUTTON
    DOM.fabAddCharge.addEventListener('click', () => openModalCharge());

    // Charging Sub-Tabs
    DOM.chargingSegPickers.forEach(btn => {
      btn.addEventListener('click', () => switchChargingSub(btn.getAttribute('data-sub')));
    });

    // Settings Sub-Tabs
    DOM.settingsSubBtns.forEach(btn => {
      btn.addEventListener('click', () => switchSettingsSub(btn.getAttribute('data-settab')));
    });

    // Period Pills
    DOM.periodPills.forEach(pill => {
      pill.addEventListener('click', () => {
        DOM.periodPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeAnalyticsPeriod = pill.getAttribute('data-period');
        renderAnalyticsCharts();
        triggerHaptic();
      });
    });

    // Dashboard Wetter-Widget: Klick öffnet Wetter & PV Tab!
    DOM.dashPvPreviewCard.addEventListener('click', () => {
      switchMainTab('weather');
    });

    // Wetter Refresh Button
    DOM.btnRefreshWeather.addEventListener('click', () => {
      autoRequestGpsAndFetchWeather(true);
      triggerHaptic();
    });

    // 14-Tage Toggle
    DOM.btnToggleExtendedForecast.addEventListener('click', () => {
      isWeatherExpanded = !isWeatherExpanded;
      DOM.weatherExtendedContainer.classList.toggle('expanded', isWeatherExpanded);
      DOM.btnToggleExtendedForecast.classList.toggle('open', isWeatherExpanded);
      DOM.toggleForecastText.textContent = isWeatherExpanded 
        ? 'Weniger anzeigen (4 Tage)' 
        : 'Weitere 10 Tage anzeigen (14-Tage Trend)';
      DOM.forecastDaysCountBadge.textContent = isWeatherExpanded ? '14 Tage Trend' : '4 Tage Vorschau';
      triggerHaptic();
    });

    // Standorte Bearbeiten-Modus Umschalter (Minimaler Stift)
    DOM.btnToggleLocationEditMode.addEventListener('click', () => {
      isLocationsEditMode = !isLocationsEditMode;
      DOM.btnToggleLocationEditMode.classList.toggle('active-done', isLocationsEditMode);
      DOM.editModeIcon.textContent = isLocationsEditMode ? '✓' : '✏️';
      DOM.editModeText.textContent = isLocationsEditMode ? 'Fertig' : 'Bearbeiten';
      DOM.locationsModeHint.textContent = isLocationsEditMode 
        ? 'Nutze ▲ und ▼ zum Sortieren oder ⛔ zum Löschen.' 
        : 'Tippe auf einen Standort zum Anpassen. Im Bearbeitungsmodus kannst du sortieren oder löschen.';
      renderLocationsManageList();
      triggerHaptic();
    });

    // Charge Modal Events
    DOM.btnCloseModalCharge.addEventListener('click', () => closeModalCharge());
    DOM.btnCancelEntry.addEventListener('click', () => closeModalCharge());
    DOM.modalAddCharge.addEventListener('click', (e) => {
      if (e.target === DOM.modalAddCharge) closeModalCharge();
    });

    DOM.entryKwh.addEventListener('input', calculateModalCost);
    DOM.entryPrice.addEventListener('input', calculateModalCost);
    DOM.entryOdometer.addEventListener('input', calculateModalOdoDelta);
    DOM.formChargeEntry.addEventListener('submit', handleSaveChargeEntry);

    // Location Picker Sheet Events
    DOM.btnOpenLocationPicker.addEventListener('click', () => openLocationPickerSheet());
    DOM.btnCloseLocationPickerSheet.addEventListener('click', () => closeLocationPickerSheet());
    DOM.modalLocationPickerSheet.addEventListener('click', (e) => {
      if (e.target === DOM.modalLocationPickerSheet) closeLocationPickerSheet();
    });

    // Location Editor Events
    DOM.btnOpenNewLocationModal.addEventListener('click', () => openLocationEditorModal(null));
    DOM.btnCloseEditLocationModal.addEventListener('click', () => closeLocationEditorModal());
    DOM.btnCancelLocationEdit.addEventListener('click', () => closeLocationEditorModal());
    DOM.modalEditLocation.addEventListener('click', (e) => {
      if (e.target === DOM.modalEditLocation) closeLocationEditorModal();
    });

    DOM.locPowerTypePicker.querySelectorAll('.picker-seg').forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.locPowerTypePicker.querySelectorAll('.picker-seg').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        DOM.locEditPowerType.value = btn.getAttribute('data-powertype');
        triggerHaptic();
      });
    });

    DOM.formLocationEditor.addEventListener('submit', handleSaveLocationEditor);

    // Stündliches Wetter Modal Close
    DOM.btnCloseHourlyModal.addEventListener('click', () => closeHourlyModal());
    DOM.modalHourlyWeather.addEventListener('click', (e) => {
      if (e.target === DOM.modalHourlyWeather) closeHourlyModal();
    });

    // Klickbare KPI Dashboard-Kacheln für historische Verlaufsgraphen
    document.querySelectorAll('.clickable-kpi').forEach(card => {
      card.addEventListener('click', () => {
        const kpi = card.getAttribute('data-kpi');
        if (kpi) openKpiDetailModal(kpi);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const kpi = card.getAttribute('data-kpi');
          if (kpi) openKpiDetailModal(kpi);
        }
      });
    });

    if (DOM.btnCloseKpiDetailModal) {
      DOM.btnCloseKpiDetailModal.addEventListener('click', () => closeKpiDetailModal());
    }
    if (DOM.modalKpiDetail) {
      DOM.modalKpiDetail.addEventListener('click', (e) => {
        if (e.target === DOM.modalKpiDetail) closeKpiDetailModal();
      });
    }

    if (DOM.kpiDetailSegmentPicker) {
      DOM.kpiDetailSegmentPicker.querySelectorAll('.picker-seg').forEach(btn => {
        btn.addEventListener('click', () => {
          DOM.kpiDetailSegmentPicker.querySelectorAll('.picker-seg').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const range = btn.getAttribute('data-subrange');
          if (activeKpiModal) {
            renderKpiDetailView(activeKpiModal, range);
            requestAnimationFrame(() => {
              if (chartKpiDetail) chartKpiDetail.resize();
            });
            setTimeout(() => {
              if (chartKpiDetail) {
                chartKpiDetail.resize();
                chartKpiDetail.update('none');
              }
            }, 80);
          }
          triggerHaptic();
        });
      });
    }

    // Fahrzeug-Settings
    DOM.btnSaveVehicleSettings.addEventListener('click', handleSaveVehicleSettings);

    // Backup & Restore
    DOM.btnExportJson.addEventListener('click', handleExportJson);
    DOM.importJsonInput.addEventListener('change', handleImportJson);
    DOM.btnLoadSampleData.addEventListener('click', handleLoadSampleData);
    DOM.btnWipeAllData.addEventListener('click', handleWipeAllData);

    // Google Sheets Cloud Sync Buttons & Actions
    if (DOM.btnSyncCloud) {
      DOM.btnSyncCloud.addEventListener('click', () => {
        fetchCloudSessions(true);
        triggerHaptic();
      });
    }
    if (DOM.btnManualCloudSync) {
      DOM.btnManualCloudSync.addEventListener('click', () => {
        fetchCloudSessions(true);
        triggerHaptic();
      });
    }
    if (DOM.btnTestCloudConnection) {
      DOM.btnTestCloudConnection.addEventListener('click', () => {
        testCloudConnection();
      });
    }
    if (DOM.btnBulkUploadCloud) {
      DOM.btnBulkUploadCloud.addEventListener('click', () => {
        bulkUploadToCloud();
      });
    }
    if (DOM.btnSaveCloudUrl) {
      DOM.btnSaveCloudUrl.addEventListener('click', () => {
        handleSaveCloudUrl();
      });
    }
    if (DOM.btnResetCloudUrl) {
      DOM.btnResetCloudUrl.addEventListener('click', () => {
        handleResetCloudUrl();
      });
    }
    if (DOM.btnCopyScriptCode) {
      DOM.btnCopyScriptCode.addEventListener('click', () => {
        handleCopyScriptCode();
      });
    }
    if (DOM.btnCleanCloudSheet) {
      DOM.btnCleanCloudSheet.addEventListener('click', () => {
        cleanCloudSheet();
      });
    }

    // Auto-Flush bei wiederkehrender Online-Verbindung
    window.addEventListener('online', () => {
      flushPendingSyncQueue();
      fetchCloudSessions(false);
    });

    // Auto-Sync beim Entsperren / App-Wechsel auf iPhones
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchCloudSessions(false);
      }
    });

    window.addEventListener('focus', () => {
      fetchCloudSessions(false);
    });

    // Periodischer Background-Sync alle 60 Sekunden (falls App im Vordergrund aktiv ist)
    setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        fetchCloudSessions(false);
      }
    }, 60000);
  }

  // =========================================================================
  // GANZHEITLICHES RENDERING
  // =========================================================================
  function renderAll() {
    renderDashboard();
    renderLocationFilterRail();
    renderChargesStream();
    renderSettingsForms();
    renderLocationsManageList();
  }

  // =========================================================================
  // TAB 1: DASHBOARD (METRIKEN OBEN, WETTER MITTE, AUTO UNTEN)
  // =========================================================================
  function renderDashboard() {
    // Datum
    const now = new Date();
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    DOM.currentMonthYearTag.textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

    // Aggregation
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    let mCost = 0, mKwh = 0, yCost = 0, yKwh = 0, allCost = 0, allKwh = 0, allPvKwh = 0;

    appData.sessions.forEach(s => {
      const d = new Date(s.date);
      const k = Number(s.kwh) || 0;
      const c = Number(s.totalCost) || 0;

      allCost += c;
      allKwh += k;
      if (s.pvSurplus) allPvKwh += k;

      if (d.getFullYear() === curYear) {
        yCost += c;
        yKwh += k;
        if (d.getMonth() === curMonth) {
          mCost += c;
          mKwh += k;
        }
      }
    });

    DOM.dashMonthCost.textContent = formatDe(mCost);
    DOM.dashMonthKwh.textContent = `${mKwh.toFixed(1)} kWh geladen`;

    DOM.dashYearCost.textContent = formatDe(yCost);
    DOM.dashYearKwh.textContent = `${yKwh.toFixed(1)} kWh geladen`;

    // Fahrleistung Monat & Jahr
    const distStats = calcDistanceStats(appData.sessions, appData.vehicle.currentOdo);
    if (DOM.dashMonthDistance) {
      DOM.dashMonthDistance.textContent = formatDe(distStats.monthKm);
      DOM.dashMonthDistanceSub.textContent = distStats.monthKm > 0
        ? `Ø ${distStats.avgKmPerDay.toFixed(1).replace('.', ',')} km / Tag`
        : `0 km im ${monthNames[curMonth]}`;
    }

    if (DOM.dashYearDistance) {
      DOM.dashYearDistance.textContent = formatDe(distStats.yearKm);
      DOM.dashYearDistanceSub.textContent = `Gesamt: ${Number(distStats.totalOdo).toLocaleString('de-DE')} km`;
    }

    const avgPrice = allKwh > 0 ? (allCost / allKwh) : 0.35;
    DOM.dashAvgPrice.textContent = avgPrice.toFixed(2).replace('.', ',');
    const pvPct = allKwh > 0 ? Math.round((allPvKwh / allKwh) * 100) : 0;
    DOM.dashPvShareSub.textContent = `${pvPct}% via PV-Solar`;

    // Verbrauch
    const consData = calcConsumption(appData.sessions);
    if (consData.hasData) {
      DOM.dashAvgCons.textContent = consData.avgCons.toFixed(1).replace('.', ',');
      DOM.dashAvgCost100.textContent = `${consData.avgCost100.toFixed(2).replace('.', ',')} € / 100 km`;
    } else {
      DOM.dashAvgCons.textContent = '--';
      DOM.dashAvgCost100.textContent = '-- € / 100 km';
    }

    // Kompakte Autokarte unten & Header
    const v = appData.vehicle;
    const modelName = v.model || 'Cupra Raval Endurance Edition Dynamic';
    DOM.cardCarModelName.textContent = modelName;
    if (DOM.appHeaderTitle) DOM.appHeaderTitle.textContent = modelName;
    DOM.cardBatteryKwh.innerHTML = `${Number(v.batteryKwh).toFixed(1)} <small>kWh</small>`;
    DOM.cardPowerPs.innerHTML = `${v.powerPs} <small>PS</small>`;
    DOM.cardCurrentOdo.innerHTML = `${Number(v.currentOdo).toLocaleString('de-DE')} <small>km</small>`;

    if (appData.sessions.length > 0) {
      const latest = appData.sessions[0];
      const dObj = new Date(latest.date);
      DOM.dashboardLiveStatus.textContent = `Zuletzt: ${dObj.toLocaleDateString('de-DE')} • ${latest.kwh.toFixed(1)} kWh @ ${latest.location}`;
    } else {
      DOM.dashboardLiveStatus.textContent = `Bereit für die erste Ladung`;
    }

    updateDashboardPvDecisionWidget();
  }

  function calcConsumption(sessions) {
    if (!sessions || sessions.length < 2) return { hasData: false };
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));

    let dist = 0, energy = 0, cost = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const delta = curr.odometer - prev.odometer;
      if (delta > 0 && delta < 3000) {
        dist += delta;
        energy += curr.kwh;
        cost += curr.totalCost;
      }
    }

    if (dist > 0) {
      return {
        hasData: true,
        avgCons: (energy / dist) * 100,
        avgCost100: (cost / dist) * 100
      };
    }
    return { hasData: false };
  }

  // =========================================================================
  // FAHRLEISTUNG & DETAIL-VERLAUFSGRAPHEN FÜR DAS DASHBOARD
  // =========================================================================
  let activeKpiModal = null;
  let activeKpiSubRange = 'auto';
  let chartKpiDetail = null;

  function calcDistanceStats(sessions, currentOdo) {
    const sorted = [...(sessions || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const curDay = now.getDate();

    let monthKm = 0;
    let yearKm = 0;
    let totalTrackedKm = 0;
    const segments = [];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const delta = (curr.odometer && prev.odometer && curr.odometer > prev.odometer)
        ? (curr.odometer - prev.odometer)
        : 0;

      if (delta > 0) {
        const d = new Date(curr.date);
        totalTrackedKm += delta;

        if (d.getFullYear() === curYear) {
          yearKm += delta;
          if (d.getMonth() === curMonth) {
            monthKm += delta;
          }
        }

        segments.push({
          date: curr.date,
          fromOdo: prev.odometer,
          toOdo: curr.odometer,
          deltaKm: delta,
          kwh: Number(curr.kwh) || 0,
          cost: Number(curr.totalCost) || 0,
          location: curr.location || 'Ladung',
          consumption: delta > 0 ? ((curr.kwh / delta) * 100) : 0
        });
      }
    }

    const daysSoFar = Math.max(1, curDay);
    const avgKmPerDay = monthKm > 0 ? (monthKm / daysSoFar) : 0;
    const avgKmPerMonth = yearKm > 0 ? (yearKm / (curMonth + 1)) : 0;

    return {
      monthKm,
      yearKm,
      totalTrackedKm,
      totalOdo: currentOdo || (sorted.length > 0 ? sorted[sorted.length - 1].odometer : 12450),
      avgKmPerDay,
      avgKmPerMonth,
      segments
    };
  }

  function openKpiDetailModal(kpiType) {
    activeKpiModal = kpiType;
    const defaultSub = (kpiType === 'year-cost' || kpiType === 'year-distance') ? 'monthly' : 'timeline';
    activeKpiSubRange = defaultSub;

    if (DOM.kpiDetailSegmentPicker) {
      DOM.kpiDetailSegmentPicker.querySelectorAll('.picker-seg').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-subrange') === defaultSub);
      });
    }

    if (DOM.modalKpiDetail) {
      DOM.modalKpiDetail.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    renderKpiDetailView(kpiType, defaultSub);

    requestAnimationFrame(() => {
      if (chartKpiDetail) {
        chartKpiDetail.resize();
      }
    });

    setTimeout(() => {
      if (chartKpiDetail) {
        chartKpiDetail.resize();
        chartKpiDetail.update('none');
      }
    }, 120);

    triggerHaptic();
  }

  function closeKpiDetailModal() {
    if (DOM.modalKpiDetail) {
      DOM.modalKpiDetail.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (chartKpiDetail) {
      chartKpiDetail.destroy();
      chartKpiDetail = null;
    }
    activeKpiModal = null;
  }

  // =========================================================================
  // INTELLIGENTE DYNAMISCHE ACHSEN- & MONATSSPANNE-BERECHNUNG
  // =========================================================================
  function getSmartAxisBounds(values, metricType = 'general', isBarChart = false) {
    const nums = (values || []).filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
    if (nums.length === 0) {
      if (metricType === 'consumption') return { min: 10, max: 25 };
      if (metricType === 'price') return { min: 0, max: 0.50 };
      if (metricType === 'odometer') return { min: 0, max: 1000 };
      return { min: 0, max: 10 };
    }

    const rawMin = Math.min(...nums);
    const rawMax = Math.max(...nums);
    const spread = Math.max(0.1, rawMax - rawMin);

    if (metricType === 'consumption') {
      // E-Auto Verbrauch (kWh/100km):
      // Keine statische 30 kWh Decke, sondern intelligenter Headroom (~15-20%)
      const pad = Math.max(1.5, spread * 0.25);
      let min = Math.max(0, Math.floor((rawMin - pad) / 2) * 2);
      if (min <= 4) min = 0;
      let max = Math.ceil((rawMax + pad) / 2) * 2;
      if (max - min < 6) max = min + 6;
      return { min, max };
    }

    if (metricType === 'price') {
      // Strompreise (€/kWh): min immer 0 für PV-Einordnung, max sauber auf 0.05 gerundet
      const pad = Math.max(0.04, spread * 0.2);
      const targetMax = rawMax + pad;
      let max = Math.ceil(targetMax * 20) / 20;
      if (max < 0.25) max = 0.25;
      return { min: 0, max };
    }

    if (metricType === 'odometer') {
      // Kilometerstand: min darf nie 0 sein, um flache Linien zu verhindern
      const pad = Math.max(150, spread * 0.25);
      let min = Math.max(0, Math.floor((rawMin - pad) / 100) * 100);
      let max = Math.ceil((rawMax + pad) / 100) * 100;
      if (max - min < 200) max = min + 200;
      return { min, max };
    }

    // Mengen (Balken für kWh geladen, Kosten in €, gefahrene Distanzen in km)
    let min = 0;
    const targetMax = rawMax <= 0 ? 10 : rawMax * 1.15;
    let max;
    if (targetMax <= 10) {
      max = Math.ceil(targetMax);
    } else if (targetMax <= 50) {
      max = Math.ceil(targetMax / 5) * 5;
    } else if (targetMax <= 200) {
      max = Math.ceil(targetMax / 10) * 10;
    } else if (targetMax <= 1000) {
      max = Math.ceil(targetMax / 50) * 50;
    } else {
      max = Math.ceil(targetMax / 100) * 100;
    }
    return { min, max };
  }

  function getSmartMonthRange(activeMonthIndices, curYear, curMonth) {
    const monthShorts = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    let start = 0;
    let end = curMonth;

    const validIndices = (activeMonthIndices || []).filter(idx => typeof idx === 'number' && idx >= 0 && idx <= 11);
    if (validIndices.length > 0) {
      const minActive = Math.min(...validIndices);
      const maxActive = Math.max(...validIndices);
      start = minActive;
      end = Math.min(11, Math.max(maxActive, curMonth));
    } else {
      start = Math.max(0, curMonth - 1);
      end = curMonth;
    }

    const indices = [];
    for (let i = start; i <= end; i++) {
      indices.push(i);
    }

    return {
      startIdx: start,
      endIdx: end,
      indices,
      labels: indices.map(i => monthShorts[i]),
      fullNames: indices.map(i => monthNames[i])
    };
  }

  function renderKpiDetailView(kpiType, subRange) {
    if (!DOM.modalKpiDetail) return;

    const range = (subRange === 'monthly' || subRange === 'timeline') ? subRange : 'monthly';
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const monthShorts = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

    const sessions = appData.sessions || [];
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const distStats = calcDistanceStats(sessions, appData.vehicle.currentOdo);
    const consData = calcConsumption(sessions);

    let mCost = 0, mKwh = 0, yCost = 0, yKwh = 0, allCost = 0, allKwh = 0, allPvKwh = 0;
    const monthlyKwh = new Array(12).fill(0);
    const monthlyCost = new Array(12).fill(0);
    const monthlySessionsCount = new Array(12).fill(0);
    const monthlyPvKwh = new Array(12).fill(0);

    sessions.forEach(s => {
      const d = new Date(s.date);
      const k = Number(s.kwh) || 0;
      const c = Number(s.totalCost) || 0;
      allCost += c;
      allKwh += k;
      if (s.pvSurplus) allPvKwh += k;

      if (d.getFullYear() === curYear) {
        yCost += c;
        yKwh += k;
        const m = d.getMonth();
        monthlyKwh[m] += k;
        monthlyCost[m] += c;
        monthlySessionsCount[m] += 1;
        if (s.pvSurplus) monthlyPvKwh[m] += k;

        if (m === curMonth) {
          mCost += c;
          mKwh += k;
        }
      }
    });

    const avgPrice = allKwh > 0 ? (allCost / allKwh) : 0.35;
    const pvPct = allKwh > 0 ? Math.round((allPvKwh / allKwh) * 100) : 0;

    let title = "", sub = "", stat1 = {}, stat2 = {}, stat3 = {};
    let chartTitle = "Verlauf", legendHtml = "", listTitle = "Historische Datenpunkte", listHtml = "";
    let chartConfig = null;

    const mSessions = sessions.filter(s => {
      const d = new Date(s.date);
      return d.getFullYear() === curYear && d.getMonth() === curMonth;
    });
    const ySessions = sessions.filter(s => {
      const d = new Date(s.date);
      return d.getFullYear() === curYear;
    });

    if (kpiType === 'month-cost') {
      if (range === 'monthly') {
        // MONATSVERGLEICH (Dynamische Monatsspanne)
        title = `Ladekosten • Monatsvergleich ${curYear}`;
        sub = `Monatliche Kosten & Energiemenge im Kalenderjahr`;

        stat1 = { lbl: "Jahreskosten", val: `${formatDe(yCost)} €` };
        stat2 = { lbl: "Ø / Monat", val: `${formatDe(yCost / Math.max(1, curMonth + 1))} €` };
        stat3 = { lbl: `Im ${monthShorts[curMonth]}`, val: `${formatDe(mCost)} €` };

        chartTitle = `Monatlicher Ladevergleich ${curYear}`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>kWh geladen</span><span class="legend-indicator dot-cyan"></span><span>Kosten (€)</span>`;

        const activeMonthIndices = [];
        ySessions.forEach(s => activeMonthIndices.push(new Date(s.date).getMonth()));
        const rangeInfo = getSmartMonthRange(activeMonthIndices, curYear, curMonth);
        const labels = rangeInfo.labels;
        const kwhVals = rangeInfo.indices.map(m => monthlyKwh[m]);
        const costVals = rangeInfo.indices.map(m => monthlyCost[m]);

        const yLeftBounds = getSmartAxisBounds(kwhVals, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(costVals, 'quantity', false);

        chartConfig = {
          type: 'bar',
          labels: labels,
          datasets: [
            { type: 'bar', label: 'kWh geladen', data: kwhVals, yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kosten (€)', data: costVals, yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'kWh', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: '€', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Monatsaufstellung ${curYear}`;
        listHtml = rangeInfo.indices.map(idx => {
          const isCur = idx === curMonth;
          return `
            <div class="kpi-history-row" style="${isCur ? 'border-color: rgba(192, 128, 81, 0.45); background: rgba(26, 20, 16, 0.7);' : ''}">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${monthNames[idx]} ${curYear} ${isCur ? '⭐ Aktuell' : ''}</span>
                <span class="kpi-hr-sub">${monthlySessionsCount[idx]} Ladungen • ${monthlyKwh[idx].toFixed(1)} kWh geladen</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${formatDe(monthlyCost[idx])} €</span>
                <span class="kpi-hr-extra">${monthlyKwh[idx] > 0 ? (monthlyCost[idx] / monthlyKwh[idx]).toFixed(2) : '0,00'} €/kWh</span>
              </div>
            </div>
          `;
        }).reverse().join('');

      } else {
        // ALLE EINTRÄGE (Einzelladungen des aktuellen Monats)
        title = `Ladekosten • ${monthNames[curMonth]} ${curYear}`;
        sub = `${mSessions.length} Ladevorgänge im laufenden Monat`;

        stat1 = { lbl: "Monatskosten", val: `${formatDe(mCost)} €` };
        stat2 = { lbl: "Geladen", val: `${mKwh.toFixed(1)} kWh` };
        stat3 = { lbl: "Ladungen", val: `${mSessions.length}` };

        chartTitle = `Ladevorgänge im ${monthNames[curMonth]}`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>kWh geladen</span><span class="legend-indicator dot-cyan"></span><span>Kosten (€)</span>`;

        const revSessions = [...mSessions].reverse();
        const labels = revSessions.map(s => {
          const d = new Date(s.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
        const kwhVals = revSessions.map(s => Number(s.kwh) || 0);
        const costVals = revSessions.map(s => Number(s.totalCost) || 0);

        const yLeftBounds = getSmartAxisBounds(kwhVals, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(costVals, 'quantity', false);

        chartConfig = {
          type: 'bar',
          labels: labels.length > 0 ? labels : ['Keine Ladungen'],
          datasets: [
            { type: 'bar', label: 'kWh geladen', data: kwhVals.length > 0 ? kwhVals : [0], yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kosten (€)', data: costVals.length > 0 ? costVals : [0], yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'kWh', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: '€', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Ladevorgänge im ${monthNames[curMonth]}`;
        if (mSessions.length === 0) {
          listHtml = `<div class="kpi-history-row"><div class="kpi-hr-title">In diesem Monat noch keine Ladungen erfasst.</div></div>`;
        } else {
          listHtml = mSessions.map(s => {
            const d = new Date(s.date);
            return `
              <div class="kpi-history-row">
                <div class="kpi-hr-left">
                  <span class="kpi-hr-title">${escapeHtml(s.location)} ${s.pvSurplus ? '☀️' : ''}</span>
                  <span class="kpi-hr-sub">${d.toLocaleDateString('de-DE')} • ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="kpi-hr-right">
                  <span class="kpi-hr-value">${formatDe(s.totalCost)} €</span>
                  <span class="kpi-hr-extra">${s.kwh.toFixed(1)} kWh @ ${s.pricePerKwh.toFixed(2)} €</span>
                </div>
              </div>
            `;
          }).join('');
        }
      }

    } else if (kpiType === 'year-cost') {
      if (range === 'monthly') {
        // MONATSVERGLEICH
        title = `Ladekosten • Gesamtjahr ${curYear}`;
        sub = `Monatsvergleich aller Ladevorgänge`;

        stat1 = { lbl: "Jahreskosten", val: `${formatDe(yCost)} €` };
        stat2 = { lbl: "Jahresenergie", val: `${yKwh.toFixed(1)} kWh` };
        stat3 = { lbl: "Ø / Monat", val: `${formatDe(yCost / Math.max(1, curMonth + 1))} €` };

        chartTitle = `Monatlicher Ladeverlauf ${curYear}`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>kWh</span><span class="legend-indicator dot-cyan"></span><span>Kosten (€)</span>`;

        const activeMonthIndices = [];
        ySessions.forEach(s => activeMonthIndices.push(new Date(s.date).getMonth()));
        const rangeInfo = getSmartMonthRange(activeMonthIndices, curYear, curMonth);
        const labels = rangeInfo.labels;
        const kwhVals = rangeInfo.indices.map(m => monthlyKwh[m]);
        const costVals = rangeInfo.indices.map(m => monthlyCost[m]);

        const yLeftBounds = getSmartAxisBounds(kwhVals, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(costVals, 'quantity', false);

        chartConfig = {
          type: 'bar',
          labels: labels,
          datasets: [
            { type: 'bar', label: 'kWh', data: kwhVals, yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kosten (€)', data: costVals, yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'kWh', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: '€', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Monatsaufstellung ${curYear}`;
        listHtml = rangeInfo.indices.map(idx => {
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${monthNames[idx]} ${curYear}</span>
                <span class="kpi-hr-sub">${monthlySessionsCount[idx]} Ladungen • ${monthlyKwh[idx].toFixed(1)} kWh geladen</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${formatDe(monthlyCost[idx])} €</span>
                <span class="kpi-hr-extra">${monthlyKwh[idx] > 0 ? (monthlyCost[idx] / monthlyKwh[idx]).toFixed(2) : '0,00'} €/kWh</span>
              </div>
            </div>
          `;
        }).reverse().join('');

      } else {
        // ALLE EINTRÄGE (Chronologisch alle Ladungen des Jahres)
        title = `Ladekosten • Alle Ladungen ${curYear}`;
        sub = `${ySessions.length} erfasste Ladevorgänge im gesamten Jahr`;

        stat1 = { lbl: "Ladungen", val: `${ySessions.length}` };
        stat2 = { lbl: "Jahresenergie", val: `${yKwh.toFixed(1)} kWh` };
        stat3 = { lbl: "Jahreskosten", val: `${formatDe(yCost)} €` };

        chartTitle = `Chronologische Ladevorgänge ${curYear}`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>kWh</span><span class="legend-indicator dot-cyan"></span><span>Kosten (€)</span>`;

        const revAll = [...ySessions].reverse();
        const labels = revAll.map(s => {
          const d = new Date(s.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
        const kwhVals = revAll.map(s => Number(s.kwh) || 0);
        const costVals = revAll.map(s => Number(s.totalCost) || 0);

        const yLeftBounds = getSmartAxisBounds(kwhVals, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(costVals, 'quantity', false);

        chartConfig = {
          type: 'bar',
          labels: labels.length > 0 ? labels : ['Keine Ladungen'],
          datasets: [
            { type: 'bar', label: 'kWh', data: kwhVals, yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kosten (€)', data: costVals, yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'kWh', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: '€', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Alle Ladevorgänge ${curYear}`;
        listHtml = ySessions.map(s => {
          const d = new Date(s.date);
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${escapeHtml(s.location)} ${s.pvSurplus ? '☀️' : ''}</span>
                <span class="kpi-hr-sub">${d.toLocaleDateString('de-DE')} • ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${formatDe(s.totalCost)} €</span>
                <span class="kpi-hr-extra">${s.kwh.toFixed(1)} kWh @ ${s.pricePerKwh.toFixed(2)} €</span>
              </div>
            </div>
          `;
        }).join('');
      }

    } else if (kpiType === 'month-distance') {
      const monthSegments = distStats.segments.filter(seg => {
        const d = new Date(seg.date);
        return d.getFullYear() === curYear && d.getMonth() === curMonth;
      });

      if (range === 'monthly') {
        // MONATSVERGLEICH DER FAHRLEISTUNG
        title = `Fahrleistung • Monatsvergleich ${curYear}`;
        sub = `Gefahrene Kilometer je Monat im Kalenderjahr`;

        stat1 = { lbl: "Dieses Jahr", val: `${formatDe(distStats.yearKm)} km` };
        stat2 = { lbl: "Ø / Monat", val: `${distStats.avgKmPerMonth.toFixed(0)} km` };
        stat3 = { lbl: `Im ${monthShorts[curMonth]}`, val: `${formatDe(distStats.monthKm)} km` };

        chartTitle = `Monatliche Fahrstrecke ${curYear}`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>Fahrleistung (km)</span>`;

        const distMonthIndices = [];
        distStats.segments.forEach(seg => {
          const d = new Date(seg.date);
          if (d.getFullYear() === curYear) distMonthIndices.push(d.getMonth());
        });
        const rangeInfo = getSmartMonthRange(distMonthIndices, curYear, curMonth);
        const labels = rangeInfo.labels;
        const distVals = rangeInfo.indices.map(m => monthlyDist[m]);

        const yLeftBounds = getSmartAxisBounds(distVals, 'quantity', true);

        chartConfig = {
          type: 'bar',
          labels: labels,
          datasets: [
            { type: 'bar', label: 'Fahrleistung (km)', data: distVals, yAxisID: 'yLeft', color: 'bronze' }
          ],
          yLeft: { label: 'km', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: null
        };

        listTitle = `Fahrleistung nach Monaten ${curYear}`;
        listHtml = rangeInfo.indices.map(idx => {
          const isCur = idx === curMonth;
          return `
            <div class="kpi-history-row" style="${isCur ? 'border-color: rgba(192, 128, 81, 0.45); background: rgba(26, 20, 16, 0.7);' : ''}">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${monthNames[idx]} ${curYear} ${isCur ? '⭐ Aktuell' : ''}</span>
                <span class="kpi-hr-sub">${monthlyDist[idx] > 0 ? (monthlyDist[idx] / 30).toFixed(1) + ' km / Tag' : 'Keine Fahrten'}</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${monthlyDist[idx] > 0 ? '+' + monthlyDist[idx].toLocaleString('de-DE') + ' km' : '0 km'}</span>
                <span class="kpi-hr-extra">${monthlyDist[idx]} km gesamt</span>
              </div>
            </div>
          `;
        }).reverse().join('');

      } else {
        // ALLE EINTRÄGE (Fahrabschnitte dieses Monats)
        title = `Fahrleistung • ${monthNames[curMonth]} ${curYear}`;
        sub = `${monthSegments.length} erfasste Abschnitte im laufenden Monat`;

        stat1 = { lbl: "Monatsdistanz", val: `${formatDe(distStats.monthKm)} km` };
        stat2 = { lbl: "Ø / Tag", val: `${distStats.avgKmPerDay.toFixed(1).replace('.', ',')} km` };
        stat3 = { lbl: "Fahrabschnitte", val: `${monthSegments.length}` };

        chartTitle = `Gefahrene Kilometer im ${monthNames[curMonth]}`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>Strecke (km)</span><span class="legend-indicator dot-cyan"></span><span>Kumuliert (km)</span>`;

        const labels = monthSegments.map(seg => {
          const d = new Date(seg.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
        const deltas = monthSegments.map(s => s.deltaKm);
        let cum = 0;
        const cumKm = deltas.map(d => { cum += d; return cum; });

        const yLeftBounds = getSmartAxisBounds(deltas, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(cumKm, 'quantity', false);

        chartConfig = {
          type: 'bar',
          labels: labels.length > 0 ? labels : ['Keine Fahrten'],
          datasets: [
            { type: 'bar', label: 'Strecke (km)', data: deltas.length > 0 ? deltas : [0], yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kumuliert (km)', data: cumKm.length > 0 ? cumKm : [0], yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'km', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: 'km', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Fahrabschnitte im ${monthNames[curMonth]}`;
        if (monthSegments.length === 0) {
          listHtml = `<div class="kpi-history-row"><div class="kpi-hr-title">In diesem Monat wurden noch keine Distanzen zwischen Ladevorgängen erfasst.</div></div>`;
        } else {
          listHtml = monthSegments.map(seg => {
            const d = new Date(seg.date);
            return `
              <div class="kpi-history-row">
                <div class="kpi-hr-left">
                  <span class="kpi-hr-title">+${seg.deltaKm.toLocaleString('de-DE')} km gefahren</span>
                  <span class="kpi-hr-sub">${d.toLocaleDateString('de-DE')} • Von ${seg.fromOdo.toLocaleString('de-DE')} auf ${seg.toOdo.toLocaleString('de-DE')} km</span>
                </div>
                <div class="kpi-hr-right">
                  <span class="kpi-hr-value">${seg.deltaKm} km</span>
                  <span class="kpi-hr-extra">${seg.kwh > 0 ? ((seg.kwh / seg.deltaKm) * 100).toFixed(1) + ' kWh/100km' : ''}</span>
                </div>
              </div>
            `;
          }).reverse().join('');
        }
      }

    } else if (kpiType === 'year-distance') {
      if (range === 'monthly') {
        // MONATSVERGLEICH
        title = `Fahrleistung • Gesamtjahr & Kilometerstand`;
        sub = `Jahresdistanz ${curYear} & Gesamtlaufleistung`;

        stat1 = { lbl: "Dieses Jahr", val: `${formatDe(distStats.yearKm)} km` };
        stat2 = { lbl: "Ø / Monat", val: `${distStats.avgKmPerMonth.toFixed(0)} km` };
        stat3 = { lbl: "Kilometerstand", val: `${Number(distStats.totalOdo).toLocaleString('de-DE')} km` };

        chartTitle = `Monatliche Fahrleistung & Kilometerstand`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>Monatsdistanz (km)</span><span class="legend-indicator dot-cyan"></span><span>Kilometerstand</span>`;

        const distMonthIndices = [];
        const monthlyDist = new Array(12).fill(0);
        let latestOdoPerMonth = new Array(12).fill(null);

        distStats.segments.forEach(seg => {
          const d = new Date(seg.date);
          if (d.getFullYear() === curYear) {
            const m = d.getMonth();
            distMonthIndices.push(m);
            monthlyDist[m] += seg.deltaKm;
            latestOdoPerMonth[m] = seg.toOdo;
          }
        });

        let lastKnown = null;
        for (let m = 0; m <= curMonth; m++) {
          if (latestOdoPerMonth[m] !== null) lastKnown = latestOdoPerMonth[m];
          else latestOdoPerMonth[m] = lastKnown;
        }

        const rangeInfo = getSmartMonthRange(distMonthIndices, curYear, curMonth);
        const labels = rangeInfo.labels;
        const distVals = rangeInfo.indices.map(m => monthlyDist[m]);
        const odoVals = rangeInfo.indices.map(m => latestOdoPerMonth[m]).filter(v => v !== null);

        const yLeftBounds = getSmartAxisBounds(distVals, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(odoVals.length > 0 ? odoVals : [distStats.totalOdo], 'odometer', false);

        chartConfig = {
          type: 'bar',
          labels: labels,
          datasets: [
            { type: 'bar', label: 'Distanz (km)', data: distVals, yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kilometerstand', data: rangeInfo.indices.map(m => latestOdoPerMonth[m]), yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'km', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: 'km', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Fahrleistung nach Monaten ${curYear}`;
        listHtml = rangeInfo.indices.map(idx => {
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${monthNames[idx]} ${curYear}</span>
                <span class="kpi-hr-sub">Stand: ${latestOdoPerMonth[idx] ? Number(latestOdoPerMonth[idx]).toLocaleString('de-DE') + ' km' : '--'}</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${monthlyDist[idx] > 0 ? '+' + monthlyDist[idx].toLocaleString('de-DE') + ' km' : '0 km'}</span>
                <span class="kpi-hr-extra">${monthlyDist[idx] > 0 ? (monthlyDist[idx] / 30).toFixed(1) + ' km/Tag' : ''}</span>
              </div>
            </div>
          `;
        }).reverse().join('');

      } else {
        // ALLE EINTRÄGE (Chronologisch alle dokumentierten Abschnitte)
        title = `Fahrleistung • Alle Abschnitte`;
        sub = `${distStats.segments.length} dokumentierte Ladezyklus-Fahrten`;

        stat1 = { lbl: "Erfasst", val: `${formatDe(distStats.totalTrackedKm)} km` };
        stat2 = { lbl: "Abschnitte", val: `${distStats.segments.length}` };
        stat3 = { lbl: "Kilometerstand", val: `${Number(distStats.totalOdo).toLocaleString('de-DE')} km` };

        chartTitle = `Chronologische Fahrabschnitte`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>Strecke (km)</span><span class="legend-indicator dot-cyan"></span><span>Kilometerstand</span>`;

        const allSegs = [...distStats.segments];
        const labels = allSegs.map(s => {
          const d = new Date(s.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
        const deltas = allSegs.map(s => s.deltaKm);
        const odos = allSegs.map(s => s.toOdo);

        const yLeftBounds = getSmartAxisBounds(deltas, 'quantity', true);
        const yRightBounds = getSmartAxisBounds(odos.length > 0 ? odos : [distStats.totalOdo], 'odometer', false);

        chartConfig = {
          type: 'bar',
          labels: labels.length > 0 ? labels : ['Keine Fahrten'],
          datasets: [
            { type: 'bar', label: 'Strecke (km)', data: deltas.length > 0 ? deltas : [0], yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: 'Kilometerstand', data: odos.length > 0 ? odos : [distStats.totalOdo], yAxisID: 'yRight', color: 'cyan' }
          ],
          yLeft: { label: 'km', min: yLeftBounds.min, max: yLeftBounds.max },
          yRight: { label: 'km', min: yRightBounds.min, max: yRightBounds.max }
        };

        listTitle = `Alle dokumentierten Fahrabschnitte`;
        listHtml = distStats.segments.map(seg => {
          const d = new Date(seg.date);
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">+${seg.deltaKm.toLocaleString('de-DE')} km gefahren</span>
                <span class="kpi-hr-sub">${d.toLocaleDateString('de-DE')} • Stand: ${seg.toOdo.toLocaleString('de-DE')} km</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${seg.deltaKm} km</span>
                <span class="kpi-hr-extra">${seg.kwh > 0 ? ((seg.kwh / seg.deltaKm) * 100).toFixed(1) + ' kWh/100km' : ''}</span>
              </div>
            </div>
          `;
        }).reverse().join('');
      }

    } else if (kpiType === 'avg-price') {
      const locMap = {};
      sessions.forEach(s => {
        const loc = s.location || 'Sonstige';
        if (!locMap[loc]) locMap[loc] = { count: 0, kwh: 0, cost: 0, pv: 0 };
        locMap[loc].kwh += Number(s.kwh) || 0;
        locMap[loc].cost += Number(s.totalCost) || 0;
        locMap[loc].count += 1;
        if (s.pvSurplus) locMap[loc].pv += Number(s.kwh) || 0;
      });

      if (range === 'monthly') {
        // MONATSVERGLEICH DES STROMPREISES
        title = `Ø Strompreis • Monatsvergleich`;
        sub = `Monatlicher effektiver Ladepreis vs. 0,35 € Referenz`;

        stat1 = { lbl: "Ø Strompreis", val: `${avgPrice.toFixed(2).replace('.', ',')} €/kWh` };
        stat2 = { lbl: "Solar-Anteil", val: `${pvPct}% PV` };
        stat3 = { lbl: "Netzstrom-Ref", val: `0,35 €/kWh` };

        chartTitle = `Monatlicher Ø Ladepreis (€/kWh)`;
        legendHtml = `<span class="legend-indicator dot-cyan"></span><span>Ø Preis (€/kWh)</span><span class="legend-indicator dot-bronze"></span><span>0.35 € Referenz</span>`;

        const activeMonthIndices = [];
        sessions.forEach(s => {
          const d = new Date(s.date);
          if (d.getFullYear() === curYear) activeMonthIndices.push(d.getMonth());
        });
        const rangeInfo = getSmartMonthRange(activeMonthIndices, curYear, curMonth);
        const labels = rangeInfo.labels;
        const monthlyPrices = rangeInfo.indices.map(idx => {
          return monthlyKwh[idx] > 0 ? Number((monthlyCost[idx] / monthlyKwh[idx]).toFixed(2)) : null;
        });
        const benchmarks = rangeInfo.indices.map(() => 0.35);

        const allPriceVals = [...monthlyPrices.filter(v => v !== null), 0.35];
        const yBounds = getSmartAxisBounds(allPriceVals, 'price', false);

        chartConfig = {
          type: 'line',
          labels: labels,
          datasets: [
            { type: 'line', label: 'Preis (€/kWh)', data: monthlyPrices, yAxisID: 'yLeft', color: 'cyan' },
            { type: 'line', label: '0.35 € Referenz', data: benchmarks, yAxisID: 'yLeft', color: 'bronze', borderDash: [4, 4] }
          ],
          yLeft: { label: '€/kWh', min: yBounds.min, max: yBounds.max },
          yRight: null
        };

        listTitle = `Preisentwicklung nach Monaten`;
        listHtml = rangeInfo.indices.map(idx => {
          const effP = monthlyKwh[idx] > 0 ? (monthlyCost[idx] / monthlyKwh[idx]) : 0;
          const pvP = monthlyKwh[idx] > 0 ? Math.round((monthlyPvKwh[idx] / monthlyKwh[idx]) * 100) : 0;
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${monthNames[idx]} ${curYear}</span>
                <span class="kpi-hr-sub">${monthlyKwh[idx].toFixed(1)} kWh • ${pvP}% Solar-Anteil</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${effP.toFixed(2).replace('.', ',')} €/kWh</span>
                <span class="kpi-hr-extra">${formatDe(monthlyCost[idx])} € gesamt</span>
              </div>
            </div>
          `;
        }).reverse().join('');

      } else {
        // ALLE EINTRÄGE (Nach Standorten & Einzelladungen)
        title = `Ø Strompreis • Alle Ladevorgänge`;
        sub = `Effektiver Ladepreis je Ladung & Standortübersicht`;

        stat1 = { lbl: "Ø Strompreis", val: `${avgPrice.toFixed(2).replace('.', ',')} €/kWh` };
        stat2 = { lbl: "Solar-Anteil", val: `${pvPct}% PV` };
        stat3 = { lbl: "Standorte", val: `${Object.keys(locMap).length}` };

        chartTitle = `Effektiver Ladepreis je Ladevorgang`;
        legendHtml = `<span class="legend-indicator dot-cyan"></span><span>Ladepreis (€/kWh)</span><span class="legend-indicator dot-bronze"></span><span>Ø 0.35 € Referenz</span>`;

        const labels = sorted.map(s => {
          const d = new Date(s.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
        const prices = sorted.map(s => Number(s.pricePerKwh) || 0);
        const benchmarks = sorted.map(() => 0.35);

        const allPriceVals = [...prices, 0.35];
        const yBounds = getSmartAxisBounds(allPriceVals, 'price', false);

        chartConfig = {
          type: 'line',
          labels: labels.length > 0 ? labels : ['Keine Ladungen'],
          datasets: [
            { type: 'line', label: 'Preis (€/kWh)', data: prices.length > 0 ? prices : [0], yAxisID: 'yLeft', color: 'cyan' },
            { type: 'line', label: '0.35 € Referenz', data: benchmarks.length > 0 ? benchmarks : [0.35], yAxisID: 'yLeft', color: 'bronze', borderDash: [4, 4] }
          ],
          yLeft: { label: '€/kWh', min: yBounds.min, max: yBounds.max },
          yRight: null
        };

        listTitle = "Aufschlüsselung nach Ladestandorten";
        listHtml = Object.keys(locMap).map(loc => {
          const item = locMap[loc];
          const effPrice = item.kwh > 0 ? (item.cost / item.kwh) : 0;
          const pvShare = item.kwh > 0 ? Math.round((item.pv / item.kwh) * 100) : 0;
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${escapeHtml(loc)}</span>
                <span class="kpi-hr-sub">${item.count} Ladungen • ${item.kwh.toFixed(1)} kWh • ${pvShare}% PV</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${effPrice.toFixed(2).replace('.', ',')} €/kWh</span>
                <span class="kpi-hr-extra">${formatDe(item.cost)} € gesamt</span>
              </div>
            </div>
          `;
        }).join('');
      }

    } else if (kpiType === 'avg-consumption') {
      const validSegments = distStats.segments.filter(s => s.consumption > 0 && s.consumption < 50);

      if (range === 'monthly') {
        // MONATSVERGLEICH DES VERBRAUCHS (Dynamische Monate & Intelligente Skala)
        title = `Ø Verbrauch • Monatsvergleich`;
        sub = `Monatlicher Durchschnittsverbrauch (kWh/100km)`;

        stat1 = { lbl: "Ø Verbrauch", val: `${consData.hasData ? consData.avgCons.toFixed(1).replace('.', ',') : '--'} kWh` };
        stat2 = { lbl: "Kosten / 100km", val: `${consData.hasData ? consData.avgCost100.toFixed(2).replace('.', ',') : '--'} €` };
        stat3 = { lbl: "Erfasst", val: `${distStats.totalTrackedKm} km` };

        chartTitle = `Monatlicher Durchschnittsverbrauch`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>Verbrauch</span><span class="legend-indicator dot-cyan"></span><span>15.0 Benchmark</span>`;

        const segMonthIndices = [];
        const monthlyConsSum = new Array(12).fill(0);
        const monthlyConsCount = new Array(12).fill(0);

        validSegments.forEach(s => {
          const d = new Date(s.date);
          if (d.getFullYear() === curYear) {
            const m = d.getMonth();
            segMonthIndices.push(m);
            monthlyConsSum[m] += s.consumption;
            monthlyConsCount[m] += 1;
          }
        });

        const rangeInfo = getSmartMonthRange(segMonthIndices, curYear, curMonth);
        const labels = rangeInfo.labels;
        const monthlyCons = rangeInfo.indices.map(idx => {
          return monthlyConsCount[idx] > 0 ? Number((monthlyConsSum[idx] / monthlyConsCount[idx]).toFixed(1)) : null;
        });
        const benchmarks = rangeInfo.indices.map(() => 15.0);

        const allConsVals = [...monthlyCons.filter(v => v !== null), 15.0];
        const yBounds = getSmartAxisBounds(allConsVals, 'consumption', false);

        chartConfig = {
          type: 'line',
          labels: labels,
          datasets: [
            { type: 'line', label: 'Verbrauch (kWh/100km)', data: monthlyCons, yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: '15.0 Benchmark', data: benchmarks, yAxisID: 'yLeft', color: 'cyan', borderDash: [4, 4] }
          ],
          yLeft: { label: 'kWh/100km', min: yBounds.min, max: yBounds.max },
          yRight: null
        };

        listTitle = `Monatliche Verbrauchswerte ${curYear}`;
        listHtml = rangeInfo.indices.map(idx => {
          const avgC = monthlyConsCount[idx] > 0 ? (monthlyConsSum[idx] / monthlyConsCount[idx]) : 0;
          return `
            <div class="kpi-history-row">
              <div class="kpi-hr-left">
                <span class="kpi-hr-title">${monthNames[idx]} ${curYear}</span>
                <span class="kpi-hr-sub">${monthlyConsCount[idx]} Abschnitte erfasst</span>
              </div>
              <div class="kpi-hr-right">
                <span class="kpi-hr-value">${avgC > 0 ? avgC.toFixed(1).replace('.', ',') + ' kWh' : '--'}</span>
                <span class="kpi-hr-extra">je 100 km</span>
              </div>
            </div>
          `;
        }).reverse().join('');

      } else {
        // ALLE EINTRÄGE (Chronologische Abschnitte)
        title = `Ø Verbrauch & Fahrabschnitte`;
        sub = `Verbrauchskurve je Fahrt zwischen zwei Ladungen`;

        stat1 = { lbl: "Ø Verbrauch", val: `${consData.hasData ? consData.avgCons.toFixed(1).replace('.', ',') : '--'} kWh` };
        stat2 = { lbl: "Kosten / 100km", val: `${consData.hasData ? consData.avgCost100.toFixed(2).replace('.', ',') : '--'} €` };
        stat3 = { lbl: "Abschnitte", val: `${validSegments.length}` };

        chartTitle = `Verbrauchskurve je Fahrabschnitt (kWh/100km)`;
        legendHtml = `<span class="legend-indicator dot-bronze"></span><span>Verbrauch</span><span class="legend-indicator dot-cyan"></span><span>15.0 Benchmark</span>`;

        const labels = validSegments.map(s => {
          const d = new Date(s.date);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        });
        const consVals = validSegments.map(s => Number(s.consumption.toFixed(1)));
        const benchmarks = validSegments.map(() => 15.0);

        const allConsVals = [...consVals, 15.0];
        const yBounds = getSmartAxisBounds(allConsVals, 'consumption', false);

        chartConfig = {
          type: 'line',
          labels: labels.length > 0 ? labels : ['Mind. 2 Ladungen nötig'],
          datasets: [
            { type: 'line', label: 'Verbrauch (kWh/100km)', data: consVals.length > 0 ? consVals : [0], yAxisID: 'yLeft', color: 'bronze' },
            { type: 'line', label: '15.0 Benchmark', data: benchmarks, yAxisID: 'yLeft', color: 'cyan', borderDash: [4, 4] }
          ],
          yLeft: { label: 'kWh/100km', min: yBounds.min, max: yBounds.max },
          yRight: null
        };

        listTitle = "Erfasste Verbrauchsabschnitte";
        if (validSegments.length === 0) {
          listHtml = `<div class="kpi-history-row"><div class="kpi-hr-title">Zur Verbrauchsberechnung werden mindestens zwei Ladungen mit erfasstem Kilometerstand benötigt.</div></div>`;
        } else {
          listHtml = validSegments.map(s => {
            const d = new Date(s.date);
            const cost100 = (s.cost / s.deltaKm) * 100;
            return `
              <div class="kpi-history-row">
                <div class="kpi-hr-left">
                  <span class="kpi-hr-title">${s.consumption.toFixed(1).replace('.', ',')} kWh / 100km</span>
                  <span class="kpi-hr-sub">${d.toLocaleDateString('de-DE')} • ${s.deltaKm} km gefahren mit ${s.kwh.toFixed(1)} kWh</span>
                </div>
                <div class="kpi-hr-right">
                  <span class="kpi-hr-value">${cost100.toFixed(2).replace('.', ',')} €</span>
                  <span class="kpi-hr-extra">pro 100 km</span>
                </div>
              </div>
            `;
          }).reverse().join('');
        }
      }
    }

    // Update DOM texts & stats
    DOM.kpiDetailTitle.textContent = title;
    DOM.kpiDetailSub.textContent = sub;
    DOM.kpiChartTitle.textContent = chartTitle;
    DOM.kpiChartLegendBox.innerHTML = legendHtml;
    DOM.kpiHistoryListTitle.textContent = listTitle;
    DOM.kpiHistoryListItems.innerHTML = listHtml;

    DOM.kpiDetailStatsRow.innerHTML = `
      <div class="kpi-mini-stat-card">
        <span class="kpi-mini-label">${stat1.lbl}</span>
        <span class="kpi-mini-value">${stat1.val}</span>
      </div>
      <div class="kpi-mini-stat-card">
        <span class="kpi-mini-label">${stat2.lbl}</span>
        <span class="kpi-mini-value bronze-val">${stat2.val}</span>
      </div>
      <div class="kpi-mini-stat-card">
        <span class="kpi-mini-label">${stat3.lbl}</span>
        <span class="kpi-mini-value">${stat3.val}</span>
      </div>
    `;

    // Render Chart
    renderKpiDetailChart(chartConfig);
  }

  function renderKpiDetailChart(cfg) {
    if (!DOM.canvasKpiDetailChart || typeof Chart === 'undefined' || !cfg) return;
    if (chartKpiDetail) {
      chartKpiDetail.destroy();
      chartKpiDetail = null;
    }

    const ctx = DOM.canvasKpiDetailChart.getContext('2d');
    const bronzeFill = ctx.createLinearGradient(0, 0, 0, 200);
    bronzeFill.addColorStop(0, 'rgba(226, 142, 78, 0.85)');
    bronzeFill.addColorStop(1, 'rgba(192, 128, 81, 0.1)');

    const hasRightAxis = !!cfg.yRight;

    const datasets = (cfg.datasets || []).map(d => {
      const isBronze = d.color === 'bronze';
      const targetAxis = (hasRightAxis && (d.yAxisID === 'yRight' || d.yAxisID === 'yCost')) ? 'yRight' : 'yLeft';

      if (d.type === 'bar') {
        return {
          type: 'bar',
          label: d.label,
          data: d.data,
          backgroundColor: isBronze ? bronzeFill : 'rgba(56, 189, 248, 0.75)',
          borderColor: isBronze ? '#c08051' : '#38bdf8',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: targetAxis,
          order: 2
        };
      } else {
        return {
          type: 'line',
          label: d.label,
          data: d.data,
          borderColor: isBronze ? '#c08051' : '#38bdf8',
          backgroundColor: 'transparent',
          borderWidth: 2.2,
          pointBackgroundColor: isBronze ? '#c08051' : '#38bdf8',
          pointBorderColor: '#ffffff',
          pointRadius: 3,
          tension: 0.3,
          borderDash: d.borderDash || [],
          yAxisID: targetAxis,
          order: 1
        };
      }
    });

    const scales = {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: {
          color: 'rgba(226, 232, 240, 0.75)',
          font: { size: 10, weight: '500' },
          padding: 8,
          maxTicksLimit: 12
        }
      },
      yLeft: {
        position: 'left',
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: {
          color: '#c08051',
          font: { size: 9 },
          padding: 6,
          callback: v => `${Number.isInteger(v) ? v : (Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1))} ${cfg.yLeft?.label || ''}`
        }
      }
    };
    if (cfg.yLeft) {
      if (typeof cfg.yLeft.min === 'number') scales.yLeft.min = cfg.yLeft.min;
      if (typeof cfg.yLeft.max === 'number') scales.yLeft.max = cfg.yLeft.max;
    }

    if (hasRightAxis) {
      scales.yRight = {
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: {
          color: '#38bdf8',
          font: { size: 9 },
          padding: 6,
          callback: v => `${Number.isInteger(v) ? v : (Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1))} ${cfg.yRight?.label || ''}`
        }
      };
      if (cfg.yRight) {
        if (typeof cfg.yRight.min === 'number') scales.yRight.min = cfg.yRight.min;
        if (typeof cfg.yRight.max === 'number') scales.yRight.max = cfg.yRight.max;
      }
    }

    chartKpiDetail = new Chart(ctx, {
      type: cfg.type || 'bar',
      data: {
        labels: cfg.labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
          axis: 'x'
        },
        layout: {
          padding: {
            top: 8,
            bottom: 24,
            left: 6,
            right: 6
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(6, 10, 16, 0.96)',
            cornerRadius: 8,
            titleColor: '#ffffff',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            padding: 8,
            titleFont: { size: 11, weight: '700' },
            bodyFont: { size: 10.5 },
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            callbacks: {
              label: (c) => {
                const ds = c.dataset;
                const unit = ds.yAxisID === 'yRight' ? (cfg.yRight?.label || '') : (cfg.yLeft?.label || '');
                const val = c.parsed.y;
                if (val === undefined || val === null) return '';
                const fmtVal = Number.isInteger(val) ? val : (Math.abs(val) < 1 ? val.toFixed(2) : val.toFixed(1));
                return ` ${ds.label || ''}: ${fmtVal} ${unit}`.trim();
              }
            }
          }
        },
        scales: scales
      }
    });
  }

  // =========================================================================
  // TAB 2: LADEN & HISTORIE
  // =========================================================================
  function renderLocationFilterRail() {
    if (!DOM.chargingFilterRail) return;

    const locs = appData.settings.locations || [];
    let html = `<button class="chip-filter ${activeChargingFilter === 'all' ? 'active' : ''}" data-filter="all">Alle</button>`;

    locs.forEach(loc => {
      const isAct = activeChargingFilter === loc.name;
      html += `<button class="chip-filter ${isAct ? 'active' : ''}" data-filter="${escapeHtml(loc.name)}">${loc.icon || '📍'} ${escapeHtml(loc.name)}</button>`;
    });

    html += `<button class="chip-filter chip-pv ${activeChargingFilter === 'pv' ? 'active' : ''}" data-filter="pv">☀️ Nur PV</button>`;
    DOM.chargingFilterRail.innerHTML = html;

    DOM.chargingFilterRail.querySelectorAll('.chip-filter').forEach(chip => {
      chip.addEventListener('click', () => {
        activeChargingFilter = chip.getAttribute('data-filter');
        renderLocationFilterRail();
        renderChargesStream();
        triggerHaptic();
      });
    });
  }

  function renderChargesStream() {
    if (!DOM.chargesStreamContainer) return;

    let list = [...appData.sessions];
    if (activeChargingFilter !== 'all') {
      if (activeChargingFilter === 'pv') list = list.filter(s => s.pvSurplus);
      else list = list.filter(s => s.location === activeChargingFilter);
    }

    if (list.length === 0) {
      DOM.chargesStreamContainer.innerHTML = `
        <div class="swift-glass-card" style="text-align:center; padding: 32px 16px; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 8px;">⚡️</div>
          <div style="font-weight: 700; color: #fff;">Keine Ladevorgänge gefunden</div>
          <div style="font-size: 0.76rem; margin-top: 4px;">Tippe unten auf das ＋, um einen Ladevorgang einzutragen.</div>
        </div>
      `;
      return;
    }

    DOM.chargesStreamContainer.innerHTML = list.map(s => {
      const d = new Date(s.date);
      const dStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const tStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const deltaInfo = getSessionDelta(s);
      const locObj = appData.settings.locations.find(l => l.name === s.location);
      const locIcon = locObj ? locObj.icon : '📍';

      return `
        <div class="swift-glass-card session-swift-card" data-id="${s.id}">
          <div class="session-top-meta">
            <span class="session-timestamp">${dStr} • ${tStr}</span>
            <div class="session-badges-wrap">
              <span class="loc-badge-item">${locIcon} ${escapeHtml(s.location)}</span>
              ${s.pvSurplus ? '<span class="pv-badge-item">☀️ PV</span>' : ''}
            </div>
          </div>

          <div class="session-primary-row">
            <div class="session-kwh-display">
              <span class="session-kwh-val">${s.kwh.toFixed(1)}</span>
              <span class="session-kwh-unit">kWh</span>
            </div>
            <div class="session-cost-val">${formatDe(s.totalCost)} €</div>
          </div>

          <div class="session-details-row">
            <div>
              <span>📍 ${s.odometer ? s.odometer.toLocaleString('de-DE') + ' km' : 'km nicht notiert'}</span>
              ${deltaInfo.deltaKm > 0 ? `<span class="delta-tag-live" style="margin-left: 6px;">+${deltaInfo.deltaKm} km</span>` : ''}
            </div>
            <div>
              <span>${s.pricePerKwh.toFixed(2).replace('.', ',')} €/kWh</span>
              ${deltaInfo.consumption ? `<span style="margin-left: 4px; color: var(--cupra-bronze-light);">(${deltaInfo.consumption.toFixed(1)} kWh/100)</span>` : ''}
            </div>
          </div>

          ${s.notes ? `<div class="session-note-text">„${escapeHtml(s.notes)}“</div>` : ''}

          <div class="session-actions-bar">
            <button class="btn-card-action btn-edit-charge" data-id="${s.id}">✏️ Bearbeiten</button>
            <button class="btn-card-action danger btn-del-charge" data-id="${s.id}">🗑️ Löschen</button>
          </div>
        </div>
      `;
    }).join('');

    DOM.chargesStreamContainer.querySelectorAll('.btn-edit-charge').forEach(btn => {
      btn.addEventListener('click', () => openModalCharge(btn.getAttribute('data-id')));
    });

    DOM.chargesStreamContainer.querySelectorAll('.btn-del-charge').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteCharge(btn.getAttribute('data-id')));
    });
  }

  function getSessionDelta(curr) {
    const sorted = [...appData.sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const idx = sorted.findIndex(s => s.id === curr.id);
    if (idx > 0 && curr.odometer) {
      const prev = sorted[idx - 1];
      if (prev.odometer && curr.odometer > prev.odometer) {
        const delta = curr.odometer - prev.odometer;
        const cons = (curr.kwh / delta) * 100;
        return { deltaKm: delta, consumption: cons };
      }
    }
    return { deltaKm: 0, consumption: null };
  }

  function handleDeleteCharge(id) {
    if (!confirm('Diesen Ladevorgang wirklich löschen?')) return;
    appData.sessions = appData.sessions.filter(s => s.id !== id);
    saveData();
    renderAll();
    triggerHaptic();
    showToast('Ladevorgang gelöscht');

    // Cloud-Sync: Löscht nur exakt dieses Ereignis aus Google Sheets
    deleteCloudSession(id);
  }

  // =========================================================================
  // TAB 2: AUSWERTUNGEN & CHART.JS
  // =========================================================================
  function renderAnalyticsCharts() {
    if (typeof Chart === 'undefined') return;
    renderMainBarLineChart();
    renderDonutCharts();
  }

  function renderMainBarLineChart() {
    if (!DOM.canvasChargingChart) return;
    if (chartMain) { chartMain.destroy(); chartMain = null; }

    const { labels, kwhVals, costVals, sub } = getAggregatedChartData(activeAnalyticsPeriod);
    DOM.analyticsSubtitle.textContent = sub;

    const ctx = DOM.canvasChargingChart.getContext('2d');
    const bronzeGrad = ctx.createLinearGradient(0, 0, 0, 240);
    bronzeGrad.addColorStop(0, 'rgba(226, 142, 78, 0.9)');
    bronzeGrad.addColorStop(1, 'rgba(192, 128, 81, 0.2)');

    const kwhBounds = getSmartAxisBounds(kwhVals, 'quantity', true);
    const costBounds = getSmartAxisBounds(costVals, 'quantity', false);

    chartMain = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'kWh',
            data: kwhVals,
            backgroundColor: bronzeGrad,
            borderColor: '#c08051',
            borderWidth: 1.5,
            borderRadius: 6,
            yAxisID: 'yKwh',
            order: 2
          },
          {
            type: 'line',
            label: 'Kosten (€)',
            data: costVals,
            borderColor: '#38bdf8',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointBackgroundColor: '#38bdf8',
            pointBorderColor: '#ffffff',
            pointRadius: 3.5,
            tension: 0.35,
            yAxisID: 'yCost',
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
          axis: 'x'
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(6, 10, 16, 0.96)',
            titleColor: '#ffffff',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 8,
            titleFont: { size: 11, weight: '700' },
            bodyFont: { size: 10.5 },
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            callbacks: {
              label: (c) => c.datasetIndex === 0 ? ` Strom: ${c.parsed.y.toFixed(1)} kWh` : ` Kosten: ${c.parsed.y.toFixed(2)} €`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: 'rgba(226, 232, 240, 0.6)', font: { size: 10 } }
          },
          yKwh: {
            position: 'left',
            min: kwhBounds.min,
            max: kwhBounds.max,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#c08051', font: { size: 10 }, callback: v => `${Number.isInteger(v) ? v : v.toFixed(1)} kWh` }
          },
          yCost: {
            position: 'right',
            min: costBounds.min,
            max: costBounds.max,
            grid: { drawOnChartArea: false },
            ticks: { color: '#38bdf8', font: { size: 10 }, callback: v => `${Number.isInteger(v) ? v : v.toFixed(2)} €` }
          }
        }
      }
    });
  }

  function getAggregatedChartData(period) {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth();

    if (period === 'month') {
      const daysInMonth = new Date(cy, cm + 1, 0).getDate();
      const kMap = {}, cMap = {};
      const daysWithData = [];
      appData.sessions.forEach(s => {
        const d = new Date(s.date);
        if (d.getFullYear() === cy && d.getMonth() === cm) {
          const day = d.getDate();
          daysWithData.push(day);
          kMap[day] = (kMap[day] || 0) + s.kwh;
          cMap[day] = (cMap[day] || 0) + s.totalCost;
        }
      });
      const maxDay = Math.min(daysInMonth, Math.max(now.getDate(), ...daysWithData, 1));
      const labels = [];
      const kwhVals = [];
      const costVals = [];
      for (let i = 1; i <= maxDay; i++) {
        labels.push(`${i}.`);
        kwhVals.push(kMap[i] || 0);
        costVals.push(cMap[i] || 0);
      }
      return {
        labels,
        kwhVals,
        costVals,
        sub: `Tagesverlauf 1. – ${maxDay}. ${now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`
      };
    }

    if (period === 'year') {
      const activeIndices = [];
      appData.sessions.forEach(s => {
        const d = new Date(s.date);
        if (d.getFullYear() === cy) activeIndices.push(d.getMonth());
      });
      const range = getSmartMonthRange(activeIndices, cy, cm);
      const monthlyK = Array(12).fill(0);
      const monthlyC = Array(12).fill(0);
      appData.sessions.forEach(s => {
        const d = new Date(s.date);
        if (d.getFullYear() === cy) {
          const m = d.getMonth();
          monthlyK[m] += s.kwh;
          monthlyC[m] += s.totalCost;
        }
      });
      return {
        labels: range.labels,
        kwhVals: range.indices.map(m => monthlyK[m]),
        costVals: range.indices.map(m => monthlyC[m]),
        sub: range.labels.length > 1 ? `${range.labels[0]} bis ${range.labels[range.labels.length - 1]} ${cy}` : `Monat ${range.labels[0]} ${cy}`
      };
    }

    const yMap = {};
    appData.sessions.forEach(s => {
      const y = new Date(s.date).getFullYear();
      if (!yMap[y]) yMap[y] = { kwh: 0, cost: 0 };
      yMap[y].kwh += s.kwh;
      yMap[y].cost += s.totalCost;
    });
    const years = Object.keys(yMap).sort();
    if (years.length === 0) years.push(cy.toString());

    return {
      labels: years,
      kwhVals: years.map(y => yMap[y] ? yMap[y].kwh : 0),
      costVals: years.map(y => yMap[y] ? yMap[y].cost : 0),
      sub: 'Jahresvergleich aller Ladungen'
    };
  }

  function renderDonutCharts() {
    if (chartLocDonut) { chartLocDonut.destroy(); chartLocDonut = null; }
    const locMap = {};
    appData.settings.locations.forEach(l => locMap[l.name] = 0);
    appData.sessions.forEach(s => {
      const l = s.location || 'Bayrhofs';
      locMap[l] = (locMap[l] || 0) + s.kwh;
    });

    const locLabels = Object.keys(locMap);
    const locVals = Object.values(locMap);
    const locPalette = ['#c08051', '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

    const ctxLoc = DOM.canvasLocationDonut.getContext('2d');
    chartLocDonut = new Chart(ctxLoc, {
      type: 'doughnut',
      data: {
        labels: locLabels,
        datasets: [{
          data: locVals.every(v => v === 0) ? [1] : locVals,
          backgroundColor: locVals.every(v => v === 0) ? ['#334155'] : locPalette.slice(0, locLabels.length),
          borderWidth: 0,
          cutout: '74%'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(6, 10, 16, 0.96)',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 8,
            callbacks: {
              label: (c) => ` ${c.label}: ${c.raw.toFixed(1)} kWh`
            }
          }
        }
      }
    });

    const sumLoc = locVals.reduce((a, b) => a + b, 0);
    DOM.locationDonutLegend.innerHTML = locLabels.map((l, i) => {
      const val = locMap[l];
      const pct = sumLoc > 0 ? Math.round((val / sumLoc) * 100) : 0;
      return `
        <div class="donut-legend-item">
          <span style="display:flex; align-items:center; gap: 4px;">
            <span style="width:7px; height:7px; border-radius:50%; background:${locPalette[i % locPalette.length]}"></span>
            ${escapeHtml(l)}
          </span>
          <span><strong>${val.toFixed(1)}k</strong> (${pct}%)</span>
        </div>
      `;
    }).join('');

    if (chartSrcDonut) { chartSrcDonut.destroy(); chartSrcDonut = null; }
    let pvK = 0, gridK = 0;
    appData.sessions.forEach(s => {
      if (s.pvSurplus) pvK += s.kwh;
      else gridK += s.kwh;
    });

    const ctxSrc = DOM.canvasSourceDonut.getContext('2d');
    chartSrcDonut = new Chart(ctxSrc, {
      type: 'doughnut',
      data: {
        labels: ['PV-Solar', 'Netz'],
        datasets: [{
          data: (pvK === 0 && gridK === 0) ? [1] : [pvK, gridK],
          backgroundColor: (pvK === 0 && gridK === 0) ? ['#334155'] : ['#10b981', '#0284c7'],
          borderWidth: 0,
          cutout: '74%'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(6, 10, 16, 0.96)',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 8,
            callbacks: {
              label: (c) => ` ${c.label}: ${c.raw.toFixed(1)} kWh`
            }
          }
        }
      }
    });

    const sumSrc = pvK + gridK;
    const pvP = sumSrc > 0 ? Math.round((pvK / sumSrc) * 100) : 0;
    DOM.sourceDonutLegend.innerHTML = `
      <div class="donut-legend-item">
        <span style="color:#10b981;">● PV-Solar</span>
        <span><strong>${pvK.toFixed(1)} kWh</strong> (${pvP}%)</span>
      </div>
      <div class="donut-legend-item">
        <span style="color:#0284c7;">● Netzstrom</span>
        <span><strong>${gridK.toFixed(1)} kWh</strong> (${100 - pvP}%)</span>
      </div>
    `;
  }

  // =========================================================================
  // TAB 3: WETTER & BAYRHOFS BÜRO PROGNOSE (EXAKTE ICONS & L/M² EINHEIT)
  // =========================================================================
  function autoRequestGpsAndFetchWeather(forceNotification = false) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          appData.settings.weatherGps.lat = Number(pos.coords.latitude.toFixed(4));
          appData.settings.weatherGps.lon = Number(pos.coords.longitude.toFixed(4));
          appData.settings.weatherGps.name = "GPS: Bayrhofs Umgebung";
          saveData();
          fetchWeatherCluster(forceNotification);
        },
        () => {
          fetchWeatherCluster(forceNotification);
        },
        { timeout: 5000 }
      );
    } else {
      fetchWeatherCluster(forceNotification);
    }
  }

  async function fetchWeatherCluster(showFeedback = false) {
    const loc = appData.settings.weatherGps || DEFAULT_DATA.settings.weatherGps;
    DOM.weatherDisplayLocation.textContent = `📍 ${loc.name}`;

    // Abfrage mit daily (inkl. sunrise, sunset, precipitation_sum in mm = l/m²) und hourly für Stundengraphen!
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,sunshine_duration,precipitation_sum,sunrise,sunset&hourly=temperature_2m,precipitation,sunshine_duration,weather_code&forecast_days=14&timezone=auto`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      if (json && json.daily && json.daily.time) {
        weatherForecast14Days = processWeatherForecast(json.daily, json.hourly);
        saveWeatherCache(weatherForecast14Days);
        renderWeatherViews();
        updateDashboardPvDecisionWidget();
        if (showFeedback) showToast('Wetterdaten aktualisiert ☀️');
        return;
      }
    } catch (err) {
      console.warn('Wetterabfrage fehlgeschlagen, nutze Cache oder Simulation:', err);
    }

    if (!weatherForecast14Days) {
      weatherForecast14Days = generateSynthetic14Days();
      saveWeatherCache(weatherForecast14Days);
    }
    renderWeatherViews();
    updateDashboardPvDecisionWidget();
  }

  function getFallbackSunTimes(dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date();
    const m = d.getMonth();
    const table = [
      { rise: '08:00', set: '16:50' },
      { rise: '07:30', set: '17:35' },
      { rise: '06:35', set: '18:25' },
      { rise: '06:30', set: '20:10' },
      { rise: '05:45', set: '20:55' },
      { rise: '05:20', set: '21:25' },
      { rise: '05:35', set: '21:15' },
      { rise: '06:15', set: '20:30' },
      { rise: '07:00', set: '19:30' },
      { rise: '07:35', set: '18:35' },
      { rise: '07:30', set: '16:45' },
      { rise: '08:00', set: '16:25' }
    ];
    return table[m] || { rise: '07:30', set: '18:35' };
  }

  function processWeatherForecast(daily, hourly) {
    const list = [];
    const threshold = appData.settings.pvThresholdSunshineHours || 4.5;

    for (let i = 0; i < daily.time.length; i++) {
      const dateStr = daily.time[i];
      const d = new Date(dateStr);
      const sunshineHours = Number(((daily.sunshine_duration[i] || 0) / 3600).toFixed(1));
      const rainMm = Number((daily.precipitation_sum ? daily.precipitation_sum[i] : 0).toFixed(1)); // mm = l/m²
      const tMax = Math.round(daily.temperature_2m_max[i]);
      const tMin = Math.round(daily.temperature_2m_min[i]);
      const code = daily.weather_code[i];

      let sunrise = (daily.sunrise && daily.sunrise[i]) ? daily.sunrise[i].slice(11, 16) : null;
      let sunset = (daily.sunset && daily.sunset[i]) ? daily.sunset[i].slice(11, 16) : null;
      if (!sunrise || !sunset) {
        const fb = getFallbackSunTimes(d);
        sunrise = sunrise || fb.rise;
        sunset = sunset || fb.set;
      }

      // Exaktes Wetter-Icon & Zustand abgestimmt auf Sonnenstunden UND Niederschlag!
      const wInfo = determineAccurateWeatherIcon(sunshineHours, rainMm, code);
      const icon = wInfo.icon;
      const conditionText = wInfo.conditionText;

      // Bayrhofs PV-Logik (Laden immer möglich, ideal kombiniert mit Büro)
      const dayOfWeek = d.getDay();
      const isWorkday = (dayOfWeek >= 1 && dayOfWeek <= 5);
      const hasPvSurplus = sunshineHours >= threshold;

      let decision = 'home';
      let badgeLabel = '🏠 Homeoffice';
      let hintText = `Wenig Sonne (${sunshineHours}h). Fahrt zu Bayrhofs lohnt sich heute nicht.`;

      if (!isWorkday) {
        if (hasPvSurplus) {
          decision = 'weekend_charge';
          badgeLabel = '⚡️ Bayrhofs PV';
          hintText = `Hoher Solarertrag (${sunshineHours}h Sonne). Ladung bei Bayrhofs auch am Wochenende möglich!`;
        } else {
          decision = 'weekend';
          badgeLabel = '🛋️ Wochenende';
          hintText = `Wochenende mit wenig Sonne (${sunshineHours}h). Kaum PV-Überschuss bei Bayrhofs.`;
        }
      } else if (hasPvSurplus) {
        decision = 'office';
        badgeLabel = '🏢 Büro & Laden';
        hintText = `Hoher PV-Überschuss (${sunshineHours}h Sonne). Ideal: Arbeit im Büro mit Laden bei Bayrhofs verbinden!`;
      } else {
        decision = 'home';
        badgeLabel = '🏠 Homeoffice';
        hintText = `Wenig Sonne (${sunshineHours}h). Kein PV-Überschuss bei Bayrhofs – Homeoffice empfohlen.`;
      }

      // Stündliche Daten für diesen Tag extrahieren
      const hourlyData = extractHourlyDataForDay(hourly, dateStr);

      list.push({
        dateIndex: i,
        dateStr,
        dayName: d.toLocaleDateString('de-DE', { weekday: 'short' }),
        dateDisplay: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
        sunshineHours,
        rainMm, // l/m²
        tMax,
        tMin,
        sunrise,
        sunset,
        icon,
        conditionText,
        decision,
        badgeLabel,
        hintText,
        hasPvSurplus,
        hourlyData
      });
    }
    return list;
  }

  function extractHourlyDataForDay(hourly, dateStr) {
    if (!hourly || !hourly.time) return generateSyntheticHourly(dateStr);

    const hours = [];
    for (let j = 0; j < hourly.time.length; j++) {
      if (hourly.time[j].startsWith(dateStr)) {
        const timePart = hourly.time[j].slice(11, 16);
        const hourNum = parseInt(timePart.slice(0, 2), 10);
        const sunSec = hourly.sunshine_duration ? (hourly.sunshine_duration[j] || 0) : 0;
        const sunHours = Number((sunSec / 3600).toFixed(2));
        const rain = Number((hourly.precipitation ? (hourly.precipitation[j] || 0) : 0).toFixed(1));
        const temp = Math.round(hourly.temperature_2m ? hourly.temperature_2m[j] : 15);
        const code = hourly.weather_code ? hourly.weather_code[j] : 0;

        let icon;
        if (hourNum < 6 || hourNum >= 21) {
          if (code >= 95) icon = '⛈️';
          else if ((code >= 71 && code <= 77) || code === 85 || code === 86) icon = '🌨️';
          else if (rain >= 0.5) icon = '🌧️';
          else if (rain > 0) icon = '🌧️';
          else if (code >= 45 && code <= 48) icon = FOG_ICON_HTML;
          else if (code === 3) icon = '☁️';
          else if (code === 2) icon = '☁️';
          else icon = '🌙';
        } else {
          const hInfo = determineAccurateWeatherIcon(sunHours > 0.5 ? 7 : (sunHours > 0.1 ? 3 : 0.5), rain, code);
          icon = hInfo.icon;
        }

        hours.push({
          time: timePart,
          hour: hourNum,
          sunHours,
          rain,
          temp,
          icon
        });
      }
    }

    return hours.length === 24 ? hours : generateSyntheticHourly(dateStr);
  }

  function generateSyntheticHourly(dateStr) {
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const isDay = (h >= 7 && h <= 19);
      const sunHours = isDay ? Number((Math.sin(((h - 7) / 12) * Math.PI) * 0.9).toFixed(2)) : 0;
      const rain = (h >= 14 && h <= 16) ? 0.3 : 0.0;
      const temp = Math.round(8 + (isDay ? Math.sin(((h - 7) / 12) * Math.PI) * 9 : 0));
      let icon;
      if (!isDay) {
        icon = rain > 0 ? '🌧️' : '🌙';
      } else {
        const hInfo = determineAccurateWeatherIcon(sunHours * 8, rain, rain > 0 ? 80 : 0);
        icon = hInfo.icon;
      }

      hours.push({
        time: `${String(h).padStart(2, '0')}:00`,
        hour: h,
        sunHours,
        rain,
        temp,
        icon
      });
    }
    return hours;
  }

  function generateSynthetic14Days() {
    const list = [];
    const now = new Date();
    const threshold = appData.settings.pvThresholdSunshineHours || 4.5;

    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getDay();
      const isWorkday = (dayOfWeek >= 1 && dayOfWeek <= 5);

      const sunshineHours = Number((Math.sin(i * 0.9) * 4 + 5.5).toFixed(1));
      const rainMm = Number(((Math.cos(i * 1.3) + 1) * 0.8).toFixed(1));
      const hasPvSurplus = sunshineHours >= threshold;
      const wInfo = determineAccurateWeatherIcon(sunshineHours, rainMm, hasPvSurplus ? 0 : 3);
      const icon = wInfo.icon;
      const conditionText = wInfo.conditionText;

      let decision = 'home';
      let badgeLabel = '🏠 Homeoffice';
      let hintText = `Wenig Sonne (${sunshineHours}h). Fahrt zu Bayrhofs lohnt sich heute nicht.`;

      if (!isWorkday) {
        if (hasPvSurplus) {
          decision = 'weekend_charge';
          badgeLabel = '⚡️ Bayrhofs PV';
          hintText = `Hoher Solarertrag (${sunshineHours}h Sonne). Ladung bei Bayrhofs auch am Wochenende möglich!`;
        } else {
          decision = 'weekend';
          badgeLabel = '🛋️ Wochenende';
          hintText = `Wochenende mit wenig Sonne (${sunshineHours}h). Kaum PV-Überschuss bei Bayrhofs.`;
        }
      } else if (hasPvSurplus) {
        decision = 'office';
        badgeLabel = '🏢 Büro & Laden';
        hintText = `Hoher PV-Überschuss (${sunshineHours}h Sonne). Ideal: Arbeit im Büro mit Laden bei Bayrhofs verbinden!`;
      } else {
        decision = 'home';
        badgeLabel = '🏠 Homeoffice';
        hintText = `Wenig Sonne (${sunshineHours}h). Kein PV-Überschuss bei Bayrhofs – Homeoffice empfohlen.`;
      }

      const fb = getFallbackSunTimes(d);
      list.push({
        dateIndex: i,
        dateStr,
        dayName: d.toLocaleDateString('de-DE', { weekday: 'short' }),
        dateDisplay: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
        sunshineHours,
        rainMm,
        tMax: Math.round(18 + Math.sin(i) * 5),
        tMin: Math.round(9 + Math.sin(i) * 3),
        sunrise: fb.rise,
        sunset: fb.set,
        icon,
        conditionText,
        decision,
        badgeLabel,
        hintText,
        hasPvSurplus,
        hourlyData: generateSyntheticHourly(dateStr)
      });
    }
    return list;
  }

  const FOG_ICON_HTML = `<svg class="weather-icon-svg" viewBox="0 0 36 36" width="26" height="26"><defs><linearGradient id="fogCloudGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e2e8f0"/><stop offset="100%" stop-color="#94a3b8"/></linearGradient></defs><path fill="url(#fogCloudGrad)" d="M28.5 19a5.5 5.5 0 0 0-4.66-8.42A7.5 7.5 0 0 0 10 14a6 6 0 0 0-4 5.67C6 22.6 8.4 25 11.33 25h17.17A4.5 4.5 0 0 0 33 20.5 4.5 4.5 0 0 0 28.5 19z"/><path stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round" d="M7 28h22M11 32h14"/></svg>`;

  /**
   * Präzise Icon- & Zustands-Bestimmung abgestimmt auf Sonnenstunden, Niederschlag und WMO-Code.
   * Tage mit 6h+ Sonne zeigen NIEMALS ein reines Regen-, Wolken- oder Nebel-Icon!
   * Nebel wird sauber als Vektor-Icon gerendert, niemals als weißer Kasten.
   */
  function determineAccurateWeatherIcon(sunshineHours, rainMm, code) {
    const sun = Number(sunshineHours) || 0;
    const rain = Number(rainMm) || 0;
    const c = (code !== undefined && code !== null) ? Number(code) : 0;

    // 1. Schwere Unwetter / Gewitter (WMO 95, 96, 99)
    if (c >= 95) {
      if (sun >= 4.0) {
        return { icon: '⛈️', conditionText: 'Sonne & Gewitter' };
      }
      return { icon: '⛈️', conditionText: c >= 96 ? 'Gewitter mit Hagel' : 'Gewitter' };
    }

    // 2. Schnee / Schneeschauer (WMO 71-77, 85-86, gefrierender Regen)
    if ((c >= 71 && c <= 77) || c === 85 || c === 86 || c === 56 || c === 57 || c === 66 || c === 67) {
      if (c === 77) return { icon: '🌨️', conditionText: 'Schneegriesel' };
      if (c === 85 || c === 86) return { icon: '🌨️', conditionText: 'Schneeschauer' };
      if (c === 56 || c === 57 || c === 66 || c === 67) return { icon: '🌨️', conditionText: 'Gefrierender Regen' };
      return { icon: '🌨️', conditionText: 'Schneefall' };
    }

    // 3. Hohe Sonnenscheindauer (>= 6.0 Stunden) -> IMMER primär sonnig!
    // Hinweis: Morgendlicher Frühnebel (Code 45/48) verzieht sich rasch – bei 6-10h Sonne ist der Tag sonnig!
    if (sun >= 6.0) {
      if (rain >= 2.0) {
        return { icon: '🌦️', conditionText: 'Sonne & Schauer' };
      }
      if (rain >= 0.5) {
        return { icon: '🌤️', conditionText: 'Heiter, Schauer' };
      }
      return { icon: '☀️', conditionText: 'Sonnig' };
    }

    // 4. Mäßige Sonnenscheindauer (4.0 bis 5.9 Stunden)
    if (sun >= 4.0) {
      if (rain >= 2.5) {
        return { icon: '🌦️', conditionText: 'Regenschauer' };
      }
      if (rain >= 0.6) {
        return { icon: '⛅', conditionText: 'Wechselhaft' };
      }
      return { icon: '🌤️', conditionText: 'Heiter' };
    }

    // 5. Teils Sonne (2.0 bis 3.9 Stunden)
    if (sun >= 2.0) {
      if (rain >= 1.5) {
        return { icon: '🌧️', conditionText: 'Regen' };
      }
      if (rain >= 0.4) {
        return { icon: '🌦️', conditionText: 'Schauer' };
      }
      if (c === 45 || c === 48) {
        return { icon: FOG_ICON_HTML, conditionText: 'Hochnebel' };
      }
      return { icon: '⛅', conditionText: 'Teils sonnig' };
    }

    // 6. Sehr wenig Sonne (< 2.0 Stunden)
    if (rain >= 2.5 || c === 65 || c === 82) {
      return { icon: '🌧️', conditionText: 'Starkregen' };
    }
    if (rain >= 0.5 || (c >= 61 && c <= 63) || (c >= 80 && c <= 81)) {
      return { icon: '🌧️', conditionText: 'Regnerisch' };
    }
    if (rain > 0 || (c >= 51 && c <= 55)) {
      return { icon: '🌧️', conditionText: 'Nieselregen' };
    }
    if (c === 45 || c === 48) {
      return { icon: FOG_ICON_HTML, conditionText: 'Nebel' };
    }
    if (c === 3) {
      return { icon: '☁️', conditionText: 'Dicht bewölkt' };
    }
    return { icon: '☁️', conditionText: 'Bedeckt' };
  }

  function renderWeatherViews() {
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;

    const pvDays = weatherForecast14Days.filter(d => d.hasPvSurplus);
    const officeDays = weatherForecast14Days.filter(d => d.decision === 'office');
    const weekendDays = weatherForecast14Days.filter(d => d.decision === 'weekend_charge');
    
    let summaryText = `In den kommenden 14 Tagen gibt es an <strong>${pvDays.length} Tagen PV-Überschuss</strong> bei Bayrhofs`;
    if (officeDays.length > 0) {
      summaryText += ` (${officeDays.length}x ideal mit Büro kombinierbar`;
      if (weekendDays.length > 0) {
        summaryText += `, ${weekendDays.length}x am Wochenende`;
      }
      summaryText += `).`;
    } else if (weekendDays.length > 0) {
      summaryText += ` (${weekendDays.length}x am Wochenende nutzbar).`;
    } else {
      summaryText += `.`;
    }
    DOM.pvSummaryRecommendationText.innerHTML = summaryText;

    // 4 Tage Default
    const primary4 = weatherForecast14Days.slice(0, 4);
    DOM.weatherPrimary4Container.innerHTML = primary4.map((item, idx) => createDayCardHtml(item, idx === 0)).join('');

    // Weitere 10 Tage
    const extended10 = weatherForecast14Days.slice(4);
    DOM.weatherExtendedContainer.innerHTML = extended10.map(item => createDayCardHtml(item, false)).join('');

    // Klick Event für alle Tage: Stündlichen Wettergraphen öffnen!
    bindDayCardClickEvents();
  }

  function createDayCardHtml(item, isToday) {
    const isOffice = item.decision === 'office';
    const isWeekendCharge = item.decision === 'weekend_charge';
    const highlightClass = isOffice ? 'highlight-office' : (isWeekendCharge ? 'highlight-weekend-charge' : '');
    const badgeClass = isOffice ? 'reco-tag-office' : (isWeekendCharge ? 'reco-tag-weekend-charge' : 'reco-tag-home');

    return `
      <div class="swift-glass-card day-forecast-card ${highlightClass}" data-dayindex="${item.dateIndex}">
        <div class="day-left-meta">
          <span class="day-name">${isToday ? 'Heute' : item.dayName}</span>
          <span class="day-date-sub">${item.dateDisplay}</span>
        </div>

        <div class="day-weather-icon-box">
          <span class="day-weather-icon">${item.icon}</span>
        </div>

        <div class="day-mid-weather">
          <div class="day-temp-row">
            <span class="day-temps">${item.tMax}° / ${item.tMin}°</span>
            <span class="day-condition-label">• ${item.conditionText || 'Sonnig'}</span>
          </div>
          <div class="day-stats-row">
            <span class="day-sun-stat">☀️ ${item.sunshineHours}h</span>
            <span class="day-rain-stat">💧 ${item.rainMm} l/m²</span>
          </div>
        </div>

        <div class="day-right-badge">
          <span class="${badgeClass}">${item.badgeLabel}</span>
        </div>
      </div>
    `;
  }

  function bindDayCardClickEvents() {
    document.querySelectorAll('.day-forecast-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-dayindex'), 10);
        openHourlyWeatherModal(idx);
      });
    });
  }

  function updateDashboardPvDecisionWidget() {
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;
    const today = weatherForecast14Days[0];

    DOM.dashPvIconCircle.innerHTML = today.icon;
    DOM.dashRecoHeadline.innerHTML = `Heute: <strong>${today.sunshineHours}h Sonne</strong> <span class="rain-sub-stat">💧 ${today.rainMm} l/m²</span>`;

    if (today.decision === 'office') {
      DOM.dashRecoSubline.textContent = `PV-Überschuss bei Bayrhofs vorhanden. Ideal: Büro-Tag mit Laden verbinden!`;
      DOM.dashRecoBadge.textContent = '🏢 Büro & Laden';
      DOM.dashRecoBadge.className = 'reco-badge-pill office';
    } else if (today.decision === 'weekend_charge') {
      DOM.dashRecoSubline.textContent = `PV-Überschuss am Wochenende! Fahrt zu Bayrhofs zum Laden lohnt sich.`;
      DOM.dashRecoBadge.textContent = '⚡️ Bayrhofs PV';
      DOM.dashRecoBadge.className = 'reco-badge-pill office';
    } else if (today.decision === 'weekend') {
      DOM.dashRecoSubline.textContent = `Wochenende mit wenig Sonne. Kaum PV-Ertrag bei Bayrhofs.`;
      DOM.dashRecoBadge.textContent = '🛋️ Wochenende';
      DOM.dashRecoBadge.className = 'reco-badge-pill';
    } else {
      DOM.dashRecoSubline.textContent = `Wenig/Kein PV-Überschuss. Heute lohnt sich Büro-Laden nicht (Homeoffice).`;
      DOM.dashRecoBadge.textContent = '🏠 Homeoffice';
      DOM.dashRecoBadge.className = 'reco-badge-pill home';
    }
  }

  // =========================================================================
  // MODAL: STÜNDLICHER WETTERVERLAUF EINES TAGES
  // =========================================================================
  function openHourlyWeatherModal(dayIndex) {
    const day = weatherForecast14Days && weatherForecast14Days[dayIndex];
    if (!day) return;

    DOM.hourlyModalTitle.textContent = `${day.dayName}, ${day.dateDisplay}`;
    DOM.hourlyModalSub.textContent = `${day.conditionText || 'Prognose'} • 24-Stunden Verlauf für Bayrhofs`;

    DOM.hourlyTotalSun.textContent = `${day.sunshineHours} h`;
    DOM.hourlyTotalRain.textContent = `${day.rainMm} l/m²`;
    DOM.hourlyTempRange.textContent = `${day.tMax}° / ${day.tMin}°`;
    if (DOM.hourlySunrise) DOM.hourlySunrise.textContent = day.sunrise || '--:--';
    if (DOM.hourlySunset) DOM.hourlySunset.textContent = day.sunset || '--:--';

    if (DOM.hourlyChartLegendBox) {
      DOM.hourlyChartLegendBox.innerHTML = `
        <span class="subtle-leg-item">
          <span class="legend-indicator dot-bronze" style="width: 14px; height: 3px; border-radius: 2px;"></span>
          <span>Sonnenschein</span>
        </span>
        <span class="subtle-leg-item">
          <span class="legend-indicator dot-cyan" style="width: 7px; height: 7px; border-radius: 2px;"></span>
          <span>Niederschlag</span>
        </span>
      `;
    }

    if (day.decision === 'office') {
      DOM.hourlyDecisionIcon.textContent = '🏢';
      DOM.hourlyDecisionTitle.textContent = 'Büro & PV-Laden bei Bayrhofs!';
    } else if (day.decision === 'weekend_charge') {
      DOM.hourlyDecisionIcon.textContent = '⚡️';
      DOM.hourlyDecisionTitle.textContent = 'Wochenend-Ladung bei Bayrhofs!';
    } else if (day.decision === 'weekend') {
      DOM.hourlyDecisionIcon.textContent = '🛋️';
      DOM.hourlyDecisionTitle.textContent = 'Wochenende (Geringe Solarausbeute)';
    } else {
      DOM.hourlyDecisionIcon.textContent = '🏠';
      DOM.hourlyDecisionTitle.textContent = 'Homeoffice empfohlen';
    }
    DOM.hourlyDecisionDesc.textContent = day.hintText;

    // Modal FIRST öffnen damit Canvas echte Pixelmaße hat
    DOM.modalHourlyWeather.classList.add('open');

    // Stündlichen Chart.js Graph zeichnen mit dynamischer Sonnenaufgang/untergang Markerlinie
    renderHourlyWeatherChart(day.hourlyData, day.sunrise, day.sunset);

    // Stündliche Kapseln rendern
    const sunriseHour = day.sunrise ? parseInt(day.sunrise.split(':')[0], 10) : -1;
    const sunsetHour = day.sunset ? parseInt(day.sunset.split(':')[0], 10) : -1;

    DOM.hourlyHoursScroll.innerHTML = day.hourlyData.map(h => {
      const isRise = (h.hour === sunriseHour);
      const isSet = (h.hour === sunsetHour);
      let sunEventBadge = '';
      if (isRise) sunEventBadge = `<span style="font-size:0.58rem; color:#f59e0b; font-weight:800;">🌅 ${day.sunrise}</span>`;
      else if (isSet) sunEventBadge = `<span style="font-size:0.58rem; color:#f97316; font-weight:800;">🌇 ${day.sunset}</span>`;

      return `
        <div class="hourly-hour-card ${isRise || isSet ? 'sun-event-hour' : ''}">
          <span class="hh-time">${h.time}</span>
          ${sunEventBadge}
          <span class="hh-icon">${h.icon}</span>
          <span class="hh-temp">${h.temp}°</span>
          <span class="hh-solar">☀️ ${(h.sunHours * 60).toFixed(0)}m</span>
          <span class="hh-rain">${h.rain > 0 ? `💧 ${h.rain}l` : '-'}</span>
        </div>
      `;
    }).join('');

    requestAnimationFrame(() => {
      if (chartHourly) chartHourly.resize();
    });
    setTimeout(() => {
      if (chartHourly) {
        chartHourly.resize();
        chartHourly.update('none');
      }
    }, 100);

    triggerHaptic();
  }

  function closeHourlyModal() {
    DOM.modalHourlyWeather.classList.remove('open');
  }

  function renderHourlyWeatherChart(hours, sunriseTime, sunsetTime) {
    if (!DOM.canvasHourlyChart || typeof Chart === 'undefined') return;
    if (chartHourly) { chartHourly.destroy(); chartHourly = null; }

    const labels = hours.map(h => h.time);
    const sunData = hours.map(h => Number((h.sunHours * 60).toFixed(0))); // Minuten Sonne
    const rainData = hours.map(h => h.rain); // l/m²

    const ctx = DOM.canvasHourlyChart.getContext('2d');
    const bronzeFill = ctx.createLinearGradient(0, 0, 0, 190);
    bronzeFill.addColorStop(0, 'rgba(245, 158, 11, 0.45)');
    bronzeFill.addColorStop(0.5, 'rgba(226, 142, 78, 0.22)');
    bronzeFill.addColorStop(1, 'rgba(192, 128, 81, 0.02)');

    const sunTimesMarkerPlugin = {
      id: 'sunTimesMarkerPlugin',
      afterDatasetsDraw(chart) {
        const { ctx: c, chartArea, scales: { x } } = chart;
        if (!chartArea || !x) return;
        const { top, bottom, left, right } = chartArea;

        const parseTimeToX = (timeStr) => {
          if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
          const parts = timeStr.split(':');
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          if (isNaN(h) || isNaN(m)) return null;
          const frac = Math.max(0, Math.min(23, h + (m / 60)));
          const fIdx = Math.floor(frac);
          const cIdx = Math.min(23, Math.ceil(frac));
          const pFloor = x.getPixelForValue(fIdx);
          const pCeil = x.getPixelForValue(cIdx);
          return pFloor + (pCeil - pFloor) * (frac - fIdx);
        };

        const xSunrise = parseTimeToX(sunriseTime);
        const xSunset = parseTimeToX(sunsetTime);

        const drawMarker = (xPos, label, color) => {
          if (xPos === null || isNaN(xPos) || xPos < left || xPos > right) return;

          c.save();

          // 1. Vertikale gestrichelte Marker-Linie
          c.beginPath();
          c.setLineDash([4, 4]);
          c.lineWidth = 1.5;
          c.strokeStyle = color;
          c.moveTo(xPos, top + 18);
          c.lineTo(xPos, bottom);
          c.stroke();

          // 2. Kleiner leuchtender Punkt am Fuße der Linie
          c.beginPath();
          c.setLineDash([]);
          c.arc(xPos, bottom, 3, 0, Math.PI * 2);
          c.fillStyle = color;
          c.fill();

          // 3. Pill-Badge am oberen Ende der Linie (vor Tooltip gezeichnet)
          c.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          const text = label;
          const textWidth = c.measureText(text).width;
          const badgeW = textWidth + 8;
          const badgeH = 15;
          const badgeX = Math.max(left + 2, Math.min(right - badgeW - 2, xPos - (badgeW / 2)));
          const badgeY = top + 2;

          c.beginPath();
          const r = 4;
          if (c.roundRect) {
            c.roundRect(badgeX, badgeY, badgeW, badgeH, r);
          } else {
            c.rect(badgeX, badgeY, badgeW, badgeH);
          }
          c.fillStyle = 'rgba(10, 15, 24, 0.94)';
          c.fill();
          c.lineWidth = 1;
          c.strokeStyle = color;
          c.stroke();

          c.fillStyle = color;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, badgeX + (badgeW / 2), badgeY + (badgeH / 2));

          c.restore();
        };

        if (sunriseTime) drawMarker(xSunrise, `🌅 ${sunriseTime}`, '#f59e0b');
        if (sunsetTime) drawMarker(xSunset, `🌇 ${sunsetTime}`, '#f97316');
      }
    };

    chartHourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            label: 'Sonne (Minuten)',
            data: sunData,
            borderColor: '#e28e4e',
            backgroundColor: bronzeFill,
            borderWidth: 2.8,
            pointBackgroundColor: '#e28e4e',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            pointRadius: (ctxItem) => (ctxItem.raw && ctxItem.raw > 0) ? 3 : 0,
            pointHoverRadius: 5.5,
            pointHoverBackgroundColor: '#f59e0b',
            pointHoverBorderColor: '#ffffff',
            tension: 0.38,
            fill: 'start',
            yAxisID: 'ySun',
            order: 1
          },
          {
            type: 'bar',
            label: 'Regen (l/m²)',
            data: rainData,
            backgroundColor: 'rgba(56, 189, 248, 0.75)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.45,
            categoryPercentage: 0.8,
            yAxisID: 'yRain',
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
          axis: 'x'
        },
        layout: {
          padding: {
            top: 24,
            bottom: 4,
            left: 4,
            right: 4
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(6, 10, 16, 0.96)',
            cornerRadius: 8,
            titleColor: '#ffffff',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            padding: 8,
            titleFont: { size: 11, weight: '700' },
            bodyFont: { size: 10.5 },
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            callbacks: {
              title: (items) => `${items[0]?.label || ''} Uhr`,
              label: (c) => {
                if (c.datasetIndex === 0) return ` ☀️ Sonnenschein: ${c.parsed.y} Min / Std`;
                return ` 💧 Niederschlag: ${c.parsed.y} l/m²`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: 'rgba(226, 232, 240, 0.6)', font: { size: 9 }, maxTicksLimit: 12 }
          },
          ySun: {
            position: 'left',
            max: 60,
            min: 0,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#c08051', font: { size: 9 }, callback: v => `${v}m` }
          },
          yRain: {
            position: 'right',
            min: 0,
            max: Math.max(2, Math.ceil(Math.max(...(rainData || [0])) * 1.3)),
            grid: { display: false },
            ticks: { color: '#38bdf8', font: { size: 9 }, callback: v => `${Number.isInteger(v) ? v : v.toFixed(1)} l` }
          }
        }
      },
      plugins: [sunTimesMarkerPlugin]
    });
  }

  // =========================================================================
  // TAB 4: STANDORTE IM APPLE EDIT MODE (MINIMALER STIFT)
  // =========================================================================
  function renderLocationsManageList() {
    if (!DOM.locationsDragList) return;

    const locs = appData.settings.locations || [];
    DOM.locationsDragList.innerHTML = locs.map((loc, idx) => `
      <div class="loc-manage-row ${isLocationsEditMode ? 'edit-mode' : ''}" data-id="${loc.id}" data-index="${idx}">
        <div class="loc-row-left">
          <button type="button" class="btn-del-circle" data-id="${loc.id}" title="Löschen">⛔</button>
          <span class="loc-icon-bubble">${loc.icon || '🏢'}</span>
          <div class="loc-info-texts">
            <span class="loc-title-text">${escapeHtml(loc.name)}</span>
            <span class="loc-badges-sub">
              <span class="${loc.powerType === 'pv' ? 'badge-powertype-pv' : 'badge-powertype-grid'}">
                ${loc.powerType === 'pv' ? '☀️ PV-Strom' : '⚡️ Netzstrom'}
              </span>
              <span>•</span>
              <span>${loc.kwhPrice.toFixed(2).replace('.', ',')} €/kWh</span>
            </span>
          </div>
        </div>

        ${isLocationsEditMode ? `
          <div class="loc-order-controls">
            <button type="button" class="btn-order-arrow btn-up" data-index="${idx}" ${idx === 0 ? 'disabled style="opacity:0.2"' : ''}>▲</button>
            <button type="button" class="btn-order-arrow btn-down" data-index="${idx}" ${idx === locs.length - 1 ? 'disabled style="opacity:0.2"' : ''}>▼</button>
          </div>
        ` : `
          <span class="loc-chevron-edit">›</span>
        `}
      </div>
    `).join('');

    bindLocationManageEvents();
  }

  function bindLocationManageEvents() {
    // Normaler Modus: Klick auf Zeile öffnet Editor
    DOM.locationsDragList.querySelectorAll('.loc-manage-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (isLocationsEditMode) return;
        const id = row.getAttribute('data-id');
        openLocationEditorModal(id);
      });
    });

    // Löschen Button im Bearbeitungsmodus
    DOM.locationsDragList.querySelectorAll('.btn-del-circle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        handleDeleteLocation(id);
      });
    });

    // Sortieren mit Pfeilen ▲ und ▼
    DOM.locationsDragList.querySelectorAll('.btn-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.getAttribute('data-index'), 10);
        if (i > 0) {
          const item = appData.settings.locations.splice(i, 1)[0];
          appData.settings.locations.splice(i - 1, 0, item);
          saveData();
          renderLocationsManageList();
          renderLocationFilterRail();
          triggerHaptic();
        }
      });
    });

    DOM.locationsDragList.querySelectorAll('.btn-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.getAttribute('data-index'), 10);
        if (i < appData.settings.locations.length - 1) {
          const item = appData.settings.locations.splice(i, 1)[0];
          appData.settings.locations.splice(i + 1, 0, item);
          saveData();
          renderLocationsManageList();
          renderLocationFilterRail();
          triggerHaptic();
        }
      });
    });
  }

  function handleDeleteLocation(id) {
    if (appData.settings.locations.length <= 1) {
      showToast('Mindestens ein Standort muss erhalten bleiben');
      return;
    }
    const loc = appData.settings.locations.find(l => l.id === id);
    if (!confirm(`Standort "${loc?.name}" wirklich löschen?`)) return;

    appData.settings.locations = appData.settings.locations.filter(l => l.id !== id);
    saveData();
    renderLocationsManageList();
    renderLocationFilterRail();
    triggerHaptic();
    showToast('Standort gelöscht');
  }

  // =========================================================================
  // LOCATION EDITOR MODAL
  // =========================================================================
  function openLocationEditorModal(editId = null) {
    renderIconPickerGrid();

    if (editId) {
      const loc = appData.settings.locations.find(l => l.id === editId);
      if (loc) {
        DOM.locEditId.value = loc.id;
        DOM.modalEditLocationTitle.textContent = "Standort anpassen";
        DOM.locEditName.value = loc.name;
        DOM.locEditIcon.value = loc.icon || '🏢';
        DOM.locEditPowerType.value = loc.powerType || 'pv';
        DOM.locEditPrice.value = loc.kwhPrice;

        highlightSelectedIcon(loc.icon || '🏢');
        highlightPowerType(loc.powerType || 'pv');
      }
    } else {
      DOM.locEditId.value = '';
      DOM.modalEditLocationTitle.textContent = "Neuen Ladeort anlegen";
      DOM.locEditName.value = '';
      DOM.locEditIcon.value = '🏢';
      DOM.locEditPowerType.value = 'pv';
      DOM.locEditPrice.value = '0.15';

      highlightSelectedIcon('🏢');
      highlightPowerType('pv');
    }

    DOM.modalEditLocation.classList.add('open');
    triggerHaptic();
  }

  function closeLocationEditorModal() {
    DOM.modalEditLocation.classList.remove('open');
  }

  function renderIconPickerGrid() {
    DOM.iconPickerGrid.innerHTML = AVAILABLE_ICONS.map(ic => `
      <button type="button" class="icon-pick-btn" data-icon="${ic}">${ic}</button>
    `).join('');

    DOM.iconPickerGrid.querySelectorAll('.icon-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const icon = btn.getAttribute('data-icon');
        DOM.locEditIcon.value = icon;
        highlightSelectedIcon(icon);
        triggerHaptic();
      });
    });
  }

  function highlightSelectedIcon(icon) {
    DOM.iconPickerGrid.querySelectorAll('.icon-pick-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-icon') === icon);
    });
  }

  function highlightPowerType(type) {
    DOM.locPowerTypePicker.querySelectorAll('.picker-seg').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-powertype') === type);
    });
    DOM.locEditPowerType.value = type;
  }

  function handleSaveLocationEditor(e) {
    e.preventDefault();

    const id = DOM.locEditId.value;
    const name = DOM.locEditName.value.trim();
    const icon = DOM.locEditIcon.value || '🏢';
    const powerType = DOM.locEditPowerType.value || 'pv';
    const price = parseFloat(DOM.locEditPrice.value) || 0.15;

    if (!name) return;

    if (id) {
      const idx = appData.settings.locations.findIndex(l => l.id === id);
      if (idx !== -1) {
        appData.settings.locations[idx] = { id, name, icon, powerType, kwhPrice: price };
      }
    } else {
      appData.settings.locations.push({
        id: `loc_${Date.now()}`,
        name,
        icon,
        powerType,
        kwhPrice: price
      });
    }

    saveData();
    closeLocationEditorModal();
    renderLocationsManageList();
    renderLocationFilterRail();
    triggerHaptic();
    showToast(`Standort "${name}" gespeichert ✓`);
  }

  // =========================================================================
  // TOUCH ACTION SHEET LOCATION PICKER FÜR LADE-MODAL
  // =========================================================================
  function openLocationPickerSheet() {
    const locs = appData.settings.locations || [];
    const currentId = DOM.entryLocationId.value || locs[0]?.id;

    DOM.pickerLocationsList.innerHTML = locs.map(loc => {
      const isSel = loc.id === currentId;
      return `
        <div class="touch-picker-item ${isSel ? 'selected' : ''}" data-id="${loc.id}">
          <div class="touch-picker-item-left">
            <span class="touch-item-icon">${loc.icon || '🏢'}</span>
            <div class="touch-item-texts">
              <span class="touch-item-name">${escapeHtml(loc.name)}</span>
              <span class="touch-item-details">
                ${loc.powerType === 'pv' ? '☀️ PV-Strom' : '⚡️ Netzstrom'} • ${loc.kwhPrice.toFixed(2).replace('.', ',')} €/kWh
              </span>
            </div>
          </div>
          ${isSel ? '<span class="touch-item-check">✓</span>' : ''}
        </div>
      `;
    }).join('');

    DOM.pickerLocationsList.querySelectorAll('.touch-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        selectLocationForEntry(id);
        closeLocationPickerSheet();
        triggerHaptic();
      });
    });

    DOM.modalLocationPickerSheet.classList.add('open');
    triggerHaptic();
  }

  function closeLocationPickerSheet() {
    DOM.modalLocationPickerSheet.classList.remove('open');
  }

  function selectLocationForEntry(locId) {
    const loc = appData.settings.locations.find(l => l.id === locId) || appData.settings.locations[0];
    if (!loc) return;

    DOM.entryLocationId.value = loc.id;
    DOM.pickerSelectedIcon.textContent = loc.icon || '🏢';
    DOM.pickerSelectedTitle.textContent = loc.name;
    DOM.pickerSelectedSub = `${loc.powerType === 'pv' ? '☀️ PV-Strom' : '⚡️ Netzstrom'} • ${loc.kwhPrice.toFixed(2).replace('.', ',')} €/kWh`;

    DOM.entryPrice.value = loc.kwhPrice.toFixed(2);
    calculateModalCost();
  }

  // =========================================================================
  // MODAL BOTTOM SHEET: LADEVORGANG ERFASSEN
  // =========================================================================
  function openModalCharge(editId = null) {
    DOM.formChargeEntry.reset();
    DOM.entryEditId.value = '';

    const latestOdo = getLatestOdometer();
    const defaultLoc = appData.settings.locations[0] || DEFAULT_LOCATIONS[0];

    if (editId) {
      const s = appData.sessions.find(x => x.id === editId);
      if (s) {
        DOM.entryEditId.value = s.id;
        DOM.modalChargeTitle.textContent = "Ladung bearbeiten";
        DOM.entryDateTime.value = formatDateTimeLocal(new Date(s.date));
        DOM.entryKwh.value = s.kwh;
        DOM.entryOdometer.value = s.odometer || '';
        DOM.entryPrice.value = s.pricePerKwh;
        DOM.entryTotalCost.value = s.totalCost.toFixed(2);
        DOM.entryNotes.value = s.notes || '';

        const matchingLoc = appData.settings.locations.find(l => l.name === s.location) || defaultLoc;
        selectLocationForEntry(matchingLoc.id);
      }
    } else {
      DOM.modalChargeTitle.textContent = "Ladevorgang erfassen";
      DOM.entryDateTime.value = formatDateTimeLocal(new Date());
      DOM.entryOdometer.value = latestOdo || '';

      selectLocationForEntry(defaultLoc.id);
    }

    calculateModalOdoDelta();
    calculateModalCost();

    DOM.modalAddCharge.classList.add('open');
    triggerHaptic();
  }

  function closeModalCharge() {
    DOM.modalAddCharge.classList.remove('open');
  }

  function calculateModalCost() {
    const k = parseFloat(DOM.entryKwh.value) || 0;
    const p = parseFloat(DOM.entryPrice.value) || 0;
    DOM.entryTotalCost.value = (k * p).toFixed(2);
  }

  function calculateModalOdoDelta() {
    const curOdo = parseInt(DOM.entryOdometer.value, 10);
    const editId = DOM.entryEditId.value;

    let base = 0;
    const sorted = [...appData.sessions].filter(s => s.id !== editId).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length > 0 && sorted[0].odometer) base = sorted[0].odometer;
    else base = appData.vehicle.currentOdo || 0;

    if (!isNaN(curOdo) && curOdo > base && base > 0) {
      DOM.entryDeltaKmTag.textContent = `+${curOdo - base} km`;
    } else {
      DOM.entryDeltaKmTag.textContent = '+0 km';
    }
  }

  function getLatestOdometer() {
    if (appData.sessions.length > 0) {
      const withO = appData.sessions.filter(s => s.odometer > 0);
      if (withO.length > 0) return withO[0].odometer;
    }
    return appData.vehicle.currentOdo || 0;
  }

  function handleSaveChargeEntry(e) {
    e.preventDefault();

    const editId = DOM.entryEditId.value;
    const dt = DOM.entryDateTime.value || new Date().toISOString();
    const kwh = parseFloat(DOM.entryKwh.value) || 0;
    const odo = parseInt(DOM.entryOdometer.value, 10) || 0;
    const price = parseFloat(DOM.entryPrice.value) || 0.35;
    const total = parseFloat(DOM.entryTotalCost.value) || (kwh * price);
    const notes = DOM.entryNotes.value.trim();

    const locId = DOM.entryLocationId.value;
    const locObj = appData.settings.locations.find(l => l.id === locId) || appData.settings.locations[0];
    const locName = locObj ? locObj.name : 'Bayrhofs';
    const isPv = locObj ? locObj.powerType === 'pv' : false;

    if (kwh <= 0) {
      showToast('⚠️ Bitte Lademenge in kWh eingeben');
      return;
    }

    let savedSession = null;
    if (editId) {
      const idx = appData.sessions.findIndex(s => s.id === editId);
      if (idx !== -1) {
        appData.sessions[idx] = {
          id: editId,
          date: new Date(dt).toISOString(),
          kwh,
          odometer: odo,
          pricePerKwh: price,
          totalCost: total,
          location: locName,
          pvSurplus: isPv,
          notes
        };
        savedSession = appData.sessions[idx];
      }
    } else {
      savedSession = {
        id: `session_${Date.now()}`,
        date: new Date(dt).toISOString(),
        kwh,
        odometer: odo,
        pricePerKwh: price,
        totalCost: total,
        location: locName,
        pvSurplus: isPv,
        notes
      };
      appData.sessions.push(savedSession);
    }

    // Kilometerstand automatisch addieren / fortschreiben
    if (odo > (appData.vehicle.currentOdo || 0)) {
      appData.vehicle.currentOdo = odo;
    }

    appData.sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    saveData();
    closeModalCharge();
    renderAll();
    triggerHaptic();
    showToast(editId ? 'Ladung aktualisiert ✓' : 'Ladevorgang gespeichert ⚡️');

    // Im Hintergrund an Google Sheets senden (Optimistic UI)
    if (savedSession) {
      postCloudSession(savedSession, editId ? 'update' : 'create');
    }
  }

  // =========================================================================
  // FAHRZEUG-EINSTELLUNGEN
  // =========================================================================
  function renderSettingsForms() {
    const v = appData.vehicle;
    DOM.cfgModelName.value = v.model;
    DOM.cfgBatteryCap.value = v.batteryKwh;
    DOM.cfgPower.value = v.powerPs;

    if (DOM.inputCloudApiUrl) {
      DOM.inputCloudApiUrl.value = getCloudApiUrl();
    }
  }

  function handleSaveVehicleSettings() {
    appData.vehicle.model = DOM.cfgModelName.value.trim() || DEFAULT_DATA.vehicle.model;
    appData.vehicle.batteryKwh = parseFloat(DOM.cfgBatteryCap.value) || 52.0;
    appData.vehicle.powerPs = parseInt(DOM.cfgPower.value, 10) || 211;

    saveData();
    renderDashboard();
    triggerHaptic();
    showToast('Fahrzeugdaten aktualisiert ✓');
  }

  // =========================================================================
  // BACKUP & RESTORE
  // =========================================================================
  function handleExportJson() {
    const jsonStr = JSON.stringify(appData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);

    const a = document.createElement('a');
    a.href = url;
    a.download = `cupra_raval_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    triggerHaptic();
    showToast('Backup exportiert 📤');
  }

  function handleImportJson(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        appData = sanitizeAndMigrate(imported);
        saveData();
        renderAll();
        triggerHaptic();
        showToast('Backup erfolgreich importiert! 📥');
      } catch (err) {
        showToast('❌ Ungültige Backup-Datei');
      }
      DOM.importJsonInput.value = '';
    };
    reader.readAsText(file);
  }

  function handleLoadSampleData() {
    if (!confirm('Beispieldaten für den Cupra Raval Endurance Edition Dynamic laden?')) return;

    const now = new Date();
    const demo = [
      {
        id: `demo_${Date.now()}_1`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 14, 20).toISOString(),
        kwh: 34.5,
        odometer: 12450,
        pricePerKwh: 0.15,
        totalCost: 5.18,
        location: "Bayrhofs",
        pvSurplus: true,
        notes: "100% PV-Überschuss bei Bayrhofs"
      },
      {
        id: `demo_${Date.now()}_2`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 4, 11, 45).toISOString(),
        kwh: 28.0,
        odometer: 12240,
        pricePerKwh: 0.20,
        totalCost: 5.60,
        location: "Arbeit",
        pvSurplus: true,
        notes: "Bürotag Donnerstag"
      },
      {
        id: `demo_${Date.now()}_3`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8, 18, 15).toISOString(),
        kwh: 41.2,
        odometer: 12050,
        pricePerKwh: 0.15,
        totalCost: 6.18,
        location: "Bayrhofs",
        pvSurplus: true,
        notes: "Sonniger Tag bei Bayrhofs"
      },
      {
        id: `demo_${Date.now()}_4`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14, 10, 30).toISOString(),
        kwh: 31.5,
        odometer: 11780,
        pricePerKwh: 0.32,
        totalCost: 10.08,
        location: "Zuhause",
        pvSurplus: false,
        notes: "Nachtladung Wallbox"
      },
      {
        id: `demo_${Date.now()}_5`,
        date: new Date(now.getFullYear(), now.getMonth() - 1, 18, 16, 10).toISOString(),
        kwh: 38.5,
        odometer: 11620,
        pricePerKwh: 0.59,
        totalCost: 22.72,
        location: "Öffentlich",
        pvSurplus: false,
        notes: "HPC Schnelllader Autobahn"
      }
    ];

    appData.sessions = demo;
    appData.vehicle.currentOdo = 12450;
    saveData();
    renderAll();
    triggerHaptic();
    showToast('✨ Beispieldaten geladen');
  }

  function handleWipeAllData() {
    if (!confirm('⚠️ Wirklich ALLE Daten löschen und zurücksetzen?')) return;
    appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
    saveData();
    renderAll();
    triggerHaptic();
    showToast('Daten auf Werkseinstellungen zurückgesetzt');
  }

  // =========================================================================
  // FORMATIERUNG & TOAST
  // =========================================================================
  function formatDe(num) {
    return Number(num || 0).toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatDateTimeLocal(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let toastTimer = null;
  function showToast(msg) {
    if (!DOM.swiftToast) return;
    DOM.swiftToastMsg.textContent = msg;
    DOM.swiftToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      DOM.swiftToast.classList.remove('show');
    }, 2500);
  }

})();
