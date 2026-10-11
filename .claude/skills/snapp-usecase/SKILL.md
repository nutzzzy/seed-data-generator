---
name: snapp-usecase
description: Food Partner Use Case and flowchart rules of the team (Confluence "Partner Use Cases by Domain", space FP). Use whenever writing, reviewing, importing or exporting a Food Partner use case (UC-…), its algorithm (Main Success Scenario / Extensions) or its Mermaid flowchart, or updating the "Partner Use Cases by Domain" diagram page. Not for Seed Data (that is the qa-seed-data skill).
---

# Snapp UseCase Guide

Source of truth: Confluence page **Partner Use Cases by Domain** (space FP, page 154408734) and the Use Case pages under it
(e.g. *Coupon → Coupon Service → Create a New Coupon*).
The same rules are built into this project's app in the **snapp usecase** section (`src/usecase/rules.ts`); keep both in sync when Confluence changes.
This section is completely separate from Seed Data: different storage, different rules, different exports.

## Hierarchy

`Domain → Service → Feature → Use Case`, e.g. `Coupon → Coupon Service → Create a New Coupon`.

Current domains (13): Vendor User / Profile, Vendor Core, Vendor Menu, Promotion, Coupon, Discount, FoodParty, Cashback,
Food Pro Service, ADS, Finance, Vendor Insight, Vendor Support. (Confluence also has child pages Order and Electron.)
Use the current names only; earlier names (Acquisition/Vendor Profile, Vendor Platform, Content, Platform & Support) are superseded.

## 1. Use Case page (one page per use case)

Header paragraph, labels in **bold**, values after them:

```text
Use Case ID: UC-Creates-New-Coupon
Title: Vendor Creates a New Coupon
Scope: Coupon
Primary Actor: Vendor
```

Then these sections, in this order, with these exact English headings:

| Heading | Level | Content |
|---|---|---|
| Preconditions | h2 | bulleted list, one condition per item |
| Postconditions | h2 | bulleted list |
| Main Success Scenario | h2 | **numbered** list of steps (the algorithm); sub-options as nested bullets; long scenarios may use h3 sub-headings `1. …` with steps `1.1`, `1.2` |
| Extensions (Alternative Flows) | h2 | one **h3 per alternative flow** (its name), then a bulleted list; conditions as `اگر … :` with nested bullets for results |
| Exceptions | h2 | bulleted list (validation failure, system error, cancel, business-rule mismatch) |
| Special Requirements | h2 | bulleted list (business rules, limits, exact UI/toast texts in quotes, FE+BE validation) |
| Related Use Cases | h3 (bold) | bulleted list of UC IDs, each optionally linked to its page |

Rules:

1. **Use Case ID** is `UC-` + words/numbers joined with `-` (e.g. `UC-Creates-New-Coupon`, `UC-Promotion-page-17`, `UC-LP-08`, `UC-Coupon-03`). Unique.
2. **Title** is actor + verb + object in English (`Vendor Creates a New Coupon`, `View and Access Ads & Promotion Tools`).
3. **Scope** is the domain/feature (`Coupon`, `LandingPage`, `Growth Tools (Ads & Promotion)`). **Primary Actor** is usually `Vendor`.
4. Section headings and the header labels stay in English; the body is written in Persian (RTL), keeping product and technical terms in English (Vendor, Backend, Frontend, Hot Offer, Toast, PLP…). UI labels in «guillemets», exact messages in "quotes".
5. Main Success Scenario is the happy path only; every deviation goes to an Extension (alternative but valid) or Exception (failure/stop).
6. Each step has one actor action or one system response (`Vendor روی … کلیک می‌کند.` / `سیستم … نمایش می‌دهد.`).
7. Don't invent facts: business numbers, limits and messages come from the source. Missing information is `Not specified` and is reported.
8. Related Use Cases reference IDs, not copied content.

## 2. Diagram section (on "Partner Use Cases by Domain")

Each diagram is one numbered section, scoped to a single business capability (split large ones, e.g. Vendor Menu has two):

```text
h1  N. <Domain> — <Service or capability>          (em dash "—")
h2  N.1 Description          paragraph: what it covers, entry points, hand-offs to other domains
h2  N.2 Mermaid Diagram Source   one-cell LTR table, the Mermaid code with <br /> line breaks
h2  N.3 Rendered Diagram     centred image attachment (height 250), e.g. 01_vendor_user_profile.png
                             centred italic caption "Figure N: <Domain> — <Service>"
```

The page ends with an **Overall Service Dependency Diagram** section showing how all domains interact.

### Mermaid rules

1. Start with `flowchart TD` (hierarchies) or `flowchart LR` (short linear funnels).
2. Node IDs are short CamelCase words without spaces (`CreateCoupon`, `AgentReview`); one node per line.
3. **Every node label and edge label is quoted**: `Id["Label"]`, `-- "Approved" -->`, `-->|"related concept"|`. This keeps `&`, `/`, `(`, `)`, `:` safe.
4. Shapes: `["…"]` use case / step / service, `{"…"}` decision (yes/no or choice), `[["…"]]` reference to another domain, diagram or end state (`[["Coupon Domain: Coupon Service"]]`, `[["From Promotion Domain: Promotion Page"]]`, `[["Banner Published"]]`).
5. Arrows: `-->` solid = explicit relation found in the source ("Include" relationship or direct link); `-.->` dotted = inferred dependency (shared precondition or workflow context).
6. Decision branches carry the condition as an edge label.
7. Labels are English, Title Case, using the use-case names from Confluence.

## Algorithm → flowchart

To draw a use case: start node = the entry point (where the Vendor comes from), then the Main Success Scenario steps in order with `-->`,
each Extension as a branch from the step it deviates at (decision node + labelled edge), Exceptions as labelled branches to an end node, and
links to other domains as `[["…"]]` nodes.

## Keeping Confluence up to date

Import the page (link or copy/paste), edit, validate against the rules above, export in the same structure (rich paste, storage format XHTML or wiki markup), and
replace the rendered image when the Mermaid source changes, so source and image never disagree.
