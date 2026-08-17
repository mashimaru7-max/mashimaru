(() => {
  const $ = (s) => document.querySelector(s);
  const categoryName = { landmark: "명소", place: "지명·마을", nature: "자연", history: "역사·문화", park: "공원·휴양" };
  let places = [], provinces = [], selectedProvinces = new Set(), selectedCities = new Set();
  let finalMarker, tempMarkers = [], busy = false;

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
  function shuffle(a) { a = [...a]; for (let i = a.length - 1; i; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function pick(list) { const grouped = {}; list.forEach(p => { const key = `${p.province}/${p.city}`; (grouped[key] ||= []).push(p); }); return shuffle(Object.keys(grouped)).map(k => shuffle(grouped[k])[0])[0]; }
  function icon() { return L.divIcon({ className: "", html: '<div class="marker"></div>', iconSize: [23,23], iconAnchor: [12,12] }); }
  function clearTemps() { tempMarkers.forEach(m => map.removeLayer(m)); tempMarkers = []; }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function animateDraw(final, list) {
    $("#searching").hidden = false; clearTemps(); const candidates = shuffle(list.filter(p => p.id !== final.id)).slice(0, 6); const bounds = L.latLngBounds(list.map(p => [p.lat,p.lng])); map.fitBounds(bounds, {padding:[36,36], maxZoom:9, animate:true}); await wait(650);
    for (const p of candidates) { const marker = L.marker([p.lat,p.lng], {icon:icon(), opacity:.55, interactive:false}).addTo(map); tempMarkers.push(marker); map.panTo([p.lat,p.lng], {animate:true, duration:.28}); await wait(250); }
    clearTemps(); if (finalMarker) map.removeLayer(finalMarker); finalMarker = L.marker([final.lat,final.lng], {icon:icon()}).addTo(map).bindPopup(`<b>${safe(final.name)}</b><br>${safe(final.province)} · ${safe(final.city)}`).openPopup(); map.setView([final.lat,final.lng], 13, {animate:true}); await wait(450); $("#searching").hidden = true;
  }
  function show(p) { $("#result").classList.remove("empty"); $("#result").innerHTML = `<h2>📍 ${safe(p.name)}</h2><p class="meta">${safe(p.province)} · ${safe(p.city)}</p><div class="badges"><span class="badge">${categoryName[p.category]}</span><span class="badge">${p.access === "A" ? "🚗 차량 접근 쉬움" : "🚶 짧은 도보 포함"}</span><span class="badge">가족 여행 후보</span></div><div class="result-actions"><button id="again">다시 찾기</button><button id="route" class="primary">길찾기</button></div>`; $("#again").onclick = draw; $("#route").onclick = () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.city}`)}`, "_blank", "noopener"); }
  async function draw() { if (busy) return; const list = pool(); if (!list.length) { $("#result").classList.remove("empty"); $("#result").textContent = "현재 조건에 맞는 장소가 없습니다. 지역 또는 조건을 넓혀주세요."; return; } busy = true; $("#drawBtn").disabled = true; const final = pick(list); await animateDraw(final, list); show(final); saveHistory(final.id); busy = false; $("#drawBtn").disabled = false; }
  function fit() { const list = pool(); if (list.length) map.fitBounds(L.latLngBounds(list.map(p => [p.lat,p.lng])), {padding:[36,36], maxZoom:9}); }
  function resize() { map.invalidateSize({animate:false}); }
  async function init() {
    try { const response = await fetch("data/places.json"); if (!response.ok) throw new Error(); places = (await response.json()).filter(isValid); if (!places.length) throw new Error(); provinces = [...new Set(places.map(p => p.province))]; selectedProvinces = new Set(provinces); updateProvinceUI(); syncCities(); $("#dbStatus").textContent = `여행 후보 ${places.length}곳`; }
    catch { $("#dbStatus").textContent = "데이터를 불러오지 못했습니다"; $("#result").classList.remove("empty"); $("#result").textContent = "GitHub Pages 주소에서 다시 열어주세요. 파일을 직접 열면 데이터 요청이 차단될 수 있습니다."; }
  }
  $("#selectAll").onclick = () => { selectedProvinces = new Set(provinces); updateProvinceUI(); syncCities(true); }; $("#clearAll").onclick = () => { selectedProvinces.clear(); updateProvinceUI(); syncCities(); };
  $("#selectAllCities").onclick = () => { selectedCities = new Set(availableCities()); updateCityUI(); }; $("#clearCities").onclick = () => { selectedCities.clear(); updateCityUI(); };
  $("#drawBtn").onclick = draw; $("#fitBtn").onclick = fit; $("#reloadMapBtn").onclick = () => { $("#mapMessage").hidden = false; tiles.redraw(); resize(); };
  [0,200,700].forEach(ms => setTimeout(resize, ms)); window.addEventListener("resize", resize); window.addEventListener("orientationchange", () => setTimeout(resize, 300)); document.addEventListener("visibilitychange", () => !document.hidden && setTimeout(resize, 120)); init();
})();
