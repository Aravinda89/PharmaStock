# PharmaStock — Administrator Guide

For whoever installs and looks after the system. Aimed at a competent computer user, not
necessarily a developer.

---

## What this is

One Node.js process serving a small web application, with all data in a single SQLite file.

```
Pharmacy laptop
├── node server/index.js          one process, port 4000
│     ├── /api/*                  the API
│     └── /                       the screens (pre-built files)
├── data/pharmastock.db           ← the entire system's data
└── backups/*.db                  automatic + manual copies
```

There is no database server, no web server, no internet dependency and no licence cost.

---

## Installing

**Requirement:** Node.js 20 or newer, from <https://nodejs.org> (choose LTS).

1. Copy the PharmaStock folder onto the laptop.
2. Double-click `scripts\install.bat`.

It installs everything, builds the screens, creates the database and puts a **PharmaStock**
shortcut on the desktop.

Starter accounts — **each must set its own password at first sign-in:**

| Username | Password | Role |
|---|---|---|
| `pharmacist` | `pharma123` | Pharmacist |
| `doctor` | `doctor123` | Doctor |
| `assistant1` | `assist123` | Assistant |
| `assistant2` | `assist123` | Assistant |

Delete or rename any account you do not need on the **Users** screen. The system will not let you
remove or demote the last active pharmacist.

### Sample data on first start

The very first time PharmaStock starts on an empty database it fills itself with a worked example:
12 drugs, 4 deliveries and 9 dispensing records, deliberately including expired stock, stock near
expiry and low stock, so every alert has something to show and staff can learn the system on data
that behaves realistically.

It is ordinary working data — you can dispense it, receive against it and run reports on it.

**When the pharmacy is ready to record real stock:** *Settings → Sample data → Remove all sample
data.* Every sample record is tagged, so removal is exact — anything you added yourself is kept,
and a delivery containing both sample and real drugs keeps its real lines. It does not come back on
the next restart.

The example is created **once**. If you remove it, or if the database already contains drugs, it is
never injected again. To re-create it deliberately on a database that has none:

```
npm run seed:demo
```

---

## Daily running

Double-click the desktop shortcut. Keep the console window open — closing it stops the system.

The system is at `http://localhost:4000` on the laptop itself.

---

## Backups

**This is the most important section of this guide.**

The whole system is one file: `data\pharmastock.db`. Back that up and you have backed up
everything.

### What happens automatically

- A backup is taken **every time PharmaStock starts** and **once a day** while it runs.
- Backups go to `backups\pharmastock-<date>-<time>-<label>.db`.
- The newest 30 are kept; older ones are deleted automatically.
- Backups use SQLite's online backup, so they are safe to take while people are working.

### What you must do

Automatic backups live on the same laptop. **If the laptop is lost or the disk fails, they are lost
too.** So, weekly:

1. **Settings → Backups → Back up now**
2. **Download** the newest backup
3. Save it to a USB stick or cloud folder kept somewhere else

Equally valid, with PharmaStock closed: copy the whole `data` and `backups` folders to a USB stick.

Also worth keeping: **Reports → Download all data as Excel**. A workbook of every drug, batch,
movement, delivery and dispense, readable on any computer even if the software is gone.

### Restoring

**Settings → Backups**, then either **Restore** next to a listed backup, or **Restore from file**
to pick one off a USB stick.

Before anything is replaced, the system:

1. checks the file really is a PharmaStock database, and refuses it otherwise
2. saves the current data as `pharmastock-<timestamp>-before-restore.db`

So an accidental restore is itself recoverable. After restoring, **close and restart PharmaStock**
and sign in again.

> Restoring replaces everything. Any stock recorded since that backup was taken is lost. Take a
> fresh backup first if the current data might matter.

---

## Checking the books

**Settings → Check stock integrity** verifies that every batch quantity still equals the sum of its
recorded movements — that

```
opening + received − dispensed − adjustments
```

really does equal what the screen shows, for every batch.

It should always say everything reconciles. If it ever does not, restore the most recent good
backup and report it, along with which batches were listed.

Run it after a restore, or any time the numbers are questioned.

---

## Moving to more than one computer

The system already listens on the network — no code change or reinstall is needed.

1. On the laptop, open **Settings → System information** and note the network address, e.g.
   `http://192.168.1.20:4000`.
2. On the other computer, open a browser and go to that address.
3. If it does not connect, allow Node.js through Windows Firewall on port 4000:

   ```
   netsh advfirewall firewall add rule name="PharmaStock" dir=in action=allow protocol=TCP localport=4000
   ```

Requirements: both machines on the same network, and the laptop switched on with PharmaStock
running. Everyone signs in with their own account. SQLite in WAL mode handles a handful of
concurrent users comfortably — this is a small pharmacy, not a hospital.

> The laptop's IP address can change when it reconnects to Wi-Fi. If the address stops working, ask
> whoever manages the router to give the laptop a fixed (reserved) address.

---

## Configuration

Defaults are fine for a single laptop. To change them, set environment variables before starting:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Port to listen on |
| `HOST` | `0.0.0.0` | Set to `127.0.0.1` to allow this laptop only |
| `PHARMASTOCK_DB` | `data/pharmastock.db` | Database location |
| `PHARMASTOCK_BACKUP_DIR` | `backups/` | Backup folder — point at a network drive if you have one |
| `SESSION_SECRET` | built-in | **Change this** if the system is on a shared network |
| `BACKUP_RETENTION` | `30` | How many backups to keep |

In-app settings (pharmacy name, expiry warning window, backup retention) are on the **Settings**
screen and stored in the database.

---

## Maintenance

**Monthly:** confirm backups are being created, copy one off the laptop, run the integrity check.

**Occasionally:** write off expired stock (**Adjustments → Write off all expired**) so the shelf
matches the system.

**Rarely:** the database file stays small — roughly 1 MB per few thousand movements. A busy year
might reach 10–20 MB. No maintenance is needed. To reclaim space after a large write-off:

```
node -e "const D=require('better-sqlite3');const d=new D('data/pharmastock.db');d.exec('VACUUM');d.close()"
```

Run it with PharmaStock stopped.

---

## Command reference

Run these from the project folder.

| Command | What it does |
|---|---|
| `npm start` | Start the system |
| `npm run build` | Rebuild the screens after a code change |
| `npm test` | Run the test suite (38 tests, ~6s) |
| `npm run seed` | Create the four starter accounts if the database is empty |
| `npm run seed:demo` | Add sample drugs and stock — never on live data |
| `npm run dev` | Development mode with auto-reload |

---

## If something goes wrong

**"Node.js is not installed"** — install it from nodejs.org and run `install.bat` again.

**The browser says it cannot connect** — the console window is closed. Start the system again.

**Port 4000 is already in use** — another program has it. Start with a different port:
`set PORT=4100 && npm start`

**Someone is locked out** — a pharmacist resets their password on the **Users** screen.

**The only pharmacist is locked out** — with PharmaStock stopped:

```
node -e "const D=require('better-sqlite3'),b=require('bcryptjs');const d=new D('data/pharmastock.db');d.prepare(\"UPDATE users SET password_hash=?, is_active=1, must_change_password=1 WHERE username='pharmacist'\").run(b.hashSync('reset123',10));d.close();console.log('Reset to reset123')"
```

**The screens do not load after an update** — run `npm run build`, then restart.

**Stock figures look wrong** — open the drug and read its movement history; every change is listed
with who made it and why. Then run the integrity check.

---

## Where everything lives

```
PharmaStock/
├── data/pharmastock.db     the data — back this up
├── backups/                automatic and manual backups
├── server/                 API, business logic, database schema
│   ├── lib/stock.js        every stock movement goes through here
│   ├── db/schema.sql       the database structure
│   └── test/               the test suite
├── web/                    the screens (source), web/dist is the built output
├── scripts/                install.bat, Start PharmaStock.bat
└── docs/                   this guide and the user guide
```
