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
| **Repo** | The whole component list: add, edit, retire or delete pieces, and upload artwork. **Price and stock are typed straight into the table** — the Edit dialog is only for the rest. Categories are editable too. Each colour shows three figures: **In hand** (what should be in the drawer), **For orders** (what the orders still to be made will take out of it), and **Free to sell** (the difference — what customers see, and what the stock alerts watch). |
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
| `CURRENCY` | `A$` | Initial currency symbol |
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
closing the app. It has no page of its own. The same − / + / × controls appear
in the two places you would reach for them: on an item's own page, showing how
much of it you already hold, and on the design rail beside each row. The rail's
panel header empties the lot. Nothing in the tray is charged or taken out of
the repo, and neither control will take something below what is already on the
design — it says to take it off the piece first.

**Starting a piece.** Arriving at an empty canvas with a full tray, the app asks
what is being made — *bangle with hangings, bracelet with hangings, necklace
with drops, kaleera, a single charm on a chain, a pair of earrings*, or
*something else* to lay it out by hand — and then asks only what it cannot work
out: which chain, how many hangings, how long each one is, and (on a bracelet or
necklace) whether they run the whole length or gather in the middle third. With
more than one chain in the tray, each hanging picks its own, numbered left to
right.

Before it lays anything down it compares the design against the tray and says
so if it falls short: *"Your tray is short of 22 cm of Gold Chain"* — with
**Shorten to fit**, which trims every hanging by the same share until it fits,
and **Add to my tray**, offered only when the repo can spare it. Then it places
the piece: the base centred, the hangings evenly spaced and the formation
centred on it — along the lower arc of a bangle, along the chain of a bracelet —
and zooms out if the whole thing needs more room. Everything it places can be
moved, turned or taken off afterwards; it is a starting point, not a template.
**Start a piece** under the canvas reopens it at any time.

The canvas carries a **centimetre grid**, drawn at its own scale so a square is
a square centimetre of real jewellery, with every fifth line a little stronger.

**Design** — the tray becomes the rail beside the canvas, largest piece first:
only what they picked can be placed, and each row counts down ("8 of 10 to
place"). Taking a piece off the design puts it straight back in the tray. The
bill charges for what is on the piece, never for what is still in the tray.

A strand hangs straight down from its pin, and the only thing that ever changes
that is the rotate arrows — not moving it, not selecting it, not switching
between round and straight. Its angle used to be worked out from where it sat on
a round piece, so positioning one swung it. A few pixels of wobble while tapping
no longer counts as a drag either.

**Turning a piece** is two arrows and nothing else — no number to read, none to
type. **Tap** one and the piece moves a single degree, for the last small
correction. **Hold** it — past half a second — and the piece keeps
turning, creeping away from that first degree and winding up to about a full
turn in two and a half seconds; let go and it stops exactly where it is, at
whatever angle that happened to be. Every piece keeps its own angle.

**Nothing is a "base".** A chain, a bangle, a frame — whatever a piece is built
around is just the first thing placed, and everything sits on the canvas the
same way. Sections are only for browsing; none of them is privileged. The
canvas scales to the largest thing on it, so a 10 mm bell on a 74 mm kada looks
like a 10 mm bell on a 74 mm kada. **Remove everything** hands the lot back to
the tray, and any single piece can be selected and taken off on its own.

At checkout, if anything in the tray was not used, the customer is asked whether
to **keep it for next time** or **discard it** before the order goes through.
Use everything and the tray simply empties. Ordering requires an **account** —
created with a name, email, phone and a PIN, and signed into with either the
email or the phone. Signed-in customers get a **My orders** room showing every
order they have placed, its status, and a picture of the piece they designed —
with **Edit order** and **Cancel order** in the card's top right and the time
left directly under them ("54 min left to change or cancel"), so nothing has to
be opened to find out whether there is still time. Both close an hour after the
order is placed.

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

**Customers can change their mind, for an hour.** Within that hour they can
reopen the design — the order's components return to their tray, the design
loads back onto the canvas, and placing it again saves onto the *same* order
number rather than making a second one — or cancel outright. Both sit on the
order card with the time remaining under them. An order held open for changes
releases its claim on the repo, so nothing is counted twice.

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

**Components sold by length.** A component can be sold by the piece or by
length — chain, cord, ribbon. A length component is priced **per metre**,
stocked in centimetres, and bought by the metre rather than by the count: the
product page asks *how much*, not *how many*, and prices it live.

In the design room a length becomes **hangings**. Dropping chain onto a piece
asks how long that hanging should be, and each one draws to its true length
against everything else — so five tassels of 8, 12, 18, 25 and 15 cm come off
one 2 m reel and look like what they are. The tray tracks the metres left, and
a hanging longer than what remains is refused with how much is left.

**Two ways to see the piece.** *Round* for a necklace or bracelet, drawn against
a hoop; *straight* for a kaleera, a keychain or any hanging piece, drawn against
a rail. The switch sits under the canvas, a faint guide shows which you are in,
and the choice travels with the order and its picture. The guide is a drawing
aid only — it never moves or turns anything itself.

**A colour has two counts, and they are kept apart.** *In hand* is what is in
the drawer, and it only comes down when an order is marked **Ready** and the
pieces are actually pulled to be made — not when the order arrives. *Free to
sell* is what is left once the orders still to be made have claimed theirs, and
that is the number customers are offered. So an order for the last bangle leaves
the repo showing 1 in hand, 1 for orders, 0 free to sell, and the shop showing
it sold out. Marking that order Ready takes the bangle out of the drawer;
putting it back to *Being made* puts the bangle back. Marking Ready when the
drawer cannot cover it is refused.

The studio's **Overview** opens on what the repo holds: how many components
there are (with the number of colours across them), and how many pieces are in
hand — what should be in the drawer — with how many of those are still free to
sell once the open orders have claimed theirs. Chain is measured, not counted,
so its metres are reported beside the piece count rather than added to it. Both
tiles open the repo.

**Everything on the canvas is drawn at the size it really is** — and while the
design fits, at life size: a 65 mm bangle measures 65 mm on the screen, on the
same 96-pixels-to-the-inch convention the product page's centimetre rule uses.
A charm is laid down at the width and height entered for it, so a 10 mm bell
beside a 70 mm frame is a seventh of its width, not a thumbnail beside a
thumbnail. **Nothing is rescaled behind the customer's back**: adding a piece never
changes the size or position of what is already down, which it used to, every
time something bigger arrived. The canvas holds whatever scale it is set to, and
the tools underneath carry a zoom — − and + step it, the label between them
(*Actual size*, or *125% of actual size*) comes back to life size, and **Fit**
appears when something runs past the edge and brings the whole piece into view.
The zoom works on the canvas the way it works on a photograph: pieces grow and
draw apart together about the middle, and what falls outside the frame is simply
outside the frame. Nothing on the piece moves — dragging keeps up with the
pointer at any zoom — and the picture saved with an order shows the same view.
A piece placed too big for the view is simply told: *"That runs past the canvas
at this size — press Fit to bring it all into view."* The picture saved with an
order **is** the canvas: the same scale, the same positions, the same angles, so
what the customer pressed the button on is what the bench is asked to make.
Because of that, ordering with something past the edge asks first — *"Part of
your piece is off the canvas… bring it all into view?"* — rather than quietly
cutting it out of the picture or quietly rescaling what they arranged. The design saved with an order is drawn the same way. Since a sticker is
stretched to those measurements, crop it tight to the piece: an empty margin is
drawn along with it.

**A strand is drawn to scale.** The editor asks how many centimetres of chain
the sticker shows, and the canvas repeats that tile at exactly that length: a
sticker of 4 cm makes five repeats on a 20 cm strand and ten on a 40 cm one, so
the links stay the size of real links however long a customer cuts it. The
strand is drawn as wide as the millimetres you entered, beside charms drawn at
theirs, with nothing padded for visibility: a 2 mm chain next to a 110 mm frame
is a thread next to a frame, because that is what it is. Both numbers are
required on a component sold by length — the width the strand is drawn, and the
length its sticker shows.

**A length is stocked in metres.** The studio types 2.5 for two and a half; the
app keeps it to the centimetre underneath, because that is how it is cut. Under
a metre of any colour and the editor says so before you save — it can still be
sold and cut, but it counts as low stock and will not stretch to a long hanging
— and the repo table marks that cell "m · under a metre". Pieces are still
whole numbers.

A component **sold by length** is described by its width alone — the editor
stops asking for a height, since the customer chooses how long a piece of it
they want. Customers read it the same way: "2 mm wide" on the card, "2 mm wide
· cut to the length you choose" on the product page.

**SKUs give themselves out.** Adding a component in the studio, you never type
a code: it is built from the section, the name and the number of that *kind* of
piece — `CHARMS-BBYCLT-001` for the first baby cloth in Charms — and each colour
hangs its own code off the end, `CHARMS-BBYCLT-001-BLUE`. The count runs per
kind, not per section: a second baby feet is `CHARMS-BBYFT-002`, and a baby
cloth entered after it still starts at `CHARMS-BBYCLT-001`. Two names that
shorten to the same code share one run of numbers, which is usually what you
want — "Baby cloth" and "Baby cloth pink" are 001 and 002 of the same family. A single short
word is left alone (BLUE stays BLUE); anything longer is shortened the way a
stock label is, first letter of each word then its consonants, so "Baby cloth"
reads BBYCLT. The code appears in the dialog as you choose the section and type
the name, and the numbers come from the codes already given out, so deleting the
fourth of five never re-issues a number a printed label is still using. A saved
component keeps its code even when it is renamed or moved, because orders and
labels already carry it; **Renumber** in the editor re-derives it when you do
want it to follow.

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

**Stickers** — a photo is a rectangle: the piece, and the sheet it was shot on.
Laid on the canvas that rectangle would cover whatever it overlaps, and a design
would look like a stack of cards. So a component carries two sets of pictures,
kept apart. **Photos** are what customers see in the collection and on the
product page. **Stickers** are the same pieces cut out on a transparent
background — PNGs you save with no backdrop — and they appear nowhere but the
design canvas, where they get a soft shadow so a stack of them reads as one
assembled piece; the design saved on the order is drawn the same way. At least
one sticker is required before a component can be saved. Upload one per colour,
in the same order as the colours, and the sticker follows the colour the
customer picked, exactly as the photos do. In **Component repo → Edit** each
sticker sits on a chequerboard: if you cannot see the chequers through it, that
file still has a background.

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
- Stickers are files you supply; nothing removes a background for you. A
  component saved before stickers existed falls back to its photo on the canvas
  rather than showing nothing. Photos and stickers both live inside the
  component's own record, which is why the editor refuses a component grown too
  big to save — drop a picture and try again.

## Before going live

- Change the admin password, and serve the app over HTTPS with
  `NODE_ENV=production` so the admin session cookie is marked `secure`.
- Back up `data/` — it holds the database and every uploaded image.
- Orders are recorded but not paid for in-app. Payment is collected however you
  do it today (on collection, on delivery, or a payment link you send). Adding a
  gateway means one new step between the order and its confirmation.
