# Local Table Generator

Turn notes, requirements or user stories into a table that follows your own standard and column structure, then copy it into Confluence.

- [English](#run)
- [راهنمای فارسی اجرا روی لوکال](#راهنمای-اجرا-روی-لوکال)

## Run

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Your work is saved in this browser's local storage (the fixed port keeps it findable after restarts).

## Workflow

1. **Standard** – name, rules, required content, validation criteria, examples. Save / Rename / Duplicate / Delete.
2. **Table structure** – columns in order, each with description, required flag, expected content and optional checked rules (allowed values, regex pattern, max length, unique).
3. **Input** – paste the source text.
4. **Generate table** – fills the exact columns. Missing information becomes `Not specified` and is flagged.
5. **Review and edit** – edit cells, add/delete/move rows and columns, Validate, Save table. Edits never change the saved template unless you click *Update template from table*.
6. **Copy or export** – Copy for Confluence (rich HTML + plain-text fallback), Copy as HTML, Copy as Confluence wiki markup, Copy as Markdown, Download CSV (UTF-8), Download HTML.

## QA Seed Data guide

The team's QA Seed Data Guide is built in as the default **QA Seed Data (Confluence)** standard and **QA Seed Data table** template (`src/lib/defaults.ts`). Generation follows its structure (Seed Data ID, Name, Purpose, Environment, Data, Preconditions, How to Create, Used For), naming convention `SD-[ENTITY]-[DESCRIPTION]-[NUMBER]` and rules. Validation checks the ID format and uniqueness, Environment (`stage`, `UAT`, `production`), that Data contains a status, and that no passwords, tokens or secrets are recorded. Simple one-test data is not turned into Seed Data; it is flagged as belonging in Zephyr.

The same guide is a Claude Code skill in `.claude/skills/qa-seed-data/SKILL.md`, so Claude Code follows it when you work with seed data in this project. Keep both in sync when the guide changes.

## Generation providers (Settings)

- **Claude Code (default)** – runs the local `claude` CLI headless (tools and MCP off), so usage counts against the Claude Code account you are logged into. No API key. If `claude` is not on your PATH, set `CLAUDE_CODE_PATH` in `.env.local`.
- **Claude (Anthropic API)** – copy `.env.example` to `.env.local`, set `ANTHROPIC_API_KEY`, restart `npm run dev`. The key stays in the local dev server.
- **Ollama (local model)** – install Ollama, `ollama pull llama3.1`, choose it in Settings.
- **Basic (offline)** – no AI. Maps pasted tables and `Column: value` lines; every other line becomes a row.

## Scripts

- `npm test` – unit, UI and server tests (Vitest + Testing Library)
- `npm run build` – type-check and production build
- `npm run preview` – serve the production build (AI endpoint included)

## Code layout

- `src/lib/` – framework-free logic: types, model helpers, prompt, response normalizer, offline generator, validator, exporters, storage, clipboard
- `src/components/` – UI pieces; `src/App.tsx` wires the workflow
- `server/` – Vite plugin exposing `/api/ai/status` and `/api/ai/generate` (Claude Code, Anthropic API, Ollama); replace or add providers here

---

<div dir="rtl" align="right">

## راهنمای اجرا روی لوکال

این برنامه کاملاً روی کامپیوتر خودتان اجرا می‌شود. برای ساخت جدول از **Claude Code** همین سیستم استفاده می‌کند؛ یعنی مصرف توکن از همان حسابی کم می‌شود که با آن در Claude Code وارد شده‌اید و به کلید API جداگانه نیازی نیست.

### راهنمای Seed Data تیم QA

راهنمای Seed Data تیم به صورت پیش‌فرض در برنامه وجود دارد: استاندارد **QA Seed Data (Confluence)** و قالب جدول **QA Seed Data table**. جدول تولیدشده ساختار، Naming Convention (`SD-[ENTITY]-[DESCRIPTION]-[NUMBER]`) و قوانین راهنما را رعایت می‌کند و دکمهٔ **Validate** موارد زیر را خودکار بررسی می‌کند: قالب و یکتا بودن ID، مقدار Environment، وجود Status در Data و ثبت نشدن اطلاعات حساس. اگر از قبل با برنامه کار کرده‌اید، این استاندارد و قالب را از فهرست‌های بالای بخش ۱ و ۲ انتخاب کنید.

همین راهنما به صورت اسکیل Claude Code در مسیر `.claude/skills/qa-seed-data/SKILL.md` هم قرار دارد.

### پیش‌نیازها

۱. نصب **Node.js** نسخهٔ ۲۰٫۱۹ یا بالاتر (یا ۲۲٫۱۲ به بعد). برای بررسی نسخه:

</div>
<div dir="ltr">

```bash
node --version
```

</div>
<div dir="rtl" align="right">

۲. نصب **Claude Code** و یک بار ورود به حساب (دستور `claude` را در ترمینال اجرا کنید و مراحل ورود را کامل کنید). برای بررسی نصب:

</div>
<div dir="ltr">

```bash
claude --version
```

</div>
<div dir="rtl" align="right">

### مراحل اجرا

۱. در ترمینال وارد پوشهٔ پروژه شوید (پوشه‌ای که فایل `package.json` در آن است).

۲. نصب وابستگی‌ها (فقط بار اول لازم است):

</div>
<div dir="ltr">

```bash
npm install
```

</div>
<div dir="rtl" align="right">

۳. اجرای برنامه:

</div>
<div dir="ltr">

```bash
npm run dev
```

</div>
<div dir="rtl" align="right">

۴. این آدرس را در مرورگر باز کنید:

</div>
<div dir="ltr">

```text
http://localhost:5173
```

</div>
<div dir="rtl" align="right">

برای متوقف کردن برنامه در ترمینال کلیدهای <kbd>Ctrl</kbd>+<kbd>C</kbd> را بزنید.

### تنظیمات اختیاری

اگر دستور `claude` در PATH نیست، یا می‌خواهید به جای Claude Code از کلید API استفاده کنید، فایل تنظیمات را بسازید:

</div>
<div dir="ltr">

```bash
cp .env.example .env.local
```

</div>
<div dir="rtl" align="right">

سپس در فایل `.env.local` مقدار `CLAUDE_CODE_PATH` (مسیر کامل فایل `claude`) یا `ANTHROPIC_API_KEY` را وارد کنید و برنامه را دوباره اجرا کنید. مدل و روش تولید جدول را هم می‌توانید از دکمهٔ **Settings** در بالای صفحه عوض کنید.

### تست و بیلد

اجرای تست‌ها:

</div>
<div dir="ltr">

```bash
npm test
```

</div>
<div dir="rtl" align="right">

بیلد نسخهٔ نهایی:

</div>
<div dir="ltr">

```bash
npm run build
```

</div>
<div dir="rtl" align="right">

### رفع مشکلات رایج

- **پورت ۵۱۷۳ اشغال است:** برنامهٔ دیگری روی این پورت اجرا شده است. با دستور زیر آن را پیدا و متوقف کنید. پورت عمداً ثابت است تا اطلاعات ذخیره‌شده در مرورگر بعد از هر بار اجرا پیدا شود.

</div>
<div dir="ltr">

```bash
lsof -i :5173
```

</div>
<div dir="rtl" align="right">

- **پیام «Claude Code was not found»:** Claude Code نصب نیست یا در PATH نیست؛ مقدار `CLAUDE_CODE_PATH` را در `.env.local` تنظیم کنید.
- **پیام «Not logged in»:** یک بار دستور `claude` را در ترمینال اجرا کنید و وارد حساب شوید.
- **اطلاعات قبلی دیده نمی‌شود:** اطلاعات در حافظهٔ همان مرورگر ذخیره می‌شود؛ از همان مرورگر و همان آدرس `localhost:5173` استفاده کنید.

</div>
