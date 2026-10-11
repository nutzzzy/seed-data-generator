/**
 * The team's Use Case rules, taken from the Confluence page "Partner Use Cases by Domain" (space FP, page 154408734)
 * and the Use Case pages under it. Same content as .claude/skills/snapp-usecase/SKILL.md; keep both in sync.
 */

export const CONFLUENCE_REFERENCE_URL = 'https://confluence.snappfood.ir/spaces/FP/pages/154408734/Partner+Use+Cases+by+Domain';

export const DOMAINS = [
  'Vendor User / Profile',
  'Vendor Core',
  'Vendor Menu',
  'Promotion',
  'Coupon',
  'Discount',
  'FoodParty',
  'Cashback',
  'Food Pro Service',
  'ADS',
  'Finance',
  'Vendor Insight',
  'Vendor Support',
] as const;

/** Names that were replaced in the domain restructuring and must not be used any more. */
export const SUPERSEDED_NAMES: Record<string, string> = {
  'Acquisition/Vendor Profile': 'Vendor User / Profile',
  'Acquisition / Vendor Profile': 'Vendor User / Profile',
  'Vendor Platform': 'Vendor Core',
  'Platform & Support': 'Vendor Support',
};

/** Use Case page headings, exactly as written on the Confluence pages. */
export const UC_HEADINGS = {
  preconditions: 'Preconditions',
  postconditions: 'Postconditions',
  mainScenario: 'Main Success Scenario',
  extensions: 'Extensions (Alternative Flows)',
  exceptions: 'Exceptions',
  specialRequirements: 'Special Requirements',
  relatedUseCases: 'Related Use Cases',
} as const;

export const UC_LABELS = { ucId: 'Use Case ID', title: 'Title', scope: 'Scope', primaryActor: 'Primary Actor' } as const;

/** UC-Creates-New-Coupon, UC-Promotion-page-17, UC-LP-08, UC-Coupon-03 */
export const UC_ID_PATTERN = /^UC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export const OVERALL_SECTION_HEADING = 'Overall Service Dependency Diagram';

export const USE_CASE_RULES = [
  'Hierarchy is Domain → Service → Feature → Use Case. Current domains: ' + DOMAINS.join(', ') + '. Do not use superseded names (Acquisition/Vendor Profile, Vendor Platform, Content, Platform & Support).',
  'Use Case ID is "UC-" followed by words or numbers joined with "-", e.g. UC-Creates-New-Coupon, UC-Promotion-page-17, UC-LP-08. Use the ID from the source when it gives one.',
  'Title is actor + verb + object in English, e.g. "Vendor Creates a New Coupon". Scope is the domain or feature (e.g. Coupon, LandingPage). Primary Actor is usually Vendor.',
  'Sections, in order: Preconditions, Postconditions, Main Success Scenario, Extensions (Alternative Flows), Exceptions, Special Requirements, Related Use Cases.',
  'Write the content of every section in Persian, keeping product and technical terms in English (Vendor, Backend, Frontend, Toast, Hot Offer, PLP…). UI labels go in «guillemets», exact messages in "quotes".',
  'Preconditions and Postconditions: one condition per item.',
  'Main Success Scenario is the happy path only, as numbered steps; one actor action or one system response per step (e.g. "Vendor روی دکمه «ایجاد کوپن جدید» کلیک می‌کند." / "سیستم صفحه انتخاب شرط کوپن را نمایش می‌دهد."). Options shown to the user are nested items under the step.',
  'Extensions (Alternative Flows): one titled flow per alternative but valid path (title in Persian), each with its steps; conditions as "اگر … :" with the results as nested items.',
  'Exceptions: failures that stop the flow (validation errors, system errors, cancel, business-rule mismatch).',
  'Special Requirements: business rules, limits, exact UI/toast texts, and where validation runs (Frontend and Backend).',
  'Related Use Cases: UC IDs only, never copied content.',
  'Use only facts from the source: never invent business numbers, limits, messages or IDs. Write "Not specified" for anything required that the source does not give, and report what is missing as an issue.',
];

export const DIAGRAM_RULES = [
  'Each diagram is one numbered section of the "Partner Use Cases by Domain" page, scoped to a single business capability: heading "<Domain> — <Service or capability>" (em dash), then N.1 Description, N.2 Mermaid Diagram Source, N.3 Rendered Diagram with caption "Figure N: <heading>".',
  'Description: one paragraph saying what the diagram covers, its entry points and its hand-offs to other domains.',
  'Mermaid starts with "flowchart TD" (hierarchies) or "flowchart LR" (short linear funnels).',
  'Node IDs are short CamelCase English words without spaces (e.g. CreateCoupon, AgentReview); one node or edge per line, indented with four spaces.',
  'Every node label and edge label is quoted: Id["Label"], A -- "Approved" --> B, A -->|"related concept"| B. This keeps &, /, (, ), : safe.',
  'Shapes: ["…"] use case, step or service; {"…"} decision; [["…"]] reference to another domain or diagram, entry point from another domain, or end state (e.g. [["From Promotion Domain: Promotion Page"]], [["Coupon Domain: Coupon Service"]], [["Banner Published"]]).',
  'Arrows: --> solid for explicit relations found in the source ("Include" relationships, direct links, the scenario order); -.-> dotted for inferred dependencies (shared preconditions or workflow context).',
  'Decision branches carry the condition as an edge label.',
  'Labels are English Title Case, using the use-case names from Confluence.',
  'Drawing a use case: entry point → Main Success Scenario steps in order → end state; each Extension branches from the step where it deviates (decision node + labelled edge); Exceptions branch to an end node; links to other domains are [["…"]] nodes.',
];

/** Short rules shown in the in-app guide (Persian UI, English terms as in Confluence). */
export const GUIDE_POINTS = {
  useCase: [
    'شناسه: UC-… مثل UC-Creates-New-Coupon، UC-Promotion-page-17، UC-LP-08 (یکتا).',
    'سربرگ: Use Case ID، Title (انگلیسی: Actor + فعل + مفعول)، Scope، Primary Actor.',
    'بخش‌ها به همین ترتیب: Preconditions، Postconditions، Main Success Scenario، Extensions (Alternative Flows)، Exceptions، Special Requirements، Related Use Cases.',
    'Main Success Scenario فقط مسیر موفق است، شماره‌دار و در هر قدم یک کنش Vendor یا یک پاسخ سیستم.',
    'هر Alternative Flow یک زیرعنوان (h3) دارد؛ خطاهایی که جریان را متوقف می‌کنند در Exceptions می‌آیند.',
    'متن فارسی، اصطلاحات (Vendor، Backend، Toast، …) انگلیسی؛ برچسب‌های UI داخل «» و پیام‌ها داخل "".',
    'هیچ عدد، محدودیت یا پیامی ساخته نمی‌شود؛ اطلاعات ناموجود با Not specified مشخص می‌شود.',
  ],
  diagram: [
    'هر نمودار یک بخش شماره‌دار: «N. Domain — Service»، سپس N.1 Description، N.2 Mermaid Diagram Source و N.3 Rendered Diagram با کپشن «Figure N: …».',
    'Mermaid با flowchart TD (سلسله‌مراتب) یا flowchart LR (قیف کوتاه) شروع می‌شود.',
    'همهٔ برچسب‌های گره و یال داخل "" هستند: Id["Label"]، -- "Approved" -->، -->|"label"|.',
    'شکل‌ها: ["…"] Use Case یا قدم، {"…"} تصمیم، [["…"]] ارجاع به Domain یا نمودار دیگر و وضعیت پایانی.',
    'فلش پیوسته --> برای رابطهٔ صریح در منبع، فلش نقطه‌چین -.-> برای وابستگی استنباطی.',
    'Domainهای فعلی: ' + DOMAINS.join('، ') + '.',
  ],
};
