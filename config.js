// ======= TAU RK1 CONFIG =======
const SUBMIT_URL = "PASTE_YOUR_APPS_SCRIPT_WEBAPP_URL_HERE";

// Пән/тест атауы
const QUIZ_TITLE = "ТАУ — Рубежный контроль 1 (Дәріс 1–6)";

// Топтар тізімі (өзгертесіз)
const GROUPS = [
  "ТАУ-221",
  "ТАУ-222",
  "ТАУ-223",
  "АУЭС-TAU-1",
  "АУЭС-TAU-2"
];

// Сұрақ ережесі: әр студентке кездейсоқ түседі
const QUIZ_RULE = { easy: 10, medium: 7, hard: 8 };

// Таймер (секунд)
const TIME_PER_QUESTION = 30;

// Тесті өту ережелері (қатаң режим)
const STRICT_MODE = {
  // Тест қолжетімді уақыт терезесі (Алматы уақыты бойынша ISO)
  // Мысалы: 2026-03-10T09:00:00+05:00
  windowStart: null,  // "2026-03-10T09:00:00+05:00"
  windowEnd: null,    // "2026-03-10T12:00:00+05:00"

  // Бір студентке бір рет (тәулік ішінде) рұқсат
  oneAttemptPerDay: true,

  // Қойындыдан кетсе/жасырса (alt-tab) — лимит
  maxVisibilityLeaves: 2,

  // Бетті жаңартса/жапса — нәтиже жіберіледі (немесе тоқтатылады)
  submitOnUnload: true
};

// Балл есептеу: 100 / 25 = 4 ұпай
const SCORE_PER_QUESTION = 4;
