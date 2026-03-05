// ======= TAU RK1 CONFIG =======
const SUBMIT_URL = "https://script.google.com/macros/s/AKfycbw0ZNV3J-H_qa3lVMu9EJYPAE4vjGIvfJ21cJNBlWymiXYf35wg62Gr0KIiIYhSoY2VoQ/exec";

// Пән/тест атауы
const QUIZ_TITLE = "TAU 22211-ТАУ Тест 1 (Дәріс 1–6)";

// Топтар тізімі (өзгертесіз)
const GROUPS = [
  "ЭЭк-24-1а",
  "ЭЭк-24-1б",
  "ЭЭк-24-2а",
  "ЭЭк-24-2б",
  "ЭЭк-24-3а",
  "ЭЭк-24-3б",
  "ЭЭк-24-4б",
  "ЭЭк-24-5а",
  "ЭЭк-24-5б",
  "ЭЭк-24-6а",
  "ЭЭк-24-6б",
  "ЭЭк-24-7а",
  "ЭЭк-24-7б"
];

// Сұрақ ережесі: әр студентке кездейсоқ түседі
const QUIZ_RULE = { easy: 10, medium: 7, hard: 8 };

// Таймер (секунд)
const TIME_PER_QUESTION = 30;

// Тесті өту ережелері (қатаң режим)
const STRICT_MODE = {
  // Тест қолжетімді уақыт терезесі (Алматы уақыты бойынша ISO)
  // Мысалы: 2026-03-10T09:00:00+05:00
  windowStart: null,  // "2026-03-06T00:00:00+05:00"
  windowEnd: null,    // "2026-03-06T14:05:00+05:00"

  // Бір студентке бір рет (тәулік ішінде) рұқсат
  oneAttemptPerDay: true,

  // Қойындыдан кетсе/жасырса (alt-tab) — лимит
  maxVisibilityLeaves: 2,

  // Бетті жаңартса/жапса — нәтиже жіберіледі (немесе тоқтатылады)
  submitOnUnload: true
};

// Балл есептеу: 100 / 25 = 4 ұпай
const SCORE_PER_QUESTION = 4;
