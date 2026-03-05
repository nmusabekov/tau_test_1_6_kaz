// ======= TAU RK1 APP (NORMAL / CLEAN) =======
// Works with your current index.html ids:
// quizTitle, fullName, groupSelect, btnStart, btnRules, loginMsg,
// studentLine, timer, progressFill, qIndex, qText, options, btnSkip, quizMsg,
// scoreBig, correctLine, sentLine, btnDownloadJson, btnRestart, resultMsg
//
// Requires config.js to define:
// SUBMIT_URL, QUIZ_TITLE, TIME_PER_QUESTION, GROUPS, QUESTION_BANK, QUIZ_RULE,
// SCORE_PER_QUESTION (usually 4), STRICT_MODE (object)
//
// Apps Script should support JSONP check:
// GET  SUBMIT_URL?mode=check&fullName=...&group=...&callback=cb
// and accept POST text/plain JSON payload for saving result.

(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- Elements ----------
  const screens = {
    login: $("screenLogin"),
    quiz: $("screenQuiz"),
    result: $("screenResult"),
  };

  const els = {
    quizTitle: $("quizTitle"),
    fullName: $("fullName"),
    groupSelect: $("groupSelect"),
    btnStart: $("btnStart"),
    btnRules: $("btnRules"),
    loginMsg: $("loginMsg"),

    studentLine: $("studentLine"),
    timer: $("timer"),
    progressFill: $("progressFill"),
    qIndex: $("qIndex"),
    qText: $("qText"),
    options: $("options"),
    btnSkip: $("btnSkip"),
    quizMsg: $("quizMsg"),

    scoreBig: $("scoreBig"),
    correctLine: $("correctLine"),
    sentLine: $("sentLine"),
    btnDownloadJson: $("btnDownloadJson"),
    btnRestart: $("btnRestart"),
    resultMsg: $("resultMsg"),
  };

  // ---------- Helpers ----------
  function showScreen(name) {
    Object.values(screens).forEach((s) => s && s.classList.add("hidden"));
    screens[name] && screens[name].classList.remove("hidden");
  }

  function setMsg(el, text, kind = "") {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function localDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Shuffle options and keep answer correct (recompute answer index)
  function shuffleOptionsKeepAnswer(q) {
    const tagged = q.options.map((text, idx) => ({ text, idx }));
    const shuffled = shuffleArray(tagged);
    const newAnswer = shuffled.findIndex((x) => x.idx === q.answer);
    return {
      ...q,
      options: shuffled.map((x) => x.text),
      answer: newAnswer,
    };
  }

  function withinWindow() {
    const sm = (typeof STRICT_MODE === "object" && STRICT_MODE) ? STRICT_MODE : {};
    const { windowStart, windowEnd } = sm;
    if (!windowStart && !windowEnd) return { ok: true };

    const t = Date.now();
    const s = windowStart ? Date.parse(windowStart) : -Infinity;
    const e = windowEnd ? Date.parse(windowEnd) : Infinity;

    if (Number.isNaN(s) || Number.isNaN(e)) {
      return { ok: false, msg: "STRICT_MODE.windowStart/windowEnd ISO форматында болуы керек." };
    }
    if (t < s) return { ok: false, msg: "Тест әлі басталған жоқ." };
    if (t > e) return { ok: false, msg: "Тест уақыты аяқталды." };
    return { ok: true };
  }

  // JSONP check to avoid CORS
  function jsonpCheckAttempt(fullName, group) {
    return new Promise((resolve) => {
      const cbName = "tau_cb_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");

      window[cbName] = (res) => {
        try { resolve(res); }
        finally {
          delete window[cbName];
          script.remove();
        }
      };

      let url;
      try {
        url = new URL(SUBMIT_URL);
      } catch (e) {
        resolve({ ok: false, allowed: true, message: "SUBMIT_URL invalid" });
        return;
      }

      url.searchParams.set("mode", "check");
      url.searchParams.set("fullName", fullName);
      url.searchParams.set("group", group);
      url.searchParams.set("callback", cbName);

      script.src = url.toString();
      script.onerror = () => {
        // If check fails, allow start (server will still block duplicate submit if configured)
        resolve({ ok: false, allowed: true });
        script.remove();
        delete window[cbName];
      };

      document.head.appendChild(script);
    });
  }

  // Submit without blocking due to CORS:
  // - First try sendBeacon (best for unload)
  // - Else fetch no-cors (cannot read response)
  function submitNoCors(payload) {
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=utf-8" });
      if (navigator.sendBeacon) {
        return navigator.sendBeacon(SUBMIT_URL, blob);
      }
    } catch (e) { /* ignore */ }

    try {
      fetch(SUBMIT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify(payload) });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- State ----------
  const sm = (typeof STRICT_MODE === "object" && STRICT_MODE) ? STRICT_MODE : {};
  const MAX_LEAVES = Number.isFinite(sm.maxVisibilityLeaves) ? sm.maxVisibilityLeaves : 0;

  let session = null;
  let qList = [];
  let qIndex = 0;
  let timerId = null;
  let timeLeft = (typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30);
  let visibilityLeaves = 0;
  let ended = false;
  let antiTriggered = false;
  let lockKey = null;
  let lockValue = null;

  function resetAll() {
    session = null;
    qList = [];
    qIndex = 0;
    visibilityLeaves = 0;
    ended = false;
    antiTriggered = false;
    lockKey = null;
    lockValue = null;

    if (timerId) { clearInterval(timerId); timerId = null; }
    timeLeft = (typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30);

    // Clear lock if any
    try {
      if (lockKey) localStorage.removeItem(lockKey);
    } catch (e) { /* ignore */ }

    if (els.btnStart) els.btnStart.disabled = false;
  }

  function buildQuiz() {
    const pools = {
      easy: QUESTION_BANK.filter((q) => q.difficulty === "easy"),
      medium: QUESTION_BANK.filter((q) => q.difficulty === "medium"),
      hard: QUESTION_BANK.filter((q) => q.difficulty === "hard"),
    };

    const need = QUIZ_RULE || { easy: 10, medium: 7, hard: 8 };
    if (pools.easy.length < need.easy || pools.medium.length < need.medium || pools.hard.length < need.hard) {
      throw new Error("Сұрақ банкі жеткіліксіз. questions.js файлын кеңейтіңіз.");
    }

    const chosen = [
      ...shuffleArray(pools.easy).slice(0, need.easy),
      ...shuffleArray(pools.medium).slice(0, need.medium),
      ...shuffleArray(pools.hard).slice(0, need.hard),
    ];

    return shuffleArray(chosen).map((q) => ({
      ...q,
      chosenAt: null,
      chosenOption: null,
      isCorrect: null,
      timedOut: false,
      timeUsed: 0,
      _startedAtMs: null,
      _shuffledOnce: false,
    }));
  }

  function lockOptions() {
    if (!els.options) return;
    Array.from(els.options.children).forEach((el) => {
      el.classList.add("disabled");
      el.onclick = null;
    });
  }

  function renderQuestion() {
    const total = qList.length;
    const q = qList[qIndex];

    // Shuffle options ONCE per question (stable)
    if (!q._shuffledOnce) {
      const shuffled = shuffleOptionsKeepAnswer(q);
      q.options = shuffled.options;
      q.answer = shuffled.answer;
      q._shuffledOnce = true;
    }

    if (els.qIndex) els.qIndex.textContent = `${qIndex + 1}/${total}`;
    if (els.qText) els.qText.textContent = q.text || "";

    // progress
    if (els.progressFill) {
      const pct = Math.round((qIndex / total) * 100);
      els.progressFill.style.width = `${pct}%`;
    }

    // options
    if (els.options) {
      els.options.innerHTML = "";
      q.options.forEach((opt, idx) => {
        const div = document.createElement("div");
        div.className = "option";
        div.textContent = opt;
        div.onclick = () => chooseOption(idx);
        els.options.appendChild(div);
      });
    }

    setMsg(els.quizMsg, "");
    timeLeft = (typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30);
    if (els.timer) els.timer.textContent = String(timeLeft);

    if (timerId) clearInterval(timerId);
    const started = Date.now();
    q._startedAtMs = started;

    timerId = setInterval(() => {
      timeLeft -= 1;
      if (els.timer) els.timer.textContent = String(timeLeft);
      if (timeLeft <= 0) {
        clearInterval(timerId);
        timerId = null;
        const used = Math.min((typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30),
                              Math.round((Date.now() - started) / 1000));
        timeoutMove(used);
      }
    }, 1000);
  }

  function recordAnswer(chosenIdx, timedOut = false, usedSec = null) {
    const q = qList[qIndex];
    if (q.chosenOption !== null) return; // already answered

    lockOptions();

    const now = Date.now();
    const T = (typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30);
    const used = usedSec !== null ? usedSec : Math.min(T, Math.round((now - (q._startedAtMs || now)) / 1000));

    q.chosenAt = nowISO();
    q.chosenOption = chosenIdx;
    q.timedOut = timedOut;
    q.timeUsed = used;
    q.isCorrect = (chosenIdx === q.answer);
  }

  function nextQuestion() {
    const total = qList.length;
    if (qIndex >= total - 1) {
      finishQuiz(antiTriggered ? "terminated" : "finished");
      return;
    }
    qIndex += 1;
    renderQuestion();
  }

  function chooseOption(idx) {
    recordAnswer(idx, false, null);
    setTimeout(nextQuestion, 200);
  }

  function timeoutMove(used) {
    recordAnswer(-1, true, used);
    setTimeout(nextQuestion, 200);
  }

  function calcScore() {
    const correct = qList.filter((q) => q.isCorrect).length;
    const per = (typeof SCORE_PER_QUESTION === "number" ? SCORE_PER_QUESTION : 4);
    const score = Math.max(0, Math.min(100, correct * per));
    return { correct, score };
  }

  function buildPayload(status, reason) {
    const { correct, score } = calcScore();

    return {
      type: "TAU_RK1_SUBMIT",
      quizTitle: (typeof QUIZ_TITLE === "string" ? QUIZ_TITLE : "TAU RK1"),
      fullName: session.fullName,
      group: session.group,
      sessionId: session.sessionId,
      dateKey: session.dateKey,
      startedAt: session.startedAt,
      finishedAt: nowISO(),
      correctCount: correct,
      totalQuestions: qList.length,
      score,
      status: status || "finished",
      reason: reason || "",
      visibilityLeaves,
      strictMode: sm,
      answers: qList.map((q) => ({
        id: q.id,
        difficulty: q.difficulty,
        text: q.text,
        options: q.options,
        answer: q.answer,
        chosenOption: q.chosenOption,
        isCorrect: q.isCorrect,
        timedOut: q.timedOut,
        timeUsed: q.timeUsed,
      })),
      userAgent: navigator.userAgent,
    };
  }

  function cleanupAnti() {
    try {
      if (lockKey) localStorage.removeItem(lockKey);
    } catch (e) { /* ignore */ }
  }

  function finishQuiz(status) {
    if (ended) return;
    ended = true;

    if (timerId) { clearInterval(timerId); timerId = null; }
    lockOptions();
    cleanupAnti();

    const reason = antiTriggered ? (session && session.reason ? session.reason : "anti-cheat") : "";
    const payload = buildPayload(status || "finished", reason);
    session.payload = payload;

    const { correct, score } = calcScore();

    // UI result
    showScreen("result");
    if (els.scoreBig) els.scoreBig.textContent = String(score);
    if (els.correctLine) els.correctLine.textContent = `${correct} / ${qList.length}`;
    if (els.sentLine) els.sentLine.textContent = "Жіберілуде…";
    setMsg(els.resultMsg, "");

    // submit (best effort, no-cors)
    const ok = submitNoCors(payload);
    if (ok) {
      if (els.sentLine) els.sentLine.textContent = "Иә";
      setMsg(els.resultMsg, "Нәтиже жіберілді ✅ (егер желі болса, кестеге түседі)", "ok");
    } else {
      if (els.sentLine) els.sentLine.textContent = "Жоқ";
      setMsg(els.resultMsg, "Жіберілмеді. JSON жүктеп алып, кейін жіберуге болады.", "warn");
    }
  }

  function forceTerminate(reasonText) {
    if (!session || ended) return;
    antiTriggered = true;
    session.reason = reasonText || "anti-cheat";
    setMsg(els.quizMsg, "Тест аяқталды: " + session.reason, "warn");
    // Finish quickly
    setTimeout(() => finishQuiz("terminated"), 300);
  }

  // ---------- Anti-cheat guards ----------
  function installGuards() {
    // No back button
    try {
      history.pushState(null, "", location.href);
      window.onpopstate = function () {
        history.pushState(null, "", location.href);
      };
    } catch (e) { /* ignore */ }

    // Visibility / tab switch
    document.addEventListener("visibilitychange", () => {
      if (!session || ended) return;
      if (screens.quiz.classList.contains("hidden")) return;
      if (document.visibilityState === "hidden") {
        visibilityLeaves += 1;
        if (MAX_LEAVES === 0) {
          // strict: any leave ends immediately
          forceTerminate("Қойындыдан шықты/свернул (тыйым салынған)");
        } else if (visibilityLeaves > MAX_LEAVES) {
          forceTerminate("Қойындыдан көп шықты (тыйым салынған)");
        } else {
          setMsg(els.quizMsg, `Ескерту: қойындыдан шығу (${visibilityLeaves}/${MAX_LEAVES}).`, "warn");
        }
      }
    });

    // Alt+Tab / switching apps/windows
    window.addEventListener("blur", () => {
      if (!session || ended) return;
      if (screens.quiz.classList.contains("hidden")) return;
      forceTerminate("Терезеден шықты (Alt+Tab) (тыйым салынған)");
    });

    // Refresh/close
    window.addEventListener("beforeunload", () => {
      if (!session || ended) return;
      if (!sm.submitOnUnload) return;
      // mark terminate and best-effort beacon
      antiTriggered = true;
      session.reason = "Бетті жаңартты/жапты (тыйым салынған)";
      const payload = buildPayload("terminated", session.reason);
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=utf-8" });
        if (navigator.sendBeacon) navigator.sendBeacon(SUBMIT_URL, blob);
      } catch (e) { /* ignore */ }
    });

    // Second tab/session lock
    try {
      lockKey = "TAU_ACTIVE|" + session.fullName.trim().toLowerCase().replace(/\s+/g, " ") + "|" +
                session.group.trim().toLowerCase().replace(/\s+/g, " ");
      lockValue = session.sessionId;

      const existing = localStorage.getItem(lockKey);
      if (existing && existing !== lockValue) {
        // Another active tab already exists
        forceTerminate("Екінші вкладка ашылды (тыйым салынған)");
        return;
      }
      localStorage.setItem(lockKey, lockValue);

      // keep alive
      const ping = setInterval(() => {
        if (ended || !session) { clearInterval(ping); return; }
        try { localStorage.setItem(lockKey, lockValue); } catch (e) {}
      }, 1000);
    } catch (e) { /* ignore */ }
  }

  // ---------- UI ----------
  function populateGroups() {
    if (!els.groupSelect) return;
    els.groupSelect.innerHTML = "";
    (GROUPS || []).forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      els.groupSelect.appendChild(opt);
    });
  }

  function downloadJson() {
    if (!session || !session.payload) return;
    const safeName = String(session.fullName || "student").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    const safeGroup = String(session.group || "group").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    const blob = new Blob([JSON.stringify(session.payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TAU_RK1_${safeGroup}_${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function restart() {
    resetAll();
    if (els.fullName) els.fullName.value = "";
    populateGroups();
    showScreen("login");
    setMsg(els.loginMsg, "");
    setMsg(els.resultMsg, "");
  }

  async function startFlow() {
    const w = withinWindow();
    if (!w.ok) { setMsg(els.loginMsg, w.msg, "warn"); return; }

    const fullName = (els.fullName?.value || "").trim();
    const group = els.groupSelect?.value || "";

    if (fullName.length < 6) { setMsg(els.loginMsg, "ФИО толық енгізіңіз.", "warn"); return; }
    if (!group) { setMsg(els.loginMsg, "Топты таңдаңыз.", "warn"); return; }

    // Disable start button during check
    setMsg(els.loginMsg, "Тексерілуде…");
    if (els.btnStart) els.btnStart.disabled = true;

    // 1) Server-side check: already attempted?
    const check = await jsonpCheckAttempt(fullName, group);
    if (check && check.allowed === false) {
      setMsg(els.loginMsg, "Бұл ФИО және топ бойынша тестті қайта тапсыруға болмайды.", "warn");
      if (els.btnStart) els.btnStart.disabled = false;
      return;
    }

    // 2) Build quiz
    try {
      qList = buildQuiz();
    } catch (e) {
      setMsg(els.loginMsg, e.message || "Сұрақ құру қатесі", "warn");
      if (els.btnStart) els.btnStart.disabled = false;
      return;
    }

    // 3) Session
    session = {
      fullName,
      group,
      sessionId: Math.random().toString(36).slice(2) + "-" + Date.now().toString(36),
      dateKey: localDateKey(),
      startedAt: nowISO(),
      payload: null,
      reason: "",
    };

    // 4) Install guards
    installGuards();

    // 5) Show quiz
    if (els.studentLine) els.studentLine.textContent = `${fullName} • ${group}`;
    showScreen("quiz");
    qIndex = 0;
    ended = false;
    antiTriggered = false;
    renderQuestion();
  }

  // ---------- Bindings ----------
  if (els.btnStart) {
    els.btnStart.addEventListener("click", () => {
      // prevent double click
      if (els.btnStart.disabled) return;
      startFlow();
    });
  }

  if (els.btnSkip) {
    els.btnSkip.addEventListener("click", () => {
      if (ended) return;
      if (!timerId) return;
      clearInterval(timerId);
      timerId = null;
      const q = qList[qIndex];
      const T = (typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30);
      const used = Math.min(T, Math.round((Date.now() - (q._startedAtMs || Date.now())) / 1000));
      timeoutMove(used);
    });
  }

  if (els.btnDownloadJson) els.btnDownloadJson.addEventListener("click", downloadJson);
  if (els.btnRestart) els.btnRestart.addEventListener("click", restart);

  if (els.btnRules) {
    els.btnRules.addEventListener("click", () => {
      alert(
        "Ереже:\n" +
        "• Әр сұраққа 30 секунд.\n" +
        "• Жауап берген соң артқа қайту жоқ.\n" +
        "• Уақыт біткенде келесі сұрақ автоматты ашылады.\n" +
        "• Қойынды/терезеден шықсаңыз тест аяқталуы мүмкін.\n" +
        "• Бір ФИО + топ үшін тест 1 рет қана."
      );
    });
  }

  // ---------- Init ----------
  if (els.quizTitle) els.quizTitle.textContent = (typeof QUIZ_TITLE === "string" ? QUIZ_TITLE : "TAU RK1");
  populateGroups();
  showScreen("login");
})();
