# CustomJewelz

A custom-jewellery design app. Customers drag charms, bangles and chains onto a
base piece (bracelet, pendant, kaleera…), see the piece take shape and watch the
price update as they go. You get an admin console for the repo of components,
stock alerts and the order book.

There are two ways to run it, both from this repository:

1. **The hosted app** (`hosted/index.html`) — one self-contained page backed by
   the Claude artifact database. Published at a URL you open on a phone or a PC
   and add to the home screen. Nothing to install or maintain.
2. **The self-hosted app** (`server/` + `public/`) — a single Node process with
   a SQLite database, which you run on your own machine or server. It enforces
   stock server-side, so a customer cannot oversell by editing the page.

Both offer the same designer, cost calculator, stock rules, studio and order
book. Everything below describes the self-hosted app unless it says otherwise.

## Quick start

```bash
npm install
npm run seed     # optional: demo categories, 15 sample pieces, shipping areas
npm start
```

- Shop: <http://localhost:3000>
- Admin: <http://localhost:3000/admin> — default password `admin123`

**Change the admin password in Settings before anyone else can reach the app.**
You can also set `ADMIN_PASSWORD` before the first run to choose the initial one.

```bash
npm test         # end-to-end smoke test against a throwaway database
npm run reset    # wipe orders + catalog and re-seed the demo data
npm run icons    # regenerate the app icons from scripts/icons.js
```

### Installing it on a phone or desktop

The app is a PWA: it ships a web manifest, an offline app shell and its own
icons, so browsers offer to install it.

- **Android / Chrome / Edge** — open the app, then *Install app* from the
  browser menu (Chrome usually offers it by itself).
- **iPhone / iPad** — open it in Safari, then *Share → Add to Home Screen*.
- **Windows / macOS** — Chrome or Edge shows an install icon in the address bar.

Installing needs the app served over **HTTPS**, or from `localhost` on the same
machine. The app shell is cached so it opens instantly and survives a dropped
connection; anything under `/api` is always fetched live, so stock counts and
orders are never served stale.

## What the customer sees

- **Repo panel** — every active piece, grouped by category, with its price and
  how many are left.
- **Canvas** — pick a base piece, then drag charms onto it. Drag a charm to
  reposition, click to select, then resize, rotate, bring to front or delete
  (buttons or the Delete key). Tapping a charm adds it too, so the designer
  works on touch screens; repeated taps fan out instead of stacking.
- **Cost calculator** — the sticky bar at the top and the basket on the right
  update on every add and remove, and the itemised list shows each piece.
- **Stock limits** — a charm that is out of stock cannot be added, and adding
  more than the repo holds is refused with *"Only 9 of Om charm are available."*
  The server re-checks this when the order is placed, so a shopper cannot
  oversell by editing the page.
- **Checkout** — *collect when ready* (no charge) or *ship when ready*, which
  adds the shipping cost for the chosen delivery area to the total.

## What the admin sees

| Section | What it does |
| --- | --- |
| **Dashboard** | Open/ready order counts, stock alerts, order value, and a pick list of every component the open orders need — with a *short* flag when the repo cannot cover them. |
| **Repo** | The whole component list: add, edit, retire or delete pieces, upload artwork (or point at a URL), and add stock as new deliveries arrive. Categories are editable too. Each colour shows three figures: **In hand** (what should be in the drawer), **For orders** (what the orders still to be made will take out of it), and **Free to sell** (the difference — what customers see, and what the stock alerts watch). |
| **Stock alerts** | *Out of stock*, *Low quantity* (below the threshold, default 10) and *Healthy stock*, each with the same inline restock controls. |
| **Orders** | Every order with its customer, fulfilment choice, the exact pieces it needs, total and status. Filter by status; open **Details** for the full pick list and delivery address. |
| **Shipping** | Delivery areas with their cost and ETA. These are what the customer picks from at checkout. |
| **Settings** | Business name, currency symbol, low-stock threshold, admin password. |

### Stock accounting

Placing an order decrements every component it uses, inside one transaction, so
two shoppers cannot buy the last charm at the same time. Cancelling an order
returns its components to the repo; reopening a cancelled order takes them out
again (and refuses if the stock is no longer there). Every movement is recorded
in `stock_moves` with its reason, so the repo has an audit trail.

Deleting a component that appears on a past order retires it (hidden from
customers) instead of deleting it, so order history stays intact.

## Project layout

```
server/
  index.js          Express app + startup
  db.js             SQLite schema and connection
  auth.js           Admin password + session cookies
  store.js          Pricing, stock rules, orders  ← the business logic lives here
  routes/public.js  Catalog, quote, place order
  routes/admin.js   Catalog CRUD, stock, orders, shipping, settings
public/
  index.html js/designer.js   Customer designer
  admin.html js/admin.js      Admin console
  manifest.webmanifest sw.js  Installable app shell
hosted/index.html   The hosted single-page build (artifact database)
scripts/seed.js     Demo data + generated sample artwork
scripts/icons.js    Renders the app icons (no image dependencies)
test/smoke.js       End-to-end API test
data/               SQLite database + uploaded images (git-ignored)
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `ADMIN_PASSWORD` | `admin123` | Initial admin password (first run only) |
| `CURRENCY` | `₹` | Initial currency symbol |
| `BUSINESS_NAME` | `CustomJewelz` | Initial shop name |
| `DB_PATH` | `data/customjewelz.db` | Database file |
| `NODE_ENV` | — | Set to `production` to mark the session cookie `secure` |

## The hosted build

`hosted/index.html` is the current, fuller product as one page, and the one
customers actually use. It works in three rooms:

**Browse** — the collection as a card grid, filtered by section and searchable.
Each item opens a product page with its photos, a written description, colour
options and a quantity stepper. A colour that is sold out cannot be picked, and
the stepper stops at what the repo actually holds. Adding puts the item in the
customer's **tray**.

**Tray** — the customer's own picks, held in their browser, so it survives
closing the app. Quantities can be changed or dropped there. Nothing in the tray
is charged or taken out of the repo.

**Design** — the tray becomes the rail beside the canvas: only what they picked
can be placed, and each row counts down ("8 of 10 to place"). Taking a piece off
the design puts it straight back in the tray. The bill charges for what is on
the piece, never for what is still in the tray.

The base piece is selectable like anything else on the canvas, and taking it off
leaves the charms where they are, so a band can be swapped without rebuilding
the arrangement. Two clearing actions sit in the top bar: **Remove all but
base**, and **Remove everything**. Both hand every piece straight back to the
tray, so nothing is ever lost by clearing.

At checkout, if anything in the tray was not used, the customer is asked whether
to **keep it for next time** or **discard it** before the order goes through.
Use everything and the tray simply empties. Ordering requires an **account** —
created with a name, email, phone and a PIN, and signed into with either the
email or the phone. Signed-in customers get a **My orders** room showing every
order they have placed, its status, and a picture of the piece they designed.

A picture of the finished piece is rendered when the order is placed and
travels with it: on the customer's confirmation and order list, as a thumbnail
in the studio's order book, and full size in the order's details. Opening an
order — from either side — gives the same record: the piece large on the left
at 70% of the width, and everything else down the right, with the customer's
note at the top where it cannot be missed.

**Order status carries a comment.** Every move is recorded with who made it and
why. *Being made*, *Ready* and *Dispatched* apply a standing note automatically;
cancelling asks the studio for a reason, and refuses to proceed without one,
because the customer reads it. The studio can also post a free-text update
without changing the status. The whole history shows as a timeline on both
sides.

**Customers can change their mind, briefly.** Within one hour of ordering they
can reopen the design: the order's components return to their tray, the design
loads back onto the canvas, and placing it again saves onto the *same* order
number rather than making a second one. Within two hours they can cancel
outright. Both windows show the time remaining. An order held open for changes
releases its components back to the repo, so nothing is claimed twice.

**Restock requests.** Whenever a customer cannot add another — the repo is
empty, or they already hold every one we have in their tray — they are offered
a restock request in two kinds: a plain one, and an **urgent** one carrying a
rush fee set per component in the studio (a component with no fee is not
offered urgently). Requests land in the studio under two separate displays,
**Urgent restock requests** and **Restock requests**, both grouped by component
and colour. The plain display is demand, not correspondence: it shows how many
customers are waiting and how many pieces they asked for between them, and
names nobody. The rush display names each customer, because each one is owed an
answer. The quantity is optional on the
customer's side — leaving it blank means "just tell me when it's in", and the
studio sees that plainly rather than a fabricated number; the group total is
shown as "12+ wanted" because it only counts the people who named one.
Setting an expected-back date there replaces the request with "more
expected around …" for every customer, so nobody asks twice; *Mark done* clears
the requests and the date once the piece has landed and they have been told.

A plain request with **no quantity** on it says only "tell me when it's back",
so adding stock answers it: those requests close themselves, stamped *Restocked
on <date>*, and any expected-back date on that colour is cleared. Requests that
named a quantity stay open — a partial delivery may not cover what they asked
for — and so do rush requests, which carry a promised date or money and are the
studio's to settle.

**Rushing is a negotiation, not a button.** A customer with a plain request can
elevate it to urgent, and the request then walks a short path: *waiting for the
studio* → the studio either confirms it can be done **and gives a date**, or
declines with a reason the customer reads. Only a confirmed request shows the
customer a pay control at all; declining leaves their ordinary request standing
so they still hear when the piece is back, and the studio can reconsider later.

The app takes no card payments, so "pay" here means the customer gives the
go-ahead and the studio records the money when it arrives. Both steps are
visible on the request, and the fee never appears as collected until the studio
says it is.

**Every component carries its real size**, in millimetres, entered once in the
studio. Customers see it in both units — "1.2 × 1.2 cm · 0.47 × 0.47 in" — on
the card and the product page, and the product photo is drawn at that true
size, with zoom controls and a centimetre rule beside it to check against. When
both a base and a charm are measured, the design canvas draws them to scale to
each other, so a 12 mm heart on a 65 mm band looks like one.

True size assumes the browser convention of 96 pixels to the inch. That is what
every "actual size" feature relies on and it is close on most screens, but it
is an approximation of the real display — hence the rule.

Stock is counted **per colour** — each colour has its own SKU and count, so gold
hearts running out does not hide the silver ones. Every count a customer sees
is about one colour: a browse card warns per colour with just the count —
"5 left", "all in your tray" — tinted in that colour, beside a dot of it, and
shows a plain dot for a colour with plenty in hand. The colour's name stays on
hover and for screen readers, so the tint is never the only thing carrying the
meaning. Only a piece with nothing left in any colour gets
the corner "Sold out" banner. All of these subtract what is already in the
shopper's own tray, so no two numbers in the shop can disagree. Where a component has one
photo per colour, in the same order, the picture follows the colour the customer
picks, in the shop and on the piece.

It keeps the catalogue, delivery areas, orders and settings in the artifact
database rather than SQLite, so it needs no server at all. Differences worth
knowing:

- The studio is behind a PIN (`2468` by default, changeable under **Setup**).
  That keeps the studio out of the way on a shared screen; it is not a security
  boundary, so treat the link itself as the thing to control.
- Customer accounts are the same kind of soft gate. PINs are salted and hashed
  rather than stored in the clear, but the shop's data is readable by everyone
  the artifact is shared with, so treat an account as a way to keep orders
  together — not as protection. Don't let customers reuse a real password, and
  don't put anything sensitive in an order note.
- Status emails are not sent by the app. The studio has the customer's address
  on every order and every restock request; sending is still a manual step.
- Stock is re-checked against the live database at the moment an order is
  placed, so a stale tab cannot claim components that have since gone. Two
  customers ordering the very last charm within the same instant is still
  possible — the self-hosted build closes that window with a transaction.
- Component artwork is a set of uploaded photos (or an emoji if you have none),
  shrunk in the browser so each component record stays small.

## Before going live

- Change the admin password, and serve the app over HTTPS with
  `NODE_ENV=production` so the admin session cookie is marked `secure`.
- Back up `data/` — it holds the database and every uploaded image.
- Orders are recorded but not paid for in-app. Payment is collected however you
  do it today (on collection, on delivery, or a payment link you send). Adding a
  gateway means one new step between the order and its confirmation.
