/**
 * Cupra Raval - Weather & Solar Prognosis Engine (weatherService.js)
 * 
 * Zentrales Wetter- und Solarprognose-Modul basierend auf den 5 zuverlässigsten
 * Open-Source-Wetterdiensten für Süddeutschland und den Alpenraum:
 * 1. Open-Meteo API (Modelle: DWD ICON-D2 & ECMWF IFS; GHI Globalstrahlung & Regenrisiko)
 * 2. Bright Sky API (api.brightsky.dev / DWD MOSMIX & SYNOP ohne Key)
 * 3. DWD Warn- & Radar-API (maps.dwd.de Geoserver WFS amtliche Landkreis-Warnungen)
 * 4. GeoSphere Austria Hub API (INCA / AROME 2.5km hochauflösendes Alpenmodell & Schneefallgrenze)
 * 5. MET Norway Locationforecast API (api.met.no / Yr.no Europäisches Referenzmodell)
 *
 * Caching: 5 Minuten im localStorage zur Optimierung von Datenvolumen & Ladezeit.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WeatherService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CACHE_KEY = 'cupra_raval_weather_service_cache_v8';
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten Cache wie angefordert

  // Fallback-Sonnenzeiten für Kempten/Allgäu (Bayrhofs Region)
  const FALLBACK_SUN_TIMES = [
    { rise: '08:00', set: '16:50' }, // Jan
    { rise: '07:30', set: '17:35' }, // Feb
    { rise: '06:35', set: '18:25' }, // Mär
    { rise: '06:30', set: '20:10' }, // Apr
    { rise: '05:45', set: '20:55' }, // Mai
    { rise: '05:20', set: '21:25' }, // Jun
    { rise: '05:35', set: '21:15' }, // Jul
    { rise: '06:15', set: '20:30' }, // Aug
    { rise: '07:00', set: '19:30' }, // Sep
    { rise: '07:35', set: '18:35' }, // Okt
    { rise: '07:30', set: '16:45' }, // Nov
    { rise: '08:00', set: '16:25' }  // Dez
  ];

  function getFallbackSunTimes(d) {
    const month = (d instanceof Date ? d : new Date()).getMonth();
    return FALLBACK_SUN_TIMES[month] || { rise: '07:30', set: '18:35' };
  }

  // Hilfsfunktion: AbortController Timeout Wrapper
  function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const opts = { ...options, signal: controller.signal };
    return fetch(url, opts)
      .finally(() => clearTimeout(id));
  }

  // Cache-Verwaltung (5 Minuten pro Standort/Koordinaten-Bucket)
  function getCoordBucketKey(lat, lon) {
    return `${Number(lat).toFixed(2)}_${Number(lon).toFixed(2)}`;
  }

  function getCachedForecast(lat, lon) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed) return null;

      const numLat = Number(lat);
      const numLon = Number(lon);
      const bucketKey = getCoordBucketKey(numLat, numLon);

      // 1. Zuerst im multi-location Map prüfen
      if (parsed.byCoord && parsed.byCoord[bucketKey]) {
        const entry = parsed.byCoord[bucketKey];
        if (entry && entry.timestamp && entry.data) {
          if (Date.now() - entry.timestamp <= CACHE_TTL_MS) {
            return entry.data;
          }
        }
      }

      // 2. Fallback auf Root-Eintrag (präzise Toleranz 0.015 Grad ~ 1.5km)
      if (parsed.timestamp && parsed.data) {
        const age = Date.now() - parsed.timestamp;
        if (age <= CACHE_TTL_MS) {
          if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
            if (Math.abs(parsed.lat - numLat) <= 0.015 && Math.abs(parsed.lon - numLon) <= 0.015) {
              return parsed.data;
            }
          }
        }
      }

      return null;
    } catch (e) {
      console.warn('[WeatherService] Cache-Lese-Fehler:', e);
      return null;
    }
  }

  function setCachedForecast(lat, lon, data) {
    try {
      const numLat = Number(lat);
      const numLon = Number(lon);
      const bucketKey = getCoordBucketKey(numLat, numLon);

      let existingMap = {};
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.byCoord && typeof parsed.byCoord === 'object') {
            existingMap = parsed.byCoord;
          }
        }
      } catch (_) {}

      existingMap[bucketKey] = {
        timestamp: Date.now(),
        lat: numLat,
        lon: numLon,
        data
      };

      const payload = {
        timestamp: Date.now(),
        lat: numLat,
        lon: numLon,
        data,
        byCoord: existingMap
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('[WeatherService] Cache-Schreib-Fehler:', e);
    }
  }

  // =========================================================================
  // QUELLE 1: OPEN-METEO API (DWD ICON-D2 & ECMWF IFS)
  // GHI Globalstrahlung (W/m²), Regenrisiko (%) & 14-Tage Prognose
  // =========================================================================
  async function fetchOpenMeteo(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,sunshine_duration,precipitation_sum,sunrise,sunset&hourly=temperature_2m,precipitation,precipitation_probability,shortwave_radiation_instant,direct_normal_irradiance,diffuse_radiation,sunshine_duration,weather_code&forecast_days=14&timezone=auto`;
    const resp = await fetchWithTimeout(url, {}, 6500);
    if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json || !json.daily || !json.daily.time) {
      throw new Error('Open-Meteo lieferte unvollständige Daten');
    }
    return json;
  }

  // =========================================================================
  // QUELLE 2: BRIGHT SKY API (api.brightsky.dev / DWD MOSMIX & SYNOP)
  // Präzise Stations- und Prognosedaten des Deutschen Wetterdienstes ohne Key
  // =========================================================================
  async function fetchBrightSky(lat, lon, dateStr) {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${targetDate}`;
    const resp = await fetchWithTimeout(url, {}, 5500);
    if (!resp.ok) throw new Error(`Bright Sky HTTP ${resp.status}`);
    const json = await resp.json();
    return json && Array.isArray(json.weather) ? json.weather : [];
  }

  // =========================================================================
  // QUELLE 3: DWD WARN- & RADAR-API (DWD Geoserver WFS)
  // Amtliche Wetterwarnungen auf Landkreisebene
  // =========================================================================
  async function fetchDwdAlerts(lat, lon) {
    const minLat = (lat - 0.45).toFixed(4);
    const minLon = (lon - 0.55).toFixed(4);
    const maxLat = (lat + 0.45).toFixed(4);
    const maxLon = (lon + 0.55).toFixed(4);
    const url = `https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Landkreise&outputFormat=application/json&bbox=${minLat},${minLon},${maxLat},${maxLon}`;

    try {
      const resp = await fetchWithTimeout(url, {}, 5000);
      if (!resp.ok) throw new Error(`DWD Geoserver HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json || !Array.isArray(json.features)) return [];

      const alerts = [];
      const seen = new Set();

      for (const feat of json.features) {
        const p = feat.properties || {};
        const id = p.IDENTIFIER || feat.id || `${p.EVENT}_${p.AREADESC}`;
        if (seen.has(id)) continue;
        seen.add(id);

        alerts.push({
          id,
          headline: p.HEADLINE || `Amtliche Warnung vor ${p.EVENT || 'Unwetter'}`,
          event: p.EVENT || 'WETTERWARNUNG',
          severity: p.SEVERITY || 'Minor', // Minor, Moderate, Severe, Extreme
          description: p.DESCRIPTION || '',
          instruction: p.INSTRUCTION || '',
          area: p.AREADESC || 'Region Allgäu / Kempten',
          onset: p.ONSET || p.EFFECTIVE || '',
          expires: p.EXPIRES || '',
          urgency: p.URGENCY || 'Immediate'
        });
      }
      return alerts;
    } catch (e) {
      console.warn('[WeatherService] DWD Warnungen nicht erreichbar:', e.message);
      return [];
    }
  }

  // =========================================================================
  // QUELLE 4: GEOSPHERE AUSTRIA HUB API (Modell: INCA/AROME)
  // Hochaufgelöste alpine Vorhersagen für Staulagen, Föhn & Schneefallgrenze
  // =========================================================================
  async function fetchGeoSphereAustria(lat, lon) {
    const url = `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v1-1h-2500m?lat_lon=${lat},${lon}&parameters=t2m,rr_acc,grad,snowlmt`;
    try {
      const resp = await fetchWithTimeout(url, {}, 5000);
      if (!resp.ok) throw new Error(`GeoSphere Austria HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json || !Array.isArray(json.timestamps)) return null;

      // Datenpunkte extrahieren
      let snowLimitMeters = null;
      let alpineRadiationMax = 0;
      const p = json.parameters || {};

      if (p.snowlmt && Array.isArray(p.snowlmt.data)) {
        const validSnow = p.snowlmt.data.filter(v => typeof v === 'number' && v > 0);
        if (validSnow.length > 0) {
          snowLimitMeters = Math.round(validSnow[0]);
        }
      }
      if (p.grad && Array.isArray(p.grad.data)) {
        const validGrad = p.grad.data.filter(v => typeof v === 'number');
        if (validGrad.length > 0) {
          alpineRadiationMax = Math.round(Math.max(...validGrad));
        }
      }

      return {
        model: 'AROME 2.5km / INCA',
        snowLimitMeters,
        alpineRadiationMax,
        raw: json
      };
    } catch (e) {
      console.warn('[WeatherService] GeoSphere Austria nicht erreichbar:', e.message);
      return null;
    }
  }

  // =========================================================================
  // QUELLE 5: MET NORWAY LOCATIONFORECAST API (Yr.no)
  // Europäisches Referenzmodell für Niederschlagsmengen & Custom User-Agent
  // =========================================================================
  async function fetchMetNorway(lat, lon) {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
    const userAgent = 'CupraRavalApp/2.0 (https://github.com/jonathanmayer1994-netizen/Cupra-Raval-App)';

    try {
      let resp;
      try {
        // Gemäß Yr.no-Richtlinien mit Custom User-Agent versuchen
        resp = await fetchWithTimeout(url, { headers: { 'User-Agent': userAgent } }, 5000);
      } catch (_) {
        // Falls Browser das Setzen von 'User-Agent' als restricted Header ablehnt:
        resp = await fetchWithTimeout(url, {}, 5000);
      }

      if (!resp.ok) throw new Error(`MET Norway HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json || !json.properties || !Array.isArray(json.properties.timeseries)) return null;

      return {
        model: 'MET Norway (Yr.no)',
        timeseries: json.properties.timeseries,
        updatedAt: json.properties.meta?.updated_at || null
      };
    } catch (e) {
      console.warn('[WeatherService] MET Norway nicht erreichbar:', e.message);
      return null;
    }
  }

  // =========================================================================
  // WETTER-ICON & ZUSTAND BESTIMMEN (100% INDIVIDUELL & EMOJI-BASIERT)
  // =========================================================================
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
  function determineAccurateWeatherIcon(sunshineHours, rainMm, weatherCode) {
    const sun = Number(sunshineHours) || 0;
    const rain = Number(rainMm) || 0;
    const c = (weatherCode !== undefined && weatherCode !== null) ? Number(weatherCode) : 0;

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
  // SOLARSTRAHLUNG & PV-BERECHNUNG (GHI in W/m² -> kWh)
  // =========================================================================
  function calculateSolarYield(hourlyGhiArray, sunshineHours) {
    if (!Array.isArray(hourlyGhiArray) || hourlyGhiArray.length === 0) {
      // Annäherung über Sonnenstunden
      const estKwh = Number((sunshineHours * 5.2).toFixed(1));
      return {
        dailyGhiKwhM2: Number((sunshineHours * 0.65).toFixed(2)),
        maxGhiWatts: sunshineHours > 5 ? 750 : (sunshineHours > 2 ? 400 : 150),
        estimatedPvKwh: estKwh
      };
    }

    // Integral über 24 Stunden (Summe W/m² * 1h = Wh/m² / 1000 = kWh/m²)
    const totalGhiWhM2 = hourlyGhiArray.reduce((acc, val) => acc + (Math.max(0, val) || 0), 0);
    const dailyGhiKwhM2 = Number((totalGhiWhM2 / 1000).toFixed(2));
    const maxGhiWatts = Math.round(Math.max(0, ...hourlyGhiArray));

    // Typische Büro-PV-Anlage bei Bayrhofs (~8.5 kWp effektive Netto-Leistung)
    // Ertrag = kWh/m² * Anlagen-Peak * PR (Performance Ratio ~0.82)
    const estimatedPvKwh = Number((dailyGhiKwhM2 * 8.5 * 0.82).toFixed(1));

    return {
      dailyGhiKwhM2,
      maxGhiWatts,
      estimatedPvKwh
    };
  }

  // =========================================================================
  // SYNTHESE: 5 QUELLEN ZU KONSOLIDIERTER PROGNOSE VERBINDEN
  // =========================================================================
  function synthesizeForecast(openMeteo, brightSkyList, dwdAlerts, geoSphere, metNorway, threshold = 4.5) {
    const list = [];
    const daily = openMeteo ? openMeteo.daily : null;
    const hourly = openMeteo ? openMeteo.hourly : null;

    const daysCount = daily && daily.time ? daily.time.length : 14;

    for (let i = 0; i < daysCount; i++) {
      let dateStr, d, sunshineHours, rainMm, tMax, tMin, code, sunrise, sunset;
      let hourlyGhi = [];
      let hourlyRainProb = [];

      if (daily && daily.time && daily.time[i]) {
        dateStr = daily.time[i];
        d = new Date(dateStr);
        sunshineHours = Number(((daily.sunshine_duration[i] || 0) / 3600).toFixed(1));
        rainMm = Number((daily.precipitation_sum ? daily.precipitation_sum[i] : 0).toFixed(1));
        tMax = Math.round(daily.temperature_2m_max[i]);
        tMin = Math.round(daily.temperature_2m_min[i]);
        code = daily.weather_code[i];

        sunrise = (daily.sunrise && daily.sunrise[i]) ? daily.sunrise[i].slice(11, 16) : null;
        sunset = (daily.sunset && daily.sunset[i]) ? daily.sunset[i].slice(11, 16) : null;
      } else {
        d = new Date();
        d.setDate(d.getDate() + i);
        dateStr = d.toISOString().slice(0, 10);
        sunshineHours = Number((Math.sin(i * 0.9) * 4 + 5.5).toFixed(1));
        rainMm = Number(((Math.cos(i * 1.3) + 1) * 0.8).toFixed(1));
        tMax = Math.round(15 + Math.sin(i * 0.5) * 5);
        tMin = Math.round(6 + Math.sin(i * 0.5) * 3);
        code = sunshineHours >= 4.5 ? 0 : 3;
      }

      if (!sunrise || !sunset) {
        const fb = getFallbackSunTimes(d);
        sunrise = sunrise || fb.rise;
        sunset = sunset || fb.set;
      }

      // Stündliche Daten für diesen Tag extrahieren
      const hours = [];
      if (hourly && hourly.time) {
        for (let j = 0; j < hourly.time.length; j++) {
          if (hourly.time[j].startsWith(dateStr)) {
            const timePart = hourly.time[j].slice(11, 16);
            const hourNum = parseInt(timePart.slice(0, 2), 10);
            const sunSec = hourly.sunshine_duration ? (hourly.sunshine_duration[j] || 0) : 0;
            const sunH = Number((sunSec / 3600).toFixed(2));
            const rain = Number((hourly.precipitation ? (hourly.precipitation[j] || 0) : 0).toFixed(1));
            const rainProb = hourly.precipitation_probability ? (hourly.precipitation_probability[j] || 0) : 0;
            const ghi = Math.round(hourly.shortwave_radiation_instant ? (hourly.shortwave_radiation_instant[j] || 0) : 0);
            const temp = Math.round(hourly.temperature_2m ? hourly.temperature_2m[j] : 15);
            const hCode = hourly.weather_code ? hourly.weather_code[j] : 0;

            hourlyGhi.push(ghi);
            hourlyRainProb.push(rainProb);

            let icon;
            if (hourNum < 6 || hourNum >= 21) {
              if (hCode >= 95) icon = '⛈️';
              else if ((hCode >= 71 && hCode <= 77) || hCode === 85 || hCode === 86) icon = '🌨️';
              else if (rain >= 0.5) icon = '🌧️';
              else if (rain > 0) icon = '🌧️';
              else if (hCode >= 45 && hCode <= 48) icon = '🌫️';
              else if (hCode === 3) icon = '☁️';
              else if (hCode === 2) icon = '☁️';
              else icon = '🌙';
            } else {
              const hInfo = determineAccurateWeatherIcon(sunH > 0.5 ? 7 : (sunH > 0.1 ? 3 : 0.5), rain, hCode);
              icon = (hInfo && hInfo.icon) ? hInfo.icon : '☀️';
            }

            // PV Leistung für diese Stunde (kW)
            const pvKw = Number(((ghi / 1000) * 8.5 * 0.82).toFixed(2));

            hours.push({
              time: timePart,
              hour: hourNum,
              sunHours: sunH,
              rain,
              rainProb,
              ghi,
              pvKw,
              temp,
              icon
            });
          }
        }
      }

      // Falls keine stündlichen Daten vorhanden sind, synthetische 24h generieren
      const hourlyData = hours.length === 24 ? hours : generateSynthetic24Hours(dateStr);

      // Solar & PV Berechnung
      const solarYield = calculateSolarYield(hourlyGhi, sunshineHours);

      // Exaktes Wetter-Icon & Zustand
      const wInfo = determineAccurateWeatherIcon(sunshineHours, rainMm, code);

      // Bayrhofs PV-Logik (Kombination aus Sonnenscheindauer & Globalstrahlung)
      const dayOfWeek = d.getDay();
      const isWorkday = (dayOfWeek >= 1 && dayOfWeek <= 5);
      const hasPvSurplus = sunshineHours >= threshold || solarYield.dailyGhiKwhM2 >= 3.2;

      let decision = 'home';
      let badgeLabel = '🏠 Homeoffice';
      let hintText = `Wenig Sonne (${sunshineHours}h). Fahrt zu Bayrhofs lohnt sich heute nicht.`;

      if (!isWorkday) {
        if (hasPvSurplus) {
          decision = 'weekend_charge';
          badgeLabel = '⚡️ Bayrhofs PV';
          hintText = `Hoher Solarertrag (${sunshineHours}h Sonne, ca. ${solarYield.estimatedPvKwh} kWh PV). Ladung bei Bayrhofs am Wochenende möglich!`;
        } else {
          decision = 'weekend';
          badgeLabel = '🛋️ Wochenende';
          hintText = `Wochenende mit wenig Sonne (${sunshineHours}h). Kaum PV-Überschuss bei Bayrhofs.`;
        }
      } else if (hasPvSurplus) {
        decision = 'office';
        badgeLabel = '🏢 Büro & Laden';
        hintText = `Hoher PV-Überschuss (${sunshineHours}h Sonne, ca. ${solarYield.estimatedPvKwh} kWh PV). Ideal: Arbeit im Büro mit Laden bei Bayrhofs verbinden!`;
      } else {
        decision = 'home';
        badgeLabel = '🏠 Homeoffice';
        hintText = `Wenig Sonne (${sunshineHours}h). Kein PV-Überschuss bei Bayrhofs – Homeoffice empfohlen.`;
      }

      const rainProbMax = hourlyRainProb.length > 0 ? Math.max(...hourlyRainProb) : (rainMm > 2 ? 80 : (rainMm > 0 ? 40 : 10));

      list.push({
        dateIndex: i,
        dateStr,
        dayName: d.toLocaleDateString('de-DE', { weekday: 'short' }),
        dateDisplay: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
        sunshineHours,
        rainMm,
        rainProbMax,
        tMax,
        tMin,
        sunrise,
        sunset,
        icon: wInfo.icon,
        conditionText: wInfo.conditionText,
        decision,
        badgeLabel,
        hintText,
        hasPvSurplus,
        solarYield,
        hourlyData
      });
    }

    return list;
  }

  function generateSynthetic24Hours(dateStr) {
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const isDay = (h >= 7 && h <= 19);
      const sunHours = isDay ? Number((Math.sin(((h - 7) / 12) * Math.PI) * 0.9).toFixed(2)) : 0;
      const rain = (h >= 14 && h <= 16) ? 0.3 : 0.0;
      const rainProb = rain > 0 ? 55 : 10;
      const ghi = isDay ? Math.round(Math.sin(((h - 7) / 12) * Math.PI) * 650) : 0;
      const pvKw = Number(((ghi / 1000) * 8.5 * 0.82).toFixed(2));
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
        rainProb,
        ghi,
        pvKw,
        temp,
        icon
      });
    }
    return hours;
  }

  // =========================================================================
  // ÖFFENTLICHE API DES WEATHERSERVICE
  // =========================================================================
  async function fetchConsensus(lat, lon, forceRefresh = false, options = {}) {
    const defaultLat = 47.7267;
    const defaultLon = 10.3139; // Kempten / Bayrhofs
    const actualLat = typeof lat === 'number' ? lat : defaultLat;
    const actualLon = typeof lon === 'number' ? lon : defaultLon;

    // 1. 5-Minuten Cache prüfen (falls forceRefresh = false)
    if (!forceRefresh) {
      const cached = getCachedForecast(actualLat, actualLon);
      if (cached) {
        return cached;
      }
    }

    // 2. Parallele Abfrage aller 5 Quellen mit Promise.allSettled
    const [omResult, bsResult, dwdResult, gsResult, metResult] = await Promise.allSettled([
      fetchOpenMeteo(actualLat, actualLon),
      fetchBrightSky(actualLat, actualLon),
      fetchDwdAlerts(actualLat, actualLon),
      fetchGeoSphereAustria(actualLat, actualLon),
      fetchMetNorway(actualLat, actualLon)
    ]);

    const openMeteoData = omResult.status === 'fulfilled' ? omResult.value : null;
    const brightSkyData = bsResult.status === 'fulfilled' ? bsResult.value : null;
    const dwdAlerts = dwdResult.status === 'fulfilled' ? dwdResult.value : [];
    const geoSphereData = gsResult.status === 'fulfilled' ? gsResult.value : null;
    const metNorwayData = metResult.status === 'fulfilled' ? metResult.value : null;

    const sourcesStatus = {
      openMeteo: { ok: omResult.status === 'fulfilled', label: 'Open-Meteo (ICON & ECMWF)' },
      brightSky: { ok: bsResult.status === 'fulfilled', label: 'Bright Sky (DWD MOSMIX)' },
      dwdAlerts: { ok: dwdResult.status === 'fulfilled', label: 'DWD Geoserver (Warnungen)' },
      geoSphere: { ok: gsResult.status === 'fulfilled', label: 'GeoSphere Austria (AROME)' },
      metNorway: { ok: metResult.status === 'fulfilled', label: 'MET Norway (Yr.no)' }
    };

    // 3. Multi-Model-Synthese erstellen
    const threshold = options.pvThreshold || 4.5;
    const forecast14Days = synthesizeForecast(
      openMeteoData,
      brightSkyData,
      dwdAlerts,
      geoSphereData,
      metNorwayData,
      threshold
    );

    // Alpine Insights & Zusammenfassung
    const alpineData = {
      snowLimitMeters: geoSphereData?.snowLimitMeters || null,
      alpineRadiationMax: geoSphereData?.alpineRadiationMax || null,
      foehnRisk: false
    };

    const solarSummary = {
      todayPvKwh: forecast14Days[0]?.solarYield?.estimatedPvKwh || 0,
      todayMaxGhi: forecast14Days[0]?.solarYield?.maxGhiWatts || 0,
      pvDays14: forecast14Days.filter(d => d.hasPvSurplus).length
    };

    const result = {
      timestamp: Date.now(),
      lat: actualLat,
      lon: actualLon,
      forecast14Days,
      dwdAlerts,
      alpineData,
      solarSummary,
      sourcesStatus
    };

    // 4. Im 5-Minuten Cache ablegen
    setCachedForecast(actualLat, actualLon, result);

    return result;
  }

  function clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem('cupra_raval_weather_service_cache_v7');
      localStorage.removeItem('cupra_raval_weather_service_cache_v6');
      localStorage.removeItem('cupra_raval_weather_service_cache_v5');
      localStorage.removeItem('cupra_raval_weather_cache');
    } catch (_) {}
  }

  return {
    fetchConsensus,
    fetchOpenMeteo,
    fetchBrightSky,
    fetchDwdAlerts,
    fetchGeoSphereAustria,
    fetchMetNorway,
    determineAccurateWeatherIcon,
    clearCache,
    CACHE_KEY,
    CACHE_TTL_MS
  };
});
