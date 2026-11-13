import { NasHome } from "./nas-home.js?v=20261113-media2";
import { trips, growth, wishes } from "./data.js";
import { NasGallery } from "./nas-gallery.js?v=20261113-media2";
const $ = (s) => document.querySelector(s),
  main = $("#main"),
  dialog = $("#dialog");
const state = {
  page: "home",
  child: "함께",
  age: "전체",
  tab: "world",
  search: "",
  year: "",
  category: "",
  selected: null,
  galleryView: "sample",
};
let map = null,
  toastTimer,
  revealObserver;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const img = (name, extra = "") =>
  `<img src="assets/${["lake", "beach", "forest", "season"].includes(name) ? name : "season"}.jpg" alt="디자인 확인용 예시 ${name === "beach" ? "해변" : name === "lake" ? "호수" : name === "forest" ? "숲" : "아기 스톡"} 사진" ${extra}>`;
const fmt = (d) => d.replaceAll("-", ".");
const empty = (t) =>
  `<div class="empty">${t}<br><small>다른 조건을 선택하거나 예시 기록을 추가해 보세요.</small></div>`;
const badge = '<span class="eyebrow">SAMPLE STORY · 예시 기록</span>';
function notify(t) {
  $("#toast").textContent = t;
  $("#toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").style.display = "none"), 3000);
}
const nas = new NasGallery({
  notify,
  onHomePhoto: choice => homePhoto.select(choice),
  onState: syncNasChrome,
  onConnected() {
    state.galleryView = "nas";
    if (state.page !== "gallery") location.hash = "nas";
    else render();
  },
});
const homePhoto = new NasHome(nas, notify);
function syncNasChrome() {
  void homePhoto.paint();
  const profile = document.querySelector(".profile");
  profile.classList.toggle("connected", nas.connected);
  profile.querySelector("span").textContent = nas.connected
    ? "NAS 연결됨"
    : nas.restoring
      ? "NAS 재연결 중"
      : "NAS 연결";
  document.querySelector(".demo-banner").innerHTML = nas.connected
    ? "<span>NAS 사진 연결됨</span> 갤러리에서 우리 사진을 보고 홈 대표 사진도 고를 수 있어요. 여행·성장 기록은 계속 예시 모드예요."
    : "<span>예시 모드</span> 여행·성장 기록은 디자인 확인용이에요. NAS 사진은 연결 후 갤러리에서 볼 수 있어요.";
}
function modal(html) {
  $("#dialog-content").innerHTML = html;
  dialog.showModal();
}
function stats() {
  return `<div class="stats"><div><strong>${new Set(trips.map((t) => t.country)).size}</strong><span>예시 방문 국가</span></div><div><strong>${trips.length}</strong><span>예시 여행 기록</span></div><div><strong>${growth.length}</strong><span>예시 성장 기록</span></div><div><strong>${trips.length + growth.length}</strong><span>예시 사진 배치</span></div></div><p class="real-stats">실제 기록: 국가 0 · 도시 0 · 여행 0 · 사진 0 · 영상 0</p>`;
}
function card(r, type) {
  return `<button class="memory" data-action="detail" data-type="${type}" data-id="${r.id}">${img(r.image, 'loading="lazy"')}<h3>${esc(r.title)}</h3><small>${fmt(r.date)} · ${type === "trip" ? esc(r.city) : esc(r.target)} · 예시</small></button>`;
}
function home() {
  main.innerHTML = `<section class="hero">${img("lake", 'fetchpriority="high"')}<div class="hero-copy"><span class="eyebrow">THE DAYS WE KEEP, TOGETHER</span><h1>우리라는<br>이야기<span class="hand"> ♡</span></h1><p>우리가 함께 걸어온 길, 함께 자라온 시간</p><a href="#travel">우리의 추억 산책하기 &nbsp; ↗</a></div><span class="photo-note">풍경 사진 · 디자인 예시</span></section><section><div class="section-head"><div><span class="eyebrow">TWO CHAPTERS, ONE FAMILY</span><h2>우리의 이야기가 쌓이는 곳 <span class="leaf">❧</span></h2></div></div><div class="gateway"><a href="#travel" class="album-card">${img("beach")}<div class="album-caption"><div><span class="eyebrow">01 / TRAVEL DIARY</span><h2>발자국 수집</h2><p>낯선 곳에서도, 함께라서 우리 집</p></div><span class="arrow">↗</span></div></a><a href="#growth" class="album-card">${img("season")}<div class="album-caption"><div><span class="eyebrow">02 / GROWING TOGETHER</span><h2>너희의 모든 계절</h2><p>다온과 라온, 나란히 자라는 시간</p></div><span class="arrow">↗</span></div></a></div></section><section><div class="section-head"><h2>요즘, 우리의 순간들</h2><a href="#gallery">추억 모두 보기 ↗</a></div><div class="recent-grid">${[
    ...trips.map((r) => ({ ...r, type: "trip" })),
    ...growth.map((r) => ({ ...r, type: "growth" })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4)
    .map((r) => card(r, r.type))
    .join("")}</div></section>${stats()}`;
  const shelf=document.createElement("section");
  shelf.className="nas-home-shelf";
  shelf.innerHTML='<span class="eyebrow">OUR PRIVATE PHOTO SHELF</span><h2>사진 한 장에서, 우리 이야기로</h2><p>NAS 사진을 둘러보고 마음에 드는 순간을 홈 대표 사진으로 골라 보세요.</p><a class="primary" href="#nas">우리 사진 보관함 열기 ↗</a>';
  main.querySelector(".hero").after(shelf);
  void homePhoto.paint();
}
function title(eye, title, sub, type) {
  return `<div class="page-title"><div><span class="eyebrow">${eye}</span><h1>${title} <span class="leaf">❧</span></h1><p>${sub}</p></div><button class="primary" data-action="add" data-type="${type}">＋ 예시 기록</button></div>`;
}
function toolbar(kind) {
  const records = kind === "trip" ? trips : growth;
  return `<div class="toolbar"><input id="search" type="search" placeholder="${kind === "trip" ? "여행 제목, 국가, 도시" : "제목, 이야기"} 검색" aria-label="기록 검색" value="${esc(state.search)}"><select id="year" aria-label="연도 필터"><option value="">모든 연도</option>${[
    ...new Set(records.map((x) => x.date.slice(0, 4))),
  ]
    .sort()
    .reverse()
    .map((y) => `<option ${state.year === y ? "selected" : ""}>${y}</option>`)
    .join(
      "",
    )}</select>${kind === "growth" ? `<select id="category" aria-label="카테고리 필터"><option value="">모든 주제</option>${[...new Set(growth.map((x) => x.category))].map((c) => `<option ${state.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>` : ""}</div>`;
}
function tripList() {
  const rows = filteredTrips();
  return rows.length
    ? rows
        .map(
          (t) =>
            `<article class="record-row"><small>${fmt(t.date)}</small>${img(t.image, 'loading="lazy"')}<div><h3>${esc(t.title)}</h3><p>${esc(t.country)} · ${esc(t.city)} · ${esc(t.author)} 작성 · 예시</p></div><button data-action="detail" data-type="trip" data-id="${t.id}">펼쳐보기 ↗</button></article>`,
        )
        .join("")
    : empty("찾는 여행이 없어요.");
}
function filteredTrips() {
  return trips
    .filter(
      (t) =>
        (state.tab !== "korea" || t.country === "대한민국") &&
        (!state.year || t.date.startsWith(state.year)) &&
        `${t.title} ${t.country} ${t.city}`
          .toLowerCase()
          .includes(state.search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
function travel() {
  main.innerHTML =
    title(
      "OUR LITTLE ATLAS",
      "발자국 수집",
      "함께 걸었던 길 위에, 우리의 이야기를 남겨요.",
      "trip",
    ) +
    `<div class="tabs" aria-label="여행 보기">${[
      ["world", "세계지도"],
      ["korea", "국내지도"],
      ["list", "여행기록"],
      ["wish", "버킷리스트"],
    ]
      .map(
        ([id, t]) =>
          `<button class="${state.tab === id ? "selected" : ""}" aria-pressed="${state.tab === id}" data-action="tab" data-value="${id}">${t}</button>`,
      )
      .join(
        "",
      )}</div>${state.tab === "wish" ? `<p class="muted">아직 떠나지 않은 여행, 언젠가 함께할 우리.</p><form id="wish-form" class="toolbar"><input name="title" maxlength="80" required placeholder="가고 싶은 곳을 적어 보세요 (예시)" aria-label="버킷리스트 제목"><button class="primary">＋ 추가</button></form><div class="wish-list">${wishes.map((w) => `<div class="wish-row"><input type="checkbox" aria-label="${esc(w.title)} 완료" data-wish="${w.id}" ${w.done ? "checked" : ""}><label style="${w.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(w.title)} <small>예시</small></label><button data-action="wish-delete" data-id="${w.id}" aria-label="${esc(w.title)} 삭제">×</button></div>`).join("") || empty("꿈꾸는 여행을 추가해 주세요.")}</div>` : `${state.tab !== "list" ? '<div class="map-layout"><div class="map-wrap"><div id="map" aria-label="예시 여행지도"></div><p class="map-hint">핀을 눌러 추억을 열어 보세요. 지도는 드래그·확대할 수 있어요.</p></div><aside id="map-preview" hidden></aside></div>' : ""}${toolbar("trip")}<div id="trip-list" class="record-list">${tripList()}</div>`}`;
  if ($("#map")) initMap();
}
function initMap() {
  if (!window.L) {
    $("#map").innerHTML = empty(
      "지도 라이브러리를 불러오지 못했어요. 아래 목록에서 여행을 볼 수 있어요.",
    );
    return;
  }
  map = L.map("map", { scrollWheelZoom: false, minZoom: 1 }).setView(
    state.tab === "korea" ? [36.4, 127.8] : [34, 52],
    state.tab === "korea" ? 6 : innerWidth <= 600 ? 1 : 2,
  );
  let errors = 0;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  })
    .on("tileerror", () => {
      if (++errors === 3) {
        const el = document.createElement("div");
        el.className = "map-error";
        el.textContent =
          "지도 배경 연결이 원활하지 않아요. 핀과 아래 여행 목록은 이용할 수 있어요.";
        $(".map-wrap").append(el);
      }
    })
    .addTo(map);
  filteredTrips().forEach((t) =>
    L.marker([t.lat, t.lng], {
      title: t.title,
      icon: L.divIcon({
        className: "pin",
        // Leaflet owns the outer element's transform. Draw the upright pin
        // inside it instead of rotating the position-controlled element.
        html: '<svg viewBox="0 0 36 46" aria-hidden="true" focusable="false"><path class="pin-shape" d="M18 44C15 39 2 27 2 18a16 16 0 1 1 32 0c0 9-13 21-16 26Z"/><path class="pin-heart" d="m18 25-6.5-6.2a4 4 0 0 1 5.6-5.7l.9.9.9-.9a4 4 0 0 1 5.6 5.7Z"/></svg>',
        iconSize: [34, 44],
        iconAnchor: [17, 44],
      }),
    })
      .addTo(map)
      .on("click", () => preview(t)),
  );
  if (innerWidth > 600 && filteredTrips()[0]) preview(filteredTrips()[0]);
  setTimeout(() => map?.invalidateSize(), 50);
}
function preview(t) {
  state.selected = t.id;
  const el = $("#map-preview");
  el.hidden = false;
  el.className = "map-preview";
  el.innerHTML = `${innerWidth <= 600 ? '<button class="preview-close" data-action="preview-close" aria-label="미리보기 닫기">×</button>' : ""}${img(t.image)}<h2>${esc(t.title)}</h2><small>${esc(t.country)} · ${esc(t.city)}</small><p>${fmt(t.date)} — ${fmt(t.end)} · 예시</p><button data-action="detail" data-type="trip" data-id="${t.id}">이 여행 펼쳐보기 ↗</button>`;
}
function filteredGrowth() {
  return growth
    .filter(
      (r) =>
        (r.target === state.child ||
          (r.target === "함께" && state.child !== "함께")) &&
        (state.age === "전체" || r.age === state.age) &&
        (!state.year || r.date.startsWith(state.year)) &&
        (!state.category || r.category === state.category) &&
        `${r.title} ${r.body}`.includes(state.search),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}
function growthList() {
  const records = filteredGrowth();
  return records.length
    ? records
        .map(
          (r) =>
            `<article class="record-row"><small>${fmt(r.date)}</small>${img(r.image, 'loading="lazy"')}<div><h3>${esc(r.title)}</h3><p>${esc(r.target)} · ${esc(r.category)} · ${esc(r.author)} 작성 · 예시</p></div><button data-action="detail" data-type="growth" data-id="${r.id}">읽어보기 ↗</button></article>`,
        )
        .join("")
    : empty("이 시기의 예시 기록이 없어요.");
}
function growthPage() {
  let records = filteredGrowth(),
    r = records[0];
  main.innerHTML =
    title(
      "ALL YOUR BEAUTIFUL SEASONS",
      "너희의 모든 계절",
      "다온과 라온, 서로의 곁에서 자라는 소중한 이야기.",
      "growth",
    ) +
    `<div class="chips">${["다온", "라온", "함께"].map((c) => `<button class="${c === state.child ? "selected" : ""}" aria-pressed="${c === state.child}" data-action="child" data-value="${c}">${c === "함께" ? "♡" : "◌"} ${c}</button>`).join("")}</div><div class="growth-spread"><aside class="timeline" aria-label="나이별 타임라인">${[
      ["전체", "모든 계절"],
      ["0~2세", "처음 만난 세상"],
      ["3~5세", "하루하루, 새로운 발견"],
      ["6~8세", "한 뼘 더 넓어진 세상"],
      ["9세 이상", "앞으로의 이야기"],
    ]
      .map(
        ([age, sub]) =>
          `<button data-action="age" data-value="${age}" class="${state.age === age ? "selected" : ""}" aria-pressed="${state.age === age}">${age}<small>${sub}</small></button>`,
      )
      .join(
        "",
      )}</aside><div>${r ? `<div class="scrapbook"><a href="#" class="polaroid" data-action="detail" data-type="growth" data-id="${r.id}">${img(r.image)}<h2>${esc(r.title)}</h2><small>${esc(r.target)} · ${fmt(r.date)} · 예시</small></a><div class="scrap-side">${img(records[1]?.image || "forest")}${img(records[2]?.image || "beach")}<span class="hand muted">나란히, 천천히 ♡</span></div></div><blockquote>“${esc(r.quote || "너희의 오늘을 오래오래 기억할게.")}”</blockquote>` : empty("아직 펼쳐지지 않은 계절이에요.")}</div></div><div class="section-head"><h2>시간을 따라, 한 장씩</h2><small>생년월일 미설정 · 예시 나이 구간</small></div>${toolbar("growth")}<div id="growth-list" class="record-list">${growthList()}</div>`;
}
function gallery() {
  const heading = `<div class="page-title"><div><span class="eyebrow">COLLECTED LITTLE MOMENTS</span><h1>추억의 조각들 <span class="leaf">❧</span></h1><p>한 장의 사진 속에, 그날의 마음이 남아 있어요.</p></div></div>`;
  const sources = `<div class="tabs nas-connection-tabs" aria-label="사진 보관함 선택"><button data-action="gallery-source" data-value="sample" class="${state.galleryView === "sample" ? "selected" : ""}" aria-pressed="${state.galleryView === "sample"}">예시 앨범</button><button data-action="gallery-source" data-value="nas" class="${state.galleryView === "nas" ? "selected" : ""}" aria-pressed="${state.galleryView === "nas"}">NAS 사진</button></div>`;
  if (state.galleryView === "nas") {
    main.innerHTML = heading + sources + '<div id="nas-gallery"></div>';
    nas.mount(document.querySelector("#nas-gallery"));
    return;
  }
  const all = [
    ...trips.map((r) => ({ ...r, type: "trip" })),
    ...growth.map((r) => ({ ...r, type: "growth" })),
  ].filter((r) => !state.category || r.type === state.category);
  main.innerHTML =
    heading +
    sources +
    `<div class="chips">${[
      ["", "전체"],
      ["trip", "여행"],
      ["growth", "성장"],
    ]
      .map(
        ([v, t]) =>
          `<button class="${state.category === v ? "selected" : ""}" data-action="gallery-filter" data-value="${v}">${t}</button>`,
      )
      .join(
        "",
      )}</div><div class="gallery-grid">${all.map((r) => `<button data-action="detail" data-type="${r.type}" data-id="${r.id}">${img(r.image, 'loading="lazy"')}<small>${esc(r.title)} · 예시</small></button>`).join("")}</div>`;
}
function detail(type, id) {
  const r = (type === "trip" ? trips : growth).find((r) => r.id === id);
  if (!r) return;
  modal(
    `${badge}<h2>${esc(r.title)}</h2><small>${fmt(r.date)}${type === "trip" ? " — " + fmt(r.end) : " · " + esc(r.target) + " · " + esc(r.category)} · ${esc(r.author)} 작성</small>${img(r.image, 'class="detail-img"')}<p class="detail-body">${esc(r.body)}</p>${type === "trip" ? `<p class="fine">${esc(r.country)} · ${esc(r.city)}<br>함께한 가족: ${esc(r.members.join(", "))}<br>좌표 ${r.lat}, ${r.lng}</p>` : `${r.quote ? `<blockquote>“${esc(r.quote)}”</blockquote>` : ""}${r.height || r.weight ? `<p>키 ${esc(r.height || "미입력")} cm · 몸무게 ${esc(r.weight || "미입력")} kg</p>` : ""}${r.tripId ? `<button data-action="detail" data-type="trip" data-id="${esc(r.tripId)}">연결된 여행 보기 ↗</button>` : ""}`}<div class="detail-actions"><button data-action="edit" data-type="${type}" data-id="${r.id}">예시 수정</button><button data-action="delete" data-type="${type}" data-id="${r.id}">예시 삭제</button></div><p class="fine">원본 사진과 실제 가족 데이터에 영향을 주지 않는 예시 체험입니다.</p>`,
  );
}
function form(type, id) {
  const r = (type === "trip" ? trips : growth).find((x) => x.id === id) || {};
  const field = (label, name, value = "", props = "") =>
    `<label>${label}<input name="${name}" value="${esc(value)}" ${props}></label>`;
  modal(
    `<span class="eyebrow">TRY A LITTLE STORY</span><h2>예시 ${type === "trip" ? "여행" : "성장"} 기록 ${id ? "수정" : "추가"}</h2><p class="fine">개인정보·실제 사진은 입력하지 마세요. 이 체험의 입력값은 새로고침하면 사라집니다.</p><form id="record-form" data-type="${type}" data-id="${id || ""}" class="form-grid">${field("제목", "title", r.title, 'required maxlength="100"')}${field("날짜", "date", r.date || "2026-11-13", 'type="date" required')}${type === "trip" ? `${field("국가", "country", r.country || "대한민국", 'required maxlength="60"')}${field("도시", "city", r.city, 'required maxlength="60"')}${field("여행 종료일", "end", r.end || r.date || "2026-11-13", 'type="date" required')}${field("위도 (-90~90)", "lat", r.lat ?? 37.4, 'type="number" min="-90" max="90" step="any" required')}${field("경도 (-180~180)", "lng", r.lng ?? 127.1, 'type="number" min="-180" max="180" step="any" required')}<label>동행 가족<input name="members" value="${esc((r.members || ["아빠", "엄마", "다온", "라온"]).join(", "))}" required maxlength="100"></label>` : `<label>기록 대상<select name="target">${["다온", "라온", "함께"].map((c) => `<option ${c === (r.target || state.child) ? "selected" : ""}>${c}</option>`).join("")}</select></label>${field("주제 (자유 입력)", "category", r.category || "일상", 'required maxlength="40"')}<label>나이 구간 (예시)<select name="age">${["0~2세", "3~5세", "6~8세", "9세 이상"].map((a) => `<option ${a === (r.age || "6~8세") ? "selected" : ""}>${a}</option>`).join("")}</select></label>${field("아이들이 남긴 말", "quote", r.quote, 'maxlength="200"')}${field("키 cm (선택)", "height", r.height, 'type="number" min="20" max="250" step="0.1"')}${field("몸무게 kg (선택)", "weight", r.weight, 'type="number" min="1" max="200" step="0.1"')}<label>연결할 여행<select name="tripId"><option value="">연결하지 않음</option>${trips.map((t) => `<option value="${t.id}" ${t.id === r.tripId ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select></label>`}<label>작성자<select name="author">${["아빠", "엄마", "다온", "라온"].map((c) => `<option ${c === r.author ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>예시 대표 사진<select name="image">${[
      ["lake", "호수"],
      ["beach", "바다"],
      ["forest", "숲"],
      ["season", "계절"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${v === r.image ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="full">이야기<textarea name="body" required maxlength="3000">${esc(r.body)}</textarea></label><p id="form-error" class="full fine" role="alert"></p><button class="primary full">예시 기록 ${id ? "수정" : "추가"}하기</button></form>`,
  );
}
function render() {
  homePhoto.release();
  const active = document.activeElement;
  const focusData = main.contains(active)
    ? { domId: active.id, data: { ...active.dataset } }
    : null;
  revealObserver?.disconnect();
  nas.unmount();
  map?.remove();
  map = null;
  document.querySelectorAll("nav a").forEach((a) => {
    a.classList.toggle("active", a.hash === `#${state.page}`);
    if (a.hash === `#${state.page}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  (({ home, travel, growth: growthPage, gallery })[state.page] || home)();
  if (focusData) {
    const target = [...main.querySelectorAll("button, select, input")].find(
      (el) =>
        focusData.domId
          ? el.id === focusData.domId
          : focusData.data.action &&
            el.dataset.action === focusData.data.action &&
            el.dataset.value === focusData.data.value &&
            el.dataset.id === focusData.data.id &&
            el.dataset.type === focusData.data.type,
    );
    target?.focus({ preventScroll: true });
  }
  if (
    state.page === "home" &&
    "IntersectionObserver" in window &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.remove("reveal-pending");
            entry.target.classList.add("reveal-enter");
            revealObserver.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    main.querySelectorAll(".album-card, .memory").forEach((el, i) => {
      el.style.setProperty("--reveal-delay", `${(i % 4) * 45}ms`);
      el.classList.add("reveal-pending");
      revealObserver.observe(el);
    });
  }
}
function route() {
  const page = location.hash.slice(1) || "home";
  if (page === "nas") state.galleryView = "nas";
  state.page =
    page === "nas"
      ? "gallery"
      : ["home", "travel", "growth", "gallery"].includes(page)
        ? page
        : "home";
  state.search = "";
  state.year = "";
  state.category = "";
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
document.querySelector(".skip").addEventListener("click", (e) => {
  e.preventDefault();
  main.focus();
  main.scrollIntoView();
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  e.preventDefault();
  const { action: a, type, id, value } = b.dataset;
  if (a === "close") dialog.close();
  if (a === "nas-settings") nas.settings();
  if (a === "gallery-source") {
    state.galleryView = value === "nas" ? "nas" : "sample";
    render();
  }
  if (a === "about")
    modal(
      '<span class="eyebrow">WELCOME HOME</span><h2>우리 가족을 위한 작은 서랍</h2><p>아빠, 엄마, 다온, 라온이 함께 채워 갈 여행과 성장의 기록입니다.</p><p>여행·성장 기록은 예시입니다. 갤러리에서는 기존 사진 API에 연결하여 NAS 원본을 읽기 전용으로 볼 수 있어요. 가족 계정·초대·공동 작성·영구 저장은 아직 준비 중입니다.</p>',
    );
  if (a === "credits")
    modal(
      '<h2>함께 만든 풍경</h2><p>예시 사진: <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a> (원본 사진 ID와 출처는 저장소 README에 기록).</p><p>지도: Leaflet 1.9.4 (BSD-2-Clause), © OpenStreetMap contributors (ODbL). 지도 타일은 네트워크 연결이 필요하며 오프라인 다운로드를 하지 않습니다.</p>',
    );
  if (a === "detail") {
    if (dialog.open) dialog.close();
    detail(type, id);
  }
  if (a === "add" || a === "edit") {
    if (dialog.open) dialog.close();
    form(type, id);
  }
  if (a === "delete") {
    dialog.close();
    modal(
      `<h2>예시 기록을 삭제할까요?</h2><p>이 페이지의 예시만 삭제됩니다. 새로고침하면 초기 예시로 돌아와요.</p><button class="primary" data-action="confirm-delete" data-type="${type}" data-id="${id}">예시 삭제</button> <button data-action="close">취소</button>`,
    );
  }
  if (a === "confirm-delete") {
    const list = type === "trip" ? trips : growth;
    list.splice(
      list.findIndex((r) => r.id === id),
      1,
    );
    if (type === "trip")
      growth.forEach((r) => {
        if (r.tripId === id) r.tripId = "";
      });
    dialog.close();
    render();
    notify("예시 기록을 삭제했어요.");
  }
  if (a === "tab") {
    state.tab = value;
    state.search = "";
    state.year = "";
    render();
  }
  if (a === "child") {
    state.child = value;
    render();
  }
  if (a === "age") {
    state.age = value;
    render();
  }
  if (a === "gallery-filter") {
    state.category = value;
    render();
  }
  if (a === "preview-close") {
    $("#map-preview").hidden = true;
    $("#map-preview").className = "";
  }
  if (a === "wish-delete") {
    wishes.splice(
      wishes.findIndex((w) => w.id === id),
      1,
    );
    render();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    state.search = e.target.value;
    const el = $("#trip-list") || $("#growth-list");
    if (el) el.innerHTML = state.page === "travel" ? tripList() : growthList();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "year" || e.target.id === "category") {
    state[e.target.id] = e.target.value;
    render();
  }
  if (e.target.dataset.wish) {
    wishes.find((w) => w.id === e.target.dataset.wish).done = e.target.checked;
    render();
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "wish-form") {
    e.preventDefault();
    const title = new FormData(e.target).get("title").trim();
    if (!title) return;
    wishes.push({ id: crypto.randomUUID(), title, done: false });
    render();
    notify("예시 버킷리스트에 추가했어요.");
  }
  if (e.target.id === "record-form") {
    e.preventDefault();
    const f = e.target,
      { type, id } = f.dataset;
    const d = Object.fromEntries(new FormData(f));
    for (const key of ["title", "body", "city", "country", "category"])
      if (key in d && !d[key].trim()) {
        $("#form-error").textContent = "공백 대신 내용을 입력해 주세요.";
        return;
      }
    if (type === "trip" && d.end < d.date) {
      $("#form-error").textContent = "종료일은 시작일보다 빠를 수 없어요.";
      return;
    }
    if (type === "trip") {
      d.lat = Number(d.lat);
      d.lng = Number(d.lng);
      d.members = d.members
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const list = type === "trip" ? trips : growth;
    const now = new Date().toISOString();
    if (id) {
      const i = list.findIndex((r) => r.id === id);
      list[i] = { ...list[i], ...d, updatedAt: now };
    } else
      list.push({
        ...d,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
    dialog.close();
    state.search = "";
    state.year = "";
    state.category = "";
    if (type === "trip" && state.tab === "wish") state.tab = "list";
    if (type === "growth") {
      state.child = d.target;
      state.age = "전체";
    }
    render();
    notify("예시 기록을 반영했어요. 새로고침하면 초기화돼요.");
  }
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
syncNasChrome();
route();
void nas.restoreRemembered();
