// ======= TAU RK1 APP =======
(function () {
  const $ = (id) => document.getElementById(id);

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
    qDiff: $("qDiff"),
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
    Object.values(screens).forEach((s) => s.classList.add("hidden"));
    screens[name].classList.remove("hidden");
  }

  function setMsg(el, text, kind = "") {
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function localDateKey() {
    // YYYY-MM-DD in local timezone
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function diffLabel(d) {
    if (d === "easy") return "жеңіл";
    if (d === "medium") return "орта";
    return "қиын";
  }

  function withinWindow() {
    const { windowStart, windowEnd } = STRICT_MODE || {};
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

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.message) || txt || "Network error");
    return data || { ok: true, raw: txt };
  }

  // ---------- State ----------
  let session = null;
  let qList = [];
  let qIndex = 0;
  let timer = null;
  let timeLeft = TIME_PER_QUESTION;
  let visibilityLeaves = 0;
  let submitting = false;

  function resetSession() {
    session = null;
    qList = [];
    qIndex = 0;
    timeLeft = TIME_PER_QUESTION;
    visibilityLeaves = 0;
    submitting = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function buildQuiz() {
    const pools = {
      easy: QUESTION_BANK.filter(q => q.difficulty === "easy"),
      medium: QUESTION_BANK.filter(q => q.difficulty === "medium"),
      hard: QUESTION_BANK.filter(q => q.difficulty === "hard"),
    };

    const need = QUIZ_RULE;
    if (pools.easy.length < need.easy || pools.medium.length < need.medium || pools.hard.length < need.hard) {
      throw new Error("Сұрақ банкі жеткіліксіз. questions.js файлын кеңейтіңіз.");
    }

    const chosen = [
      ...shuffle(pools.easy).slice(0, need.easy),
      ...shuffle(pools.medium).slice(0, need.medium),
      ...shuffle(pools.hard).slice(0, need.hard),
    ];

    return shuffle(chosen).map(q => ({
      ...q,
      chosenAt: null,
      chosenOption: null,
      isCorrect: null,
      timedOut: false,
      timeUsed: 0
    }));
  }

  function renderQuestion() {
    const total = qList.length;
    const q = qList[qIndex];

    els.qIndex.textContent = `${qIndex + 1}/${total}`;
    els.qDiff.textContent = diffLabel(q.difficulty);
    els.qText.textContent = q.text;

    // progress
    const pct = Math.round((qIndex / total) * 100);
    els.progressFill.style.width = `${pct}%`;

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
    timeLeft = TIME_PER_QUESTION;
    els.timer.textContent = String(timeLeft);

    if (timer) clearInterval(timer);
    const started = Date.now();
    timer = setInterval(() => {
      timeLeft -= 1;
      els.timer.textContent = String(timeLeft);
      if (timeLeft <= 0) {
        clearInterval(timer);
        timer = null;
        const used = Math.min(TIME_PER_QUESTION, Math.round((Date.now() - started) / 1000));
        timeoutMove(used);
      }
    }, 1000);

    q._startedAtMs = started;
  }

  function lockOptions() {
    Array.from(els.options.children).forEach(el => el.classList.add("disabled"));
    Array.from(els.options.children).forEach(el => el.onclick = null);
  }

  function recordAnswer(chosenIdx, timedOut=false, usedSec=null) {
    const q = qList[qIndex];
    if (q.chosenOption !== null) return; // already answered
    lockOptions();

    const now = Date.now();
    const used = usedSec !== null ? usedSec : Math.min(TIME_PER_QUESTION, Math.round((now - q._startedAtMs) / 1000));
    q.chosenAt = nowISO();
    q.chosenOption = chosenIdx;
    q.timedOut = timedOut;
    q.timeUsed = used;
    q.isCorrect = (chosenIdx === q.answer);
  }

  function nextQuestion() {
    const total = qList.length;
    if (qIndex >= total - 1) {
      finishQuiz();
      return;
    }
    qIndex += 1;
    renderQuestion();
  }

  function chooseOption(idx) {
    recordAnswer(idx, false, null);
    setTimeout(nextQuestion, 250);
  }

  function timeoutMove(used) {
    // record as timed out with null choice (store -1)
    recordAnswer(-1, true, used);
    setTimeout(nextQuestion, 250);
  }

  function calcScore() {
    const correct = qList.filter(q => q.isCorrect).length;
    const score = Math.max(0, Math.min(100, correct * SCORE_PER_QUESTION));
    return { correct, score };
  }

  async function finishQuiz() {
    if (timer) { clearInterval(timer); timer = null; }
    lockOptions();

    const { correct, score } = calcScore();

    const payload = {
      type: "TAU_RK1_SUBMIT",
      quizTitle: QUIZ_TITLE,
      fullName: session.fullName,
      group: session.group,
      sessionId: session.sessionId,
      dateKey: session.dateKey,
      startedAt: session.startedAt,
      finishedAt: nowISO(),
      correctCount: correct,
      totalQuestions: qList.length,
      score,
      visibilityLeaves,
      strictMode: STRICT_MODE,
      answers: qList.map(q => ({
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

    session.payload = payload;

    // UI result first (offline-friendly)
    showScreen("result");
    els.scoreBig.textContent = String(score);
    els.correctLine.textContent = `${correct} / ${qList.length}`;
    els.sentLine.textContent = "Жіберілуде…";
    setMsg(els.resultMsg, "");

    // send to server
    try {
      const data = await postJSON(SUBMIT_URL, payload);
      if (data && data.ok) {
        els.sentLine.textContent = "Иә";
        setMsg(els.resultMsg, "Нәтиже сәтті сақталды ✅", "ok");
      } else {
        els.sentLine.textContent = "Жоқ";
        setMsg(els.resultMsg, "Жауап сақталмады. JSON жүктеп алып, кейін жіберуге болады.", "warn");
      }
    } catch (e) {
      els.sentLine.textContent = "Жоқ";
      setMsg(els.resultMsg, "Желі қателігі. JSON жүктеп алып, кейін жіберуге болады.", "warn");
    }
  }

  async function checkAttemptLock(fullName, group) {
    // Ask server if attempt already exists (if enabled)
    if (!STRICT_MODE.oneAttemptPerDay) return { ok: true };
    try {
      const data = await postJSON(SUBMIT_URL, {
        type: "TAU_RK1_CHECK",
        fullName,
        group,
        dateKey: localDateKey()
      });
      // expects {ok:true, allowed:true/false, message:""}
      if (data && data.ok && data.allowed === false) return { ok: false, msg: data.message || "Бүгін бұл ФИО үшін тест тапсырылған." };
      return { ok: true };
    } catch (e) {
      // If server not reachable, allow but warn
      return { ok: true, warn: "Серверге тексеру мүмкін болмады. Тест басталады, бірақ желі тұрақты болғаны дұрыс." };
    }
  }

  function installNoBack() {
    // Prevent back navigation
    history.pushState(null, "", location.href);
    window.onpopstate = function () {
      history.pushState(null, "", location.href);
    };
  }

  function installUnloadGuard() {
    window.addEventListener("beforeunload", (e) => {
      if (!session) return;
      if (!STRICT_MODE.submitOnUnload) return;
      // attempt to submit on unload (best effort)
      if (!submitting && screens.quiz && !screens.quiz.classList.contains("hidden")) {
        submitting = true;
        try { navigator.sendBeacon(SUBMIT_URL, JSON.stringify({ type:"TAU_RK1_BEACON", payload: session.payload || null, note:"beforeunload" })); } catch (err) {}
      }
      e.preventDefault();
      e.returnValue = "";
    });
  }

  function installVisibilityGuard() {
    document.addEventListener("visibilitychange", () => {
      if (!session) return;
      if (screens.quiz.classList.contains("hidden")) return;
      if (document.visibilityState === "hidden") {
        visibilityLeaves += 1;
        if (visibilityLeaves > (STRICT_MODE.maxVisibilityLeaves || 0)) {
          // force finish
          if (timer) { clearInterval(timer); timer = null; }
          setMsg(els.quizMsg, "Қойындыдан көп рет шықтыңыз. Тест аяқталды.", "warn");
          setTimeout(finishQuiz, 500);
        } else {
          setMsg(els.quizMsg, `Ескерту: қойындыдан шығу (${visibilityLeaves}/${STRICT_MODE.maxVisibilityLeaves}).`, "warn");
        }
      }
    });
  }

  // ---------- UI bindings ----------
  function populateGroups() {
    els.groupSelect.innerHTML = "";
    GROUPS.forEach(g => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      els.groupSelect.appendChild(opt);
    });
  }

  async function startQuiz() {
    const w = withinWindow();
    if (!w.ok) { setMsg(els.loginMsg, w.msg, "warn"); return; }

    const fullName = (els.fullName.value || "").trim();
    const group = els.groupSelect.value;

    if (fullName.length < 6) { setMsg(els.loginMsg, "ФИО толық енгізіңіз.", "warn"); return; }
    if (!group) { setMsg(els.loginMsg, "Топты таңдаңыз.", "warn"); return; }

    setMsg(els.loginMsg, "Тексерілуде…");
    els.btnStart.disabled = true;

    const lock = await checkAttemptLock(fullName, group);
    if (!lock.ok) {
      setMsg(els.loginMsg, lock.msg, "warn");
      els.btnStart.disabled = false;
      return;
    }
    if (lock.warn) setMsg(els.loginMsg, lock.warn, "warn");
    else setMsg(els.loginMsg, "");

    try {
      qList = buildQuiz();
    } catch (e) {
      setMsg(els.loginMsg, e.message || "Сұрақ құру қатесі", "warn");
      els.btnStart.disabled = false;
      return;
    }

    session = {
      fullName,
      group,
      sessionId: Math.random().toString(36).slice(2) + "-" + Date.now().toString(36),
      dateKey: localDateKey(),
      startedAt: nowISO(),
      payload: null
    };

    // install guards
    installNoBack();
    installUnloadGuard();
    installVisibilityGuard();

    els.studentLine.textContent = `${fullName} • ${group}`;
    showScreen("quiz");
    qIndex = 0;
    renderQuestion();
  }

  function downloadJson() {
    if (!session || !session.payload) return;
    const blob = new Blob([JSON.stringify(session.payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `TAU_RK1_${session.group}_${session.fullName.replace(/\s+/g,"_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function restart() {
    resetSession();
    els.fullName.value = "";
    populateGroups();
    showScreen("login");
    setMsg(els.loginMsg, "");
    setMsg(els.resultMsg, "");
  }

  // buttons
  els.btnStart.addEventListener("click", startQuiz);
  els.btnSkip.addEventListener("click", () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    const used = Math.min(TIME_PER_QUESTION, Math.round((Date.now() - qList[qIndex]._startedAtMs) / 1000));
    timeoutMove(used);
  });
  els.btnDownloadJson.addEventListener("click", downloadJson);
  els.btnRestart.addEventListener("click", restart);

  els.btnRules.addEventListener("click", () => {
    alert(
      "Ереже:\n" +
      "• Әр сұраққа 30 секунд.\n" +
      "• Жауап берген соң артқа қайту жоқ.\n" +
      "• Уақыт біткенде келесі сұрақ автоматты ашылады.\n" +
      "• Қойындыдан көп шықсаңыз тест аяқталуы мүмкін."
    );
  });

  // init
  els.quizTitle.textContent = QUIZ_TITLE;
  populateGroups();
  showScreen("login");
})();
