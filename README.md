# QA Seed Data Generator

Turn requirements and notes into Seed Data that follows the team's QA Seed Data Guide, then copy it into Confluence and reference it from Zephyr. The UI is Persian and right-to-left.

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

- **Guide panel** – summary of the QA Seed Data Guide: when to create Seed Data, Zephyr vs Confluence, naming convention, rules.
1. **Requirements and notes** – paste what the tests need, then click **ساخت Seed Data**. Missing information becomes `Not specified` and is flagged; nothing is invented.
2. **Review and edit** – one row per Seed Data; edit cells, add/delete/move rows and columns, save and reopen. **بررسی با Checklist** scores the guide's checklist (ID set, naming convention, unique, Name, Purpose, Environment, Data, Status, Preconditions, How to Create, no sensitive data, Used For) and lists the rows to fix.
3. **Confluence and Zephyr** – copy one Confluence section per Seed Data in the guide's structure (Data as a Field/Value table, Preconditions and Used For as lists, How to Create as numbered steps) or everything as one table; copy the Zephyr reference (`Test Data: SD-…`). More formats: HTML, wiki markup, Markdown, CSV, HTML file.
- **Advanced settings** – the standard and the table structure (columns and their checked rules) for when the guide changes. Table edits never change them unless you click *update structure from the current table*.

## QA Seed Data guide

The team's QA Seed Data Guide is built in as the default **QA Seed Data (Confluence)** standard and **QA Seed Data table** template (`src/lib/defaults.ts`). Generation follows its structure (Seed Data ID, Name, Purpose, Environment, Data, Preconditions, How to Create, Used For), naming convention `SD-[ENTITY]-[DESCRIPTION]-[NUMBER]` and rules. Validation checks the ID format and uniqueness, Environment (`stage`, `UAT`, `production`), that Data contains a status, and that no passwords, tokens or secrets are recorded. Simple one-test data is not turned into Seed Data; it is flagged as belonging in Zephyr.

The same guide is a Claude Code skill in `.claude/skills/qa-seed-data/SKILL.md`, so Claude Code follows it when you work with seed data in this project. Keep both in sync when the guide changes.

## snapp usecase (separate section)

Switch with **snapp usecase** in the header (or open `http://localhost:5173/#usecase`). It is fully separate from Seed Data: its own storage, its own rules (`src/usecase/rules.ts`) and its own Claude Code skill (`.claude/skills/snapp-usecase/SKILL.md`), both taken from the Confluence page [Partner Use Cases by Domain](https://confluence.snappfood.ir/spaces/FP/pages/154408734/Partner+Use+Cases+by+Domain) and the Use Case pages under it.

1. **Import or create** – import a Confluence page by link (needs a token, see below) or by copy/paste (open the page, Ctrl+A, Ctrl+C, paste); both kinds of pages are recognised: a Use Case page (`Use Case ID`, Preconditions … Related Use Cases) and the diagram page (numbered `N. Domain — Service` sections with Description, Mermaid Diagram Source, Rendered Diagram). Or generate a Use Case and its flowchart from requirements with AI, or start empty.
2. **Edit the algorithm and the flowchart** – Use Case fields in the page order (lists as an outline: one item per line, two spaces per level, `### ` sub-heading, ` \` line break); Mermaid source with a live preview; *draw from the algorithm* (offline draft) or *draw / fix with AI*. The rules are checked live (UC ID format, sections, quoted Mermaid labels, `flowchart TD/LR`, `[[…]]` for other domains, em-dash headings, current domain names…).
3. **Export for Confluence** – rich copy to paste in the editor, storage format (the pages' exact markup, incl. `ac:image` attachments), wiki markup, Markdown, PNG/SVG of each diagram named like the page attachments. Documents imported by link can be **published** back to the same page: the update is refused if the page changed since the import, the page intro is kept, and only diagrams whose source changed get a new PNG.

Link import and publishing need a Confluence Personal Access Token (Confluence → Profile → Personal Access Tokens) in `.env.local`:

```bash
CONFLUENCE_BASE_URL=https://confluence.snappfood.ir
CONFLUENCE_TOKEN=<your token>
```

The token stays in the local dev server and is only sent to `CONFLUENCE_BASE_URL`.

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

- `src/seed/` – the Seed Data section; `src/usecase/` – the snapp usecase section (logic, components, tests); `src/App.tsx` – the switch between them
- `src/lib/` – framework-free logic: types, model helpers, prompt, response normalizer, offline generator, validator, exporters, storage, clipboard
- `src/components/` – shared UI pieces
- `server/` – Vite plugins exposing `/api/ai/status` and `/api/ai/generate` (Claude Code, Anthropic API, Ollama) and `/api/confluence/*` (page import and publish)

---

<div dir="rtl" align="right">

## راهنمای اجرا روی لوکال

این برنامه کاملاً روی کامپیوتر خودتان اجرا می‌شود. برای ساخت جدول از **Claude Code** همین سیستم استفاده می‌کند؛ یعنی مصرف توکن از همان حسابی کم می‌شود که با آن در Claude Code وارد شده‌اید و به کلید API جداگانه نیازی نیست.

### راهنمای Seed Data تیم QA

برنامه کاملاً بر اساس راهنمای Seed Data تیم QA است و سه مرحله دارد:

۱. **نیازمندی‌ها و یادداشت‌ها:** داده‌هایی را که تست‌ها لازم دارند وارد کنید و «ساخت Seed Data» را بزنید. اطلاعاتی که در ورودی نیست ساخته نمی‌شود و با `Not specified` مشخص می‌شود.

۲. **بررسی و ویرایش:** هر ردیف یک Seed Data است. دکمهٔ «بررسی با Checklist» موارد Checklist راهنما را خودکار بررسی می‌کند (Seed Data ID و Naming Convention، تکراری نبودن، Name، Purpose، Environment، Data و Status، Preconditions، How to Create، نبودن اطلاعات حساس و Used For) و ردیف‌های مشکل‌دار را نشان می‌دهد.

۳. **انتقال به Confluence و Zephyr:** هر Seed Data با ساختار راهنما برای Confluence کپی می‌شود و متن Reference برای فیلد Test Data در Zephyr آماده است.

استاندارد و ساختار جدول در «تنظیمات پیشرفته» پایین صفحه قرار دارند و فقط وقتی راهنمای تیم تغییر کرد لازم است آن‌ها را عوض کنید. اگر از قبل با برنامه کار کرده‌اید، **QA Seed Data** را از فهرست‌های همان بخش انتخاب کنید.

همین راهنما به صورت اسکیل Claude Code در مسیر `.claude/skills/qa-seed-data/SKILL.md` هم قرار دارد.

### بخش snapp usecase

بخشی کاملاً جدا از Seed Data (حافظه، قوانین و اسکیل جدا: `.claude/skills/snapp-usecase/SKILL.md`) برای Use Caseها و فلوچارت‌های Food Partner طبق صفحهٔ Confluence «Partner Use Cases by Domain». از دکمهٔ **snapp usecase** در بالای صفحه وارد شوید:

۱. ایمپورت صفحهٔ Use Case یا صفحهٔ نمودارها با لینک (نیاز به `CONFLUENCE_TOKEN` در `.env.local`) یا با کپی/Paste محتوای صفحه؛ یا ساخت Use Case و فلوچارت با AI.

۲. ویرایش الگوریتم (بخش‌های Use Case) و کد Mermaid با پیش‌نمایش زنده و بررسی هم‌زمان قوانین؛ رسم فلوچارت از روی الگوریتم.

۳. خروجی با همان ساختار Confluence (کپی برای Paste، Storage Format، Wiki Markup، Markdown، PNG/SVG) یا انتشار مستقیم در همان صفحه (فقط اگر صفحه بعد از ایمپورت تغییر نکرده باشد).

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
