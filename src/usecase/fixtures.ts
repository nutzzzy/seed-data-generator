/** Trimmed copies of the storage format of the real Confluence pages (space FP), used by the tests. */

export const OVERVIEW_STORAGE = [
  '<p class="bidi-direction-ltr" style="text-align: left;"><ac:structured-macro ac:name="pagetree" ac:schema-version="1"><ac:parameter ac:name="root"><ac:link><ri:page ri:content-title="@self" /></ac:link></ac:parameter></ac:structured-macro>_</p>',
  '<h2 style="text-align: center;"><strong>Food Partner</strong></h2>',
  '<h1>Introduction &amp; Methodology</h1><p>This document models the functional architecture of the Food Partner application.</p>',
  '<h1>1. Vendor User / Profile — Vendor Registration Service</h1>',
  '<h2>1.1 Description</h2><p>Covers the vendor\'s journey from lead sign-up to store activation.</p>',
  '<h2>1.2 Mermaid Diagram Source</h2>',
  '<div class="bidi-direction-ltr table-wrapper"><table class="bidi-direction-ltr my-bidi-table wrapped" style="direction: ltr;text-align: left;"><tbody class=""><tr class=""><td style="text-align: left;"><p class="bidi-direction-ltr">flowchart TD<br />    Lead[&quot;Vendor Lead - Landing Page&quot;] --&gt; Reg[&quot;Vendor Registration&quot;]<br />    Reg --&gt; AgentReview{&quot;Agent Review&quot;}<br />    AgentReview -- Rejected --&gt; Rejection[&quot;Vendor Cooperation Rejection&quot;]<br />    AgentReview -- Approved --&gt; Activation[&quot;Vendor Activation&quot;]<br />    Activation --&gt; MenuLink[[&quot;Proceed to Vendor Menu Domain&quot;]]</p><p><br /></p></td></tr></tbody></table></div>',
  '<h2>1.3 Rendered Diagram</h2><p class="bidi-direction-ltr" style="text-align: center;"><ac:image ac:height="250"><ri:attachment ri:filename="01_vendor_user_profile.png" /></ac:image></p><p class="bidi-direction-ltr" style="text-align: center;"><em>Figure 1: Vendor User / Profile — Vendor Registration Service</em></p>',
  '<h1>2. Coupon — Coupon Service</h1>',
  '<h2>2.1 Description</h2><p>Coupon is a standalone domain reached from the Promotion Page\'s Growth Tools tab.</p>',
  '<h2>2.2 Mermaid Diagram Source</h2>',
  '<div class="bidi-direction-ltr table-wrapper"><table class="bidi-direction-ltr my-bidi-table wrapped" style="direction: ltr;text-align: left;"><tbody><tr><td style="text-align: left;"><p class="bidi-direction-ltr">flowchart TD<br /><br />    PromoHub[[&quot;From Promotion Domain: Promotion Page&quot;]] --&gt; CouponSvc[&quot;Coupon Service&quot;]<br /><br />    CouponSvc --&gt; CreateCoupon[&quot;Create a New Coupon&quot;]<br />    CouponSvc -.-&gt;|&quot;related concept&quot;| HotOfferMain[&quot;Hot Offer Main&quot;]</p></td></tr></tbody></table></div>',
  '<h2>2.3 Rendered Diagram</h2><p class="bidi-direction-ltr" style="text-align: center;"><ac:image ac:height="250"><ri:attachment ri:filename="07_coupon.png" /></ac:image></p><p class="bidi-direction-ltr" style="text-align: center;"><em>Figure 2: Coupon — Coupon Service</em></p>',
].join('');

const R = ' class="bidi-direction-rtl" style="text-align: right;"';

export const USE_CASE_STORAGE = [
  `<p${R}><strong>Use Case ID:</strong> UC-Creates-New-Coupon</p>`,
  `<p${R}><strong>Title:</strong> Vendor Creates a New Coupon<br /><strong>Scope:</strong> Coupon<br /><strong>Primary Actor:</strong> Vendor</p>`,
  `<h2${R}>Preconditions</h2><ul${R}><li data-uuid="1"><p${R}>Vendor وارد اپلیکیشن شده و احراز هویت کرده است.</p></li><li><p${R}>Vendor مجاز به ایجاد کوپن باشد.</p></li></ul>`,
  `<h2${R}>Postconditions</h2><ul${R}><li><p>کوپن جدید با موفقیت ایجاد و در لیست کوپن‌های Vendor نمایش داده شده است.</p></li></ul>`,
  `<h2${R}>Main Success Scenario</h2><ol${R}><li><p>Vendor روی دکمه «ایجاد کوپن جدید» کلیک می‌کند.</p></li><li><p>صفحه انتخاب شرط کوپن نمایش داده می‌شود.</p><ul><li><p>بر اساس دفعات خرید<br />مخصوص سفارش اول، دوم و ...</p><p><br /></p></li><li><p>حداقل مبلغ سبد خرید</p></li></ul><p><br /></p></li><li>Vendor یکی از شروط را انتخاب می‌کند.</li></ol>`,
  `<h2${R}>Extensions (Alternative Flows)</h2><h3${R}>ساخت کوپن از طریق لینک پیامک</h3><ul${R}><li><p>Vendor از طریق لینک ارسال‌شده در پیامک وارد جریان ساخت کوپن می‌شود.</p></li></ul>`,
  `<h3${R}>ورود درصد تخفیف نامعتبر</h3><ul${R}><li><p>اگر Vendor درصد تخفیف کمتر از 5 یا بیشتر از 95 وارد کند:</p><ul><li><p>پیام خطای سقف/کف نمایش داده می‌شود.</p></li><li><p>دکمه «ثبت» غیرفعال می‌شود.</p></li></ul></li></ul>`,
  `<h2${R}>Exceptions</h2><ul${R}><li><p>در صورت خطای سیستمی در ثبت کوپن، عملیات متوقف شده و پیام خطای مناسب نمایش داده می‌شود.</p></li></ul>`,
  `<h2${R}>Special Requirements</h2><ul${R}><li>قوانین اعتبارسنجی درصد تخفیف باید هم در Frontend و هم در Backend اعمال شود.</li></ul><p><br /></p>`,
  `<h3${R}><strong>Related Use Cases</strong></h3><ul${R}><li><p><a href="https://confluence.snappfood.ir/display/QC/View+Coupon+List">UC-Coupon-03</a></p></li><li><a href="https://confluence.snappfood.ir/display/QC/Sales+Coach+Banner+Display">UC-SalesCoach-16</a></li></ul>`,
].join('');

/** What get_page_text / a plain-text copy of the overview page looks like. */
export const OVERVIEW_TEXT = `Partner Use Cases by Domain
Introduction & Methodology

This document models the functional architecture.

7. Coupon — Coupon Service
7.1 Description

Coupon is a standalone domain.

7.2 Mermaid Diagram Source

flowchart TD

PromoHub[["From Promotion Domain: Promotion Page"]] --> CouponSvc["Coupon Service"]

CouponSvc --> CreateCoupon["Create a New Coupon"]

7.3 Rendered Diagram

Figure 7: Coupon — Coupon Service
`;
