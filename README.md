# PharmaStock

**Pharmacy inventory management for a small pharmacy, running on one laptop.**

Knows what drugs you have, how many, when they expire, what is running low, and — crucially — *why*
every quantity is what it is.

```
Receive a delivery   →  stock increases automatically
Dispense to patient  →  stock decreases automatically
Stock hits minimum   →  🟡 low stock alert
Expiry approaching   →  🟡 expires soon alert
Expiry passed        →  🔴 expired, and it can no longer be dispensed
```

---

## The one design rule

**Stock is never typed in — only derived from recorded events.**

Receiving and dispensing are the transactions; the quantity is the consequence. Every change writes
an append-only row to a ledger, so this invariant always holds and is verifiable on demand:

```
Current stock = Opening + Received − Dispensed − Adjustments
```

Mistakes are corrected with offsetting adjustments, never by editing history. **Settings → Check
stock integrity** re-proves the invariant across every batch at any time.

Two consequences worth knowing:

- **Batches, not drugs, hold stock.** The same drug with two expiry dates is two batches, which is
  what makes per-batch expiry tracking correct rather than bolted on.
- **Expired stock is excluded from the available quantity** — it cannot be dispensed — but is still
  reported separately, so nothing silently disappears.

---

## Getting started

**Requires** [Node.js](https://nodejs.org) 20 or newer.

```bash
# Windows, one-time setup: installs, builds, seeds, adds a desktop shortcut
scripts\install.bat

# or manually, any platform
npm run setup
npm start
```

Then open **<http://localhost:4000>**.

**The first start fills the system with a worked example** — 12 drugs, deliveries and dispensing
records, deliberately including expired stock, stock near expiry and low stock — so the dashboard
teaches rather than sits empty. Every sample record is tagged, and *Settings → Sample data* removes
it exactly when the pharmacy is ready for real stock, keeping anything you added yourself. It is
created once and never re-injected.

Four starter accounts are created on first run — `pharmacist` (full access), `doctor` (view
inventory and reports) and `assistant1` / `assistant2` (search, dispense, receive if allowed).

**Their passwords are generated per install and printed once to the console during setup.** Write
them down and hand them out directly. Until each person replaces their temporary password, the
account can do nothing else — enforced on the server, so it holds for anything that talks to the
API, not just the browser.

---

## What it does

- **Batch-level inventory** — name, code, strength, form, quantity, minimum level, expiry, supplier,
  batch number, storage location
- **Expiry alerts** at a configurable 30/60/90-day window (🔴 expired · 🟡 soon · 🟢 good)
- **Low-stock alerts** with a reorder list and suggested order quantities
- **Receiving** — multi-line deliveries with supplier and invoice details
- **Dispensing** — first-expiry-first-out allocation with manual override, live `100 → 90` preview,
  and a hard block on over-dispensing
- **Adjustments** — damage, count corrections, returns, one-click expired write-off
- **Dashboard** — four KPI tiles and five working lists
- **Search** across drug name, generic name, code and batch number
- **Seven reports**, each exporting to Excel and PDF
- **Three roles** with a per-user override for whether assistants may receive stock
- **Backups** — automatic at startup and daily, plus manual backup, download and validated restore

---

## Technology

| | |
|---|---|
| Server | Node.js · Express · better-sqlite3 (WAL) |
| Screens | React · TypeScript · Vite · TanStack Query |
| Exports | ExcelJS · PDFKit |
| Tests | `node:test` · supertest |

One process, one port, one database file. No Docker, no ORM, no cloud services, no internet
dependency. Deliberately boring, so it can be maintained years from now.

```
Browser ──► http://localhost:4000 ──► Node ──► data/pharmastock.db
                                                     │
Other PCs on the LAN ──► http://<laptop-ip>:4000     └──► backups/*.db
```

Moving to a network setup needs no code change — just a firewall rule.

---

## Development

```bash
npm run dev     # API on :4000, Vite on :5173 with hot reload
npm test        # 38 tests covering stock maths, FEFO, expiry, permissions
npm run build   # build the screens into web/dist
```

The tests are the specification for the parts that must never be wrong: the requirement's own
worked example (receive 100, dispense 10, expect 90), over-dispense refusal, FEFO ordering and
splitting, expiry bucket boundaries, low-stock thresholds, ledger reconciliation after randomised
movement sequences, and per-role API authorisation.

---

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** — for pharmacy staff
- **[Administrator Guide](docs/ADMIN_GUIDE.md)** — install, backup, restore, networking, troubleshooting

---

## Licence

MIT — see [LICENSE](LICENSE).
