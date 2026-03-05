(function () {
  const $ = (id) => document.getElementById(id);

  // --------- Screens / Elements ----------
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

  // перемешать варианты и пересчитать индекс правильного ответа
  function shuffleOptionsKeepAnswer(q) {
    const tagged = q.options.map((text, idx) => ({ text, idx }));
    const shuffled = shuffleArray(tagged);
    const newAnswer = shuffled.findIndex((x) => x.idx === q.answer);
    return { ...q, options: shuffled.map((x) => x.text), answer: newAnswer };
  }

  // --------- STRICT window (optional) ----------
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

  // --------- JSONP check (no CORS) ----------
  function jsonpCheckAttempt(fullName, group, dateKey) {
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

      const url = new URL(SUBMIT_URL);
      url.searchParams.set("mode", "check");
      url.searchParams.set("fullName", fullName);
      url.searchParams.set("group", group);
      url.searchParams.set("dateKey", dateKey);
      url.searchParams.set("callback", cbName);

      script.src = url.toString();
      script.onerror = () => {
        // если check не сработал — позволим начать, но сервер заблокирует при submit
        resolve({ ok: false, allowed: true, hash: "" });
        script.remove();
        delete window[cbName];
      };

      document.head.appendChild(script);
    });
  }

  // submit: no-cors/beacon (ответ не читаем)
  function submitNoCors(payload) {
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=utf-8" });
      if (navigator.sendBeacon) return navigator.sendBeacon(SUBMIT_URL, blob);
    } catch (e) {}
    try {
      fetch(SUBMIT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify(payload) });
      return true;
    } catch (e) {
      return false;
    }
  }

  // --------- State ----------
  const sm = (typeof STRICT_MODE === "object" && STRICT_MODE) ? STRICT_MODE : {};
  const TIME = (typeof TIME_PER_QUESTION === "number" ? TIME_PER_QUESTION : 30);
  const SCORE_PER = (typeof SCORE_PER_QUESTION === "number" ? SCORE_PER_QUESTION : 4);

  let session = null;
  let qList = [];
  let qIndex = 0;
  let timerId = null;
  let timeLeft = TIME;

  let ended = false;
  let antiTriggered = false;
  let antiReason = "";

  // second tab lock
  let lockKey = null;
  let lockValue = null;
  let lockPing = null;

  function resetAll() {
    session = null;
    qList = [];
    qIndex = 0;
    ended = false;
    antiTriggered = false;
    antiReason = "";

    if (timerId) { clearInterval(timerId); timerId = null; }
    timeLeft = TIME;

    try {
      if (lockPing) clearInterval(lockPing);
      lockPing = null;
      if (lockKey) localStorage.removeItem(lockKey);
    } catch (e) {}

    lockKey = null;
    lockValue = null;

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

    // shuffle options only once per question (stable)
    if (!q._shuffledOnce) {
      const shuffled = shuffleOptionsKeepAnswer(q);
      q.options = shuffled.options;
      q.answer = shuffled.answer;
      q._shuffledOnce = true;
    }

    if (els.qIndex) els.qIndex.textContent = `${qIndex + 1}/${total}`;
    if (els.qText) els.qText.textContent = q.text || "";

    if (els.progressFill) {
      const pct = Math.round((qIndex / total) * 100);
      els.progressFill.style.width = `${pct}%`;
    }

    // options
    els.options.innerHTML = "";
    q.options.forEach((opt, idx) => {
      const div = document.createElement("div");
      div.className = "option";
      div.textContent = opt;
      div.onclick = () => chooseOption(idx);
      els.options.appendChild(div);
    });

    setMsg(els.quizMsg, "");
    timeLeft = TIME;
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
        const used = Math.min(TIME, Math.round((Date.now() - started) / 1000));
        timeoutMove(used);
      }
    }, 1000);
  }

  function recordAnswer(chosenIdx, timedOut = false, usedSec = null) {
    const q = qList[qIndex];
    if (q.chosenOption !== null) return;

    lockOptions();

    const now = Date.now();
    const used = usedSec !== null ? usedSec : Math.min(TIME, Math.round((now - (q._startedAtMs || now)) / 1000));
    q.chosenAt = nowISO();
    q.chosenOption = chosenIdx;
    q.timedOut = timedOut;
    q.timeUsed = used;
    q.isCorrect = (chosenIdx === q.answer);
  }

  function nextQuestion() {
    if (qIndex >= qList.length - 1) {
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
    const score = Math.max(0, Math.min(100, correct * SCORE_PER));
    return { correct, score };
  }

  function buildPayload(status, reason) {
    const { correct, score } = calcScore();
    return {
      type: "TAU_RK1_SUBMIT",
      quizTitle: QUIZ_TITLE,
      fullName: session.fullName,
      group: session.group,
      dateKey: session.dateKey,
      attemptHash: session.attemptHash || "",
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      finishedAt: nowISO(),
      correctCount: correct,
      totalQuestions: qList.length,
      score,
      status: status || "finished",
      reason: reason || "",
      answers: qList.map((q) => ({
        id: q.id,
        difficulty: q.difficulty,
        text: q.text,
        options: q.options,
        answer: q.answer,
        chosenOption: q.chosenOption,
        isCorrect: q.isCorrect,
        timedOut: q.timedOut,
        timeUsed: q.timeUsed
      })),
      userAgent: navigator.userAgent
    };
  }

  function finishQuiz(status) {
    if (ended) return;
    ended = true;

    if (timerId) { clearInterval(timerId); timerId = null; }
    lockOptions();

    // release second-tab lock
    try {
      if (lockPing) clearInterval(lockPing);
      lockPing = null;
      if (lockKey) localStorage.removeItem(lockKey);
    } catch (e) {}

    const reason = antiTriggered ? antiReason : "";
    const payload = buildPayload(status || "finished", reason);

    // UI
    showScreen("result");
    const { correct, score } = calcScore();
    if (els.scoreBig) els.scoreBig.textContent = String(score);
    if (els.correctLine) els.correctLine.textContent = `${correct} / ${qList.length}`;
    if (els.sentLine) els.sentLine.textContent = "Жіберілуде…";
    setMsg(els.resultMsg, "");

    // submit (no CORS)
    submitNoCors(payload);

    // confirm saved via JSONP check: если allowed=false => попытка уже записана (значит сохранилось)
    setTimeout(async () => {
      try {
        const confirm = await jsonpCheckAttempt(session.fullName, session.group, session.dateKey);
        if (confirm && confirm.allowed === false) {
          if (els.sentLine) els.sentLine.textContent = "Иә";
          setMsg(els.resultMsg, "Нәтиже сәтті сақталды ✅");
        } else {
          if (els.sentLine) els.sentLine.textContent = "Жоқ";
          setMsg(els.resultMsg, "Жауап сақталмады. JSON жүктеп алып, кейін жіберуге болады.");
        }
      } catch {
        if (els.sentLine) els.sentLine.textContent = "Жоқ";
        setMsg(els.resultMsg, "Желі қателігі. JSON жүктеп алып, кейін жіберуге болады.");
      }
    }, 1200);
  }

  // --------- Anti-cheat: terminate immediately ----------
  function terminateNow(reasonText) {
    if (!session || ended) return;
    antiTriggered = true;
    antiReason = reasonText || "anti-cheat";
    setMsg(els.quizMsg, "Тест аяқталды: " + antiReason, "warn");
    setTimeout(() => finishQuiz("terminated"), 250);
  }

  function installGuards() {
    // prevent back
    try {
      history.pushState(null, "", location.href);
      window.onpopstate = () => history.pushState(null, "", location.href);
    } catch (e) {}

    // tab hide/switch => terminate
    document.addEventListener("visibilitychange", () => {
      if (!session || ended) return;
      if (screens.quiz.classList.contains("hidden")) return;
      if (document.visibilityState === "hidden") {
        terminateNow("Қойындыдан шықты/свернул (тыйым салынған)");
      }
    });

    // Alt+Tab / switch window => terminate
    window.addEventListener("blur", () => {
      if (!session || ended) return;
      if (screens.quiz.classList.contains("hidden")) return;
      terminateNow("Терезеден шықты (Alt+Tab) (тыйым салынған)");
    });

    // refresh/close => mark terminate + beacon best effort
    window.addEventListener("beforeunload", () => {
      if (!session || ended) return;
      antiTriggered = true;
      antiReason = "Бетті жаңартты/жапты (тыйым салынған)";
      const payload = buildPayload("terminated", antiReason);
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=utf-8" });
        if (navigator.sendBeacon) navigator.sendBeacon(SUBMIT_URL, blob);
      } catch (e) {}
    });

    // second tab lock (same fullName+group+date)
    try {
      lockKey = "TAU_LOCK|" + session.fullName.toLowerCase().replace(/\s+/g, " ").trim()
        + "|" + session.group.toLowerCase().replace(/\s+/g, " ").trim()
        + "|" + session.dateKey;
      lockValue = session.sessionId;

      const existing = localStorage.getItem(lockKey);
      if (existing && existing !== lockValue) {
        terminateNow("Екінші вкладка ашылды (тыйым салынған)");
        return;
      }
      localStorage.setItem(lockKey, lockValue);

      lockPing = setInterval(() => {
        if (ended || !session) { clearInterval(lockPing); return; }
        try { localStorage.setItem(lockKey, lockValue); } catch (e) {}
      }, 1000);
    } catch (e) {}
  }

  // --------- UI ----------
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
    if (!session) return;
    const payload = buildPayload(antiTriggered ? "terminated" : "finished", antiReason);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TAU_RK1_${session.group}_${session.fullName.replace(/\s+/g, "_")}.json`;
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
    const dateKey = localDateKey();

    if (fullName.length < 6) { setMsg(els.loginMsg, "ФИО толық енгізіңіз.", "warn"); return; }
    if (!group) { setMsg(els.loginMsg, "Топты таңдаңыз.", "warn"); return; }

    setMsg(els.loginMsg, "Тексерілуде…");
    if (els.btnStart) els.btnStart.disabled = true;

    // daily lock check
    const check = await jsonpCheckAttempt(fullName, group, dateKey);
    if (check && check.allowed === false) {
      setMsg(els.loginMsg, "Бүгін бұл ФИО және топ бойынша тест қайта тапсырылмайды.", "warn");
      if (els.btnStart) els.btnStart.disabled = false;
      return;
    }

    // build quiz
    try {
      qList = buildQuiz();
    } catch (e) {
      setMsg(els.loginMsg, e.message || "Сұрақ құру қатесі", "warn");
      if (els.btnStart) els.btnStart.disabled = false;
      return;
    }

    session = {
      fullName,
      group,
      dateKey,
      attemptHash: (check && check.hash) ? check.hash : "",
      sessionId: Math.random().toString(36).slice(2) + "-" + Date.now().toString(36),
      startedAt: nowISO(),
    };

    ended = false;
    antiTriggered = false;
    antiReason = "";

    installGuards();

    if (els.studentLine) els.studentLine.textContent = `${fullName} • ${group}`;
    showScreen("quiz");
    qIndex = 0;
    renderQuestion();
  }

  // --------- Bindings ----------
  if (els.btnStart) {
    els.btnStart.addEventListener("click", () => {
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
      const used = Math.min(TIME, Math.round((Date.now() - (q._startedAtMs || Date.now())) / 1000));
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
        "• Қойынды/терезеден шықсаңыз немесе жаңартсаңыз — тест аяқталады.\n" +
        "• Бір күнде (ФИО+топ) тест 1 рет қана."
      );
    });
  }

  // --------- Init ----------
  if (els.quizTitle) els.quizTitle.textContent = QUIZ_TITLE;
  populateGroups();
  showScreen("login");
})();
