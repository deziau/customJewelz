# CustomJewelz

A custom-jewellery design app. Customers drag charms, bangles and chains onto a
base piece (bracelet, pendant, kaleera…), see the piece take shape and watch the
price update as they go. You get an admin console for the repo of components,
stock alerts and the order book.

Runs as a single Node process with a SQLite database — no build step, no cloud
services, no external accounts.

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
```

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
| **Repo** | The whole component list: add, edit, retire or delete pieces, upload artwork (or point at a URL), and add stock as new deliveries arrive. Categories are editable too. |
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
scripts/seed.js     Demo data + generated sample artwork
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

## Before going live

- Change the admin password, and serve the app over HTTPS with
  `NODE_ENV=production` so the admin session cookie is marked `secure`.
- Back up `data/` — it holds the database and every uploaded image.
- Orders are recorded but not paid for in-app. Payment is collected however you
  do it today (on collection, on delivery, or a payment link you send). Adding a
  gateway means one new step between the order and its confirmation.
