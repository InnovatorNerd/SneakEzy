# SneakEzy

A complete sneaker store: storefront, customer accounts, cart, checkout, order history and an admin panel.
Backend is pure Python 3 (standard library only, no installs). Data lives in a single SQLite file.

## Run it

    python3 server.py

Open http://localhost:8000 . Admin panel: http://localhost:8000/admin.html

On first start the server prints the admin email and password once. To choose your own:

    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' python3 server.py

## What it does

- Customers: register, sign in, browse, filter (type, UK size, price), search, sort, save pairs, cart, checkout, order history.
- Checkout: Cash on Delivery works out of the box. Online payment (UPI, cards, netbanking) uses Razorpay and switches on when you set
  `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. The Razorpay flow follows their documented order + signature-verification steps but was not
  run against their live service during development, so test it with Razorpay test keys first.
- Admin: revenue and order stats, update order status (cancelling restocks items), add/edit/hide products, edit stock per size.
- Photos: in the admin product form, paste an https:// image link (Unsplash and Pexels photos are free to use). With no link, a drawn sneaker is shown.

## Safety built in

Passwords hashed with PBKDF2 (240k rounds) and per-user salt; sessions are random tokens sent in an Authorization header (no cookies, so no CSRF);
all SQL is parameterised; prices and totals are always recalculated on the server; stock is checked and reduced inside one locked transaction
so two buyers cannot take the last pair; login and signup are rate limited; every piece of user text is HTML-escaped; strict Content-Security-Policy.

## Putting it on the internet

1. Rent a small Linux server (any VPS) and copy this folder to it.
2. Run behind HTTPS. The simplest way is Caddy as a reverse proxy: `caddy reverse-proxy --from yourdomain.com --to localhost:8000`
3. Keep it running with systemd (`ExecStart=/usr/bin/python3 /path/server.py`, `Environment=HOST=127.0.0.1`, plus your admin and Razorpay variables).
4. Back up `sneakezy.db` regularly (copy the file while the server is idle, or use `sqlite3 sneakezy.db ".backup backup.db"`).

## Before you take real money

- Add your business name, address, GST details, privacy policy, returns policy and terms pages (Indian e-commerce rules require them).
- No order emails or SMS are sent yet. Add one in `create_order` in server.py (for example through an email API).
- This server is built to be simple and correct for a small store. For heavy traffic, move to PostgreSQL and a production web framework.

## Files

    server.py          backend: API, database, auth, orders, admin, payments
    static/index.html  storefront shell      static/app.js    storefront logic
    static/admin.html  admin shell           static/admin.js  admin logic
    static/style.css   shared styles (light and dark)
