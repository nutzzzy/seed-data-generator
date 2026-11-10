---
name: qa-seed-data
description: QA Seed Data Guide of the team (v4). Use whenever creating, reviewing, naming or documenting Seed Data / test data for QA, deciding whether test data belongs in Zephyr or Confluence, or turning requirements or notes into Seed Data pages for Confluence.
---

# QA Seed Data Guide (v4)

The team's standard for defining and managing Seed Data. Follow it whenever you create or review Seed Data.
The same rules are built into this project's app as the "QA Seed Data (Confluence)" standard and "QA Seed Data table" template (`src/lib/defaults.ts`); keep both in sync when the guide changes.

## Reference pages

The guide and its complete example live in Confluence. These pages are the reference, not real Seed Data:

- QA Seed Data (guide + full example): https://confluence.snappfood.ir/spaces/QC/pages/247858019/QA+Seed+Data — page ID 247858019, space QC

Rules for reference pages:

- Use them to follow the structure and the examples of the guide.
- Their Seed Data IDs (e.g. `SD-FP-VENDOR-ACTIVE-001`, `SD-BIKEREXP-BIKER-ACTIVE-FREE-001`) are examples. Never count a reference page as existing Seed Data when searching for duplicates or similar Seed Data, and never update or overwrite it.
- Child pages under a reference page are real Seed Data and are compared as usual.

The app reads the page IDs from this list (`server/seedWorkflow/skill.ts`); add a line here to add another reference page.

## Goal

Test data should be reusable, shareable between QAs and teams, consistently structured, easy to find, and have a clear owner whose health can be tracked.

**Test Case says what to test. Seed Data says which data to test with.**
Zephyr is where test cases run and simple test data lives. Confluence holds shared, complex and reusable Seed Data.

## When to create Seed Data

Create Seed Data only when:

- the data is used in several test cases
- creating the data is complex or slow
- the data must be in a specific state
- several QAs need the same data
- a feature needs a set of related data

If the test case is simple and Zephyr can hold its test data directly (e.g. `Customer ID: 1258` for one test case), do not create Seed Data.

## Environment

- Seed Data exists only in `stage` and `UAT`. **Never on `production`** (test data there damages real data and reports).
- One Seed Data belongs to exactly one environment. The same data in stage and UAT is two Seed Data with two IDs.

## Naming convention

ID format: **`SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN]`**

| Part | Meaning | Example |
|---|---|---|
| SD | fixed prefix | SD |
| DOMAIN | code of the owning service / team, from Domain Codes | FP, BORDAR, BIKEREXP |
| ENTITY | the main entity of the data | VENDOR, ORDER, BIKER, CUSTOMER |
| STATE | the state that distinguishes this data from similar data; may be several words | ACTIVE, INACTIVE, ACTIVE-FREE, PAID |
| NNN | three-digit number, sequential per identical prefix | 001, 002 |

Examples: `SD-FP-VENDOR-ACTIVE-001`, `SD-FP-VENDOR-INACTIVE-001`, `SD-FP-ORDER-PENDING-001`, `SD-FP-ORDER-PAID-001`, `SD-BORDAR-VENDOR-ACTIVE-001`, `SD-BORDAR-VENDOR-INACTIVE-001`, `SD-BIKEREXP-BIKER-ACTIVE-FREE-001`.

ID rules:

- Only uppercase English letters, digits and hyphens. No spaces.
- **The Confluence page title is exactly the Seed Data ID** (e.g. `SD-BORDAR-VENDOR-INACTIVE-001`), never a description such as "Seed Data – Inactive Bordar Vendor".
- NNN is the next free number for the same `SD-[DOMAIN]-[ENTITY]-[STATE]` prefix: look at the existing IDs; `SD-BORDAR-VENDOR-ACTIVE-001` existing does not change the number of `SD-BORDAR-VENDOR-INACTIVE-…`; a second inactive Bordar vendor is `SD-BORDAR-VENDOR-INACTIVE-002`.
- An ID never changes after a test case uses it. When the data's state changes, create a new Seed Data.
- A deleted or deprecated ID is never reused.
- Check that the ID is unique before creating it.

## Domain codes

| Domain code | Service / team (name of the Domain page) |
|---|---|
| FP | Food Partner |
| BORDAR | Bordar |
| BIKEREXP | Biker Experience |

A team without a code adds one to this table (and to the guide) before its first Seed Data.

## Structure of one Seed Data

Each Seed Data is **its own Confluence page** with two parts.

### Part 1: Metadata (inside the Page Properties macro)

A two-column table inside the Page Properties macro; the automatic Seed Data list is built from it, so the field names must be exactly these:

| Field | Required | Content |
|---|---|---|
| Seed Data ID | yes | per the naming convention; equal to the page title |
| Name | yes | short and clear, e.g. `Paid Order - Active Vendor`, `Inactive Bordar Vendor - Tehran` |
| Domain | yes | the owning team's Domain Code |
| Owner | yes | the person who maintains the data (mention) |
| Environment | yes | `stage` or `UAT` |
| Seed Status | yes | `Active` (healthy) / `Broken` (waiting for a fix) / `Deprecated` (do not use) |
| Usage Mode | yes | `Shared` (tests do not change the data; several QAs at once) / `Exclusive` (tests change the data; one QA at a time) |
| Last Verified | yes | date of the last health check and who did it, `YYYY-MM-DD - name` |
| Dependencies | when any | IDs of the Seed Data this one depends on; `-` when none |

### Part 2: Body

1. **Purpose** – what kind of tests the data is for. For a deprecated Seed Data, the replacement ID.
2. **Data** – a `Field | Value` table with a header row:
   - a Status row is required: the explicit status of every entity, e.g. `Order Status = Pending`;
   - an internal code gets its meaning, e.g. `C (FREE)`;
   - only fields that affect the tests; no irrelevant or null fields;
   - each field belongs to that entity; data of another entity (e.g. the panel user of a vendor) gets its own clearly named row;
   - shared values are written the same way, e.g. City always in English with City ID: `Tehran (City ID: 1)`.
3. **Preconditions** – the states that must hold before use, no steps (steps go in How to Create). All conditions the service needs, not only the status (e.g. for a vendor: active, open, service enabled, inside the service area). Do not forget environment conditions such as location, GPS, app version or user role. Use official names, not informal UI words.
4. **How to Create / Verify** – required, one of:
   - the data must be created: the creation steps in order, with the API request or query when it is created that way;
   - the data already exists: how to verify it is healthy (which panel or API) and how to recreate it if broken or deleted.
   How to Create contains no test steps: at its end the data must be exactly as in the Data table. Actions that change the data's state (assigning a trip, accepting an order) are test steps and belong in Zephyr.
5. **Reset / Cleanup** – how to bring the data back to the Data table state after a test. Required for `Usage Mode = Exclusive`; `-` for `Shared`. When a reset is impossible (an order cannot leave Delivered), say that a new instance is created each time and make How to Create complete.
6. **Used By** – the Zephyr keys of the test cases that use the data, e.g. `FP-T123 Vendor can accept pending order`. A feature name alone is not enough.

### Example (from the guide)

Page title: `SD-FP-VENDOR-ACTIVE-001`

| Metadata | |
|---|---|
| Seed Data ID | SD-FP-VENDOR-ACTIVE-001 |
| Name | Active Vendor - Tehran |
| Domain | FP |
| Owner | @owner |
| Environment | UAT |
| Seed Status | Active |
| Usage Mode | Shared |
| Last Verified | YYYY-MM-DD - @name |
| Dependencies | - |

- Purpose: برای تست سناریوهایی که نیاز به یک Vendor فعال در Food Partner دارند.
- Data: Vendor ID `100977`, Vendor Name `QA Vendor 01`, Vendor Status `Active`, City `Tehran (City ID: 1)`, Vendor Type `Restaurant`, Panel Username `qa.vendor01 (حساب تستی)`
- Preconditions: Vendor Status برابر Active باشد. Vendor در ساعت کاری و در وضعیت باز باشد.
- How to Create / Verify: داده از قبل وجود دارد. بررسی: در پنل Vendor Management، Vendor ID 100977 را جستجو کنید و Status و ساعت کاری را چک کنید. ساخت مجدد: یک Vendor از نوع Restaurant در تهران بسازید، فعال کنید و ID جدید را در جدول Data ثبت کنید.
- Reset / Cleanup: -
- Used By: FP-T101 Vendor Login, FP-T102 Vendor Dashboard, FP-T123 Vendor can accept pending order

## Page location and labels

- Location: `QA Seed Data > [service / Domain page] > [Seed Data ID]`. Under QA Seed Data there is exactly one parent page per domain, named like the service in Domain Codes (e.g. `Bordar`). No other intermediate level.
- Required labels (lowercase): `seed_data`, `sd-[domain]` (e.g. `sd-bordar`), `sd-[entity]` (e.g. `sd-vendor`), `env-[environment]` (e.g. `env-stage`).

## Sensitive information

Never record in Confluence: passwords, tokens, secrets, API keys; OTP values; real customer, vendor or biker data; personal mobile numbers.
Allowed: the mobile number of a test account only if it is an organisational test SIM (say so next to the number); the username of a test account without its password; how to get an OTP or access as panel name and required role (e.g. «OTP از پنل اکسپرس، بخش بایکرها؛ نیاز به نقش X»).

## Linking Seed Data to test cases

Do not copy Seed Data details into test cases; reference the ID, then add the test case's Zephyr key to the Seed Data's Used By.

```text
Title: Vendor can accept pending order
Precondition: Vendor is active and a pending order exists.
Test Data: SD-FP-VENDOR-ACTIVE-001, SD-FP-ORDER-PENDING-001
```

A test that changes the data's state (e.g. accepts the pending order) needs that Seed Data to be `Exclusive` with a Reset / Cleanup.

## Where data belongs

| | Zephyr | Confluence |
|---|---|---|
| Test steps, expected result | ✅ | ❌ |
| Simple test data (one test case) | ✅ | ❌ |
| Reusable data (several test cases or features) | Reference | ✅ |
| Complex data (several entities, specific state, creation steps); related entities in Dependencies | Reference | ✅ |
| How to create and reset the data | ❌ | ✅ |
| Full Seed Data description | ❌ | ✅ |
| Test cases using it | Reference | ✅ (Used By) |

## Rules

1. **Search first** – the Seed Data may already exist (the automatic list on the guide page, and the Domain pages).
2. **Build for reuse.**
3. **No sensitive data** – see above.
4. **Always state the status** – the data's status in the Data table and the Seed Status in the Metadata.
5. **Keep test cases clean** – only the ID in the test case.
6. **Make it understandable** – a QA who did not create the data can use it without asking.
7. **How to Create contains no test steps.**
8. **No Seed Data on production.**
9. **Don't invent facts** – use only information from the request and the documentation. Write `Not specified` for anything missing (e.g. Owner, Last Verified, Used By when no Zephyr keys are given) and say what is missing. Use `Dynamic` only when the value changes per run.

## Checklist before publishing a Seed Data page

- [ ] Page title equals the Seed Data ID; the ID follows the naming convention and is unique
- [ ] Metadata table is inside Page Properties and every required field is filled
- [ ] Environment is stage or UAT
- [ ] Purpose is written
- [ ] Data table has a header row and the status of every entity
- [ ] Internal codes are explained; no irrelevant or null fields
- [ ] Preconditions list every needed condition
- [ ] How to Create / Verify is filled and contains no test steps
- [ ] Reset / Cleanup is written for Exclusive data
- [ ] Dependencies is filled
- [ ] Used By has the Zephyr keys of the test cases
- [ ] No sensitive information
- [ ] The page is under the right Domain page and has the required labels

## Core principle

Don't create separate data for every test case. Define the important, shared and reusable data once, in the standard format, and let different test cases use it.
