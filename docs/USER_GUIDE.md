# PharmaStock — User Guide

For everyone who uses the system day to day. No technical knowledge needed.

---

## The idea in one line

**You never type in a stock quantity.** You record what actually happened — a delivery arrived, or
drugs were given to a patient — and the system works out the quantity for you.

| What you do | What happens automatically |
|---|---|
| Receive a delivery | Stock **increases** |
| Dispense to a patient | Stock **decreases** |
| Stock drops to its minimum | 🟡 **Low stock** alert appears |
| A batch nears its expiry date | 🟡 **Expires soon** alert appears |
| A batch passes its expiry date | 🔴 **Expired** alert appears |

Because every change is recorded, you can always look at any drug and see *why* the number is what
it is.

---

## Starting the system

1. Double-click **PharmaStock** on the desktop.
2. A black window opens — **leave it open.** That is the system running.
3. Your browser opens at `http://localhost:4000`.
4. Sign in.

To stop, close the black window. Your data is saved continuously — there is no "save" button and
nothing is lost.

> **No internet needed.** Everything runs on this laptop.

---

## Signing in

The first time you sign in you will be asked to choose your own password. Do it — every stock
movement is recorded against your name, so your account should be yours alone.

Forgotten your password? Ask the pharmacist to reset it.

---

## The dashboard

The four tiles across the top answer the questions that matter most:

| Tile | Meaning |
|---|---|
| **Total drugs** | How many different drugs are in the catalogue |
| **Low stock** | Drugs at or below their minimum level — these need reordering |
| **Expiring soon** | Batches approaching their expiry date |
| **Expired** | Batches already past their date, still on the shelf |

Click any tile to see the full list. Below the tiles are the five working lists: expired, expiring
soon, low stock, recent deliveries and recent dispensing.

---

## Finding a drug

Go to **Inventory** and type in the big search box. It searches drug names, generic names, drug
codes **and batch numbers** — so you can type whatever is printed on the box in your hand.

Every row answers the four everyday questions at a glance:

- **Do we have this drug?** → the Stock column (🟢 / 🟡 / 🔴)
- **How many do we have?** → the Available column
- **When does it expire?** → the Next expiry column
- **Do we need to order more?** → 🟡 Low stock means yes

Click a row to open the drug and see every batch and its full history.

You can also filter by form, stock status, expiry status, supplier, and sort by "Most urgent first".

---

## Receiving a delivery

**Receive stock** in the sidebar.

1. Fill in the supplier, invoice number and date at the top.
2. For each drug in the delivery, add a line:
   - Search for the drug
   - Enter the **batch number** and **expiry date** from the box
   - Enter the **quantity received**
   - Unit cost is optional
3. As you type, a green preview shows what the stock will become.
4. Click **Save delivery & increase stock**, then confirm.

You will see a summary showing the old and new quantities for every line.

> **Different expiry dates are always kept separate.** If you receive the same drug with two
> different expiry dates, the system keeps them as two batches, so the expiry tracking stays
> accurate. Receiving the *same* batch with the *same* expiry simply tops up the existing batch.

---

## Dispensing to a patient

**Dispense** in the sidebar.

1. Enter the patient reference (and name, if you record it).
2. Add a line per drug: search for the drug, type the quantity.
3. The system shows you, live:
   - `1325 → 1315` — the stock before and after
   - which batches it will take from

**The system automatically uses the batch that expires first.** This is the correct way to dispense
and it happens without you having to think about it. If you need a different batch, click **Change
batches** and choose manually.

4. Click **Dispense & reduce stock**, then confirm.

### You cannot dispense more than you have

If you ask for more than is available, the button is disabled and the line turns red telling you
exactly how many are available. Nothing is saved until every line fits.

**Expired batches can never be dispensed** — they are excluded from the available quantity
entirely.

---

## Understanding the alerts

### Expiry

| | Meaning |
|---|---|
| 🔴 **Expired** | Past its expiry date. Cannot be dispensed. Remove it from the shelf. |
| 🟡 **Expires soon** | Within the warning window (90 days by default). Use it first, or return it. |
| 🟢 **Good** | Plenty of time left. |

The pharmacist can change the warning window to 30, 60 or 90 days in **Settings**. Changing it
updates every screen immediately.

### Low stock

Each drug has a **minimum stock level**. When the available quantity reaches or falls below it,
🟡 **Low stock — order soon** appears.

The **Alerts → Low stock** tab is your reorder list. It shows the supplier and a suggested order
quantity, and you can export it straight to Excel to send to the supplier.

> A drug whose only remaining stock has expired shows as 🔴 **Out of stock** — because that stock
> genuinely cannot be used.

---

## Stock adjustments (pharmacist)

Use **Adjustments** when stock changes for a reason that is neither a delivery nor a dispense:

- a stock count found a different number
- something was damaged or broken
- stock was returned to the supplier
- expired stock is being thrown away

Choose the drug and batch, pick increase or decrease, enter the quantity and a reason. The preview
shows what the batch will become.

There is also a one-click **Write off all expired** button, which removes every expired batch and
records a separate disposal entry for each one.

> **Mistakes are corrected, not erased.** If something was recorded wrongly, you record an
> adjustment that cancels it out. The original entry stays in the history, so the record always
> shows what really happened.

---

## Reports

**Reports** gives you seven ready-made reports:

| Report | Use it for |
|---|---|
| Current inventory | A full stock list |
| Low stock — reorder list | Placing orders |
| Drugs expiring soon | Planning what to use or return |
| Expired stock | What to remove from the shelf |
| Stock received | Checking deliveries against invoices |
| Drugs dispensed | Usage over a period |
| Stock movement history | The full record of every change |

Each one exports to **Excel** or **PDF**, and prints from the browser.

---

## Who can do what

| | Doctor | Pharmacist | Assistant |
|---|:---:|:---:|:---:|
| View inventory and search | ✅ | ✅ | ✅ |
| View and export reports | ✅ | ✅ | ✅ |
| Dispense drugs | — | ✅ | ✅ |
| Receive stock | — | ✅ | if allowed |
| Add and edit drugs, suppliers | — | ✅ | — |
| Stock adjustments and write-offs | — | ✅ | — |
| Manage users and settings | — | ✅ | — |
| Backup and restore | — | ✅ | — |

Assistants can dispense and search. Whether an individual assistant may also record deliveries is a
tick-box the pharmacist controls per person, on the **Users** screen.

---

## Everyday questions

**I made a mistake on a dispense.**
Record a stock adjustment that puts the quantity back, with the reason "Stock count correction" and
a note explaining it. The history keeps both entries, which is exactly what you want.

**A drug is no longer stocked.**
Edit the drug and untick **Active**. It disappears from the inventory list and alerts, but all its
history is kept. Drugs with history can never be deleted, only deactivated.

**The stock number looks wrong.**
Open the drug and read the **Stock movement history** at the bottom. Every change is there with the
date, the reason and who did it. If the figures still do not add up, ask the pharmacist to run
**Settings → Check stock integrity**.

**Can two people use it at once?**
Yes, from other computers on the same network — the address is shown in **Settings → System
information**. The laptop running PharmaStock must be switched on.

**Do I need to save?**
No. Everything is saved the moment you confirm it.
