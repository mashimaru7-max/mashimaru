(function () {
  "use strict";

  var SAVE_KEY = "duckmagochi_live_v1";
  var TEST_KEY = "duckmagochi_admin_test_v1";
  var TICK_MINUTES = 5;
  var TICK_MS = TICK_MINUTES * 60 * 1000;
  var STAGES = [
    { name: "알", xp: 0, age: 0, care: 0 },
    { name: "아기오리", xp: 15, age: 20, care: 0 },
    { name: "꼬마오리", xp: 120, age: 2880, care: 55 },
    { name: "멋쟁이오리", xp: 350, age: 7200, care: 65 },
    { name: "하얀오리", xp: 800, age: 14400, care: 75 }
  ];
  var PERSONALITIES = {
    playful: { name: "장난꾸러기", icon: "⚽" },
    foodie: { name: "먹보", icon: "🍪" },
    clean: { name: "깔끔이", icon: "🫧" },
    sleepy: { name: "잠꾸러기", icon: "🌙" }
  };
  var SHOP_ITEMS = [
    { id: "medicine", name: "튼튼 약", icon: "💊", price: 25, type: "consumable" },
    { id: "mint-room", name: "민트빛 방", icon: "🌿", price: 120, type: "room", value: "mint" },
    { id: "night-room", name: "별밤 방", icon: "🌙", price: 180, type: "room", value: "night" },
    { id: "cap", name: "노란 모자", icon: "🧢", price: 100, type: "accessory" },
    { id: "crown", name: "꼬마 왕관", icon: "👑", price: 250, type: "accessory" },
    { id: "flower", name: "꽃 장식", icon: "🌼", price: 140, type: "accessory" }
  ];
  var els = {};
  var state;
  var adminMode = false;
  var speed = 1;
  var toastTimer;
  var speechTimer;
  var actionLocks = {};
  var shopTab = "shop";

  function $(id) { return document.getElementById(id); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function now() { return Date.now(); }

  function defaultState() {
    return {
      schemaVersion: 1,
      petId: "duck-" + now().toString(36),
      petName: "덕이",
      stage: 1,
      personality: ["playful", "foodie", "clean", "sleepy"][Math.floor(Math.random() * 4)],
      bornAt: now(),
      ageMinutes: 0,
      lastSavedAt: now(),
      tickRemainderMs: 0,
      status: { hunger: 20, mood: 80, cleanliness: 90, energy: 80, health: 100, bond: 10, growthXp: 0 },
      isSleeping: false,
      sleepMinutes: 0,
      isSick: false,
      riskMinutes: 0,
      recoveryMinutes: 0,
      poops: [],
      digestionQueue: [],
      treatCount: 0,
      care: { sum: 0, count: 0, sampleRemainder: 0 },
      coins: 50,
      medicine: 2,
      inventory: [],
      equipped: { room: "default", accessory: null },
      daily: { dateKey: "", claimed: false, streak: 0, lastClaimDate: "", actions: { feed: false, play: false, wash: false }, questRewards: [] },
      logs: [],
      lastPetAt: 0,
      lastActionAt: {},
      settings: { sound: true, reducedMotion: false },
      updatedAt: now()
    };
  }

  function normalize(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    Object.keys(raw).forEach(function (key) { base[key] = raw[key]; });
    base.status = Object.assign(defaultState().status, raw.status || {});
    base.settings = Object.assign(defaultState().settings, raw.settings || {});
    base.care = Object.assign({ sum: 0, count: 0, sampleRemainder: 0 }, raw.care || {});
    base.daily = Object.assign(defaultState().daily, raw.daily || {});
    base.daily.actions = Object.assign({ feed: false, play: false, wash: false }, (raw.daily && raw.daily.actions) || {});
    base.equipped = Object.assign({ room: "default", accessory: null }, raw.equipped || {});
    base.inventory = Array.isArray(raw.inventory) ? raw.inventory : [];
    base.logs = Array.isArray(raw.logs) ? raw.logs.slice(-100) : [];
    base.medicine = Math.max(0, Number(base.medicine) || 0);
    base.poops = Array.isArray(raw.poops) ? raw.poops.slice(0, 3) : [];
    base.digestionQueue = Array.isArray(raw.digestionQueue) ? raw.digestionQueue : [];
    base.stage = clamp(Number(base.stage) || 1, 1, 5);
    Object.keys(base.status).forEach(function (key) {
      if (key === "growthXp" || key === "bond") base.status[key] = Math.max(0, Number(base.status[key]) || 0);
      else base.status[key] = clamp(Number(base.status[key]) || 0, key === "health" ? 10 : 0, 100);
    });
    return base;
  }

  function readSave(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw) return normalize(JSON.parse(raw));
    } catch (error) {
      try {
        var backup = localStorage.getItem(key + "_backup");
        if (backup) {
          showToast("저장 오류를 복구했어!");
          return normalize(JSON.parse(backup));
        }
      } catch (ignored) {}
    }
    return defaultState();
  }

  function save() {
    var key = adminMode ? TEST_KEY : SAVE_KEY;
    state.updatedAt = now();
    try {
      var previous = localStorage.getItem(key);
      if (previous) localStorage.setItem(key + "_backup", previous);
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      showToast("저장 공간이 부족해. 설정을 확인해줘.");
    }
  }

  function dateKey(timestamp) {
    var d = new Date(timestamp || now());
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function yesterdayKey() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return dateKey(d.getTime());
  }

  function ensureDaily() {
    var today = dateKey();
    if (state.daily.dateKey === today) return;
    if (state.daily.dateKey && state.care.count > 0 && careScore() >= 70) {
      state.coins += 15;
      addLog("daily", "전날 돌봄 점수 70 이상 +15코인");
    }
    state.daily.dateKey = today;
    state.daily.claimed = false;
    state.daily.actions = { feed: false, play: false, wash: false };
    state.daily.questRewards = [];
    state.treatCount = 0;
    state.care = { sum: 0, count: 0, sampleRemainder: 0 };
  }

  function claimDaily() {
    ensureDaily();
    if (state.daily.claimed) return showToast("오늘 선물은 이미 받았어.");
    if (state.daily.lastClaimDate === yesterdayKey()) state.daily.streak += 1;
    else if (state.daily.lastClaimDate !== dateKey()) state.daily.streak = 1;
    state.daily.lastClaimDate = dateKey();
    state.daily.claimed = true;
    state.coins += 10;
    addLog("daily", "출석 보상 +10코인");
    save(); render(); showToast("오늘의 선물 10코인!");
  }

  function recordDailyAction(action) {
    ensureDaily();
    if (!Object.prototype.hasOwnProperty.call(state.daily.actions, action)) return;
    state.daily.actions[action] = true;
    if (state.daily.questRewards.indexOf(action) < 0) {
      state.daily.questRewards.push(action);
      state.coins += 3;
      showToast("첫 " + ({ feed: "식사", play: "놀이", wash: "목욕" }[action]) + " 보너스 +3코인");
    }
  }

  function addLog(type, message, before, after) {
    if (!state.logs) state.logs = [];
    state.logs.push({
      at: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type: type,
      message: message,
      before: before || null,
      after: after || null
    });
    state.logs = state.logs.slice(-100);
  }

  function careScore() {
    if (state.care.count > 0) return state.care.sum / state.care.count;
    var s = state.status;
    return (100 - s.hunger) * .25 + s.mood * .25 + s.cleanliness * .2 + s.energy * .15 + s.health * .15;
  }

  function offlineRate(realElapsedMs) {
    var hours = realElapsedMs / 3600000;
    if (hours <= 8) return 1;
    if (hours <= 24) return (8 + (hours - 8) * .5) / hours;
    if (hours <= 72) return (8 + 16 * .5 + (hours - 24) * .25) / hours;
    return (8 + 16 * .5 + 48 * .25) / hours;
  }

  function settle(currentTime, forcedMinutes) {
    var elapsed = Math.max(0, Math.min(7 * 86400000, currentTime - state.lastSavedAt));
    var simulatedMs;
    if (typeof forcedMinutes === "number") {
      simulatedMs = forcedMinutes * 60000;
    } else {
      var activeSpeed = adminMode ? speed : 1;
      var rate = elapsed > 60000 ? offlineRate(elapsed) : 1;
      simulatedMs = elapsed * activeSpeed * rate + state.tickRemainderMs;
    }
    var ticks = Math.floor(simulatedMs / TICK_MS);
    state.tickRemainderMs = simulatedMs % TICK_MS;
    if (ticks > 0) simulateTicks(ticks);
    state.lastSavedAt = currentTime;
    return { elapsed: elapsed, ticks: ticks };
  }

  function simulateTicks(ticks) {
    for (var i = 0; i < ticks; i += 1) {
      state.ageMinutes += TICK_MINUTES;
      if (state.isSleeping) {
        state.status.hunger += TICK_MINUTES / 90;
        state.status.cleanliness -= TICK_MINUTES / 150;
        state.status.energy += TICK_MINUTES / (state.personality === "sleepy" ? 5.4 : 6);
        state.sleepMinutes += TICK_MINUTES;
        if (state.sleepMinutes >= 480) {
          state.isSleeping = false;
          state.sleepMinutes = 0;
        }
      } else {
        state.status.hunger += TICK_MINUTES / 30;
        state.status.cleanliness -= TICK_MINUTES / 45;
        state.status.energy -= TICK_MINUTES / 20;
        state.status.mood -= TICK_MINUTES / 60;
      }
      processDigestion();
      applyRisk(TICK_MINUTES);
      sampleCare(TICK_MINUTES);
      boundStatus();
    }
  }

  function processDigestion() {
    var remaining = [];
    state.digestionQueue.forEach(function (item) {
      if (item.dueAge <= state.ageMinutes && state.poops.length < 3) {
        state.poops.push({ id: item.id, bornAtAge: state.ageMinutes });
        state.status.cleanliness -= 8;
      } else if (item.dueAge > state.ageMinutes) {
        remaining.push(item);
      }
    });
    state.digestionQueue = remaining;
    if (state.poops.length) {
      state.status.cleanliness -= state.poops.length * TICK_MINUTES / 60;
      if (state.poops.length >= 2) {
        state.status.cleanliness -= 2 * TICK_MINUTES / 60;
        state.status.mood -= TICK_MINUTES / 60;
      }
    }
  }

  function riskPoints() {
    var s = state.status;
    var points = 0;
    if (s.hunger >= 90) points += 2;
    if (s.cleanliness <= 15) points += 2;
    if (s.energy <= 10) points += 1;
    if (state.poops.length === 2) points += 1;
    if (state.poops.length >= 3) points += 2;
    return points;
  }

  function applyRisk(minutes) {
    var s = state.status;
    if (state.stage === 1) {
      state.isSick = false;
      state.riskMinutes = 0;
      s.health = 100;
      return;
    }
    if (s.hunger >= 70) s.mood -= (s.hunger >= 90 ? 3 : 2) * minutes / 60;
    if (s.cleanliness <= 35) s.mood -= (s.cleanliness <= 15 ? 2 : 1) * minutes / 60;
    if (!state.isSleeping && s.energy <= 10) s.mood -= 3 * minutes / 60;
    if (s.hunger >= 90) s.health -= minutes / 60;
    if (s.cleanliness <= 15) s.health -= minutes / 60;
    if (!state.isSleeping && s.energy <= 10) s.health -= minutes / 60;

    var risk = riskPoints();
    if (risk >= 5) state.riskMinutes += minutes * 3;
    else if (risk >= 3) state.riskMinutes += minutes;
    else state.riskMinutes = 0;
    if (state.riskMinutes >= 180) state.isSick = true;

    if (state.isSick && state.isSleeping && s.hunger < 50 && s.cleanliness > 60) {
      s.health += minutes / 60;
      if (risk === 0 && s.health >= 60) state.recoveryMinutes += minutes;
      else state.recoveryMinutes = 0;
      if (state.recoveryMinutes >= 120) {
        state.isSick = false;
        state.riskMinutes = 0;
        state.recoveryMinutes = 0;
        s.mood += 5;
      }
    }
  }

  function sampleCare(minutes) {
    state.care.sampleRemainder += minutes;
    while (state.care.sampleRemainder >= 10) {
      var s = state.status;
      var sample = (100 - s.hunger) * .25 + s.mood * .25 + s.cleanliness * .2 + s.energy * .15 + s.health * .15;
      state.care.sum += clamp(sample, 0, 100);
      state.care.count += 1;
      state.care.sampleRemainder -= 10;
      if (state.care.count > 720) {
        state.care.sum *= 719 / 720;
        state.care.count = 719;
      }
    }
  }

  function boundStatus() {
    var s = state.status;
    s.hunger = clamp(s.hunger, 0, 100);
    s.mood = clamp(s.mood, adminMode ? 0 : 5, 100);
    s.cleanliness = clamp(s.cleanliness, 0, 100);
    s.energy = clamp(s.energy, 0, 100);
    s.health = clamp(s.health, 10, 100);
    s.bond = Math.max(0, s.bond);
    s.growthXp = Math.max(0, s.growthXp);
  }

  function canGrow() {
    if (state.stage >= 5) return false;
    var next = STAGES[state.stage];
    if (state.stage === 1) return state.status.growthXp >= next.xp;
    return state.ageMinutes >= next.age && state.status.growthXp >= next.xp && careScore() >= next.care && !state.isSick;
  }

  function applyGrowth() {
    var wasEgg = state.stage === 1;
    state.stage += 1;
    if (wasEgg) {
      state.isSick = false;
      state.riskMinutes = 0;
      state.status.health = 100;
    }
    state.status.mood = 100;
    state.status.bond += 5;
    state.coins += state.stage * 20;
    addLog("growth", STAGES[state.stage - 1].name + " 성장");
  }

  function doGrow() {
    if (!canGrow()) return;
    applyGrowth();
    save();
    render();
    react("짜잔! " + STAGES[state.stage - 1].name + "(으)로 성장했어!", true);
  }

  function autoHatchIfReady() {
    if (state.stage !== 1 || state.status.growthXp < STAGES[1].xp) return false;
    applyGrowth();
    save();
    setTimeout(function () { react("똑똑… 알에서 아기오리가 깨어났어!", true); }, 0);
    return true;
  }

  function locked(name, ms) {
    if (actionLocks[name] && now() - actionLocks[name] < ms) return true;
    actionLocks[name] = now();
    return false;
  }

  function act(type) {
    settle(now());
    var s = state.status;
    if (state.isSleeping && type !== "sleep") return react("새근새근… 자고 있어.");
    if (locked(type, type === "play" ? 1000 : 350)) return;
    var before = clone(s);
    var completed = false;

    if (type === "feed") {
      if (s.hunger <= 10) return react("배가 빵빵해!");
      s.hunger -= 18; s.mood += 2; s.cleanliness -= 2; s.growthXp += 3;
      if (state.personality === "foodie") s.bond += 1;
      state.digestionQueue.push({ id: "dig-" + now(), dueAge: state.ageMinutes + 45 + Math.floor(Math.random() * 10) * 5 });
      recordDailyAction("feed"); completed = true;
      react("냠냠! 맛있어!");
    }
    if (type === "play") {
      if (s.energy < 15) return react("조금 쉬고 싶어…");
      s.mood += state.isSick ? 7 : (state.personality === "playful" ? 16 : 14); s.energy -= 8; s.cleanliness -= 4; s.bond += 2;
      s.growthXp += state.isSick ? 2.5 : 5; state.coins += 2;
      recordDailyAction("play"); completed = true;
      react(state.isSick ? "오늘은 살살 놀아줘…" : "한 번 더! 신난다!");
    }
    if (type === "wash") {
      if (s.cleanliness >= 85) return react("지금도 뽀송뽀송해!");
      s.cleanliness += 45; s.energy -= 3; s.growthXp += 4;
      s.mood += state.personality === "clean" ? 5 : -2;
      recordDailyAction("wash"); completed = true;
      react("뽀득뽀득 개운해!");
    }
    if (type === "treat") {
      if (s.hunger <= 5) return react("간식도 더는 못 먹겠어!");
      s.hunger -= 6; s.mood += state.treatCount < 5 ? 8 : 0; s.health -= 1; s.growthXp += 2;
      state.treatCount += 1;
      if (state.treatCount % 3 === 0) state.digestionQueue.push({ id: "treat-" + now(), dueAge: state.ageMinutes + 60 });
      completed = true; react(state.treatCount > 5 ? "오늘 간식은 충분한 것 같아." : "바삭바삭 최고!");
    }
    if (type === "water") {
      s.hunger -= 3; s.health += 1; s.growthXp += 1;
      completed = true; react("꿀꺽! 시원해!");
    }
    if (type === "medicine") {
      if (!state.isSick) return react("지금은 약이 필요 없을 만큼 건강해!");
      if (state.medicine <= 0) return react("약이 없어. 상점에서 준비해줘!");
      if (state.lastActionAt.medicine && now() - state.lastActionAt.medicine < 6 * 3600000) return react("약은 조금 뒤에 다시 먹을 수 있어.");
      state.medicine -= 1; s.health += 20; s.mood -= 3; state.lastActionAt.medicine = now();
      completed = true; react("으으, 쓰지만 힘이 나는 것 같아!");
    }
    if (type === "sleep") {
      state.isSleeping = !state.isSleeping;
      completed = true;
      if (state.isSleeping) {
        state.sleepMinutes = 0;
        react("잘 자… 내일 또 놀자.");
      } else {
        if (state.sleepMinutes < 30) s.mood -= 2;
        state.sleepMinutes = 0;
        react("좋은 아침!");
      }
    }
    boundStatus();
    if (completed) addLog("action", type, before, clone(s));
    save();
    render();
  }

  function pet() {
    if (state.isSleeping) return react("새근새근…");
    if (now() - state.lastPetAt < 30000) return react("헤헤, 간지러워!");
    state.lastPetAt = now();
    state.status.mood = clamp(state.status.mood + 5, 0, 100);
    state.status.bond += 1;
    state.status.growthXp += 1;
    save();
    react("손길이 좋아!");
    render();
  }

  function cleanPoop(id) {
    var before = state.poops.length;
    state.poops = state.poops.filter(function (item) { return item.id !== id; });
    if (state.poops.length < before) {
      state.status.cleanliness = clamp(state.status.cleanliness + 8, 0, 100);
      state.status.growthXp += 2;
      state.coins += 1;
      addLog("clean", "배설물 1개 치움");
      save();
      react("깨끗해졌어!");
      render();
    }
  }

  function cleanAllPoop() {
    if (!state.poops.length) return react("지금 방은 깨끗해!");
    var count = state.poops.length;
    state.poops = [];
    state.status.cleanliness = clamp(state.status.cleanliness + 8 * count, 0, 100);
    state.status.growthXp += 2 * count;
    state.coins += count;
    addLog("clean", "배설물 " + count + "개 치움");
    save(); render(); react("방이 반짝반짝 깨끗해졌어!");
  }

  function owns(item) {
    return state.inventory.indexOf(item.id) >= 0;
  }

  function buyOrEquip(itemId) {
    var item = SHOP_ITEMS.find(function (candidate) { return candidate.id === itemId; });
    if (!item) return;
    if (item.type === "consumable") {
      if (state.coins < item.price) return showToast("코인이 부족해.");
      state.coins -= item.price; state.medicine += 1;
      addLog("shop", "약 1개 구매");
      save(); render(); showToast("튼튼 약을 샀어!");
      return;
    }
    if (!owns(item)) {
      if (state.coins < item.price) return showToast("코인이 부족해.");
      state.coins -= item.price;
      state.inventory.push(item.id);
      addLog("shop", item.name + " 구매");
    }
    if (item.type === "room") state.equipped.room = state.equipped.room === item.value ? "default" : item.value;
    if (item.type === "accessory") state.equipped.accessory = state.equipped.accessory === item.id ? null : item.id;
    save(); render(); renderShop(); showToast(item.name + (owns(item) ? " 적용 완료!" : " 구매 완료!"));
  }

  function renderShop() {
    if (!els.shopGrid) return;
    els.shopCoins.textContent = "🪙 " + state.coins;
    els.shopGrid.innerHTML = "";
    var items = SHOP_ITEMS.filter(function (item) {
      return shopTab === "shop" || item.type === "consumable" || owns(item);
    });
    if (!items.length) {
      els.shopGrid.innerHTML = '<p class="modal-help">아직 가진 꾸미기 아이템이 없어.</p>';
      return;
    }
    items.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "shop-item";
      var owned = owns(item);
      var equipped = (item.type === "room" && state.equipped.room === item.value) || (item.type === "accessory" && state.equipped.accessory === item.id);
      var actionText = item.type === "consumable" ? item.price + "코인" : equipped ? "해제" : owned ? "사용" : item.price + "코인";
      card.innerHTML = '<span class="item-icon">' + item.icon + '</span><strong>' + item.name + '</strong><button type="button" data-buy="' + item.id + '">' + actionText + '</button>';
      card.querySelector("button").addEventListener("click", function () { buyOrEquip(item.id); });
      els.shopGrid.appendChild(card);
    });
  }

  function meter(bar, text, value, reverse) {
    var shown = Math.round(value);
    text.textContent = shown;
    bar.style.width = shown + "%";
    var quality = reverse ? 100 - value : value;
    bar.style.background = quality < 25 ? "#e45d5d" : quality < 55 ? "#f2b84b" : "#72c99f";
  }

  function render() {
    autoHatchIfReady();
    var s = state.status;
    meter(els.hungerBar, els.hungerText, s.hunger, true);
    meter(els.moodBar, els.moodText, s.mood, false);
    meter(els.cleanBar, els.cleanText, s.cleanliness, false);
    meter(els.energyBar, els.energyText, s.energy, false);
    meter(els.healthBar, els.healthText, s.health, false);
    var sleepSuffix = state.isSleeping && state.stage > 1 ? "-sleep" : "";
    els.petImage.src = "./assets/stage-" + state.stage + sleepSuffix + ".png?v=6";
    els.petImage.alt = state.stage + "단계 " + STAGES[state.stage - 1].name;
    els.stageName.textContent = state.stage + "단계 · " + STAGES[state.stage - 1].name;
    var next = state.stage < 5 ? STAGES[state.stage] : STAGES[4];
    if (state.stage >= 5) {
      els.xpLabel.textContent = "최종 성장 완료";
    } else if (s.growthXp < next.xp) {
      els.xpLabel.textContent = "성장 " + Math.floor(s.growthXp) + " / " + next.xp;
    } else if (state.ageMinutes < next.age) {
      els.xpLabel.textContent = "성장 시간 " + Math.floor(state.ageMinutes / 60) + " / " + Math.floor(next.age / 60) + "시간";
    } else if (careScore() < next.care) {
      els.xpLabel.textContent = "돌봄 점수 " + Math.floor(careScore()) + " / " + next.care;
    } else {
      els.xpLabel.textContent = "성장 준비 완료";
    }
    els.xpBar.style.width = state.stage < 5 ? clamp(s.growthXp / next.xp * 100, 0, 100) + "%" : "100%";
    els.growBtn.classList.toggle("hidden", !canGrow());
    els.sleepGlow.classList.toggle("hidden", !state.isSleeping);
    els.sleepLabel.textContent = state.isSleeping ? "깨우기" : "잠자기";
    els.testBadge.classList.toggle("hidden", !adminMode);
    els.stageSelect.value = String(state.stage);
    document.body.classList.toggle("reduced-motion", !!state.settings.reducedMotion);
    els.soundToggle.checked = !!state.settings.sound;
    els.motionToggle.checked = !!state.settings.reducedMotion;
    els.soundBtn.textContent = state.settings.sound ? "🔊" : "🔇";
    els.dayLabel.textContent = "함께한 " + Math.max(1, Math.floor(state.ageMinutes / 1440) + 1) + "일";
    var personality = PERSONALITIES[state.personality] || PERSONALITIES.playful;
    els.personalityBadge.textContent = personality.icon + " " + personality.name;
    els.coinBadge.textContent = "🪙 " + state.coins;
    els.roomCard.dataset.theme = state.equipped.room || "default";
    var accessory = SHOP_ITEMS.find(function (item) { return item.id === state.equipped.accessory; });
    els.accessoryLayer.textContent = accessory ? accessory.icon : "";
    els.treatCount.textContent = "오늘 " + state.treatCount + "/5";
    els.medicineCount.textContent = state.medicine + "개";
    els.poopCount.textContent = state.poops.length ? state.poops.length + "개" : "깨끗함";
    ensureDaily();
    renderDots();
    renderPoops();
    renderDaily();
    renderShop();
    updateAdminUI();
  }

  function renderDaily() {
    if (!els.questList) return;
    els.streakText.textContent = "연속 " + Math.max(1, state.daily.streak || 1) + "일째";
    els.dailyRewardText.textContent = state.daily.claimed ? "오늘 선물 받음 ✓" : "🪙 10 받기";
    els.claimDailyBtn.disabled = state.daily.claimed;
    els.claimDailyBtn.textContent = state.daily.claimed ? "완료" : "받기";
    var labels = { feed: "오늘 첫 식사", play: "오늘 첫 놀이", wash: "오늘 첫 목욕" };
    els.questList.innerHTML = "";
    Object.keys(labels).forEach(function (key) {
      var done = !!state.daily.actions[key];
      var row = document.createElement("div");
      row.className = "quest " + (done ? "done" : "");
      row.innerHTML = "<span>" + (done ? "✅ " : "⬜ ") + labels[key] + "</span><span>" + (done ? "+3 받음" : "+3 코인") + "</span>";
      els.questList.appendChild(row);
    });
  }

  function renderDots() {
    els.stageDots.innerHTML = "";
    STAGES.forEach(function (stage, index) {
      var dot = document.createElement("span");
      dot.className = "stage-dot " + (index + 1 < state.stage ? "done" : index + 1 === state.stage ? "current" : "");
      dot.textContent = index + 1 + " " + stage.name;
      els.stageDots.appendChild(dot);
    });
  }

  function renderPoops() {
    els.poopArea.innerHTML = "";
    state.poops.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "poop-btn";
      button.textContent = "💩";
      button.setAttribute("aria-label", "배설물 치우기");
      button.addEventListener("click", function () { cleanPoop(item.id); });
      els.poopArea.appendChild(button);
    });
  }

  function react(message, strong) {
    els.speech.textContent = message;
    els.petButton.classList.remove("react");
    void els.petButton.offsetWidth;
    els.petButton.classList.add("react");
    clearTimeout(speechTimer);
    speechTimer = setTimeout(function () {
      els.speech.textContent = idleMessage();
    }, strong ? 5000 : 2600);
    playSound(strong ? 720 : 520);
    showToast(message);
  }

  function playSound(frequency) {
    if (!state.settings.sound) return;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.18, ctx.currentTime + .09);
      gain.gain.setValueAtTime(.045, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .13);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .14);
      osc.onended = function () { ctx.close(); };
    } catch (ignored) {}
  }

  function idleMessage() {
    var s = state.status;
    if (state.isSleeping) return "새근새근…";
    if (state.isSick || s.health <= 40) return "오늘은 조금 아파…";
    if (s.hunger >= 70) return "배에서 꼬르륵 소리가 나.";
    if (s.cleanliness <= 35) return "씻으면 뽀송해질 것 같아!";
    if (s.energy <= 25) return "슬슬 졸려…";
    if (s.mood <= 30) return "같이 놀아줄래?";
    return ["오늘도 같이 놀자!", "덕마고치 최고!", "날 쓰다듬어줘!", "우리 방 예쁘지?"][Math.floor(Math.random() * 4)];
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2200);
  }

  function enterAdmin() {
    if (!adminMode) {
      save();
      var testRaw = localStorage.getItem(TEST_KEY);
      state = testRaw ? readSave(TEST_KEY) : clone(readSave(SAVE_KEY));
      state.lastSavedAt = now();
      adminMode = true;
      speed = 1;
      save();
    }
    render();
    els.adminDialog.showModal();
    showToast("테스트 저장칸으로 전환했어.");
  }

  function exitAdmin() {
    save();
    adminMode = false;
    speed = 1;
    state = readSave(SAVE_KEY);
    state.lastSavedAt = now();
    render();
    els.adminDialog.close();
    showToast("본게임으로 돌아왔어.");
  }

  function updateAdminUI() {
    document.querySelectorAll("[data-speed]").forEach(function (button) {
      button.classList.toggle("active", Number(button.dataset.speed) === speed);
    });
    if (els.speedNote) els.speedNote.textContent = "실제 1분 = 게임 " + speed + "분";
    if (!els.adminSliders) return;
    els.adminSliders.querySelectorAll("[data-stat]").forEach(function (input) {
      input.value = Math.round(state.status[input.dataset.stat]);
      var output = els.adminSliders.querySelector('[data-out="' + input.dataset.stat + '"]');
      if (output) output.textContent = input.value;
    });
    els.sickToggle.checked = !!state.isSick;
    els.eventLog.textContent = state.logs.length ? state.logs.slice(-20).reverse().map(function (log) {
      return log.at + " [" + log.type + "] " + log.message;
    }).join("\n") : "기록 없음";
  }

  function runSelfTests() {
    var original = clone(state);
    var checks = [];
    function check(name, condition) { checks.push({ name: name, ok: !!condition }); }
    try {
      check("수치 상한", clamp(120, 0, 100) === 100);
      check("수치 하한", clamp(-1, 0, 100) === 0);
      state = defaultState();
      var hungerBefore = state.status.hunger;
      simulateTicks(1);
      check("5분 배고픔 계산", Math.abs(state.status.hunger - hungerBefore - TICK_MINUTES / 30) < .001);
      state = defaultState();
      state.isSleeping = true;
      var energyBefore = state.status.energy;
      simulateTicks(1);
      check("수면 체력 회복", state.status.energy > energyBefore);
      state.status.health = -20;
      boundStatus();
      check("건강 최저 10", state.status.health === 10);
      check("72시간 이후 정지", Math.abs(offlineRate(80 * 3600000) - .35) < .001);
      state = defaultState();
      state.ageMinutes = 0; state.status.growthXp = 15;
      check("알 자동부화 조건", canGrow());
      state = defaultState();
      state.stage = 2;
      state.status.hunger = 95; state.status.cleanliness = 10;
      simulateTicks(36);
      check("질병 위험 누적", state.isSick);
    } finally {
      state = original;
    }
    var passed = checks.filter(function (test) { return test.ok; }).length;
    els.selfTestResult.textContent = checks.map(function (test) { return (test.ok ? "✅ " : "❌ ") + test.name; }).join("\n") + "\n\n" + passed + "/" + checks.length + " 통과";
    render();
    showToast(passed === checks.length ? "자동 점검 전부 통과!" : "실패 항목을 확인해줘.");
  }

  function bind() {
    document.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () { act(button.dataset.action); });
    });
    els.petButton.addEventListener("click", pet);
    els.cleanAllBtn.addEventListener("click", cleanAllPoop);
    els.growBtn.addEventListener("click", doGrow);
    els.settingsBtn.addEventListener("click", function () { els.settingsDialog.showModal(); });
    els.dailyBtn.addEventListener("click", function () { renderDaily(); els.dailyDialog.showModal(); });
    els.shopBtn.addEventListener("click", function () { shopTab = "shop"; renderShop(); els.shopDialog.showModal(); });
    els.claimDailyBtn.addEventListener("click", claimDaily);
    document.querySelectorAll("[data-shop-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        shopTab = button.dataset.shopTab;
        document.querySelectorAll("[data-shop-tab]").forEach(function (tab) { tab.classList.toggle("active", tab === button); });
        renderShop();
      });
    });
    els.soundBtn.addEventListener("click", function () { state.settings.sound = !state.settings.sound; save(); render(); });
    els.soundToggle.addEventListener("change", function () { state.settings.sound = this.checked; save(); render(); });
    els.motionToggle.addEventListener("change", function () { state.settings.reducedMotion = this.checked; save(); render(); });
    els.adminEntryBtn.addEventListener("click", function () {
      els.settingsDialog.close();
      enterAdmin();
    });
    document.querySelectorAll("[data-close]").forEach(function (button) {
      button.addEventListener("click", function () { $(button.dataset.close).close(); });
    });
    document.querySelectorAll("[data-speed]").forEach(function (button) {
      button.addEventListener("click", function () {
        speed = Number(button.dataset.speed);
        state.lastSavedAt = now();
        updateAdminUI();
        showToast(speed + "배속 적용");
      });
    });
    document.querySelectorAll("[data-advance]").forEach(function (button) {
      button.addEventListener("click", function () {
        var minutes = Number(button.dataset.advance);
        settle(now(), minutes);
        save();
        render();
        showToast("게임 시간 " + (minutes >= 1440 ? minutes / 1440 + "일" : minutes >= 60 ? minutes / 60 + "시간" : minutes + "분") + " 이동");
      });
    });
    els.stageSelect.addEventListener("change", function () {
      state.stage = Number(this.value);
      var req = STAGES[state.stage - 1];
      state.ageMinutes = Math.max(state.ageMinutes, req.age);
      state.status.growthXp = Math.max(state.status.growthXp, req.xp);
      save(); render(); react(req.name + " 단계로 변경했어.");
    });
    els.adminSliders.querySelectorAll("[data-stat]").forEach(function (input) {
      input.addEventListener("input", function () {
        state.status[input.dataset.stat] = Number(input.value);
        addLog("admin", input.dataset.stat + "=" + input.value);
        save(); render();
      });
    });
    els.sickToggle.addEventListener("change", function () {
      state.isSick = this.checked;
      state.riskMinutes = this.checked ? 180 : 0;
      addLog("admin", this.checked ? "질병 상태 켬" : "질병 상태 해제");
      save(); render();
    });
    els.clearLogBtn.addEventListener("click", function () { state.logs = []; save(); render(); });
    els.selfTestBtn.addEventListener("click", runSelfTests);
    els.exitAdminBtn.addEventListener("click", exitAdmin);
    els.resetTestBtn.addEventListener("click", function () {
      if (!confirm("관리자 테스트 저장칸만 초기화할까? 본게임은 그대로 유지돼.")) return;
      localStorage.removeItem(TEST_KEY);
      state = clone(readSave(SAVE_KEY));
      state.lastSavedAt = now();
      save(); render(); showToast("테스트 저장칸을 초기화했어.");
    });
    els.resetBtn.addEventListener("click", function () {
      if (!confirm("정말 덕이를 처음부터 다시 키울까? 이 작업은 되돌릴 수 없어.")) return;
      localStorage.removeItem(adminMode ? TEST_KEY : SAVE_KEY);
      state = defaultState();
      save(); render(); els.settingsDialog.close(); showToast("새로운 알과 다시 시작했어.");
    });
    window.addEventListener("storage", function (event) {
      if (!adminMode && event.key === SAVE_KEY && event.newValue) showToast("다른 창에서 게임 상태가 바뀌었어.");
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) save();
      else { settle(now()); save(); render(); }
    });
    window.addEventListener("beforeunload", save);
  }

  function registerWebMCP() {
    var context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    try {
      context.registerTool({
        name: "read_duck_status",
        title: "덕마고치 상태 확인",
        description: "현재 오리의 성장 단계와 배고픔, 기분, 청결, 체력을 확인합니다.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: function () {
          return {
            stage: state.stage,
            stageName: STAGES[state.stage - 1].name,
            hunger: Math.round(state.status.hunger),
            mood: Math.round(state.status.mood),
            cleanliness: Math.round(state.status.cleanliness),
            energy: Math.round(state.status.energy),
            sleeping: state.isSleeping,
            sick: state.isSick
          };
        }
      });
      context.registerTool({
        name: "care_for_duck",
        title: "덕마고치 돌보기",
        description: "화면의 돌보기 버튼과 똑같이 밥, 놀이, 씻기기, 잠자기 행동을 한 번 실행합니다.",
        inputSchema: {
          type: "object",
          properties: { action: { type: "string", enum: ["feed", "play", "wash", "sleep"] } },
          required: ["action"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: function (input) {
          if (!input || ["feed", "play", "wash", "sleep"].indexOf(input.action) < 0) {
            throw new Error("지원하지 않는 돌보기 행동입니다.");
          }
          act(input.action);
          return { ok: true, action: input.action, stage: state.stage };
        }
      });
    } catch (error) {
      console.warn("WebMCP registration unavailable", error);
    }
  }

  function cacheElements() {
    ["hungerText","hungerBar","moodText","moodBar","cleanText","cleanBar","energyText","energyBar","healthText","healthBar",
      "petImage","petButton","speech","sleepGlow","poopArea","stageName","xpLabel","xpBar","stageDots","growBtn","roomCard",
      "personalityBadge","coinBadge","accessoryLayer","treatCount","medicineCount","poopCount","cleanAllBtn",
      "sleepLabel","dayLabel","testBadge","toast","settingsBtn","soundBtn","dailyBtn","shopBtn","settingsDialog","soundToggle","motionToggle",
      "adminEntryBtn","resetBtn",
      "adminDialog","speedButtons","speedNote","stageSelect","adminSliders","sickToggle","eventLog","clearLogBtn","selfTestBtn","selfTestResult","exitAdminBtn","resetTestBtn",
      "dailyDialog","streakText","dailyRewardText","claimDailyBtn","questList","shopDialog","shopCoins","shopGrid",
      "returnDialog","returnSummary"
    ].forEach(function (id) { els[id] = $(id); });
  }

  function start() {
    cacheElements();
    state = readSave(SAVE_KEY);
    var previousSave = state.lastSavedAt;
    var beforeStatus = clone(state.status);
    var beforePoops = state.poops.length;
    var result = settle(now());
    ensureDaily();
    bind();
    registerWebMCP();
    render();
    els.speech.textContent = idleMessage();
    save();
    if (result.elapsed >= 30 * 60000 && previousSave) {
      var hours = result.elapsed / 3600000;
      var label = hours < 1 ? Math.floor(hours * 60) + "분" : hours < 24 ? hours.toFixed(1) + "시간" : Math.floor(hours / 24) + "일";
      var hungerDelta = Math.max(0, Math.round(state.status.hunger - beforeStatus.hunger));
      var newPoops = Math.max(0, state.poops.length - beforePoops);
      els.returnSummary.textContent = label + " 동안 기다렸어. 배고픔 +" + hungerDelta + ", 새 배설물 " + newPoops + "개. 지금 같이 돌봐주자!";
      els.returnDialog.showModal();
    }
    setInterval(function () {
      settle(now());
      save();
      render();
    }, 1000);
  }

  start();
}());
