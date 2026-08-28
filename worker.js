export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN is missing", { status: 500 });
    }

    if (request.method === "GET") {
      return new Response("Bot is running.", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let update;

    try {
      update = await request.json();
    } catch (error) {
      console.error("Invalid JSON update:", error);
      return new Response("Bad request", { status: 400 });
    }

    if (!update || typeof update !== "object") {
      return new Response("Bad request", { status: 400 });
    }

    try {
      if (update.message) {
        await handleMessage(update.message, env);
      } else if (update.callback_query) {
        await handleCallback(update.callback_query, env);
      }
    } catch (error) {
      console.error("Unhandled update error:", error);
    }

    return new Response("ok");
  },
};

/* ============================================
   D1 Analytics Logic
   جدول users باید در کنسول D1 ساخته شده باشد
============================================ */

async function trackUser(user, env, source = "interaction") {
  if (!user?.id || !env.DB) {
    return;
  }

  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `
      INSERT INTO users (
        id,
        first_name,
        last_name,
        username,
        language_code,
        is_premium,
        first_seen_at,
        last_seen_at,
        last_action
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
  } catch (error) {
    console.error("D1 Track Error:", error);
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
  "https://telegra.ph/%D8%AA%D8%AE%D9%81%DB%8C%D9%81%E2%80%8C%D9%87%D8%A7-%D9%88-%D8%AD%D9%85%D8%A7%DB%8C%D8%AA%E2%80%8C%D9%87%D8%A7%DB%8C-%D9%88%DB%8C%DA%98%D9%87-%D8%AF%D8%A7%D9%86%D8%B4%D8%AC%D9%88%DB%8C%D8%A7%D9%87%D8%A7%DB%8C-%D8%AF%D8%A7%D9%86%D8%B4%DA%AF%D8%A7%D9%87-%D9%BE%DB%8C%D8%A7%D9%85-%D9%86%D9%88%D8%B1-08-21";

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

1️⃣ <b>نصب و ورود به اپلیکیشن ۷۲۴</b>

2️⃣ <b>انتخاب بخش شهریه دانشگاه پیام نور</b>

3️⃣ <b>وارد کردن کد ملی و شماره دانشجویی</b>

4️⃣ <b>مشاهده مبلغ بدهی</b>

5️⃣ <b>انجام پرداخت</b>

⚠️ اعمال تراکنش انجام شده از طریق سامانه ۷۲۴ در سامانه گلستان ممکن است تا <b>یک روز کاری</b> زمان ببرد.`;

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

// ==========================================
// تنظیمات و متون کامل ماژول انتخاب واحد
// ==========================================

const UNIT_FAQ_TELEGRAPH_URL = "https://telegra.ph/%D9%BE%D8%B1%D8%B3%D8%B4%E2%80%8C%D9%87%D8%A7%DB%8C-%D9%85%D8%AA%D8%AF%D8%A7%D9%88%D9%84-%D8%A7%D9%86%D8%AA%D8%AE%D8%A7%D8%A8-%D9%88%D8%A7%D8%AD%D8%AF-08-26";

const UNIT_GUIDE_VIDEOS = [
  { id: "unit_vid_1", messageId: 23, channel: "@PNUniNet" },
  { id: "unit_vid_2", messageId: 24, channel: "@PNUniNet" },
  { id: "unit_vid_3", messageId: 35, channel: "@PNUniNet" }
];

function unitMainMenuText() {
  const body = [
    "🎓 *راهنمای جامع انتخاب واحد دانشگاه پیام نور*",
    "انتخاب واحد یکی از مهم‌ترین مراحل آموزشی دانشجویان دانشگاه پیام نور است که پیش از آغاز هر نیمسال تحصیلی انجام می‌شود.",
    "",
    "*زمان انتخاب واحد*",
    "دانشگاه پیام نور معمولاً در سه بازه آموزشی امکان انتخاب واحد را فعال می‌کند:",
    "🔹 *نیمسال اول* (معمولاً در اواسط شهریورماه)",
    "🔹 *نیمسال دوم* (معمولاً اواخر دی یا اوایل بهمن)",
    "🔹 *ترم تابستان* (اختیاری و با تعداد درس‌های ارائه‌شده محدودتر)",
    "بازه انتخاب واحد معمولاً حدود *یک هفته تا ده روز* است و ممکن است تمدید هم شود. پس از انتخاب واحد نیز معمولاً یک بازه برای *حذف و اضافه* در نظر گرفته می‌شود.",
    "________________________________________",
    "*سامانه انتخاب واحد پیام نور*",
    "تمام امور مهم آموزشی، از جمله انتخاب واحد، حذف و اضافه، پرداخت شهریه، مشاهده نمرات و دریافت گزارش‌ها، در *سامانه جامع گلستان* انجام می‌شود:",
    "📱 ورود با موبایل ممکن است، اما برای جلوگیری از خطا یا ثبت اشتباه، *استفاده از لپ‌تاپ یا کامپیوتر و اینترنت پایدار* توصیه می‌شود. همچنین، لطفاً در طول انجام این فعالیت، اتصال فیلترشکن خود را قطع نمایید",
    "________________________________________",
    "⫶☰ *چک‌لیست ضروری قبل از انتخاب واحد*",
    "پیش از باز شدن زمان انتخاب واحد، این موارد را آماده کنید:",
    "1) *بررسی وضعیت مالی و پرداخت شهریه*",
    "معمولاً تا زمانی که *شهریه ثابت و بدهی‌های قبلی* پرداخت نشده باشد، منوی ثبت‌نام برای دانشجو فعال نمی‌شود.",
    "برای اطلاعات از جزئیات شهریه و پرداخت آن به قسمت پرداخت شهریه مراجعه کنید",
    "",
    "2) **بررسی نمرات ترم قبل**",
    "نمرات و معدل خود را بررسی کنید، مخصوصاً اگر:",
    "• درسی را مردود شده‌اید؛",
    "• احتمال مشروطی دارید؛",
    "• درسی که می‌خواهید بردارید پیش‌نیاز دارد.",
    "",
    "3) *دریافت لیست ارائه دروس*",
    "مهم‌ترین ابزارهای شما برای انتخاب واحد، *آخرین لیست ارائه دروس مرکز/رشته‌تان* _(گزارش 212)_ است که از مسیر زیر قابل مشاهده هست :",
    "`آموزش ← گزارش‌های آموزش ← درس‌های ترمی ← لیست دروس ارائه‌شده (ویژه دانشجو)`",
    "",
    "📋 *آماده‌کردن برنامه شخصی*",
    "قبل از ورود به بخش ثبت‌نام، روی کاغذ یا گوشی یادداشت کنید:",
    "• کد هر درس",
    "• شماره گروه",
    "• تعداد واحدها",
    "• جایگزین احتمالی در صورت پر شدن ظرفیت",
    "این کار، سرعت و دقت شما را بسیار بالا می‌برد.",
    "توصیه می‌شود تا حد امکان مطابق برنامه چارت هشت ترمه رشته خود پیش بروید، زیرا در بسیاری از موارد برنامه‌ریزی امتحانات نیز با توجه به همین ترتیب انجام می‌شود و احتمال تداخل امتحان کمتر خواهد بود.",
    "________________________________________",
    "*مراحل انتخاب واحد در سامانه گلستان*",
    "1️⃣ وارد *سامانه گلستان* شوید.",
    "4️⃣ از منوی اصلی به مسیر زیر بروید:",
    "`ثبت‌نام ← عملیات ثبت‌نام ← ثبت‌نام اصلی`",
    "5️⃣ در صفحه انتخاب واحد، شماره درس و شماره گروه را وارد کنید.",
    "6️⃣ درس‌ها را یکی‌یکی به فهرست خود اضافه کنید.",
    "7️⃣ پس از افزودن همه درس‌ها، گزینه بررسی تغییرات را بزنید.",
    "8️⃣ خطاهای احتمالی را برطرف کنید.",
    "9️⃣ در صورت نبود خطا، گزینه اعمال تغییرات را انتخاب کنید.",
    "🔟 در پایان، حتماً تأییدیه یا پرینت انتخاب واحد (گزارش 101) را دریافت و ذخیره کنید.",
    "❌ فقط اضافه‌کردن درس در صفحه کافی نیست؛ تا زمانی که اعمال تغییرات را نزنید، انتخاب واحد شما قطعی نشده است."
  ].join("\n");
  return withFooter(body, { includeSignature: true, includeSupportPrompt: true });
}

function unitRulesText() {
  const body = [
    "📢راهنمای جامع انتخاب واحد؛ نکات کلیدی که باید بدانید! 🎓",
    "",
    "📚 ۱) *قوانین پیش‌نیاز و هم‌نیاز*",
    "*پیش‌نیاز*: حتماً باید درس پیش‌نیاز را قبلاً پاس کرده باشید تا بتوانید درس بعدی را بردارید. (_مثال: ریاضی ۱ پیش‌نیاز ریاضی ۲ است)._",
    "*هم‌نیاز*: باید این درس را یا قبلاً گذرانده باشید، یا در همین ترم هم‌زمان با درس اصلی بردارید.",
    "⚠️ نکته: در صورت مردودی درس پیش‌نیاز، قوانین دانشگاه‌ها متفاوت است؛ قبل از هر اقدامی حتماً با کارشناس رشته مشورت کنید.",
    "",
    "🕌 ۲) *قانون دروس معارف*",
    "«در هر ترم، دانشجویان ملزم به اخذ *فقط یک درس (۲ واحدی)* از گروه معارف هستند (اخذ بیش از یک درس مجاز نیست). انتخاب واحد شما بدون درس معارف تکمیل نمی‌شود. برای مشاهده فهرست و قوانین دروس معارف، به بخش راهنمای «دروس معارف» مراجعه کنید.»",
    "",
    "📊 ۳) *سقف و کف واحدها*",
    "سقف و کف مجازِ شما بر اساس «معدل ترم قبل» و «وضعیت نظام‌وظیفه» تعیین می‌شود. برای اطلاع از جزئیات سقف مجاز خود، به بخش *سقف و کف انتخاب واحد* مراجعه کنید.",
    "",
    "📉 ۴) *دانشجویان مشروط*",
    "اگر معدل ترم قبل شما کمتر از ۱۲ است، مشروط محسوب می‌شوید و در ترم جاری حداکثر مجاز به اخذ ۱۴ واحد هستید.",
    "",
    "🎓 ۵) *دانشجوی ترم آخری*",
    "اگر حداکثر ۲۴ واحد تا پایان تحصیلتان باقی مانده، دانشجوی ترم آخر محسوب شده و از این مزایا برخوردارید:",
    "البته لازم است که قبل از انتخاب واحد در سامانه گلستان بایستی درخواست دانشجوی ترم آخر داده و توسط دانشگاه تایید شده باشید. برای اطلاع از جزئیات سقف مجاز خود، به بخش *دانشجوی ترم آخری* مراجعه کنید.",
    "",
    "⭐ امکان اخذ واحد تا سقف ۲۴ واحد (حتی در صورت مشروطی)",
    "⭐ مجوزِ اخذ دروسی که پیش‌نیاز آن‌ها را پاس نکرده‌اید",
    "⭐ حذف محدودیت تداخل امتحانی",
    "⭐ امکان اخذ درس از مراکز دیگر (در صورت عدم ارائه در مرکز مبدأ)",
    "",
    "📌 توصیه نهایی: پیش از شروع فرآیند، حتماً چارت درسی خود را چک کنید و اولویت‌بندی دروس را فراموش نکنید."
  ].join("\n");
  return withFooter(body, { includeSignature: true, includeSupportPrompt: true });
}

function unitTypesText() {
  const body = [
    "🎓 راهنمای جامع دروس کارشناسی در دانشگاه پیام‌نور",
    "",
    "⏳ طول دوره فارغ‌التحصیلی: معمولاً ۴ سال (۸ ترم)",
    "📚 میانگین واحدهای لازم: ۱۳۰ تا ۱۴۰ واحد",
    "",
    "〰️〰️〰️〰️〰️〰️",
    "",
    "📖 ۱. دسته‌بندی دروس از نظر محتوا",
    "دروس دانشگاهی معمولاً در ۴ گروه اصلی قرار می‌گیرند:",
    "",
    "🔹 دروس عمومی: مشترک بین همه رشته‌ها جهت ارتقای مهارت‌های عمومی و فرهنگی.",
    "├ ◽️ *غیرمعارفی:* فارسی، زبان خارجی، تربیت بدنی، ورزش، دفاع مقدس و...",
    "└ ◽️ *معارفی:* آیین زندگی، انقلاب اسلامی، دانش خانواده و... (این دروس قوانین خاص خود را دارند).",
    "👇 *برای مشاهده فهرست کامل و قوانین دروس معارف، روی دکمه شیشه‌ای پایین کلیک کنید.*",
    "",
    "🔹 دروس پایه: دروس زیربنایی که دانشجو را برای ورود به مباحث اصلی آماده می‌کنند (بخش زیادی از واحدها را شامل می‌شوند).",
    "🔹 دروس اصلی: ستون فقرات هر رشته که مفاهیم بنیادین را پوشش می‌دهند.",
    "🔹 دروس تخصصی: ویژه هر رشته و گرایش جهت آماده‌سازی برای بازار کار و تخصص عمیق‌تر.",
    "",
    "〰️〰️〰️〰️〰️〰️",
    "",
    "🧪 ۲. دسته‌بندی بر اساس نحوه ارائه",
    "",
    "👨‍🏫 تئوری (نظری): دارای محتوای تئوری که به صورت کلاس حضوری یا الکترونیکی ارائه می‌شوند.",
    "",
    "🛠 عملی: در آزمایشگاه، کارگاه یا محیط واقعی اجرا می‌شوند (مثل تربیت بدنی، پروژه و کارآموزی).",
    "",
    "🧩 تئوری–عملی: ترکیبی از مباحث نظری و تمرین عملی (نیمی از جلسات تئوری و نیمی عملی است؛ مثل نقشه‌کشی یا روش تحقیق).",
    "",
    "👤 بدون استاد: این دروس کلاس و نمره میان‌ترم ندارند و نمره نهایی مستقیماً از ۲۰ نمره پایان‌ترم محاسبه می‌شود (مثل حفظ جزء ۳۰ قرآن کریم یا آمادگی در برابر حوادث).",
    "",
    "〰️〰️〰️〰️〰️〰️",
    "",
    "⚖️ ۳. دسته‌بندی بر اساس الزام گذراندن",
    "",
    "🔴 دروس الزامی (اجباری): گذراندن آن‌ها برای اخذ مدرک قطعی است و قابل حذف یا جایگزینی نیستند (مگر از طریق معادل‌سازی).",
    "",
    "🟢 دروس اختیاری: (به دو دسته تقسیم می‌شوند) :",
    "۱. اختیاری تخصصی: باید تعداد مشخصی از آن‌ها را پاس کنید، اما انتخاب درس به دلخواه شماست.",
    "> 💻 *مثال (مهندسی کامپیوتر):* اخذ ۸ واحد اختیاری الزامی است، اما دانشجو می‌تواند این ۸ واحد را از بین ۱۷ درس متنوع (آزمون نرم‌افزار • ایجاد چابک نرم‌افزار • مبانی هوش محاسباتی • مبانی ساخت بازی‌های رایانه‌ای • برنامه‌سازی وب • برنامه‌سازی موبایل • تجارت الکترونیکی • مبانی رایانش ابری • مبانی اینترنت اشیا • مدیریت و برنامه‌ریزی راهبردی فناوری اطلاعات • کارآفرینی • مفاهیم پیشرفته کامپیوتر • مفاهیم پیشرفته کامپیوتر ۲ • انتقال داده‌ها • مقدمه‌ای بر بیوانفورماتیک • آزمایشگاه مهندسی نرم‌افزار • کارگاه ساخت بازی‌های رایانه‌ای) انتخاب کند.",
    "",
    "۲. اختیاری عمومی: کاملاً به اختیار دانشجو است. مازاد بر سقف واحدهای دوره در کارنامه ثبت شده و در معدل تأثیر دارد.",
    "> 💡 *نمونه‌ها:* حقوق شهروندی، مکتب شهید سلیمانی، مهارت‌های زندگی دانشجویی، پدافند غیرعامل و...",
    "",
    "〰️〰️〰️〰️〰️〰️",
    "",
    "📌 نکات بسیار مهم برای انتخاب واحد:",
    "",
    "✅ همواره بر اساس چارت رشته خود انتخاب واحد کنید.",
    "✅ رعایت پیش‌نیاز و هم‌نیاز الزامی است (پیش‌نیاز هر درس در چارت مقابل آن قید شده است).",
    "✅ محدودیتی برای تعداد واحدهای پایه در یک ترم وجود ندارد، فقط باید پیش‌نیازها رعایت شوند.",
    "✅ نیازی نیست تمام دروس اختیاریِ چارت را اخذ کنید؛ فقط به اندازه «سقف تعیین شده» انتخاب کنید."
  ].join("\n");
  return withFooter(body, { includeSignature: true, includeSupportPrompt: true });
}

function unitMaarefText() {
  const body = [
    "📢 *راهنمای جامع و لیست دروس معارف مقطع کارشناسی (دانشگاه پیام نور)*",
    "",
    "دانشجویان مقطع کارشناسی موظفند در طول دوران تحصیل خود *۷ عنوان درس معارفی (در مجموع ۱۴ واحد)* را بگذرانند.",
    "",
    "📌 *قوانین کلی اخذ دروس معارف:*",
    "🔸 در هر نیمسال تحصیلی، دانشجویان مجاز به اخذ *فقط یک عنوان درس* از گروه معارف (۲ واحد) هستند.",
    "🔸 دانشجویان اقلیت‌های دینی می‌توانند دروس مورد نظر خود را بدون محدودیت از بین تمامی دروس عمومی معارف انتخاب کنند.",
    "",
    "➖➖➖➖➖➖➖➖",
    "📋 *گروه‌بندی و لیست دروس معارف:*",
    "*(دانشجویان باید از ۵ گرایش زیر، دروس خود را تکمیل کنند)*",
    "",
    "۱️⃣ *گروه مبانی نظری اسلام:*",
    "📗 اندیشه اسلامی ۱",
    "📗 اندیشه اسلامی ۲",
    "⚠️ *(گذراندن هر ۲ درس الزامی است)*",
    "",
    "۲️⃣ *گروه اخلاق اسلامی:*",
    "📒 آیین زندگی (اخلاق کاربردی)",
    "📒 اخلاق اسلامی (مبانی و مفاهیم)",
    "📒 فلسفه اخلاق (با تکیه بر مباحث تربیتی)",
    "⚠️ *(گذراندن یکی از این ۳ درس به انتخاب دانشجو الزامی است)*",
    "",
    "۳️⃣ *گروه انقلاب اسلامی:*",
    "📕 آشنایی با قانون اساسی جمهوری اسلامی ایران",
    "📕 انقلاب اسلامی ایران",
    "📕 اندیشه سیاسی امام خمینی",
    "⚠️ *(گذراندن یکی از این ۳ درس به انتخاب دانشجو الزامی است)*",
    "",
    "۴️⃣ *گروه آشنایی با منابع اسلامی:*",
    "📖 تفسیر موضوعی قرآن",
    "📖 تفسیر موضوعی نهج البلاغه",
    "⚠️ *(گذراندن یکی از این ۲ درس به انتخاب دانشجو الزامی است)*",
    "",
    "۵️⃣ *دروس الزامی و مستقل:*",
    "📔 فرهنگ و تمدن اسلامی",
    "📘 دانش خانواده و جمعیت",
    "⚠️ *(گذراندن هر ۲ درس الزامی است)*",
    "",
    "➖➖➖➖➖➖➖➖",
    "🎓 *شرایط دانشجویان ترم آخر:*",
    "اگر دانشجوی ترم آخر :",
    "📚 حداکثر *۳ درس معارف* باقی‌مانده داشته باشد، می‌تواند هر سه درس را در همان نیمسال انتخاب کند و فارغ‌التحصیل شود.",
    "📚 *۴ یا ۵ درس معارف* باقی‌مانده داشته باشد، می‌تواند سه درس را در نیمسال جاری انتخاب کرده و درس‌های باقی‌مانده را در نیمسال بعد به‌صورت *معرفی به استاد* بگذراند.",
    "📚 *۶ درس معارف* باقی‌مانده داشته باشد، می‌تواند چهار درس را در نیمسال جاری انتخاب کرده و دو درس باقی‌مانده را در نیمسال بعد به‌صورت *معرفی به استاد* بگذراند.",
    "",
    "❌ *یک نکته مهم:*",
    "درس «حفظ جزء ۳۰ قرآن کریم» جزء گروه معارف *نمی‌باشد*. اخذ این درس کاملاً اختیاری است و تاثیری در سقف دروس معارفی ندارد و فاقد شهریه می‌باشد."
  ].join("\n");
  return withFooter(body, { includeSignature: true, includeSupportPrompt: true });
}

function unitSummerText() {
  const body = [
    "☀️ *ترم تابستان*",
    "ترم تابستان فرصتی اختیاری برای جبران دروس، تسریع روند تحصیل و فارغ‌التحصیلی دانشجویان است. ثبت‌نام و انتخاب واحد به‌صورت اینترنتی و از طریق سامانه جامع گلستان دانشگاه پیام نور (همانند انتخاب واحد اصلی) انجام می‌شود",
    "",
    "📆 این اطلاعات بر مبنای ترم تابستان *سال ۱۴۰۵* تهیه شده‌اند و ممکن است برخی از مفاد آن در ترم‌های بعدی تغییر کنند.",
    "",
    "مزایای ترم تابستان",
    "✅ پاس‌کردن برخی دروس عمومی یا پایه",
    "✅ کاهش فشار در ترم‌های مهر و بهمن",
    "✅ جبران دروس باقی‌مانده",
    "✅ کمک به فارغ‌التحصیلی زودتر",
    "",
    "نکات و محدودیت‌ها",
    "⚠️ زمان آموزش و امتحانات فشرده‌تر است.",
    "⚠️ همه دروس، مخصوصاً دروس تخصصی، لزوماً در تابستان ارائه نمی‌شوند.",
    "⚠️ انتخاب تعداد زیاد درس‌های سنگین در تابستان ریسک افت تحصیلی را بالا می‌برد.",
    "⚠️ حتماً برنامه امتحانات را قبل از ثبت نهایی بررسی کنید.",
    "",
    "📖 دروس قابل ارائه",
    "🔹 دروس کاملاً نظریِ دارای منبع درسی، برای دانشجویان مقطع کارشناسی پیوسته از ترم ششم به بالا",
    "🔹 دروس «تربیت بدنی»، «ورزش ۱»، «تربیت بدنی ویژه» و «ورزش ویژه» برای دانشجویان دارای شرایط خاص",
    "🔹 دروس کارآموزی، کارورزی و پروژه در مقطع کارشناسی",
    "🔹 درس‌های «حفظ جزء سی‌ام قرآن کریم» و «آمادگی در برابر حوادث و سوانح»",
    "🔹 دروس عمومی: فارسی، زبان خارجی، علوم و معارف دفاع مقدس و مقاومت",
    "🔹 دروس معارف اسلامی: فرهنگ و تمدن اسلام و ایران، اندیشه اسلامی ۲، دانش خانواده و جمعیت",
    "🔹 تمدید پایان‌نامه ادامه‌دارِ مقطع کارشناسی ارشد، صرفاً برای دفاع",
    "",
    "🎓 *سقف انتخاب واحد*",
    "✅ سقف انتخاب واحد دانشجویان مقطع کارشناسی ، *حداکثر ۹ واحد* است.",
    "✅ از میان واحدهای انتخابی، حداکثر *یک عنوان درس معارف اسلامی* قابل اخذ است.",
    "✅ رعایت پیش‌نیاز و هم‌نیاز دروس الزامی است.",
    "✅ شرکت در ترم تابستان کاملاً *اختیاری* است.",
    "❌ حذف و اضافه دروس در دوره تابستان امکانپذیر نیست."
  ].join("\n");
  return withFooter(body, { includeSignature: true, includeSupportPrompt: true });
}


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
    .replace(/[۰-۹]/g, (digit) => String(faNums.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arNums.indexOf(digit)));
}

function normalizeInput(value) {
  return normalizeFaDigits(value)
    .replace(/[٫،٬]/g, ".")
    .replace(/[\/,]/g, ".")
    .trim();
}

function buildUrl(raw) {
  if (!raw) {
    return "";
  }

  const value = String(raw).trim();

  if (!value) {
    return "";
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
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
  const {
    includeSignature = false,
    includeSupportPrompt = false,
  } = options;

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
    [{ text: "🗓️ تقویم آموزشی", callback_data: "calendar:show" }],
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

function golestanMenuKeyboard() {
  return resultKeyboard("menu", [
    [{ text: "🌐 آدرس سامانه گلستان", callback_data: "golestan:address" }],
    [
      {
        text: "📚 راهنمای سامانه گلستان",
        callback_data: "golestan:manual:menu",
      },
    ],
    [{ text: "📹 راهنمای تصویری گلستان", callback_data: "golestan:guide" }],
  ]);
}

/* =========================
   Golestan Manual data + keyboards
========================= */

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
        text: "🧾 حذف و اضافه\n\n(توضیحات این بخش بعداً اضافه می‌شود.)",
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
        text: "🗂️ تمام گزارش‌ها و پردازش‌ها",
        callback_data: "golestan:manual:section:reports",
      },
    ],
  ]);
}

function golestanManualSectionKeyboard(sectionId) {
  const section = GOLESTAN_MANUAL_SECTIONS.find(
    (item) => item.id === sectionId
  );

  const rows = (section?.items || []).map((item) => [
    {
      text: item.title,
      callback_data: `golestan:manual:item:${sectionId}:${item.id}`,
    },
  ]);

  return resultKeyboard("golestan:manual:menu", rows);
}

function tuitionMenuKeyboard() {
  return resultKeyboard("golestan:manual:section:edu", [
    [
      {
        text: "🎥 فیلم آموزشی پرداخت شهریه",
        callback_data: "tuition:video",
      },
    ],
    [
      {
        text: "📊 جدول مبالغ شهریه",
        callback_data: "tuition:fees_table",
      },
    ],
    [
      {
        text: "📱 اپلیکیشن ۷۲۴",
        callback_data: "tuition:app724",
      },
    ],
    [
      {
        text: "🎁 تخفیف‌ها و حمایت‌های ویژه",
        url: TUITION_DISCOUNTS_IV_URL,
      },
    ],
    [
      {
        text: "❓ پرسش‌های متداول پرداخت شهریه",
        url: TUITION_FAQ_IV_URL,
      },
    ],
  ]);
}

// ==========================================
// کیبوردهای ماژول انتخاب واحد
// ==========================================

function unitMainMenuKeyboard() {
  return resultKeyboardWithSupport("golestan:manual:section:edu", [
    [
      { text: "🎥 ویدئوهای آموزشی انتخاب واحد", callback_data: "unit:videos" },
      { text: "⚖️ قوانین انتخاب واحد", callback_data: "unit:rules" }
    ],
    [
      { text: "📖 انواع دروس", callback_data: "unit:types" },
      { text: "🕌 دروس معارف", callback_data: "unit:maaref" }
    ],
    [
      { text: "☀️ ترم تابستان", callback_data: "unit:summer" },
      { text: "🎓 کف و سقف انتخاب واحد", callback_data: "unit:start" }
    ],
    [
      { text: "📊 چارت هشت ترمه", callback_data: "chart:start" },
      { text: "❓ پرسش‌های متداول انتخاب واحد", url: UNIT_FAQ_TELEGRAPH_URL }
    ],
    [
      { text: "💳 پرداخت شهریه", callback_data: "tuition:start" }
    ]
  ]);
}

function unitRulesKeyboard() {
  return resultKeyboardWithSupport("unit:menu", [
    [
      { text: "🕌 دروس معارف", callback_data: "unit:maaref" },
      { text: "🎓 کف و سقف انتخاب واحد", callback_data: "unit:start" }
    ],
    [
      { text: "🎓 دانشجوی ترم آخری", callback_data: "unit:start" },
      { text: "📊 چارت هشت ترمه", callback_data: "chart:start" }
    ]
  ]);
}

function unitTypesKeyboard() {
  return resultKeyboardWithSupport("unit:menu", [
    [
      { text: "🕌 دروس معارف", callback_data: "unit:maaref" },
      { text: "📊 چارت هشت ترمه", callback_data: "chart:start" }
    ]
  ]);
}

function unitMaarefKeyboard() {
  return resultKeyboardWithSupport("unit:menu", [
    [
      { text: "⚖️ قوانین انتخاب واحد", callback_data: "unit:rules" },
      { text: "📖 انواع دروس", callback_data: "unit:types" }
    ]
  ]);
}

function unitSummerKeyboard() {
  return resultKeyboardWithSupport("unit:menu", [
    [
      { text: "🎓 کف و سقف انتخاب واحد", callback_data: "unit:start" },
      { text: "🕌 دروس معارف", callback_data: "unit:maaref" }
    ]
  ]);
}

function unitAfterVideosKeyboard() {
  return resultKeyboardWithCafeNet("unit:menu", [
    [
      { text: "⚖️ قوانین انتخاب واحد", callback_data: "unit:rules" },
      { text: "❓ پرسش‌های متداول انتخاب واحد", url: UNIT_FAQ_TELEGRAPH_URL }
    ]
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
    {
      text: item.name,
      url: item.url,
    },
  ]);

  rows.push([
    {
      text: "✅ موارد بالا رو عضو شدم",
      callback_data: "join:check",
    },
  ]);

  return rows;
}

/* =========================
   Telegram API
========================= */

async function tgCall(method, token, payload) {
  if (!token || !method) {
    console.error("Telegram API call is missing token or method.");
    return false;
  }

  try {
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
        description.toLowerCase().includes("message is not modified")
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
  } catch (error) {
    console.error(`Telegram ${method} request error:`, error);
    return false;
  }
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
    commands: [
      {
        command: "start",
        description: "🏠 بازگشت به منوی اصلی",
      },
    ],
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

async function sendReplyKeyboardMessage(
  chatId,
  text,
  token,
  isRaw = false
) {
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
  if (!callbackQueryId) {
    return false;
  }

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
   Unified Video Sender
   استفاده از copyMessage باعث حذف عبارت Forwarded from می‌شود
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
  protectContent = false
) {
  const body = {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  };

  if (caption !== null && caption !== undefined) {
    body.caption = String(caption);
  }

  if (parseMode && body.caption) {
    body.parse_mode = parseMode;
  }

  if (inlineKeyboard) {
    body.reply_markup = {
      inline_keyboard: inlineKeyboard,
    };
  }

  if (protectContent === true) {
    body.protect_content = true;
  }

  return tgCall("copyMessage", token, body);
}

function resultKeyboardWithCafeNet(backData, extraRows = []) {
  return resultKeyboard(backData, [
    ...extraRows,
    [{ text: "🖨 پیام به کافی نت", callback_data: "cafenet:start" }],
  ]);
}
/* =========================
   Keyboards & Video Builders
========================= */

function resultKeyboardWithSupportAndCafeNet(backData, extraRows = []) {
  return resultKeyboard(backData, [
    ...extraRows,
    [{ text: "📨 ارسال پرسش و پیام", callback_data: "support:start" }],
    [{ text: "🖨 پیام به کافی نت", callback_data: "cafenet:start" }],
  ]);
}

function buildVideoKeyboard(backData, cfg = {}) {
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

  if (title) {
    parts.push(`<b>${escapeHtml(title)}</b>`);
  }

  for (const b of blocks) {
    if (b) parts.push(b);
  }

  const base = parts.filter(Boolean).join("\n\n");

  return withFooter(base, { includeSignature, includeSupportPrompt: false });
}

async function sendGuideVideo(env, chatId, cfg, backData) {
  const copyResult = await copyMessageWithCaption(
    chatId,
    cfg.fromChatId || SUPPORT_CHANNEL_ID,
    cfg.messageId,
    env.BOT_TOKEN,
    null,
    null,
    null,
    false
  );

  if (!copyResult || !copyResult.ok || !copyResult.result) {
    return false;
  }

  const videoMsgId = copyResult.result.message_id;
  const keyboard = buildVideoKeyboard(backData, cfg);

  const textBlocks = cfg.blocks || [];
  const finalText =
    textBlocks.filter(Boolean).join("\n\n") ||
    "در صورت داشتن سوال، از طریق دکمه‌های زیر اقدام فرمایید.";

  const msgResult = await tgCall("sendMessage", env.BOT_TOKEN, {
    chat_id: chatId,
    text: rtl(finalText),
    reply_to_message_id: videoMsgId,
    allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: keyboard },
  });

async function sendUnitRegistrationVideos(chatId, env) {
  for (const video of UNIT_GUIDE_VIDEOS) {
    await copyMessageWithCaption(
      chatId,
      video.channel,
      video.messageId,
      env.BOT_TOKEN,
      null,
      null
    );
  }
  await sendMessage(
    chatId,
    tuitionCafeNetPromptText(),
    env.BOT_TOKEN,
    unitAfterVideosKeyboard()
  );
}



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
    const match = normalizedText.match(/(?:🔢\s*)?ID:\s*([0-9]+)/i);

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
   Callback Handlers (Part 3)
========================= */

async function handleCallback(callbackQuery, env) {
  const callbackId = callbackQuery?.id;

  try {
    return await handleCallbackCore(callbackQuery, env);
  } catch (error) {
    console.error("handleCallback error:", error);

    if (callbackId) {
      await answerCallbackQuery(
        callbackId,
        env.BOT_TOKEN,
        "⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.",
        true
      ).catch(() => {});
    }

    return false;
  }
}

async function handleCallbackCore(callbackQuery, env) {
  const data = String(callbackQuery?.data || "");
  const callbackId = callbackQuery?.id;
  const callbackUserId = callbackQuery?.from?.id;
  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;

  if (!callbackId) {
    return false;
  }

  // ثبت تعامل در دیتابیس D1 بدون مسدود کردن جریان اجرای برنامه
  await Promise.resolve(
    trackUser(callbackQuery.from, env, `cb:${data}`)
  ).catch((error) => {
    console.error("Callback tracking failed:", error);
  });

  if (!callbackUserId || !chatId || !messageId) {
    await answerCallbackQuery(callbackId, env.BOT_TOKEN).catch(() => {});
    return false;
  }

  // بررسی گیت عضویت اجباری
  if (!isAdminChat(chatId, env) && data !== "join:check") {
    const isAllowed = await enforceMembershipGate(callbackUserId, env.BOT_TOKEN);

    if (!isAllowed) {
      await answerCallbackQuery(
        callbackId,
        env.BOT_TOKEN,
        "ابتدا عضویت خود را در کانال‌ها کامل کنید.",
        true
      ).catch(() => {});
      return false;
    }
  }

  // ۱. بررسی تایید عضویت
  if (data === "join:check") {
    const missing = await getMissingMemberships(callbackUserId, env.BOT_TOKEN);

    if (missing.length > 0) {
      await answerCallbackQuery(
        callbackId,
        env.BOT_TOKEN,
        "هنوز در همه موارد عضو نشده‌اید.",
        true
      ).catch(() => {});

      await sendMessage(
        chatId,
        JOIN_REQUIRED_INTRO,
        env.BOT_TOKEN,
        joinRequiredKeyboard(),
        true
      );

      return false;
    }

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "✅ عضویت شما تایید شد.").catch(() => {});

    await Promise.allSettled([
      setBotCommands(env.BOT_TOKEN),
      setBotMenuButton(env.BOT_TOKEN),
      ensurePersistentKeyboard(chatId, env.BOT_TOKEN),
    ]);

    await editMessage(
      chatId,
      messageId,
      JOIN_SUCCESS_TEXT,
      env.BOT_TOKEN,
      mainMenuKeyboard(),
      true
    );

    return true;
  }

  // ۲. منوی اصلی
  if (data === "menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🏠 بازگشت به منوی اصلی").catch(() => {});
    await showMainMenu(chatId, env.BOT_TOKEN, true, messageId, "🏠 منوی اصلی");
    return true;
  }

  // ۳. منوی محاسبات
  if (data === "menu:calculations" || data === "score:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🧮 محاسبات").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "🧮 محاسبات\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      calculationsKeyboard(),
      true
    );
    return true;
  }

  // ۴. درباره ما
  if (data === "about:show") {
    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🤖 معرفی ربات").catch(() => {});

    const text = [
      "🤖 معرفی ربات",
      "",
      "ربات دانشجویی دانشگاه پیام نور",
      `نسخه: ${fa("۱.۱.۱")}`,
      `تاریخ بروزرسانی: ${fa("۱۴۰۵/۰۵/۲۲")}`,
      `منطبق با: نیمسال تابستان ${fa("۱۴۰۵")}`,
    ].join("\n");

    await editMessage(chatId, messageId, text, env.BOT_TOKEN, resultKeyboard("menu"));
    return true;
  }

  // ۵. فرم‌های پشتیبانی و کافی‌نت
  if (data === "support:start") {
    userStates.set(chatId, { step: "support_waiting_message" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📨 ارسال پرسش و پیام").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      SUPPORT_TEXT,
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );
    return true;
  }

  if (data === "cafenet:start") {
    userStates.set(chatId, { step: "cafenet_waiting_message" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🖨 پیام به کافی نت").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      CAFE_NET_TEXT,
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );
    return true;
  }

    // Callbackهای ماژول انتخاب واحد
    if (data === "unit:menu") {
      await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🎓 راهنمای جامع انتخاب واحد").catch(() => {});
      return editMessage(chatId, messageId, unitMainMenuText(), env.BOT_TOKEN, unitMainMenuKeyboard(), false, "HTML");
    }

    if (data === "unit:rules") {
      await answerCallbackQuery(callbackId, env.BOT_TOKEN, "⚖️ قوانین انتخاب واحد").catch(() => {});
      return editMessage(chatId, messageId, unitRulesText(), env.BOT_TOKEN, unitRulesKeyboard());
    }

    if (data === "unit:types") {
      await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📖 انواع دروس").catch(() => {});
      return editMessage(chatId, messageId, unitTypesText(), env.BOT_TOKEN, unitTypesKeyboard());
    }

    if (data === "unit:maaref") {
      await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🕌 دروس معارف").catch(() => {});
      return editMessage(chatId, messageId, unitMaarefText(), env.BOT_TOKEN, unitMaarefKeyboard());
    }

    if (data === "unit:summer") {
      await answerCallbackQuery(callbackId, env.BOT_TOKEN, "☀️ ترم تابستان").catch(() => {});
      return editMessage(chatId, messageId, unitSummerText(), env.BOT_TOKEN, unitSummerKeyboard());
    }

    if (data === "unit:videos") {
      await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🎥 در حال ارسال ویدئوهای آموزشی...").catch(() => {});
      return sendUnitRegistrationVideos(chatId, env);
    }


  // ۶. بخش شهریه (فیلم، جدول و اپلیکیشن)
  if (data === "tuition:video") {
    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🎥 فیلم آموزشی پرداخت شهریه").catch(() => {});

    const copied = await copyMessageWithCaption(chatId, "@PNUniNet", 25, env.BOT_TOKEN);

    if (!copied?.ok || !copied?.result) {
      await sendMessage(
        chatId,
        "⚠️ امکان ارسال فیلم آموزشی در حال حاضر وجود ندارد.\nلطفاً کمی بعد دوباره تلاش کنید.",
        env.BOT_TOKEN,
        resultKeyboard("golestan:manual:item:edu:tuition"),
        true
      );
      return false;
    }

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

    await sendMessage(chatId, CAFE_NET_TEXT, env.BOT_TOKEN, kb, true);
    return true;
  }

  if (data === "tuition:fees_table") {
    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📊 جدول مبالغ شهریه").catch(() => {});

    const copied = await copyMessageWithCaption(chatId, "@PNUniNet", 43, env.BOT_TOKEN);

    if (!copied?.ok || !copied?.result) {
      await sendMessage(
        chatId,
        "⚠️ امکان ارسال جدول شهریه در حال حاضر وجود ندارد.\nلطفاً کمی بعد دوباره تلاش کنید.",
        env.BOT_TOKEN,
        resultKeyboard("golestan:manual:item:edu:tuition"),
        true
      );
      return false;
    }

    await sendMessage(
      chatId,
      "برای بازگشت از دکمه زیر استفاده کنید.",
      env.BOT_TOKEN,
      resultKeyboard("golestan:manual:item:edu:tuition"),
      true
    );
    return true;
  }

  if (data === "tuition:app724") {
    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📱 اپلیکیشن ۷۲۴").catch(() => {});

    await editMessage(
      chatId,
      messageId,
      TUITION_724_TEXT,
      env.BOT_TOKEN,
      resultKeyboard("golestan:manual:item:edu:tuition"),
      false,
      "HTML"
    );
    return true;
  }

  // ۷. وام دانشجویی
  if (data === "loan:show") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "💰 وام دانشجویی").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "💰 اطلاعات این بخش به‌زودی تکمیل می‌شود.",
      env.BOT_TOKEN,
      resultKeyboard("menu"),
      true
    );
    return true;
  }

  // ۸. ارتباط با ما و پیام ادمین
  if (data === "contact:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📞 ارتباط با ما").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "📞 ارتباط با ما\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      contactMenuKeyboard(),
      true
    );
    return true;
  }

  if (data === "contact:feedback") {
    userStates.set(chatId, { step: "contact_waiting_feedback" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📝 ارسال پیشنهاد و انتقاد").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "📝 لطفاً پیشنهاد یا انتقاد خود را در یک پیام ارسال کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );
    return true;
  }

  if (data === "contact:admin") {
    userStates.set(chatId, { step: "contact_waiting_admin_msg" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "💬 ارتباط مستقیم با ادمین").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "💬 لطفاً پیام خود را برای ادمین ارسال کنید.",
      env.BOT_TOKEN,
      resultKeyboard("contact:menu"),
      true
    );
    return true;
  }

  // ۹. راهنماهای محاسبات (نمره تئوری، عملی، تستی و معدل)
  if (data === "score:theory:help") {
    userStates.set(chatId, { step: "score_waiting_theory" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📘 راهنمای نمره نهایی").catch(() => {});
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
    return true;
  }

  if (data === "score:mix:help") {
    userStates.set(chatId, { step: "score_waiting_mix" });

    await answerCallbackQuery(callbackQuery.id, env.BOT_TOKEN, "📗 راهنمای محاسبه تئوری/عملی").catch(() => {});
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
    return true;
  }

  if (data === "test:help") {
    userStates.set(chatId, { step: "score_waiting_test" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🧪 راهنمای محاسبه نمره تستی").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      ["🧪 محاسبه نمره تستی", "", "فرمت:", "S K", "", "مثال:", "22 30"].join("\n"),
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );
    return true;
  }

  if (data === "gpa:help") {
    userStates.set(chatId, { step: "gpa_waiting_lines" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📚 راهنمای محاسبه معدل").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "📚 محاسبه معدل\n\nهر درس را در یک خط وارد کنید:\nT N\n\nنمونه:\n۲ ۱۵٫۵\n۳ ۱۶٫۷۵\n۱ ۱۳",
      env.BOT_TOKEN,
      resultKeyboard("menu:calculations"),
      true
    );
    return true;
  }

  // ۱۰. سامانه LMS (ریلاین)
  if (data === "lms:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🌐 سامانه آموزش مجازی").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "🌐 سامانه آموزش مجازی\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      lmsMainKeyboard(),
      true
    );
    return true;
  }

  if (data === "lms:provinces") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📍 آدرس ریلاین استانی").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "🌐 سامانه آموزش مجازی\n\n📍 استان موردنظر را انتخاب کنید:",
      env.BOT_TOKEN,
      lmsMenuKeyboardAllInOne(),
      true
    );
    return true;
  }

  if (data === "lms:guide") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📹 راهنمای تصویری ریلاین").catch(() => {});

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
      "📹 راهنمای تصویری ریلاین\n\nیکی از موضوعات زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      keyboard,
      true
    );
    return true;
  }

  if (data.startsWith("lms:guide:video:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN).catch(() => {});

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
      return false;
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
        "⚠️ امکان ارسال ویدیو وجود ندارد.\n\nبرای مشاهده، ابتدا در کانال پیام نوری عضو شوید:",
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

    return true;
  }

  if (data.startsWith("lms:province:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN).catch(() => {});

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
      return false;
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
    return true;
  }

  // ۱۱. سامانه گلستان
  if (data === "golestan:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🏛 سامانه گلستان").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "🏛 سامانه گلستان\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      golestanMenuKeyboard(),
      true
    );
    return true;
  }

  if (data === "golestan:manual:menu") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📚 راهنمای سامانه گلستان").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "📚 راهنمای سامانه گلستان\n\nیکی از بخش‌های زیر را انتخاب کنید:",
      env.BOT_TOKEN,
      golestanManualMenuKeyboard(),
      true
    );
    return true;
  }

  if (data.startsWith("golestan:manual:section:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN).catch(() => {});

    const sectionId = data.split(":").pop();
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
      return false;
    }

    await editMessage(
      chatId,
      messageId,
      `📚 راهنمای سامانه گلستان\n\n${section.title}\n\nیکی از موارد زیر را انتخاب کنید:`,
      env.BOT_TOKEN,
      golestanManualSectionKeyboard(sectionId),
      true
    );
    return true;
  }

  // صفحه اختصاصی پرداخت شهریه
  if (data === "golestan:manual:item:edu:tuition") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN).catch(() => {});
    await editMessage(
      chatId,
      messageId,
      TUITION_GUIDE_TEXT,
      env.BOT_TOKEN,
      tuitionMenuKeyboard(),
      false,
      "HTML"
    );
    return true;
  }

  // نمایش آیتم‌های عمومی راهنمای گلستان
  if (data.startsWith("golestan:manual:item:")) {
    userStates.delete(chatId);

    const [, , , sectionId, itemId] = data.split(":");

    // اگر انتخاب واحد کلیک شده باشد
    if (sectionId === "edu" && itemId === "unit_select") {
      await answerCallbackQuery(
        callbackId,
        env.BOT_TOKEN,
        "🎓 راهنمای جامع انتخاب واحد"
      ).catch(() => {});

      return editMessage(
        chatId,
        messageId,
        unitMainMenuText(),
        env.BOT_TOKEN,
        unitMainMenuKeyboard()
        false,
        "HTML"
      );
    }

    await answerCallbackQuery(callbackId, env.BOT_TOKEN).catch(() => {});

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
      return false;
    }

    await editMessage(
      chatId,
      messageId,
      item.text,
      env.BOT_TOKEN,
      resultKeyboard(`golestan:manual:section:${sectionId}`),
      true
    );
    return true;
  }


  if (data === "golestan:address") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🌐 آدرس سامانه گلستان").catch(() => {});

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
    return true;
  }

  if (data === "golestan:guide") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📹 راهنمای تصویری گلستان").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "📹 راهنمای تصویری گلستان\n\nاین بخش بعداً تکمیل می‌شود.",
      env.BOT_TOKEN,
      resultKeyboard("golestan:menu"),
      true
    );
    return true;
  }

  // ۱۲. منابع و چارت دروس
  if (data === "refs:start") {
    userStates.set(chatId, { step: "refs_waiting_major" });

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📘 چارت، منابع و حذفیات ترم").catch(() => {});
    await editMessage(
      chatId,
      messageId,
      "📘 چارت هشت ترمه، منابع و حذفیات ترم\n\n✍️ لطفاً نام رشته‌تان را ارسال کنید.\nمثال: مهندسی کامپیوتر",
      env.BOT_TOKEN,
      resultKeyboard("menu"),
      true
    );
    return true;
  }

  // ۱۳. محاسبه سقف و کف انتخاب واحد
  if (data === "unit:start") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "🎓 محاسبه سقف و کف انتخاب واحد").catch(() => {});
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
    return true;
  }

  if (data === "unit:last") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "✅ حالت ترم آخر انتخاب شد").catch(() => {});
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
    return true;
  }

  if (data === "unit:not_last") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📌 حالت غیر ترم آخر انتخاب شد").catch(() => {});
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
    return true;
  }

  if (data === "unit:normal:m" || data === "unit:normal:n") {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "📈 انتخاب بازه معدل").catch(() => {});

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
    return true;
  }

  if (data.startsWith("unit:gpa:")) {
    userStates.delete(chatId);

    await answerCallbackQuery(callbackId, env.BOT_TOKEN, "✅ نتیجه آماده شد").catch(() => {});

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
    return true;
  }

  // ۱۴. مدیریت Callback نامعتبر یا تاریخ‌گذشته
  await answerCallbackQuery(
    callbackId,
    env.BOT_TOKEN,
    "⚠️ این گزینه دیگر معتبر نیست.",
    true
  ).catch(() => {});

  await sendMessage(
    chatId,
    "⚠️ این گزینه دیگر معتبر نیست.\nلطفاً از منوی اصلی دوباره انتخاب کنید.",
    env.BOT_TOKEN,
    resultKeyboard("menu"),
    true
  );

  return false;
}
