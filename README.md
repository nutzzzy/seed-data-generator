# QA Seed Data Generator

Local app that turns requirements into team-standard Seed Data and Use Cases, then publishes them to Confluence / Zephyr. UI is Persian (RTL).

[راهنمای فارسی](#راهنمای-فارسی)

## Features

- **Seed Data** – generate the table from notes or a Confluence page, duplicate check against existing Seed Data, checklist validation, publish to Confluence or copy for Confluence / Zephyr.
- **snapp usecase** (`/#usecase`) – import, write and validate Food Partner Use Cases and Mermaid flowcharts; export or publish back to Confluence.
- **Agents** (Settings) – Claude Code (default), Codex, Cursor, Gemini, Anthropic / OpenAI-compatible API, Ollama, or offline.
- **Network** (optional) – agents through the OS VPN, Confluence direct. See [docs/network-routing.md](docs/network-routing.md).

## Run on a new machine

1. **Install Node.js 20.19+ or 22.12+** (`node --version`).
2. **Get the code** – `git clone https://github.com/nutzzzy/seed-data-generator.git` and `cd` into it.
   Copying the folder also works, but **do not copy `node_modules/` or `dist/`** (they contain OS-specific binaries).
3. **Install dependencies** – `npm ci` (or `npm install`).
4. **Default agent** – install Claude Code and log in once: run `claude`. Check with `claude --version`.
5. **Optional config** – `cp .env.example .env.local`, then set `CONFLUENCE_TOKEN`, `CLAUDE_CODE_PATH` (if `claude` is not on PATH) or `ANTHROPIC_API_KEY`.
6. **Start** – `npm run dev`, open http://localhost:5173.
7. Re-enter the Confluence token and agent API keys in the app (Settings), or copy the whole `.data/` folder from the old machine (it holds the encryption key too).

Work in progress lives in the browser's local storage, so it does not move to the new machine.

### Troubleshooting

| Error | Fix |
| --- | --- |
| `Cannot find module './server/...'` after `git clone` | Some files were not committed/pushed. Run `git status` on the old machine, commit and push everything, then pull again. |
| `npm ci` / Vite fails with engine or syntax errors | Node is too old; upgrade to 20.19+ / 22.12+. |
| `Cannot find module @rollup/...` / `rolldown` binding | `node_modules` was copied from another OS: `rm -rf node_modules && npm ci`. |
| `Port 5173 is in use` | Stop the other process (`lsof -i :5173`); the port is fixed on purpose. |
| `Claude Code was not found` / `Not logged in` | Install Claude Code or set `CLAUDE_CODE_PATH`; run `claude` once to log in. |
| Confluence 401 / not reachable | Set the token in the Confluence settings; check VPN / network access to Confluence. |

## Scripts

`npm run dev` – app · `npm test` – tests · `npm run build` – type-check and build · `npm run preview` – serve the build

## Code layout

`src/seed/`, `src/usecase/` – the two sections · `src/lib/` – logic · `src/components/` – shared UI · `server/` – Vite plugins acting as the backend (agents, Confluence, Seed workflow, network) · `.claude/skills/` – team guides (keep in sync with `src/lib/defaults.ts` / `src/usecase/rules.ts`).

---

<div dir="rtl" align="right">

## راهنمای فارسی

### کاربردها

- **Seed Data:** ساخت جدول Seed Data از یادداشت یا صفحهٔ Confluence، بررسی تکراری، Checklist، انتشار در Confluence یا کپی برای Confluence و Zephyr.
- **snapp usecase:** ایمپورت، نوشتن و بررسی Use Case و فلوچارت Mermaid؛ خروجی یا انتشار در Confluence.
- **Agentها (Settings):** Claude Code (پیش‌فرض)، Codex، Cursor، Gemini، API، Ollama یا حالت آفلاین.
- **شبکه (اختیاری):** Agentها از VPN، Confluence مستقیم.

### اجرا روی یک سیستم جدید

۱. نصب **Node.js** نسخهٔ ۲۰٫۱۹+ یا ۲۲٫۱۲+ (بررسی: `node --version`).

۲. دریافت کد با `git clone` (آدرس بالا) و رفتن به پوشهٔ پروژه. اگر پوشه را کپی می‌کنید، **`node_modules` و `dist` را کپی نکنید.**

۳. نصب وابستگی‌ها: `npm ci`

۴. نصب **Claude Code** و یک بار ورود با دستور `claude`.

۵. (اختیاری) `cp .env.example .env.local` و تنظیم `CONFLUENCE_TOKEN` یا `CLAUDE_CODE_PATH` یا `ANTHROPIC_API_KEY`.

۶. اجرا: `npm run dev` و باز کردن `http://localhost:5173`

۷. توکن Confluence و کلیدهای API را دوباره در Settings وارد کنید، یا کل پوشهٔ `.data/` را از سیستم قبلی کپی کنید.

کارهای ذخیره‌شده در مرورگر (Local Storage) به سیستم جدید منتقل نمی‌شوند.

### رفع خطا

- **`Cannot find module './server/...'` بعد از clone:** همهٔ فایل‌ها commit/push نشده‌اند؛ روی سیستم قبلی `git status` بگیرید، commit و push کنید و دوباره pull کنید.
- **خطای نسخه یا Syntax در npm/Vite:** نسخهٔ Node قدیمی است.
- **خطای `rolldown` یا `@rollup/...`:** `node_modules` از سیستم‌عامل دیگری کپی شده؛ `rm -rf node_modules && npm ci`
- **پورت ۵۱۷۳ اشغال است:** برنامهٔ دیگر را متوقف کنید (`lsof -i :5173`).
- **`Claude Code was not found` یا `Not logged in`:** Claude Code را نصب کنید یا `CLAUDE_CODE_PATH` را تنظیم کنید و یک بار `claude` را اجرا کنید.
- **خطای Confluence:** توکن را در تنظیمات Confluence وارد کنید و دسترسی شبکه/VPN را بررسی کنید.

</div>
