export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN is missing", { status: 500 });
    }

    if (request.method === "GET") {
      return new Response("Bot is running.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const update = await request.json().catch(() => null);

    if (!update) {
      return new Response("Bad request", { status: 400 });
    }

    try {
      if (update.message) {
        await handleMessage(update.message, env);
      } else if (update.callback_query) {
        await handleCallback(update.callback_query, env);
      }
    } catch (error) {
      console.error("Unhandled error:", error);
    }

    return new Response("ok");
  },
};

/* ============================================
   D1 Analytics Logic
   جدول users باید در کنسول D1 ساخته شده باشد
============================================ */
async function trackUser(user, env, source = "interaction") {
  if (!user?.id || !env.DB) return;

  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `
      INSERT INTO users (
        id, first_name, last_name, username, language_code,
        is_premium, first_seen_at, last_seen_at, last_action
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        username = excluded.username,
        language_code = excluded.language_code,
        is_premium = excluded.is_premium,
        last_seen_at = excluded.last_seen_at,
        last_action = excluded.last_action
    `
    )
      .bind(
        user.id,
        user.first_name || "",
        user.last_name || "",
        user.username || "",
        user.language_code || "",
        user.is_premium ? 1 : 0,
        now,
        now,
        source
      )
      .run();
  } catch (e) {
    console.error("D1 Track Error:", e);
  }
}

/* =========================
   In-memory user states
========================= */

const userStates = new Map();

/* =========================
   Static texts
========================= */

const SUPPORT_TEXT = `چنانچه با استفاده از راهنماهای موجود در ربات مشکل شما برطرف نشده است، لطفاً سؤال یا مشکل خود را تایپ کرده و ارسال کنید.

تیم پشتیبانی حداکثر در همان روز به پرسش شما پاسخ خواهد داد.

توجه داشته باشید که پاسخ تیم پشتیبانی از طریق همین ربات برای شما ارسال خواهد شد.`;

const CAFE_NET_TEXT = `در صورتی‌که با استفاده از آموزش‌های تصویری موفق به انجام امور دانشجویی خود نشدید، تیم کافی‌نت ما آماده است تا با کمترین قیمت و بهترین کیفیت، کار شما را انجام دهد.

لطفاً کار موردنظر را در قالب یک پیام ارسال نمایید.`;

const TUITION_FAQ_IV_URL =
  "https://telegra.ph/%D9%BE%D8%B1%D8%B3%D8%B4%E2%80%8C%D9%87%D8%A7%DB%8C-%D9%85%D8%AA%D8%AF%D8%A7%D9%88%D9%84-%D9%BE%D8%B1%D8%AF%D8%A7%D8%AE%D8%AA-%D8%B4%D9%87%D8%B1%DB%8C%D9%87-%D8%AF%D8%A7%D9%86%D8%B4%DA%AF%D8%A7%D9%87-%D9%BE%DB%8C%D8%A7%D9%85-%D9%86%D9%88%D8%B1-08-21";

const TUITION_DISCOUNTS_IV_URL =
  "https://telegra.ph/%D8%AA%D8%AE%D9%81%DB%8C%D9%81%E2%80%8C%D9%87%D8%A7-%D9%88-%D8%AD%D9%85%D8%A7%DB%8C%D8%AA%E2%80%8C%D9%87%D8%A7%DB%8C-%D9%88%DB%8C%DA%98%D9%87-%D8%AF%D8%A7%D9%86%D8%B4%D8%AC%D9%88%DB%8C%D8%A7%D9%86-%D8%AF%D8%A7%D9%86%D8%B4%DA%AF%D8%A7%D9%87-%D9%BE%DB%8C%D8%A7%D9%85-%D9%86%D9%88%D8%B1-08-21";

const TUITION_GUIDE_TEXT = `🎓 <b>راهنمای پرداخت شهریه دانشگاه پیام نور</b>

دانشگاه پیام نور از جمله دانشگاه‌های شهریه‌پرداز است و دانشجویان برای انجام امور آموزشی مانند <b>ثبت‌نام، انتخاب واحد، شرکت در امتحانات و دریافت کارت ورود به جلسه</b> موظف‌اند شهریه خود را در موعد مقرر پرداخت کنند.

💰 <b>انواع شهریه</b>

1️⃣ <b>شهریه ثابت</b>
شهریه ثابت مبلغی مشخص است که در ابتدای هر نیم‌سال تحصیلی برای همه دانشجویان آن مقطع و رشته تعیین می‌شود. این مبلغ معمولاً باید <b>قبل از آغاز انتخاب واحد</b> پرداخت شود تا منوی انتخاب واحد در سامانه گلستان فعال شود.

2️⃣ <b>شهریه متغیر</b>
شهریه متغیر بر اساس موارد زیر محاسبه می‌شود:
• <b>مقطع تحصیلی</b> (کارشناسی، کارشناسی ارشد و ...)
• <b>رشته</b> و گروه آموزشی
• <b>تعداد واحدهای انتخابی</b>
• نوع درس‌ها: <b>نظری، عملی، کارگاهی، پروژه، پایان‌نامه</b>

هر درس ضریب خاص خود را دارد؛ بنابراین افزایش تعداد واحدها یا دروس عملی، باعث افزایش شهریه متغیر می‌شود.

⏰ <b>مهلت پرداخت شهریه</b>

✅ <b>شهریه ثابت:</b> 
به‌طور معمول باید <b>قبل از انتخاب واحد</b> پرداخت شود. در صورت عدم پرداخت، امکان ثبت‌نام یا انتخاب واحد ممکن است محدود یا غیرفعال شود.

✅ <b>شهریه متغیر:</b>
پس از تکمیل انتخاب واحد و نهایی شدن لیست دروس، مبلغ شهریه متغیر محاسبه می‌شود و دانشجو می‌تواند در طول نیم‌سال آن را پرداخت کند.

⚠️ <b>تسویه قبل از امتحانات:</b>
برای دریافت <b>کارت ورود به جلسه</b> و شرکت در امتحانات پایان‌ترم، دانشجو باید <b>تمام بدهی شهریه (ثابت + متغیر)</b> را تسویه کرده باشد. در صورت وجود بدهی، امکان دریافت کارت ممکن است مسدود شود.

🌐 <b>پرداخت شهریه از طریق سامانه گلستان</b>

پرداخت اینترنتی شهریه از طریق سامانه جامع گلستان انجام می‌شود:

<b>مسیر پرداخت:</b>
آموزش ← شهریه ← پرداخت‌های الکترونیکی دانشجو

در این بخش:
• مبلغ بدهی شهریه ثابت و متغیر نمایش داده می‌شود.
• می‌توانید روی گزینه پرداخت کلیک کنید.
• سپس به درگاه بانکی منتقل می‌شوید و با کارت بانکی عضو شتاب پرداخت را انجام می‌دهید.

📌 <b>نکات مهم پس از پرداخت:</b>
• پس از پرداخت موفق، <b>کد پیگیری</b> و وضعیت تراکنش در سامانه ثبت می‌شود.
• در برخی موارد، صفر شدن بدهی یا فعال‌شدن منوهای آموزشی <b>چند ساعت تا یک روز کاری</b> زمان می‌برد.
• همیشه پس از پرداخت، با ورود مجدد به سامانه گلستان، بخش «پرداخت‌های الکترونیکی دانشجو» را بررسی کنید تا از ثبت نهایی مطمئن شوید.

📱 <b>پرداخت شهریه با اپلیکیشن ۷۲۴</b>
در برخی دوره‌ها، امکان پرداخت بدهی شهریه از طریق اپلیکیشن ۷۲۴ نیز فراهم است. راهنمای استفاده از این اپلیکیشن و نکات مربوط به زمان ثبت پرداخت را می‌توانید در گزینه <b>«📱 اپلیکیشن ۷۲۴»</b> در همین منو مشاهده کنید.
`;

const TUITION_724_TEXT = `📱 <b>پرداخت شهریه با اپلیکیشن ۷۲۴</b>

در برخی دوره‌ها، دانشگاه پیام نور این امکان را فراهم کرده است که دانشجویان بتوانند بدهی شهریه خود را از طریق اپلیکیشن پرداخت ۷۲۴ تسویه کنند.

1️⃣<b> نصب و ورود به اپلیکیشن ۷۲۴</b>

2️⃣<b> انتخاب بخش شهریه دانشگاه پیام نور</b>

3️⃣<b> وارد کردن کد ملی و شماره دانشجویی</b>

4️⃣<b> مشاهده مبلغ بدهی</b>

5️⃣ <b>انجام پرداخت</b>

⚠️ اعمال تراکنش انجام شده از طریق سامانه ۷۲۴ در سامانه گلستان ممکن است تا <b>یک روز کاری</b> زمان ببرد. `;


const JOIN_REQUIRED_INTRO =
  "برای استفاده از امکانات ربات، لطفا در کانال و گروه‌های زیر عضو شوید:";

const JOIN_SUCCESS_TEXT =
  "هم‌اکنون می‌توانید از تمامی امکانات ربات به‌صورت رایگان و نامحدود استفاده نمایید.";

/* =========================
   Required memberships
========================= */

const REQUIRED_MEMBERSHIPS = [
  {
    id: "@PNUniNet",
    name: "کانال پیام نوری",
    url: "https://t.me/PNUniNet",
  },
  {
    id: "@PNUniHelp",
    name: "سوپر گروه پیام نوری",
    url: "https://t.me/PNUniHelp",
  },
  {
    id: "@PNUniTalk",
    name: "گروه گفت و گو پیام نوری",
    url: "https://t.me/PNUniTalk",
  },
];

/* =========================
   LMS video guides
========================= */

const SUPPORT_CHANNEL_ID = "@PNUniNet";

const RAILAY_GUIDE_VIDEOS = [
  {
    id: "class",
    title: "🎥 راهنمای شرکت در کلاس",
    messageId: 11,
    showSupportPrompt: true,
    showSupportButton: true,
  },
  {
    id: "exam",
    title: "📝 راهنمای شرکت در آزمون",
    messageId: 12,
    showSupportPrompt: true,
    showSupportButton: true,
  },
  {
    id: "results",
    title: "📊 راهنمای مشاهده نتایج آزمون",
    messageId: 13,
    showSupportPrompt: true,
    showSupportButton: true,
  },
];

/* =========================
   Helpers
========================= */

function rtl(text) {
  return `\u200F${text ?? ""}`;
}

function toPersianDigits(value) {
  const map = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

  return String(value).replace(/[0-9]/g, (digit) => {
    return map[Number(digit)];
  });
}

const fa = toPersianDigits;

function isNumeric(value) {
  return Number.isFinite(Number(value));
}

function isPositiveIntegerString(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

function normalizeFaDigits(value) {
  const faNums = "۰۱۲۳۴۵۶۷۸۹";
  const arNums = "٠١٢٣٤٥٦٧٨٩";

  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => faNums.indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => arNums.indexOf(digit));
}

function normalizeInput(value) {
  return normalizeFaDigits(value)
    .replace(/[٫،٬]/g, ".")
    .replace(/\//g, ".")
    .replace(/,/g, ".")
    .trim();
}

function buildUrl(raw) {
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAdminChat(chatId, env) {
  return String(chatId) === String(env.ADMIN_CHAT_ID || "");
}

function resultKeyboard(backData, extraRows = []) {
  return [
    ...extraRows,
    [{ text: "🔙 بازگشت", callback_data: backData }],
    [{ text: "🏠 منوی اصلی", callback_data: "menu" }],
  ];
}

function botSignatureText() {
  return [
    "✨ تهیه شده توسط تیم ربات هوشمند پیام نور",
    "",
    "🤖 ربات: @PNUni_Bot",
    "📢 کانال: @PNUniNet",
    "👥 سوپرگروه: @PNUniHelp",
    "💬 گروه گفتگو: @PNUniTalk",
  ].join("\n");
}

function supportPromptText() {
  return "در صورت داشتن ابهام یا سوال، از طریق دکمه «ارسال پرسش و پیام»، سوال خود را مطرح فرمایید.";
}

function composeFooter(options = {}) {
  const { includeSignature = false, includeSupportPrompt = false } = options;

  const parts = [];

  if (includeSupportPrompt) {
    parts.push(supportPromptText());
  }

  if (includeSignature) {
    parts.push(botSignatureText());
  }

  return parts.filter(Boolean).join("\n\n");
}

function withFooter(baseText, options = {}) {
  const footer = composeFooter(options);
  return footer ? `${baseText}\n\n${footer}` : baseText;
}

// ==========================================
// متون و کیبوردهای ماژول جامع انتخاب واحد
// ==========================================

const UNIT_RULES_TEXT = `⚖️ *قوانین مهم انتخاب واحد*

📌 *تعداد واحد مجاز:* بر اساس معدل ترم قبل و مقررات آموزشی تعیین می‌شود.
📌 *رعایت پیش‌نیاز و هم‌نیاز:* در صورت عدم رعایت، ممکن است دروس توسط سامانه یا آموزش حذف شوند.
📌 *دروس معارف:* در هر نیمسال عادی فقط مجاز به اخذ *یک عنوان* (۲ واحد) درس از گروه معارف هستید.
📌 *دانشجوی ترم آخر:* دانشجوی ترم آخر می‌تواند تحت شرایط خاص آموزشی و با تایید، تا ۲۴ واحد بدون رعایت برخی شروط اخذ کند.

` + botSignatureText();

const UNIT_TYPES_TEXT = `📖 *انواع دروس دانشگاهی پیام‌نور*

🔹 *دروس عمومی:* دروسی مانند معارف، زبان عمومی، فارسی عمومی و تربیت‌بدنی.
🔹 *دروس پایه:* دروس مبنایی رشته که اغلب در نیمسال‌های ابتدایی ارائه می‌شوند.
🔹 *دروس اصلی و تخصصی:* دروس تخصصی مرتبط با رشته تحصیلی شما مطابق چارت.
🔹 *دروس اختیاری:* دروسی که از جدول دروس اختیاری چارت تا سقف مشخص انتخاب می‌شوند.

` + botSignatureText();

const MAAREF_RULES_TEXT = `🕌 *قوانین دروس معارف اسلامی*

1️⃣ در هر ترم عادی، دانشجو تنها مجاز به اخذ *یک عنوان* (حداکثر ۲ واحد) از دروس گروه معارف است.
2️⃣ انتخاب هم‌زمان دو درس معارف ممنوع بوده و منجر به حذف یکی از آن‌ها خواهد شد.
3️⃣ *استثنای ترم آخر:* دانشجویانی که ترم آخر هستند با مجوز آموزش می‌توانند دو عنوان معارف بردارند.

` + botSignatureText();

const SUMMER_TERM_TEXT = `☀️ *قوانین و شرایط ترم تابستان*

🔹 سقف مجاز انتخاب واحد در ترم تابستان حداکثر *۸ واحد* است.
🔹 ترم تابستان شرط معدل و مشروطی ندارد.
🔹 نمرات ترم تابستان در معدل کل مؤثر است اما مشروطی ایجاد نمی‌کند.
🔹 کلاس‌ها عموماً غیرحضوری یا فشرده و آزمون‌ها سراسری برگزار می‌شوند.

` + botSignatureText();

function getUnitSelectKeyboard() {
  return [
    [
      { text: "🎬 ویدئوهای آموزشی انتخاب واحد", callback_data: "unit:videos" },
      { text: "⚖️ قوانین انتخاب واحد", callback_data: "unit:rules" },
    ],
    [
      { text: "📚 انواع دروس", callback_data: "unit:types" },
      { text: "🕌 دروس معارف", callback_data: "unit:maaref" },
    ],
    [
      { text: "☀️ ترم تابستان", callback_data: "unit:summer" },
      { text: "📊 سقف و کف انتخاب واحد", callback_data: "unit:start" },
    ],
    [
      { text: "📋 چارت هشت‌ترمه", callback_data: "refs:start" },
      { text: "❓ پرسش‌های متداول", url: "https://telegra.ph/faq-unit-selection-pnu" },
    ],
    [
      { text: "💻 خدمات انتخاب واحد (کافی‌نت)", callback_data: "cafenet:start" },
      { text: "🔙 بازگشت به راهنمای گلستان", callback_data: "golestan:manual:section:edu" },
    ],
  ];
}



function resultKeyboardWithSupport(backData, extraRows = []) {
  return resultKeyboard(backData, [
    ...extraRows,
    [{ text: "📨 ارسال پرسش و پیام", callback_data: "support:start" }],
  ]);
}

/* =========================
   Theory score module
========================= */

function calcTheoryScore(midtermRaw, finalRaw) {
  const M = Number(midtermRaw);
  const P = Number(finalRaw);

  if (!Number.isFinite(M) || !Number.isFinite(P)) {
    return {
      ok: false,
      error: "ورودی نمره تئوری نامعتبر است.",
    };
  }

  if (M < 0 || M > 8 || P < 0 || P > 12) {
    return {
      ok: false,
      error:
        "بازه نمره‌ها صحیح نیست.\n📘 میان‌ترم: ۰ تا ۸\n📝 پایان‌ترم: ۰ تا ۱۲",
    };
  }

  const finalScore = Math.max(M + P, P * (20 / 12));

  return {
    ok: true,
    midterm: M,
    finalExam: P,
    finalScore: Number(finalScore.toFixed(2)),
  };
}

/* =========================
   LMS provinces
========================= */

const LMS_PROVINCES = [
  { id: "ardebil", name: "اردبیل", url: "lms.ardebil.pnu.ac.ir" },
  { id: "isfahan", name: "اصفهان", url: "lms.isfahan.pnu.ac.ir" },
  { id: "alborz", name: "البرز", url: "lms.alborz.pnu.ac.ir" },
  { id: "ilam", name: "ایلام", url: "lms.ilam.pnu.ac.ir" },
  { id: "eaz", name: "آذربایجان شرقی", url: "lms.eaz.pnu.ac.ir" },
  { id: "az", name: "آذربایجان غربی", url: "lms.az.pnu.ac.ir" },
  { id: "bushehr", name: "بوشهر", url: "lms.bpnu.ir" },
  { id: "tehran", name: "تهران", url: "lms.tpnu.ac.ir" },
  { id: "chb", name: "چهارمحال و بختیاری", url: "lms.chb.pnu.ac.ir" },
  { id: "skh", name: "خراسان جنوبی", url: "lms.skh.pnu.ac.ir" },
  { id: "razavi", name: "خراسان رضوی", url: "lms.razavi.pnu.ac.ir" },
  { id: "nkh", name: "خراسان شمالی", url: "eclass.nkh-pnu.ac.ir" },
  { id: "khz", name: "خوزستان", url: "lms.khz.pnu.ac.ir" },
  { id: "zanjan", name: "زنجان", url: "lms.zanjan.pnu.ac.ir" },
  { id: "semnan", name: "سمنان", url: "lms.se.pnu.ac.ir" },
  { id: "sb", name: "سیستان و بلوچستان", url: "lms.sb.pnu.ac.ir" },
  { id: "fars", name: "فارس", url: "vc.farspnu.ac.ir" },
  { id: "qazvin", name: "قزوین", url: "edu.qazvin.pnu.ac.ir" },
  { id: "qom", name: "قم", url: "lms2.qom.pnu.ac.ir" },
  { id: "kordestan", name: "کردستان", url: "lmskd.pnu.ac.ir" },
  { id: "kerman", name: "کرمان", url: "online.kerman.pnu.ac.ir" },
  { id: "kermanshah", name: "کرمانشاه", url: "lmsksh.pnu.ac.ir" },
  { id: "kb", name: "کهگیلویه و بویراحمد", url: "lms.kb.pnu.ac.ir" },
  { id: "golestan", name: "گلستان", url: "lms.golestan.pnu.ac.ir" },
  { id: "gilan", name: "گیلان", url: "lms.gilan.pnu.ac.ir" },
  { id: "lorestan", name: "لرستان", url: "lms.lorestan.pnu.ac.ir" },
  { id: "mazandaran", name: "مازندران", url: "lms.mz.pnu.ac.ir" },
  { id: "markazi", name: "مرکزی", url: "lms.markazi.pnu.ac.ir" },
  { id: "hormozgan", name: "هرمزگان", url: "lms.hormozgan.pnu.ac.ir" },
  { id: "hamedan", name: "همدان", url: "lms.hp.pnu.ac.ir" },
  { id: "yazd", name: "یزد", url: "lms.yazd.pnu.ac.ir" },
];

function getLmsProvinceById(id) {
  return LMS_PROVINCES.find((province) => province.id === id) || null;
}

/* =========================
   Keyboards
========================= */

function mainMenuKeyboard() {
  return [
    [{ text: "🧮 محاسبات", callback_data: "menu:calculations" }],
    [{ text: "🌐 سامانه آموزش مجازی", callback_data: "lms:menu" }],
    [{ text: "🏛 سامانه گلستان", callback_data: "golestan:menu" }],
    [{ text: "💰 وام دانشجویی", callback_data: "loan:show" }],
    [{ text: "🗓️ تقویم آموزشی", callback_data: "loan:show" }],
    [
      {
        text: "📘 چارت هشت ترمه ، منابع و حذفیات ترم",
        callback_data: "refs:start",
      },
    ],
    [{ text: "🤖 معرفی ربات", callback_data: "about:show" }],
    [{ text: "📞 ارتباط با ما", callback_data: "contact:menu" }],
  ];
}

function calculationsKeyboard() {
  return resultKeyboard("menu", [
    [{ text: "🧪 محاسبه نمره تستی", callback_data: "test:help" }],
    [{ text: "📘 محاسبه نمره نهایی", callback_data: "score:theory:help" }],
    [{ text: "📚 محاسبه معدل", callback_data: "gpa:help" }],
    [{ text: "🎓 سقف و کف انتخاب واحد", callback_data: "unit:start" }],
  ]);
}

function scoreMenuKeyboard() {
  return calculationsKeyboard();
}

function lmsMainKeyboard() {
  return resultKeyboard("menu", [
    [{ text: "📍 آدرس ریلاین استانی", callback_data: "lms:provinces" }],
    [{ text: "📹 راهنمای تصویری ریلاین", callback_data: "lms:guide" }],
  ]);
}

function lmsMenuKeyboardAllInOne() {
  const keyboard = [];

  for (let i = 0; i < LMS_PROVINCES.length; i += 2) {
    const row = [
      {
        text: `📍 ${LMS_PROVINCES[i].name}`,
        callback_data: `lms:province:${LMS_PROVINCES[i].id}`,
      },
    ];

    if (LMS_PROVINCES[i + 1]) {
      row.push({
        text: `📍 ${LMS_PROVINCES[i + 1].name}`,
        callback_data: `lms:province:${LMS_PROVINCES[i + 1].id}`,
      });
    }

    keyboard.push(row);
  }

  keyboard.push(...resultKeyboard("lms:menu"));

  return keyboard;
}

function lmsProvinceResultKeyboard() {
  return resultKeyboard("lms:provinces");
}

/* ✅ UPDATED: Golestan menu now includes manual button */
function golestanMenuKeyboard() {
  return resultKeyboard("menu", [
    [{ text: "🌐 آدرس سامانه گلستان", callback_data: "golestan:address" }],
    [{ text: "📚 راهنمای سامانه گلستان", callback_data: "golestan:manual:menu" }],
    [{ text: "📹 راهنمای تصویری گلستان", callback_data: "golestan:guide" }],
  ]);
}

/* ✅ NEW: Golestan Manual data + keyboards */
const GOLESTAN_MANUAL_SECTIONS = [
  {
    id: "edu",
    title: "📝 ثبت‌نام و امور آموزشی",
    items: [
      {
        id: "tuition",
        title: "💳 پرداخت شهریه",
        text: "🧾 پرداخت شهریه\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "unit_select",
        title: "📚 انتخاب واحد",
        text: "🧾 انتخاب واحد\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "add_drop",
        title: "🔄 حذف و اضافه",
        text: "🧾 حدف و اضافه\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "unit_report",
        title: "📋 گزارش انتخاب واحد",
        text: "🧾 گزارش انتخاب واحد\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "term_reg_report",
        title: "🗓️ گزارش ثبت‌نام نیمسال",
        text: "🧾 گزارش ثبت نام نیمسال\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "passed_remaining",
        title: "☑️ مشاهده دروس پاس‌شده و باقی‌مانده",
        text: "🧾 مشاهده دروس پاس شده و باقیمانده\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
    ],
  },
  {
    id: "exams",
    title: "2- امور امتحانات و نمرات",
    items: [
      {
        id: "change_place",
        title: "📍 تغییر محل آزمون",
        text: "🧾 تغییر محل آزمون\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "exam_card",
        title: "🎫 کارت ورود به جلسه",
        text: "🧾 کارت ورود به جلسه\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "results",
        title: "📊 مشاهده نتایج آزمون دانشجو",
        text: "🧾 مشاهده نتایج آزمون دانشجو\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "question_issue",
        title: "⚠️ اعلام اشکال سؤالات",
        text: "🧾 اعلام اشکال سوالات\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "score_review",
        title: "🔍 درخواست تجدیدنظر نمره",
        text: "🧾 درخواست تجدیدنظر نمره\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
    ],
  },
  {
    id: "special",
    title: "3- امور خاص و تکمیلی",
    items: [
      {
        id: "equivalency",
        title: "🧮 معادلسازی و تطبیق واحد",
        text: "🧾 معادلسازی و تطبیق واحد\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "guest",
        title: "🧳 مهمان موقت",
        text: "🧾 مهمان موقت\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "major",
        title: "🔀 تعیین گرایش",
        text: "🧾 تعیین گرایش\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "last_term",
        title: "⏳ درخواست ترم آخری",
        text: "🧾 درخواست ترم آخری\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "introduce_prof",
        title: "👨‍🏫 معرفی به استاد",
        text: "🧾 معرفی به استاد\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
      {
        id: "graduation",
        title: "🎓 درخواست فارغ‌التحصیلی",
        text: "🧾 درخواست فارغ التحصیلی\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
      },
    ],
  },
  {
    id: "reports",
    title: "4- تمام گزارش‌ها و پردازش‌ها",
    items: [
      {
        id: "soon",
        title: "به‌زودی...",
        text: "🧾 تمام گزارش‌ها و پردازش‌ها\n\n(لیست این بخش را بعداً اضافه می‌کنیم.)",
      },
    ],
  },
];

function golestanManualMenuKeyboard() {
  return resultKeyboard("golestan:menu", [
    [
      {
        text: "📝 ثبت‌نام و امور آموزشی",
        callback_data: "golestan:manual:section:edu",
      },
    ],
    [
      {
        text: "📝 امور امتحانات و نمرات",
        callback_data: "golestan:manual:section:exams",
      },
    ],
    [
      {
        text: "🧩 امور خاص و تکمیلی",
        callback_data: "golestan:manual:section:special",
      },
    ],
    [
      {
        text: " 🗂️ تمام گزارش‌ها و پردازش‌ها",
        callback_data: "golestan:manual:section:reports",
      },
    ],
  ]);
}

function golestanManualSectionKeyboard(sectionId) {
  const section = GOLESTAN_MANUAL_SECTIONS.find((s) => s.id === sectionId);
  const rows = (section?.items || []).map((it) => [
    { text: it.title, callback_data: `golestan:manual:item:${sectionId}:${it.id}` },
  ]);

  return resultKeyboard("golestan:manual:menu", rows);
}
function tuitionMenuKeyboard() {
  return resultKeyboard("golestan:manual:section:edu", [
    // 1) فیلم آموزشی پرداخت شهریه
    [
      {
        text: "🎥 فیلم آموزشی پرداخت شهریه",
        callback_data: "tuition:video",
      },
    ],

    // 2) جدول مبالغ شهریه
    [
      {
        text: "📊 جدول مبالغ شهریه",
        callback_data: "tuition:fees_table",
      },
    ],

    // 3) اپلیکیشن 724
    [
      {
        text: "📱 اپلیکیشن ۷۲۴",
        callback_data: "tuition:app724",
      },
    ],

    // 4) تخفیف ها و حمایت های ویژه
    [
      {
        text: "🎁 تخفیف‌ها و حمایت‌های ویژه",
        url: TUITION_DISCOUNTS_IV_URL,
      },
    ],

    // 5) پرسش های متداول
    [
      {
        text: "❓ پرسش‌های متداول پرداخت شهریه",
        url: TUITION_FAQ_IV_URL,
      },
    ],
  ]);
}


function contactMenuKeyboard() {
  return resultKeyboard("menu", [
    [{ text: "📨 ارسال پرسش و پیام", callback_data: "support:start" }],
    [{ text: "🖨 پیام به کافی نت", callback_data: "cafenet:start" }],
    [{ text: "📝 ارسال پیشنهاد و انتقاد", callback_data: "contact:feedback" }],
    [{ text: "💬 ارتباط مستقیم با ادمین", callback_data: "contact:admin" }],
  ]);
}

function persistentReplyKeyboard() {
  return {
    remove_keyboard: true,
  };
}

function joinRequiredKeyboard() {
  const rows = REQUIRED_MEMBERSHIPS.map((item) => [
    { text: item.name, url: item.url },
  ]);

  rows.push([{ text: "✅ موارد بالا رو عضو شدم", callback_data: "join:check" }]);

  return rows;
}

/* =========================
   Telegram API
========================= */

async function tgCall(method, token, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.ok) {
    const description = result?.description || "";

    if (
      method === "editMessageText" &&
      description.includes("message is not modified")
    ) {
      return true;
    }

    console.error(
      `Telegram ${method} failed:`,
      response.status,
      JSON.stringify(result)
    );

    return false;
  }

  return result;
}

async function setBotMenuButton(token) {
  return tgCall("setChatMenuButton", token, {
    menu_button: {
      type: "commands",
    },
  });
}

async function setBotCommands(token) {
  return tgCall("setMyCommands", token, {
    commands: [{ command: "start", description: "🏠 بازگشت به منوی اصلی" }],
  });
}

async function sendMessage(
  chatId,
  text,
  token,
  inlineKeyboard = null,
  isRaw = false,
  parseMode = null
) {
  const body = {
    chat_id: chatId,
    text: isRaw ? String(text ?? "") : rtl(String(text ?? "")),
    disable_web_page_preview: true,
  };

  if (inlineKeyboard) {
    body.reply_markup = {
      inline_keyboard: inlineKeyboard,
    };
  }

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  return tgCall("sendMessage", token, body);
}

async function sendReplyKeyboardMessage(chatId, text, token, isRaw = false) {
  return tgCall("sendMessage", token, {
    chat_id: chatId,
    text: isRaw ? String(text ?? "") : rtl(String(text ?? "")),
    disable_web_page_preview: true,
    reply_markup: persistentReplyKeyboard(),
  });
}

async function ensurePersistentKeyboard(chatId, token) {
  return tgCall("sendMessage", token, {
    chat_id: chatId,
    text: "🏠 به منوی اصلی برگشتید.",
    reply_markup: {
      remove_keyboard: true,
    },
  });
}

async function editMessage(
  chatId,
  messageId,
  text,
  token,
  inlineKeyboard = null,
  isRaw = false,
  parseMode = null
) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: isRaw ? String(text ?? "") : rtl(String(text ?? "")),
    disable_web_page_preview: true,
  };

  if (inlineKeyboard) {
    body.reply_markup = {
      inline_keyboard: inlineKeyboard,
    };
  }

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  return tgCall("editMessageText", token, body);
}

async function answerCallbackQuery(
  callbackQueryId,
  token,
  text = "",
  showAlert = false
) {
  const payload = {
    callback_query_id: callbackQueryId,
  };

  if (text) {
    payload.text = rtl(text);
  }

  if (showAlert) {
    payload.show_alert = true;
  }

  return tgCall("answerCallbackQuery", token, payload);
}

/* =========================
   Unified Video Sender (NEW)
   - uses copyMessage (no "Forwarded from")
   - can set caption + keyboard
   - forces protect_content=true to block save/forward
========================= */

const VIDEO_SOURCE_JOIN_URL = "https://t.me/PNUniNet";

async function copyMessageWithCaption(
  toChatId,
  fromChatId,
  messageId,
  token,
  caption = null,
  inlineKeyboard = null,
  parseMode = "HTML",
  protectContent = false // ← پیش‌فرض را false در نظر بگیرید
) {
  const body = {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  };

  // اگر caption بدهیم، کپشنِ اصلی کانال را عوض می‌کند
  if (caption != null) body.caption = caption;
  if (parseMode) body.parse_mode = parseMode;
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
  if (protectContent) body.protect_content = true;

  return tgCall("copyMessage", token, body);
}

function resultKeyboardWithCafeNet(backData, extraRows = []) {
  return resultKeyboard(backData, [
    ...extraRows,
    [{ text: "🖨 پیام به کافی نت", callback_data: "cafenet:start" }],
  ]);
}

function resultKeyboardWithSupportAndCafeNet(backData, extraRows = []) {
  return resultKeyboard(backData, [
    ...extraRows,
    [{ text: "📨 ارسال پرسش و پیام", callback_data: "support:start" }],
    [{ text: "🖨 پیام به کافی نت", callback_data: "cafenet:start" }],
  ]);
}

function buildVideoKeyboard(backData, cfg) {
  const extraRows = cfg.extraRows || [];
  const showSupportButton = Boolean(cfg.showSupportButton);
  const showCafeNetButton = Boolean(cfg.showCafeNetButton);

  if (showSupportButton && showCafeNetButton) {
    return resultKeyboardWithSupportAndCafeNet(backData, extraRows);
  }

  if (showSupportButton) {
    return resultKeyboardWithSupport(backData, extraRows);
  }

  if (showCafeNetButton) {
    return resultKeyboardWithCafeNet(backData, extraRows);
  }

  return resultKeyboard(backData, extraRows);
}

function buildVideoCaption({ title = "", blocks = [], includeSignature = true }) {
  const parts = [];

  if (title) parts.push(`<b>${escapeHtml(title)}</b>`);
  for (const b of blocks) {
    if (b) parts.push(b);
  }

  const base = parts.filter(Boolean).join("\n\n");

  // امضا/فوتر نهایی (بدون اجبار به ساپورت‌پرومپت؛ چون خود blocks ماژولی است)
  return withFooter(base, { includeSignature, includeSupportPrompt: false });
}

async function sendGuideVideo(env, chatId, cfg, backData) {
  // 1) ویدئو را کپی می‌کنیم، بدون دستکاری کپشن و بدون protect
  const copyResult = await copyMessageWithCaption(
    chatId,
    cfg.fromChatId || SUPPORT_CHANNEL_ID,
    cfg.messageId,
    env.BOT_TOKEN,
    null, // caption = null → کپشن کانال دست‌نخورده می‌ماند
    null, // کیبورد روی خود ویدئو نمی‌گذاریم
    null, // parseMode لازم نیست
    false // protectContent = false → فوروارد/ذخیره باز است
  );

  // اگر کپی ناموفق بود، تمام
  if (!copyResult || !copyResult.ok || !copyResult.result) {
    return false;
  }

  // آیدی پیام ویدئوی کپی‌شده
  const videoMsgId = copyResult.result.message_id;

  // 2) پیام تکمیلی + دکمه‌ها را به صورت ریپلای همان ویدئو می‌فرستیم
  const keyboard = buildVideoKeyboard(backData, cfg);

  const textBlocks = cfg.blocks || [];
  const finalText =
    textBlocks.filter(Boolean).join("\n\n") ||
    "در صورت داشتن سوال، از طریق دکمه‌های زیر اقدام فرمایید.";

  // این‌بار مستقیم از tgCall برای sendMessage استفاده می‌کنیم تا reply_to_message_id بدهیم
  const msgResult = await tgCall("sendMessage", env.BOT_TOKEN, {
    chat_id: chatId,
    text: finalText,
    reply_to_message_id: videoMsgId, // ← این باعث می‌شود پیام به ویدئو بچسبد (ریپلای شود)
    allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: keyboard },
  });

  return Boolean(msgResult && msgResult.ok);
}

/* =========================
   Membership gate
========================= */

async function getMissingMemberships(userId, token) {
  const missing = [];

  for (const item of REQUIRED_MEMBERSHIPS) {
    const result = await tgCall("getChatMember", token, {
      chat_id: item.id,
      user_id: userId,
    });

    if (!result || !result.ok || !result.result) {
      console.error("getChatMember failed for", item.id);
      continue;
    }

    const status = result.result.status;

    if (status === "left" || status === "kicked") {
      missing.push(item);
    }
  }

  return missing;
}

async function enforceMembershipGate(chatId, token) {
  const missing = await getMissingMemberships(chatId, token);

  if (missing.length === 0) {
    return true;
  }

  await sendMessage(
    chatId,
    JOIN_REQUIRED_INTRO,
    token,
    joinRequiredKeyboard(),
    true
  );

  return false;
}

async function showMainMenu(
  chatId,
  token,
  useEdit = false,
  messageId = null,
  topText = "🏠 منوی اصلی"
) {
  if (useEdit && messageId) {
    return editMessage(chatId, messageId, topText, token, mainMenuKeyboard());
  }

  return sendMessage(chatId, topText, token, mainMenuKeyboard());
}

/* =========================
   Admin Messenger
========================= */

class AdminMessenger {
  constructor(env) {
    this.botToken = env.BOT_TOKEN;
    this.adminChatId = env.ADMIN_CHAT_ID;
  }

  isConfigured() {
    return Boolean(this.botToken && this.adminChatId);
  }

  buildAdminMessage(typeLabel, fromUser, messageText) {
    const user = fromUser || {};

    const userId = user.id ? String(user.id) : "نامشخص";
    const firstName = user.first_name || "";
    const lastName = user.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim() || "نامشخص";
    const username = user.username ? `@${user.username}` : "ندارد";
    const cleanText = String(messageText || "").trim() || "ـ";

    return [
      "📩 پیام جدید کاربر",
      "",
      `🏷 نوع پیام: ${typeLabel}`,
      `👤 نام: ${fullName}`,
      `🔢 ID: ${userId}`,
      `🔗 یوزرنیم: ${username}`,
      "",
      "📝 متن پیام:",
      cleanText,
    ].join("\n");
  }

  async sendUserMessageToAdmin(typeLabel, fromUser, messageText) {
    if (!this.isConfigured()) {
      console.error("BOT_TOKEN or ADMIN_CHAT_ID is missing");
      return false;
    }

    const payload = this.buildAdminMessage(typeLabel, fromUser, messageText);

    const result = await sendMessage(
      this.adminChatId,
      payload,
      this.botToken,
      null,
      true
    );

    return Boolean(result);
  }

  extractUserIdFromReply(replyText) {
    if (!replyText) return null;

    const normalizedText = normalizeFaDigits(String(replyText));
    const match = normalizedText.match(/(?:🔢\s*)?ID:\s*([0-9]+)/);

    return match ? match[1] : null;
  }

  isAdminReply(message) {
    if (!this.adminChatId || !message?.chat?.id) {
      return false;
    }

    return (
      String(message.chat.id) === String(this.adminChatId) &&
      Boolean(message.reply_to_message)
    );
  }

  isUserReplyToSupportMessage(message) {
    if (!message?.reply_to_message?.from?.is_bot) {
      return false;
    }

    const repliedText = String(message.reply_to_message.text || "").trim();

    return repliedText.startsWith("💬 پاسخ پشتیبانی:");
  }

  async sendAdminReplyBackToUser(message) {
    if (!this.isAdminReply(message)) {
      return false;
    }

    const adminReplyText = String(message.text || "").trim();

    if (!adminReplyText) {
      return false;
    }

    const sourceText = message.reply_to_message?.text || "";
    const targetUserId = this.extractUserIdFromReply(sourceText);

    if (!targetUserId) {
      await sendMessage(
        message.chat.id,
        "⚠️ شناسه کاربر از پیام ریپلای‌شده قابل استخراج نیست.",
        this.botToken,
        null,
        true
      );

      return true;
    }

    const sentToUser = await sendMessage(
      targetUserId,
      `💬 پاسخ پشتیبانی:\n\n${adminReplyText}`,
      this.botToken,
      null,
      true
    );

    await sendMessage(
      message.chat.id,
      sentToUser
        ? "✅ پاسخ شما برای کاربر ارسال شد."
        : "⚠️ ارسال پاسخ به کاربر انجام نشد.",
      this.botToken,
      null,
      true
    );

    return true;
  }
}

/* =========================
   GPA parser
========================= */

function parseGpaInput(rawText) {
  const normalized = normalizeInput(rawText);

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      ok: false,
      error: "⚠️ ورودی خالی است.",
    };
  }

  let totalUnits = 0;
  let weightedSum = 0;

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].replace(/\s+/g, " ").split(" ");

    if (parts.length !== 2) {
      return {
        ok: false,
        error: `⚠️ فرمت خط ${fa(i + 1)} صحیح نیست.\n` + "📌 فرمت درست هر خط: T N",
      };
    }

    const unitsRaw = parts[0];
    const scoreRaw = parts[1];

    if (!isPositiveIntegerString(unitsRaw)) {
      return {
        ok: false,
        error: `⚠️ تعداد واحد در خط ${fa(i + 1)} معتبر نیست.`,
      };
    }

    if (!isNumeric(scoreRaw)) {
      return {
        ok: false,
        error: `⚠️ نمره در خط ${fa(i + 1)} معتبر نیست.`,
      };
    }

    const units = parseInt(unitsRaw, 10);
    const score = parseFloat(scoreRaw);

    if (score < 0 || score > 20) {
      return {
        ok: false,
        error: `⚠️ نمره در خط ${fa(i + 1)} باید بین ۰ تا ۲۰ باشد.`,
      };
    }

    totalUnits += units;
    weightedSum += units * score;
  }

  if (totalUnits <= 0) {
    return {
      ok: false,
      error: "⚠️ مجموع واحدها باید بیشتر از صفر باشد.",
    };
  }

  return {
    ok: true,
    totalUnits,
    gpa: weightedSum / totalUnits,
  };
}

/* =========================
   Main message handler
========================= */

async function handleMessage(message, env) {
  const adminMessenger = new AdminMessenger(env);

  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  // ثبت تعامل در دیتابیس D1
  await trackUser(message.from, env, "message");

  const adminReplyHandled = await adminMessenger.sendAdminReplyBackToUser(message);

  if (adminReplyHandled) {
    return;
  }

  // دستورات آماری ادمین
  if (isAdminChat(chatId, env)) {
    if (text === "/users_count") {
      const row = await env.DB?.prepare("SELECT COUNT(*) AS total FROM users")
        .first()
        .catch(() => null);

      const total = row ? row.total : 0;

      await sendMessage(
        chatId,
        `📊 تعداد کل کاربران:\n<code>${fa(total)}</code> نفر`,
        env.BOT_TOKEN,
        null,
        true,
        "HTML"
      );

      return;
    }

    if (text === "/users_today") {
      const row = await env.DB?.prepare(
        "SELECT COUNT(*) AS total FROM users WHERE date(last_seen_at) = date('now')"
      )
        .first()
        .catch(() => null);

      const total = row ? row.total : 0;

      await sendMessage(
        chatId,
        `📈 کاربران فعال امروز:\n<code>${fa(total)}</code> نفر`,
        env.BOT_TOKEN,
        null,
        true,
        "HTML"
      );

      return;
    }

    if (text === "/users_recent") {
      const data = await env.DB?.prepare(
        "SELECT id, first_name, last_name, username, last_seen_at FROM users ORDER BY last_seen_at DESC LIMIT 10"
      )
        .all()
        .catch(() => null);

      const rows = data?.results || [];

      if (rows.length === 0) {
        await sendMessage(chatId, "ℹ️ هنوز کاربری ثبت نشده است.", env.BOT_TOKEN, null, true);
        return;
      }

      const lines = rows.map((u, i) => {
        const name =
          `${u.first_name || ""} ${u.last_name || ""}`.trim() || "نامشخص";
        const username = u.username ? ` (@${u.username})` : "";
        return `${fa(i + 1)}) ${name}${username}\n   ID: <code>${u.id}</code>`;
      });

      await sendMessage(
        chatId,
        `🕓 ده کاربر اخیر:\n\n${lines.join("\n")}`,
        env.BOT_TOKEN,
        null,
        true,
        "HTML"
      );

      return;
    }
  }

  if (!isAdminChat(chatId, env)) {
    const isAllowed = await enforceMembershipGate(chatId, env.BOT_TOKEN);
    if (!isAllowed) {
      return;
    }
  }

  if (text === "/start" || text === "/menu" || text === "🏠 منوی اصلی") {
    userStates.delete(chatId);

    await setBotCommands(env.BOT_TOKEN);
    await setBotMenuButton(env.BOT_TOKEN);

    await ensurePersistentKeyboard(chatId, env.BOT_TOKEN);
    await showMainMenu(chatId, env.BOT_TOKEN, false, null, "🏠 منوی اصلی");

    return;
  }

  if (
    !isAdminChat(chatId, env) &&
    adminMessenger.isUserReplyToSupportMessage(message)
  ) {
    if (!text) {
      await sendMessage(
        chatId,
        "⚠️ لطفاً پاسخ خود را در قالب متن ارسال کنید.",
        env.BOT_TOKEN,
        resultKeyboard("contact:menu"),
        true
      );
      return;
    }

    const sent = await adminMessenger.sendUserMessageToAdmin(
      "ریپلای به پاسخ پشتیبانی",
      message.from,
      text
    );

    await sendMessage(
      chatId,
      sent
        ? "✅ پیام شما برای پشتیبانی ارسال شد."
        : "⚠️ ارسال انجام نشد. لطفاً بعداً دوباره تلاش کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  const state = userStates.get(chatId);

  if (state?.step === "support_waiting_message") {
    if (!text) {
      await sendMessage(
        chatId,
        "⚠️ لطفاً پیام خود را در قالب متن ارسال کنید.",
        env.BOT_TOKEN,
        resultKeyboard("contact:menu"),
        true
      );

      return;
    }

    userStates.delete(chatId);

    const sent = await adminMessenger.sendUserMessageToAdmin(
      "ارسال پرسش و پیام",
      message.from,
      text
    );

    await sendMessage(
      chatId,
      sent
        ? "✅ پیام شما ثبت شد و پاسخ از طریق همین ربات برای شما ارسال خواهد شد."
        : "⚠️ ارسال انجام نشد. لطفاً ADMIN_CHAT_ID را در تنظیمات Worker ثبت کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (state?.step === "cafenet_waiting_message") {
    if (!text) {
      await sendMessage(
        chatId,
        "⚠️ لطفاً درخواست خود را در قالب متن ارسال کنید.",
        env.BOT_TOKEN,
        resultKeyboard("contact:menu"),
        true
      );

      return;
    }

    userStates.delete(chatId);

    const sent = await adminMessenger.sendUserMessageToAdmin(
      "پیام به کافی نت",
      message.from,
      text
    );

    await sendMessage(
      chatId,
      sent
        ? "✅ درخواست شما برای کافی نت ارسال شد."
        : "⚠️ ارسال انجام نشد. لطفاً ADMIN_CHAT_ID را در تنظیمات Worker ثبت کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (state?.step === "contact_waiting_feedback") {
    if (!text) {
      await sendMessage(
        chatId,
        "⚠️ لطفاً متن پیشنهاد یا انتقاد را ارسال کنید.",
        env.BOT_TOKEN,
        resultKeyboard("contact:menu"),
        true
      );

      return;
    }

    userStates.delete(chatId);

    const sent = await adminMessenger.sendUserMessageToAdmin(
      "پیشنهاد و انتقاد",
      message.from,
      text
    );

    await sendMessage(
      chatId,
      sent
        ? "✅ پیشنهاد/انتقاد شما با موفقیت ثبت و ارسال شد. سپاس از شما 🙏"
        : "⚠️ ارسال انجام نشد. لطفاً ADMIN_CHAT_ID را در تنظیمات Worker ثبت کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (state?.step === "contact_waiting_admin_msg") {
    if (!text) {
      await sendMessage(
        chatId,
        "⚠️ لطفاً پیام خود را در قالب متن ارسال کنید.",
        env.BOT_TOKEN,
        resultKeyboard("contact:menu"),
        true
      );

      return;
    }

    userStates.delete(chatId);

    const sent = await adminMessenger.sendUserMessageToAdmin(
      "ارتباط مستقیم با ادمین",
      message.from,
      text
    );

    await sendMessage(
      chatId,
      sent
        ? "✅ پیام شما برای ادمین ارسال شد."
        : "⚠️ ارسال انجام نشد. لطفاً ADMIN_CHAT_ID را در تنظیمات Worker ثبت کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (state?.step === "refs_waiting_major") {
    const major = text.trim();

    if (!major) {
      await sendMessage(
        chatId,
        "⚠️ لطفاً نام رشته را وارد کنید.",
        env.BOT_TOKEN,
        resultKeyboard("refs:start"),
        true
      );

      return;
    }

    const baseUrl =
      "https://pnu.ac.ir/fa-IR/sp150.pnu.ac/13356/page/منابع-و-برنامه-دروس";

    const finalUrl =
      `${baseUrl}?2130183=${encodeURIComponent("کارشناسی")}` +
      `&2130185=${encodeURIComponent(major)}` +
      `&P_21301=1`;

    const messageText = [
      "📘 لینک چارت هشت ترمه ، منابع و حذفیات ترم",
      "",
      `🎓 رشته: ${major}`,
      "",
      "📑 دریافت منابع و چارت درسی",
      "از جدول نمایش داده‌شده، با توجه به مقطع، رشته و سال ورود خود فایل‌ها را دانلود کنید.",
      "",
      "🔗 لینک مستقیم:",
      finalUrl,
    ].join("\n");

    await sendMessage(
      chatId,
      messageText,
      env.BOT_TOKEN,
      resultKeyboard("refs:start"),
      true
    );

    userStates.delete(chatId);
    return;
  }

  if (state?.step === "score_waiting_theory") {
    const normalized = normalizeInput(text).replace(/\s+/g, " ");
    const parts = normalized ? normalized.split(" ") : [];

    if (parts.length !== 2 || !isNumeric(parts[0]) || !isNumeric(parts[1])) {
      await sendMessage(
        chatId,
        "⚠️ فرمت ورود نادرست است.\n\n📌 فرمت صحیح: M P\nمثال: ۵.۵ ۱۱.۷۲",
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    const result = calcTheoryScore(parts[0], parts[1]);

    if (!result.ok) {
      await sendMessage(
        chatId,
        `⚠️ ${result.error}`,
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    userStates.delete(chatId);

    await sendMessage(
      chatId,
      [
        "📊 نتیجه محاسبه نمره تئوری",
        "",
        `✅ نمره نهایی تئوری: ${fa(result.finalScore.toFixed(2))}`,
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );

    return;
  }

  if (state?.step === "score_waiting_mix") {
    const normalized = normalizeInput(text).replace(/\s+/g, " ");
    const parts = normalized ? normalized.split(" ") : [];

    if (parts.length !== 5 || !parts.every((part) => isNumeric(part))) {
      await sendMessage(
        chatId,
        [
          "⚠️ فرمت ورود نادرست است.",
          "",
          "📌 فرمت صحیح:",
          "a A t MT PT",
          "",
          "مثال:",
          "۲ ۱۶٫۵ ۱ ۶ ۱۰٫۲۲",
        ].join("\n"),
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    const [
      practicalUnitsRaw,
      practicalScoreRaw,
      theoryUnitsRaw,
      midtermRaw,
      finalRaw,
    ] = parts;

    const practicalUnits = Number(practicalUnitsRaw);
    const practicalScore = Number(practicalScoreRaw);
    const theoryUnits = Number(theoryUnitsRaw);

    if (
      !Number.isInteger(practicalUnits) ||
      !Number.isInteger(theoryUnits) ||
      practicalUnits < 0 ||
      theoryUnits < 0
    ) {
      await sendMessage(
        chatId,
        "⚠️ تعداد واحدهای عملی و تئوری باید عدد صحیح و غیرمنفی باشند.",
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    if (practicalUnits + theoryUnits <= 0) {
      await sendMessage(
        chatId,
        "⚠️ مجموع واحدهای عملی و تئوری باید بیشتر از صفر باشد.",
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    if (practicalScore < 0 || practicalScore > 20) {
      await sendMessage(
        chatId,
        "⚠️ نمره قسمت عملی باید بین ۰ تا ۲۰ باشد.",
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    const theoryResult = calcTheoryScore(midtermRaw, finalRaw);

    if (!theoryResult.ok) {
      await sendMessage(
        chatId,
        `⚠️ ${theoryResult.error}`,
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    const theoryScore = theoryResult.finalScore;

    const finalScore =
      (theoryUnits * theoryScore + practicalUnits * practicalScore) /
      (theoryUnits + practicalUnits);

    userStates.delete(chatId);

    await sendMessage(
      chatId,
      [
        "📗 نتیجه محاسبه نمره تئوری/عملی",
        "",
        `✅ نمره نهایی: ${fa(finalScore.toFixed(2))}`,
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );

    return;
  }

  if (state?.step === "score_waiting_test") {
    const normalized = normalizeInput(text).replace(/\s+/g, " ");
    const parts = normalized ? normalized.split(" ") : [];

    if (parts.length !== 2 || !isNumeric(parts[0]) || !isNumeric(parts[1])) {
      await sendMessage(
        chatId,
        "⚠️ فرمت ورود نادرست است.\n📌 فرمت صحیح: S K\nمثال: ۲۲ ۳۰",
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    const S = Number(parts[0]);
    const K = Number(parts[1]);

    if (!Number.isInteger(S) || !Number.isInteger(K) || S < 0 || K <= 0 || S > K) {
      await sendMessage(
        chatId,
        "⚠️ مقادیر نامعتبر است.\nS و K باید صحیح باشند، K بزرگ‌تر از صفر و S کوچک‌تر یا مساوی K باشد.",
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    const score = (S / K) * 12;

    userStates.delete(chatId);

    await sendMessage(
      chatId,
      [
        "🧪 نتیجه محاسبه نمره تستی",
        "",
        `✅ نمره تستی: ${fa(score.toFixed(2))}`,
        "",
        "در صورتی که نمرهٔ میان‌ترم دارید، از قسمت «محاسبه نمره نهایی» جهت محاسبهٔ نمرهٔ نهایی خود استفاده کنید.",
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations", [
        [{ text: "📘 محاسبه نمره نهایی", callback_data: "score:theory:help" }],
      ]),
      true
    );

    return;
  }

  if (state?.step === "gpa_waiting_lines") {
    const result = parseGpaInput(text);

    if (!result.ok) {
      await sendMessage(
        chatId,
        result.error,
        env.BOT_TOKEN,
        resultKeyboard("menu:calculations"),
        true
      );

      return;
    }

    userStates.delete(chatId);

    await sendMessage(
      chatId,
      [
        "📚 نتیجه محاسبه معدل",
        "",
        `📦 تعداد واحدها: ${fa(result.totalUnits)}`,
        `🎯 معدل ترم: ${fa(result.gpa.toFixed(2))}`,
        "",
        "برای اطلاع از حداقل و حداکثر واحد قابل اخذ در نیمسال آینده، بر اساس این معدل، به بخش «سقف و کف انتخاب واحد» مراجعه نمایید.",
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations", [
        [{ text: "🎓 سقف و کف انتخاب واحد", callback_data: "unit:start" }],
      ]),
      true
    );

    return;
  }

  userStates.delete(chatId);

  await sendMessage(
    chatId,
    "ℹ️ لطفاً از منو استفاده کنید.",
    env.BOT_TOKEN,
    mainMenuKeyboard()
  );
}

/* =========================
   Callback handler
========================= */

async function handleCallback(callbackQuery, env) {
  const data = callbackQuery.data || "";
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  // ثبت تعامل در دیتابیس D1
  await trackUser(callbackQuery.from, env, `cb:${data}`);

  if (!chatId || !messageId) {
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);
    return;
  }

  if (!isAdminChat(chatId, env) && data !== "join:check") {
    const isAllowed = await enforceMembershipGate(chatId, env.BOT_TOKEN);

    if (!isAllowed) {
      await answerCallbackQuery(
        callbackQuery.id,
        env.BOT_TOKEN,
        "ابتدا عضویت خود را کامل کنید.",
        true
      );
      return;
    }
  }

  if (data === "join:check") {
    const missing = await getMissingMemberships(chatId, env.BOT_TOKEN);

    if (missing.length > 0) {
      await answerCallbackQuery(
        callbackQuery.id,
        env.BOT_TOKEN,
        "هنوز در همه موارد عضو نشده‌اید.",
        true
      );

      await sendMessage(
        chatId,
        JOIN_REQUIRED_INTRO,
        env.BOT_TOKEN,
        joinRequiredKeyboard(),
        true
      );

      return;
    }

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "عضویت شما تایید شد.");

    await setBotCommands(env.BOT_TOKEN);
    await setBotMenuButton(env.BOT_TOKEN);

    await ensurePersistentKeyboard(chatId, env.BOT_TOKEN);

    await editMessage(
      chatId,
      messageId,
      JOIN_SUCCESS_TEXT,
      env.BOT_TOKEN,
      mainMenuKeyboard(),
      true
    );

    return;
  }

  if (data === "menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🏠 بازگشت به منوی اصلی");

    await showMainMenu(chatId, env.BOT_TOKEN, true, messageId, "🏠 منوی اصلی");

    return;
  }

  if (data === "menu:calculations" || data === "score:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🧮 محاسبات");

    await editMessage(
      chatId,
      messageId,
      "🧮 محاسبات\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      calculationsKeyboard(),
      true
    );

    return;
  }

  if (data === "about:show") {
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🤖 معرفی ربات");

    const text = [
      "🤖 معرفی ربات",
      "",
      "ربات دانشجویی دانشگاه پیام نور",
      `نسخه: ${fa("۱.۱.۱")}`,
      `تاریخ بروزرسانی: ${fa("۱۴۰۵/۰۵/۲۲")}`,
      `منطبق با: نیمسال تابستان ${fa("۱۴۰۵")}`,
    ].join("\n");

    await editMessage(chatId, messageId, text, env.BOT_TOKEN, resultKeyboard("menu"));

    return;
  }

  if (data === "support:start") {
    userStates.set(chatId, { step: "support_waiting_message" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📨 ارسال پرسش و پیام");

    await editMessage(
      chatId,
      messageId,
      SUPPORT_TEXT,
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (data === "cafenet:start") {
    userStates.set(chatId, { step: "cafenet_waiting_message" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🖨 پیام به کافی نت");

    await editMessage(
      chatId,
      messageId,
      CAFE_NET_TEXT,
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  // 🎥 فیلم آموزشی پرداخت شهریه
  if (data === "tuition:video") {
    await answerCallbackQuery(
      callbackQuery.id,
      env.BOT_TOKEN,
      "🎥 فیلم آموزشی پرداخت شهریه"
    );

    // کپی پست آموزشی از کانال (آیدی 25)
    await copyMessageWithCaption(chatId, "@PNUniNet", 25, env.BOT_TOKEN);

    // نمایش متن کافی‌نت + دکمه پیام به کافی‌نت و بازگشت
    const kb = [
      [
        { text: "💻 پیام به کافی‌نت", callback_data: "cafenet:start" },
        {
          text: "⬅️ بازگشت به پرداخت شهریه",
          callback_data: "golestan:manual:item:edu:tuition",
        },
      ],
      [{ text: "🏠 منوی اصلی", callback_data: "menu" }],
    ];

    await sendMessage(chatId, CAFE_NET_TEXT, env.BOT_TOKEN, kb);
    return;
  }

  // 📊 جدول مبالغ شهریه
  if (data === "tuition:fees_table") {
    await answerCallbackQuery(
      callbackQuery.id,
      env.BOT_TOKEN,
      "📊 جدول مبالغ شهریه"
    );

    // کپی جدول شهریه از کانال (آیدی 43)
    await copyMessageWithCaption(chatId, "@PNUniNet", 43, env.BOT_TOKEN);

    await sendMessage(
      chatId,
      "برای بازگشت از دکمه زیر استفاده کنید.",
      env.BOT_TOKEN,
      resultKeyboard("golestan:manual:item:edu:tuition")
    );
    return;
  }

  // 📱 اپلیکیشن ۷۲۴
  if (data === "tuition:app724") {
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📱 اپلیکیشن ۷۲۴");

    await editMessage(
      chatId,
      messageId,
      TUITION_724_TEXT,
      env.BOT_TOKEN,
      resultKeyboard("golestan:manual:item:edu:tuition"),
      false,
      "HTML"
    );
    return;
  }
  

  if (data === "loan:show") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "💰 وام دانشجویی");

    await editMessage(
      chatId,
      messageId,
      "💰 اطلاعات این بخش به‌زودی تکمیل می‌شود.",
      env.BOT_TOKEN,
      resultKeyboard("menu"),
      true
    );

    return;
  }

  if (data === "contact:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📞 ارتباط با ما");

    await editMessage(
      chatId,
      messageId,
      "📞 ارتباط با ما\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      contactMenuKeyboard(),
      true
    );

    return;
  }

  if (data === "contact:feedback") {
    userStates.set(chatId, { step: "contact_waiting_feedback" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📝 ارسال پیشنهاد و انتقاد");

    await editMessage(
      chatId,
      messageId,
      "📝 لطفاً پیشنهاد یا انتقاد خود را در یک پیام ارسال کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (data === "contact:admin") {
    userStates.set(chatId, { step: "contact_waiting_admin_msg" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "💬 ارتباط مستقیم با ادمین");

    await editMessage(
      chatId,
      messageId,
      "💬 لطفاً پیام خود را برای ادمین ارسال کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );

    return;
  }

  if (data === "score:theory:help") {
    userStates.set(chatId, { step: "score_waiting_theory" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📘 راهنمای نمره نهایی");

    await editMessage(
      chatId,
      messageId,
      [
        "📘 محاسبه نمره نهایی",
        "",
        "لطفاً نمره میان‌ترم (M) و پایان‌ترم (P) را با یک فاصله وارد کنید:",
        "",
        "📌 فرمت ورود:",
        "M P",
        "",
        "🧪 مثال:",
        "۵.۵ ۱۱.۷۲",
        "\u200E      یا",
        "۵/۵ ۱۱/۷۲",
        "",
        "ℹ️ اگر نمره میان‌ترم ندارید، عدد ۰ را وارد کنید.",
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );

    return;
  }

  if (data === "score:mix:help") {
    userStates.set(chatId, { step: "score_waiting_mix" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📗 راهنمای محاسبه تئوری/عملی");

    await editMessage(
      chatId,
      messageId,
      [
        "📘 نحوهٔ ورود نمرات دروس عملی و تئوری",
        "",
        "تعداد واحد عملی (a)، نمره قسمت عملی (A)، تعداد واحد تئوری (t)، نمره میان‌ترم بخش تئوری (MT) و نمره پایان‌ترم بخش تئوری (PT) را به ترتیب، از سمت چپ به راست و با فاصله وارد کنید:",
        "",
        "a A t MT PT",
        "",
        "مثال:",
        "",
        "اگر درس شما ۳ واحدی و شامل ۲ واحد عملی و ۱ واحد تئوری باشد و نمره عملی شما ۱۶٫۵ از ۲۰، نمره میان‌ترم شما ۶ از ۸ و نمره پایان‌ترم شما ۱۰٫۲۲ از ۱۲ باشد، اطلاعات را به شکل زیر وارد کنید:",
        "",
        "۲ ۱۶٫۵ ۱ ۶ ۱۰٫۲۲",
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );

    return;
  }

  if (data === "test:help") {
    userStates.set(chatId, { step: "score_waiting_test" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🧪 راهنمای محاسبه نمره تستی");

    await editMessage(
      chatId,
      messageId,
      ["🧪 محاسبه نمره تستی", "", "فرمت:", "S K", "", "مثال:", "22 30"].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );

    return;
  }

  if (data === "gpa:help") {
    userStates.set(chatId, { step: "gpa_waiting_lines" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📚 راهنمای محاسبه معدل");

    await editMessage(
      chatId,
      messageId,
      "📚 محاسبه معدل\n\nهر درس را در یک خط وارد کنید:\nT N\n\nنمونه:\n۲ ۱۵٫۵\n۳ ۱۶٫۷۵\n۱ ۱۳",
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );

    return;
  }

  if (data === "lms:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🌐 سامانه آموزش مجازی");

    await editMessage(
      chatId,
      messageId,
      "🌐 سامانه آموزش مجازی\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      lmsMainKeyboard(),
      true
    );

    return;
  }

  if (data === "lms:provinces") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📍 آدرس ریلاین استانی");

    await editMessage(
      chatId,
      messageId,
      "🌐 سامانه آموزش مجازی\n\n📍 استان موردنظر را انتخاب کنید:",
      env.BOT_TOKEN,
      lmsMenuKeyboardAllInOne(),
      true
    );

    return;
  }

  // --- LMS VIDEO GUIDES (UPDATED: forward -> copyMessage + caption + protect_content) ---

  if (data === "lms:guide") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📹 راهنمای تصویری ریلاین");

    const videoRows = RAILAY_GUIDE_VIDEOS.map((video) => [
      {
        text: video.title,
        callback_data: `lms:guide:video:${video.id}`,
      },
    ]);

    const keyboard = [...videoRows, ...resultKeyboard("lms:menu")];

    await editMessage(
      chatId,
      messageId,
      "📹 راهنمای تصویری ریلاین\n\n" +
        "یکی از موضوعات زیر را انتخاب کنید:\n" +
        "ویدیوها بدون برچسب فوروارد (copy) ارسال می‌شوند.",
      env.BOT_TOKEN,
      keyboard,
      true
    );

    return;
  }

  if (data.startsWith("lms:guide:video:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);

    const videoId = data.split(":").pop();
    const video = RAILAY_GUIDE_VIDEOS.find((v) => v.id === videoId);

    if (!video) {
      await editMessage(
        chatId,
        messageId,
        "⚠️ ویدیو انتخاب‌شده معتبر نیست.\n🔁 لطفاً دوباره انتخاب کنید.",
        env.BOT_TOKEN,
        resultKeyboard("lms:guide"),
        true
      );
      return;
    }

    const blocks = [];
    blocks.push("🎥 این ویدیو از کانال پیام نوری ارسال شده است.");
    if (video.showSupportPrompt) blocks.push(supportPromptText());

    const ok = await sendGuideVideo(
      env,
      chatId,
      {
        title: video.title,
        messageId: video.messageId,
        fromChatId: SUPPORT_CHANNEL_ID,
        showSupportButton: Boolean(video.showSupportButton),
        showCafeNetButton: false,
        blocks,
        includeSignature: true,
      },
      "lms:guide"
    );

    if (!ok) {
      const failText = withFooter(
        "⚠️ امکان ارسال ویدیو وجود ندارد.\n\n" +
          "برای مشاهده، ابتدا در کانال پیام نوری عضو شوید:",
        {
          includeSupportPrompt: Boolean(video.showSupportPrompt),
          includeSignature: true,
        }
      );

      const failKeyboard = buildVideoKeyboard("lms:guide", {
        showSupportButton: Boolean(video.showSupportButton),
        showCafeNetButton: false,
        extraRows: [[{ text: "📢 عضویت در کانال", url: VIDEO_SOURCE_JOIN_URL }]],
      });

      await sendMessage(chatId, failText, env.BOT_TOKEN, failKeyboard, true);
    }

    return;
  }

  // -------------------------

  if (data.startsWith("lms:province:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);

    const id = data.split(":")[2];
    const province = getLmsProvinceById(id);

    if (!province) {
      await editMessage(
        chatId,
        messageId,
        "⚠️ استان انتخاب‌شده معتبر نیست.\n🔁 لطفاً دوباره انتخاب کنید.",
        env.BOT_TOKEN,
        lmsMenuKeyboardAllInOne(),
        true
      );

      return;
    }

    const fullUrl = buildUrl(province.url);

    const text = [
      `🌐 سامانه آموزش مجازی استان ${escapeHtml(province.name)}`,
      "",
      fullUrl,
      "",
      "⚠️ سایت‌های داخلی در مرورگر تلگرام باز نمی‌شوند.",
      "لطفاً لینک بالا را کپی کرده و در مرورگر خارجی باز کنید.",
      "",
      "🔗 لینک قابل کپی:",
      `<code>${escapeHtml(fullUrl)}</code>`,
      "",
      "🧾 راهنمای ورود:",
      "نام کاربری: شماره دانشجویی",
      "رمز عبور: کدملی +Aa",
      "مثال: 1234567890aA",
    ].join("\n");

    await editMessage(
      chatId,
      messageId,
      text,
      env.BOT_TOKEN,
      lmsProvinceResultKeyboard(),
      true,
      "HTML"
    );

    return;
  }

  if (data === "golestan:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🏛 سامانه گلستان");

    await editMessage(
      chatId,
      messageId,
      "🏛 سامانه گلستان\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      golestanMenuKeyboard(),
      true
    );

    return;
  }

  /* ✅ NEW: Golestan Manual handlers */
  if (data === "golestan:manual:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📚 راهنمای سامانه گلستان");

    await editMessage(
      chatId,
      messageId,
      "📚 راهنمای سامانه گلستان\n\nیکی از بخش‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      golestanManualMenuKeyboard(),
      true
    );

    return;
  }

  if (data.startsWith("golestan:manual:section:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);

    const sectionId = data.split(":").pop(); // edu | exams | special | reports
    const section = GOLESTAN_MANUAL_SECTIONS.find((s) => s.id === sectionId);

    if (!section) {
      await editMessage(
        chatId,
        messageId,
        "⚠️ بخش انتخاب‌شده معتبر نیست.\n🔁 لطفاً دوباره انتخاب کنید.",
        env.BOT_TOKEN,
        golestanManualMenuKeyboard(),
        true
      );
      return;
    }

    await editMessage(
      chatId,
      messageId,
      `📚 راهنمای سامانه گلستان\n\n${section.title}\n\nیکی از موارد زیر را انتخاب کنید:`,
      env.BOT_TOKEN,
      golestanManualSectionKeyboard(sectionId),
      true
    );

    return;
  }

  // ✅ صفحه اختصاصی «💳 پرداخت شهریه» (حتماً قبل از handler عمومی آیتم‌ها باشد)
  if (data === "golestan:manual:item:edu:tuition") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);

    await editMessage(
      chatId,
      messageId,
      TUITION_GUIDE_TEXT,
      env.BOT_TOKEN,
      tuitionMenuKeyboard(),
      false,
      "HTML"
    );

    return;
  }

  // --- ✅ ماژول جامع انتخاب واحد (قبل از handler عمومی قرار گرفت) ---
  if (data === "unit:main" || data === "golestan:manual:item:edu:unit_select") {
    userStates.delete(chatId);
    const eduSection = GOLESTAN_MANUAL_SECTIONS.find((s) => s.id === "edu");
    const unitItem = eduSection?.items.find((i) => i.id === "unit_select");
    await editMessage(
      chatId,
      messageId,
      unitItem ? unitItem.text : "📚 *راهنمای انتخاب واحد*",
      env.BOT_TOKEN,
      getUnitSelectKeyboard(),
      true,
      "Markdown"
    );
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);
    return;
  }

  if (data === "unit:videos") {
    userStates.delete(chatId);
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "در حال ارسال ویدئوهای آموزشی...");
    const videoIds = [23, 24, 35];
    for (const vidId of videoIds) {
      try {
        await tgCall("copyMessage", env.BOT_TOKEN, {
          chat_id: chatId,
          from_chat_id: "@PNUniNet",
          message_id: vidId,
        });
      } catch (e) {
        // در صورت بروز خطا در ارسال یک ویدئو، ادامه یابد
      }
    }
    await sendMessage(
      chatId,
      `💡 *برای انجام انتخاب واحد به کمک نیاز دارید؟*\n\n` + botSignatureText(),
      env.BOT_TOKEN,
      [
        [{ text: "💻 خدمات کافی‌نت و انتخاب واحد", callback_data: "cafenet:start" }],
        [{ text: "🔙 بازگشت به انتخاب واحد", callback_data: "unit:main" }],
      ],
      true,
      "Markdown"
    );
    return;
  }

  if (data === "unit:rules") {
    userStates.delete(chatId);
    await editMessage(
      chatId,
      messageId,
      UNIT_RULES_TEXT,
      env.BOT_TOKEN,
      [
        [
          { text: "🕌 دروس معارف", callback_data: "unit:maaref" },
          { text: "📊 سقف و کف انتخاب واحد", callback_data: "unit:start" },
        ],
        [
          { text: "⏳ دانشجوی ترم آخری", callback_data: "golestan:manual:item:special:last_term" },
        ],
        [
          { text: "🔙 بازگشت به انتخاب واحد", callback_data: "unit:main" },
        ],
      ],
      true,
      "Markdown"
    );
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);
    return;
  }

  if (data === "unit:types") {
    userStates.delete(chatId);
    await editMessage(
      chatId,
      messageId,
      UNIT_TYPES_TEXT,
      env.BOT_TOKEN,
      [
        [{ text: "🕌 جزئیات دروس معارف", callback_data: "unit:maaref" }],
        [{ text: "🔙 بازگشت به انتخاب واحد", callback_data: "unit:main" }],
      ],
      true,
      "Markdown"
    );
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);
    return;
  }

  if (data === "unit:maaref") {
    userStates.delete(chatId);
    await editMessage(
      chatId,
      messageId,
      MAAREF_RULES_TEXT,
      env.BOT_TOKEN,
      [
        [{ text: "💻 خدمات انتخاب واحد (کافی‌نت)", callback_data: "cafenet:start" }],
        [{ text: "🔙 بازگشت به انتخاب واحد", callback_data: "unit:main" }],
      ],
      true,
      "Markdown"
    );
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);
    return;
  }

  if (data === "unit:summer") {
    userStates.delete(chatId);
    await editMessage(
      chatId,
      messageId,
      SUMMER_TERM_TEXT,
      env.BOT_TOKEN,
      [
        [{ text: "💻 خدمات انتخاب واحد (کافی‌نت)", callback_data: "cafenet:start" }],
        [{ text: "🔙 بازگشت به انتخاب واحد", callback_data: "unit:main" }],
      ],
      true,
      "Markdown"
    );
    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);
    return;
  }

  // ✅ handler عمومی آیتم‌های راهنمای گلستان
  if (data.startsWith("golestan:manual:item:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN);

    const [, , , sectionId, itemId] = data.split(":");
    const section = GOLESTAN_MANUAL_SECTIONS.find((s) => s.id === sectionId);
    const item = section?.items?.find((it) => it.id === itemId);

    if (!section || !item) {
      await editMessage(
        chatId,
        messageId,
        "⚠️ گزینه انتخاب‌شده معتبر نیست.\n🔁 لطفاً دوباره انتخاب کنید.",
        env.BOT_TOKEN,
        golestanManualMenuKeyboard(),
        true
      );
      return;
    }

    await editMessage(
      chatId,
      messageId,
      item.text,
      env.BOT_TOKEN,
      resultKeyboard(`golestan:manual:section:${sectionId}`),
      true
    );

    return;
  }

  if (data === "golestan:address") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🌐 آدرس سامانه گلستان");

    const links = [
      "https://reg.pnu.ac.ir",
      "https://reg.pnu.ac.ir/forms/authenticateuser/main.htm",
      "https://reg1.pnu.ac.ir/forms/authenticateuser/main.htm",
      "https://osreg.pnu.ac.ir/forms/authenticateuser/main.htm",
      "https://10.8.212.138/forms/authenticateuser/main.htm",
    ];

    const text = [
      "🏛 سامانه گلستان",
      "",
      "🌐 سایت اصلی:",
      links[0],
      "",
      "🎓 ورود دانشجو:",
      links[1],
      "",
      "🧩 لینک‌های کمکی:",
      links[2],
      links[3],
      links[4],
    ].join("\n");

    await editMessage(
      chatId,
      messageId,
      text,
      env.BOT_TOKEN,
      resultKeyboard("golestan:menu"),
      true
    );

    return;
  }

  if (data === "golestan:guide") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📹 راهنمای تصویری گلستان");

    await editMessage(
      chatId,
      messageId,
      "📹 راهنمای تصویری گلستان\n\nاین بخش بعداً تکمیل می‌شود.",
      env.BOT_TOKEN,
      resultKeyboard("golestan:menu"),
      true
    );

    return;
  }

  if (data === "refs:start") {
    userStates.set(chatId, { step: "refs_waiting_major" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📘 چارت، منابع و حذفیات ترم");

    await editMessage(
      chatId,
      messageId,
      "📘 چارت هشت ترمه، منابع و حذفیات ترم\n\n✍️ لطفاً نام رشته‌تان را ارسال کنید.\nمثال: مهندسی کامپیوتر",
      env.BOT_TOKEN,
      resultKeyboard("menu"),
      true
    );

    return;
  }

  if (data === "unit:start") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "🎓 محاسبه سقف و کف انتخاب واحد");

    await editMessage(
      chatId,
      messageId,
      "🎓 سقف و کف مجاز انتخاب واحد\n\n❓ آیا ترم آخر هستید؟",
      env.BOT_TOKEN,
      resultKeyboard("menu", [
        [
          { text: "✅ بله", callback_data: "unit:last" },
          { text: "❌ خیر", callback_data: "unit:not_last" },
        ],
      ])
    );

    return;
  }

  if (data === "unit:last") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "✅ حالت ترم آخر انتخاب شد");

    await editMessage(
      chatId,
      messageId,
      [
        "📋 نتیجه سقف و کف مجاز انتخاب واحد",
        "",
        "🎓 وضعیت: ترم آخر",
        `🔺 حداکثر مجاز: ${fa("۲۴")} واحد`,
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("unit:start", [[{ text: "🔁 محاسبه دوباره", callback_data: "unit:start" }]]),
      true
    );

    return;
  }

  if (data === "unit:not_last") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📌 حالت غیر ترم آخر انتخاب شد");

    await editMessage(
      chatId,
      messageId,
      "🪪 وضعیت شما از نظر معافیت تحصیلی چیست?",
      env.BOT_TOKEN,
      resultKeyboard("unit:start", [
        [{ text: "✅ مشمول معافیت تحصیلی", callback_data: "unit:normal:m" }],
        [{ text: "🚫 غیرمشمول", callback_data: "unit:normal:n" }],
      ])
    );

    return;
  }

  if (data === "unit:normal:m" || data === "unit:normal:n") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📈 انتخاب بازه معدل");

    const type = data.endsWith(":m") ? "m" : "n";

    await editMessage(
      chatId,
      messageId,
      "📈 معدل ترم قبل در کدام بازه است?",
      env.BOT_TOKEN,
      resultKeyboard("unit:not_last", [
        [{ text: `${fa("۱۱.۹۹")} یا کمتر`, callback_data: `unit:gpa:${type}:low` }],
        [{ text: `${fa("۱۲")} تا ${fa("۱۶.۹۹")}`, callback_data: `unit:gpa:${type}:mid` }],
        [{ text: `${fa("۱۷")} و بالاتر`, callback_data: `unit:gpa:${type}:high` }],
      ])
    );

    return;
  }

  if (data.startsWith("unit:gpa:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "✅ نتیجه آماده شد");

    const [, , type, band] = data.split(":");

    const isMashmool = type === "m";
    const minUnits = isMashmool ? 12 : 8;

    let maxUnits = 14;
    let gpaLabel = `${fa("۱۱.۹۹")} یا کمتر`;

    if (band === "mid") {
      maxUnits = 20;
      gpaLabel = `${fa("۱۲")} تا ${fa("۱۶.۹۹")}`;
    }

    if (band === "high") {
      maxUnits = 24;
      gpaLabel = `${fa("۱۷")} و بالاتر`;
    }

    const statusLabel = isMashmool ? "مشمول معافیت تحصیلی" : "غیرمشمول";

    await editMessage(
      chatId,
      messageId,
      [
        "📋 نتیجه سقف و کف مجاز انتخاب واحد",
        "",
        `👤 وضعیت: ${statusLabel}`,
        `🎓 معدل ترم قبل: ${gpaLabel}`,
        `🔻 حداقل مجاز: ${fa(minUnits)} واحد`,
        `🔺 حداکثر مجاز: ${fa(maxUnits)} واحد`,
      ].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard(`unit:normal:${type}`, [[{ text: "🔁 محاسبه دوباره", callback_data: "unit:start" }]]),
      true
    );

    return;
  }

  await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "✅ انجام شد");
}


