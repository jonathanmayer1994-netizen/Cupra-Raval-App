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
  const WEATHER_CACHE_KEY = 'cupra_weather_cache_v8';
  const CURRENT_SCHEMA = 4;
  const DEFAULT_GOOGLE_SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbwlKhi7dukN5p3UDlM-6sxg72zVH9is2jKN1Wh8H0WCSeCAGmm7tjH0DxhIclf0k5Qv/exec';

  const DEFAULT_LOCATIONS = [
    {
      id: "loc_bayrhofs",
      name: "Bayrhofs",
      icon: "🏢",
      powerType: "pv",
      kwhPrice: 0.15,
      address: "Unterwang 18, 87439 Kempten",
      lat: 47.7468,
      lon: 10.3094
    },
    {
      id: "loc_zuhause",
      name: "Zuhause",
      icon: "🏠",
      powerType: "grid",
      kwhPrice: 0.32,
      address: "Rubihornweg 1, 87471 Durach",
      lat: 47.6971,
      lon: 10.3542
    },
    {
      id: "loc_arbeit",
      name: "Arbeit",
      icon: "💼",
      powerType: "grid",
      kwhPrice: 0.20,
      address: "Thomas-Dachser-Straße 2, 87439 Kempten",
      lat: 47.7476,
      lon: 10.3038
    },
    {
      id: "loc_oeffentlich",
      name: "Öffentlich",
      icon: "⚡️",
      powerType: "grid",
      kwhPrice: 0.59,
      address: "Variabel (Aktueller Standort)",
      isVariable: true
    }
  ];

  // Unveränderliche Startwerte des Fahrzeugs bei Auslieferung
  const VEHICLE_START_ODO = 9;
  const VEHICLE_START_SOC = 72; // Fester Auslieferungs-Akkustand (72%)

  const DEFAULT_DATA = {
    schemaVersion: CURRENT_SCHEMA,
    lastUpdated: new Date().toISOString(),
    vehicle: {
      model: "Cupra Raval Endurance Edition Dynamic",
      batteryKwh: 52.0,
      powerPs: 211,
      startOdo: VEHICLE_START_ODO,
      startSoc: VEHICLE_START_SOC,
      currentOdo: 0,
      currentSoc: null
    },
    settings: {
      currency: "€",
      locations: JSON.parse(JSON.stringify(DEFAULT_LOCATIONS)),
      googleSheetsUrl: DEFAULT_GOOGLE_SHEETS_API_URL,
      weatherGps: {
        name: "GPS: Aktueller Standort",
        lat: 47.72,
        lon: 10.31
      },
      activeWeatherLocationId: 'gps',
      variableLocation: {
        name: "Öffentlich (Variabel)",
        query: "",
        lat: 47.72,
        lon: 10.31
      },
      pvThresholdSunshineHours: 4.5,
      thg: {
        year: 2026,
        amount: 110.00,
        status: 'active'
      },
      thgByYear: {
        "2026": {
          year: 2026,
          amount: 110.00,
          active: true,
          status: 'active'
        }
      }
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
  let activeWeatherLocationId = 'gps';

  let weatherForecast14Days = null;
  let currentDwdAlerts = [];
  let currentAlpineData = null;
  let currentSolarSummary = null;
  let currentSourcesStatus = null;
  let isWeatherExpanded = false;
  let isLocationsEditMode = false;
  let currentSyncState = 'synced';
  let selectedSmartRecoDayIndex = null;

  const DELETED_IDS_STORAGE_KEY = 'cupra_raval_deleted_ids';

  function getDeletedIds() {
    try {
      const raw = localStorage.getItem(DELETED_IDS_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) {
      return new Set();
    }
  }

  function addDeletedId(id) {
    if (!id) return;
    try {
      const set = getDeletedIds();
      set.add(String(id).trim());
      localStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(Array.from(set).slice(-100)));
    } catch (_) {}
  }

  function removeDeletedId(id) {
    if (!id) return;
    try {
      const set = getDeletedIds();
      set.delete(String(id).trim());
      localStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (_) {}
  }

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
    autoRequestGpsAndFetchWeather(false, false);
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
    DOM.cardCurrentSoc = document.getElementById('cardCurrentSoc');
    DOM.dashboardLiveStatus = document.getElementById('dashboardLiveStatus');
    DOM.heroRangeBanner = document.getElementById('heroRangeBanner');
    DOM.dashRangeIcon = document.getElementById('dashRangeIcon');
    DOM.dashRangeSocVal = document.getElementById('dashRangeSocVal');
    DOM.dashRangePrimary = document.getElementById('dashRangePrimary');
    DOM.dashRangeTempBadge = document.getElementById('dashRangeTempBadge');
    DOM.dashRangeTempIcon = document.getElementById('dashRangeTempIcon');
    DOM.dashRangeTempText = document.getElementById('dashRangeTempText');
    DOM.dashRangeTempLoss = document.getElementById('dashRangeTempLoss');

    // Charging Tab
    DOM.chargingSegPickers = document.querySelectorAll('.picker-seg[data-sub]');
    DOM.chargingSubViews = document.querySelectorAll('.charging-sub-view');
    DOM.chargingFilterRail = document.getElementById('chargingFilterRail');
    DOM.chargesStreamContainer = document.getElementById('chargesStreamContainer');
    DOM.ptrCharging = document.getElementById('ptrCharging');
    DOM.ptrChargingStatus = document.getElementById('ptrChargingStatus');

    // Bayrhofs Abrechnung & Zahlungsabgleich
    DOM.bayrhofsReconcileCard = document.getElementById('bayrhofsReconcileCard');
    DOM.reconcileCardHeader = document.getElementById('reconcileCardHeader');
    DOM.btnToggleReconcileCollapse = document.getElementById('btnToggleReconcileCollapse');
    DOM.reconcileChevronIcon = document.getElementById('reconcileChevronIcon');
    DOM.reconcileStatusChip = document.getElementById('reconcileStatusChip');
    DOM.reconcileHeaderSubtext = document.getElementById('reconcileHeaderSubtext');
    DOM.reconcileUnpaidSum = document.getElementById('reconcileUnpaidSum');
    DOM.reconcileUnpaidCount = document.getElementById('reconcileUnpaidCount');
    DOM.reconcilePaidSum = document.getElementById('reconcilePaidSum');
    DOM.reconcilePaidCount = document.getElementById('reconcilePaidCount');
    DOM.pillFilterUnpaidBayrhofs = document.getElementById('pillFilterUnpaidBayrhofs');
    DOM.pillFilterPaidBayrhofs = document.getElementById('pillFilterPaidBayrhofs');
    DOM.reconcileExpandableContent = document.getElementById('reconcileExpandableContent');
    DOM.inputReconcileAmount = document.getElementById('inputReconcileAmount');
    DOM.btnRunReconcile = document.getElementById('btnRunReconcile');
    DOM.reconcileResultPanel = document.getElementById('reconcileResultPanel');
    DOM.reconcileResultBadge = document.getElementById('reconcileResultBadge');
    DOM.reconcileResultExplanation = document.getElementById('reconcileResultExplanation');
    DOM.reconcileChecklistStream = document.getElementById('reconcileChecklistStream');
    DOM.reconcileSelectedTotal = document.getElementById('reconcileSelectedTotal');
    DOM.reconcileTargetAmount = document.getElementById('reconcileTargetAmount');
    DOM.reconcileDiffDisplay = document.getElementById('reconcileDiffDisplay');
    DOM.btnCancelReconcile = document.getElementById('btnCancelReconcile');
    DOM.btnConfirmReconcile = document.getElementById('btnConfirmReconcile');
    DOM.segBadgeBayrhofs = document.getElementById('segBadgeBayrhofs');
    DOM.btnBayModeOpen = document.getElementById('btnBayModeOpen');
    DOM.btnBayModeHistory = document.getElementById('btnBayModeHistory');
    DOM.bayBadgeOpenCount = document.getElementById('bayBadgeOpenCount');
    DOM.bayBadgeHistoryCount = document.getElementById('bayBadgeHistoryCount');
    DOM.baySectionOpen = document.getElementById('baySectionOpen');
    DOM.baySectionHistory = document.getElementById('baySectionHistory');
    DOM.bayOpenChargesCountBadge = document.getElementById('bayOpenChargesCountBadge');
    DOM.bayrhofsOpenStreamContainer = document.getElementById('bayrhofsOpenStreamContainer');
    DOM.bayHistoryBadgeCount = document.getElementById('bayHistoryBadgeCount');
    DOM.bayHistorySummaryText = document.getElementById('bayHistorySummaryText');
    DOM.bayrhofsPaidStreamContainer = document.getElementById('bayrhofsPaidStreamContainer');

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
    DOM.weatherLocationFilterRail = document.getElementById('weatherLocationFilterRail');
    DOM.weatherActiveLocBadge = document.getElementById('weatherActiveLocBadge');
    DOM.weatherVariableBox = document.getElementById('weatherVariableBox');
    DOM.inputWeatherVariableSearch = document.getElementById('inputWeatherVariableSearch');
    DOM.btnWeatherVariableSearch = document.getElementById('btnWeatherVariableSearch');
    DOM.btnWeatherVariableGps = document.getElementById('btnWeatherVariableGps');
    DOM.weatherVariableFeedback = document.getElementById('weatherVariableFeedback');
    DOM.ptrWeather = document.getElementById('ptrWeather');
    DOM.ptrWeatherStatus = document.getElementById('ptrWeatherStatus');
    DOM.weatherSourcesStatus = document.getElementById('weatherSourcesStatus');
    DOM.dwdAlertsBanner = document.getElementById('dwdAlertsBanner');
    DOM.weatherMetaBadgesRail = document.getElementById('weatherMetaBadgesRail');
    DOM.pvSummaryRecommendationText = document.getElementById('pvSummaryRecommendationText');

    // Smart Charge AI Empfehlung
    DOM.smartChargeCard = document.getElementById('smartChargeCard');
    DOM.smartRecoBadge = document.getElementById('smartRecoBadge');
    DOM.smartRecoSubModel = document.getElementById('smartRecoSubModel');
    DOM.smartRecoHeroBox = document.getElementById('smartRecoHeroBox');
    DOM.smartRecoSavingsPill = document.getElementById('smartRecoSavingsPill');
    DOM.smartRecoTimeVal = document.getElementById('smartRecoTimeVal');
    DOM.smartRecoLocVal = document.getElementById('smartRecoLocVal');
    DOM.smartRecoKwhVal = document.getElementById('smartRecoKwhVal');
    DOM.smartReco3DayGrid = document.getElementById('smartReco3DayGrid');
    DOM.smartRecoReasoningText = document.getElementById('smartRecoReasoningText');
    DOM.smartMetricBattery = document.getElementById('smartMetricBattery');
    DOM.smartMetricBatterySub = document.getElementById('smartMetricBatterySub');
    DOM.smartMetricBatteryCell = document.getElementById('smartMetricBatteryCell');
    DOM.smartMetricNmc = document.getElementById('smartMetricNmc');
    DOM.smartMetricNmcSub = document.getElementById('smartMetricNmcSub');
    DOM.smartMetricDriving = document.getElementById('smartMetricDriving');
    DOM.smartMetricDrivingSub = document.getElementById('smartMetricDrivingSub');
    DOM.smartMetricDrivingCell = document.getElementById('smartMetricDrivingCell');
    DOM.smartMetricSolar = document.getElementById('smartMetricSolar');
    DOM.smartMetricSolarSub = document.getElementById('smartMetricSolarSub');
    DOM.smartRecoNmcFooterText = document.getElementById('smartRecoNmcFooterText');

    // Allgäu Solar-Adaptive Engine
    DOM.solarAdaptiveCard = document.getElementById('solarAdaptiveCard');
    DOM.adaptiveAccuracyBadge = document.getElementById('adaptiveAccuracyBadge');
    DOM.adaptiveModePicker = document.getElementById('adaptiveModePicker');
    DOM.adaptiveInversionBox = document.getElementById('adaptiveInversionBox');
    DOM.adaptiveInversionBadge = document.getElementById('adaptiveInversionBadge');
    DOM.adaptiveInversionSub = document.getElementById('adaptiveInversionSub');
    DOM.adaptiveInversionText = document.getElementById('adaptiveInversionText');
    DOM.adaptiveComparisonList = document.getElementById('adaptiveComparisonList');
    DOM.adaptiveLastTrainedText = document.getElementById('adaptiveLastTrainedText');
    DOM.btnAdaptiveRecalibrate = document.getElementById('btnAdaptiveRecalibrate');
    DOM.legendItemCalibrated = document.getElementById('legendItemCalibrated');
    DOM.legendItemRaw = document.getElementById('legendItemRaw');

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
    DOM.cfgBatteryDisplay = document.getElementById('cfgBatteryDisplay');
    DOM.cfgBatteryBadge = document.getElementById('cfgBatteryBadge');
    DOM.cfgBatteryVal = document.getElementById('cfgBatteryVal');
    DOM.cfgPowerVal = document.getElementById('cfgPowerVal');
    DOM.cfgBatteryCap = document.getElementById('cfgBatteryCap');
    DOM.cfgPower = document.getElementById('cfgPower');
    DOM.cfgCurrentOdo = document.getElementById('cfgCurrentOdo');
    DOM.cfgCurrentSoc = document.getElementById('cfgCurrentSoc');
    DOM.cfgThgYear = document.getElementById('cfgThgYear');
    DOM.cfgThgAmount = document.getElementById('cfgThgAmount');
    DOM.cfgThgActive = document.getElementById('cfgThgActive');
    DOM.btnSaveThgYear = document.getElementById('btnSaveThgYear');
    DOM.thgSavedStatus = document.getElementById('thgSavedStatus');
    DOM.thgYearsPills = document.getElementById('thgYearsPills');
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
    DOM.cupraOcrUploadCard = document.getElementById('cupraOcrUploadCard');
    DOM.btnTriggerOcrUpload = document.getElementById('btnTriggerOcrUpload');
    DOM.inputCupraScreenshot = document.getElementById('inputCupraScreenshot');
    DOM.ocrStatusText = document.getElementById('ocrStatusText');
    DOM.ocrCardIcon = document.getElementById('ocrCardIcon');
    DOM.ocrSpinner = document.getElementById('ocrSpinner');
    DOM.btnOcrInfo = document.getElementById('btnOcrInfo');
    DOM.ocrInfoBanner = document.getElementById('ocrInfoBanner');
    DOM.btnCloseOcrInfo = document.getElementById('btnCloseOcrInfo');
    DOM.entryLocationId = document.getElementById('entryLocationId');
    DOM.entryKwh = document.getElementById('entryKwh');
    DOM.entryOdometer = document.getElementById('entryOdometer');
    DOM.entryBatterySocStart = document.getElementById('entryBatterySocStart');
    DOM.entryBatterySoc = document.getElementById('entryBatterySoc');
    DOM.entryDeltaSocTag = document.getElementById('entryDeltaSocTag');
    DOM.entrySocEfficiencyPill = document.getElementById('entrySocEfficiencyPill');
    DOM.entrySocEfficiencyText = document.getElementById('entrySocEfficiencyText');
    DOM.entryDeltaKmTag = document.getElementById('entryDeltaKmTag');
    DOM.entryPrice = document.getElementById('entryPrice');
    DOM.entryTotalCost = document.getElementById('entryTotalCost');
    DOM.entryNotes = document.getElementById('entryNotes');
    DOM.entryPaymentStatusRow = document.getElementById('entryPaymentStatusRow');
    DOM.entryPaymentPaidCheckbox = document.getElementById('entryPaymentPaidCheckbox');
    DOM.entryPaymentHint = document.getElementById('entryPaymentHint');
    DOM.entryPaymentOptionLabel = document.getElementById('entryPaymentOptionLabel');
    DOM.entryPaymentStatusText = document.getElementById('entryPaymentStatusText');
    DOM.modalIncompleteHint = document.getElementById('modalIncompleteHint');
    DOM.modalIncompleteText = document.getElementById('modalIncompleteText');

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
    DOM.locEditAddress = document.getElementById('locEditAddress');
    DOM.iconPickerGrid = document.getElementById('iconPickerGrid');
    DOM.locEditIcon = document.getElementById('locEditIcon');
    DOM.locPowerTypePicker = document.getElementById('locPowerTypePicker');
    DOM.locEditPowerType = document.getElementById('locEditPowerType');
    DOM.locEditPrice = document.getElementById('locEditPrice');
    DOM.btnCaptureGpsCoords = document.getElementById('btnCaptureGpsCoords');
    DOM.locEditGpsStatus = document.getElementById('locEditGpsStatus');
    DOM.locEditLat = document.getElementById('locEditLat');
    DOM.locEditLon = document.getElementById('locEditLon');
    DOM.locGeofenceIndicator = document.getElementById('locGeofenceIndicator');

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
    DOM.btnPrevHourlyDay = document.getElementById('btnPrevHourlyDay');
    DOM.btnNextHourlyDay = document.getElementById('btnNextHourlyDay');
    DOM.hourlyDayBadge = document.getElementById('hourlyDayBadge');
    DOM.hourlyContentWrap = document.querySelector('#modalHourlyWeather .hourly-content-wrap');

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

    // Battery Health Modal & Prognose
    DOM.modalBatteryHealth = document.getElementById('modalBatteryHealth');
    DOM.btnCloseBatteryHealthModal = document.getElementById('btnCloseBatteryHealthModal');
    DOM.batteryUnitPicker = document.getElementById('batteryUnitPicker');
    DOM.canvasBatteryHealthChart = document.getElementById('canvasBatteryHealthChart');
    DOM.bKpiCurrentCap = document.getElementById('bKpiCurrentCap');
    DOM.bKpiCurrentSohBadge = document.getElementById('bKpiCurrentSohBadge');
    DOM.bKpi4YearCap = document.getElementById('bKpi4YearCap');
    DOM.bKpi4YearSoh = document.getElementById('bKpi4YearSoh');
    DOM.bKpiScore = document.getElementById('bKpiScore');
    DOM.bKpiScoreSub = document.getElementById('bKpiScoreSub');
    DOM.bBehaviorPvShare = document.getElementById('bBehaviorPvShare');
    DOM.bBehaviorSocWindow = document.getElementById('bBehaviorSocWindow');
    DOM.bBehaviorCycles = document.getElementById('bBehaviorCycles');
    DOM.bBehaviorAgingSplit = document.getElementById('bBehaviorAgingSplit');
    DOM.batteryMilestonesTable = document.getElementById('batteryMilestonesTable');

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
        startOdo: VEHICLE_START_ODO, // Unveränderlicher Startwert (9 km)
        startSoc: VEHICLE_START_SOC, // Unveränderlicher Start-Akkustand (72%)
        currentOdo: (() => {
          let o = (data.vehicle && data.vehicle.currentOdo !== undefined && data.vehicle.currentOdo !== null)
            ? Number(data.vehicle.currentOdo)
            : DEFAULT_DATA.vehicle.currentOdo;
          if (o === 12450) o = 0;
          return isNaN(o) ? 0 : Math.max(0, o);
        })(),
        currentSoc: (() => {
          if (data.vehicle && data.vehicle.currentSoc !== undefined && data.vehicle.currentSoc !== null && data.vehicle.currentSoc !== '') {
            const s = Number(data.vehicle.currentSoc);
            if (!isNaN(s) && s >= 0 && s <= 100) return Math.round(s);
          }
          return null;
        })()
      },
      settings: {
        currency: "€",
        locations: [],
        googleSheetsUrl: (data.settings && data.settings.googleSheetsUrl && String(data.settings.googleSheetsUrl).trim()) || DEFAULT_GOOGLE_SHEETS_API_URL,
        weatherGps: {
          name: (data.settings && data.settings.weatherGps && data.settings.weatherGps.name) || DEFAULT_DATA.settings.weatherGps.name,
          lat: Number((data.settings && data.settings.weatherGps && data.settings.weatherGps.lat) ?? DEFAULT_DATA.settings.weatherGps.lat),
          lon: Number((data.settings && data.settings.weatherGps && data.settings.weatherGps.lon) ?? DEFAULT_DATA.settings.weatherGps.lon)
        },
        activeWeatherLocationId: (data.settings && data.settings.activeWeatherLocationId) || 'gps',
        variableLocation: (data.settings && data.settings.variableLocation) || {
          name: "Öffentlich (Variabel)",
          query: "",
          lat: 47.72,
          lon: 10.31
        },
        pvThresholdSunshineHours: Number((data.settings && data.settings.pvThresholdSunshineHours) ?? DEFAULT_DATA.settings.pvThresholdSunshineHours)
      },
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      pendingSyncQueue: Array.isArray(data.pendingSyncQueue) ? data.pendingSyncQueue : []
    };

    // Locations Migration (mit Adressen & Geo-Koordinaten für Bayrhofs, Zuhause, Arbeit & Öffentlich)
    if (data.settings && Array.isArray(data.settings.locations) && data.settings.locations.length > 0) {
      res.settings.locations = data.settings.locations.map((item, idx) => {
        let name = typeof item === 'string' ? item : (item.name || `Standort ${idx + 1}`);
        let icon = (item && item.icon) || '🏢';
        let powerType = (item && item.powerType) || 'grid';
        let kwhPrice = Number(item && item.kwhPrice) || 0.30;
        let id = (item && item.id) || `loc_${idx}_${Date.now()}`;
        let address = (item && item.address) || '';
        let lat = (item && typeof item.lat === 'number') ? item.lat : null;
        let lon = (item && typeof item.lon === 'number') ? item.lon : null;
        let isVariable = item && item.isVariable === true;

        const nLower = name.toLowerCase();
        if (nLower.includes('bayrhof')) {
          address = address || "Unterwang 18, 87439 Kempten";
          lat = lat ?? 47.7468;
          lon = lon ?? 10.3094;
          powerType = 'pv';
          // Standard-Tarif für Bayrhofs ist 15 Cent (0.15 €/kWh)
          kwhPrice = (item && item.kwhPrice !== undefined && Number(item.kwhPrice) !== 0.18 && Number(item.kwhPrice) > 0) ? Number(item.kwhPrice) : 0.15;
          icon = icon || '🏢';
        } else if (nLower.includes('zuhause') || nLower.includes('durach')) {
          address = address || "Rubihornweg 1, 87471 Durach";
          lat = lat ?? 47.6971;
          lon = lon ?? 10.3542;
          powerType = 'grid';
          kwhPrice = item && item.kwhPrice !== undefined ? Number(item.kwhPrice) : 0.32;
          icon = icon || '🏠';
        } else if (nLower.includes('arbeit') || nLower.includes('dachser')) {
          address = address || "Thomas-Dachser-Straße 2, 87439 Kempten";
          lat = lat ?? 47.7476;
          lon = lon ?? 10.3038;
          powerType = 'grid';
          kwhPrice = item && item.kwhPrice !== undefined ? Number(item.kwhPrice) : 0.20;
          icon = icon || '💼';
        } else if (nLower.includes('öffentlich') || nLower.includes('oeffentlich')) {
          address = address || "Variabel";
          isVariable = true;
          powerType = 'grid';
          kwhPrice = item && item.kwhPrice !== undefined ? Number(item.kwhPrice) : 0.59;
          icon = icon || '⚡️';
        }

        return {
          id,
          name,
          icon,
          powerType,
          kwhPrice,
          address,
          lat,
          lon,
          isVariable
        };
      });
    } else {
      res.settings.locations = JSON.parse(JSON.stringify(DEFAULT_LOCATIONS));
    }

    // THG-Quote Settings Defaults & Migration (Feature 9a) - Persistenz pro Jahr garantieren
    const rawThg = (data.settings && data.settings.thg && typeof data.settings.thg === 'object') ? data.settings.thg : {};
    const rawThgByYear = (data.settings && data.settings.thgByYear && typeof data.settings.thgByYear === 'object') ? data.settings.thgByYear : {};

    const curYr = new Date().getFullYear();
    const fallbackYear = (rawThg.year && !isNaN(Number(rawThg.year))) ? Number(rawThg.year) : curYr;
    const fallbackAmount = (rawThg.amount !== undefined && rawThg.amount !== null && !isNaN(Number(rawThg.amount))) ? Number(rawThg.amount) : 110.00;
    const fallbackActive = (rawThg.status !== 'inactive' && rawThg.active !== false);

    res.settings.thg = {
      year: fallbackYear,
      amount: fallbackAmount,
      active: fallbackActive,
      status: fallbackActive ? 'active' : 'inactive'
    };

    res.settings.thgByYear = {};

    // Alle gespeicherten Jahre aus data.settings.thgByYear vollständig übernehmen
    Object.keys(rawThgByYear).forEach(yr => {
      const item = rawThgByYear[yr];
      if (item && typeof item === 'object') {
        const yrNum = parseInt(yr, 10) || parseInt(item.year, 10) || fallbackYear;
        const itemAmt = (item.amount !== undefined && item.amount !== null && !isNaN(Number(item.amount))) ? Number(item.amount) : fallbackAmount;
        const itemAct = (item.status !== 'inactive' && item.active !== false);
        res.settings.thgByYear[String(yr)] = {
          year: yrNum,
          amount: itemAmt,
          active: itemAct,
          status: itemAct ? 'active' : 'inactive'
        };
      } else if (typeof item === 'number' || (!isNaN(Number(item)) && item !== '')) {
        const yrNum = parseInt(yr, 10) || fallbackYear;
        res.settings.thgByYear[String(yr)] = {
          year: yrNum,
          amount: Number(item),
          active: true,
          status: 'active'
        };
      }
    });

    // Sicherstellen, dass das aktive Jahr in thgByYear existiert
    const thgYrStr = String(res.settings.thg.year);
    if (!res.settings.thgByYear[thgYrStr]) {
      res.settings.thgByYear[thgYrStr] = {
        year: res.settings.thg.year,
        amount: res.settings.thg.amount,
        active: res.settings.thg.active,
        status: res.settings.thg.status
      };
    } else {
      // Synchronisiere res.settings.thg mit dem Wert im thgByYear
      res.settings.thg.amount = res.settings.thgByYear[thgYrStr].amount;
      res.settings.thg.active = res.settings.thgByYear[thgYrStr].active;
      res.settings.thg.status = res.settings.thgByYear[thgYrStr].status;
    }

    // Sessions Migration & Filter out invalid dummy rows
    res.sessions = res.sessions
      .filter(s => {
        const id = String(s.id || s.ID || '');
        if (id.includes('d8074cf3')) return false;
        const kwh = Number(s.kwh || s.kWh || 0);
        const price = Number(s.pricePerKwh || s.preis || 0);
        const cost = Number(s.totalCost || s.kosten || 0);
        const odo = Number(s.odometer || s['km-Stand'] || 0);
        const hasSoc = (s.soc !== undefined && s.soc !== null && s.soc !== '') || (s.socStart !== undefined && s.socStart !== null && s.socStart !== '');
        const hasNotes = Boolean(s.notes || s.notiz || s.Notiz);
        const hasAny = Boolean(kwh > 0 || price > 0 || cost > 0 || odo > 0 || hasSoc || hasNotes || id.startsWith('session_'));
        return hasAny;
      })
      .map((s, idx) => {
        const locName = typeof s.location === 'object' ? s.location.name : (s.location || s.Ort || s.ort || 'Bayrhofs');
        const matchingLoc = res.settings.locations.find(l => l.name === locName);
        let isPv = s.pvSurplus !== undefined ? Boolean(s.pvSurplus) : (matchingLoc ? matchingLoc.powerType === 'pv' : false);
        if (locName.toLowerCase() === 'arbeit') {
          isPv = false;
        }
        const hasPrice = (s.pricePerKwh !== undefined && s.pricePerKwh !== null && s.pricePerKwh !== '') || (s.preis !== undefined && s.preis !== null && s.preis !== '');
        const price = hasPrice ? Number(s.pricePerKwh || s.preis) : (matchingLoc ? matchingLoc.kwhPrice : 0.35);

        const hasKwh = (s.kwh !== undefined && s.kwh !== null && s.kwh !== '') || (s.kWh !== undefined && s.kWh !== null && s.kWh !== '');
        const kwh = hasKwh && !isNaN(Number(s.kwh || s.kWh)) ? Number(s.kwh || s.kWh) : null;

        const hasCost = (s.totalCost !== undefined && s.totalCost !== null && s.totalCost !== '') || (s.kosten !== undefined && s.kosten !== null && s.kosten !== '');
        const total = hasCost ? Number(s.totalCost || s.kosten) : (kwh !== null && price !== null ? Number((kwh * price).toFixed(2)) : null);

        const rawSoc = s.soc !== undefined ? s.soc : (s.SoC !== undefined ? s.SoC : (s.socEnd !== undefined ? s.socEnd : (s['Akkustand Ende (%)'] !== undefined ? s['Akkustand Ende (%)'] : s.akkustand)));
        const socNum = (rawSoc !== undefined && rawSoc !== null && String(rawSoc).trim() !== '') ? parseNum(rawSoc) : null;

        const rawSocStart = s.socStart !== undefined ? s.socStart : (s.SoCStart !== undefined ? s.SoCStart : (s['Akkustand Start (%)'] !== undefined ? s['Akkustand Start (%)'] : s.startSoc));
        const socStartNum = (rawSocStart !== undefined && rawSocStart !== null && String(rawSocStart).trim() !== '') ? parseNum(rawSocStart) : null;

        const hasOdo = (s.odometer !== undefined && s.odometer !== null && s.odometer !== '') || (s['km-Stand'] !== undefined && s['km-Stand'] !== null && s['km-Stand'] !== '');
        const odo = hasOdo && !isNaN(Number(s.odometer || s['km-Stand'])) ? Number(s.odometer || s['km-Stand']) : null;

        return {
          id: s.id || `session_${Date.now()}_${idx}`,
          date: s.date || s.Datum || s.datum || new Date().toISOString(),
          kwh,
          odometer: odo,
          soc: (socNum !== null && !isNaN(socNum) && socNum >= 0 && socNum <= 100) ? Math.round(socNum) : null,
          socStart: (socStartNum !== null && !isNaN(socStartNum) && socStartNum >= 0 && socStartNum <= 100) ? Math.round(socStartNum) : null,
          pricePerKwh: price,
          totalCost: total,
          location: locName,
          pvSurplus: isPv,
          notes: String(s.notes || s.notiz || s.Notiz || ''),
          paid: (() => {
            const isBayrhof = isBayrhofsLocation(locName);
            if (!isBayrhof) return true; // Alles außer Bayrhofs wird immer direkt bezahlt!
            if (s.paid !== undefined && s.paid !== null) return Boolean(s.paid);
            if (s.Bezahlt !== undefined && s.Bezahlt !== null) {
              const bStr = String(s.Bezahlt).toLowerCase().trim();
              return (bStr === 'ja' || bStr === 'true' || bStr === '1' || bStr.includes('bezahlt'));
            }
            return false; // Default für Bayrhofs ist offen
          })()
        };
      });

    res.sessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Höchsten km-Stand als aktuellen Odometer
    const maxOdo = res.sessions.reduce((max, s) => Math.max(max, s.odometer || 0), 0);
    res.vehicle.currentOdo = maxOdo > 0 ? maxOdo : VEHICLE_START_ODO;

    // Neuesten Akkustand als aktuellen Fahrzeug-SoC synchronisieren
    res.sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestWithSoc = res.sessions.find(s => s.soc !== undefined && s.soc !== null && !isNaN(s.soc));
    if (latestWithSoc) {
      res.vehicle.currentSoc = Number(latestWithSoc.soc);
    } else {
      const latestWithStart = res.sessions.find(s => s.socStart !== undefined && s.socStart !== null && !isNaN(s.socStart));
      if (latestWithStart) {
        res.vehicle.currentSoc = Number(latestWithStart.socStart);
      }
    }

    return res;
  }

  /**
   * Prüft, ob ein Ladevorgang vollständig erfasst ist oder welche Felder noch fehlen.
   * Gibt { isComplete: boolean, missing: string[] } zurück.
   */
  function getSessionCompleteness(s) {
    if (!s) return { isComplete: false, missing: ['Alle Felder'] };
    const missing = [];

    const kwhNum = (s.kwh !== null && s.kwh !== undefined && s.kwh !== '') ? Number(s.kwh) : null;
    if (kwhNum === null || isNaN(kwhNum) || kwhNum <= 0) {
      missing.push('kWh');
    }

    const odoNum = (s.odometer !== null && s.odometer !== undefined && s.odometer !== '') ? Number(s.odometer) : null;
    if (odoNum === null || isNaN(odoNum) || odoNum <= 0) {
      missing.push('km-Stand');
    }

    const costNum = (s.totalCost !== null && s.totalCost !== undefined && s.totalCost !== '') ? Number(s.totalCost) : null;
    const priceNum = (s.pricePerKwh !== null && s.pricePerKwh !== undefined && s.pricePerKwh !== '') ? Number(s.pricePerKwh) : null;
    if ((costNum === null || isNaN(costNum)) && (priceNum === null || isNaN(priceNum))) {
      missing.push('Kosten');
    }

    const socEndNum = (s.soc !== null && s.soc !== undefined && s.soc !== '') ? Number(s.soc) : null;
    if (socEndNum === null || isNaN(socEndNum)) {
      missing.push('Akkustand');
    }

    return {
      isComplete: missing.length === 0,
      missing
    };
  }

  function syncVehicleStateFromSessions() {
    if (!appData || !appData.sessions) return;
    // Sessions chronologisch sortieren (neueste zuerst)
    appData.sessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 1. Odometer: Höchsten Kilometerstand aller Sessions ermitteln
    if (appData.sessions.length > 0) {
      const maxOdo = appData.sessions.reduce((max, s) => Math.max(max, s.odometer || 0), 0);
      appData.vehicle.currentOdo = maxOdo > 0 ? maxOdo : VEHICLE_START_ODO;
    } else {
      appData.vehicle.currentOdo = VEHICLE_START_ODO;
    }

    // 2. Battery SoC: Zeitlich neuester Ladevorgang bestimmt den aktuellen Akkustand
    const latestWithSoc = appData.sessions.find(s => s.soc !== undefined && s.soc !== null && !isNaN(s.soc));
    if (latestWithSoc) {
      const lastSoc = Number(latestWithSoc.soc);
      const lastOdo = Number(latestWithSoc.odometer || 0);
      const curOdo = Number(appData.vehicle.currentOdo || lastOdo);
      if (curOdo > lastOdo && lastOdo > 0) {
        const consData = calcConsumption(appData.sessions);
        const baseCons = (consData && consData.hasData && consData.avgCons > 0) ? consData.avgCons : 14.2;
        const batCap = Number(appData.vehicle.batteryKwh) || 52.0;
        const deltaKm = curOdo - lastOdo;
        const consumedKwh = (deltaKm * baseCons) / 100;
        const deltaSoc = (consumedKwh / batCap) * 100;
        appData.vehicle.currentSoc = Math.max(0, Math.min(100, Math.round(lastSoc - deltaSoc)));
      } else {
        appData.vehicle.currentSoc = lastSoc;
      }
    } else {
      const latestWithStart = appData.sessions.find(s => s.socStart !== undefined && s.socStart !== null && !isNaN(s.socStart));
      if (latestWithStart) {
        appData.vehicle.currentSoc = Number(latestWithStart.socStart);
      }
    }
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
      localStorage.removeItem('cupra_weather_cache_v7');
      localStorage.removeItem('cupra_weather_cache_v6');
      localStorage.removeItem('cupra_raval_weather_service_cache_v7');
      localStorage.removeItem('cupra_raval_weather_service_cache_v6');
      localStorage.removeItem('cupra_weather_cache_v5');
      localStorage.removeItem('cupra_raval_weather_service_cache_v5');
      const cached = localStorage.getItem(WEATHER_CACHE_KEY);
      if (cached) {
        weatherForecast14Days = JSON.parse(cached);
      }
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

  function isBayrhofsLocation(loc) {
    if (!loc) return false;
    const name = typeof loc === 'object' ? (loc.name || '') : String(loc);
    return name.toLowerCase().includes('bayrhof');
  }

  function isSessionPaid(s) {
    if (!s) return false;
    const loc = s.location || s.Ort || s.ort || '';
    if (!isBayrhofsLocation(loc)) {
      // Wichtig: Nur bei Bayrhofs Laden wird über eine spätere Summenabrechnung gemacht. Alles andere wird immer direkt bezahlt!
      return true;
    }
    return Boolean(s.paid);
  }

  window.isBayrhofsLocation = isBayrhofsLocation;
  window.isSessionPaid = isSessionPaid;

  function isValidSession(s) {
    if (!s) return false;
    const id = String(s.id || s.ID || '');
    const kwh = parseNum(s.kwh || s.kWh);
    const price = parseNum(s.pricePerKwh || s.preis);
    const cost = parseNum(s.totalCost || s.kosten);
    const odo = parseNum(s.odometer || s.km || s['km-Stand']);
    const hasSoc = (s.soc !== undefined && s.soc !== null && s.soc !== '') || (s.socStart !== undefined && s.socStart !== null && s.socStart !== '');
    const notesStr = String(s.notes || s.notiz || s.Notiz || '').trim();

    // 1. Spezifische Dummy-Einträge aus früheren Fehlübertragungen entfernen
    if (id.includes('d8074cf3') || id.includes('4b9be1ef')) return false;

    // 2. Test-Einträge aus Debugging entfernen
    if (id.startsWith('test_') || id.startsWith('pv_')) return false;

    // 3. Nur Zeilen ohne jegliche Daten oder Kennung verwerfen
    const hasAny = Boolean(kwh > 0 || price > 0 || cost > 0 || odo > 0 || hasSoc || notesStr !== '' || id.startsWith('session_'));
    if (!hasAny) return false;

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
    const rawKwhVal = s.kwh !== undefined ? s.kwh : (s.kWh !== undefined ? s.kWh : (s.energie !== undefined ? s.energie : s.lademenge));
    const hasKwhVal = rawKwhVal !== undefined && rawKwhVal !== null && String(rawKwhVal).trim() !== '';
    const kwh = hasKwhVal && parseNum(rawKwhVal) > 0 ? parseNum(rawKwhVal) : null;

    const rawCostVal = s.totalCost !== undefined ? s.totalCost : (s.kosten !== undefined ? s.kosten : (s.Kosten !== undefined ? s.Kosten : (s.gesamtkosten !== undefined ? s.gesamtkosten : s['Gesamtkosten (€)'])));
    const hasCostVal = rawCostVal !== undefined && rawCostVal !== null && String(rawCostVal).trim() !== '';
    const cost = hasCostVal ? parseNum(rawCostVal) : (kwh !== null && price > 0 ? Number((kwh * price).toFixed(2)) : null);

    const rawDate = s.date || s.Datum || s.datum || s.timestamp || new Date().toISOString();
    const notesStr = String(s.notes || s.notiz || s.Notiz || s.notizen || s.bemerkung || '');
    
    const rawOdoVal = s.odometer !== undefined ? s.odometer : (s.km !== undefined ? s.km : (s.kmstand !== undefined ? s.kmstand : (s['km-Stand'] !== undefined ? s['km-Stand'] : s.kilometer)));
    const hasOdoVal = rawOdoVal !== undefined && rawOdoVal !== null && String(rawOdoVal).trim() !== '';
    const odoNum = hasOdoVal && parseNum(rawOdoVal) > 0 ? parseNum(rawOdoVal) : null;

    const rawSoc = s.soc !== undefined ? s.soc : (s.SoC !== undefined ? s.SoC : (s.socEnd !== undefined ? s.socEnd : (s['Akkustand Ende (%)'] !== undefined ? s['Akkustand Ende (%)'] : s.akkustand)));
    const socNum = (rawSoc !== undefined && rawSoc !== null && String(rawSoc).trim() !== '') ? parseNum(rawSoc) : null;

    const rawSocStart = s.socStart !== undefined ? s.socStart : (s.SoCStart !== undefined ? s.SoCStart : (s['Akkustand Start (%)'] !== undefined ? s['Akkustand Start (%)'] : s.startSoc));
    const socStartNum = (rawSocStart !== undefined && rawSocStart !== null && String(rawSocStart).trim() !== '') ? parseNum(rawSocStart) : null;

    return {
      id: String(s.id || s.ID || `session_cloud_${idx}_${Date.now()}`),
      date: new Date(rawDate).toISOString(),
      kwh,
      odometer: odoNum,
      soc: (socNum !== null && !isNaN(socNum) && socNum >= 0 && socNum <= 100) ? Math.round(socNum) : null,
      socStart: (socStartNum !== null && !isNaN(socStartNum) && socStartNum >= 0 && socStartNum <= 100) ? Math.round(socStartNum) : null,
      pricePerKwh: price,
      totalCost: cost,
      location: locName,
      pvSurplus: Boolean(isPv),
      notes: notesStr,
      paid: (() => {
        const isBayrhof = isBayrhofsLocation(locName);
        if (!isBayrhof) return true; // Nicht-Bayrhofs wird immer direkt bezahlt!
        const rawPaid = s.paid !== undefined ? s.paid : (s.Bezahlt !== undefined ? s.Bezahlt : (s.bezahlt !== undefined ? s.bezahlt : (s['Zahlungsstatus'] !== undefined ? s['Zahlungsstatus'] : undefined)));
        if (rawPaid !== undefined && rawPaid !== null && rawPaid !== '') {
          return (rawPaid === true || rawPaid === 'true' || String(rawPaid).toLowerCase() === 'ja' || String(rawPaid).toLowerCase().includes('bezahlt'));
        }
        return false;
      })()
    };
  }

  function extractSessionsFromPayload(parsed) {
    if (!parsed) return null;
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
    } else if (parsed && typeof parsed === 'object') {
      if (parsed.status === 'error') {
        return null;
      }
      if (Array.isArray(parsed.data)) {
        list = parsed.data;
      } else if (Array.isArray(parsed.sessions)) {
        list = parsed.sessions;
      } else if (Array.isArray(parsed.rows)) {
        list = parsed.rows;
      } else if (Array.isArray(parsed.items)) {
        list = parsed.items;
      }
    }

    if (!list || !Array.isArray(list)) return null;
    return list.map((s, idx) => mapRawSession(s, idx)).filter(isValidSession);
  }

  function mergeSessions(cloudSessions) {
    if (!cloudSessions || !Array.isArray(cloudSessions)) return false;

    const deletedIds = getDeletedIds();
    // Nur gültige Cloud-Sessions berücksichtigen (keine 0 kWh Dummy-Zeilen, keine lokal gelöschten)
    const validCloud = cloudSessions.filter(cs => !deletedIds.has(String(cs.id || cs.ID || '').trim()) && isValidSession(cs));

    // Identifiziere lokale Sessions, die noch in der Offline-Queue liegen und noch nicht hochgeladen wurden
    const pendingIds = new Set(
      (appData.pendingSyncQueue || []).map(item => String(item.id || item.ID || (item.session && (item.session.id || item.session.ID)) || '').trim()).filter(Boolean)
    );

    const pendingLocal = (appData.sessions || []).filter(s => pendingIds.has(String(s.id).trim()) && isValidSession(s));

    // Die Cloud-Sessions sind die alleinige Referenz ("Single Source of Truth")
    // Alle iPhones haben exakt denselben Datenbestand!
    const map = new Map();

    validCloud.forEach(cs => {
      map.set(String(cs.id || cs.ID).trim(), cs);
    });

    // Noch ungesendete lokale Einträge behalten
    pendingLocal.forEach(ps => {
      const psId = String(ps.id || ps.ID).trim();
      if (!map.has(psId)) {
        map.set(psId, ps);
      }
    });

    // WICHTIG für Datenintegrität: Lokale Sessions niemals verwerfen, solange sie nicht gelöscht wurden
    (appData.sessions || []).forEach(ls => {
      const lsId = String(ls.id || ls.ID).trim();
      if (!deletedIds.has(lsId) && isValidSession(ls) && !map.has(lsId)) {
        map.set(lsId, ls);
      }
    });

    appData.sessions = Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
    syncVehicleStateFromSessions();
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
        // Schutz vor unhandled ReferenceError bei verspäteter Google-Antwort:
        window[callbackName] = () => {
          try { delete window[callbackName]; } catch (_) {}
        };
      }

      window[callbackName] = (data) => {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (_) {}
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
      if (rawData.status === 'error') {
        throw new Error(rawData.message || 'Google Sheets Serverfehler');
      }

      const parsedList = extractSessionsFromPayload(rawData);
      if (parsedList === null) {
        throw new Error('Ungültiges Antwortformat von Google Sheets');
      }

      // Single Source of Truth:
      // Auch wenn die Cloud 0 Ladevorgänge meldet (z. B. nach dem Löschen der letzten Ladung),
      // wird der lokale Datenbestand aller Geräte synchronisiert!
      mergeSessions(parsedList);
      setSyncStatus('synced');
      flushPendingSyncQueue();

      // Synchronisiere auch Fahrzeug- & THG-Konfiguration aus Google Sheets
      fetchCloudVehicleConfig();

      if (parsedList.length > 0) {
        showCloudDiag('success', '✅', `Google Sheets verbunden: <strong>${parsedList.length} Ladevorgänge</strong> synchronisiert.`);
        if (isManual) {
          triggerHaptic();
          showToast(`☁️ ${parsedList.length} Ladevorgänge synchronisiert ✓`);
        }
      } else {
        // Tabelle ist online und leer (z. B. nach Löschen des letzten Ladevorgangs)
        showCloudDiag('success', '✅', 'Google Sheets verbunden (Tabelle leer: 0 Ladevorgänge synchronisiert).');
        if (isManual) {
          triggerHaptic();
          showToast('☁️ Google Sheets synchronisiert (Tabelle leer)');
        }
      }
      return;
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
    const hasRawKwh = (s.kwh !== undefined && s.kwh !== null && String(s.kwh).trim() !== '') || (s.kWh !== undefined && s.kWh !== null && String(s.kWh).trim() !== '');
    const kwhNum = hasRawKwh ? parseNum(s.kwh || s.kWh) : 0;
    const kwh = (hasRawKwh && kwhNum > 0) ? kwhNum : '';

    const hasRawPrice = (s.pricePerKwh !== undefined && s.pricePerKwh !== null && String(s.pricePerKwh).trim() !== '') || (s.preis !== undefined && s.preis !== null && String(s.preis).trim() !== '');
    const priceNum = hasRawPrice ? parseNum(s.pricePerKwh || s.preis) : 0;
    const price = (hasRawPrice && priceNum > 0) ? priceNum : '';

    const hasRawCost = (s.totalCost !== undefined && s.totalCost !== null && String(s.totalCost).trim() !== '') || (s.kosten !== undefined && s.kosten !== null && String(s.kosten).trim() !== '');
    const costNum = hasRawCost ? parseNum(s.totalCost || s.kosten) : ((hasRawKwh && hasRawPrice) ? Number((kwhNum * priceNum).toFixed(2)) : 0);
    const cost = (hasRawCost || (hasRawKwh && hasRawPrice)) ? costNum : '';

    const isPv = Boolean(s.pvSurplus);
    const loc = typeof s.location === 'object'
      ? (s.location.name || 'Bayrhofs')
      : String(s.location || s.Ort || s.ort || 'Bayrhofs');
    const dateStr = s.date || s.Datum || new Date().toISOString();
    const id = String(s.id || s.ID || ('session_' + Date.now()));
    const notes = String(s.notes || s.notiz || s.Notiz || '');
    
    const hasRawOdo = (s.odometer !== undefined && s.odometer !== null && String(s.odometer).trim() !== '') || (s['km-Stand'] !== undefined && s['km-Stand'] !== null && String(s['km-Stand']).trim() !== '');
    const odoNum = hasRawOdo ? parseNum(s.odometer || s['km-Stand']) : 0;
    const odo = (hasRawOdo && odoNum > 0) ? odoNum : '';

    const startSoc = (s.socStart !== undefined && s.socStart !== null && s.socStart !== '') ? parseNum(s.socStart) : '';
    const endSoc = (s.soc !== undefined && s.soc !== null && s.soc !== '') ? parseNum(s.soc) : '';

    let deltaKm = '';
    let consumption = '';
    if (typeof getSessionDelta === 'function') {
      const deltaObj = getSessionDelta(s);
      if (deltaObj && deltaObj.deltaKm > 0) {
        deltaKm = deltaObj.deltaKm;
        if (deltaObj.consumption > 0) {
          consumption = Number(deltaObj.consumption.toFixed(1));
        }
      }
    }

    let eff = '';
    if (startSoc !== '' && endSoc !== '' && endSoc > startSoc && kwh !== '' && kwh > 0) {
      const deltaSoc = endSoc - startSoc;
      const batteryCap = (appData && appData.vehicle && appData.vehicle.batteryKwh) || 52.0;
      const netKwh = (deltaSoc / 100) * batteryCap;
      eff = Math.min(100, Math.round((netKwh / kwh) * 1000) / 10);
    }

    const isBayrhof = isBayrhofsLocation(loc);
    const isPaid = isBayrhof ? Boolean(s.paid) : true;

    const compInfo = typeof getSessionCompleteness === 'function' ? getSessionCompleteness(s) : { isComplete: Boolean(kwhNum > 0 && odoNum > 0 && costNum > 0), missing: [] };
    const statusText = compInfo.isComplete ? 'Vollständig' : 'Unvollständig';
    const statusBadge = compInfo.isComplete ? '✓ Vollständig' : '⏳ Unvollständig';

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
      'km-Stand': odo,
      soc: endSoc,
      SoC: endSoc,
      socEnd: endSoc,
      'Akkustand Ende (%)': endSoc,
      socStart: startSoc,
      SoCStart: startSoc,
      startSoc,
      'Akkustand Start (%)': startSoc,
      deltaKm,
      'Gefahrene km': deltaKm,
      consumption,
      'Verbrauch (kWh/100km)': consumption,
      efficiency: eff,
      'Wirkungsgrad (%)': eff,
      paid: isPaid,
      bezahlt: isPaid,
      Bezahlt: isPaid ? (isBayrhof ? 'Ja' : 'Ja (Direkt)') : 'Nein',
      'Zahlungsstatus': isPaid ? 'Bezahlt' : 'Offen',
      status: statusBadge,
      Status: statusBadge,
      'Status': statusBadge,
      erfassung: statusText,
      Erfassung: statusBadge,
      'Erfassung': statusBadge,
      'Erfassungsstatus': statusBadge,
      isComplete: compInfo.isComplete,
      missingFields: compInfo.missing.join(', ')
    };
  }

  async function postCloudPaymentUpdate(sessionIds, paidStatus = true) {
    if (!sessionIds || sessionIds.length === 0) return;
    setSyncStatus('saving');
    const apiUrl = getCloudApiUrl();
    const payload = {
      action: 'mark_paid',
      ids: sessionIds,
      paid: paidStatus,
      timestamp: new Date().toISOString()
    };

    try {
      await fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      setTimeout(() => setSyncStatus('synced'), 700);
    } catch (err) {
      console.warn('Google Sheets Payment-Update POST Fehler, speichere in Offline-Queue:', err);
      appData.pendingSyncQueue = appData.pendingSyncQueue || [];
      appData.pendingSyncQueue.push(payload);
      saveData();
      setSyncStatus('offline');
    }
  }

  async function deleteCloudSession(id) {
    if (!id) return;
    const cleanId = String(id).trim();
    addDeletedId(cleanId);
    setSyncStatus('saving');
    const apiUrl = getCloudApiUrl();

    // Reiner Lösch-Befehl: niemals kWh, Ort oder 0-Werte mitsenden!
    const payload = {
      action: 'delete',
      id: cleanId,
      ID: cleanId,
      timestamp: new Date().toISOString()
    };

    // Entferne diesen Eintrag auch aus der lokalen Offline-Queue
    if (appData.pendingSyncQueue && appData.pendingSyncQueue.length > 0) {
      appData.pendingSyncQueue = appData.pendingSyncQueue.filter(item => {
        const itemId = item.id || item.ID || (item.session && (item.session.id || item.session.ID));
        return String(itemId).trim() !== cleanId;
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
      const getUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}action=delete&id=${encodeURIComponent(cleanId)}`;
      await fetchWithJsonp(getUrl, 4000);
    } catch (_) {
      // Ignoriere JSONP Timeout bei erfolgreichem POST
    }

    setSyncStatus('synced');

    // Nach dem Löschen: Aktualisiere synchron den Datenstand von Google Sheets
    setTimeout(() => {
      fetchCloudSessions(false);
    }, 1200);
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

  function mergeCloudVehicleConfig(cloudCfg) {
    if (!cloudCfg || typeof cloudCfg !== 'object') return;

    if (!appData.settings.thgByYear) appData.settings.thgByYear = {};

    // 1. thgByYear zusammenführen
    if (cloudCfg.thgByYear && typeof cloudCfg.thgByYear === 'object') {
      Object.keys(cloudCfg.thgByYear).forEach(yr => {
        const item = cloudCfg.thgByYear[yr];
        const amt = typeof item === 'object' ? item.amount : Number(item);
        const act = typeof item === 'object' ? (item.active !== false && item.status !== 'inactive') : true;
        if (amt !== undefined && !isNaN(Number(amt))) {
          appData.settings.thgByYear[String(yr)] = {
            year: parseInt(yr, 10),
            amount: Number(amt),
            active: act,
            status: act ? 'active' : 'inactive'
          };
        }
      });
    }

    // 2. Aktuelles oder in Cloud hinterlegtes thgYear
    const thgYear = cloudCfg.thgYear || (appData.settings.thg && appData.settings.thg.year) || new Date().getFullYear();
    const yrStr = String(thgYear);
    const yearConfig = appData.settings.thgByYear[yrStr];

    const thgAmount = yearConfig ? yearConfig.amount : (cloudCfg.thgAmount !== undefined ? Number(cloudCfg.thgAmount) : (appData.settings.thg ? Number(appData.settings.thg.amount) : 110.00));
    const thgActive = yearConfig ? yearConfig.active : (cloudCfg.thgActive !== undefined ? (cloudCfg.thgActive === true || cloudCfg.thgActive === 'true' || cloudCfg.thgActive === 'Ja') : true);

    if (!appData.settings.thg) appData.settings.thg = {};
    appData.settings.thg.year = thgYear;
    appData.settings.thg.amount = thgAmount;
    appData.settings.thg.status = thgActive ? 'active' : 'inactive';
    appData.settings.thg.active = thgActive;

    if (!appData.settings.thgByYear[yrStr]) {
      appData.settings.thgByYear[yrStr] = {
        year: parseInt(yrStr, 10),
        amount: thgAmount,
        active: thgActive,
        status: thgActive ? 'active' : 'inactive'
      };
    }

    // Falls Fahrzeugmodell oder Akku aus Cloud vorhanden sind:
    if (cloudCfg.model && (!appData.vehicle.model || appData.vehicle.model === DEFAULT_DATA.vehicle.model)) {
      appData.vehicle.model = cloudCfg.model;
    }
    if (cloudCfg.batteryKwh && !appData.vehicle.batteryKwh) {
      appData.vehicle.batteryKwh = Number(cloudCfg.batteryKwh);
    }

    saveData();
    renderSettingsForms();
    renderDashboard();
    renderThgYearChips();
    console.log('[Cloud] THG-Konfiguration aus Google Sheet synchronisiert:', appData.settings.thgByYear);
  }

  async function fetchCloudVehicleConfig() {
    const apiUrl = getCloudApiUrl();
    if (!apiUrl) return null;

    let cfgData = null;
    const configUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}action=get_config`;

    try {
      const res = await fetch(configUrl, { cache: 'no-cache' });
      if (res.ok) {
        const json = await res.json();
        if (json && (json.config || json.status === 'success')) {
          cfgData = json.config || json;
        }
      }
    } catch (eFetch) {
      try {
        const jsonpRes = await fetchWithJsonp(configUrl, 4000);
        if (jsonpRes && (jsonpRes.config || jsonpRes.status === 'success')) {
          cfgData = jsonpRes.config || jsonpRes;
        }
      } catch (eJsonp) {
        // Ignorieren falls offline
      }
    }

    if (cfgData) {
      mergeCloudVehicleConfig(cfgData);
      return cfgData;
    }
    return null;
  }

  async function postCloudVehicleConfig() {
    const apiUrl = getCloudApiUrl();
    if (!apiUrl) return;

    setSyncStatus('saving');
    const v = appData.vehicle || {};
    const thg = (appData.settings && appData.settings.thg) || {};

    const config = {
      model: v.model || 'Cupra Raval Endurance Edition Dynamic',
      batteryKwh: Number(v.batteryKwh) || 52.0,
      powerPs: Number(v.powerPs) || 211,
      currentOdo: Number(v.currentOdo) || 0,
      currentSoc: (v.currentSoc !== null && v.currentSoc !== undefined && v.currentSoc !== '') ? Number(v.currentSoc) : '',
      startOdo: Number(v.startOdo) || 9,
      thgYear: Number(thg.year) || new Date().getFullYear(),
      thgAmount: Number(thg.amount) || 110.00,
      thgActive: thg.status !== 'inactive' && thg.active !== false,
      thgStatus: (thg.status !== 'inactive' && thg.active !== false) ? 'active' : 'inactive',
      thgByYear: appData.settings.thgByYear || {}
    };

    const payload = {
      action: 'save_config',
      timestamp: new Date().toISOString(),
      config
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      await fetch(apiUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      setTimeout(() => {
        if (!DOM.cloudDiagBox || DOM.cloudDiagBox.classList.contains('hidden') || DOM.cloudDiagBox.classList.contains('success')) {
          setSyncStatus('synced');
        }
      }, 700);
      console.log('[Cloud] Fahrzeugdaten in Google Sheet (Vehicle_Config) gesichert ✓');
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('Google Sheets Fahrzeug-Config Fehler, speichere in Offline-Queue:', err);
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
        const itemKey = item.id || item.ID || item.action || item.timestamp;
        appData.pendingSyncQueue = (appData.pendingSyncQueue || []).filter(q => (q.id || q.ID || q.action || q.timestamp) !== itemKey);
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
    rowData[colMap.consumption] = (!isNaN(cVal) && cVal > 0) ? cVal : "";
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
`;

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
    window.scrollTo(0, 0);

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
    } else if (tabId === 'settings') {
      renderSettingsForms();
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
    } else if (subId === 'bayrhofs') {
      renderBayrhofsReconcileCard();
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

    if (subId === 'vehicle') {
      renderSettingsForms();
    }

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
      autoRequestGpsAndFetchWeather(true, true);
      triggerHaptic();
    });

    // Variable Wetter-Standort Suche & GPS
    if (DOM.btnWeatherVariableSearch) {
      DOM.btnWeatherVariableSearch.addEventListener('click', () => {
        handleSearchVariableLocation();
        triggerHaptic();
      });
    }
    if (DOM.inputWeatherVariableSearch) {
      DOM.inputWeatherVariableSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchVariableLocation();
          triggerHaptic();
        }
      });
    }
    if (DOM.btnWeatherVariableGps) {
      DOM.btnWeatherVariableGps.addEventListener('click', () => {
        handleUseGpsForVariable();
        triggerHaptic();
      });
    }

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

    // Allgäu Solar-Adaptive Engine Controls (Modus-Wechsel & Feinjustierung)
    if (DOM.adaptiveModePicker) {
      DOM.adaptiveModePicker.addEventListener('click', async (e) => {
        const segBtn = e.target.closest('.picker-seg');
        if (!segBtn) return;
        const newMode = segBtn.getAttribute('data-mode') || 'calibrated';
        if (typeof WeatherService !== 'undefined' && WeatherService.setAdaptiveMode) {
          WeatherService.setAdaptiveMode(newMode);
        }
        triggerHaptic();
        // Sofortiges reaktives UI-Update (0ms Feedback)
        renderSolarAdaptiveCard();
        // Daten & Forecast im Hintergrund mit neuem Modus aktualisieren
        await fetchWeatherCluster(false);
      });
    }

    if (DOM.btnAdaptiveRecalibrate) {
      DOM.btnAdaptiveRecalibrate.addEventListener('click', async () => {
        triggerHaptic();
        if (typeof WeatherService !== 'undefined' && WeatherService.recalibrateNow) {
          WeatherService.recalibrateNow();
        }
        showToast('Feinjustierung aktiv: DWD Stationsdaten Kempten abgeglichen ☀️');
        await fetchWeatherCluster(false);
      });
    }

    // Interaktive Kacheln für Akkustand (SoC) und Fahrprofil
    function promptAndUpdateSoc() {
      const cur = (appData.vehicle && appData.vehicle.currentSoc !== null && appData.vehicle.currentSoc !== undefined) ? appData.vehicle.currentSoc : '';
      const entered = window.prompt('Aktuellen Akkustand des Cupra Raval eingeben (0–100 % SoC):', cur);
      if (entered !== null) {
        const clean = entered.trim();
        if (clean === '') {
          appData.vehicle.currentSoc = null;
          saveData();
          renderSettingsForms();
          updateSmartChargingRecommendation();
          triggerHaptic();
          showToast('Akkustand zurückgesetzt (Warte auf echte Daten)');
        } else {
          const num = parseInt(clean, 10);
          if (!isNaN(num) && num >= 0 && num <= 100) {
            appData.vehicle.currentSoc = num;
            saveData();
            renderSettingsForms();
            updateSmartChargingRecommendation();
            triggerHaptic();
            showToast(`Akkustand auf ${num}% aktualisiert ⚡️`);
          } else {
            showToast('⚠️ Bitte einen gültigen Wert zwischen 0 und 100 eingeben');
          }
        }
      }
    }

    if (DOM.smartMetricBatteryCell) {
      DOM.smartMetricBatteryCell.addEventListener('click', () => {
        promptAndUpdateSoc();
      });
    }

    if (DOM.smartMetricDrivingCell) {
      DOM.smartMetricDrivingCell.addEventListener('click', () => {
        const consData = calcConsumption(appData.sessions);
        if (consData && consData.hasData) {
          showToast(`Reales Fahrprofil: Ø ${consData.avgCons.toFixed(1).replace('.', ',')} kWh/100km`);
        } else {
          showToast('ℹ️ Mindestens 2 Ladevorgänge mit Kilometerstand erfassen für echtes Fahrprofil.');
        }
      });
    }

    if (DOM.smartRecoReasoningText) {
      DOM.smartRecoReasoningText.addEventListener('click', (e) => {
        const link = e.target.closest('#linkSetSocPrompt');
        if (link) {
          e.preventDefault();
          promptAndUpdateSoc();
        }
      });
    }

    if (DOM.smartReco3DayGrid) {
      DOM.smartReco3DayGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.reco-3day-card');
        if (card && card.dataset.dayIndex !== undefined) {
          const idx = parseInt(card.dataset.dayIndex, 10);
          if (!isNaN(idx)) {
            selectedSmartRecoDayIndex = idx;
            updateSmartChargingRecommendation();
            triggerHaptic();
          }
        }
      });
    }

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

    DOM.entryKwh.addEventListener('input', () => {
      calculateModalCost();
      calculateModalSocDelta();
    });
    DOM.entryPrice.addEventListener('input', calculateModalCost);
    DOM.entryOdometer.addEventListener('input', calculateModalOdoDelta);
    if (DOM.entryBatterySocStart) {
      DOM.entryBatterySocStart.addEventListener('input', () => {
        calculateModalSocDelta();
        calculateModalOdoDelta();
      });
    }
    if (DOM.entryBatterySoc) {
      DOM.entryBatterySoc.addEventListener('input', calculateModalSocDelta);
    }
    DOM.formChargeEntry.addEventListener('submit', handleSaveChargeEntry);

    // Cupra App Screenshot OCR Upload & Info Events
    if (DOM.btnOcrInfo) {
      DOM.btnOcrInfo.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOcrInfo();
      });
    }

    if (DOM.btnCloseOcrInfo) {
      DOM.btnCloseOcrInfo.addEventListener('click', (e) => {
        e.stopPropagation();
        setOcrInfoVisible(false);
      });
    }

    if (DOM.ocrInfoBanner) {
      DOM.ocrInfoBanner.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    if (DOM.btnTriggerOcrUpload) {
      DOM.btnTriggerOcrUpload.addEventListener('click', (e) => {
        e.stopPropagation();
        if (DOM.inputCupraScreenshot) DOM.inputCupraScreenshot.click();
      });
    }

    if (DOM.cupraOcrUploadCard) {
      DOM.cupraOcrUploadCard.addEventListener('click', (e) => {
        if (
          e.target !== DOM.btnTriggerOcrUpload &&
          !e.target.closest('#btnTriggerOcrUpload') &&
          !e.target.closest('#btnOcrInfo') &&
          !e.target.closest('#ocrInfoBanner')
        ) {
          if (DOM.inputCupraScreenshot) DOM.inputCupraScreenshot.click();
        }
      });

      DOM.cupraOcrUploadCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        DOM.cupraOcrUploadCard.classList.add('drag-over');
      });
      DOM.cupraOcrUploadCard.addEventListener('dragleave', () => {
        DOM.cupraOcrUploadCard.classList.remove('drag-over');
      });
      DOM.cupraOcrUploadCard.addEventListener('drop', (e) => {
        e.preventDefault();
        DOM.cupraOcrUploadCard.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleCupraScreenshotFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (DOM.inputCupraScreenshot) {
      DOM.inputCupraScreenshot.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleCupraScreenshotFile(e.target.files[0]);
        }
      });
    }

    window.addEventListener('paste', (e) => {
      if (!DOM.modalAddCharge || !DOM.modalAddCharge.classList.contains('open')) return;
      if (e.clipboardData && e.clipboardData.items) {
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.type && item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            if (file) {
              handleCupraScreenshotFile(file);
              break;
            }
          }
        }
      }
    });

    // Location Picker Sheet Events
    DOM.btnOpenLocationPicker.addEventListener('click', () => openLocationPickerSheet());
    DOM.btnCloseLocationPickerSheet.addEventListener('click', () => closeLocationPickerSheet());
    DOM.modalLocationPickerSheet.addEventListener('click', (e) => {
      if (e.target === DOM.modalLocationPickerSheet) closeLocationPickerSheet();
    });

    // Hero Range Banner -> Klick führt zu Tab 3 (Wetter & NMC-Telemetrie)
    if (DOM.heroRangeBanner) {
      DOM.heroRangeBanner.addEventListener('click', () => {
        triggerHaptic();
        switchMainTab('weather');
      });
    }

    // Location Editor GPS Coords Capture Button (Feature 8a)
    if (DOM.btnCaptureGpsCoords) {
      DOM.btnCaptureGpsCoords.addEventListener('click', () => {
        triggerHaptic();
        if (!navigator.geolocation) {
          showToast('⚠️ GPS im Browser nicht verfügbar');
          return;
        }
        if (DOM.locEditGpsStatus) DOM.locEditGpsStatus.textContent = '⏳ Ermittle exakte GPS-Position...';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = Number(pos.coords.latitude.toFixed(6));
            const lon = Number(pos.coords.longitude.toFixed(6));
            const acc = Math.round(pos.coords.accuracy || 0);
            if (DOM.locEditLat) DOM.locEditLat.value = lat;
            if (DOM.locEditLon) DOM.locEditLon.value = lon;
            if (DOM.locEditGpsStatus) {
              DOM.locEditGpsStatus.textContent = `✅ ${lat}, ${lon} (±${acc}m)`;
            }
            triggerHaptic();
            showToast(`📍 Koordinaten übernommen (±${acc}m Genauigkeit)`);
          },
          (err) => {
            if (DOM.locEditGpsStatus) DOM.locEditGpsStatus.textContent = '⚠️ GPS-Fehler';
            showToast('⚠️ GPS-Position konnte nicht ermittelt werden');
          },
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
        );
      });
    }

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

    // Stündliches Wetter Modal Close & Steuerung
    if (DOM.btnCloseHourlyModal) {
      DOM.btnCloseHourlyModal.addEventListener('click', () => closeHourlyModal());
    }
    if (DOM.btnPrevHourlyDay) {
      DOM.btnPrevHourlyDay.addEventListener('click', () => navigateHourlyDay(-1));
    }
    if (DOM.btnNextHourlyDay) {
      DOM.btnNextHourlyDay.addEventListener('click', () => navigateHourlyDay(1));
    }
    if (DOM.modalHourlyWeather) {
      DOM.modalHourlyWeather.addEventListener('click', (e) => {
        if (e.target === DOM.modalHourlyWeather) closeHourlyModal();
      });
    }

    // Tastatur-Navigation für stündliches Wetter Modal
    window.addEventListener('keydown', (e) => {
      if (DOM.modalHourlyWeather && DOM.modalHourlyWeather.classList.contains('open')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateHourlyDay(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateHourlyDay(1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeHourlyModal();
        }
      }
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

    // Battery Health Modal Events
    if (DOM.cfgBatteryDisplay) {
      DOM.cfgBatteryDisplay.addEventListener('click', () => openBatteryHealthModal('kwh'));
      DOM.cfgBatteryDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openBatteryHealthModal('kwh');
        }
      });
    }
    if (DOM.btnCloseBatteryHealthModal) {
      DOM.btnCloseBatteryHealthModal.addEventListener('click', () => closeBatteryHealthModal());
    }
    if (DOM.modalBatteryHealth) {
      DOM.modalBatteryHealth.addEventListener('click', (e) => {
        if (e.target === DOM.modalBatteryHealth) closeBatteryHealthModal();
      });
    }
    if (DOM.batteryUnitPicker) {
      DOM.batteryUnitPicker.querySelectorAll('.picker-seg').forEach(btn => {
        btn.addEventListener('click', () => {
          const unit = btn.getAttribute('data-battery-unit');
          if (unit && unit !== activeBatteryUnit) {
            DOM.batteryUnitPicker.querySelectorAll('.picker-seg').forEach(b => b.classList.toggle('active', b === btn));
            activeBatteryUnit = unit;
            const data = getBatteryHealthData(appData.sessions, appData.vehicle);
            renderBatteryHealthChart(data, activeBatteryUnit);
            triggerHaptic();
          }
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

    // Bayrhofs Abrechnung & Zahlungsabgleich Event Listeners
    if (DOM.btnBayModeOpen) {
      DOM.btnBayModeOpen.addEventListener('click', () => {
        switchBayrhofsMode('open');
      });
    }
    if (DOM.btnBayModeHistory) {
      DOM.btnBayModeHistory.addEventListener('click', () => {
        switchBayrhofsMode('history');
      });
    }
    if (DOM.pillFilterUnpaidBayrhofs) {
      DOM.pillFilterUnpaidBayrhofs.addEventListener('click', () => {
        switchBayrhofsMode('open');
      });
    }
    if (DOM.pillFilterPaidBayrhofs) {
      DOM.pillFilterPaidBayrhofs.addEventListener('click', () => {
        switchBayrhofsMode('history');
      });
    }
    if (DOM.cfgThgYear) {
      DOM.cfgThgYear.addEventListener('input', () => {
        const y = parseInt(DOM.cfgThgYear.value, 10);
        if (y && y >= 2000 && y <= 2100) {
          switchThgYear(y);
        }
      });
      DOM.cfgThgYear.addEventListener('change', () => {
        const y = parseInt(DOM.cfgThgYear.value, 10);
        if (y && y >= 2000 && y <= 2100) {
          switchThgYear(y);
        }
      });
    }

    if (DOM.cfgThgAmount) {
      let thgDebounceTimer = null;
      DOM.cfgThgAmount.addEventListener('input', () => {
        clearTimeout(thgDebounceTimer);
        thgDebounceTimer = setTimeout(() => {
          saveCurrentThgSettings(true);
        }, 350);
      });
      DOM.cfgThgAmount.addEventListener('change', () => {
        clearTimeout(thgDebounceTimer);
        saveCurrentThgSettings(true);
      });
    }

    if (DOM.cfgThgActive) {
      DOM.cfgThgActive.addEventListener('change', () => {
        saveCurrentThgSettings(true);
      });
    }

    if (DOM.btnSaveThgYear) {
      DOM.btnSaveThgYear.addEventListener('click', () => {
        saveCurrentThgSettings(false);
      });
    }
    if (DOM.btnRunReconcile) {
      DOM.btnRunReconcile.addEventListener('click', () => {
        triggerReconcileCalculation();
      });
    }
    if (DOM.inputReconcileAmount) {
      DOM.inputReconcileAmount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerReconcileCalculation();
        }
      });
      DOM.inputReconcileAmount.addEventListener('input', () => {
        // Bei Betragseingabe automatisch vorberechnen falls Panel bereits sichtbar
        if (DOM.reconcileResultPanel && DOM.reconcileResultPanel.style.display !== 'none') {
          triggerReconcileCalculation();
        }
      });
    }
    if (DOM.btnCancelReconcile) {
      DOM.btnCancelReconcile.addEventListener('click', () => {
        if (DOM.reconcileResultPanel) DOM.reconcileResultPanel.style.display = 'none';
        if (DOM.inputReconcileAmount) DOM.inputReconcileAmount.value = '';
        triggerHaptic();
      });
    }
    if (DOM.btnConfirmReconcile) {
      DOM.btnConfirmReconcile.addEventListener('click', () => {
        handleConfirmReconcile();
      });
    }
    if (DOM.entryPaymentPaidCheckbox) {
      DOM.entryPaymentPaidCheckbox.addEventListener('change', () => {
        updateModalPaymentLabel();
      });
    }

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

    // Pull-down-to-refresh initialisieren (Tab 2: Laden & Tab 3: Wetter)
    setupPullToRefresh();
  }

  // =========================================================================
  // PULL-DOWN-TO-REFRESH (IOS NATIVE LIQUID GLASS)
  // Unterstützt Tab 2 (Laden -> Google Sheets Sync) & Tab 3 (Wetter -> Open-Meteo / GPS)
  // =========================================================================
  function setupPullToRefresh() {
    let startY = 0;
    let startX = 0;
    let isPullCandidate = false;
    let isPulling = false;
    let isRefreshing = false;
    let hasTriggeredHaptic = false;
    let bannerEl = null;
    let statusEl = null;

    const PULL_THRESHOLD = 50;

    function getPullConfig() {
      if (activeTab === 'charging') {
        return {
          banner: DOM.ptrCharging,
          status: DOM.ptrChargingStatus,
          idleText: 'Zum Synchronisieren nach unten ziehen',
          releaseText: 'Loslassen zum Synchronisieren',
          refreshingText: 'Synchronisiere mit Google Sheets...',
          successText: 'Synchronisiert ✓',
          action: () => fetchCloudSessions(true)
        };
      } else if (activeTab === 'weather') {
        return {
          banner: DOM.ptrWeather,
          status: DOM.ptrWeatherStatus,
          idleText: 'Zum Aktualisieren nach unten ziehen',
          releaseText: 'Loslassen zum Aktualisieren',
          refreshingText: 'Wetterdaten werden aktualisiert...',
          successText: 'Wetter aktualisiert ✓',
          action: () => (activeWeatherLocationId === 'gps' ? autoRequestGpsAndFetchWeather(true, true) : fetchWeatherCluster(true))
        };
      }
      return null;
    }

    // Programmatischer Trigger für automatisierte Tests (z. B. Playwright E2E)
    window.triggerPullToRefresh = async function(tabId) {
      if (isRefreshing) return;
      const targetTab = tabId || activeTab;
      if (targetTab !== 'charging' && targetTab !== 'weather') return;

      const config = (targetTab === 'charging')
        ? {
            banner: DOM.ptrCharging,
            status: DOM.ptrChargingStatus,
            idleText: 'Zum Synchronisieren nach unten ziehen',
            refreshingText: 'Synchronisiere mit Google Sheets...',
            successText: 'Synchronisiert ✓',
            action: () => fetchCloudSessions(true)
          }
        : {
            banner: DOM.ptrWeather,
            status: DOM.ptrWeatherStatus,
            idleText: 'Zum Aktualisieren nach unten ziehen',
            refreshingText: 'Wetterdaten werden aktualisiert...',
            successText: 'Wetter aktualisiert ✓',
            action: () => (activeWeatherLocationId === 'gps' ? autoRequestGpsAndFetchWeather(true, true) : fetchWeatherCluster(true))
          };

      if (!config.banner) return;
      isRefreshing = true;
      config.banner.classList.add('ptr-visible', 'ptr-refreshing');
      config.banner.classList.remove('ptr-pulling', 'ptr-threshold', 'ptr-success', 'ptr-collapsing');
      config.banner.style.height = '52px';
      config.banner.style.opacity = '1';
      if (config.status) config.status.textContent = config.refreshingText;
      triggerHaptic();

      try {
        await config.action();
      } catch (err) {
        console.warn('Pull-to-refresh Action Fehler:', err);
      }

      if (config.status) config.status.textContent = config.successText;
      config.banner.classList.add('ptr-success');
      config.banner.classList.remove('ptr-refreshing');

      await new Promise(r => setTimeout(r, 650));
      config.banner.classList.add('ptr-collapsing');
      config.banner.style.height = '0px';
      config.banner.style.opacity = '0';

      await new Promise(r => setTimeout(r, 380));
      config.banner.className = 'pull-refresh-banner';
      config.banner.style.height = '';
      config.banner.style.opacity = '';
      if (config.status) config.status.textContent = config.idleText;
      isRefreshing = false;
    };

    function onTouchStart(e) {
      if (isRefreshing) return;
      // Nur zulässig ganz oben an der Seite (window.scrollY <= 2)
      if (window.scrollY > 2) return;
      // Nicht auslösen bei geöffnetem Modal oder aktiven Eingaben
      if (document.querySelector('.swift-modal.active, .swift-modal.open, .modal-backdrop-sheet.open')) return;

      const cfg = getPullConfig();
      if (!cfg || !cfg.banner) return;

      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      isPullCandidate = true;
      isPulling = false;
      hasTriggeredHaptic = false;
      bannerEl = cfg.banner;
      statusEl = cfg.status;
    }

    function onTouchMove(e) {
      if (!isPullCandidate || isRefreshing || !bannerEl) return;

      const touch = e.touches[0];
      const diffY = touch.clientY - startY;
      const diffX = touch.clientX - startX;

      // Abbrechen, falls nach oben gescrollt wird oder horizontale Bewegung überwiegt
      if (!isPulling) {
        if (diffY < 0 || Math.abs(diffX) > Math.abs(diffY)) {
          isPullCandidate = false;
          return;
        }
        if (window.scrollY > 2) {
          isPullCandidate = false;
          return;
        }
        if (diffY > 8) {
          isPulling = true;
          bannerEl.classList.add('ptr-visible', 'ptr-pulling');
          bannerEl.classList.remove('ptr-collapsing', 'ptr-success', 'ptr-refreshing');
        }
      }

      if (isPulling) {
        if (e.cancelable) e.preventDefault();

        // Progressive iOS Rubber-Band Dämpfung
        const pullDistance = Math.min(85, Math.pow(Math.max(0, diffY), 0.82) * 1.5);
        bannerEl.style.height = `${pullDistance}px`;
        bannerEl.style.opacity = Math.min(1, pullDistance / 24).toString();

        const cfg = getPullConfig();
        if (pullDistance >= PULL_THRESHOLD) {
          bannerEl.classList.add('ptr-threshold');
          if (statusEl && cfg) statusEl.textContent = cfg.releaseText;
          if (!hasTriggeredHaptic) {
            triggerHaptic();
            hasTriggeredHaptic = true;
          }
        } else {
          bannerEl.classList.remove('ptr-threshold');
          if (statusEl && cfg) statusEl.textContent = cfg.idleText;
          hasTriggeredHaptic = false;
        }
      }
    }

    async function onTouchEnd() {
      if (!isPulling || isRefreshing || !bannerEl) {
        isPullCandidate = false;
        isPulling = false;
        return;
      }

      const cfg = getPullConfig();
      const currentHeight = parseFloat(bannerEl.style.height) || 0;
      isPullCandidate = false;
      isPulling = false;

      if (currentHeight >= PULL_THRESHOLD && cfg) {
        // Schwellenwert erreicht -> Refresh auslösen!
        isRefreshing = true;
        bannerEl.classList.remove('ptr-pulling', 'ptr-threshold');
        bannerEl.classList.add('ptr-refreshing');
        bannerEl.style.height = '52px';
        bannerEl.style.opacity = '1';
        if (statusEl) statusEl.textContent = cfg.refreshingText;
        triggerHaptic();

        try {
          await cfg.action();
        } catch (err) {
          console.warn('PTR Refresh Fehler:', err);
        }

        // Bestätigung anzeigen
        if (statusEl) statusEl.textContent = cfg.successText;
        bannerEl.classList.add('ptr-success');
        bannerEl.classList.remove('ptr-refreshing');

        await new Promise(r => setTimeout(r, 650));
        // Sanft einklappen
        bannerEl.classList.add('ptr-collapsing');
        bannerEl.style.height = '0px';
        bannerEl.style.opacity = '0';

        await new Promise(r => setTimeout(r, 380));
        bannerEl.className = 'pull-refresh-banner';
        bannerEl.style.height = '';
        bannerEl.style.opacity = '';
        if (statusEl && cfg) statusEl.textContent = cfg.idleText;
        isRefreshing = false;
      } else {
        // Nicht weit genug gezogen -> sanft zurückfedern
        bannerEl.classList.add('ptr-collapsing');
        bannerEl.classList.remove('ptr-pulling', 'ptr-threshold');
        bannerEl.style.height = '0px';
        bannerEl.style.opacity = '0';

        setTimeout(() => {
          bannerEl.className = 'pull-refresh-banner';
          bannerEl.style.height = '';
          bannerEl.style.opacity = '';
          if (statusEl && cfg) statusEl.textContent = cfg.idleText;
        }, 350);
      }
    }

    // Window Touch-Events mit e.preventDefault() Schutz
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  // =========================================================================
  // GANZHEITLICHES RENDERING
  // =========================================================================
  function renderAll() {
    try { renderDashboard(); } catch (e) { console.error('renderDashboard error:', e); }
    try { renderBayrhofsReconcileCard(); } catch (e) { console.error('renderBayrhofsReconcileCard error:', e); }
    try { renderLocationFilterRail(); } catch (e) { console.error('renderLocationFilterRail error:', e); }
    try { renderWeatherLocationFilterRail(); } catch (e) { console.error('renderWeatherLocationFilterRail error:', e); }
    try { renderChargesStream(); } catch (e) { console.error('renderChargesStream error:', e); }
    try { renderSettingsForms(); } catch (e) { console.error('renderSettingsForms error:', e); }
    try { renderLocationsManageList(); } catch (e) { console.error('renderLocationsManageList error:', e); }
    if (appData && appData.settings && appData.settings.locations && appData.settings.locations.length > 0) {
      const curLocId = (DOM.entryLocationId && DOM.entryLocationId.value) || appData.settings.locations[0].id;
      selectLocationForEntry(curLocId, !DOM.entryEditId || !DOM.entryEditId.value);
    }
    if (weatherForecast14Days && weatherForecast14Days.length > 0) {
      try { renderWeatherViews(); } catch (e) { console.error('renderWeatherViews error:', e); }
    }
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

    // Feature 9a: THG-Quote Gegenrechnung (pro Jahr)
    const thgYearConfig = (appData.settings && appData.settings.thgByYear && appData.settings.thgByYear[String(curYear)]) || (appData.settings && appData.settings.thg);
    const isThgActive = thgYearConfig && (thgYearConfig.status === 'active' || thgYearConfig.active !== false) && Number(thgYearConfig.amount) > 0 && (Number(thgYearConfig.year || curYear) === curYear);
    const thgAmount = isThgActive ? Number(thgYearConfig.amount) : 0;

    DOM.dashMonthCost.textContent = formatDe(mCost);
    DOM.dashMonthKwh.textContent = `${mKwh.toFixed(1)} kWh geladen`;

    // Reale Ladekosten des Jahres anzeigen (niemals 0,00 € wenn geladen wurde!)
    DOM.dashYearCost.textContent = formatDe(yCost);
    if (thgAmount > 0) {
      const netCost = Math.max(0, yCost - thgAmount);
      const surplus = Math.max(0, thgAmount - yCost);
      const tooltip = surplus > 0 
        ? `THG-Prämie (${thgAmount.toFixed(2).replace('.', ',')} €) übersteigt Ladekosten (${formatDe(yCost)} €): Netto 0,00 € + ${formatDe(surplus)} € Ertrag`
        : `THG-Prämie (${thgAmount.toFixed(2).replace('.', ',')} €) abgezogen: Netto ${formatDe(netCost)} €`;
      DOM.dashYearKwh.innerHTML = `${yKwh.toFixed(1)} kWh <span class="thg-deduction-badge" title="${tooltip}">🌿 -${Math.round(thgAmount)} € THG</span>`;
    } else {
      DOM.dashYearKwh.textContent = `${yKwh.toFixed(1)} kWh geladen`;
    }

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

    // Reale Durchschnittspreis pro kWh (niemals 0,00 €/kWh wenn Ladevorgänge existieren!)
    const rawAvgPrice = allKwh > 0 ? (allCost / allKwh) : 0.35;
    DOM.dashAvgPrice.textContent = rawAvgPrice.toFixed(2).replace('.', ',');
    const pvPct = allKwh > 0 ? Math.round((allPvKwh / allKwh) * 100) : 0;
    if (thgAmount > 0) {
      DOM.dashPvShareSub.textContent = `${pvPct}% PV • 🌿 Inkl. THG`;
    } else {
      DOM.dashPvShareSub.textContent = `${pvPct}% via PV-Solar`;
    }

    // Verbrauch
    const consData = calcConsumption(appData.sessions);
    if (consData.hasData) {
      DOM.dashAvgCons.textContent = consData.avgCons.toFixed(1).replace('.', ',');
      const costPer100 = (consData.avgCons * rawAvgPrice);
      DOM.dashAvgCost100.textContent = `${costPer100.toFixed(2).replace('.', ',')} € / 100 km`;
    } else {
      DOM.dashAvgCons.textContent = '--';
      DOM.dashAvgCost100.textContent = '-- € / 100 km';
    }

    // Kompakte Autokarte unten & Header
    const v = appData.vehicle;
    const modelName = v.model || 'Cupra Raval Endurance Edition Dynamic';
    if (DOM.cardCarModelName) DOM.cardCarModelName.textContent = modelName;
    if (DOM.appHeaderTitle) DOM.appHeaderTitle.textContent = modelName;
    if (DOM.cardBatteryKwh) DOM.cardBatteryKwh.innerHTML = `${Number(v.batteryKwh).toFixed(1)} <small>kWh</small>`;
    if (DOM.cardPowerPs) DOM.cardPowerPs.innerHTML = `${v.powerPs} <small>PS</small>`;
    if (DOM.cardCurrentOdo) DOM.cardCurrentOdo.innerHTML = `${Number(v.currentOdo).toLocaleString('de-DE')} <small>km</small>`;
    if (DOM.cardCurrentSoc) {
      if (v.currentSoc !== null && v.currentSoc !== undefined && !isNaN(v.currentSoc)) {
        DOM.cardCurrentSoc.innerHTML = `${Math.round(v.currentSoc)} <small>%</small>`;
      } else {
        DOM.cardCurrentSoc.innerHTML = `-- <small>%</small>`;
      }
    }

    if (DOM.dashboardLiveStatus) {
      if (appData.sessions.length > 0) {
        const latest = appData.sessions[0];
        const dObj = latest.date ? new Date(latest.date) : new Date();
        let socSpan = '';
        if (latest.socStart !== null && latest.socStart !== undefined && latest.soc !== null && latest.soc !== undefined) {
          socSpan = ` (${latest.socStart}% → ${latest.soc}%)`;
        } else if (latest.soc !== null && latest.soc !== undefined) {
          socSpan = ` (${latest.soc}% SoC)`;
        }
        const kwhVal = Number(latest.kwh || 0).toFixed(1);
        DOM.dashboardLiveStatus.textContent = `Zuletzt: ${dObj.toLocaleDateString('de-DE')} • ${kwhVal} kWh${socSpan} @ ${latest.location || 'Unbekannt'}`;
      } else {
        DOM.dashboardLiveStatus.textContent = `Bereit für die erste Ladung`;
      }
    }

    updateDashboardPvDecisionWidget();
    updateDashboardWinterRangeSimulation();
  }

  function getSessionEndSoc(s) {
    if (!s) return null;
    const val = (s.soc !== undefined && s.soc !== null && s.soc !== '')
      ? s.soc
      : ((s.socEnd !== undefined && s.socEnd !== null && s.socEnd !== '')
        ? s.socEnd
        : ((s['Akkustand Ende (%)'] !== undefined && s['Akkustand Ende (%)'] !== null && s['Akkustand Ende (%)'] !== '') ? s['Akkustand Ende (%)'] : null));
    if (val === null || val === undefined || String(val).trim() === '') return null;
    const num = Number(val);
    return (!isNaN(num) && num >= 0 && num <= 100) ? num : null;
  }

  function getSessionStartSoc(s) {
    if (!s) return null;
    const val = (s.socStart !== undefined && s.socStart !== null && s.socStart !== '')
      ? s.socStart
      : ((s.startSoc !== undefined && s.startSoc !== null && s.startSoc !== '')
        ? s.startSoc
        : ((s['Akkustand Start (%)'] !== undefined && s['Akkustand Start (%)'] !== null && s['Akkustand Start (%)'] !== '') ? s['Akkustand Start (%)'] : null));
    if (val === null || val === undefined || String(val).trim() === '') return null;
    const num = Number(val);
    return (!isNaN(num) && num >= 0 && num <= 100) ? num : null;
  }

  function getSessionOdo(s) {
    if (!s) return 0;
    const val = (s.odometer !== undefined && s.odometer !== null && s.odometer !== '')
      ? s.odometer
      : ((s['km-Stand'] !== undefined && s['km-Stand'] !== null && s['km-Stand'] !== '') ? s['km-Stand'] : 0);
    const num = Number(val);
    return (!isNaN(num) && num > 0) ? num : 0;
  }

  function calcConsumption(sessions) {
    const batteryCap = (appData && appData.vehicle && Number(appData.vehicle.batteryKwh)) || 52.0;
    let totalEffInputKwh = 0;
    let totalNetBatteryKwh = 0;
    let effCount = 0;
    let allCost = 0;
    let allKwh = 0;

    (sessions || []).forEach(s => {
      const k = Number(s.kwh) || 0;
      const c = Number(s.totalCost) || 0;
      allKwh += k;
      allCost += c;

      const startSoc = getSessionStartSoc(s);
      const endSoc = getSessionEndSoc(s);
      if (startSoc !== null && endSoc !== null && endSoc > startSoc && k > 0) {
        const deltaSoc = endSoc - startSoc;
        const netKwh = (deltaSoc / 100) * batteryCap;
        totalNetBatteryKwh += netKwh;
        totalEffInputKwh += k;
        effCount++;
      }
    });

    const avgEff = (totalEffInputKwh > 0) ? Math.min(100, Math.round((totalNetBatteryKwh / totalEffInputKwh) * 1000) / 10) : null;
    const totalLossKwh = (totalEffInputKwh > 0 && totalEffInputKwh >= totalNetBatteryKwh) ? (totalEffInputKwh - totalNetBatteryKwh) : 0;
    const avgPrice = allKwh > 0 ? (allCost / allKwh) : 0.35;

    if (!sessions || sessions.length < 1) {
      return { hasData: false, avgCons: 0, avgCost100: 0, avgEff, totalLossKwh, effCount, totalMeasuredKm: 0, totalConsumedKwh: 0 };
    }
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));

    let totalMeasuredKm = 0;
    let totalConsumedKwh = 0;

    // Erstes Intervall: Auslieferung (9 km, 72% SoC) bis 1. dokumentierte Ladung
    const firstOdo = getSessionOdo(sorted[0]);
    if (firstOdo > VEHICLE_START_ODO) {
      const firstDelta = firstOdo - VEHICLE_START_ODO;
      const firstStartSoc = getSessionStartSoc(sorted[0]);
      if (firstDelta > 0 && firstDelta < 3000 && firstStartSoc !== null && VEHICLE_START_SOC > firstStartSoc) {
        const deltaSoc = VEHICLE_START_SOC - firstStartSoc;
        const usedKwh = (deltaSoc / 100) * batteryCap;
        totalMeasuredKm += firstDelta;
        totalConsumedKwh += usedKwh;
      }
    }

    // Nachfolgende Intervalle: Reale verbrauchte kWh zwischen Ladeende vorher und Ladestart jetzt
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevOdo = getSessionOdo(prev);
      const currOdo = getSessionOdo(curr);
      if (prevOdo > 0 && currOdo > prevOdo) {
        const delta = currOdo - prevOdo;
        const prevEndSoc = getSessionEndSoc(prev);
        const currStartSoc = getSessionStartSoc(curr);
        if (delta > 0 && delta < 3000 && prevEndSoc !== null && currStartSoc !== null && prevEndSoc > currStartSoc) {
          const deltaSoc = prevEndSoc - currStartSoc;
          const usedKwh = (deltaSoc / 100) * batteryCap;
          totalMeasuredKm += delta;
          totalConsumedKwh += usedKwh;
        }
      }
    }

    if (totalMeasuredKm > 0 && totalConsumedKwh > 0) {
      const avgCons = (totalConsumedKwh / totalMeasuredKm) * 100;
      const avgCost100 = avgCons * avgPrice;
      return {
        hasData: true,
        avgCons,
        avgCost100,
        avgEff,
        totalLossKwh,
        effCount,
        totalMeasuredKm,
        totalConsumedKwh
      };
    }
    return { hasData: false, avgCons: 0, avgCost100: 0, avgEff, totalLossKwh, effCount, totalMeasuredKm: 0, totalConsumedKwh: 0 };
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
    const batteryCap = (appData && appData.vehicle && Number(appData.vehicle.batteryKwh)) || 52.0;

    let allCost = 0, allKwh = 0;
    (sessions || []).forEach(s => {
      allCost += (Number(s.totalCost) || 0);
      allKwh += (Number(s.kwh) || 0);
    });
    const avgPrice = allKwh > 0 ? (allCost / allKwh) : 0.35;

    let monthKm = 0;
    let yearKm = 0;
    let totalTrackedKm = 0;
    const segments = [];

    // Erstes Segment: Auslieferungsstand (9 km, 72% SoC) bis erste dokumentierte Ladung
    if (sorted.length > 0) {
      const firstS = sorted[0];
      const firstOdo = getSessionOdo(firstS);
      if (firstOdo > VEHICLE_START_ODO) {
        const delta0 = firstOdo - VEHICLE_START_ODO;
        if (delta0 > 0) {
          const d0 = new Date(firstS.date);
          totalTrackedKm += delta0;

          if (d0.getFullYear() === curYear) {
            yearKm += delta0;
            if (d0.getMonth() === curMonth) {
              monthKm += delta0;
            }
          }

          const startSoc0 = getSessionStartSoc(firstS);
          let segCons0 = 0;
          let usedKwh0 = 0;
          let deltaSoc0 = 0;
          if (startSoc0 !== null && VEHICLE_START_SOC > startSoc0) {
            deltaSoc0 = VEHICLE_START_SOC - startSoc0;
            usedKwh0 = (deltaSoc0 / 100) * batteryCap;
            segCons0 = (usedKwh0 / delta0) * 100;
          }

          segments.push({
            date: firstS.date,
            fromOdo: VEHICLE_START_ODO,
            toOdo: firstOdo,
            deltaKm: delta0,
            fromSoc: VEHICLE_START_SOC,
            toSoc: startSoc0,
            deltaSoc: deltaSoc0,
            usedKwh: usedKwh0,
            kwh: Number(firstS.kwh) || 0,
            cost: Number(firstS.totalCost) || 0,
            cost100: segCons0 > 0 ? (segCons0 * avgPrice) : 0,
            location: firstS.location || 'Ladung',
            consumption: segCons0
          });
        }
      }
    }

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevOdo = getSessionOdo(prev);
      const currOdo = getSessionOdo(curr);
      const delta = (currOdo > 0 && prevOdo > 0 && currOdo > prevOdo)
        ? (currOdo - prevOdo)
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

        const prevEndSoc = getSessionEndSoc(prev);
        const currStartSoc = getSessionStartSoc(curr);
        let segCons = 0;
        let usedKwh = 0;
        let deltaSoc = 0;
        if (prevEndSoc !== null && currStartSoc !== null && prevEndSoc > currStartSoc) {
          deltaSoc = prevEndSoc - currStartSoc;
          usedKwh = (deltaSoc / 100) * batteryCap;
          segCons = (usedKwh / delta) * 100;
        }

        segments.push({
          date: curr.date,
          fromOdo: prevOdo,
          toOdo: currOdo,
          deltaKm: delta,
          fromSoc: prevEndSoc,
          toSoc: currStartSoc,
          deltaSoc: deltaSoc,
          usedKwh: usedKwh,
          kwh: Number(curr.kwh) || 0,
          cost: Number(curr.totalCost) || 0,
          cost100: segCons > 0 ? (segCons * avgPrice) : 0,
          location: curr.location || 'Ladung',
          consumption: segCons
        });
      }
    }

    const daysSoFar = Math.max(1, curDay);
    const avgKmPerDay = monthKm > 0 ? (monthKm / daysSoFar) : 0;
    const avgKmPerMonth = yearKm > 0 ? (yearKm / (curMonth + 1)) : 0;
    const totalOdo = (currentOdo !== undefined && currentOdo !== null && currentOdo > 0)
      ? currentOdo
      : (sorted.length > 0 ? getSessionOdo(sorted[sorted.length - 1]) : VEHICLE_START_ODO);
    const totalDrivenKm = Math.max(0, totalOdo - VEHICLE_START_ODO);

    return {
      monthKm,
      yearKm,
      totalTrackedKm,
      totalDrivenKm,
      startOdo: VEHICLE_START_ODO,
      totalOdo,
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
  // DYNAMISCHE BATTERIEKAPAZITÄT, GESUNDHEIT (SOH) & 4-JAHRES-PROGNOSE
  // =========================================================================
  const NOMINAL_BATTERY_KWH = 52.0;
  const VEHICLE_DELIVERY_DATE = new Date('2026-10-20T00:00:00Z');
  const LEASE_YEARS = 4.0;
  const WARRANTY_SOH_PCT = 70.0;

  let chartBatteryHealth = null;
  let activeBatteryUnit = 'kwh';

  function getBatteryHealthData(sessions, vehicle) {
    const sess = Array.isArray(sessions) ? sessions : (appData && appData.sessions) || [];
    const veh = vehicle || (appData && appData.vehicle) || {};

    // 1. Zeitverlauf berechnen (Start: Auslieferung Okt 2026)
    const now = new Date();
    const msDiff = Math.max(0, now.getTime() - VEHICLE_DELIVERY_DATE.getTime());
    const yearsElapsed = msDiff / (1000 * 60 * 60 * 24 * 365.25);
    const monthsElapsed = Math.max(0.1, yearsElapsed * 12);

    // 2. Gefahrene Kilometer & Vollzyklus-Äquivalente (EFC)
    let maxOdo = VEHICLE_START_ODO;
    sess.forEach(s => {
      const odo = parseFloat(s.odometer || s.kmStand || 0);
      if (odo > maxOdo) maxOdo = odo;
    });
    if (veh.currentOdo && veh.currentOdo > maxOdo) maxOdo = veh.currentOdo;
    const drivenKm = Math.max(0, maxOdo - VEHICLE_START_ODO);

    // Netto-Ladungssumme oder Distanz-EFC
    let totalChargedKwh = 0;
    let pvAcCount = 0;
    let totalSocSum = 0;
    let socCount = 0;
    let totalDoDSum = 0;
    let dodCount = 0;

    sess.forEach(s => {
      const kwh = parseFloat(s.kwh || 0);
      if (kwh > 0) totalChargedKwh += kwh;
      if (s.pvSurplus === true || s.pv === true || (s.location && s.location.toLowerCase().includes('bayrhof'))) {
        pvAcCount++;
      }
      const sStart = parseFloat(s.socStart ?? s.startSoc);
      const sEnd = parseFloat(s.soc ?? s.socEnd);
      if (!isNaN(sEnd)) {
        totalSocSum += sEnd;
        socCount++;
      }
      if (!isNaN(sStart) && !isNaN(sEnd) && sEnd > sStart) {
        totalDoDSum += (sEnd - sStart);
        dodCount++;
      }
    });

    const totalSessions = sess.length;
    const acPvSharePct = totalSessions > 0 ? Math.round((pvAcCount / totalSessions) * 100) : 100;
    const avgEndSoc = socCount > 0 ? (totalSocSum / socCount) : 72.0;
    const avgStartSoc = dodCount > 0 ? ((totalSocSum - totalDoDSum) / dodCount) : 17.0;
    const avgDoD = dodCount > 0 ? (totalDoDSum / dodCount) : 55.0;

    // Vollzyklen
    const efcCycles = Math.max(drivenKm / 350, (totalChargedKwh * 0.93) / NOMINAL_BATTERY_KWH);

    // 3. Ladeverhaltens-Faktor (Stress-Multiplier)
    // Schonendes AC/PV-Laden senkt die Alterung um bis zu 25% gegenüber DC-Schnellladung
    let factorChargeType = 0.88; // 100% AC/PV
    if (acPvSharePct < 50) factorChargeType = 1.15;
    else if (acPvSharePct < 85) factorChargeType = 1.0;

    // SoC-Window: Bis 80% SoC schont Kathode und Elektrolyt nachhaltig
    let factorSocWindow = 0.90;
    if (avgEndSoc > 90) factorSocWindow = 1.18;
    else if (avgEndSoc > 80) factorSocWindow = 1.05;

    // Hub-Tiefe (DoD): Flache Ladehübe schonen
    let factorDoD = (avgDoD <= 60) ? 0.95 : 1.05;

    const stressFactor = Math.min(1.35, Math.max(0.70, factorChargeType * factorSocWindow * factorDoD));

    // Lade-Schonungs-Index (0 bis 100)
    const score = Math.min(100, Math.max(50, Math.round(100 - (stressFactor - 0.70) * 80)));
    let scoreRating = '🌱 Vorbildlich';
    if (score < 75) scoreRating = '⚠️ Erhöht';
    else if (score < 88) scoreRating = '👍 Schonend';

    // 4. Degradationsmodell (Kalendarisch + Zyklisch)
    function calcDegradation(tYears, cycles, stress) {
      const calLoss = 2.0 * Math.sqrt(Math.max(0, tYears)) * stress;
      const cycLoss = cycles * 0.0055 * stress;
      return {
        calLoss,
        cycLoss,
        totalLoss: calLoss + cycLoss
      };
    }

    // Aktueller Zustand (heute)
    const currentDeg = calcDegradation(yearsElapsed, efcCycles, stressFactor);
    const effectiveCurrentLoss = Math.max(0.18, currentDeg.totalLoss);
    const currentSoh = Math.max(70.0, Math.round((100.0 - effectiveCurrentLoss) * 10) / 10);
    const currentCap = Math.round((NOMINAL_BATTERY_KWH * (currentSoh / 100.0)) * 10) / 10;

    // 5. 4-Jahres-Prognose (Meilensteine 0 bis 4 Jahre)
    const annualKm = Math.max(12000, Math.min(25000, (drivenKm / Math.max(0.08, yearsElapsed))));
    const annualCycles = annualKm / 350;

    const milestones = [];
    const chartLabels = ['Start', 'Heute', 'Jahr 1', 'Jahr 2', 'Jahr 3', 'Jahr 4'];
    const kwhUser = [];
    const kwhRef = [];
    const kwhWarranty = [];
    const sohUser = [];
    const sohRef = [];
    const sohWarranty = [];

    // Milestone: Start (Okt 2026)
    milestones.push({
      yearNum: 0,
      label: 'Auslieferung (Start)',
      date: 'Okt 2026',
      kwh: NOMINAL_BATTERY_KWH,
      soh: 100.0,
      refKwh: NOMINAL_BATTERY_KWH,
      refSoh: 100.0,
      isPast: true
    });
    kwhUser.push(NOMINAL_BATTERY_KWH);
    kwhRef.push(NOMINAL_BATTERY_KWH);
    kwhWarranty.push(Math.round(NOMINAL_BATTERY_KWH * 0.70 * 10) / 10);
    sohUser.push(100.0);
    sohRef.push(100.0);
    sohWarranty.push(WARRANTY_SOH_PCT);

    // Milestone: Heute
    milestones.push({
      yearNum: Math.round(yearsElapsed * 10) / 10,
      label: 'Aktueller Stand',
      date: 'Heute',
      kwh: currentCap,
      soh: currentSoh,
      refKwh: Math.round((NOMINAL_BATTERY_KWH * 0.994) * 10) / 10,
      refSoh: 99.4,
      isCurrent: true
    });
    kwhUser.push(currentCap);
    kwhRef.push(Math.round((NOMINAL_BATTERY_KWH * 0.994) * 10) / 10);
    kwhWarranty.push(36.4);
    sohUser.push(currentSoh);
    sohRef.push(99.4);
    sohWarranty.push(WARRANTY_SOH_PCT);

    // Milestones: Jahre 1, 2, 3, 4
    for (let yr = 1; yr <= 4; yr++) {
      const yrDate = `Okt ${2026 + yr}`;
      const userDeg = calcDegradation(yr, yr * annualCycles, stressFactor);
      const refDeg = calcDegradation(yr, yr * annualCycles, 1.25);

      const uSoh = Math.round((100.0 - userDeg.totalLoss) * 10) / 10;
      const uCap = Math.round((NOMINAL_BATTERY_KWH * (uSoh / 100.0)) * 10) / 10;
      const rSoh = Math.round((100.0 - refDeg.totalLoss) * 10) / 10;
      const rCap = Math.round((NOMINAL_BATTERY_KWH * (rSoh / 100.0)) * 10) / 10;

      milestones.push({
        yearNum: yr,
        label: yr === 4 ? 'Jahr 4 (Leasingende)' : `Jahr ${yr}`,
        date: yrDate,
        kwh: uCap,
        soh: uSoh,
        refKwh: rCap,
        refSoh: rSoh,
        isFuture: true
      });

      kwhUser.push(uCap);
      kwhRef.push(rCap);
      kwhWarranty.push(36.4);
      sohUser.push(uSoh);
      sohRef.push(rSoh);
      sohWarranty.push(WARRANTY_SOH_PCT);
    }

    const projected4YearCap = kwhUser[kwhUser.length - 1];
    const projected4YearSoh = sohUser[sohUser.length - 1];

    return {
      nominalCap: NOMINAL_BATTERY_KWH,
      currentCap,
      currentSoh,
      leaseYears: LEASE_YEARS,
      projected4YearCap,
      projected4YearSoh,
      score,
      scoreRating,
      stressFactor,
      stats: {
        totalSessions,
        acPvSharePct,
        avgStartSoc: Math.round(avgStartSoc),
        avgEndSoc: Math.round(avgEndSoc),
        avgDoD: Math.round(avgDoD),
        efcCycles: Math.round(efcCycles * 10) / 10,
        monthsElapsed: Math.round(monthsElapsed * 10) / 10,
        drivenKm: Math.round(drivenKm),
        calendarLossPct: Math.round(currentDeg.calLoss * 100) / 100,
        cycleLossPct: Math.round(currentDeg.cycLoss * 100) / 100
      },
      milestones,
      chartData: {
        labels: chartLabels,
        kwhUser,
        kwhRef,
        kwhWarranty,
        sohUser,
        sohRef,
        sohWarranty
      }
    };
  }

  function openBatteryHealthModal(unit = 'kwh') {
    activeBatteryUnit = (unit === 'soh') ? 'soh' : 'kwh';

    if (DOM.batteryUnitPicker) {
      DOM.batteryUnitPicker.querySelectorAll('.picker-seg').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-battery-unit') === activeBatteryUnit);
      });
    }

    const data = getBatteryHealthData(appData.sessions, appData.vehicle);

    // KPI Kacheln oben
    if (DOM.bKpiCurrentCap) DOM.bKpiCurrentCap.textContent = data.currentCap.toFixed(1);
    if (DOM.bKpiCurrentSohBadge) DOM.bKpiCurrentSohBadge.textContent = `✨ ${data.currentSoh.toFixed(1)}% SoH`;
    if (DOM.bKpi4YearCap) DOM.bKpi4YearCap.textContent = `~${data.projected4YearCap.toFixed(1)} kWh`;
    if (DOM.bKpi4YearSoh) DOM.bKpi4YearSoh.textContent = `~${data.projected4YearSoh.toFixed(1)}% Restkapazität`;
    if (DOM.bKpiScore) DOM.bKpiScore.textContent = data.score;
    if (DOM.bKpiScoreSub) DOM.bKpiScoreSub.textContent = data.scoreRating;

    // Ladeverhaltens-Box
    if (DOM.bBehaviorPvShare) DOM.bBehaviorPvShare.textContent = `${data.stats.acPvSharePct}%`;
    if (DOM.bBehaviorSocWindow) DOM.bBehaviorSocWindow.textContent = `Ø ${data.stats.avgStartSoc}% → ${data.stats.avgEndSoc}%`;
    if (DOM.bBehaviorCycles) DOM.bBehaviorCycles.textContent = `~${data.stats.efcCycles} EFC`;
    const calSplit = Math.max(10, Math.min(90, Math.round(data.stats.calendarLossPct / (data.stats.calendarLossPct + data.stats.cycleLossPct + 0.001) * 100)));
    if (DOM.bBehaviorAgingSplit) DOM.bBehaviorAgingSplit.textContent = `${calSplit}% Zeit`;

    // Meilensteine Tabelle
    renderBatteryMilestonesTable(data);

    // Modal öffnen
    if (DOM.modalBatteryHealth) {
      DOM.modalBatteryHealth.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    // Chart rendern mit leichtem Verzögerungsschutz für CSS Transition
    renderBatteryHealthChart(data, activeBatteryUnit);

    requestAnimationFrame(() => {
      if (chartBatteryHealth) chartBatteryHealth.resize();
    });

    setTimeout(() => {
      if (chartBatteryHealth) {
        chartBatteryHealth.resize();
        chartBatteryHealth.update('none');
      }
    }, 180);

    triggerHaptic();
  }

  function closeBatteryHealthModal() {
    if (DOM.modalBatteryHealth) {
      DOM.modalBatteryHealth.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (chartBatteryHealth) {
      chartBatteryHealth.destroy();
      chartBatteryHealth = null;
    }
  }

  function renderBatteryMilestonesTable(data) {
    if (!DOM.batteryMilestonesTable || !data || !Array.isArray(data.milestones)) return;

    let html = '';
    data.milestones.forEach((m) => {
      const isCur = m.isCurrent;
      const tagLabel = isCur ? 'Heute' : (m.yearNum === 0 ? 'Start' : `J${m.yearNum}`);
      const advantageKwh = (m.refKwh && m.kwh > m.refKwh) ? `+${(m.kwh - m.refKwh).toFixed(1)} kWh Bonus` : '';

      const cleanTitle = m.yearNum === 4 ? 'Jahr 4 (Leasingende)' : (isCur ? 'Aktueller Stand' : m.label);

      html += `
        <div class="b-milestone-row ${isCur ? 'is-current' : ''}">
          <div class="b-milestone-left">
            <span class="b-milestone-tag">${tagLabel}</span>
            <div>
              <div class="b-milestone-title">${cleanTitle}</div>
              <div class="b-milestone-date">${m.date}</div>
            </div>
          </div>
          <div class="b-milestone-right">
            <div>
              <div class="b-milestone-val">${m.kwh.toFixed(1)} kWh</div>
              <div class="b-milestone-soh">${m.soh.toFixed(1)}% SoH</div>
            </div>
            ${advantageKwh ? `<span class="b-milestone-diff" title="Vorteil durch schonendes AC/PV-Laden">${advantageKwh}</span>` : ''}
          </div>
        </div>
      `;
    });
    DOM.batteryMilestonesTable.innerHTML = html;
  }

  function renderBatteryHealthChart(data, unit = 'kwh') {
    if (!DOM.canvasBatteryHealthChart || typeof Chart === 'undefined' || !data) return;
    if (chartBatteryHealth) {
      chartBatteryHealth.destroy();
      chartBatteryHealth = null;
    }

    const isKwh = (unit === 'kwh');
    const ctx = DOM.canvasBatteryHealthChart.getContext('2d');
    const tealGrad = ctx.createLinearGradient(0, 0, 0, 200);
    tealGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    tealGrad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');

    const userSeries = isKwh ? data.chartData.kwhUser : data.chartData.sohUser;
    const refSeries = isKwh ? data.chartData.kwhRef : data.chartData.sohRef;
    const warrantySeries = isKwh ? data.chartData.kwhWarranty : data.chartData.sohWarranty;

    const yMin = isKwh ? 32 : 60;
    const yMax = isKwh ? 54 : 105;
    const unitLabel = isKwh ? 'kWh' : '% SoH';

    chartBatteryHealth = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.chartData.labels,
        datasets: [
          {
            label: `Dein Ladeverhalten (${unitLabel})`,
            data: userSeries,
            borderColor: '#10b981',
            backgroundColor: tealGrad,
            borderWidth: 2.5,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointRadius: 4,
            pointHoverRadius: 6,
            order: 1
          },
          {
            label: `Flottendurchschnitt (${unitLabel})`,
            data: refSeries,
            borderColor: '#94a3b8',
            backgroundColor: 'transparent',
            borderWidth: 1.8,
            borderDash: [5, 4],
            tension: 0.3,
            pointRadius: 3,
            order: 2
          },
          {
            label: `Garantiegrenze 70% (${unitLabel})`,
            data: warrantySeries,
            borderColor: '#ef4444',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [3, 3],
            tension: 0,
            pointRadius: 0,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(6, 10, 16, 0.95)',
            titleColor: '#e28e4e',
            bodyColor: '#e2e8f0',
            borderColor: 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function(ctx) {
                const idx = ctx.dataIndex;
                const val = ctx.parsed.y;
                if (ctx.datasetIndex === 0) {
                  const altVal = isKwh ? `${data.chartData.sohUser[idx]}% SoH` : `${data.chartData.kwhUser[idx]} kWh`;
                  return `  Dein Akku: ${val} ${unitLabel} (${altVal})`;
                } else if (ctx.datasetIndex === 1) {
                  return `  Flotte: ${val} ${unitLabel}`;
                } else {
                  return `  Garantie: ${val} ${unitLabel} (70%)`;
                }
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#94a3b8', font: { size: 10, weight: '600' } }
          },
          y: {
            min: yMin,
            max: yMax,
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: {
              color: '#94a3b8',
              font: { size: 10, weight: '600' },
              stepSize: isKwh ? 4 : 10,
              callback: val => `${val} ${isKwh ? 'kWh' : '%'}`
            }
          }
        }
      }
    });
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

    const thgYearConfig = (appData.settings && appData.settings.thgByYear && appData.settings.thgByYear[String(curYear)]) || (appData.settings && appData.settings.thg);
    const isThgActive = thgYearConfig && (thgYearConfig.status === 'active' || thgYearConfig.active !== false) && Number(thgYearConfig.amount) > 0 && (Number(thgYearConfig.year || curYear) === curYear);
    const thgAmount = isThgActive ? Number(thgYearConfig.amount) : 0;

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

        stat1 = { lbl: "Ladekosten", val: `${formatDe(yCost)} €` };
        if (thgAmount > 0) {
          stat2 = { lbl: `THG-Prämie`, val: `-${formatDe(thgAmount)} €` };
          if (yCost <= thgAmount) {
            stat3 = { lbl: "THG-Überschuss", val: `+${formatDe(thgAmount - yCost)} €` };
            sub = `Reale Ladekosten: ${formatDe(yCost)} € • Durch THG vollständig gedeckt (+${formatDe(thgAmount - yCost)} € Ertrag)`;
          } else {
            stat3 = { lbl: "Netto nach THG", val: `${formatDe(yCost - thgAmount)} €` };
            sub = `Reale Ladekosten: ${formatDe(yCost)} € • Netto nach THG: ${formatDe(yCost - thgAmount)} €`;
          }
        } else {
          stat2 = { lbl: "Jahresenergie", val: `${yKwh.toFixed(1)} kWh` };
          stat3 = { lbl: "Ø / Monat", val: `${formatDe(yCost / Math.max(1, curMonth + 1))} €` };
        }

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

        stat1 = { lbl: "Ladekosten", val: `${formatDe(yCost)} €` };
        if (thgAmount > 0) {
          stat2 = { lbl: "THG-Quote", val: `-${formatDe(thgAmount)} €` };
          stat3 = {
            lbl: yCost <= thgAmount ? "THG-Überschuss" : "Netto nach THG",
            val: yCost <= thgAmount ? `+${formatDe(thgAmount - yCost)} €` : `${formatDe(yCost - thgAmount)} €`
          };
          sub = `${ySessions.length} erfasste Ladevorgänge • Netto nach THG: ${yCost <= thgAmount ? '0,00 € (+ ' + formatDe(thgAmount - yCost) + ' € Ertrag)' : formatDe(yCost - thgAmount) + ' €'}`;
        } else {
          stat2 = { lbl: "Jahresenergie", val: `${yKwh.toFixed(1)} kWh` };
          stat3 = { lbl: "Ø / Ladung", val: `${formatDe(ySessions.length > 0 ? yCost / ySessions.length : 0)} €` };
        }

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
        if (thgAmount > 0) {
          if (allCost <= thgAmount) {
            stat3 = { lbl: "THG-Status", val: "100% gedeckt" };
            sub = `Monatlicher Ladepreis • Stromkosten vollständig durch THG-Prämie amortisiert`;
          } else {
            const effPrice = (allCost - thgAmount) / allKwh;
            stat3 = { lbl: "Effektiv (THG)", val: `${effPrice.toFixed(2).replace('.', ',')} €/kWh` };
            sub = `Monatlicher Ladepreis • Effektiv ${effPrice.toFixed(2).replace('.', ',')} €/kWh nach THG`;
          }
        } else {
          stat3 = { lbl: "Netzstrom-Ref", val: `0,35 €/kWh` };
        }

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
        stat3 = {
          lbl: (consData.avgEff !== null ? "Ø Ladeeffizienz" : "Erfasst"),
          val: (consData.avgEff !== null ? `${consData.avgEff.toFixed(1).replace('.', ',')} %` : `${distStats.totalTrackedKm} km`)
        };

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
        stat3 = {
          lbl: (consData.avgEff !== null ? "Ø Ladeeffizienz" : "Abschnitte"),
          val: (consData.avgEff !== null ? `${consData.avgEff.toFixed(1).replace('.', ',')} %` : `${validSegments.length}`)
        };

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
  // =========================================================================
  // TAB 2: LADEN, HISTORIE & BAYRHOFS SAMMELABRECHNUNG
  // =========================================================================
  let isReconcileCardCollapsed = false;
  let activeReconcileMatch = null;

  let activeBayrhofsMode = 'open'; // 'open' | 'history'

  function switchBayrhofsMode(mode) {
    activeBayrhofsMode = mode;
    if (DOM.btnBayModeOpen) DOM.btnBayModeOpen.classList.toggle('active', mode === 'open');
    if (DOM.btnBayModeHistory) DOM.btnBayModeHistory.classList.toggle('active', mode === 'history');

    if (DOM.pillFilterUnpaidBayrhofs) DOM.pillFilterUnpaidBayrhofs.classList.toggle('active-mode', mode === 'open');
    if (DOM.pillFilterPaidBayrhofs) DOM.pillFilterPaidBayrhofs.classList.toggle('active-mode', mode === 'history');

    if (DOM.baySectionOpen) DOM.baySectionOpen.style.display = (mode === 'open' ? 'block' : 'none');
    if (DOM.baySectionHistory) DOM.baySectionHistory.style.display = (mode === 'history' ? 'block' : 'none');

    triggerHaptic();
  }

  function renderBayrhofsSessionCard(s, isPaid) {
    const d = new Date(s.date);
    const dStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const hasBothSoc = (s.socStart !== undefined && s.socStart !== null && s.soc !== undefined && s.soc !== null);
    const deltaSoc = hasBothSoc ? (s.soc - s.socStart) : 0;
    const compInfo = getSessionCompleteness(s);
    const isComplete = compInfo.isComplete;
    const kwhDisplay = (s.kwh !== null && s.kwh !== undefined && s.kwh !== '' && Number(s.kwh) > 0) ? Number(s.kwh).toFixed(1) : '--';
    const costDisplay = (s.totalCost !== null && s.totalCost !== undefined && s.totalCost !== '') ? `${formatDe(s.totalCost)} €` : '-- €';
    const priceDisplay = (s.pricePerKwh !== null && s.pricePerKwh !== undefined && s.pricePerKwh !== '') ? `${Number(s.pricePerKwh).toFixed(2).replace('.', ',')} €/kWh` : '-- €/kWh';

    return `
      <div class="swift-glass-card session-swift-card bayrhofs-session-card ${isPaid ? 'is-paid' : 'is-unpaid'} ${!isComplete ? 'is-incomplete' : ''}" data-id="${s.id}">
        <div class="session-top-meta session-header-block">
          <div class="session-header-row">
            <div class="session-timestamp">
              <span class="timestamp-calendar-icon">📅</span>
              <span>${dStr}</span>
              <span class="timestamp-separator">•</span>
              <span class="timestamp-clock-val">${tStr}</span>
            </div>
            <div class="session-header-tags session-badges-wrap">
              <span class="loc-badge-item" title="Bayrhofs">🏢 Bayrhofs</span>
              ${s.pvSurplus ? '<span class="pv-badge-item">☀️ PV</span>' : ''}
              ${!isComplete ? `<span class="session-incomplete-badge" title="Noch unvollständig erfasst – fehlend: ${escapeHtml(compInfo.missing.join(', '))}">⏳ Unvollständig</span>` : ''}
            </div>
          </div>

          <div class="session-status-row">
            <div class="session-status-left">
              ${isPaid
                ? '<span class="pay-status-badge paid" title="Über Abrechnung bezahlt">✓ Bereits abgerechnet</span>'
                : '<span class="pay-status-badge unpaid" title="Wird über spätere Sammelabrechnung bezahlt">⏳ Offen</span>'}
            </div>
            <div class="session-status-right">
              ${hasBothSoc
                ? `<span class="soc-badge-item">
                    <span class="soc-icon">🔋</span>
                    <span class="soc-range">${s.socStart}% <span class="soc-arrow">→</span> ${s.soc}%</span>
                    <span class="soc-delta">+${deltaSoc}%</span>
                   </span>`
                : ((s.soc !== undefined && s.soc !== null)
                    ? `<span class="soc-badge-item">
                        <span class="soc-icon">🔋</span>
                        <span class="soc-range">${s.soc}%</span>
                       </span>`
                    : '')}
            </div>
          </div>
        </div>

        <div class="session-primary-row">
          <div class="session-kwh-display">
            <span class="session-kwh-val">${kwhDisplay}</span>
            <span class="session-kwh-unit">kWh</span>
          </div>
          <div class="session-cost-val">${costDisplay}</div>
        </div>

        <div class="session-details-row">
          <div>
            <span>📍 ${s.odometer ? s.odometer.toLocaleString('de-DE') + ' km' : 'km nicht notiert'}</span>
          </div>
          <div>
            <span>${priceDisplay}</span>
          </div>
        </div>

        ${s.notes ? `<div class="session-note-text">„${escapeHtml(s.notes)}“</div>` : ''}

        <div class="session-actions-bar">
          <button class="btn-card-action btn-pay-toggle ${isPaid ? 'paid' : 'unpaid'}" data-id="${s.id}" title="${isPaid ? 'Als noch offen markieren' : 'Als bezahlt verbuchen'}">
            ${isPaid ? '↩️ Als offen markieren' : '✓ Als bezahlt verbuchen'}
          </button>
          <button class="btn-card-action btn-edit-charge" data-id="${s.id}">${!isComplete ? '✏️ Ergänzen' : '✏️ Details'}</button>
        </div>
      </div>
    `;
  }

  function renderBayrhofsReconcileCard() {
    if (!DOM.bayrhofsReconcileCard) return;

    const bayrhofsSessions = (appData.sessions || []).filter(s => isBayrhofsLocation(s.location));
    const unpaidSessions = bayrhofsSessions.filter(s => !s.paid);
    const paidSessions = bayrhofsSessions.filter(s => Boolean(s.paid));

    const unpaidSum = unpaidSessions.reduce((acc, s) => acc + (s.totalCost || 0), 0);
    const paidSum = paidSessions.reduce((acc, s) => acc + (s.totalCost || 0), 0);

    if (DOM.reconcileUnpaidSum) DOM.reconcileUnpaidSum.textContent = formatDe(unpaidSum) + ' €';
    if (DOM.reconcileUnpaidCount) DOM.reconcileUnpaidCount.textContent = `${unpaidSessions.length} Ladung${unpaidSessions.length === 1 ? '' : 'en'}`;

    if (DOM.reconcilePaidSum) DOM.reconcilePaidSum.textContent = formatDe(paidSum) + ' €';
    if (DOM.reconcilePaidCount) DOM.reconcilePaidCount.textContent = `${paidSessions.length} Ladung${paidSessions.length === 1 ? '' : 'en'}`;

    if (DOM.segBadgeBayrhofs) {
      if (unpaidSessions.length > 0) {
        DOM.segBadgeBayrhofs.textContent = unpaidSessions.length;
        DOM.segBadgeBayrhofs.style.display = 'inline-flex';
      } else {
        DOM.segBadgeBayrhofs.style.display = 'none';
      }
    }

    if (DOM.bayBadgeOpenCount) DOM.bayBadgeOpenCount.textContent = unpaidSessions.length;
    if (DOM.bayBadgeHistoryCount) DOM.bayBadgeHistoryCount.textContent = paidSessions.length;

    if (DOM.reconcileStatusChip) {
      if (unpaidSessions.length > 0) {
        DOM.reconcileStatusChip.className = 'reconcile-status-chip has-unpaid';
        DOM.reconcileStatusChip.textContent = `${unpaidSessions.length} offen • ${formatDe(unpaidSum)} €`;
      } else {
        DOM.reconcileStatusChip.className = 'reconcile-status-chip all-settled';
        DOM.reconcileStatusChip.textContent = 'Alles abgerechnet ✓';
      }
    }

    if (DOM.reconcileHeaderSubtext) {
      if (unpaidSessions.length > 0) {
        DOM.reconcileHeaderSubtext.textContent = `Offener Betrag: ${formatDe(unpaidSum)} € zur späteren Abrechnung`;
      } else {
        DOM.reconcileHeaderSubtext.textContent = 'Aktuell keine offenen Abrechnungen bei Bayrhofs';
      }
    }

    if (DOM.bayOpenChargesCountBadge) {
      DOM.bayOpenChargesCountBadge.textContent = `${unpaidSessions.length} offen`;
    }
    if (DOM.bayHistoryBadgeCount) {
      DOM.bayHistoryBadgeCount.textContent = `${paidSessions.length} abgerechnet`;
    }
    if (DOM.bayHistorySummaryText) {
      DOM.bayHistorySummaryText.textContent = `${paidSessions.length} Ladung${paidSessions.length === 1 ? '' : 'en'} • ${formatDe(paidSum)} € abgerechnet`;
    }

    // Offene Ladungen rendern
    if (DOM.bayrhofsOpenStreamContainer) {
      if (unpaidSessions.length === 0) {
        DOM.bayrhofsOpenStreamContainer.innerHTML = `
          <div class="swift-glass-card" style="text-align:center; padding: 28px 16px; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 6px;">🎉</div>
            <div style="font-weight: 700; color: #fff;">Alles abgerechnet!</div>
            <div style="font-size: 0.76rem; margin-top: 4px;">Aktuell gibt es keine offenen Bayrhofs-Ladungen.</div>
          </div>
        `;
      } else {
        DOM.bayrhofsOpenStreamContainer.innerHTML = unpaidSessions.map(s => renderBayrhofsSessionCard(s, false)).join('');
        DOM.bayrhofsOpenStreamContainer.querySelectorAll('.btn-pay-toggle').forEach(btn => {
          btn.addEventListener('click', () => handleToggleSessionPaid(btn.getAttribute('data-id')));
        });
        DOM.bayrhofsOpenStreamContainer.querySelectorAll('.btn-edit-charge').forEach(btn => {
          btn.addEventListener('click', () => openModalCharge(btn.getAttribute('data-id')));
        });
      }
    }

    // Bereits abgerechnete Historie rendern
    if (DOM.bayrhofsPaidStreamContainer) {
      if (paidSessions.length === 0) {
        DOM.bayrhofsPaidStreamContainer.innerHTML = `
          <div class="swift-glass-card" style="text-align:center; padding: 28px 16px; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 6px;">📜</div>
            <div style="font-weight: 700; color: #fff;">Noch keine Zahlungen verbucht</div>
            <div style="font-size: 0.76rem; margin-top: 4px;">Sobald du Bayrhofs-Ladungen als bezahlt markierst, erscheinen sie hier.</div>
          </div>
        `;
      } else {
        const sortedPaid = [...paidSessions].sort((a, b) => new Date(b.date) - new Date(a.date));
        DOM.bayrhofsPaidStreamContainer.innerHTML = sortedPaid.map(s => renderBayrhofsSessionCard(s, true)).join('');
        DOM.bayrhofsPaidStreamContainer.querySelectorAll('.btn-pay-toggle').forEach(btn => {
          btn.addEventListener('click', () => handleToggleSessionPaid(btn.getAttribute('data-id')));
        });
        DOM.bayrhofsPaidStreamContainer.querySelectorAll('.btn-edit-charge').forEach(btn => {
          btn.addEventListener('click', () => openModalCharge(btn.getAttribute('data-id')));
        });
      }
    }
  }

  function triggerReconcileCalculation() {
    if (!DOM.inputReconcileAmount) return;
    const rawVal = DOM.inputReconcileAmount.value.replace(',', '.').trim();
    const amount = parseFloat(rawVal);

    if (isNaN(amount) || amount <= 0) {
      showToast('⚠️ Bitte einen gültigen Zahlungsbetrag eingeben');
      return;
    }

    const match = calculateBayrhofsPaymentMatch(amount);
    displayReconcileResult(match);
    triggerHaptic();
  }

  function calculateBayrhofsPaymentMatch(targetAmount) {
    const unpaid = (appData.sessions || [])
      .filter(s => isBayrhofsLocation(s.location) && !s.paid)
      .sort((a, b) => new Date(a.date) - new Date(b.date)); // Älteste zuerst (FIFO)

    if (unpaid.length === 0) {
      return {
        success: false,
        type: 'none_unpaid',
        matchedIds: [],
        allSessions: [],
        selectedSum: 0,
        targetAmount,
        diff: -targetAmount,
        message: 'Keine offenen Bayrhofs-Ladungen vorhanden.'
      };
    }

    const target = Math.round(targetAmount * 100) / 100;
    const tolerance = 0.03; // Cent-Toleranz für Rundungen

    // 1. Einzelne exakte Übereinstimmung prüfen
    const singleMatch = unpaid.find(s => Math.abs(s.totalCost - target) <= tolerance);
    if (singleMatch) {
      return {
        success: true,
        type: 'exact',
        badge: '✨ Exakte Einzel-Übereinstimmung',
        explanation: `Die Ladung vom ${new Date(singleMatch.date).toLocaleDateString('de-DE')} (${formatDe(singleMatch.totalCost)} €) stimmt exakt mit deinem Zahlungsbetrag überein!`,
        matchedIds: [String(singleMatch.id)],
        allSessions: unpaid,
        selectedSum: singleMatch.totalCost,
        targetAmount: target,
        diff: singleMatch.totalCost - target
      };
    }

    // 2. Exakte Teilmengen-Kombination (Subset Sum)
    const exactSubset = findSubsetSum(unpaid, target, tolerance);
    if (exactSubset && exactSubset.length > 0) {
      const sum = exactSubset.reduce((acc, s) => acc + s.totalCost, 0);
      return {
        success: true,
        type: 'exact',
        badge: '✨ Exakte Übereinstimmung (' + exactSubset.length + ' Ladungen)',
        explanation: `${exactSubset.length} offene Ladungen ergeben zusammen exakt ${formatDe(sum)} €!`,
        matchedIds: exactSubset.map(s => String(s.id)),
        allSessions: unpaid,
        selectedSum: sum,
        targetAmount: target,
        diff: sum - target
      };
    }

    // 3. Chronologische FIFO-Zuordnung (Standard für betriebliche Sammelabrechnungen)
    let chronoSubset = [];
    let chronoSum = 0;
    for (const s of unpaid) {
      chronoSubset.push(s);
      chronoSum += s.totalCost;
      if (chronoSum >= target - tolerance) break;
    }

    const chronoDiff = chronoSum - target;
    if (Math.abs(chronoDiff) <= tolerance) {
      return {
        success: true,
        type: 'exact',
        badge: '⏱ Chronologisch abgerechnet (' + chronoSubset.length + ' Ladungen)',
        explanation: `Die ${chronoSubset.length} ältesten offenen Ladungen entsprechen exakt deiner Abrechnung von ${formatDe(chronoSum)} €!`,
        matchedIds: chronoSubset.map(s => String(s.id)),
        allSessions: unpaid,
        selectedSum: chronoSum,
        targetAmount: target,
        diff: chronoDiff
      };
    }

    // 4. Beste Annäherung / Nächste Kombination
    const bestCombo = findClosestSubset(unpaid, target);
    if (bestCombo && bestCombo.subset.length > 0) {
      const bestSum = bestCombo.sum;
      const bestDiff = bestSum - target;
      const isClose = Math.abs(bestDiff) < 1.00;
      return {
        success: true,
        type: isClose ? 'chrono' : 'diff',
        badge: isClose ? '🎯 Bester Treffer (' + bestCombo.subset.length + ' Ladungen)' : '⚠️ Abweichung (' + formatDe(Math.abs(bestDiff)) + ' €)',
        explanation: isClose
          ? `${bestCombo.subset.length} Ladungen passen am besten (Summe: ${formatDe(bestSum)} €, Differenz: ${formatDe(bestDiff)} €). Du kannst die Auswahl unten anpassen.`
          : `Keine exakte Kombination für ${formatDe(target)} € gefunden. Die nächste Summe ist ${formatDe(bestSum)} € (${formatDe(bestDiff)} € Abweichung).`,
        matchedIds: bestCombo.subset.map(s => String(s.id)),
        allSessions: unpaid,
        selectedSum: bestSum,
        targetAmount: target,
        diff: bestDiff
      };
    }

    return {
      success: true,
      type: 'chrono',
      badge: '⏱ Vorgeschlagene Ladungen',
      explanation: 'Bitte wähle die bezahlten Ladungen in der Liste aus:',
      matchedIds: chronoSubset.map(s => String(s.id)),
      allSessions: unpaid,
      selectedSum: chronoSum,
      targetAmount: target,
      diff: chronoDiff
    };
  }

  function findSubsetSum(sessions, target, tolerance = 0.03) {
    if (sessions.length > 25) sessions = sessions.slice(0, 25);
    let found = null;

    function backtrack(idx, current, currentSum) {
      if (found) return;
      if (Math.abs(currentSum - target) <= tolerance) {
        found = [...current];
        return;
      }
      if (currentSum > target + tolerance) return;
      if (idx >= sessions.length) return;

      for (let i = idx; i < sessions.length; i++) {
        current.push(sessions[i]);
        backtrack(i + 1, current, currentSum + sessions[i].totalCost);
        current.pop();
        if (found) return;
      }
    }

    backtrack(0, [], 0);
    return found;
  }

  function findClosestSubset(sessions, target) {
    if (sessions.length > 22) sessions = sessions.slice(0, 22);
    let bestSubset = [];
    let bestDiff = Infinity;
    let bestSum = 0;

    function backtrack(idx, current, currentSum) {
      const diff = Math.abs(currentSum - target);
      if (diff < bestDiff && current.length > 0) {
        bestDiff = diff;
        bestSubset = [...current];
        bestSum = currentSum;
        if (bestDiff === 0) return;
      }
      if (currentSum > target * 1.5) return;
      if (idx >= sessions.length) return;

      for (let i = idx; i < sessions.length; i++) {
        current.push(sessions[i]);
        backtrack(i + 1, current, currentSum + sessions[i].totalCost);
        current.pop();
        if (bestDiff === 0) return;
      }
    }

    backtrack(0, [], 0);
    return { subset: bestSubset, sum: bestSum, diff: bestDiff };
  }

  function displayReconcileResult(match) {
    activeReconcileMatch = match;
    if (!DOM.reconcileResultPanel) return;

    if (!match.success) {
      showToast(match.message || 'Keine offenen Ladungen');
      DOM.reconcileResultPanel.style.display = 'none';
      return;
    }

    DOM.reconcileResultPanel.style.display = 'flex';

    if (DOM.reconcileResultBadge) {
      DOM.reconcileResultBadge.className = 'result-badge-badge ' + (match.type || 'exact');
      DOM.reconcileResultBadge.textContent = match.badge || '✨ Zuordnung berechnet';
    }

    if (DOM.reconcileResultExplanation) {
      DOM.reconcileResultExplanation.textContent = match.explanation || '';
    }

    const selectedSet = new Set(match.matchedIds || []);

    if (DOM.reconcileChecklistStream) {
      DOM.reconcileChecklistStream.innerHTML = match.allSessions.map(s => {
        const d = new Date(s.date);
        const dStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const tStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const isChecked = selectedSet.has(String(s.id));

        return `
          <div class="reconcile-check-item ${isChecked ? 'selected' : ''}" data-id="${s.id}">
            <div class="reconcile-check-left">
              <input type="checkbox" class="reconcile-item-checkbox" data-id="${s.id}" data-cost="${s.totalCost}" ${isChecked ? 'checked' : ''}>
              <div>
                <div class="reconcile-item-date">${dStr} • ${tStr}</div>
                <div class="reconcile-item-meta">${s.kwh.toFixed(1)} kWh • ${s.pricePerKwh.toFixed(2).replace('.', ',')} €/kWh</div>
              </div>
            </div>
            <div class="reconcile-item-cost">${formatDe(s.totalCost)} €</div>
          </div>
        `;
      }).join('');

      DOM.reconcileChecklistStream.querySelectorAll('.reconcile-item-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const item = cb.closest('.reconcile-check-item');
          if (item) item.classList.toggle('selected', cb.checked);
          updateReconcileChecklistCalculations();
        });
      });
    }

    updateReconcileChecklistCalculations();
  }

  function updateReconcileChecklistCalculations() {
    if (!DOM.reconcileResultPanel || !DOM.inputReconcileAmount) return;
    const target = parseFloat(DOM.inputReconcileAmount.value.replace(',', '.')) || 0;

    let total = 0;
    const checkedIds = [];
    if (DOM.reconcileChecklistStream) {
      DOM.reconcileChecklistStream.querySelectorAll('.reconcile-item-checkbox:checked').forEach(cb => {
        total += parseFloat(cb.getAttribute('data-cost')) || 0;
        checkedIds.push(cb.getAttribute('data-id'));
      });
    }

    total = Math.round(total * 100) / 100;
    const diff = Math.round((total - target) * 100) / 100;

    if (DOM.reconcileSelectedTotal) DOM.reconcileSelectedTotal.textContent = formatDe(total) + ' €';
    if (DOM.reconcileTargetAmount) DOM.reconcileTargetAmount.textContent = formatDe(target) + ' €';

    if (DOM.reconcileDiffDisplay) {
      if (Math.abs(diff) <= 0.03) {
        DOM.reconcileDiffDisplay.className = 'summary-stat-diff zero';
        DOM.reconcileDiffDisplay.textContent = '0,00 € (Exakt ✓)';
      } else {
        DOM.reconcileDiffDisplay.className = 'summary-stat-diff warn';
        DOM.reconcileDiffDisplay.textContent = `${diff > 0 ? '+' : ''}${formatDe(diff)} €`;
      }
    }

    if (DOM.btnConfirmReconcile) {
      DOM.btnConfirmReconcile.disabled = checkedIds.length === 0;
      DOM.btnConfirmReconcile.innerHTML = `<span>✓ ${checkedIds.length} Ladung${checkedIds.length === 1 ? '' : 'en'} als bezahlt verbuchen</span>`;
    }
  }

  function handleConfirmReconcile() {
    if (!DOM.reconcileChecklistStream) return;
    const checkedIds = [];
    DOM.reconcileChecklistStream.querySelectorAll('.reconcile-item-checkbox:checked').forEach(cb => {
      checkedIds.push(cb.getAttribute('data-id'));
    });

    if (checkedIds.length === 0) {
      showToast('⚠️ Bitte wähle mindestens eine Ladung aus');
      return;
    }

    const idSet = new Set(checkedIds);
    let updatedCount = 0;
    let updatedSum = 0;

    (appData.sessions || []).forEach(s => {
      if (idSet.has(String(s.id))) {
        s.paid = true;
        updatedCount++;
        updatedSum += (s.totalCost || 0);
      }
    });

    saveData();
    renderAll();
    triggerHaptic();
    showToast(`✓ ${updatedCount} Bayrhofs-Ladung${updatedCount === 1 ? '' : 'en'} (${formatDe(updatedSum)} €) als bezahlt verbucht!`);

    // In Google Sheets sichern
    postCloudPaymentUpdate(checkedIds, true);

    // Reset UI
    if (DOM.inputReconcileAmount) DOM.inputReconcileAmount.value = '';
    if (DOM.reconcileResultPanel) DOM.reconcileResultPanel.style.display = 'none';
  }

  function handleToggleSessionPaid(id) {
    const s = (appData.sessions || []).find(x => String(x.id).trim() === String(id).trim());
    if (!s) return;
    s.paid = !s.paid;
    saveData();
    renderAll();
    triggerHaptic();
    showToast(s.paid ? '✓ Ladung als bezahlt markiert' : '⏳ Ladung wieder als offen markiert');
    postCloudPaymentUpdate([String(s.id)], s.paid);
  }

  function renderLocationFilterRail() {
    if (!DOM.chargingFilterRail) return;

    if (activeChargingFilter === 'pv') activeChargingFilter = 'all';

    const locs = appData.settings.locations || [];
    let html = `<button class="chip-filter ${activeChargingFilter === 'all' ? 'active' : ''}" data-filter="all">Alle</button>`;

    // Schnellfilter für offene Bayrhofs Sammelabrechnungen
    const unpaidBayrhofsCount = (appData.sessions || []).filter(s => isBayrhofsLocation(s.location) && !s.paid).length;
    if (unpaidBayrhofsCount > 0) {
      const isUnpaidAct = activeChargingFilter === 'unpaid_bayrhofs';
      html += `<button class="chip-filter chip-unpaid ${isUnpaidAct ? 'active' : ''}" data-filter="unpaid_bayrhofs">⏳ Bayrhofs Offen (${unpaidBayrhofsCount})</button>`;
    }

    locs.forEach(loc => {
      const isAct = activeChargingFilter === loc.name;
      html += `<button class="chip-filter ${isAct ? 'active' : ''}" data-filter="${escapeHtml(loc.name)}">${loc.icon || '📍'} ${escapeHtml(loc.name)}</button>`;
    });

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
    if (activeChargingFilter === 'unpaid_bayrhofs') {
      list = list.filter(s => isBayrhofsLocation(s.location) && !s.paid);
    } else if (activeChargingFilter !== 'all') {
      list = list.filter(s => s.location === activeChargingFilter);
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
      const batteryCap = (appData.vehicle && appData.vehicle.batteryKwh) || 52.0;
      const hasBothSoc = (s.socStart !== undefined && s.socStart !== null && s.soc !== undefined && s.soc !== null);
      const deltaSoc = hasBothSoc ? (s.soc - s.socStart) : 0;
      const netKwh = (deltaSoc > 0) ? ((deltaSoc / 100) * batteryCap) : 0;
      const eff = (hasBothSoc && netKwh > 0 && s.kwh > 0) ? Math.min(100, Math.round((netKwh / s.kwh) * 1000) / 10) : null;
      const isBayrhof = isBayrhofsLocation(s.location);
      const isPaid = isSessionPaid(s);
      const compInfo = getSessionCompleteness(s);
      const isComplete = compInfo.isComplete;
      const kwhDisplay = (s.kwh !== null && s.kwh !== undefined && s.kwh !== '' && Number(s.kwh) > 0) ? Number(s.kwh).toFixed(1) : '--';
      const costDisplay = (s.totalCost !== null && s.totalCost !== undefined && s.totalCost !== '') ? `${formatDe(s.totalCost)} €` : '-- €';
      const priceDisplay = (s.pricePerKwh !== null && s.pricePerKwh !== undefined && s.pricePerKwh !== '') ? `${Number(s.pricePerKwh).toFixed(2).replace('.', ',')} €/kWh` : '-- €/kWh';

      return `
        <div class="swift-glass-card session-swift-card ${!isComplete ? 'is-incomplete' : ''}" data-id="${s.id}">
          <div class="session-top-meta session-header-block">
            <div class="session-header-row">
              <div class="session-timestamp">
                <span class="timestamp-calendar-icon">📅</span>
                <span>${dStr}</span>
                <span class="timestamp-separator">•</span>
                <span class="timestamp-clock-val">${tStr}</span>
              </div>
              <div class="session-header-tags session-badges-wrap">
                <span class="loc-badge-item" title="${escapeHtml(s.location)}">${locIcon} ${escapeHtml(s.location)}</span>
                ${s.pvSurplus ? '<span class="pv-badge-item">☀️ PV</span>' : ''}
                ${!isComplete ? `<span class="session-incomplete-badge" title="Noch unvollständig erfasst – fehlend: ${escapeHtml(compInfo.missing.join(', '))}">⏳ Unvollständig</span>` : ''}
              </div>
            </div>

            ${(isBayrhof || hasBothSoc || (s.soc !== undefined && s.soc !== null)) ? `
            <div class="session-status-row">
              <div class="session-status-left">
                ${isBayrhof
                  ? (isPaid
                      ? '<span class="pay-status-badge paid" title="Über Sammelabrechnung abgerechnet">✓ Bezahlt</span>'
                      : '<span class="pay-status-badge unpaid" title="Wird über spätere Sammelabrechnung bezahlt">⏳ Offen</span>')
                  : '<span class="pay-status-badge direct" title="Direkt bei Ladung bezahlt">✓ Direkt bezahlt</span>'}
              </div>
              <div class="session-status-right">
                ${hasBothSoc
                  ? `<span class="soc-badge-item">
                      <span class="soc-icon">🔋</span>
                      <span class="soc-range">${s.socStart}% <span class="soc-arrow">→</span> ${s.soc}%</span>
                      <span class="soc-delta">+${deltaSoc}%</span>
                     </span>`
                  : ((s.soc !== undefined && s.soc !== null)
                      ? `<span class="soc-badge-item">
                          <span class="soc-icon">🔋</span>
                          <span class="soc-range">${s.soc}%</span>
                         </span>`
                      : '')}
              </div>
            </div>` : ''}
          </div>

          <div class="session-primary-row">
            <div class="session-kwh-display">
              <span class="session-kwh-val">${kwhDisplay}</span>
              <span class="session-kwh-unit">kWh</span>
            </div>
            <div class="session-cost-val">${costDisplay}</div>
          </div>

          <div class="session-details-row">
            <div>
              <span>📍 ${s.odometer ? s.odometer.toLocaleString('de-DE') + ' km' : 'km nicht notiert'}</span>
              ${deltaInfo.deltaKm > 0 ? `<span class="delta-tag-live" style="margin-left: 6px;">+${deltaInfo.deltaKm} km</span>` : ''}
            </div>
            <div>
              <span>${priceDisplay}</span>
              ${deltaInfo.consumption ? `<span style="margin-left: 4px; color: var(--cupra-bronze-light);">(${deltaInfo.consumption.toFixed(1)} kWh/100)</span>` : ''}
            </div>
          </div>

          ${eff !== null ? `
          <div style="font-size:0.68rem; color: var(--text-muted); margin-top: -2px; margin-bottom: 6px;">
            ⚡️ Wirkungsgrad: <strong style="color: var(--cupra-bronze-bright);">${eff.toFixed(1).replace('.', ',')}%</strong> (Netto: +${netKwh.toFixed(1).replace('.', ',')} kWh im Akku)
          </div>` : ''}

          ${s.notes ? `<div class="session-note-text">„${escapeHtml(s.notes)}“</div>` : ''}

          <div class="session-actions-bar">
            ${isBayrhof ? `
              <button class="btn-card-action btn-pay-toggle ${isPaid ? 'paid' : 'unpaid'}" data-id="${s.id}" title="${isPaid ? 'Als noch offen markieren' : 'Als bezahlt markieren'}">
                ${isPaid ? '↩️ Als offen' : '💶 Als bezahlt'}
              </button>
            ` : ''}
            <button class="btn-card-action btn-edit-charge" data-id="${s.id}">${!isComplete ? '✏️ Ergänzen' : '✏️ Bearbeiten'}</button>
            <button class="btn-card-action danger btn-del-charge" data-id="${s.id}">🗑️ Löschen</button>
          </div>
        </div>
      `;
    }).join('');

    DOM.chargesStreamContainer.querySelectorAll('.btn-pay-toggle').forEach(btn => {
      btn.addEventListener('click', () => handleToggleSessionPaid(btn.getAttribute('data-id')));
    });

    DOM.chargesStreamContainer.querySelectorAll('.btn-edit-charge').forEach(btn => {
      btn.addEventListener('click', () => openModalCharge(btn.getAttribute('data-id')));
    });

    DOM.chargesStreamContainer.querySelectorAll('.btn-del-charge').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteCharge(btn.getAttribute('data-id')));
    });
  }

  function getSessionDelta(curr) {
    if (!curr) return { deltaKm: 0, consumption: null };
    const sessions = (appData && Array.isArray(appData.sessions)) ? [...appData.sessions] : [];
    const currId = String(curr.id || curr.ID || '').trim();
    const existingIdx = currId ? sessions.findIndex(s => String(s.id || s.ID || '').trim() === currId) : -1;
    if (existingIdx >= 0) {
      sessions[existingIdx] = curr;
    } else {
      sessions.push(curr);
    }
    const sorted = sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    const idx = sorted.findIndex(s => (currId && String(s.id || s.ID || '').trim() === currId) || s === curr);
    if (idx < 0) return { deltaKm: 0, consumption: null };

    const batteryCap = (appData && appData.vehicle && Number(appData.vehicle.batteryKwh)) || 52.0;
    const currOdo = getSessionOdo(curr);
    const currStartSoc = getSessionStartSoc(curr);

    if (idx > 0 && currOdo > 0) {
      const prev = sorted[idx - 1];
      const prevOdo = getSessionOdo(prev);
      const prevEndSoc = getSessionEndSoc(prev);

      if (prevOdo > 0 && currOdo > prevOdo) {
        const delta = currOdo - prevOdo;
        let cons = null;
        if (prevEndSoc !== null && currStartSoc !== null && prevEndSoc > currStartSoc && delta > 0) {
          const deltaSoc = prevEndSoc - currStartSoc;
          const usedKwh = (deltaSoc / 100) * batteryCap;
          cons = (usedKwh / delta) * 100;
        }
        return { deltaKm: delta, consumption: cons };
      }
    } else if (idx === 0 && currOdo > VEHICLE_START_ODO) {
      // Erstes Intervall: Auslieferung (9 km, 72% SoC) bis 1. Ladung
      const delta = currOdo - VEHICLE_START_ODO;
      let cons = null;
      if (currStartSoc !== null && VEHICLE_START_SOC > currStartSoc && delta > 0) {
        const deltaSoc = VEHICLE_START_SOC - currStartSoc;
        const usedKwh = (deltaSoc / 100) * batteryCap;
        cons = (usedKwh / delta) * 100;
      }
      return { deltaKm: delta, consumption: cons };
    }
    return { deltaKm: 0, consumption: null };
  }

  function handleDeleteCharge(id) {
    if (!confirm('Diesen Ladevorgang wirklich löschen?')) return;
    const cleanId = String(id).trim();

    // In persistentem Storage als gelöscht vormerken, damit verzögerte Cloud-Antworten ihn nicht wiederbeleben
    addDeletedId(cleanId);

    // Sofort lokal aus sessions entfernen
    appData.sessions = (appData.sessions || []).filter(s => String(s.id).trim() !== cleanId);

    // Auch aus Offline-Queue entfernen
    if (appData.pendingSyncQueue && appData.pendingSyncQueue.length > 0) {
      appData.pendingSyncQueue = appData.pendingSyncQueue.filter(item => {
        const itemId = item.id || item.ID || (item.session && (item.session.id || item.session.ID));
        return String(itemId).trim() !== cleanId;
      });
    }

    syncVehicleStateFromSessions();
    saveData();
    renderAll();
    triggerHaptic();
    showToast('Ladevorgang gelöscht');

    // Cloud-Sync: Löscht nur exakt dieses Ereignis aus Google Sheets
    deleteCloudSession(cleanId);
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
  // TAB 3: WETTER & STANDORT-FILTERUNG (BAYRHOFS, ZUHAUSE, ARBEIT, ÖFFENTLICH & GPS)
  // =========================================================================
  function getActiveWeatherLocation() {
    const activeId = activeWeatherLocationId || (appData && appData.settings && appData.settings.activeWeatherLocationId) || 'gps';

    if (activeId === 'gps') {
      const cached = typeof getSmartGpsCache === 'function' ? getSmartGpsCache() : null;
      const gps = (appData && appData.settings && appData.settings.weatherGps) || DEFAULT_DATA.settings.weatherGps;
      const lat = (cached && typeof cached.lat === 'number') ? cached.lat : (Number(gps.lat) || 47.72);
      const lon = (cached && typeof cached.lon === 'number') ? cached.lon : (Number(gps.lon) || 10.31);
      const name = (cached && cached.name) ? cached.name : (gps.name || 'GPS: Bayrhofs / Kempten');
      return {
        id: 'gps',
        name: 'Aktueller GPS-Standort',
        icon: '📍',
        address: name,
        lat: lat,
        lon: lon,
        isGps: true,
        powerType: 'pv'
      };
    }

    if (activeId === 'loc_oeffentlich') {
      const varLoc = (appData && appData.settings && appData.settings.variableLocation) || {
        name: "Öffentlich (Variabel)",
        lat: 47.72,
        lon: 10.31
      };
      return {
        id: 'loc_oeffentlich',
        name: 'Öffentlich',
        icon: '⚡️',
        address: varLoc.name || 'Variabler Standort',
        lat: Number(varLoc.lat) || 47.72,
        lon: Number(varLoc.lon) || 10.31,
        isVariable: true,
        powerType: 'grid'
      };
    }

    const locs = (appData && appData.settings && appData.settings.locations) || DEFAULT_LOCATIONS;
    const found = locs.find(l => l.id === activeId || l.name === activeId);
    if (found) {
      return {
        id: found.id,
        name: found.name,
        icon: found.icon || '🏢',
        address: found.address || '',
        lat: typeof found.lat === 'number' ? found.lat : 47.7468,
        lon: typeof found.lon === 'number' ? found.lon : 10.3094,
        powerType: found.powerType || 'grid',
        isPv: found.powerType === 'pv'
      };
    }

    return {
      id: 'gps',
      name: 'Aktueller GPS-Standort',
      icon: '📍',
      address: 'GPS: Bayrhofs / Kempten',
      lat: 47.72,
      lon: 10.31,
      isGps: true,
      powerType: 'pv'
    };
  }

  function renderWeatherLocationFilterRail() {
    if (!DOM.weatherLocationFilterRail) return;

    const activeId = activeWeatherLocationId || (appData && appData.settings && appData.settings.activeWeatherLocationId) || 'gps';

    // 1. GPS (Per Default immer zuerst)
    const items = [
      { id: 'gps', name: 'Aktueller GPS', icon: '📍', tag: 'GPS' }
    ];

    // 2. Alle konfigurierten Standorte
    const locs = (appData && appData.settings && appData.settings.locations) || DEFAULT_LOCATIONS;
    locs.forEach(l => {
      const isBayrhofs = l.id === 'loc_bayrhofs' || l.name.toLowerCase().includes('bayrhof');
      const isZuhause = l.id === 'loc_zuhause' || l.name.toLowerCase().includes('zuhause');
      const isArbeit = l.id === 'loc_arbeit' || l.name.toLowerCase().includes('arbeit');
      const isOeffentlich = l.id === 'loc_oeffentlich' || l.name.toLowerCase().includes('öffentlich');

      let tag = '';
      if (isZuhause) tag = 'Durach';
      else if (isArbeit) tag = 'Dachser';
      else if (isBayrhofs) tag = 'PV';
      else if (isOeffentlich) tag = 'Variabel';
      else if (l.powerType === 'pv') tag = 'PV';

      items.push({
        id: l.id,
        name: l.name,
        icon: l.icon || '🏢',
        tag
      });
    });

    DOM.weatherLocationFilterRail.innerHTML = items.map(item => {
      const isAct = item.id === activeId;
      return `
        <button type="button" class="weather-loc-chip ${isAct ? 'active' : ''}" data-loc-id="${item.id}" role="tab" aria-selected="${isAct}">
          <span class="chip-loc-icon">${item.icon}</span>
          <span class="chip-loc-name">${escapeHtml(item.name)}</span>
          ${item.tag ? `<span class="chip-loc-tag">${escapeHtml(item.tag)}</span>` : ''}
        </button>
      `;
    }).join('');

    // Klick Event
    DOM.weatherLocationFilterRail.querySelectorAll('.weather-loc-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-loc-id');
        selectWeatherLocation(id);
      });
    });

    // Badge aktualisieren
    if (DOM.weatherActiveLocBadge) {
      const cur = items.find(i => i.id === activeId) || items[0];
      DOM.weatherActiveLocBadge.textContent = `${cur.icon} ${cur.name} ${cur.tag ? `(${cur.tag})` : ''}`.trim();
    }
  }

  async function selectWeatherLocation(locId, forceRefresh = false) {
    activeWeatherLocationId = locId;
    if (appData && appData.settings) {
      appData.settings.activeWeatherLocationId = locId;
      saveData();
    }

    renderWeatherLocationFilterRail();
    triggerHaptic();

    if (locId === 'gps') {
      showToast('Wetter für aktuellen GPS-Standort wird geladen 📍');
      await autoRequestGpsAndFetchWeather(false, true);
    } else {
      const loc = getActiveWeatherLocation();
      showToast(`Wetter für ${loc.name} wird geladen ${loc.icon || '☀️'}`);
      await fetchWeatherCluster(forceRefresh);
    }
  }

  async function handleSearchVariableLocation() {
    const query = DOM.inputWeatherVariableSearch ? DOM.inputWeatherVariableSearch.value.trim() : '';
    if (!query) {
      showToast('⚠️ Bitte einen Ort oder Adresse eingeben');
      return;
    }

    if (DOM.weatherVariableFeedback) {
      DOM.weatherVariableFeedback.textContent = `Suche nach "${query}"...`;
    }

    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=de&format=json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      if (json && Array.isArray(json.results) && json.results.length > 0) {
        const r = json.results[0];
        const dispName = `${r.name}${r.admin1 ? `, ${r.admin1}` : ''}${r.country ? ` (${r.country})` : ''}`;

        appData.settings.variableLocation = {
          name: dispName,
          query,
          lat: Number(r.latitude.toFixed(4)),
          lon: Number(r.longitude.toFixed(4))
        };
        saveData();

        if (DOM.weatherVariableFeedback) {
          DOM.weatherVariableFeedback.textContent = `Gefunden: ${dispName} (${r.latitude.toFixed(2)}°, ${r.longitude.toFixed(2)}°)`;
        }

        showToast(`Standort "${r.name}" übernommen 📍`);
        await fetchWeatherCluster(true);
      } else {
        if (DOM.weatherVariableFeedback) {
          DOM.weatherVariableFeedback.textContent = `Kein Ort zu "${query}" gefunden. Bitte Schreibweise prüfen.`;
        }
        showToast(`Ort "${query}" nicht gefunden`);
      }
    } catch (e) {
      console.warn('Geocoding Fehler:', e);
      if (DOM.weatherVariableFeedback) {
        DOM.weatherVariableFeedback.textContent = 'Suche fehlgeschlagen. Bitte Verbindung prüfen.';
      }
      showToast('Suche fehlgeschlagen');
    }
  }

  function handleUseGpsForVariable() {
    const gps = appData.settings.weatherGps || DEFAULT_DATA.settings.weatherGps;
    appData.settings.variableLocation = {
      name: "Aktueller GPS-Standort",
      query: "GPS",
      lat: Number(gps.lat),
      lon: Number(gps.lon)
    };
    saveData();
    if (DOM.inputWeatherVariableSearch) DOM.inputWeatherVariableSearch.value = 'Aktueller GPS-Standort';
    if (DOM.weatherVariableFeedback) {
      DOM.weatherVariableFeedback.textContent = `GPS übernommen (${gps.lat}°, ${gps.lon}°)`;
    }
    showToast('GPS für variable Position übernommen 📍');
    fetchWeatherCluster(true);
  }

  // =========================================================================
  // SMART GPS CACHING & HINTERGRUND-PERMISSIONS
  // =========================================================================
  const GPS_CACHE_KEY = 'cupra_raval_gps_cache';
  const GPS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde Cache-Gültigkeit

  function getSmartGpsCache() {
    try {
      const raw = localStorage.getItem(GPS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
          const age = Date.now() - (parsed.timestamp || 0);
          return {
            lat: parsed.lat,
            lon: parsed.lon,
            accuracy: parsed.accuracy || 0,
            timestamp: parsed.timestamp || 0,
            name: parsed.name || "GPS: Bayrhofs / Kempten",
            ageMs: age,
            isFresh: age < GPS_CACHE_TTL_MS
          };
        }
      }
    } catch (_) {}

    if (appData && appData.settings && appData.settings.weatherGps) {
      const wg = appData.settings.weatherGps;
      if (typeof wg.lat === 'number' && typeof wg.lon === 'number') {
        return {
          lat: Number(wg.lat),
          lon: Number(wg.lon),
          accuracy: 25,
          timestamp: wg.lastCached || Date.now(),
          name: wg.name || "GPS: Bayrhofs / Kempten",
          ageMs: 0,
          isFresh: true
        };
      }
    }

    return {
      lat: 47.7267,
      lon: 10.3139,
      accuracy: 25,
      timestamp: Date.now(),
      name: "GPS: Bayrhofs / Kempten",
      ageMs: 0,
      isFresh: true
    };
  }

  function setSmartGpsCache(coords, name = null) {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') return null;
    const resolvedName = name || coords.name || "GPS: Bayrhofs / Kempten";
    const entry = {
      lat: Number(coords.lat.toFixed(4)),
      lon: Number(coords.lon.toFixed(4)),
      accuracy: Math.round(coords.accuracy || 0),
      timestamp: Date.now(),
      name: resolvedName
    };
    try {
      localStorage.setItem(GPS_CACHE_KEY, JSON.stringify(entry));
    } catch (_) {}

    if (appData && appData.settings) {
      if (!appData.settings.weatherGps) appData.settings.weatherGps = {};
      appData.settings.weatherGps.lat = entry.lat;
      appData.settings.weatherGps.lon = entry.lon;
      appData.settings.weatherGps.name = entry.name;
      appData.settings.weatherGps.lastCached = entry.timestamp;
      saveData();
    }
    return entry;
  }

  async function checkGeolocationPermission() {
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      try {
        const p = await navigator.permissions.query({ name: 'geolocation' });
        return p.state; // 'granted' | 'prompt' | 'denied'
      } catch (_) {
        return 'unknown';
      }
    }
    return 'unknown';
  }

  async function autoRequestGpsAndFetchWeather(forceNotification = false, isUserGesture = false) {
    // 1. Smarter Cache: Wetter sofort anhand der gecachten GPS-Koordinaten abrufen (0ms Latenz, kein Popup!)
    const cached = getSmartGpsCache();
    if (appData && appData.settings && appData.settings.weatherGps) {
      appData.settings.weatherGps.lat = cached.lat;
      appData.settings.weatherGps.lon = cached.lon;
      appData.settings.weatherGps.name = cached.name;
    }

    // Wetter mit gecachten Werten laden (Feedback-Toast nur bei echter manueller Geste)
    await fetchWeatherCluster(forceNotification && isUserGesture);

    // 2. Automatischer Hintergrund-Refresh beim Start:
    // ABSOLUTE REGEL: Wenn NICHT durch Benutzeraktion ausgelöst (z. B. beim Start der App),
    // darf navigator.geolocation.getCurrentPosition() NUR DANN aufgerufen werden, wenn die
    // Berechtigung bereits dauerhaft erteilt ist ('granted').
    // Bei 'prompt', 'denied' oder 'unknown' wird KEIN getCurrentPosition() aufgerufen!
    // Dadurch erscheint niemals ein nerviges Browser-Popup beim Start.
    if (!isUserGesture) {
      const perm = await checkGeolocationPermission();
      if (perm === 'granted' && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const updated = setSmartGpsCache({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            });
            if (updated) {
              const dLat = Math.abs(updated.lat - cached.lat);
              const dLon = Math.abs(updated.lon - cached.lon);
              if (dLat > 0.02 || dLon > 0.02) {
                await fetchWeatherCluster(false);
              }
            }
          },
          () => {},
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
        );
      }
      return;
    }

    // 3. Explizite Benutzeraktion (z. B. Refresh-Button geklickt, Pull-to-refresh oder GPS-Chip)
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              setSmartGpsCache({
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                accuracy: pos.coords.accuracy
              });
              await fetchWeatherCluster(forceNotification);
            } catch (_) {}
            resolve();
          },
          async () => {
            try {
              await fetchWeatherCluster(forceNotification);
            } catch (_) {}
            resolve();
          },
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
        );
      });
    }
  }

  async function fetchWeatherCluster(showFeedback = false) {
    const loc = getActiveWeatherLocation();

    // 0. Kopfzeilen-Anzeige & Variablen-Box steuern
    if (DOM.weatherDisplayLocation) {
      if (loc.isGps) {
        DOM.weatherDisplayLocation.textContent = `📍 Aktueller Standort (GPS: Bayrhofs / Kempten)`;
      } else if (loc.isVariable) {
        const varName = (appData.settings.variableLocation && appData.settings.variableLocation.name) || 'Variabler Standort';
        DOM.weatherDisplayLocation.textContent = `⚡️ Öffentlich (Variabel: ${varName})`;
      } else {
        DOM.weatherDisplayLocation.textContent = `${loc.icon || '📍'} ${loc.name}${loc.address ? ` • ${loc.address}` : ''}`;
      }
    }

    if (DOM.weatherVariableBox) {
      DOM.weatherVariableBox.style.display = (loc.isVariable || loc.id === 'loc_oeffentlich') ? 'flex' : 'none';
      if ((loc.isVariable || loc.id === 'loc_oeffentlich') && DOM.weatherVariableFeedback) {
        const curName = appData.settings.variableLocation?.name || 'Variabler Standort';
        DOM.weatherVariableFeedback.textContent = `Aktueller Zielort: ${curName} (${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°)`;
      }
    }

    renderWeatherLocationFilterRail();

    // 1. Primär: Zentrale Multi-Model & Solar Engine mit den 5 Open-Source-Diensten
    try {
      if (typeof WeatherService !== 'undefined' && WeatherService.fetchConsensus) {
        const threshold = appData.settings.pvThresholdSunshineHours || 4.5;
        const res = await WeatherService.fetchConsensus(loc.lat, loc.lon, showFeedback, {
          pvThreshold: threshold,
          locationName: loc.name,
          powerType: loc.powerType
        });
        if (res && res.forecast14Days && res.forecast14Days.length > 0) {
          weatherForecast14Days = res.forecast14Days;
          currentDwdAlerts = res.dwdAlerts || [];
          currentAlpineData = res.alpineData || null;
          currentSolarSummary = res.solarSummary || null;
          currentSourcesStatus = res.sourcesStatus || null;

          saveWeatherCache(weatherForecast14Days);
          renderWeatherViews();
          updateDashboardPvDecisionWidget();
          updateDashboardWinterRangeSimulation();
          renderWeatherExtraMeta();
          if (showFeedback) showToast(`Wetter & Solarprognose für ${loc.name} aktualisiert ☀️`);
          return;
        }
      }
    } catch (err) {
      console.warn('[App] WeatherService Consensus Fehler, prüfe Direktabfrage:', err);
    }

    // 2. Sekundär: Direkte Open-Meteo Abfrage mit GHI Solarstrahlung & Regenwahrscheinlichkeit
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,sunshine_duration,precipitation_sum,sunrise,sunset&hourly=temperature_2m,precipitation,precipitation_probability,shortwave_radiation_instant,sunshine_duration,weather_code&forecast_days=14&timezone=auto`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      if (json && json.daily && json.daily.time) {
        weatherForecast14Days = processWeatherForecast(json.daily, json.hourly);
        saveWeatherCache(weatherForecast14Days);
        renderWeatherViews();
        updateDashboardPvDecisionWidget();
        updateDashboardWinterRangeSimulation();
        renderWeatherExtraMeta();
        if (showFeedback) showToast(`Wetterdaten für ${loc.name} aktualisiert ☀️`);
        return;
      }
    } catch (err) {
      console.warn('Wetterabfrage fehlgeschlagen, nutze Cache oder Simulation:', err);
    }

    // 3. Fallback: Synthetische Daten
    if (!weatherForecast14Days) {
      weatherForecast14Days = generateSynthetic14Days();
      saveWeatherCache(weatherForecast14Days);
    }
    renderWeatherViews();
    updateDashboardPvDecisionWidget();
    updateDashboardWinterRangeSimulation();
    renderWeatherExtraMeta();
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
          else if (code >= 45 && code <= 48) icon = '🌫️';
          else if (code === 3) icon = '☁️';
          else if (code === 2) icon = '☁️';
          else icon = '🌙';
        } else {
          const hInfo = determineAccurateWeatherIcon(sunHours > 0.5 ? 7 : (sunHours > 0.1 ? 3 : 0.5), rain, code);
          icon = (hInfo && hInfo.icon) ? hInfo.icon : '☀️';
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

  /**
   * Präzise Icon- & Wetterzustandsbestimmung (100% Emoji-basiert, niemals SVG-Artefakte).
   * Garantiert individuelles, treffendes Icon für jede Wetterlage:
   * - ☀️ Sehr sonnig / Sonnig (>= 6h Sonne, trocken)
   * - 🌤️ Überwiegend sonnig / Heiter (4h bis < 6h Sonne)
   * - ⛅ Teils wolkig (2h bis < 4h Sonne)
   * - 🌥️ Überwiegend bewölkt
   * - ☁️ Bedeckt / Dicht bewölkt (< 2h Sonne, trocken)
   * - 🌦️ Sonne & Schauer (Sonne + Niederschlag kombiniert)
   * - 🌧️ Regen / Regenschauer / Starkregen
   * - ⛈️ Gewitter / Unwetter
   * - 🌨️ Schnee / Schneeschauer
   * - ☁️ Echter Nebel / Hochnebel (NUR wenn Sonne < 2h & WMO 45/48)
   */
  function determineAccurateWeatherIcon(sunshineHours, rainMm, code) {
    const sun = Number(sunshineHours) || 0;
    const rain = Number(rainMm) || 0;
    const c = (code !== undefined && code !== null) ? Number(code) : 0;

    // 1. Gewitter & Unwetter (WMO 95, 96, 99)
    if (c >= 95) {
      if (c >= 96) return { icon: '⛈️', conditionText: 'Gewitter mit Hagel' };
      if (sun >= 4.0) return { icon: '⛈️', conditionText: 'Sonne & Gewitter' };
      return { icon: '⛈️', conditionText: 'Gewitter' };
    }

    // 2. Schnee & Eis (WMO 71-77, 85-86, 56-57, 66-67)
    if ((c >= 71 && c <= 77) || c === 85 || c === 86 || c === 56 || c === 57 || c === 66 || c === 67) {
      if (c === 85 || c === 86) return { icon: '🌨️', conditionText: 'Schneeschauer' };
      if (c === 77) return { icon: '🌨️', conditionText: 'Schneegriesel' };
      if (c === 56 || c === 57 || c === 66 || c === 67) return { icon: '🌨️', conditionText: 'Gefrierender Regen' };
      if (sun >= 3.5) return { icon: '🌨️', conditionText: 'Sonne & Schnee' };
      return { icon: '🌨️', conditionText: 'Schneefall' };
    }

    // 3. Sehr viel Sonnenschein (>= 7.5 Stunden) -> IMMER sonniges Icon!
    // Hinweis: Morgendlicher Frühnebel (Code 45/48) löst sich bei 7-10h Sonne vormittags komplett auf.
    if (sun >= 7.5) {
      if (rain >= 2.0) return { icon: '🌦️', conditionText: 'Sonne & Schauer' };
      if (rain >= 0.5) return { icon: '🌤️', conditionText: 'Heiter, Schauer' };
      return { icon: '☀️', conditionText: 'Sehr sonnig' };
    }

    // 4. Viel Sonnenschein (6.0 bis < 7.5 Stunden)
    if (sun >= 6.0) {
      if (rain >= 2.0) return { icon: '🌦️', conditionText: 'Sonne & Schauer' };
      if (rain >= 0.5) return { icon: '🌤️', conditionText: 'Heiter, Schauer' };
      return { icon: '☀️', conditionText: 'Sonnig' };
    }

    // 5. Gute Sonnenscheindauer (4.0 bis < 6.0 Stunden)
    if (sun >= 4.0) {
      if (rain >= 2.5) return { icon: '🌧️', conditionText: 'Regenschauer' };
      if (rain >= 0.6) return { icon: '🌦️', conditionText: 'Sonne & Schauer' };
      if (c === 45 || c === 48) return { icon: '🌤️', conditionText: 'Morgennebel, heiter' };
      if (c === 1 || c === 0) return { icon: '🌤️', conditionText: 'Überwiegend heiter' };
      return { icon: '🌤️', conditionText: 'Überwiegend sonnig' };
    }

    // 6. Teils Sonne / Mäßig (2.0 bis < 4.0 Stunden)
    if (sun >= 2.0) {
      if (rain >= 2.5) return { icon: '🌧️', conditionText: 'Regenschauer' };
      if (rain >= 0.6) return { icon: '🌦️', conditionText: 'Wechselhaft mit Regen' };
      if (rain >= 0.2) return { icon: '🌦️', conditionText: 'Kurze Schauer' };
      if (c === 45 || c === 48) return { icon: '⛅', conditionText: 'Nebelauflösung' };
      return { icon: '⛅', conditionText: 'Teils wolkig' };
    }

    // 7. Wenig Sonne (0.8 bis < 2.0 Stunden)
    if (sun >= 0.8) {
      if (rain >= 3.0) return { icon: '🌧️', conditionText: 'Starkregen' };
      if (rain >= 0.6) return { icon: '🌧️', conditionText: 'Regnerisch' };
      if (rain >= 0.2) return { icon: '🌧️', conditionText: 'Leichter Regen' };
      if (c === 45 || c === 48) return { icon: '🌫️', conditionText: 'Hochnebel' };
      if (c === 3) return { icon: '☁️', conditionText: 'Dicht bewölkt' };
      return { icon: '🌥️', conditionText: 'Überwiegend bewölkt' };
    }

    // 8. Kaum / Keine Sonne (< 0.8 Stunden)
    if (rain >= 3.0 || c === 65 || c === 82) return { icon: '🌧️', conditionText: 'Starkregen' };
    if (rain >= 0.8 || (c >= 61 && c <= 63) || (c >= 80 && c <= 81)) return { icon: '🌧️', conditionText: 'Regen' };
    if (rain > 0 || (c >= 51 && c <= 55)) return { icon: '🌧️', conditionText: 'Nieselregen' };
    if (c === 45 || c === 48) return { icon: '🌫️', conditionText: 'Nebel' };
    if (c === 3) return { icon: '☁️', conditionText: 'Bedeckt' };
    return { icon: '☁️', conditionText: 'Trüb & bedeckt' };
  }

  // =========================================================================
  // INTELLIGENTE LADE-EMPFEHLUNG (NMC-BATTERIE-ENGINE & MULTI-METRIK-ANALYSE)
  // =========================================================================

  /**
   * Physikalisch kalibrierter Effizienzfaktor für NMC (Nickel-Mangan-Kobalt)
   * Zellen des Cupra Raval (MEB Entry Plattform, 52 kWh nutzbar).
   *
   * Chemische & thermische Eigenschaften von NMC-Zellen:
   * - Optimaler elektrochemischer Bereich: 20°C bis 24°C (Faktor 1.0 = 100%)
   * - Bei Kälte sinkt die Ionen-Diffusionsgeschwindigkeit im Elektrolyten,
   *   der Innenwiderstand (Ri) steigt, und die Kabinen- & Batterieheizung
   *   (PTC-Heizer / Wärmepumpe) zieht erhebliche Leistung (1.5 - 3.5 kW).
   * - Bei Frost (< 0°C) verliert der NMC-Akku bis zu 25-35% Realreichweite.
   * - Bei Hitze (> 24°C) fordert die aktive Akkukühlung (Chiller) zusätzliche Energie.
   */
  function getNmcTemperatureEfficiency(tempC) {
    const t = (typeof tempC === 'number' && !isNaN(tempC)) ? tempC : 14;
    if (t >= 20 && t <= 24) {
      return 1.0;
    }
    if (t > 24) {
      // Aktive Akkukühlung & Kabinenklima: ~1.2% Verlust je Grad über 24°C
      return Math.max(0.88, 1.0 - (t - 24) * 0.012);
    }
    if (t >= 10) {
      // 10°C bis 19°C: Leichter Innenwiderstand, mäßige Heizung (0.90 bis 0.99)
      return 0.90 + ((t - 10) / 10) * 0.095;
    }
    if (t >= 0) {
      // 0°C bis 9°C: Deutlicher Heizbedarf, Kälteeinfluss (0.78 bis 0.89)
      return 0.78 + (t / 10) * 0.115;
    }
    if (t >= -10) {
      // -10°C bis -1°C: Winterbetrieb, hohe Viskosität des Elektrolyts (0.65 bis 0.77)
      return 0.65 + ((t + 10) / 10) * 0.125;
    }
    // Tiefwinter unter -10°C
    return Math.max(0.52, 0.65 + ((t + 10) / 10) * 0.10);
  }

  function updateSmartChargingRecommendation() {
    if (!DOM.smartChargeCard) return;
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;

    const v = (appData && appData.vehicle) || {};
    const batteryCapacity = Number(v.batteryKwh) || 52.0;
    const currentOdo = Number(v.currentOdo) || 0;
    const sessions = (appData && Array.isArray(appData.sessions)) ? appData.sessions : [];

    // 1. Fahrprofil & Verbrauch aus Historie (NUR echte Messwerte!)
    const consData = calcConsumption(sessions);
    const hasConsHistory = !!(consData && consData.hasData);
    const distStats = calcDistanceStats(sessions, currentOdo);

    const baseConsumption = hasConsHistory ? Number(consData.avgCons.toFixed(1)) : null;
    const dailyKm = (distStats && distStats.avgKmPerDay >= 1) ? Math.round(distStats.avgKmPerDay) : null;

    // 2. Aktuelles Tageswetter & NMC-Zellchemie Temperaturfaktor
    const today = weatherForecast14Days[0];
    const todayTemp = today ? Math.round((today.tMax + today.tMin) / 2) : 12;
    const todayNmcFactor = getNmcTemperatureEfficiency(todayTemp);
    const nmcLossPct = Math.max(0, Math.round((1 - todayNmcFactor) * 100));
    const todayEffectiveCons = (baseConsumption && todayNmcFactor > 0) ? Number((baseConsumption / todayNmcFactor).toFixed(1)) : null;

    // 3. Akku SoC & Restreichweite (NUR echte Daten!)
    const hasRealSoc = (v.currentSoc !== null && v.currentSoc !== undefined && !isNaN(Number(v.currentSoc)));
    const currentSocPct = hasRealSoc ? Math.round(Number(v.currentSoc)) : null;
    const currentRemainingKwh = hasRealSoc ? Number(((batteryCapacity * currentSocPct) / 100).toFixed(1)) : null;
    const currentRangeKm = (hasRealSoc && todayEffectiveCons) ? Math.round((currentRemainingKwh / todayEffectiveCons) * 100) : null;

    // 4. Intelligente Projektion der ersten 7 Tage (Fokus auf 3-Tage Vorschau)
    const candidateDays = [];
    let cumEnergyNeeded = 0;

    for (let i = 0; i < Math.min(7, weatherForecast14Days.length); i++) {
      const d = weatherForecast14Days[i];
      const dAvgTemp = Math.round((d.tMax + d.tMin) / 2);
      const dNmcFactor = getNmcTemperatureEfficiency(dAvgTemp);
      const pvYield = (d.solarYield && d.solarYield.estimatedPvKwh) ? d.solarYield.estimatedPvKwh : 0;
      const sunHours = d.sunshineHours || 0;
      const rainMm = d.rainMm || 0;
      const dDate = new Date(d.dateStr);
      const dayOfWeek = dDate.getDay();
      const isWorkday = (dayOfWeek >= 1 && dayOfWeek <= 5);

      // Bestes Zeitfenster berechnen (Heute nachmittagsspezifisch!)
      let timeWindow;
      if (i === 0) {
        const nowHour = new Date().getHours();
        if (nowHour < 11) {
          timeWindow = '11:30 – 15:30 Uhr';
        } else if (nowHour >= 11 && nowHour < 15) {
          timeWindow = '12:30 – 16:30 Uhr';
        } else if (nowHour >= 15 && nowHour < 18) {
          timeWindow = '15:30 – 18:30 Uhr';
        } else {
          timeWindow = 'Abends / Über Nacht';
        }
      } else {
        if (sunHours >= 3.5 || pvYield >= 8) {
          timeWindow = '11:30 – 15:30 Uhr';
        } else if (d.tMax >= 12) {
          timeWindow = '13:00 – 16:30 Uhr';
        } else {
          timeWindow = '12:00 – 15:00 Uhr';
        }
      }

      let projEnergyAtStartOfDay = currentRemainingKwh;
      let projSocPct = currentSocPct;

      let score = 0;
      score += pvYield * 3.5;
      score += sunHours * 2.0;

      if (d.tMax >= 15) score += 8;
      else if (d.tMax >= 10) score += 4;
      else if (d.tMax < 4) score -= 6; // Kalter Akku ohne Vorwärmung

      if (rainMm >= 3) score -= 4;
      if (isWorkday && (d.hasPvSurplus || pvYield >= 8)) score += 10;

      // Wenn echtes Fahrprofil und echter Akkustand existieren, simulieren wir die reale Entladung
      if (hasRealSoc && hasConsHistory && baseConsumption && dailyKm) {
        const dEffectiveCons = baseConsumption / dNmcFactor;
        const dEnergyNeeded = (dailyKm * dEffectiveCons) / 100;
        projEnergyAtStartOfDay = Math.max(0, currentRemainingKwh - cumEnergyNeeded);
        projSocPct = Math.round((projEnergyAtStartOfDay / batteryCapacity) * 100);
        cumEnergyNeeded += dEnergyNeeded;

        if (projSocPct <= 22) score += 45; // Akku muss zwingend geladen werden!
        else if (projSocPct <= 35) score += 20; // Ideales 20-80% NMC-Zyklenfenster
        else if (projSocPct >= 65 && i > 0) score -= 15; // Akku noch zu voll
      }

      const dayLabel = (i === 0) ? 'Heute' : ((i === 1) ? 'Morgen' : `${d.dayName}, ${d.dateDisplay}`);

      candidateDays.push({
        dayIndex: i,
        day: d,
        dayLabel,
        projEnergyAtStartOfDay,
        projSocPct,
        pvYield,
        sunHours,
        rainMm,
        timeWindow,
        score,
        badgeClass: 'moderate',
        badgeLabel: '⛅ Mäßig',
        verdictText: 'Mäßiger Solarertrag.',
        isWorkday,
        dAvgTemp,
        dNmcFactor
      });
    }

    // Relative Differenzierung der ersten 3 Tage ("Was Sache ist")
    const maxPvIn3Days = Math.max(...candidateDays.slice(0, 3).map(c => c.pvYield));
    const best3DayIndex = candidateDays.slice(0, 3).reduce((bestIdx, c, idx, arr) => c.score > arr[bestIdx].score ? idx : bestIdx, 0);

    candidateDays.slice(0, 3).forEach((cd, idx) => {
      if (cd.projSocPct !== null && cd.projSocPct <= 22) {
        cd.badgeClass = 'urgent';
        cd.badgeLabel = '⚠️ Dringend';
        cd.verdictText = 'Akku niedrig – zügig laden!';
      } else if (idx === best3DayIndex && (cd.pvYield >= 8.0 || cd.sunHours >= 4.0)) {
        cd.badgeClass = 'top';
        cd.badgeLabel = '🌟 Bester Slot';
        cd.verdictText = (idx === 0) 
          ? 'Heute bester Ladeslot mit maximaler Solarleistung.' 
          : `Höchster PV-Ertrag der 3 Tage (~${cd.pvYield} kWh).`;
      } else if (idx === 0) {
        if (cd.pvYield >= 5.0 || cd.sunHours >= 2.0) {
          cd.badgeClass = 'good';
          cd.badgeLabel = '⚡️ Nachmittag gut';
          cd.verdictText = 'Nachmittags ideal für Zwischenladung.';
        } else if (cd.rainMm >= 2.5 || cd.sunHours < 1.0) {
          cd.badgeClass = 'cold';
          cd.badgeLabel = '🌧️ Wenig Sonne';
          cd.verdictText = 'Wenig Ertrag – besser Folgetag nutzen.';
        } else {
          cd.badgeClass = 'moderate';
          cd.badgeLabel = '⛅ Mäßig';
          cd.verdictText = 'Zwischenladung möglich, Netzstrom dominiert.';
        }
      } else {
        if (cd.pvYield >= 8.0 || cd.sunHours >= 4.0) {
          cd.badgeClass = 'good';
          cd.badgeLabel = '☀️ Sehr gut';
          cd.verdictText = 'Hoher PV-Überschuss nutzbar.';
        } else if (cd.pvYield >= 4.5 || cd.sunHours >= 2.0) {
          cd.badgeClass = 'good';
          cd.badgeLabel = '⚡️ Gut nutzbar';
          cd.verdictText = 'Gutes Ladefenster für Pendler.';
        } else if (cd.rainMm >= 2.5 || cd.sunHours < 1.0) {
          cd.badgeClass = 'cold';
          cd.badgeLabel = '🌧️ Trüb';
          cd.verdictText = 'Bewölkt/Regnerisch – Ertrag gering.';
        } else {
          cd.badgeClass = 'moderate';
          cd.badgeLabel = '⛅ Mäßig';
          cd.verdictText = 'Mäßige Sonnenstunden.';
        }
      }
    });

    // 5. Auswahl des aktiven Kandidaten (Reaktiv auf Heute + Klick-Auswahl)
    const sortedByScore = [...candidateDays].sort((a, b) => b.score - a.score);
    const highestCandidate = sortedByScore[0] || candidateDays[0];
    const todayCandidate = candidateDays[0];
    const isTodayViable = (todayCandidate && (todayCandidate.badgeClass === 'top' || todayCandidate.badgeClass === 'good' || todayCandidate.pvYield >= 5.0 || todayCandidate.sunHours >= 1.8));

    let activeCandidate;
    if (selectedSmartRecoDayIndex !== null) {
      activeCandidate = candidateDays.find(c => c.dayIndex === selectedSmartRecoDayIndex) || highestCandidate;
    } else {
      // Wenn heute nachmittags bereits gut zum Laden ist, bieten wir heute als sofortigen Ladeslot an!
      // Ansonsten den Slot mit dem besten Gesamtertrag/Score
      activeCandidate = isTodayViable ? todayCandidate : highestCandidate;
    }

    const bDay = activeCandidate.day;
    const isTodaySlot = (activeCandidate.dayIndex === 0);
    const isTomorrowSlot = (activeCandidate.dayIndex === 1);
    const slotDayLabel = activeCandidate.dayLabel;
    const timeWindow = activeCandidate.timeWindow;

    // 6. 3-Tage Vorschau rendern (Kompakt & direkt vergleichbar)
    if (DOM.smartReco3DayGrid) {
      DOM.smartReco3DayGrid.innerHTML = candidateDays.slice(0, 3).map(cd => {
        const isActive = (cd.dayIndex === activeCandidate.dayIndex);
        let dayTitle = 'Heute';
        if (cd.dayIndex === 1) dayTitle = 'Morgen';
        else if (cd.dayIndex > 1) dayTitle = cd.day.dayName;

        const dateDisplay = cd.day.dateDisplay;
        const nmcPct = Math.round(cd.dNmcFactor * 100);
        const cleanTime = cd.timeWindow.replace(' Uhr', '');

        return `
          <div class="reco-3day-card ${isActive ? 'active' : ''}" data-day-index="${cd.dayIndex}" title="Tippen für Details zu ${escapeHtml(dayTitle)}">
            <div class="r3-head">
              <span class="r3-day-name">${escapeHtml(dayTitle)}</span>
              <span class="r3-day-date">${escapeHtml(dateDisplay)}</span>
            </div>
            <span class="r3-badge ${cd.badgeClass}">${escapeHtml(cd.badgeLabel)}</span>
            <div class="r3-time">${escapeHtml(cleanTime)}</div>
            <div class="r3-stats">
              <span class="r3-stat-item solar">
                <span>☀️</span> <strong>${cd.sunHours}h</strong> • ~${cd.pvYield} kWh
              </span>
              <span class="r3-stat-item">
                <span>🌡️</span> <strong>${cd.day.tMax}°C</strong> (${nmcPct}%)
              </span>
            </div>
            <div class="r3-verdict">${escapeHtml(cd.verdictText)}</div>
          </div>
        `;
      }).join('');
    }

    // 7. Standort-Empfehlung für den aktiven Slot
    const activeLoc = getActiveWeatherLocation();
    const bayrhofsLoc = (appData.settings && appData.settings.locations && appData.settings.locations.find(l => l.id === 'loc_bayrhofs' || l.name.toLowerCase().includes('bayrhof'))) || DEFAULT_LOCATIONS[0];
    const zuhauseLoc = (appData.settings && appData.settings.locations && appData.settings.locations.find(l => l.id === 'loc_zuhause' || l.name.toLowerCase().includes('zuhause'))) || DEFAULT_LOCATIONS[1];

    let bestLocationText = `${bayrhofsLoc.icon || '🏢'} ${bayrhofsLoc.name} (PV-Überschuss)`;
    let kwhTariff = Number(bayrhofsLoc.kwhPrice) || 0.15;
    if (bDay.hasPvSurplus || (bDay.solarYield && bDay.solarYield.estimatedPvKwh >= 8)) {
      bestLocationText = `${bayrhofsLoc.icon || '🏢'} ${bayrhofsLoc.name} (PV-Überschuss)`;
      kwhTariff = Number(bayrhofsLoc.kwhPrice) || 0.15;
    } else if (activeLoc.id === 'loc_zuhause') {
      bestLocationText = `${zuhauseLoc.icon || '🏠'} ${zuhauseLoc.name} (Günstiger Tarif)`;
      kwhTariff = Number(zuhauseLoc.kwhPrice) || 0.32;
    } else {
      bestLocationText = `${activeLoc.icon || '📍'} ${activeLoc.name || 'Empfohlener Ladeort'}`;
      kwhTariff = Number(activeLoc.kwhPrice) || 0.25;
    }

    // 8. Empfohlene Lademenge (Ziel: 80% SoC für NMC-Zellgesundheit)
    const targetEnergyKwh = batteryCapacity * 0.80;
    let chargeKwhNeeded = null;
    let savingsEur = null;

    if (hasRealSoc && currentRemainingKwh !== null) {
      const startingEnergy = (activeCandidate.projEnergyAtStartOfDay !== null && activeCandidate.projEnergyAtStartOfDay !== undefined)
        ? activeCandidate.projEnergyAtStartOfDay
        : currentRemainingKwh;
      chargeKwhNeeded = Math.max(8, Math.min(batteryCapacity, Math.round(targetEnergyKwh - startingEnergy)));
      savingsEur = Number((chargeKwhNeeded * Math.max(0.15, 0.59 - kwhTariff)).toFixed(2));
    }

    // 9. UI Aktualisierung (Hero Box & Badge)
    if (DOM.smartRecoSubModel) {
      DOM.smartRecoSubModel.textContent = `${v.model || 'Cupra Raval'} • NMC-Zellen (${batteryCapacity.toFixed(1)} kWh)`;
    }

    if (DOM.smartRecoTimeVal) {
      DOM.smartRecoTimeVal.textContent = `${slotDayLabel} • ${timeWindow}`;
    }

    if (DOM.smartRecoLocVal) {
      DOM.smartRecoLocVal.textContent = bestLocationText;
    }

    if (DOM.smartRecoKwhVal) {
      DOM.smartRecoKwhVal.textContent = (chargeKwhNeeded !== null)
        ? `+${chargeKwhNeeded} kWh (Ziel: 80% SoC)`
        : `-- kWh (Akkustand fehlt)`;
    }

    if (DOM.smartRecoSavingsPill) {
      DOM.smartRecoSavingsPill.textContent = (savingsEur !== null)
        ? `⚡️ ~${savingsEur.toFixed(2).replace('.', ',')} € Ersparnis`
        : `☀️ Günstigster Solar-Slot`;
    }

    // 10. Intelligente Begründung mit klarer 3-Tage-Transparenz
    let reasoning = ``;
    if (isTodaySlot) {
      reasoning = `<strong>Heute direkt nutzen:</strong> Nachmittags (${timeWindow}) herrschen gute Bedingungen mit <strong>${activeCandidate.sunHours}h Sonne</strong> und <strong>~${activeCandidate.pvYield} kWh Solarertrag</strong> bei ${bDay.tMax}°C für eine Zwischenladung. `;
    } else {
      reasoning = `<strong>${slotDayLabel} (${timeWindow}):</strong> Bei <strong>${activeCandidate.sunHours}h Sonne</strong> und <strong>~${activeCandidate.pvYield} kWh PV-Ertrag</strong> erreichst du maximalen Solarüberschuss. `;
    }

    // Kompakter 3-Tage Status im Text
    const d0 = candidateDays[0];
    const d1 = candidateDays[1];
    const d2 = candidateDays[2];
    if (d0 && d1 && d2) {
      reasoning += `<br><br>📊 <strong>3-Tage-Check:</strong> ` +
        `<strong>Heute:</strong> ${escapeHtml(d0.badgeLabel)} (~${d0.pvYield} kWh PV, ${d0.timeWindow}) • ` +
        `<strong>Morgen:</strong> ${escapeHtml(d1.badgeLabel)} (~${d1.pvYield} kWh PV) • ` +
        `<strong>${escapeHtml(d2.day.dayName)}:</strong> ${escapeHtml(d2.badgeLabel)} (~${d2.pvYield} kWh PV). `;
    }

    if (activeCandidate.dAvgTemp <= 14) {
      const loss = Math.max(0, Math.round((1 - activeCandidate.dNmcFactor) * 100));
      reasoning += `<br>Thermischer NMC-Effekt: Bei ${activeCandidate.dAvgTemp}°C rund ${loss}% Kälteeinfluss. Das Zeitfenster (${timeWindow}) nutzt die wärmste Tagesphase (${bDay.tMax}°C), um Vorheizverluste zu minimieren. `;
    } else {
      reasoning += `<br>Die milden ${bDay.tMax}°C halten die NMC-Zellen im optimalen Wirkungsgradfenster (20–24°C). `;
    }

    if (hasRealSoc && hasConsHistory) {
      reasoning += `<br><br>Dein aktueller Akkustand (<strong>${currentSocPct}% SoC / ~${currentRangeKm} km</strong>) reicht bei deinem realen Fahrprofil (~${dailyKm} km/Tag) bis ${slotDayLabel} sicher aus.`;
    } else if (hasRealSoc && !hasConsHistory) {
      reasoning += `<br><br>Dein aktueller Akkustand: <strong>${currentSocPct}% SoC (${currentRemainingKwh.toFixed(1)} kWh)</strong>.<br>` +
        `<div class="smart-reco-pending-note">📊 <strong>Warte auf Fahrprofil:</strong> Sobald mindestens 2 Ladevorgänge mit Kilometerstand erfasst sind, berechnet die KI deinen exakten Tagesverbrauch und Entladezeitpunkt.</div>`;
    } else if (!hasRealSoc && hasConsHistory) {
      reasoning += `<br><br>Dein reales Fahrprofil beträgt <strong>${baseConsumption.toFixed(1).replace('.', ',')} kWh/100km</strong> (~${dailyKm} km/Tag).<br>` +
        `<div class="smart-reco-pending-note">🔋 <strong>Akkustand fehlt:</strong> Trage deinen aktuellen Akkustand ein (<a href="#" id="linkSetSocPrompt" style="color:var(--brand-primary); text-decoration:underline;">hier tippen</a> oder in Einstellungen), um die genaue Reichweite und Ladezeit zu berechnen.</div>`;
    } else {
      reasoning += `<br><div class="smart-reco-pending-note">📊 <strong>Warte auf echte Fahrzeugdaten:</strong> Eine individuelle Akku-Entladeprognose berechnet die App, sobald du deinen <a href="#" id="linkSetSocPrompt" style="color:var(--brand-primary); text-decoration:underline; font-weight:700;">Akkustand eingetragen hast</a> und mindestens <strong>2 Ladevorgänge mit Kilometerstand</strong> erfasst wurden.</div>`;
    }

    if (DOM.smartRecoReasoningText) {
      DOM.smartRecoReasoningText.innerHTML = reasoning;
    }

    // Dynamic Badge Pill
    if (DOM.smartRecoBadge) {
      if (isTodaySlot && isTodayViable) {
        DOM.smartRecoBadge.textContent = '⚡️ Heute Nachmittag';
        DOM.smartRecoBadge.className = 'smart-reco-badge-pill pv';
      } else if (activeCandidate.badgeClass === 'top') {
        DOM.smartRecoBadge.textContent = '🎯 Bester Solar-Slot';
        DOM.smartRecoBadge.className = 'smart-reco-badge-pill';
      } else if (activeCandidate.badgeClass === 'cold') {
        DOM.smartRecoBadge.textContent = '❄️ Kälteschutz';
        DOM.smartRecoBadge.className = 'smart-reco-badge-pill cold';
      } else if (!hasRealSoc || !hasConsHistory) {
        DOM.smartRecoBadge.textContent = '☀️ Solar-Vorschau';
        DOM.smartRecoBadge.className = 'smart-reco-badge-pill pv';
      } else {
        DOM.smartRecoBadge.textContent = '🎯 Optimaler Slot';
        DOM.smartRecoBadge.className = 'smart-reco-badge-pill';
      }
    }

    // 11. 4 Metriken Kacheln (NUR echte Daten!)
    if (DOM.smartMetricBattery) {
      if (hasRealSoc) {
        DOM.smartMetricBattery.textContent = currentRangeKm 
          ? `${currentSocPct}% • ~${currentRangeKm} km`
          : `${currentSocPct}% • ${currentRemainingKwh.toFixed(1)} kWh`;
      } else {
        DOM.smartMetricBattery.textContent = `-- % • -- km`;
      }
    }
    if (DOM.smartMetricBatterySub) {
      if (hasRealSoc) {
        DOM.smartMetricBatterySub.textContent = `${currentRemainingKwh.toFixed(1)} kWh im Akku (tippen)`;
      } else {
        DOM.smartMetricBatterySub.textContent = `Kein Akkustand hinterlegt (tippen)`;
      }
    }

    if (DOM.smartMetricNmc) {
      DOM.smartMetricNmc.textContent = `${Math.round(activeCandidate.dNmcFactor * 100)}% @ ${bDay.tMax}°C`;
    }
    if (DOM.smartMetricNmcSub) {
      const activeLoss = Math.max(0, Math.round((1 - activeCandidate.dNmcFactor) * 100));
      DOM.smartMetricNmcSub.textContent = (activeCandidate.dNmcFactor < 0.98)
        ? `-${activeLoss}% Kälteeinfluss`
        : `Optimal (20–24°C)`;
    }

    if (DOM.smartMetricDriving) {
      if (hasConsHistory && baseConsumption !== null && dailyKm !== null) {
        DOM.smartMetricDriving.textContent = `${baseConsumption.toFixed(1).replace('.', ',')} kWh • ${dailyKm} km/d`;
      } else {
        DOM.smartMetricDriving.textContent = `-- kWh • -- km/d`;
      }
    }
    if (DOM.smartMetricDrivingSub) {
      if (hasConsHistory) {
        DOM.smartMetricDrivingSub.textContent = `Reales Fahrprofil`;
      } else {
        DOM.smartMetricDrivingSub.textContent = `Mind. 2 Ladungen erforderlich`;
      }
    }

    if (DOM.smartMetricSolar) {
      DOM.smartMetricSolar.textContent = `${bDay.dayName} • ~${activeCandidate.pvYield} kWh`;
    }
    if (DOM.smartMetricSolarSub) {
      DOM.smartMetricSolarSub.textContent = `${activeCandidate.sunHours}h Sonne • Max ${bDay.solarYield?.maxGhiWatts || 0} W`;
    }
  }

  function renderWeatherViews() {
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;

    const loc = getActiveWeatherLocation();
    const pvDays = weatherForecast14Days.filter(d => d.hasPvSurplus);
    const officeDays = weatherForecast14Days.filter(d => d.decision === 'office');
    const weekendDays = weatherForecast14Days.filter(d => d.decision === 'weekend_charge');
    
    let summaryText = ``;
    if (loc.id === 'loc_bayrhofs' || (loc.powerType === 'pv' && loc.id !== 'gps')) {
      summaryText = `In den kommenden 14 Tagen gibt es an <strong>${pvDays.length} Tagen PV-Überschuss</strong> bei Bayrhofs`;
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
    } else {
      summaryText = `Wetterprognose für <strong>${escapeHtml(loc.name)}</strong>: An <strong>${pvDays.length} Tagen sonnige Bedingungen</strong> für hohe Effizienz und Reichweite.`;
    }
    if (DOM.pvSummaryRecommendationText) {
      DOM.pvSummaryRecommendationText.innerHTML = summaryText;
    }

    // Intelligente Lade-Empfehlung mit NMC-Physik berechnen & anzeigen
    updateSmartChargingRecommendation();

    // Allgäu Solar-Adaptive Engine Status & Ground Truth aktualisieren
    renderSolarAdaptiveCard();

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

    // 100% Garantie: Immer valides, individuelles Icon & Zustand
    const rawIcon = item.icon || '☀️';
    const iconHtml = (rawIcon && rawIcon.includes('🌫'))
      ? `<span class="fog-rounded-icon" title="Nebel">🌫️</span>`
      : rawIcon;
    const conditionText = item.conditionText || 'Sonnig';
    const rainProbText = (item.rainMm > 0 || (item.rainProbMax && item.rainProbMax >= 25))
      ? ` (${item.rainProbMax}%)`
      : '';

    return `
      <div class="swift-glass-card day-forecast-card ${highlightClass}" data-dayindex="${item.dateIndex}">
        <div class="day-left-meta">
          <span class="day-name">${isToday ? 'Heute' : item.dayName}</span>
          <span class="day-date-sub">${item.dateDisplay}</span>
        </div>

        <div class="day-weather-icon-box">
          <span class="day-weather-icon">${iconHtml}</span>
        </div>

        <div class="day-mid-weather">
          <div class="day-temp-row">
            <span class="day-temps">${item.tMax}° / ${item.tMin}°</span>
            <span class="day-condition-label">• ${conditionText}</span>
          </div>
          <div class="day-stats-row">
            <span class="day-sun-stat">☀️ ${item.sunshineHours}h</span>
            <span class="day-rain-stat">💧 ${item.rainMm} l/m²${rainProbText}</span>
            ${item.solarYield && item.solarYield.estimatedPvKwh > 0 ? `<span class="day-solar-stat" style="color:#fbbf24; font-size:0.64rem; font-weight:700; white-space:nowrap; flex-shrink:0;">⚡️ ${item.solarYield.estimatedPvKwh} kWh</span>` : ''}
          </div>
        </div>

        <div class="day-right-badge">
          <span class="${badgeClass}">${item.badgeLabel}</span>
        </div>
      </div>
    `;
  }

  function renderWeatherExtraMeta() {
    // 1. DWD Unwetterwarnungen Banner
    if (DOM.dwdAlertsBanner) {
      if (currentDwdAlerts && currentDwdAlerts.length > 0) {
        DOM.dwdAlertsBanner.style.display = 'flex';
        DOM.dwdAlertsBanner.innerHTML = currentDwdAlerts.map(alert => {
          const sevClass = `severity-${(alert.severity || 'minor').toLowerCase()}`;
          const expireTime = alert.expires ? new Date(alert.expires).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="dwd-alert-item">
              <div class="dwd-alert-header">
                <span class="dwd-alert-badge ${sevClass}">⚠️ DWD: ${alert.event}</span>
                <span class="dwd-alert-time">${expireTime ? `bis ${expireTime} Uhr` : alert.area}</span>
              </div>
              <div class="dwd-alert-title">${alert.headline}</div>
              <div class="dwd-alert-desc">${alert.description || alert.instruction || ''}</div>
            </div>
          `;
        }).join('');
      } else {
        DOM.dwdAlertsBanner.style.display = 'none';
        DOM.dwdAlertsBanner.innerHTML = '';
      }
    }

    // 2. Alpine & Solar Meta Badges Rail
    if (DOM.weatherMetaBadgesRail) {
      const today = weatherForecast14Days && weatherForecast14Days[0];
      const badges = [];

      // Solar GHI
      if (today && today.solarYield) {
        badges.push(`
          <div class="meta-badge-item highlight-solar">
            <span>☀️ Solar-GHI: <strong>${today.solarYield.maxGhiWatts} W/m²</strong></span>
            <span>• ~${today.solarYield.estimatedPvKwh} kWh PV</span>
          </div>
        `);
      }

      // GeoSphere Alpen
      if (currentAlpineData && currentAlpineData.snowLimitMeters) {
        badges.push(`
          <div class="meta-badge-item highlight-alpine">
            <span>🏔️ GeoSphere: Schneefallgrenze <strong>${currentAlpineData.snowLimitMeters.toLocaleString('de-DE')} m</strong></span>
          </div>
        `);
      } else {
        badges.push(`
          <div class="meta-badge-item highlight-alpine">
            <span>🏔️ GeoSphere: INCA/AROME Bergwetter</span>
          </div>
        `);
      }

      // 5 Quellen Konsens
      badges.push(`
        <div class="meta-badge-item">
          <span>🇪🇺 5 Open-Source Quellen aktiv</span>
        </div>
      `);

      DOM.weatherMetaBadgesRail.innerHTML = badges.join('');
    }

    // 3. Status der 5 Quellen in der Leiste aktualisieren
    if (DOM.weatherSourcesStatus && currentSourcesStatus) {
      const chips = [
        { key: 'openMeteo', icon: '☀️', name: 'Open-Meteo' },
        { key: 'brightSky', icon: '📡', name: 'Bright Sky' },
        { key: 'dwdAlerts', icon: '⚠️', name: 'DWD Warnungen' },
        { key: 'geoSphere', icon: '🏔️', name: 'GeoSphere' },
        { key: 'metNorway', icon: '🇳🇴', name: 'MET Norway' }
      ];

      DOM.weatherSourcesStatus.innerHTML = chips.map(c => {
        const isOk = currentSourcesStatus[c.key]?.ok !== false;
        return `<span class="source-chip ${isOk ? 'active' : ''}">${c.icon} ${c.name}</span>`;
      }).join('');
    }
  }

  function bindDayCardClickEvents() {
    document.querySelectorAll('.day-forecast-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.getAttribute('data-dayindex'), 10);
        openHourlyWeatherModal(idx);
      });
    });
  }

  function renderSolarAdaptiveCard() {
    if (!DOM.solarAdaptiveCard || typeof WeatherService === 'undefined' || !WeatherService.getAdaptiveSolarData) return;

    const adaptiveData = WeatherService.getAdaptiveSolarData();
    const mode = adaptiveData.mode || 'calibrated';
    const isCalibrated = (mode !== 'raw');

    // 1. Modus Picker Buttons synchronisieren
    if (DOM.adaptiveModePicker) {
      const segBtns = DOM.adaptiveModePicker.querySelectorAll('.picker-seg');
      segBtns.forEach(btn => {
        const btnMode = btn.getAttribute('data-mode');
        btn.classList.toggle('active', btnMode === mode);
      });
    }

    // 2. Treffergenauigkeits-Badge
    if (DOM.adaptiveAccuracyBadge) {
      if (isCalibrated) {
        DOM.adaptiveAccuracyBadge.textContent = `🎯 ${adaptiveData.overallAccuracyPct || 94.6}% Treffer`;
        DOM.adaptiveAccuracyBadge.className = 'adaptive-precision-pill';
      } else {
        DOM.adaptiveAccuracyBadge.textContent = `Modell-Basis`;
        DOM.adaptiveAccuracyBadge.className = 'adaptive-precision-pill raw-mode';
      }
    }

    // 3. Allgäu Inversion / Mikroklima Box
    if (DOM.adaptiveInversionBox) {
      if (isCalibrated) {
        if (DOM.adaptiveInversionBadge) {
          DOM.adaptiveInversionBadge.textContent = adaptiveData.inversionDetected ? '🌫️ Hochnebel-Filter aktiv (Illertal)' : '☀️ Freie Strahlung aktiv';
        }
        if (DOM.adaptiveInversionSub) {
          DOM.adaptiveInversionSub.textContent = `Dämpfung Vormittag: -${adaptiveData.morningDampeningHours || 1.4}h`;
        }
        if (DOM.adaptiveInversionText) {
          const optWin = (weatherForecast14Days && weatherForecast14Days[0]?.calibratedPvWindow?.label) || '12:15 – 15:45 Uhr';
          DOM.adaptiveInversionText.innerHTML = `Lokale Allgäu-Kalibrierung dämpft morgendliche Inversions-Übertreibungen der Wettermodelle ab. Voller PV-Ertrag fokussiert auf <strong>${escapeHtml(optWin)}</strong>.`;
        }
      } else {
        if (DOM.adaptiveInversionBadge) {
          DOM.adaptiveInversionBadge.textContent = '📊 Unkorrigierte Roh-Wettermodelle';
        }
        if (DOM.adaptiveInversionSub) {
          DOM.adaptiveInversionSub.textContent = 'Standard ICON / ECMWF';
        }
        if (DOM.adaptiveInversionText) {
          DOM.adaptiveInversionText.innerHTML = `Zeigt Roh-Wettermodelle ohne lokale Mikroklima-Korrektur. Hinweis: Morgendliche Tal-Inversionen werden in Standardmodellen häufig überschätzt.`;
        }
      }
    }

    // 4. Historischer Ground-Truth Abgleich (Gestern, Vorgestern, etc.)
    if (DOM.adaptiveComparisonList) {
      const pastList = adaptiveData.pastComparisons || [];
      if (pastList.length === 0) {
        DOM.adaptiveComparisonList.innerHTML = `<div style="font-size:0.70rem; color:var(--text-muted); text-align:center; padding:8px;">Noch keine historischen Abgleichdaten vorhanden.</div>`;
      } else {
        DOM.adaptiveComparisonList.innerHTML = pastList.map(item => {
          const deltaVal = Number(item.deltaHours) || 0;
          const deltaSign = deltaVal > 0 ? `+${deltaVal.toFixed(1)}h` : (deltaVal === 0 ? `±0.0h` : `${deltaVal.toFixed(1)}h`);
          const statusClass = item.status === 'exact' ? 'exact' : (item.status === 'fog' ? 'fog' : 'slight');
          const realH = Number(item.actualSunHours).toFixed(1);
          const progH = Number(item.predictedSunHours).toFixed(1);
          return `
            <div class="adaptive-comp-row">
              <div class="comp-col-left">
                <span class="comp-day-name">${escapeHtml(item.dayLabel)}</span>
                <span class="comp-note-badge">${escapeHtml(item.note)}</span>
              </div>
              <div class="comp-col-right">
                <span class="comp-hours-display">Real: <span>${realH}h</span> / Prog: ${progH}h</span>
                <span class="comp-delta-badge ${statusClass}">${deltaSign}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 5. Footer Last Trained Info
    if (DOM.adaptiveLastTrainedText) {
      DOM.adaptiveLastTrainedText.textContent = `DWD ICON-D2 Leitmodell (58% Gewicht)`;
    }
  }

  function updateDashboardPvDecisionWidget() {
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;
    const today = weatherForecast14Days[0];

    const todayIconHtml = (today.icon && today.icon.includes('🌫'))
      ? `<span class="fog-rounded-icon" title="Nebel">🌫️</span>`
      : (today.icon || '☀️');
    DOM.dashPvIconCircle.innerHTML = todayIconHtml;
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
  // FEATURE 4a: TEMPERATURABHÄNGIGE WINTER-REICHWEITEN SIMULATION
  // =========================================================================
  function updateDashboardWinterRangeSimulation() {
    if (!DOM.dashRangePrimary) return;

    const v = (appData && appData.vehicle) || {};
    const batteryCapacity = Number(v.batteryKwh) || 52.0;

    // 1. Reeller Durchschnittsverbrauch aus allen Ladungen & Kilometern
    const consData = calcConsumption(appData.sessions);
    const baseConsumption = (consData && consData.hasData && consData.avgCons > 0)
      ? consData.avgCons
      : 14.2;

    // 2. Kälteeinfluss aus Wettervorhersage
    let currentTemp = 12;
    if (weatherForecast14Days && weatherForecast14Days.length > 0) {
      const today = weatherForecast14Days[0];
      currentTemp = Math.round((today.tMax + today.tMin) / 2);
    }

    const nmcFactor = getNmcTemperatureEfficiency(currentTemp);
    const lossPct = Math.max(0, Math.round((1 - nmcFactor) * 100));

    // 3. Intelligenter Akkustand (SoC) anhand aller Ladungen und gefahrenen Kilometer
    let intelligentSoc = null;

    if (appData && appData.sessions && appData.sessions.length > 0) {
      const sorted = [...appData.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
      const latestWithSoc = sorted.find(s => s.soc !== undefined && s.soc !== null && !isNaN(s.soc));
      if (latestWithSoc) {
        const lastSoc = Number(latestWithSoc.soc);
        const lastOdo = Number(latestWithSoc.odometer || 0);
        const curOdo = Math.max(Number(v.currentOdo || 0), lastOdo);
        if (curOdo > lastOdo && lastOdo > 0) {
          const deltaKm = curOdo - lastOdo;
          const consumedKwh = (deltaKm * baseConsumption) / 100;
          const deltaSoc = (consumedKwh / batteryCapacity) * 100;
          intelligentSoc = Math.max(0, Math.min(100, Math.round(lastSoc - deltaSoc)));
        } else {
          intelligentSoc = Math.max(0, Math.min(100, Math.round(lastSoc)));
        }
      } else {
        const latestWithStart = sorted.find(s => s.socStart !== undefined && s.socStart !== null && !isNaN(s.socStart));
        if (latestWithStart) {
          intelligentSoc = Math.max(0, Math.min(100, Math.round(Number(latestWithStart.socStart))));
        }
      }
    }

    // Fallback: Keine Ladungen erfasst -> Auslieferungszustand (72% bei 9 km) bzw. v.currentSoc
    if (intelligentSoc === null) {
      if (v.currentSoc !== null && v.currentSoc !== undefined && !isNaN(Number(v.currentSoc))) {
        intelligentSoc = Math.max(0, Math.min(100, Math.round(Number(v.currentSoc))));
      } else {
        const curOdo = Number(v.currentOdo || VEHICLE_START_ODO);
        if (curOdo > VEHICLE_START_ODO) {
          const deltaKm = curOdo - VEHICLE_START_ODO;
          const consumedKwh = (deltaKm * baseConsumption) / 100;
          const deltaSoc = (consumedKwh / batteryCapacity) * 100;
          intelligentSoc = Math.max(0, Math.min(100, Math.round(VEHICLE_START_SOC - deltaSoc)));
        } else {
          intelligentSoc = VEHICLE_START_SOC;
        }
      }
    }

    if (intelligentSoc !== null) {
      v.currentSoc = intelligentSoc;
      if (DOM.dashRangeSocVal) {
        DOM.dashRangeSocVal.innerHTML = `${Math.round(intelligentSoc)}<small>%</small>`;
      }
      if (DOM.dashRangeIcon) {
        DOM.dashRangeIcon.textContent = intelligentSoc < 20 ? '🪫' : '🔋';
      }

      const remEnergyKwh = (batteryCapacity * intelligentSoc) / 100;
      const normRange = Math.round((remEnergyKwh / baseConsumption) * 100);
      const effectiveConsumption = baseConsumption / nmcFactor;
      const realWinterRange = Math.round((remEnergyKwh / effectiveConsumption) * 100);

      DOM.dashRangePrimary.innerHTML = `${realWinterRange} <small>km</small>`;

      if (currentTemp < 15) {
        if (DOM.dashRangeTempIcon) DOM.dashRangeTempIcon.textContent = '❄️';
        if (DOM.dashRangeTempText) DOM.dashRangeTempText.textContent = `Winter (${currentTemp}°C): ~${realWinterRange} km`;
        if (DOM.dashRangeTempLoss) DOM.dashRangeTempLoss.textContent = `-${lossPct}% Kälteeinfluss (Norm: ~${normRange} km)`;
        if (DOM.dashRangeTempBadge) DOM.dashRangeTempBadge.className = 'range-temp-badge';
      } else {
        if (DOM.dashRangeTempIcon) DOM.dashRangeTempIcon.textContent = '☀️';
        if (DOM.dashRangeTempText) DOM.dashRangeTempText.textContent = `Mild (${currentTemp}°C): ~${realWinterRange} km`;
        if (DOM.dashRangeTempLoss) DOM.dashRangeTempLoss.textContent = `Optimal (Norm: ~${normRange} km)`;
        if (DOM.dashRangeTempBadge) DOM.dashRangeTempBadge.className = 'range-temp-badge optimal';
      }
    } else {
      if (DOM.dashRangeSocVal) DOM.dashRangeSocVal.innerHTML = `--<small>%</small>`;
      DOM.dashRangePrimary.innerHTML = `-- <small>km</small>`;
      if (DOM.dashRangeTempIcon) DOM.dashRangeTempIcon.textContent = '🔋';
      if (DOM.dashRangeTempText) DOM.dashRangeTempText.textContent = `Akkustand fehlt`;
      if (DOM.dashRangeTempLoss) DOM.dashRangeTempLoss.textContent = `Tippen zum Eintragen`;
      if (DOM.dashRangeTempBadge) DOM.dashRangeTempBadge.className = 'range-temp-badge';
    }
  }

  // =========================================================================
  // FEATURE 8a: GPS GEOFENCING (< 10 METER) BERECHNUNG & AUTO-SELECTION
  // =========================================================================
  function getGpsDistanceMeters(lat1, lon1, lat2, lon2) {
    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined ||
        lat1 === null || lon1 === null || lat2 === null || lon2 === null ||
        isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
      return Infinity;
    }
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function autoDetectLocationByGps(maxMeters = 10.0, overrideLat = null, overrideLon = null, isUserGesture = false) {
    const ind = document.getElementById('locGeofenceIndicator');
    if (ind) ind.style.display = 'none';

    const processCoords = (uLat, uLon, showToastFeedback = false) => {
      const locs = (appData && appData.settings && appData.settings.locations) || DEFAULT_LOCATIONS;
      let closestLoc = null;
      let minDistance = Infinity;

      locs.forEach(loc => {
        if (loc.isVariable || loc.lat === undefined || loc.lat === null || loc.lon === undefined || loc.lon === null) return;
        const d = getGpsDistanceMeters(uLat, uLon, Number(loc.lat), Number(loc.lon));
        if (d < minDistance) {
          minDistance = d;
          closestLoc = loc;
        }
      });

      // Strikte < 10 Meter Prüfung (da Orte wie Bayrhofs & Arbeit nah beieinander liegen)
      if (closestLoc && minDistance < maxMeters) {
        selectLocationForEntry(closestLoc.id, true);
        if (ind) {
          ind.textContent = `📍 ${closestLoc.name} (<10m / ${minDistance.toFixed(1)}m)`;
          ind.style.display = 'inline-flex';
        }
        if (DOM.pickerSelectedSub) {
          const origText = DOM.pickerSelectedSub.textContent || '';
          if (!origText.includes('📍')) {
            DOM.pickerSelectedSub.textContent = `${origText} • 📍 Auto (<10m)`;
          }
        }
        triggerHaptic();
        if (showToastFeedback && isUserGesture) {
          showToast(`📍 Ladeort "${closestLoc.name}" automatisch erkannt (<10m)`);
        }
        return { loc: closestLoc, distance: minDistance };
      } else if (closestLoc) {
        console.log(`[Geofence] Nächster Ladeort "${closestLoc.name}" ist ${minDistance.toFixed(1)}m entfernt (Schwellenwert < ${maxMeters}m). Kein Auto-Switch.`);
        return null;
      }
      return null;
    };

    if (overrideLat !== null && overrideLon !== null) {
      return processCoords(overrideLat, overrideLon, false);
    }

    // 1. Smart GPS Cache zuerst prüfen: schnell, präzise & OHNE störendes Permission-Popup!
    const cached = typeof getSmartGpsCache === 'function' ? getSmartGpsCache() : null;
    let cacheMatch = null;
    if (cached && typeof cached.lat === 'number' && typeof cached.lon === 'number') {
      cacheMatch = processCoords(cached.lat, cached.lon, false);
    }

    // 2. Nur wenn Permission bereits dauerhaft gewährt ist oder explizite Benutzeraktion: live GPS im Hintergrund abfragen
    if (!navigator.geolocation) return cacheMatch;

    if (typeof checkGeolocationPermission === 'function') {
      checkGeolocationPermission().then((perm) => {
        if (perm === 'granted' || isUserGesture) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const uLat = Number(pos.coords.latitude.toFixed(6));
              const uLon = Number(pos.coords.longitude.toFixed(6));
              if (typeof setSmartGpsCache === 'function') {
                setSmartGpsCache({ lat: uLat, lon: uLon, accuracy: Math.round(pos.coords.accuracy || 0) });
              }
              processCoords(uLat, uLon, isUserGesture);
            },
            (err) => {
              console.warn('[Geofence] GPS nicht verfügbar oder abgelehnt:', err.message);
            },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
          );
        }
      }).catch(() => {});
    }

    return cacheMatch;
  }

  // =========================================================================
  // MODAL: STÜNDLICHER WETTERVERLAUF EINES TAGES & GESTENSTEUERUNG
  // =========================================================================
  let currentHourlyDayIndex = 0;

  function navigateHourlyDay(direction) {
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;
    const targetIdx = currentHourlyDayIndex + direction;
    if (targetIdx < 0 || targetIdx >= weatherForecast14Days.length) return;
    openHourlyWeatherModal(targetIdx, direction);
  }

  function openHourlyWeatherModal(dayIndex, animDirection = 0) {
    if (!weatherForecast14Days || weatherForecast14Days.length === 0) return;

    if (dayIndex < 0) dayIndex = 0;
    if (dayIndex >= weatherForecast14Days.length) dayIndex = weatherForecast14Days.length - 1;

    currentHourlyDayIndex = dayIndex;
    const day = weatherForecast14Days[dayIndex];
    if (!day) return;

    // Sanfte Slide-Animation bei Tag-Wechsel
    if (DOM.hourlyContentWrap) {
      DOM.hourlyContentWrap.style.transform = '';
      DOM.hourlyContentWrap.style.transition = '';
      DOM.hourlyContentWrap.style.opacity = '';
      DOM.hourlyContentWrap.classList.remove('slide-enter-right', 'slide-enter-left');

      if (animDirection > 0) {
        void DOM.hourlyContentWrap.offsetWidth; // Force Reflow
        DOM.hourlyContentWrap.classList.add('slide-enter-right');
      } else if (animDirection < 0) {
        void DOM.hourlyContentWrap.offsetWidth; // Force Reflow
        DOM.hourlyContentWrap.classList.add('slide-enter-left');
      }

      if (animDirection !== 0) {
        setTimeout(() => {
          if (DOM.hourlyContentWrap) {
            DOM.hourlyContentWrap.classList.remove('slide-enter-right', 'slide-enter-left');
          }
        }, 260);
      }
    }

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isToday = (dayIndex === 0) || (day.dateStr === todayStr);

    const curHours = String(now.getHours()).padStart(2, '0');
    const curMins = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = isToday ? `${curHours}:${curMins}` : null;

    // Nur der relevante Tageszeitraum: 06:00 bis 22:00 Uhr (vom Nutzer gewünscht)
    const displayHours = (day.hourlyData || []).filter(h => h.hour >= 6 && h.hour <= 22);

    DOM.hourlyModalTitle.textContent = `${day.dayName}, ${day.dateDisplay}`;
    DOM.hourlyModalSub.textContent = isToday
      ? `Heute • ${day.conditionText || 'Prognose'} • Aktuell: ${currentTimeStr} Uhr`
      : `${day.conditionText || 'Prognose'} • Verlauf von 06:00 bis 22:00 Uhr`;

    // Status der Vor-/Zurück-Pfeile und Tages-Badge aktualisieren
    const canGoPrev = (dayIndex > 0);
    const canGoNext = (weatherForecast14Days && dayIndex < weatherForecast14Days.length - 1);

    if (DOM.btnPrevHourlyDay) {
      DOM.btnPrevHourlyDay.disabled = !canGoPrev;
      DOM.btnPrevHourlyDay.style.display = canGoPrev ? 'inline-flex' : 'none';
    }
    if (DOM.btnNextHourlyDay) {
      DOM.btnNextHourlyDay.disabled = !canGoNext;
      DOM.btnNextHourlyDay.style.display = canGoNext ? 'inline-flex' : 'none';
    }
    if (DOM.hourlyDayBadge) {
      if (dayIndex === 0) {
        DOM.hourlyDayBadge.textContent = `Heute • 1/${weatherForecast14Days.length}`;
      } else if (dayIndex === 1) {
        DOM.hourlyDayBadge.textContent = `Morgen • 2/${weatherForecast14Days.length}`;
      } else {
        DOM.hourlyDayBadge.textContent = `Tag ${dayIndex + 1}/${weatherForecast14Days.length}`;
      }
    }

    DOM.hourlyTotalSun.textContent = `${day.sunshineHours} h`;
    DOM.hourlyTotalRain.textContent = `${day.rainMm} l/m²`;
    DOM.hourlyTempRange.textContent = `${day.tMax}° / ${day.tMin}°`;
    if (DOM.hourlySunrise) DOM.hourlySunrise.textContent = day.sunrise || '--:--';
    if (DOM.hourlySunset) DOM.hourlySunset.textContent = day.sunset || '--:--';

    if (DOM.hourlyChartLegendBox) {
      const isCalibratedMode = (typeof WeatherService !== 'undefined' && WeatherService.getAdaptiveSolarData) 
        ? (WeatherService.getAdaptiveSolarData().mode !== 'raw') 
        : true;

      DOM.hourlyChartLegendBox.innerHTML = `
        <span class="subtle-leg-item">
          <span class="legend-indicator dot-bronze" style="width: 14px; height: 3px; border-radius: 2px;"></span>
          <span>${isCalibratedMode ? '✨ KI-Kalibriert' : 'Sonne (Min.)'}</span>
        </span>
        ${isCalibratedMode ? `
        <span class="subtle-leg-item">
          <span class="legend-indicator dot-dashed-raw" style="width: 14px; height: 2px; border-radius: 1px; border-top: 2px dashed #94a3b8; display: inline-block;"></span>
          <span>📊 Roh-Modell</span>
        </span>
        ` : ''}
        <span class="subtle-leg-item">
          <span class="legend-indicator dot-cyan" style="width: 7px; height: 7px; border-radius: 2px;"></span>
          <span>💧 Niederschlag</span>
        </span>
        ${isToday ? `
        <span class="subtle-leg-item">
          <span class="legend-indicator dot-now" style="width: 10px; height: 3px; border-radius: 2px; background: #00e5ff; box-shadow: 0 0 6px #00e5ff;"></span>
          <span style="color: #00e5ff; font-weight: 700;">Jetzt (${currentTimeStr})</span>
        </span>
        ` : ''}
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

    // Stündlichen Chart.js Graph zeichnen mit dynamischer Sonnenaufgang/untergang Markerlinie & aktueller Uhrzeit
    renderHourlyWeatherChart(displayHours, day.sunrise, day.sunset, currentTimeStr);

    // Stündliche Kapseln rendern (6:00 - 22:00 Uhr)
    const sunriseHour = day.sunrise ? parseInt(day.sunrise.split(':')[0], 10) : -1;
    const sunsetHour = day.sunset ? parseInt(day.sunset.split(':')[0], 10) : -1;
    const curHourNum = isToday ? now.getHours() : -1;

    DOM.hourlyHoursScroll.innerHTML = displayHours.map(h => {
      const isRise = (h.hour === sunriseHour);
      const isSet = (h.hour === sunsetHour);
      const isCurrentHour = (h.hour === curHourNum);

      let sunEventBadge = '';
      if (isCurrentHour) sunEventBadge = `<span class="hh-now-tag">📍 JETZT</span>`;
      else if (isRise) sunEventBadge = `<span style="font-size:0.58rem; color:#f59e0b; font-weight:800;">🌅 ${day.sunrise}</span>`;
      else if (isSet) sunEventBadge = `<span style="font-size:0.58rem; color:#f97316; font-weight:800;">🌇 ${day.sunset}</span>`;

      const rawHIcon = h.icon || '☀️';
      const hIconHtml = (rawHIcon && rawHIcon.includes('🌫'))
        ? `<span class="fog-rounded-icon" title="Nebel">🌫️</span>`
        : rawHIcon;

      return `
        <div class="hourly-hour-card ${isCurrentHour ? 'is-current-hour' : ''} ${isRise || isSet ? 'sun-event-hour' : ''}" data-hour="${h.hour}">
          <span class="hh-time">${h.time}</span>
          ${sunEventBadge}
          <span class="hh-icon">${hIconHtml}</span>
          <span class="hh-temp">${h.temp}°</span>
          <span class="hh-solar">☀️ ${(h.sunHours * 60).toFixed(0)}m</span>
          ${h.ghi && h.ghi > 0 ? `<span class="hh-ghi-val" style="font-size:0.56rem; color:#f59e0b; font-weight:700;">⚡️ ${h.ghi}W</span>` : ''}
          <span class="hh-rain">${h.rain > 0 ? `💧 ${h.rain}l${h.rainProb ? ` (${h.rainProb}%)` : ''}` : (h.rainProb > 20 ? `<span style="font-size:0.56rem; color:#38bdf8;">☔️ ${h.rainProb}%</span>` : '-')}</span>
        </div>
      `;
    }).join('');

    if (isToday) {
      setTimeout(() => {
        const curEl = DOM.hourlyHoursScroll?.querySelector('.is-current-hour');
        if (curEl) {
          curEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }, 120);
    } else {
      if (DOM.hourlyHoursScroll) {
        DOM.hourlyHoursScroll.scrollLeft = 0;
      }
    }

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
    if (DOM.hourlyContentWrap) {
      DOM.hourlyContentWrap.style.transform = '';
      DOM.hourlyContentWrap.style.transition = '';
      DOM.hourlyContentWrap.style.opacity = '';
      DOM.hourlyContentWrap.classList.remove('slide-enter-right', 'slide-enter-left');
    }
  }


  function renderHourlyWeatherChart(hours, sunriseTime, sunsetTime, currentTimeStr) {
    if (!DOM.canvasHourlyChart || typeof Chart === 'undefined') return;
    if (chartHourly) { chartHourly.destroy(); chartHourly = null; }

    const adaptiveData = (typeof WeatherService !== 'undefined' && WeatherService.getAdaptiveSolarData) 
      ? WeatherService.getAdaptiveSolarData() 
      : { mode: 'calibrated' };
    const isCalibratedMode = (adaptiveData.mode !== 'raw');

    const labels = hours.map(h => h.time);
    const calSunData = hours.map(h => Number(((h.calibratedSunHours !== undefined ? h.calibratedSunHours : h.sunHours) * 60).toFixed(0)));
    const rawSunData = hours.map(h => Number(((h.rawSunHours !== undefined ? h.rawSunHours : h.sunHours) * 60).toFixed(0)));
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

        const startHour = (hours.length > 0 && hours[0].hour !== undefined) ? hours[0].hour : 6;
        const endHour = (hours.length > 0 && hours[hours.length - 1].hour !== undefined) ? hours[hours.length - 1].hour : 22;

        const parseTimeToX = (timeStr) => {
          if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
          const parts = timeStr.split(':');
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          if (isNaN(h) || isNaN(m)) return null;

          const fracHours = h + (m / 60);
          if (fracHours < startHour) return left + 2;
          if (fracHours > endHour) return right - 2;

          const frac = fracHours - startHour;
          const fIdx = Math.floor(frac);
          const cIdx = Math.min(hours.length - 1, Math.ceil(frac));
          const pFloor = x.getPixelForValue(fIdx);
          const pCeil = x.getPixelForValue(cIdx);
          return pFloor + (pCeil - pFloor) * (frac - fIdx);
        };

        const xSunrise = parseTimeToX(sunriseTime);
        const xSunset = parseTimeToX(sunsetTime);
        const xCurrent = parseTimeToX(currentTimeStr);

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

        const drawCurrentTimeMarker = (xPos, timeStr) => {
          if (xPos === null || isNaN(xPos) || xPos < left || xPos > right) return;

          c.save();

          // 1. Neon Glow Schein
          c.shadowColor = 'rgba(0, 229, 255, 0.75)';
          c.shadowBlur = 8;

          // 2. Vertikale cyan Linie
          c.beginPath();
          c.setLineDash([4, 2]);
          c.lineWidth = 2.0;
          c.strokeStyle = '#00e5ff';
          c.moveTo(xPos, top + 18);
          c.lineTo(xPos, bottom);
          c.stroke();

          // 3. Leuchtender Punkt mit Halo am Fuße
          c.beginPath();
          c.setLineDash([]);
          c.arc(xPos, bottom - 1, 6, 0, Math.PI * 2);
          c.fillStyle = 'rgba(0, 229, 255, 0.35)';
          c.fill();

          c.beginPath();
          c.arc(xPos, bottom - 1, 3.5, 0, Math.PI * 2);
          c.fillStyle = '#00e5ff';
          c.fill();

          // 4. Oberer Pill-Badge: "📍 JETZT 10:14"
          c.shadowBlur = 0;
          c.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          const text = `📍 JETZT ${timeStr}`;
          const textWidth = c.measureText(text).width;
          const badgeW = textWidth + 10;
          const badgeH = 17;
          const badgeX = Math.max(left + 2, Math.min(right - badgeW - 2, xPos - (badgeW / 2)));
          const badgeY = top + 1;

          c.beginPath();
          const r = 4.5;
          if (c.roundRect) {
            c.roundRect(badgeX, badgeY, badgeW, badgeH, r);
          } else {
            c.rect(badgeX, badgeY, badgeW, badgeH);
          }
          c.fillStyle = 'rgba(6, 18, 30, 0.96)';
          c.fill();
          c.lineWidth = 1.4;
          c.strokeStyle = '#00e5ff';
          c.stroke();

          c.fillStyle = '#ffffff';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, badgeX + (badgeW / 2), badgeY + (badgeH / 2) + 0.5);

          c.restore();
        };

        if (sunriseTime) drawMarker(xSunrise, `🌅 ${sunriseTime}`, '#f59e0b');
        if (sunsetTime) drawMarker(xSunset, `🌇 ${sunsetTime}`, '#f97316');
        if (currentTimeStr) drawCurrentTimeMarker(xCurrent, currentTimeStr);
      }
    };

    const datasets = [];
    if (isCalibratedMode) {
      // 1. KI-Kalibriert (Allgäu)
      datasets.push({
        type: 'line',
        label: '✨ KI-Kalibriert (Min.)',
        data: calSunData,
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
      });

      // 2. Roh-Modelle (Gestrichelt)
      datasets.push({
        type: 'line',
        label: '📊 Roh-Modell (Min.)',
        data: rawSunData,
        borderColor: 'rgba(148, 163, 184, 0.85)',
        borderWidth: 1.8,
        borderDash: [4, 4],
        pointRadius: 0,
        pointHoverRadius: 4.5,
        pointHoverBackgroundColor: '#94a3b8',
        pointHoverBorderColor: '#ffffff',
        tension: 0.38,
        fill: false,
        yAxisID: 'ySun',
        order: 2
      });
    } else {
      datasets.push({
        type: 'line',
        label: '📊 Roh-Modell (Min.)',
        data: rawSunData,
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
      });
    }

    datasets.push({
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
      order: 3
    });

    chartHourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets
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
                const hIdx = c.dataIndex;
                const h = hours[hIdx] || {};
                if (c.dataset.label && c.dataset.label.includes('KI-Kalibriert')) {
                  const kwStr = (h.calibratedPvKw !== undefined) ? ` (~${h.calibratedPvKw} kW PV)` : (h.pvKw !== undefined ? ` (~${h.pvKw} kW PV)` : '');
                  return ` ✨ KI-Kalibriert: ${c.parsed.y} Min${kwStr}`;
                }
                if (c.dataset.label && c.dataset.label.includes('Roh-Modell')) {
                  const rawKw = (h.rawPvKw !== undefined) ? ` (~${h.rawPvKw} kW PV)` : '';
                  return ` 📊 Roh-Modell: ${c.parsed.y} Min${rawKw}`;
                }
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
            ${loc.address ? `<span class="loc-address-sub">📍 ${escapeHtml(loc.address)}</span>` : ''}
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
          renderWeatherLocationFilterRail();
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
          renderWeatherLocationFilterRail();
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
    if (activeWeatherLocationId === id) {
      activeWeatherLocationId = 'gps';
      if (appData.settings) appData.settings.activeWeatherLocationId = 'gps';
    }
    saveData();
    renderLocationsManageList();
    renderLocationFilterRail();
    renderWeatherLocationFilterRail();
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
        if (DOM.locEditAddress) DOM.locEditAddress.value = loc.address || '';
        if (DOM.locEditLat) DOM.locEditLat.value = (loc.lat !== undefined && loc.lat !== null) ? loc.lat : '';
        if (DOM.locEditLon) DOM.locEditLon.value = (loc.lon !== undefined && loc.lon !== null) ? loc.lon : '';
        if (DOM.locEditGpsStatus) {
          DOM.locEditGpsStatus.textContent = (loc.lat && loc.lon)
            ? `📍 ${Number(loc.lat).toFixed(4)}, ${Number(loc.lon).toFixed(4)}`
            : 'Keine Koordinaten gespeichert';
        }
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
      if (DOM.locEditAddress) DOM.locEditAddress.value = '';
      if (DOM.locEditLat) DOM.locEditLat.value = '';
      if (DOM.locEditLon) DOM.locEditLon.value = '';
      if (DOM.locEditGpsStatus) DOM.locEditGpsStatus.textContent = '';
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
    const address = DOM.locEditAddress ? DOM.locEditAddress.value.trim() : '';
    const icon = DOM.locEditIcon.value || '🏢';
    const powerType = DOM.locEditPowerType.value || 'pv';
    const price = parseFloat(DOM.locEditPrice.value) || 0.15;

    if (!name) return;

    let lat = null;
    let lon = null;
    let isVariable = false;

    // Koordinaten ableiten
    const nLower = name.toLowerCase();
    const aLower = address.toLowerCase();
    if (nLower.includes('bayrhof') || aLower.includes('unterwang')) {
      lat = 47.7468;
      lon = 10.3094;
    } else if (nLower.includes('zuhause') || aLower.includes('rubihornweg') || aLower.includes('durach')) {
      lat = 47.6971;
      lon = 10.3542;
    } else if (nLower.includes('arbeit') || aLower.includes('dachser') || aLower.includes('thomas-dachser')) {
      lat = 47.7476;
      lon = 10.3038;
    } else if (nLower.includes('öffentlich') || nLower.includes('variabel')) {
      isVariable = true;
    }

    if (id) {
      const idx = appData.settings.locations.findIndex(l => l.id === id);
      if (idx !== -1) {
        const old = appData.settings.locations[idx];
        const finalLat = (DOM.locEditLat && DOM.locEditLat.value) ? parseFloat(DOM.locEditLat.value) : (lat !== null ? lat : (old.lat || null));
        const finalLon = (DOM.locEditLon && DOM.locEditLon.value) ? parseFloat(DOM.locEditLon.value) : (lon !== null ? lon : (old.lon || null));
        appData.settings.locations[idx] = {
          ...old,
          id,
          name,
          icon,
          powerType,
          kwhPrice: price,
          address: address || old.address || '',
          lat: finalLat,
          lon: finalLon,
          isVariable: isVariable || old.isVariable || false
        };
      }
    } else {
      const finalLat = (DOM.locEditLat && DOM.locEditLat.value) ? parseFloat(DOM.locEditLat.value) : lat;
      const finalLon = (DOM.locEditLon && DOM.locEditLon.value) ? parseFloat(DOM.locEditLon.value) : lon;
      appData.settings.locations.push({
        id: `loc_${Date.now()}`,
        name,
        icon,
        powerType,
        kwhPrice: price,
        address,
        lat: finalLat,
        lon: finalLon,
        isVariable
      });
    }

    saveData();
    closeLocationEditorModal();
    renderLocationsManageList();
    renderLocationFilterRail();
    renderWeatherLocationFilterRail();
    updateSmartChargingRecommendation();
    const curLocId = (DOM.entryLocationId && DOM.entryLocationId.value) || (appData.settings.locations[0] && appData.settings.locations[0].id);
    if (curLocId) {
      selectLocationForEntry(curLocId, !DOM.entryEditId || !DOM.entryEditId.value);
    }
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

  function updateModalPaymentStatus(locName, isPaidInitial = null) {
    if (!DOM.entryPaymentStatusRow) return;
    const isBayrhof = isBayrhofsLocation(locName);

    if (isBayrhof) {
      if (DOM.entryPaymentHint) DOM.entryPaymentHint.textContent = 'Sammelabrechnung (Bayrhofs)';
      if (DOM.entryPaymentPaidCheckbox) {
        DOM.entryPaymentPaidCheckbox.disabled = false;
        if (isPaidInitial !== null) {
          DOM.entryPaymentPaidCheckbox.checked = Boolean(isPaidInitial);
        }
      }
      if (DOM.entryPaymentOptionLabel) DOM.entryPaymentOptionLabel.classList.remove('disabled');
      updateModalPaymentLabel();
    } else {
      // Wichtig: Nur bei Bayrhofs Laden wird über eine spätere Summenabrechnung gemacht. Alles andere wird immer direkt bezahlt!
      if (DOM.entryPaymentHint) DOM.entryPaymentHint.textContent = 'Direktzahlung';
      if (DOM.entryPaymentPaidCheckbox) {
        DOM.entryPaymentPaidCheckbox.disabled = true;
        DOM.entryPaymentPaidCheckbox.checked = true;
      }
      if (DOM.entryPaymentOptionLabel) DOM.entryPaymentOptionLabel.classList.add('disabled');
      if (DOM.entryPaymentStatusText) DOM.entryPaymentStatusText.textContent = 'Immer direkt bezahlt ✓';
    }
  }

  function updateModalPaymentLabel() {
    if (!DOM.entryPaymentPaidCheckbox || !DOM.entryPaymentStatusText) return;
    const isChecked = DOM.entryPaymentPaidCheckbox.checked;
    DOM.entryPaymentStatusText.textContent = isChecked
      ? 'Bereits über Sammelabrechnung bezahlt ✓'
      : 'Noch offen (wird später abgerechnet)';
  }

  function selectLocationForEntry(locId, overridePrice = true) {
    const locs = (appData && appData.settings && appData.settings.locations) || DEFAULT_LOCATIONS;
    const loc = locs.find(l => l.id === locId) || locs[0] || DEFAULT_LOCATIONS[0];
    if (!loc) return;

    if (DOM.entryLocationId) DOM.entryLocationId.value = loc.id;
    if (DOM.pickerSelectedIcon) DOM.pickerSelectedIcon.textContent = loc.icon || '🏢';
    if (DOM.pickerSelectedTitle) DOM.pickerSelectedTitle.textContent = loc.name;
    if (DOM.pickerSelectedSub) {
      DOM.pickerSelectedSub.textContent = `${loc.powerType === 'pv' ? '☀️ PV-Strom' : '⚡️ Netzstrom'} • ${Number(loc.kwhPrice).toFixed(2).replace('.', ',')} €/kWh`;
    }

    if (overridePrice && DOM.entryPrice) {
      DOM.entryPrice.value = Number(loc.kwhPrice).toFixed(2);
    }
    updateModalPaymentStatus(loc.name);
    calculateModalCost();
  }

  // =========================================================================
  // MODAL BOTTOM SHEET: LADEVORGANG ERFASSEN
  // =========================================================================
  function openModalCharge(editId = null) {
    DOM.formChargeEntry.reset();
    DOM.entryEditId.value = '';
    resetOcrUploadCard();

    const latestOdo = getLatestOdometer();
    const defaultLoc = (appData.settings && appData.settings.locations && appData.settings.locations[0]) || DEFAULT_LOCATIONS[0];

    if (editId) {
      const cleanEditId = String(editId).trim();
      const s = appData.sessions.find(x => String(x.id).trim() === cleanEditId);
      if (s) {
        DOM.entryEditId.value = cleanEditId;
        DOM.modalChargeTitle.textContent = "Ladung bearbeiten";
        DOM.entryDateTime.value = formatDateTimeLocal(new Date(s.date));
        DOM.entryKwh.value = (s.kwh !== undefined && s.kwh !== null && s.kwh !== '') ? s.kwh : '';
        DOM.entryOdometer.value = (s.odometer !== undefined && s.odometer !== null && s.odometer !== '') ? s.odometer : '';
        DOM.entryPrice.value = (s.pricePerKwh !== undefined && s.pricePerKwh !== null && s.pricePerKwh !== '') ? Number(s.pricePerKwh).toFixed(2) : '';
        DOM.entryTotalCost.value = (s.totalCost !== undefined && s.totalCost !== null && s.totalCost !== '') ? Number(s.totalCost).toFixed(2) : '';
        DOM.entryNotes.value = s.notes || '';
        if (DOM.entryBatterySocStart) {
          DOM.entryBatterySocStart.value = (s.socStart !== undefined && s.socStart !== null) ? s.socStart : '';
        }
        if (DOM.entryBatterySoc) {
          DOM.entryBatterySoc.value = (s.soc !== undefined && s.soc !== null) ? s.soc : '';
        }

        const compInfo = getSessionCompleteness(s);
        if (DOM.modalIncompleteHint) {
          if (!compInfo.isComplete) {
            DOM.modalIncompleteHint.style.display = 'flex';
            if (DOM.modalIncompleteText) {
              DOM.modalIncompleteText.textContent = `⏳ Unvollständige Ladung – noch fehlend: ${compInfo.missing.join(', ')}`;
            }
          } else {
            DOM.modalIncompleteHint.style.display = 'none';
          }
        }

        const matchingLoc = (appData.settings.locations || []).find(l => l.name === s.location) || defaultLoc;
        selectLocationForEntry(matchingLoc.id, false);
        updateModalPaymentStatus(matchingLoc.name, s.paid);
      }
    } else {
      DOM.modalChargeTitle.textContent = "Ladevorgang erfassen";
      DOM.entryDateTime.value = formatDateTimeLocal(new Date());
      DOM.entryOdometer.value = '';
      if (DOM.entryOdometer) {
        DOM.entryOdometer.placeholder = latestOdo > 0 ? `z.B. ${latestOdo + 15}` : '0';
      }
      DOM.entryNotes.value = '';
      if (DOM.entryBatterySocStart) {
        DOM.entryBatterySocStart.value = '';
      }
      if (DOM.entryBatterySoc) {
        DOM.entryBatterySoc.value = '';
      }

      if (DOM.modalIncompleteHint) {
        DOM.modalIncompleteHint.style.display = 'none';
      }

      selectLocationForEntry(defaultLoc.id, true);
      updateModalPaymentStatus(defaultLoc.name, false);
      // Feature 8a: Geofence Check (< 10 Meter)
      autoDetectLocationByGps(10.0);
    }

    calculateModalOdoDelta();
    calculateModalCost();
    calculateModalSocDelta();

    DOM.modalAddCharge.classList.add('open');
    triggerHaptic();
  }

  function closeModalCharge() {
    DOM.modalAddCharge.classList.remove('open');
  }

  function calculateModalCost() {
    const kStr = (DOM.entryKwh && DOM.entryKwh.value) ? DOM.entryKwh.value.trim() : '';
    const pStr = (DOM.entryPrice && DOM.entryPrice.value) ? DOM.entryPrice.value.trim() : '';
    if (kStr === '' || pStr === '') return;
    const k = parseFloat(kStr);
    const p = parseFloat(pStr);
    if (!isNaN(k) && !isNaN(p) && k > 0) {
      DOM.entryTotalCost.value = (k * p).toFixed(2);
    }
  }

  function calculateModalOdoDelta() {
    const curOdo = parseInt(DOM.entryOdometer.value, 10);
    const editId = DOM.entryEditId.value;

    const cleanEditId = String(editId).trim();
    let base = VEHICLE_START_ODO;
    let baseSoc = VEHICLE_START_SOC;
    const sorted = [...appData.sessions].filter(s => String(s.id).trim() !== cleanEditId).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (sorted.length > 0 && sorted[0].odometer) {
      base = sorted[0].odometer;
      const sSoc = getSessionEndSoc(sorted[0]);
      if (sSoc !== null) baseSoc = sSoc;
    } else if (appData.vehicle && appData.vehicle.currentOdo > VEHICLE_START_ODO) {
      base = appData.vehicle.currentOdo;
      if (appData.vehicle.currentSoc !== null && appData.vehicle.currentSoc !== undefined) {
        baseSoc = Number(appData.vehicle.currentSoc);
      }
    }

    if (!isNaN(curOdo) && curOdo > base && base > 0) {
      const deltaKm = curOdo - base;
      let text = `+${deltaKm} km`;
      const startVal = DOM.entryBatterySocStart ? DOM.entryBatterySocStart.value.trim() : '';
      const startSoc = parseInt(startVal, 10);
      if (!isNaN(startSoc) && baseSoc !== null && baseSoc > startSoc) {
        const deltaSoc = baseSoc - startSoc;
        const batteryCap = (appData.vehicle && Number(appData.vehicle.batteryKwh)) || 52.0;
        const usedKwh = (deltaSoc / 100) * batteryCap;
        const tripCons = (usedKwh / deltaKm) * 100;
        text += ` (${tripCons.toFixed(1).replace('.', ',')} kWh/100)`;
      }
      DOM.entryDeltaKmTag.textContent = text;
    } else {
      DOM.entryDeltaKmTag.textContent = '+0 km';
    }
  }

  function calculateModalSocDelta() {
    if (!DOM.entryBatterySocStart || !DOM.entryBatterySoc) return;

    const startVal = DOM.entryBatterySocStart.value.trim();
    const endVal = DOM.entryBatterySoc.value.trim();
    const kwhVal = parseFloat(DOM.entryKwh ? DOM.entryKwh.value : 0) || 0;

    const startSoc = parseInt(startVal, 10);
    const endSoc = parseInt(endVal, 10);

    const hasStart = (!isNaN(startSoc) && startSoc >= 0 && startSoc <= 100);
    const hasEnd = (!isNaN(endSoc) && endSoc >= 0 && endSoc <= 100);

    if (hasStart && hasEnd && endSoc >= startSoc) {
      const delta = endSoc - startSoc;
      if (DOM.entryDeltaSocTag) {
        DOM.entryDeltaSocTag.style.display = 'inline-block';
        DOM.entryDeltaSocTag.textContent = `+${delta}%`;
      }

      if (DOM.entrySocEfficiencyPill && DOM.entrySocEfficiencyText) {
        const batteryCap = (appData.vehicle && appData.vehicle.batteryKwh) || 52.0;
        const netKwh = (delta / 100) * batteryCap;
        let effHtml = `Netto: <strong>+${netKwh.toFixed(1).replace('.', ',')} kWh</strong>`;

        if (kwhVal > 0) {
          const eff = Math.min(100, Math.round((netKwh / kwhVal) * 1000) / 10);
          const loss = Math.max(0, kwhVal - netKwh).toFixed(1).replace('.', ',');
          effHtml += ` • Wirkungsgrad: <strong>${eff.toFixed(1).replace('.', ',')}%</strong> <span style="opacity:0.75">(${loss} kWh Ladeverlust)</span>`;
        }

        DOM.entrySocEfficiencyText.innerHTML = effHtml;
        DOM.entrySocEfficiencyPill.style.display = 'flex';
      }
    } else {
      if (DOM.entryDeltaSocTag) {
        DOM.entryDeltaSocTag.style.display = 'none';
      }
      if (DOM.entrySocEfficiencyPill) {
        DOM.entrySocEfficiencyPill.style.display = 'none';
      }
    }
  }

  function getLatestOdometer() {
    if (appData.sessions.length > 0) {
      const withO = appData.sessions.filter(s => s.odometer > 0);
      if (withO.length > 0) return withO[0].odometer;
    }
    return (appData.vehicle && appData.vehicle.currentOdo > 0) ? appData.vehicle.currentOdo : VEHICLE_START_ODO;
  }

  // =========================================================================
  // CUPRA APP SCREENSHOT OCR SCANNER & AUTO-FILLER
  // =========================================================================
  function setOcrInfoVisible(show) {
    if (!DOM.ocrInfoBanner) return;
    const isVisible = show !== undefined ? Boolean(show) : (DOM.ocrInfoBanner.style.display !== 'none');
    DOM.ocrInfoBanner.style.display = isVisible ? 'block' : 'none';
    if (DOM.btnOcrInfo) {
      DOM.btnOcrInfo.classList.toggle('active', isVisible);
      DOM.btnOcrInfo.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
    }
  }

  function toggleOcrInfo() {
    if (!DOM.ocrInfoBanner) return;
    const isCurrentlyHidden = DOM.ocrInfoBanner.style.display === 'none' || !DOM.ocrInfoBanner.style.display;
    setOcrInfoVisible(isCurrentlyHidden);
    triggerHaptic();
  }

  function resetOcrUploadCard() {
    if (!DOM.cupraOcrUploadCard) return;
    DOM.cupraOcrUploadCard.className = 'cupra-ocr-upload-card';
    if (DOM.ocrStatusText) {
      DOM.ocrStatusText.textContent = '';
      DOM.ocrStatusText.style.display = 'none';
    }
    setOcrInfoVisible(false);
    if (DOM.ocrCardIcon) {
      DOM.ocrCardIcon.textContent = '📸';
      DOM.ocrCardIcon.style.display = 'block';
    }
    if (DOM.ocrSpinner) DOM.ocrSpinner.style.display = 'none';
    if (DOM.inputCupraScreenshot) DOM.inputCupraScreenshot.value = '';
    const btnSpan = DOM.btnTriggerOcrUpload ? DOM.btnTriggerOcrUpload.querySelector('span') : null;
    if (btnSpan) btnSpan.textContent = 'Foto wählen';
  }

  function setOcrLoading(loading, message = '') {
    if (!DOM.cupraOcrUploadCard) return;
    if (loading) {
      DOM.cupraOcrUploadCard.classList.add('ocr-scanning');
      DOM.cupraOcrUploadCard.classList.remove('ocr-success');
      if (DOM.ocrSpinner) DOM.ocrSpinner.style.display = 'block';
      if (DOM.ocrCardIcon) DOM.ocrCardIcon.style.display = 'none';
      if (DOM.ocrStatusText) {
        DOM.ocrStatusText.textContent = message || 'Screenshot wird per KI analysiert...';
        DOM.ocrStatusText.style.display = 'block';
      }
      if (DOM.btnTriggerOcrUpload) DOM.btnTriggerOcrUpload.disabled = true;
    } else {
      DOM.cupraOcrUploadCard.classList.remove('ocr-scanning');
      if (DOM.ocrSpinner) DOM.ocrSpinner.style.display = 'none';
      if (DOM.ocrCardIcon) DOM.ocrCardIcon.style.display = 'block';
      if (DOM.btnTriggerOcrUpload) DOM.btnTriggerOcrUpload.disabled = false;
    }
  }

  async function handleCupraScreenshotFile(file) {
    if (!file) {
      showToast('⚠️ Bitte eine Bilddatei auswählen');
      return null;
    }

    setOcrLoading(true, '⚡️ Analysiere Cupra App Screenshot...');
    triggerHaptic();

    try {
      if (typeof Tesseract === 'undefined') {
        throw new Error('Tesseract OCR Bibliothek nicht verfügbar (Prüfe Internetverbindung)');
      }

      let imageSource = file;
      if (file instanceof Blob || (typeof File !== 'undefined' && file instanceof File)) {
        imageSource = await fileToPreprocessedCanvas(file);
      }

      const worker = await Tesseract.createWorker('deu+eng');
      const ret = await worker.recognize(imageSource);
      await worker.terminate();

      const text = ret && ret.data ? ret.data.text : '';
      const parsed = parseCupraScreenshotText(text);

      applyOcrResultsToModal(parsed);
      return parsed;
    } catch (err) {
      console.warn('OCR Erkennungsfehler:', err);
      setOcrLoading(false);
      if (DOM.ocrStatusText) {
        DOM.ocrStatusText.textContent = '⚠️ Texterkennung fehlgeschlagen. Bitte manuell eingeben.';
        DOM.ocrStatusText.style.display = 'block';
      }
      showToast('⚠️ Screenshot konnte nicht gelesen werden');
      return null;
    }
  }

  function fileToPreprocessedCanvas(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  }

  function parseCupraScreenshotText(text) {
    const res = {
      kwh: null,
      startSoc: null,
      endSoc: null,
      datetime: null
    };

    if (!text || typeof text !== 'string') return res;

    // 1. Start SoC ("Ursprünglicher Ladezustand 17%", "Ursprunglicher Ladezustand", etc.)
    const mStart = text.match(/urspr[üuüeéii\s\.\-]*ng?li[a-z]*[^\d%]{0,40}?(\d{1,3})\s*%?/i)
                || text.match(/(?:initial|start|begonnen|anfang|vorher|von)[^\d%]{0,30}?(\d{1,3})\s*%/i);
    if (mStart) {
      const v = parseInt(mStart[1], 10);
      if (v >= 0 && v <= 100) res.startSoc = v;
    }

    // 2. End SoC ("Endgültiger Ladezustand 71%", "Endgiiltiger", "Endgueltiger", "Endgltiger", "Endgtiltiger", etc.)
    const mEnd = text.match(/endg[üuüeéii\s\.\-]*lt?i?g[a-z]*[^\d%]{0,40}?(\d{1,3})\s*%?/i)
              || text.match(/(?:endg[a-z]+|endzustand|ende|ziel|final|nach|target|beendet)[^\d%]{0,30}?(\d{1,3})\s*%/i)
              || text.match(/batterieladestand[^\d%]{0,60}?[0o]?(\d{1,3})\s*%/i);
    if (mEnd) {
      const v = parseInt(mEnd[1], 10);
      if (v >= 0 && v <= 100) res.endSoc = v;
    }

    // 3. Intelligenter Block-Fallback für 'LADEVORGANG' (Start = 1. Prozentwert, Ende = 2. Prozentwert)
    const lvMatch = text.match(/ladevorgang[\s\S]{1,400}/i);
    const searchBlock = lvMatch ? lvMatch[0] : text;
    const pctMatches = [...searchBlock.matchAll(/(\d{1,3})\s*%/g)]
      .map(m => parseInt(m[1], 10))
      .filter(p => !isNaN(p) && p >= 0 && p <= 100);

    if (res.startSoc === null || res.endSoc === null) {
      if (pctMatches.length >= 2) {
        if (res.startSoc === null) res.startSoc = pctMatches[0];
        if (res.endSoc === null) res.endSoc = pctMatches[1];
      } else if (pctMatches.length === 1) {
        if (res.startSoc !== null && res.endSoc === null && pctMatches[0] !== res.startSoc) {
          res.endSoc = pctMatches[0];
        } else if (res.endSoc !== null && res.startSoc === null && pctMatches[0] !== res.endSoc) {
          res.startSoc = pctMatches[0];
        }
      }
    }

    // Globaler Fallback für End-SoC: Falls Start bekannt ist aber End-SoC noch fehlt
    if (res.endSoc === null && res.startSoc !== null) {
      const allPcts = [...text.matchAll(/(\d{1,3})\s*%/g)]
        .map(m => parseInt(m[1], 10))
        .filter(p => !isNaN(p) && p >= 0 && p <= 100);
      const candidates = allPcts.filter(p => p !== res.startSoc && p >= res.startSoc);
      if (candidates.length > 0) {
        res.endSoc = candidates[candidates.length - 1];
      }
    }

    // Plausibilitäts-Check: Falls Start > Ende vertauscht wurden (z.B. durch OCR-Reihenfolge), korrigieren
    if (res.startSoc !== null && res.endSoc !== null && res.startSoc > res.endSoc) {
      const tmp = res.startSoc;
      res.startSoc = res.endSoc;
      res.endSoc = tmp;
    }

    // 4. Geladene kWh ("IN RECHNUNG GESTELLTER BETRAG ~ 30 kWh", "~ 30 kwh", "38.5 kWh")
    let mKwh = text.match(/rechnung[^\n]*\n[^\n]*?(\d+(?:[.,]\d+)?)\s*kw[hno]?/i);
    if (!mKwh) {
      mKwh = text.match(/(?:rechnung|betrag|geladen|gesamt)[^\d\n]{0,25}(\d+(?:[.,]\d+)?)\s*kw[hno]?/i);
    }
    if (!mKwh) {
      mKwh = text.match(/(?:~|≈|=>|\>)\s*(\d+(?:[.,]\d+)?)\s*kw[hno]?/i);
    }
    if (!mKwh) {
      const allMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*kw[hno]?/gi)];
      if (allMatches.length > 0) {
        mKwh = allMatches[0];
      }
    }
    if (mKwh) {
      const val = parseFloat(mKwh[1].replace(',', '.'));
      if (!isNaN(val) && val > 0 && val <= 120) {
        res.kwh = val;
      }
    }

    // 5. Datum & Uhrzeit ("Ladevorgang gestartet 20.10.26, 06:59" oder "< Di. 20.10.26, 06:59")
    let mDt = text.match(/gestartet[^\d]*(\d{1,2})[./\s](\d{1,2})[./\s](\d{2,4})[^\d]*(\d{1,2})[:.](\d{2})/i);
    if (!mDt) {
      mDt = text.match(/(?:Mo|Di|Mi|Do|Fr|Sa|So)[.,\s]*(\d{1,2})[.](\d{1,2})[.](\d{2,4})[,\s]*(\d{1,2})[:.](\d{2})/i);
    }
    if (!mDt) {
      mDt = text.match(/(\d{1,2})[.](\d{1,2})[.](\d{2,4})[,\s|]*(\d{1,2})[:.](\d{2})/i);
    }
    if (mDt) {
      let [_, d, m, y, h, mi] = mDt;
      d = d.padStart(2, '0');
      m = m.padStart(2, '0');
      if (y.length === 2) y = '20' + y;
      h = h.padStart(2, '0');
      mi = mi.padStart(2, '0');
      res.datetime = `${y}-${m}-${d}T${h}:${mi}`;
    }

    return res;
  }

  function applyOcrResultsToModal(data) {
    setOcrLoading(false);

    let foundCount = 0;
    const filledLabels = [];

    // Hinweis: Gemäß Vorgabe wird die kWh-Menge beim Erfassen nicht mehr aus dem Screenshot übernommen.

    if (data.startSoc !== null && DOM.entryBatterySocStart) {
      DOM.entryBatterySocStart.value = data.startSoc;
      DOM.entryBatterySocStart.classList.remove('auto-filled-glow');
      void DOM.entryBatterySocStart.offsetWidth;
      DOM.entryBatterySocStart.classList.add('auto-filled-glow');
      foundCount++;
      filledLabels.push(`Start ${data.startSoc}%`);
    }

    if (data.endSoc !== null && DOM.entryBatterySoc) {
      DOM.entryBatterySoc.value = data.endSoc;
      DOM.entryBatterySoc.classList.remove('auto-filled-glow');
      void DOM.entryBatterySoc.offsetWidth;
      DOM.entryBatterySoc.classList.add('auto-filled-glow');
      foundCount++;
      filledLabels.push(`Ende ${data.endSoc}%`);
    }

    if (data.datetime && DOM.entryDateTime) {
      DOM.entryDateTime.value = data.datetime;
      DOM.entryDateTime.classList.remove('auto-filled-glow');
      void DOM.entryDateTime.offsetWidth;
      DOM.entryDateTime.classList.add('auto-filled-glow');
    }

    calculateModalCost();
    calculateModalOdoDelta();
    calculateModalSocDelta();

    if (foundCount > 0) {
      if (DOM.cupraOcrUploadCard) {
        DOM.cupraOcrUploadCard.className = 'cupra-ocr-upload-card ocr-success';
      }
      if (DOM.ocrCardIcon) DOM.ocrCardIcon.textContent = '✨';
      if (DOM.ocrStatusText) {
        DOM.ocrStatusText.innerHTML = `<strong>${filledLabels.join(' • ')}</strong> automatisch eingetragen ✓`;
        DOM.ocrStatusText.style.display = 'block';
      }
      const btnSpan = DOM.btnTriggerOcrUpload ? DOM.btnTriggerOcrUpload.querySelector('span') : null;
      if (btnSpan) btnSpan.textContent = 'Anderes Bild';

      triggerHaptic();
      showToast('⚡️ Cupra-Screenshot erfolgreich ausgelesen!');
    } else {
      if (DOM.ocrStatusText) {
        DOM.ocrStatusText.textContent = '⚠️ Keine eindeutigen Werte erkannt. Bitte manuell eintragen.';
        DOM.ocrStatusText.style.display = 'block';
      }
      showToast('⚠️ Keine Ladedaten im Bild erkannt');
    }
  }

  // Für Tests & externe Trigger bereitstellen
  window.VEHICLE_START_ODO = VEHICLE_START_ODO;
  window.VEHICLE_START_SOC = VEHICLE_START_SOC;
  window.calcDistanceStats = calcDistanceStats;
  window.calcConsumption = calcConsumption;
  window.getSessionDelta = getSessionDelta;
  window.handleCupraScreenshotFile = handleCupraScreenshotFile;
  window.parseCupraScreenshotText = parseCupraScreenshotText;
  window.openModalCharge = openModalCharge;
  window.handleDeleteCharge = handleDeleteCharge;
  window.syncVehicleStateFromSessions = syncVehicleStateFromSessions;
  window.getGpsDistanceMeters = getGpsDistanceMeters;
  window.autoDetectLocationByGps = autoDetectLocationByGps;
  window.getSmartGpsCache = getSmartGpsCache;
  window.setSmartGpsCache = setSmartGpsCache;
  window.checkGeolocationPermission = checkGeolocationPermission;
  window.autoRequestGpsAndFetchWeather = autoRequestGpsAndFetchWeather;
  window.updateDashboardWinterRangeSimulation = updateDashboardWinterRangeSimulation;
  window.postCloudVehicleConfig = postCloudVehicleConfig;
  window.formatSessionForCloud = formatSessionForCloud;
  window.getSessionCompleteness = getSessionCompleteness;
  Object.defineProperty(window, 'appData', {
    get: () => appData,
    set: (v) => { appData = v; },
    configurable: true
  });

  function handleSaveChargeEntry(e) {
    e.preventDefault();

    const editId = DOM.entryEditId.value;
    const dt = (DOM.entryDateTime && DOM.entryDateTime.value) ? DOM.entryDateTime.value : new Date().toISOString();

    const rawKwh = (DOM.entryKwh && DOM.entryKwh.value) ? DOM.entryKwh.value.trim() : '';
    const kwh = (rawKwh !== '' && !isNaN(parseFloat(rawKwh))) ? parseFloat(rawKwh) : null;

    const rawOdo = (DOM.entryOdometer && DOM.entryOdometer.value) ? DOM.entryOdometer.value.trim() : '';
    const odo = (rawOdo !== '' && !isNaN(parseInt(rawOdo, 10))) ? parseInt(rawOdo, 10) : null;

    const locId = DOM.entryLocationId.value;
    const locObj = appData.settings.locations.find(l => l.id === locId) || appData.settings.locations[0];
    const locName = locObj ? locObj.name : 'Bayrhofs';
    const isPv = locObj ? locObj.powerType === 'pv' : false;

    const rawPrice = (DOM.entryPrice && DOM.entryPrice.value) ? DOM.entryPrice.value.trim() : '';
    const price = (rawPrice !== '' && !isNaN(parseFloat(rawPrice))) ? parseFloat(rawPrice) : (locObj ? locObj.kwhPrice : null);

    const rawTotal = (DOM.entryTotalCost && DOM.entryTotalCost.value) ? DOM.entryTotalCost.value.trim() : '';
    let total = null;
    if (rawTotal !== '' && !isNaN(parseFloat(rawTotal))) {
      total = parseFloat(rawTotal);
    } else if (kwh !== null && price !== null) {
      total = Number((kwh * price).toFixed(2));
    }

    const notes = DOM.entryNotes ? DOM.entryNotes.value.trim() : '';

    let enteredStartSoc = null;
    if (DOM.entryBatterySocStart && DOM.entryBatterySocStart.value.trim() !== '') {
      const parsedStartSoc = parseInt(DOM.entryBatterySocStart.value, 10);
      if (!isNaN(parsedStartSoc) && parsedStartSoc >= 0 && parsedStartSoc <= 100) {
        enteredStartSoc = parsedStartSoc;
      }
    }

    let enteredSoc = null;
    if (DOM.entryBatterySoc && DOM.entryBatterySoc.value.trim() !== '') {
      const parsedSoc = parseInt(DOM.entryBatterySoc.value, 10);
      if (!isNaN(parsedSoc) && parsedSoc >= 0 && parsedSoc <= 100) {
        enteredSoc = parsedSoc;
      }
    }

    const isBayrhof = isBayrhofsLocation(locName);
    let sessionPaid = true;
    if (isBayrhof) {
      sessionPaid = Boolean(DOM.entryPaymentPaidCheckbox && DOM.entryPaymentPaidCheckbox.checked);
    } else {
      // Wichtig: Nur bei Bayrhofs Laden wird über eine spätere Summenabrechnung gemacht. Alles andere wird immer direkt bezahlt!
      sessionPaid = true;
    }

    const compInfo = getSessionCompleteness({
      kwh,
      odometer: odo,
      totalCost: total,
      pricePerKwh: price,
      soc: enteredSoc,
      socStart: enteredStartSoc
    });

    let savedSession = null;
    if (editId) {
      const cleanEditId = String(editId).trim();
      const idx = appData.sessions.findIndex(s => String(s.id).trim() === cleanEditId);
      if (idx !== -1) {
        appData.sessions[idx] = {
          id: cleanEditId,
          date: new Date(dt).toISOString(),
          kwh,
          odometer: odo,
          socStart: enteredStartSoc,
          soc: enteredSoc,
          pricePerKwh: price,
          totalCost: total,
          location: locName,
          pvSurplus: isPv,
          notes,
          paid: sessionPaid,
          isComplete: compInfo.isComplete
        };
        savedSession = appData.sessions[idx];
        removeDeletedId(cleanEditId);
      }
    } else {
      savedSession = {
        id: `session_${Date.now()}`,
        date: new Date(dt).toISOString(),
        kwh,
        odometer: odo,
        socStart: enteredStartSoc,
        soc: enteredSoc,
        pricePerKwh: price,
        totalCost: total,
        location: locName,
        pvSurplus: isPv,
        notes,
        paid: sessionPaid,
        isComplete: compInfo.isComplete
      };
      removeDeletedId(savedSession.id);
      appData.sessions.push(savedSession);
    }

    // Chronologische Konsistenz & Fahrzeug-Synchronisation (Odometer & SoC)
    syncVehicleStateFromSessions();
    saveData();
    closeModalCharge();
    renderAll();
    triggerHaptic();

    if (compInfo.isComplete) {
      showToast(editId ? 'Ladung aktualisiert ✓' : 'Ladevorgang gespeichert ⚡️');
    } else {
      showToast(editId ? 'Ladung aktualisiert (⏳ Unvollständig)' : 'Teil-Ladung gespeichert (⏳ Unvollständig)');
    }

    // Im Hintergrund an Google Sheets senden (Optimistic UI)
    if (savedSession) {
      postCloudSession(savedSession, editId ? 'update' : 'create');
    }
  }

  function renderThgYearChips() {
    if (!DOM.thgYearsPills) return;
    DOM.thgYearsPills.innerHTML = '';

    const thgByYear = (appData.settings && appData.settings.thgByYear) || {};
    const curYear = DOM.cfgThgYear ? (parseInt(DOM.cfgThgYear.value, 10) || (appData.settings.thg && appData.settings.thg.year) || new Date().getFullYear()) : new Date().getFullYear();

    const years = Object.keys(thgByYear).filter(y => !isNaN(parseInt(y, 10))).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const yearList = [...new Set([...years, String(curYear)])].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    yearList.forEach(yr => {
      const yrData = thgByYear[yr];
      const isCur = String(yr) === String(curYear);
      const isSaved = Boolean(yrData);
      const amt = yrData ? Number(yrData.amount) : 110.00;
      const isAct = yrData ? (yrData.status !== 'inactive' && yrData.active !== false) : true;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `thg-year-pill ${isCur ? 'active' : ''} ${!isAct ? 'inactive' : ''}`;
      btn.setAttribute('data-year', yr);

      const icon = isCur ? '📍' : (isAct ? '🌿' : '⚪');
      const amtText = isSaved ? `${amt.toFixed(2).replace('.', ',')} €` : 'neu';
      btn.innerHTML = `<span>${icon} ${yr}:</span> <strong>${amtText}</strong>`;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        switchThgYear(parseInt(yr, 10));
      });

      DOM.thgYearsPills.appendChild(btn);
    });

    if (DOM.thgSavedStatus) {
      const yrData = thgByYear[String(curYear)];
      if (yrData) {
        const isAct = yrData.status !== 'inactive' && yrData.active !== false;
        DOM.thgSavedStatus.innerHTML = `<span class="status-icon">✓</span> <span class="status-text">Jahr ${curYear}: <strong>${Number(yrData.amount).toFixed(2).replace('.', ',')} €</strong> ${isAct ? '(Aktiv)' : '(Inaktiv)'} gespeichert</span>`;
        DOM.thgSavedStatus.className = 'thg-saved-status saved';
      } else {
        DOM.thgSavedStatus.innerHTML = `<span class="status-icon">ℹ️</span> <span class="status-text">Jahr ${curYear}: Noch nicht gesichert (Standard: 110,00 €)</span>`;
        DOM.thgSavedStatus.className = 'thg-saved-status unsaved';
      }
    }
  }

  function switchThgYear(targetYear) {
    if (!targetYear || targetYear < 2000 || targetYear > 2100) return;

    if (DOM.cfgThgYear && DOM.cfgThgYear.value !== String(targetYear)) {
      DOM.cfgThgYear.value = targetYear;
    }

    const yrStr = String(targetYear);
    const yrCfg = (appData.settings && appData.settings.thgByYear && appData.settings.thgByYear[yrStr]);

    if (yrCfg) {
      if (DOM.cfgThgAmount) DOM.cfgThgAmount.value = Number(yrCfg.amount).toFixed(2);
      if (DOM.cfgThgActive) DOM.cfgThgActive.checked = (yrCfg.status !== 'inactive' && yrCfg.active !== false);
    } else {
      if (DOM.cfgThgAmount) DOM.cfgThgAmount.value = '110.00';
      if (DOM.cfgThgActive) DOM.cfgThgActive.checked = true;
    }

    if (!appData.settings.thg) appData.settings.thg = {};
    appData.settings.thg.year = targetYear;
    if (yrCfg) {
      appData.settings.thg.amount = Number(yrCfg.amount);
      appData.settings.thg.active = (yrCfg.status !== 'inactive' && yrCfg.active !== false);
      appData.settings.thg.status = yrCfg.status || 'active';
    } else {
      appData.settings.thg.amount = 110.00;
      appData.settings.thg.active = true;
      appData.settings.thg.status = 'active';
    }

    renderThgYearChips();
    renderDashboard();
    renderChargesStream();
    renderAnalyticsCharts();
  }

  function saveCurrentThgSettings(quiet = false) {
    if (!appData || !appData.settings) return;
    if (!appData.settings.thg) appData.settings.thg = {};
    if (!appData.settings.thgByYear) appData.settings.thgByYear = {};

    let chosenYear = new Date().getFullYear();
    if (DOM.cfgThgYear) {
      chosenYear = parseInt(DOM.cfgThgYear.value, 10) || new Date().getFullYear();
    }
    let chosenAmount = 110.00;
    if (DOM.cfgThgAmount) {
      const parsedAmount = parseFloat(DOM.cfgThgAmount.value.replace(',', '.'));
      chosenAmount = !isNaN(parsedAmount) ? Math.max(0, parsedAmount) : 110.00;
    }
    let chosenActive = true;
    if (DOM.cfgThgActive) {
      chosenActive = DOM.cfgThgActive.checked;
    }

    const yrStr = String(chosenYear);
    appData.settings.thg.year = chosenYear;
    appData.settings.thg.amount = chosenAmount;
    appData.settings.thg.active = chosenActive;
    appData.settings.thg.status = chosenActive ? 'active' : 'inactive';

    appData.settings.thgByYear[yrStr] = {
      year: chosenYear,
      amount: chosenAmount,
      active: chosenActive,
      status: chosenActive ? 'active' : 'inactive'
    };

    saveData();
    renderDashboard();
    renderChargesStream();
    renderAnalyticsCharts();
    renderThgYearChips();

    if (!quiet) {
      triggerHaptic();
      showToast(`THG-Quote ${chosenYear} (${chosenAmount.toFixed(2).replace('.', ',')} €) gespeichert ✓`);
      postCloudVehicleConfig();
    }
  }

  // =========================================================================
  // FAHRZEUG-EINSTELLUNGEN
  // =========================================================================
  function renderSettingsForms() {
    const v = appData.vehicle;
    if (DOM.cfgModelName) DOM.cfgModelName.value = v.model;

    // Dynamische Batteriekapazität & SoH
    const bHealth = getBatteryHealthData(appData.sessions, appData.vehicle);
    appData.vehicle.batteryKwh = 52.0; // 100% Referenz-Nennkapazität
    appData.vehicle.currentBatteryKwh = bHealth.currentCap;
    appData.vehicle.batteryHealth = bHealth;
    if (DOM.cfgBatteryVal) DOM.cfgBatteryVal.textContent = bHealth.currentCap.toFixed(1);
    if (DOM.cfgBatteryBadge) {
      DOM.cfgBatteryBadge.textContent = `${bHealth.currentSoh.toFixed(1)}% SoH`;
      DOM.cfgBatteryBadge.title = `Dynamisch berechnet: ${bHealth.currentCap.toFixed(1)} kWh von ${bHealth.nominalCap} kWh (Tippen für 4-Jahres-Prognose)`;
    }

    if (DOM.cfgPowerVal) DOM.cfgPowerVal.textContent = v.powerPs || 211;
    if (DOM.cfgBatteryCap && DOM.cfgBatteryCap.tagName === 'INPUT') DOM.cfgBatteryCap.value = bHealth.currentCap;
    if (DOM.cfgPower && DOM.cfgPower.tagName === 'INPUT') DOM.cfgPower.value = v.powerPs;
    if (DOM.cfgCurrentOdo) {
      DOM.cfgCurrentOdo.value = Math.round(v.currentOdo ?? 0);
    }
    if (DOM.cfgCurrentSoc) {
      DOM.cfgCurrentSoc.value = (v.currentSoc !== null && v.currentSoc !== undefined) ? v.currentSoc : '';
    }

    // Feature 9a: THG-Quote Settings Form befüllen (aus thgByYear pro Jahr)
    const thg = (appData.settings && appData.settings.thg) || {};
    const defaultYear = thg.year || new Date().getFullYear();
    const curYear = defaultYear;
    const yrStr = String(curYear);
    const yrCfg = (appData.settings && appData.settings.thgByYear && appData.settings.thgByYear[yrStr]) || thg;

    if (DOM.cfgThgYear) DOM.cfgThgYear.value = curYear;
    if (DOM.cfgThgAmount) {
      const amt = (yrCfg && yrCfg.amount !== undefined && yrCfg.amount !== null) ? Number(yrCfg.amount) : 110.00;
      DOM.cfgThgAmount.value = amt.toFixed(2);
    }
    if (DOM.cfgThgActive) {
      const act = yrCfg ? (yrCfg.status !== 'inactive' && yrCfg.active !== false) : true;
      DOM.cfgThgActive.checked = act;
    }

    renderThgYearChips();

    if (DOM.inputCloudApiUrl) {
      DOM.inputCloudApiUrl.value = getCloudApiUrl();
    }
  }

  function handleSaveVehicleSettings() {
    appData.vehicle.model = (DOM.cfgModelName && DOM.cfgModelName.value.trim()) || DEFAULT_DATA.vehicle.model;
    const bHealth = getBatteryHealthData(appData.sessions, appData.vehicle);
    appData.vehicle.batteryKwh = bHealth.currentCap;
    appData.vehicle.powerPs = 211; // Fester Hardware-Wert
    if (DOM.cfgCurrentOdo) {
      const parsedOdo = parseInt(DOM.cfgCurrentOdo.value, 10);
      appData.vehicle.currentOdo = isNaN(parsedOdo) ? 0 : Math.max(0, parsedOdo);
    }
    if (DOM.cfgCurrentSoc) {
      const val = DOM.cfgCurrentSoc.value.trim();
      if (val === '') {
        appData.vehicle.currentSoc = null;
      } else {
        const parsedSoc = parseInt(val, 10);
        appData.vehicle.currentSoc = (isNaN(parsedSoc) || parsedSoc < 0 || parsedSoc > 100) ? null : parsedSoc;
      }
    }

    // Feature 9a: THG-Quote für das aktuell gewählte Jahr speichern
    saveCurrentThgSettings(true);

    saveData();
    renderAll();

    triggerHaptic();
    showToast('Fahrzeugdaten aktualisiert ✓');

    // Fahrzeug-Spezifikationen automatisch im Google Sheet Tabellenblatt 'Vehicle_Config' sichern
    postCloudVehicleConfig();
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
        socStart: 18,
        soc: 80,
        pricePerKwh: 0.15,
        totalCost: 5.18,
        location: "Bayrhofs",
        pvSurplus: true,
        notes: "100% PV-Überschuss bei Bayrhofs",
        paid: false
      },
      {
        id: `demo_${Date.now()}_2`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 4, 11, 45).toISOString(),
        kwh: 28.0,
        odometer: 12240,
        socStart: 25,
        soc: 75,
        pricePerKwh: 0.20,
        totalCost: 5.60,
        location: "Arbeit",
        pvSurplus: false,
        notes: "Bürotag Donnerstag",
        paid: true
      },
      {
        id: `demo_${Date.now()}_3`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8, 18, 15).toISOString(),
        kwh: 41.2,
        odometer: 12050,
        socStart: 10,
        soc: 85,
        pricePerKwh: 0.15,
        totalCost: 6.18,
        location: "Bayrhofs",
        pvSurplus: true,
        notes: "Sonniger Tag bei Bayrhofs",
        paid: false
      },
      {
        id: `demo_${Date.now()}_4`,
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14, 10, 30).toISOString(),
        kwh: 31.5,
        odometer: 11780,
        socStart: 20,
        soc: 76,
        pricePerKwh: 0.32,
        totalCost: 10.08,
        location: "Zuhause",
        pvSurplus: false,
        notes: "Nachtladung Wallbox",
        paid: true
      },
      {
        id: `demo_${Date.now()}_5`,
        date: new Date(now.getFullYear(), now.getMonth() - 1, 18, 16, 10).toISOString(),
        kwh: 38.5,
        odometer: 11620,
        socStart: 15,
        soc: 83,
        pricePerKwh: 0.59,
        totalCost: 22.72,
        location: "Öffentlich",
        pvSurplus: false,
        notes: "HPC Schnelllader Autobahn",
        paid: true
      }
    ];

    appData.sessions = demo;
    syncVehicleStateFromSessions();
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

  window.calculateBayrhofsPaymentMatch = calculateBayrhofsPaymentMatch;
  window.renderBayrhofsReconcileCard = renderBayrhofsReconcileCard;
  window.switchBayrhofsMode = switchBayrhofsMode;
  window.handleToggleSessionPaid = handleToggleSessionPaid;
  window.handleConfirmReconcile = handleConfirmReconcile;
  window.renderAll = renderAll;
  window.saveData = saveData;
  window.getBatteryHealthData = getBatteryHealthData;
  window.openBatteryHealthModal = openBatteryHealthModal;
  window.closeBatteryHealthModal = closeBatteryHealthModal;

  Object.defineProperty(window, 'appData', {
    get() { return appData; },
    set(v) { appData = v; },
    configurable: true
  });

})();
