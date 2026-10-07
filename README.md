# Reclip

**Receipts in. Reconciliation done.**

Upload receipts, import a bank CSV, and Reclip pairs them automatically — with a confidence
score and a stated reason for every match.

---

## 1. What was implemented

A working MVP of the full loop: **upload → extract → import → match → review → export.**

| Area | State |
| --- | --- |
| Authentication | Sign up, sign in, sign out, password reset, 14-day sessions, session invalidation on password change |
| Receipt upload | Single and bulk (drag-drop, 100+ files), mobile camera capture, real progress, per-file failure |
| Extraction | PDF text-layer parsing, heuristic field extraction, per-field confidence, user editing |
| Bank import | CSV preview, auto-detected column mapping, manual override, duplicate-import protection |
| Normalization | Processor prefixes, aggregator wrappers, store numbers, references, brand aliases |
| Matching engine | Five weighted signals, configurable, transparent, with hard vetoes and contention resolution |
| Duplicate detection | Identical files, shared invoice numbers, and same merchant/amount/date |
| Review interface | Two-sided cards, "why matched", confirm/reject, optimistic updates |
| Three core views | Matched · Needs review · Unmatched (split by which side is missing) |
| Receipt detail | Document preview, editable fields, linked transaction, manual matching, audit history, delete |
| Search & filters | Server-side, debounced, URL-backed; status/category/sort filters |
| Categories | Nine defaults, auto-suggested on ingest, user-overridable and never overwritten |
| Export | CSV (Excel-compatible), scoped to all / matched / review / unmatched |
| Audit log | Every mutation to financial data, attributed to a person or to "System" |
| Dashboard | Live counts, reconciliation rate, matched value, recent activity, spend by category |
| Landing & onboarding | Conversion-focused landing page, persona step, demo dataset |
| Privacy page | What is stored, what is processed, retention, deletion |
| Dark mode | Full support, system-aware, user-overridable |
| Tests | 101 tests, including 18 integration tests against a real database |

**Not built, deliberately** (per the brief): direct bank integrations, ERP/accounting
integrations, payroll, tax filing, invoicing, expense cards, chatbot, enterprise permissions.

---

## 2. Project architecture

```
src/
├── db/
│   ├── schema.ts            # 16 tables; originals separated from derived data
│   └── index.ts             # Drizzle client (singleton, WAL, foreign keys on)
│
├── lib/
│   ├── matching/            # ── the core engine, pure and dependency-free ──
│   │   ├── config.ts        # every weight and threshold; per-org overrides
│   │   ├── normalize.ts     # bank description → comparable merchant key
│   │   ├── similarity.ts    # Jaro-Winkler, Levenshtein, token-set, containment
│   │   ├── score.ts         # multi-factor scoring + per-signal reasons
│   │   ├── engine.ts        # candidate narrowing, escalation, assignment
│   │   └── duplicates.ts    # three kinds of duplicate, with evidence
│   │
│   ├── extraction/
│   │   ├── pdf-text.ts      # PDF content-stream text extraction
│   │   └── parse-text.ts    # heuristic field parsing with confidence
│   │
│   ├── ai/
│   │   ├── types.ts         # provider contracts — no vendor types leak out
│   │   ├── registry.ts      # selection + fallback
│   │   └── providers/
│   │       ├── local.ts     # no network; the default
│   │       └── remote.ts    # Anthropic / OpenAI behind the same interfaces
│   │
│   ├── services/            # tenant-scoped application logic
│   │   ├── receipts.ts      # the upload pipeline
│   │   ├── matching.ts      # DB-backed matching, confirm/reject/manual
│   │   ├── imports.ts       # CSV commit with two layers of dedupe
│   │   ├── stats.ts, export.ts, org.ts, categorize.ts
│   │
│   ├── auth/session.ts      # bcrypt + hashed session tokens
│   ├── storage.ts           # signature validation, opaque keys, path containment
│   ├── api.ts               # auth wrapper, error shaping, rate limiting
│   └── audit.ts             # financial data never changes silently
│
├── app/
│   ├── page.tsx             # landing
│   ├── (auth)/              # login · signup · reset
│   ├── app/                 # dashboard · review · matches · unmatched ·
│   │                        # receipts · transactions · upload · import · settings
│   └── api/                 # REST endpoints
│
└── components/              # shell, brand, UI primitives
```

**Two structural rules the codebase holds to:**

1. **The engine is pure.** `lib/matching/*` has no database, no I/O, no framework. That is
   why it can be tested exhaustively and why a bulk run is predictable.
2. **Originals are never mutated.** `receipts` holds the file; `receipt_extractions` holds
   what was derived from it. A bank transaction keeps `description_raw` verbatim forever.

---

## 3. Technologies used

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 (App Router), React 19 | Server components keep large lists off the client |
| Language | TypeScript, strict | — |
| Database | SQLite via Drizzle ORM | Zero-ops for an MVP; Drizzle's SQL is portable to Postgres |
| Driver | `better-sqlite3` (via Drizzle's `better-sqlite3` driver) | Synchronous, mature, works on every maintained Node release; ships a prebuilt binary, so no compiler is needed |
| Styling | Tailwind + CSS custom properties | Tokens drive light/dark from one place |
| Auth | bcryptjs + hashed session cookies | No dependency on an external identity provider |
| CSV | PapaParse | Correct RFC 4180 quoting |
| Validation | Zod | One schema per endpoint |
| Tests | Vitest | — |

**Requires Node 20.19+ or 22.12+.** Tested on Node 22.12 (Windows 10).

> **On the data layer.** The schema was first written for Prisma, whose query engine is a
> binary fetched from `binaries.prisma.sh` at install time. It then moved to Node's built-in
> `node:sqlite`, but that module is only available without a flag from **Node 22.13** (it was
> added in 22.5 behind `--experimental-sqlite`, and is still experimental), so on Node 22.5 –
> 22.12 every database import failed with `ERR_UNKNOWN_BUILTIN_MODULE`. It now uses
> `better-sqlite3`, which supports every maintained Node release. The schema and its intent are
> unchanged; only `src/db/index.ts` and `scripts/migrate.ts` know which driver is in use.

---

## 4. Database schema

16 tables. Every tenant-owned row carries `organization_id`.

```
organizations ──┬── memberships ── users ──┬── sessions
                │                          └── password_reset_tokens
                ├── org_settings          (matching weights/thresholds, JSON)
                ├── subscriptions         (plan, receipt quota)
                ├── categories            (9 system defaults per org)
                ├── merchants             (normalized name + aliases)
                │
                ├── receipts ─────────────── receipt_extractions   (1:1)
                │     storage_key                merchant_raw / merchant_norm
                │     checksum (sha256)          date, total, subtotal, tax
                │     status, is_duplicate       currency, invoice_number
                │     duplicate_of_id            items (JSON)
                │                                field_confidence (JSON)
                │                                overall_confidence, provider
                │
                ├── bank_accounts ── imports ── transactions
                │                     checksum     description_raw  ← never normalized
                │                                  description_norm
                │                                  merchant_norm
                │                                  fingerprint (unique per org)
                │
                ├── matches               receipt_id + transaction_id (unique)
                │                         score, status, breakdown (JSON), method
                │
                └── audit_logs            actor, action, entity, detail
```

**Design decisions worth calling out:**

- `receipts` / `receipt_extractions` are split 1:1 so re-extraction never touches the
  original record, and a user's edit is distinguishable from a machine's reading.
- `transactions.fingerprint` is `sha256(date|amount|description|account)`, unique per
  organization. Re-importing an overlapping statement adds only genuinely new rows.
- `matches.breakdown` stores the full signal breakdown as JSON, so the "why matched" panel
  renders the actual arithmetic rather than a reconstruction of it.
- `matches.status` distinguishes `auto` · `confirmed` · `suggested` · `alternate` ·
  `rejected`. A rejection is a tombstone, not a delete, so the next run won't re-propose it.

---

## 5. Matching algorithm

### The score

```
Match score =  Amount    × 40%
             + Merchant  × 30%
             + Date      × 20%
             + Currency  ×  5%
             + Payment   ×  5%
```

Weights are renormalized over the signals that actually apply, so a receipt with no
detected payment method isn't penalised for it — the remaining signals simply carry more.

**Classification** (configurable): `≥90` automatic · `70–89` review · `40–69` possible ·
`<40` discarded.

### Per-signal behaviour

| Signal | Behaviour |
| --- | --- |
| **Amount** | Compared in minor units on absolute value (bank debits are negative). ±0.01 scores a perfect 1; beyond that a linear decay to zero at 5% relative difference. |
| **Date** | Asymmetric, because banks post late: up to 5 days after the receipt, only 2 days before. |
| **Merchant** | Blend of Jaro-Winkler, token-set ratio and Levenshtein, with containment decisive. Rescaled over the usable band so the floor earns nothing. |
| **Currency** | A mismatch can still be the same purchase, so it is never auto-matched — it is capped below the automatic threshold and flagged. |
| **Payment method** | Only counted when both sides state one. |

### Hard vetoes

A flattering weighted average shouldn't rescue an impossible pair. If the amounts are too
far apart, or the dates fall outside the window, the score is capped below the "possible"
threshold regardless of what the other signals say.

### Contention

Two identical lunches on the same day must not both auto-match to one bank line. Pairs are
assigned greedily by score across the whole run; each transaction and each receipt can win
only once. Runner-ups are kept as `alternate` — offered on the receipt's detail page, but
never queued for review, so a receipt matched at 100% costs the user no decisions.

### Normalization (what makes merchant matching work)

```
"POS CARREFOUR MARKET TUNIS 2391"   → carrefour
"SQ *BLUE BOTTLE COFFEE"            → blue bottle coffee
"AMZN Mktp DE*1A2B3C4D5"            → amazon marketplace
"UBER   *TRIP HELP.UBER.COM"        → uber
"SEPA DD SPOTIFY AB"                → spotify
```

Stacked processor prefixes, aggregator `X *MERCHANT` wrappers, card tails, store numbers,
dates, references and corporate suffixes are all stripped; brand abbreviations are expanded.
The raw description is always preserved on the row.

---

## 6. AI / OCR provider configuration

**AI is used only where deterministic logic can't decide.** The engine escalates a pair to a
semantic provider only when merchant similarity sits in an ambiguous band *and* the amount
already matches strongly — i.e. only when resolving the merchant would actually change the
outcome. Escalations are batched into one call per receipt, never one per pair. A provider
failure falls back to the deterministic score; it never fails the run.

| Variable | Values | Default |
| --- | --- | --- |
| `EXTRACTION_PROVIDER` | `local` · `anthropic` · `openai` | `local` |
| `SEMANTIC_PROVIDER` | `local` · `anthropic` · `none` | `local` |

- **`local`** (default) — no network. Extraction parses PDF text layers and runs the
  heuristic field parser. Semantic matching resolves abbreviations, initialisms and
  vowel-dropped forms locally, which covers most of what an LLM would be asked.
- **`anthropic` / `openai`** — vision extraction for photographed receipts. Requires
  `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Documents are sent only when a key is configured.

Adding a provider means implementing `ExtractionProvider` or `SemanticProvider` in
`src/lib/ai/types.ts` and registering it. No product code changes.

**Privacy:** customer documents are never used for training. With the default configuration,
nothing about a document leaves the server.

---

## 7. Environment variables

```bash
DATABASE_URL="file:./dev.db"          # required
SESSION_SECRET="<32+ random chars>"   # required in production
STORAGE_DIR="./storage"               # where originals live; outside the web root
MAX_UPLOAD_BYTES=15728640             # optional, default 15MB

EXTRACTION_PROVIDER="local"           # local | anthropic | openai
SEMANTIC_PROVIDER="local"             # local | anthropic | none
# ANTHROPIC_API_KEY=                  # only if using anthropic
# ANTHROPIC_MODEL=claude-sonnet-4-5
# OPENAI_API_KEY=                     # only if using openai
```

`.env.example` ships with working defaults. **No credentials are required to run the
application end to end.**

---

## 8. How to run locally

```bash
npm install           # downloads a prebuilt better-sqlite3 binary; no compiler needed
cp .env.example .env
npm run db:push       # apply migrations (drizzle/*.sql)
npm run dev           # http://localhost:3000
```

Then either create an account and upload your own files, or choose **Load demo data** during
onboarding.

```bash
npm test              # 101 tests, including 18 against a real database
```

After changing `src/db/schema.ts`, regenerate the migration and apply it:

```bash
npm run db:generate   # writes drizzle/NNNN_*.sql
npm run db:push
```

---

## 9. How to build for production

```bash
npm run build          # type-checks and compiles
npm start              # serves on :3000
```

Before deploying:

1. Set `SESSION_SECRET` to a long random value.
2. Point `STORAGE_DIR` at a persistent volume (or swap `src/lib/storage.ts` for S3 — the
   interface is three functions).
3. Serve over HTTPS; session cookies become `Secure` automatically in production.
4. For more than one instance, move the rate limiter in `src/lib/api.ts` to a shared store
   and move SQLite to Postgres (change the Drizzle dialect; the queries are portable).

---

## 10. Remaining limitations

**Honest list of what this MVP does not do.**

1. **No OCR for photographed receipts without an API key.** The local provider reads PDF
   text layers, not pixels. A photo uploads and stores fine, but lands in Needs Review with
   zero extraction confidence and an "enter data manually" path. Setting
   `EXTRACTION_PROVIDER=anthropic` resolves this.
2. **Processing is inline, not queued.** A receipt is extracted and matched during its
   upload request. This is fine to several hundred files (the client uploads three at a
   time), but a real queue is the right answer at scale.
3. **Ambiguous dates are a genuine coin-flip.** `01/02/2026` is resolved using currency as
   a locale hint and flagged at 72% confidence. The CSV importer asks the user outright;
   receipts cannot.
4. **Excel export is CSV with a BOM,** which Excel opens correctly. A true `.xlsx` writer is
   not implemented.
5. **Rate limiting is per-process,** so it is only correct on a single instance.
6. **Password reset returns the link in the response in development.** No mail provider is
   wired; the send site is marked in `src/app/api/auth/reset/route.ts`.
7. **Single organization per user.** The schema supports many-to-many via `memberships`, but
   there is no UI to switch or invite.
8. **PDF inline preview depends on the browser's built-in viewer.** Where there isn't one,
   the page shows a download fallback.
9. **No multi-currency conversion.** A EUR receipt against a USD transaction is flagged and
   never auto-matched, but no FX rate is applied.
10. **`matchReceipts` re-reads candidate transactions per run.** Fine at MVP volumes;
    it wants an incremental index well before a million rows.
11. **`better-sqlite3` is a native addon.** `npm install` fetches a prebuilt binary for your
    platform and Node version. On a network that blocks GitHub release downloads, or a platform
    with no prebuilt binary, it falls back to compiling from source, which needs a C++
    toolchain (on Windows, Visual Studio Build Tools).
12. **`npm audit` reports advisories in dev-only tooling** (`vitest`, `drizzle-kit`'s bundled
    `@esbuild-kit`) and in the PostCSS copy bundled inside Next.js. None is reachable from the
    running application; the automatic fixes are major-version upgrades (Next 16, Vitest 5) and
    were deliberately not applied.

---

## 11. Recommended next features

In the order I would build them.

1. **Background job queue** for extraction and matching. Unblocks everything else, and turns
   a 500-file upload from "wait" into "we'll tell you when it's done."
2. **OCR for photographed receipts** as a first-class local option (Tesseract with a
   preprocessing pass for rotation and deskew), so the free tier isn't PDF-only.
3. **Learning from corrections.** Every confirm and reject is already logged. When a user
   links "SQ \*THE DAILY GRIND" to a receipt from "Daily Grind Coffee", that alias should be
   stored on the merchant and raise the score next month. This is the highest-leverage
   feature in the product and the data for it already exists.
4. **Bulk review actions** — "confirm all above 85%", keyboard shortcuts. Directly serves
   the metric that matters: time to reconcile.
5. **Multi-currency with FX rates** on the transaction date, turning a flagged mismatch into
   a scored one.
6. **Bank feeds** (Plaid, GoCardless, Tink) to retire manual CSV import. Deliberately after
   the loop is excellent, not before.
7. **Accounting exports** — Xero, QuickBooks, Sage — which is where an accountant's data is
   going anyway.
8. **Team access**: invitations, roles, and per-client workspaces for accountants.

---

## The product principle this was built around

The metric is not how many AI features it has. It is:

> **How quickly does a user get from 500 receipts to a clean reconciled dataset?**

That is why the review queue is sorted highest-confidence-first, why runner-up matches never
cost a decision, why every match states its reasons, and why the AI is kept out of the path
until deterministic logic has genuinely run out of road.
