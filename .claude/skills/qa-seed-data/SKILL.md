---
name: qa-seed-data
description: QA Seed Data Guide of the team. Use whenever creating, reviewing, naming or documenting Seed Data / test data for QA, deciding whether test data belongs in Zephyr or Confluence, or turning requirements or notes into Seed Data tables for Confluence.
---

# QA Seed Data Guide

The team's standard for defining and managing Seed Data. Follow it whenever you create or review Seed Data.
The same rules are built into this project's app as the "QA Seed Data (Confluence)" standard and "QA Seed Data table" template (`src/lib/defaults.ts`); keep both in sync when the guide changes.

## Goal

Test data should be reusable, shareable between QAs, consistently structured and easy to find again.

**Test Case says what to test. Seed Data says which data to test with.**
Zephyr is where test cases run and simple test data lives. Confluence holds shared, complex and reusable Seed Data.

## What Seed Data is

Data prepared in advance for one or more tests that need a specific state or data set.
Example for Food Partner: an active Vendor, an inactive Vendor, an Order in Pending, Accepted or Delivered state.

## When to create Seed Data

Create Seed Data only when:

- the data is used in several test cases
- creating the data is complex or slow
- the data must be in a specific state
- several QAs need the same data
- a feature needs a set of related data

If the test case is simple and Zephyr can hold its test data directly, do not create Seed Data.

## Where data belongs

| | Zephyr | Confluence |
|---|---|---|
| Test steps | ✅ | ❌ |
| Expected result | ✅ | ❌ |
| Simple test data (one test case, e.g. `Customer ID: 1258`) | ✅ | ❌ |
| Reusable data (several test cases or features) | Reference | ✅ |
| Complex data (several entities, specific state, creation steps, e.g. Vendor + Store + Active Menu + Pending Order + Successful Payment) | Reference | ✅ |
| How to create the data | When needed | ✅ |
| Full Seed Data description | ❌ | ✅ |
| Link to several test cases | Reference | ✅ |

## Structure of one Seed Data (Confluence)

1. **Seed Data ID** – `SD-[ENTITY]-[DESCRIPTION]-[NUMBER]`, uppercase, e.g. `SD-VENDOR-ACTIVE-001`, `SD-VENDOR-INACTIVE-001`, `SD-ORDER-PENDING-001`, `SD-ORDER-PAID-001`, `SD-ORDER-DELIVERED-001`.
2. **Name** – short and clear, e.g. `Paid Order - Active Vendor`.
3. **Purpose** – what kind of tests the data is for.
4. **Environment** – `stage`, `UAT` or `production`.
5. **Data** – main fields as `Field: Value`, always including the status:
   ```text
   Vendor ID: 100977
   Vendor Status: Active
   Order ID: Dynamic
   Order Status: Paid
   Payment Status: Successful
   Order Type: Delivery
   ```
6. **Preconditions** – what must be true before use, e.g. `Vendor must be Active.`, `Order must exist.`, `Payment must be Successful.`
7. **How to Create** – steps when needed; add the API request or query if the data is created that way.
8. **Used For** – test cases or features that can use it, e.g. Vendor Login, Vendor Dashboard, Order Management, Menu Management, Delivery Management.

### Example

| Seed Data ID | Name | Purpose | Environment | Data | Preconditions | How to Create | Used For |
|---|---|---|---|---|---|---|---|
| SD-VENDOR-ACTIVE-001 | Active Vendor | برای تست سناریوهایی که نیاز به یک Vendor فعال در Food Partner دارند. | UAT | Vendor ID: 100977<br>Vendor Name: QA Vendor 01<br>Status: Active<br>City: Tehran<br>Type: Restaurant | Vendor must be Active. | Not specified | Vendor Login, Vendor Dashboard, Order Management, Menu Management, Delivery Management |

## Linking Seed Data to test cases

Do not copy Seed Data details into test cases; reference the ID.

```text
Title: Vendor can accept pending order

Precondition: Vendor is active and a pending order exists.

Test Data:
SD-VENDOR-ACTIVE-001
SD-ORDER-PENDING-001

Steps:
1. Login as Vendor.
2. Open Orders.
3. Open the pending order.
4. Click Accept.
5. Verify order status changes to Accepted.
```

Short forms are fine: `Seed Data: SD-ORDER-PAID-001` or `Precondition: Use Seed Data: SD-ORDER-PAID-001`.

## Rules

1. **Search first** – the Seed Data may already exist.
2. **Build for reuse** – if several test cases may use the data, register it as Seed Data.
3. **No sensitive data** – never record passwords, tokens, secrets, real customer data or other sensitive information.
4. **Always state the status** – e.g. `Order Status: Pending`.
5. **Keep test cases clean** – reference the Seed Data ID instead of copying its details.
6. **Make it understandable** – a QA who did not create the data must understand what it is and which tests it is for.
7. **Don't invent facts** – use only information from the source. Write `Not specified` for anything missing and say what is missing. Use `Dynamic` only when the value changes per run.

## Checklist before registering Seed Data

- [ ] Seed Data ID is set and follows the naming convention
- [ ] Name is set
- [ ] Purpose is set
- [ ] Environment is set
- [ ] Main data is recorded
- [ ] Status is set
- [ ] Preconditions are written where needed
- [ ] How to Create is written where needed
- [ ] No sensitive information is recorded
- [ ] It is clear which test cases can use this Seed Data

## Core principle

Don't create separate data for every test case. Define the important, shared and reusable data once, in the standard format, and let different test cases use it.
