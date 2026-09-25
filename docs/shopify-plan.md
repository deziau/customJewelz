# Moving the kaleera shop to Shopify

Shopify runs payments, stock, orders, tax, emails and customer accounts. We keep
the one thing nobody else has: the kaleera builder (Create in `hosted/index.html`).

## Shape of it

```
Shopify store
├─ Products: every bangle, charm and chain, with stock per colour
│    metafields  custom.role (bangle|charm|chain), custom.width_mm, custom.height_mm,
│                custom.loop (x,y %), custom.spots_at (bangle loops), custom.tile_cm (chain)
├─ "Build your kaleera" product page
│    └─ Theme app extension block: the builder (Create), reading the parts as JSON
│       that Liquid writes into the page (no API calls, stock is live at page load)
├─ "Your kaleera" bundle product (one per order line, priced at 0)
│    └─ Cart Transform function: expands it into its parts, so each part's stock
│       goes down and each part is priced from Shopify's own prices, not the browser's
└─ App proxy (/apps/kaleera): uploads the design picture and personal photos to
   Shopify Files, and hands back the URLs the cart line carries
```

## How a designed pair becomes an order

1. The customer builds both hands in the builder, exactly as today.
2. **Add to cart** posts one line: the bundle product, with line item properties
   - `_parts` – `[{variantId, qty}]` for every bangle, charm and chain (chain in cm),
   - `_design` – the hands/strands JSON the builder already saves (`S.build.hands`),
   - `_preview` – URL of the pair's picture (uploaded through the app proxy),
   - `_personal` – letter text and photo URLs for personalised charms.
   Properties starting with `_` are hidden from the customer at checkout.
3. The Cart Transform (`lineExpand`) turns that line into its parts. Prices come
   from each part variant, so a changed price in the browser changes nothing. Up
   to 150 parts per line; a full pair is roughly 2 bangles + 14 strands + 40 charms.
4. Checkout, payment and stock are Shopify's. The studio sees the order with its
   parts; an order-details admin block shows `_preview` and `_design`.

**Chain sold by the cm**: each chain colour is a variant priced per cm with stock
in cm, so 12 cm of chain is quantity 12.

## What maps where

| Today | On Shopify |
|---|---|
| Catalogue, stock per colour | Products and variants, inventory per variant |
| Holds (stock spoken for) | Shopify inventory reservation at checkout |
| Customer details, orders | Shopify customers and orders |
| Studio catalogue editor | Shopify admin, plus the builder's loop picker as an admin extension |
| Change an order within the hour | Order editing (Admin API `orderEditBegin`) from a customer account extension, later |
| Restock requests, rush fee | A back-in-stock app; the rush fee as its own product |
| Order picture | `_preview` property plus the order admin block |

## Build steps

1. **You**: create a free development store (Partner dashboard, Stores, Add store,
   Development store) and run `shopify auth login` on this computer.
2. Scaffold the app (`shopify app init`, Remix), add the theme app extension, the
   cart transform function and the app proxy. About 1 day.
3. Import the 60 products with images (the new AI renders), variants, stock and
   metafields with the Admin GraphQL `productSet` and `stagedUploadsCreate`. About 1 day.
4. Port Create into the app block: swap the artifact database for the Liquid JSON
   and the cart post; keep the drawing, strands and both hands. About 2 to 3 days.
5. Cart transform and its tests (`shopify app function run` with sample carts). About 1 day.
6. App proxy uploads, the order admin block, personalised charms. About 2 days.
7. Theme polish (jewel-case stage, 44 px controls, the review step with both hands). About 2 days.

## Decisions for you

- Shopify plan at launch (Basic is enough to start) and Shopify Payments for Australia.
- The domain the shop lives on.
- Whether customers need accounts, or check out as guests (recommended: guest, with
  accounts optional).
