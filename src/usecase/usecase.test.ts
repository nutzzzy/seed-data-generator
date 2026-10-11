import { describe, expect, it } from 'vitest';
import { overviewHtml, sectionHtml, sectionWiki, useCaseHtml, useCaseWiki } from './confluenceExport';
import { detectKind, ImportError, parsePage, toBlocks } from './confluenceParse';
import { OVERVIEW_STORAGE, OVERVIEW_TEXT, USE_CASE_STORAGE } from './fixtures';
import { flowchartFromUseCase, lintMermaid } from './mermaid';
import { newOverviewDoc, suggestImageFile } from './model';
import { formatOutline, parseOutline } from './outline';
import { validateSection, validateUseCase } from './validate';

describe('outline', () => {
  it('reads nesting, headings and line continuations, and writes them back', () => {
    const text = '### 1. Hot Offer\nfirst\n  sub a \\\n  more of a\n  sub b\n    deep\nsecond';
    const blocks = parseOutline(text);
    expect(blocks[0]).toEqual({ kind: 'heading', text: '1. Hot Offer' });
    expect(blocks[1]).toMatchObject({
      kind: 'list',
      items: [{ text: 'first', children: [{ text: 'sub a\nmore of a' }, { text: 'sub b', children: [{ text: 'deep' }] }] }, { text: 'second' }],
    });
    expect(formatOutline(blocks)).toBe(text);
  });

  it('keeps the level of items wrapped in a list item without text (as Confluence sometimes stores them)', () => {
    const { useCase } = parsePage('<p>Use Case ID: UC-X</p><h2>Exceptions</h2><ul><li><p>a</p><ul><li><ul><li>deep</li></ul></li></ul></li></ul>');
    expect(useCase!.exceptions).toBe('a\n  deep');
    expect(parsePage(useCaseHtml(useCase!), { storage: true }).useCase!.exceptions).toBe('a\n  deep');
  });

  it('drops typed list markers', () => {
    expect(parseOutline('1. one\n- two')).toMatchObject([{ kind: 'list', items: [{ text: 'one' }, { text: 'two' }] }]);
  });
});

describe('importing the overview page (Partner Use Cases by Domain)', () => {
  const page = parsePage(OVERVIEW_STORAGE, { storage: true });

  it('finds every numbered section with its description, Mermaid source and image', () => {
    expect(page.kind).toBe('overview');
    expect(page.sections).toHaveLength(2);
    const [first, second] = page.sections!;
    expect(first.heading).toBe('Vendor User / Profile — Vendor Registration Service');
    expect(first.description).toContain('lead sign-up');
    expect(first.imageFile).toBe('01_vendor_user_profile.png');
    expect(first.mermaid.split('\n')[0]).toBe('flowchart TD');
    expect(first.mermaid).toContain('    Lead["Vendor Lead - Landing Page"] --> Reg["Vendor Registration"]');
    expect(second.mermaid).toBe(
      'flowchart TD\n    PromoHub[["From Promotion Domain: Promotion Page"]] --> CouponSvc["Coupon Service"]\n    CouponSvc --> CreateCoupon["Create a New Coupon"]\n    CouponSvc -.->|"related concept"| HotOfferMain["Hot Offer Main"]',
    );
  });

  it('keeps the intro (page tree, title block, introduction) exactly as it was', () => {
    expect(page.intro).toContain('ac:name="pagetree"');
    expect(page.intro).toContain('<h1>Introduction &amp; Methodology</h1>');
    expect(page.intro).not.toContain('1. Vendor User');
  });

  it('exports the same storage structure and reads it back unchanged', () => {
    const doc = { ...newOverviewDoc('x', page.sections!, page.intro!) };
    const out = overviewHtml(doc, 'storage');
    expect(out.startsWith(page.intro!)).toBe(true);
    expect(out).toContain('<h1>2. Coupon — Coupon Service</h1><h2>2.1 Description</h2>');
    expect(out).toContain('<h2>2.2 Mermaid Diagram Source</h2><div class="bidi-direction-ltr table-wrapper"><table class="bidi-direction-ltr my-bidi-table wrapped"');
    expect(out).toContain('<ac:image ac:height="250"><ri:attachment ri:filename="07_coupon.png" /></ac:image>');
    expect(out).toContain('<em>Figure 2: Coupon — Coupon Service</em>');
    expect(out).toContain('PromoHub[[&quot;From Promotion Domain: Promotion Page&quot;]] --&gt; CouponSvc');
    const again = parsePage(out, { storage: true });
    expect(again.sections!.map(({ heading, description, mermaid, imageFile }) => ({ heading, description, mermaid, imageFile }))).toEqual(
      page.sections!.map(({ heading, description, mermaid, imageFile }) => ({ heading, description, mermaid, imageFile })),
    );
  });

  it('renumbers sections and their figure captions', () => {
    const doc = newOverviewDoc('x', [page.sections![1]], '');
    expect(sectionHtml(doc.sections[0], 1)).toContain('<h1>1. Coupon — Coupon Service</h1>');
    expect(sectionWiki(doc.sections[0], 1)).toContain('!07_coupon.png|height=250,align=center!\n_Figure 1: Coupon — Coupon Service_');
  });

  it('also reads a plain-text copy of the page', () => {
    const parsed = parsePage(OVERVIEW_TEXT);
    expect(parsed.kind).toBe('overview');
    expect(parsed.sections![0]).toMatchObject({ heading: 'Coupon — Coupon Service', description: 'Coupon is a standalone domain.' });
    expect(parsed.sections![0].mermaid).toBe('flowchart TD\n    PromoHub[["From Promotion Domain: Promotion Page"]] --> CouponSvc["Coupon Service"]\n    CouponSvc --> CreateCoupon["Create a New Coupon"]');
  });
});

describe('importing a Use Case page', () => {
  const { useCase } = parsePage(USE_CASE_STORAGE, { storage: true });

  it('reads the header and every section', () => {
    expect(useCase).toMatchObject({ ucId: 'UC-Creates-New-Coupon', title: 'Vendor Creates a New Coupon', scope: 'Coupon', primaryActor: 'Vendor' });
    expect(useCase!.preconditions).toBe('Vendor وارد اپلیکیشن شده و احراز هویت کرده است.\nVendor مجاز به ایجاد کوپن باشد.');
    expect(useCase!.mainScenario).toBe(
      'Vendor روی دکمه «ایجاد کوپن جدید» کلیک می‌کند.\nصفحه انتخاب شرط کوپن نمایش داده می‌شود.\n  بر اساس دفعات خرید \\\n  مخصوص سفارش اول، دوم و ...\n  حداقل مبلغ سبد خرید\nVendor یکی از شروط را انتخاب می‌کند.',
    );
    expect(useCase!.extensions.map((e) => e.title)).toEqual(['ساخت کوپن از طریق لینک پیامک', 'ورود درصد تخفیف نامعتبر']);
    expect(useCase!.extensions[1].body).toContain('\n  پیام خطای سقف/کف نمایش داده می‌شود.');
    expect(useCase!.exceptions).toContain('خطای سیستمی');
    expect(useCase!.specialRequirements).toContain('Frontend');
    expect(useCase!.relatedUseCases).toBe('UC-Coupon-03 | https://confluence.snappfood.ir/display/QC/View+Coupon+List\nUC-SalesCoach-16 | https://confluence.snappfood.ir/display/QC/Sales+Coach+Banner+Display');
  });

  it('exports the page structure of the Use Case pages and reads it back unchanged', () => {
    const html = useCaseHtml(useCase!, 'storage');
    expect(html.startsWith('<p class="bidi-direction-rtl" style="text-align: right;"><strong>Use Case ID:</strong> UC-Creates-New-Coupon</p>')).toBe(true);
    expect(html).toContain('<strong>Title:</strong> Vendor Creates a New Coupon<br /><strong>Scope:</strong> Coupon<br /><strong>Primary Actor:</strong> Vendor');
    const headings = [...html.matchAll(/<(h[23])[^>]*>(?:<strong>)?([^<]+)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(headings).toEqual([
      'h2 Preconditions',
      'h2 Postconditions',
      'h2 Main Success Scenario',
      'h2 Extensions (Alternative Flows)',
      'h3 ساخت کوپن از طریق لینک پیامک',
      'h3 ورود درصد تخفیف نامعتبر',
      'h2 Exceptions',
      'h2 Special Requirements',
      'h3 Related Use Cases',
    ]);
    expect(html).toContain('<ol class="bidi-direction-rtl"');
    expect(html).toContain('<a href="https://confluence.snappfood.ir/display/QC/View+Coupon+List">UC-Coupon-03</a>');
    expect(parsePage(html, { storage: true }).useCase).toEqual({ ...useCase, extensions: useCase!.extensions.map((e, i) => ({ ...e, id: expect.any(String) as string, title: useCase!.extensions[i].title })) });
  });

  it('exports wiki markup with numbered steps and nested bullets', () => {
    const wiki = useCaseWiki(useCase!);
    expect(wiki).toContain('h2. Main Success Scenario\n# Vendor روی دکمه');
    expect(wiki).toContain('#* حداقل مبلغ سبد خرید');
    expect(wiki).toContain('* [UC-Coupon-03|https://confluence.snappfood.ir/display/QC/View+Coupon+List]');
  });

  it('passes the rules', () => {
    expect(validateUseCase(useCase!).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('rejects content that is neither page kind', () => {
    expect(detectKind(toBlocks('<p>hello</p>'))).toBe('unknown');
    expect(() => parsePage('<p>hello</p>')).toThrow(ImportError);
  });
});

describe('rules', () => {
  it('flags Use Case ID format, missing sections and superseded domain names', () => {
    const issues = validateUseCase({
      ucId: 'UC Create coupon',
      title: 'ساخت کوپن',
      scope: 'Vendor Platform',
      primaryActor: 'Vendor',
      preconditions: '',
      postconditions: 'x',
      mainScenario: 'one step',
      extensions: [],
      exceptions: '',
      specialRequirements: '',
      relatedUseCases: 'Create coupon page',
    });
    const text = issues.map((i) => `${i.level}:${i.where}`);
    expect(text).toEqual(
      expect.arrayContaining(['error:Use Case ID', 'warning:Title', 'error:Preconditions', 'warning:Main Success Scenario', 'warning:Related Use Cases', 'warning:نام Domain']),
    );
  });

  it('flags unquoted labels, wrong headers and non-English node IDs in Mermaid', () => {
    const issues = lintMermaid('graph TD\n    A[Start & go] --> B["ok"]\n    B -- Yes --> C["c"]\n    C -->|maybe| D["d"]\n    گره["x"]');
    const messages = issues.map((i) => `${i.level} ${i.message}`).join('\n');
    expect(messages).toMatch(/warning خط اول باید/);
    expect(messages).toMatch(/error برچسب گره A داخل "" نیست/);
    expect(messages).toMatch(/warning برچسب یال «Yes»/);
    expect(messages).toMatch(/warning برچسب یال «maybe»/);
    expect(messages).toMatch(/error شناسهٔ گره/);
  });

  it('accepts the conventions used on the page', () => {
    const { sections } = parsePage(OVERVIEW_STORAGE, { storage: true });
    expect(lintMermaid(sections![1].mermaid)).toEqual([]);
    // Section 1 on the real page still has an unquoted edge label ("-- Rejected -->").
    expect(lintMermaid(sections![0].mermaid).map((i) => i.level)).toEqual(['warning', 'warning']);
    expect(validateSection(sections![1], 2).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('suggests image names like the page attachments', () => {
    expect(suggestImageFile(7, 'Coupon — Coupon Service')).toBe('07_coupon_coupon_service.png');
    expect(suggestImageFile(15, 'Finance — Accounting & Wallet & Billan')).toBe('15_finance_accounting_and_wallet_and_billan.png');
  });
});

describe('algorithm → flowchart', () => {
  it('draws entry, steps in order, alternative flows and exceptions with quoted labels', () => {
    const { useCase } = parsePage(USE_CASE_STORAGE, { storage: true });
    const mermaid = flowchartFromUseCase(useCase!);
    expect(mermaid.split('\n')[0]).toBe('flowchart TD');
    expect(mermaid).toContain('    Start[["Coupon: Vendor Creates a New Coupon"]]');
    expect(mermaid).toContain('    Start --> Step1["Vendor روی دکمه «ایجاد کوپن جدید» کلیک می‌کند."]');
    expect(mermaid).toContain('    Step2 --> Step3[');
    expect(mermaid).toContain('    Step3 --> Done[[');
    expect(mermaid).toContain('AltCheck -- "ورود درصد تخفیف نامعتبر" --> Alt2[');
    expect(mermaid).toContain('ExcCheck -- "1" --> Exc1[[');
    expect(lintMermaid(mermaid).filter((i) => i.level === 'error')).toEqual([]);
  });
});
