(() => {
  const $ = (s) => document.querySelector(s);
  const categoryName = { landmark: "명소", place: "지명·마을", nature: "자연", history: "역사·문화", park: "공원·휴양" };
  let places = [], provinces = [], selectedProvinces = new Set(), selectedCities = new Set();
  let finalMarker, tempMarkers = [], busy = false;
  let audioContext, bgmGain, bgmTimer, bgmStep = 0, bgmOn = false, bgmVolume = 4;

  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([36.35, 127.75], 7);
  const tileUrls = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"];
  const FallbackTiles = L.TileLayer.extend({
    initialize(url, options) { this.fallbackUrls = options.fallbackUrls || []; L.TileLayer.prototype.initialize.call(this, url, options); },
    createTile(coords, done) {
      const tile = document.createElement("img"); tile.alt = ""; tile.className = "leaflet-tile"; tile.crossOrigin = "anonymous";
      const urls = [this.getTileUrl(coords), ...this.fallbackUrls.map(u => L.Util.template(u, { ...coords, s: "a" }))]; let i = 0;
      const load = () => { tile.onload = () => done(null, tile); tile.onerror = () => { if (++i < urls.length) load(); else done(new Error("tile load failed"), tile); }; tile.src = urls[i]; };
      load(); return tile;
    }
  });
  const tiles = new FallbackTiles(tileUrls[0], { maxZoom: 19, attribution: "© OpenStreetMap contributors · © CARTO", fallbackUrls: tileUrls.slice(1) }).addTo(map);
  tiles.on("loading", () => { $("#mapMessage").hidden = false; }); tiles.on("load", () => { $("#mapMessage").hidden = true; });

  function safe(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function isValid(p) { return p && p.id && p.name && p.province && p.city && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 33 && p.lat <= 39 && p.lng >= 124 && p.lng <= 132 && ["A", "B"].includes(p.access) && categoryName[p.category]; }
  function makeChecks(target, values, selected, handler) {
    const box = $(target); box.replaceChildren();
    values.forEach(v => { const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span"); input.type = "checkbox"; input.value = v; input.checked = selected.has(v); span.textContent = v; input.addEventListener("change", () => handler(v, input.checked)); label.append(input, span); box.append(label); });
  }
  function shortSummary(set, all, label) { if (!set.size) return "선택하세요"; if (set.size === all.length) return "전체"; return set.size <= 2 ? [...set].join(", ") : `${[...set].slice(0, 2).join(", ")} 외 ${set.size - 2}${label}`; }
  function updateProvinceUI() {
    makeChecks("#provinceList", provinces, selectedProvinces, (v, checked) => { checked ? selectedProvinces.add(v) : selectedProvinces.delete(v); syncCities(true); updateProvinceUI(); });
    $("#provinceSummary").textContent = shortSummary(selectedProvinces, provinces, "곳"); $("#provinceCount").textContent = `${selectedProvinces.size}개 선택`;
  }
  function availableCities() { return [...new Set(places.filter(p => selectedProvinces.has(p.province)).map(p => p.city))].sort((a,b) => a.localeCompare(b, "ko")); }
  function syncCities(reset = false) { const cities = availableCities(); selectedCities = reset ? new Set(cities) : new Set([...selectedCities].filter(c => cities.includes(c))); if (!selectedCities.size && cities.length) selectedCities = new Set(cities); updateCityUI(); }
  function updateCityUI() { const cities = availableCities(); makeChecks("#cityList", cities, selectedCities, (v, checked) => { checked ? selectedCities.add(v) : selectedCities.delete(v); updateCityUI(); }); $("#citySummary").textContent = shortSummary(selectedCities, cities, "곳"); $("#cityCount").textContent = `${selectedCities.size}개 선택`; }
  function historyKey() { return "random-trip-korea-v5-history"; }
  function history() { try { return JSON.parse(localStorage.getItem(historyKey()) || "[]"); } catch { return []; } }
  function saveHistory(id) { const n = +$("#recent").value; if (!n) return localStorage.removeItem(historyKey()); const list = [id, ...history().filter(x => x !== id)].slice(0, n); localStorage.setItem(historyKey(), JSON.stringify(list)); }
  function pool() {
    const category = $("#category").value, access = $("#access").value;
    let list = places.filter(p => selectedProvinces.has(p.province) && selectedCities.has(p.city) && (category === "all" || p.category === category) && (access === "AB" || p.access === access));
    const fresh = list.filter(p => !history().includes(p.id)); return fresh.length ? fresh : list;
  }
  function shuffle(a) { const copy = Array.isArray(a) ? a.slice() : Array.from(a); for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
  function pick(list) { const grouped = {}; list.forEach(p => { const key = `${p.province}/${p.city}`; (grouped[key] ||= []).push(p); }); return shuffle(Object.keys(grouped)).map(k => shuffle(grouped[k])[0])[0]; }
  function icon() { return L.divIcon({ className: "", html: '<div class="marker"></div>', iconSize: [23,23], iconAnchor: [12,12] }); }
  function clearTemps() { tempMarkers.forEach(m => map.removeLayer(m)); tempMarkers = []; }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const BGM_MELODY = [659.25, 783.99, 880, 783.99, 987.77, 880, 783.99, 659.25, 587.33, 659.25, 783.99, 880, 1046.5, 987.77, 880, 783.99];
  const BGM_BASS = [130.81, 130.81, 146.83, 146.83, 164.81, 164.81, 146.83, 130.81];
  function playTone(frequency, when, duration, volume = 0.035, type = "triangle") {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, when);
    gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain).connect(bgmGain); oscillator.start(when); oscillator.stop(when + duration + 0.03);
  }
  function playKick(when) {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(160, when); oscillator.frequency.exponentialRampToValueAtTime(52, when + 0.12);
    gain.gain.setValueAtTime(0.18, when); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    oscillator.connect(gain).connect(bgmGain); oscillator.start(when); oscillator.stop(when + 0.15);
  }
  function playClap(when) {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.045, audioContext.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = audioContext.createBufferSource(), gain = audioContext.createGain(); source.buffer = buffer; gain.gain.value = 0.05;
    source.connect(gain).connect(bgmGain); source.start(when);
  }
  function updateBgmVolume() { bgmVolume = Number($("#bgmVolume").value) / 100 * 4; if (bgmGain) bgmGain.gain.value = bgmVolume; $("#bgmVolumeValue").textContent = `${Math.round(bgmVolume * 100)}%`; }
  function toggleBgm() {
    const button = $("#bgmToggle");
    if (bgmOn) { clearInterval(bgmTimer); bgmOn = false; button.textContent = "♫ BGM 켜기"; button.setAttribute("aria-pressed", "false"); return; }
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); bgmGain ||= (() => { const gain = audioContext.createGain(), compressor = audioContext.createDynamicsCompressor(); compressor.threshold.value = -18; compressor.knee.value = 24; compressor.ratio.value = 12; compressor.attack.value = 0.003; compressor.release.value = 0.25; gain.connect(compressor).connect(audioContext.destination); return gain; })(); bgmGain.gain.value = bgmVolume; audioContext.resume();
    const playPhrase = () => {
      const start = audioContext.currentTime + 0.04, step = 0.18;
      for (let i = 0; i < 8; i++) {
        const time = start + i * step, note = BGM_MELODY[bgmStep++ % BGM_MELODY.length];
        playTone(note, time, 0.14, 0.076, "square"); playTone(note / 2, time, 0.11, 0.036, "triangle");
        if (i % 2 === 0) playKick(time); else playClap(time);
        if (i === 0 || i === 4) playTone(BGM_BASS[(bgmStep / 2 | 0) % BGM_BASS.length], time, 0.30, 0.11, "sawtooth");
      }
    };
    playPhrase(); bgmTimer = setInterval(playPhrase, 1440); bgmOn = true; button.textContent = "♫ BGM 끄기"; button.setAttribute("aria-pressed", "true");
  }
  async function animateDraw(final, list) {
    $("#searching").hidden = false; clearTemps();
    // 최종 장소는 전체 후보에서 이미 뽑고, 화면에는 빠른 점 찍기 연출만 보여줍니다.
    const previewPool = shuffle(list.filter(p => p.id !== final.id));
    const barrageCount = Math.min(52, Math.max(28, Math.round(Math.sqrt(list.length) * 4)));
    const bounds = L.latLngBounds(list.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, {padding:[36,36], maxZoom:9, animate:true}); await wait(300);
    for (let i = 0; i < barrageCount; i++) {
      const p = previewPool.length ? previewPool[i % previewPool.length] : final;
      $("#searching").textContent = `여행 후보를 고르는 중… ${i + 1}/${barrageCount}`;
      const marker = L.marker([p.lat,p.lng], {icon:icon(), opacity:.58, interactive:false}).addTo(map);
      tempMarkers.push(marker); await wait(85);
    }
    $("#searching").textContent = "최종 여행지를 고르는 중…";
    await wait(180); clearTemps();
    if (finalMarker) map.removeLayer(finalMarker);
    finalMarker = L.marker([final.lat,final.lng], {icon:icon()}).addTo(map).bindPopup(`<b>${safe(final.name)}</b><br>${safe(final.province)} · ${safe(final.city)}`).openPopup();
    map.setView([final.lat,final.lng], 13, {animate:true}); await wait(420);
    $("#searching").hidden = true; $("#searching").textContent = "후보를 살펴보는 중…";
  }
  function show(p) { $("#result").classList.remove("empty"); $("#result").innerHTML = `<h2>📍 ${safe(p.name)}</h2><p class="meta">${safe(p.province)} · ${safe(p.city)}</p><div class="badges"><span class="badge">${categoryName[p.category]}</span><span class="badge">${p.access === "A" ? "🚗 차량 접근 쉬움" : "🚶 짧은 도보 포함"}</span><span class="badge">가족 여행 후보</span></div><div class="result-actions"><button id="again">다시 찾기</button><button id="route" class="primary">길찾기</button></div>`; $("#again").onclick = draw; $("#route").onclick = () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.city}`)}`, "_blank", "noopener"); }
  async function draw() { if (busy) return; const list = pool(); if (!list.length) { $("#result").classList.remove("empty"); $("#result").textContent = "현재 조건에 맞는 장소가 없습니다. 지역 또는 조건을 넓혀주세요."; return; } busy = true; $("#drawBtn").disabled = true; try { const final = pick(list); await animateDraw(final, list); show(final); saveHistory(final.id); } catch (error) { console.error(error); $("#result").classList.remove("empty"); $("#result").textContent = "여행지를 고르는 중 문제가 생겼습니다. 다시 한 번 눌러주세요."; } finally { $("#searching").hidden = true; busy = false; $("#drawBtn").disabled = false; } }
  function fit() { const list = pool(); if (list.length) map.fitBounds(L.latLngBounds(list.map(p => [p.lat,p.lng])), {padding:[36,36], maxZoom:9}); }
  function resize() { map.invalidateSize({animate:false}); }
  async function init() {
    try { const response = await fetch("data/places.json?v=1.0.06"); if (!response.ok) throw new Error(); places = (await response.json()).filter(isValid); if (!places.length) throw new Error(); provinces = [...new Set(places.map(p => p.province))]; selectedProvinces = new Set(provinces); updateProvinceUI(); syncCities(); $("#dbStatus").textContent = `여행 후보 ${places.length}곳`; }
    catch { $("#dbStatus").textContent = "데이터를 불러오지 못했습니다"; $("#result").classList.remove("empty"); $("#result").textContent = "GitHub Pages 주소에서 다시 열어주세요. 파일을 직접 열면 데이터 요청이 차단될 수 있습니다."; }
  }
  $("#selectAll").onclick = () => { selectedProvinces = new Set(provinces); updateProvinceUI(); syncCities(true); }; $("#clearAll").onclick = () => { selectedProvinces.clear(); updateProvinceUI(); syncCities(); };
  $("#selectAllCities").onclick = () => { selectedCities = new Set(availableCities()); updateCityUI(); }; $("#clearCities").onclick = () => { selectedCities.clear(); updateCityUI(); };
  $("#bgmToggle").onclick = toggleBgm; $("#bgmVolume").oninput = updateBgmVolume; $("#drawBtn").onclick = draw; $("#fitBtn").onclick = fit; $("#reloadMapBtn").onclick = () => { $("#mapMessage").hidden = false; tiles.redraw(); resize(); };
  [0,200,700].forEach(ms => setTimeout(resize, ms)); window.addEventListener("resize", resize); window.addEventListener("orientationchange", () => setTimeout(resize, 300)); document.addEventListener("visibilitychange", () => !document.hidden && setTimeout(resize, 120)); init();
})();

