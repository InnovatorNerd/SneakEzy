#!/usr/bin/env python3
"""SneakEzy: a complete sneaker store backend using only the Python standard library.

Run:  python3 server.py
Open: http://localhost:8000      Admin: http://localhost:8000/admin.html
"""
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DB_PATH = os.environ.get("DB_PATH", str(BASE / "sneakezy.db"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
FREE_SHIPPING_ABOVE = 7999
SHIPPING_FEE = 149
SESSION_DAYS = 14
SIZES = [6, 7, 8, 9, 10, 11]
CATEGORIES = ["Running", "Basketball", "Trail", "Lifestyle"]
ORDER_STATUSES = ["pending", "placed", "shipped", "delivered", "cancelled"]
RZP_KEY = os.environ.get("RAZORPAY_KEY_ID", "")
RZP_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


# ---------------------------------------------------------------- database
def db():
    con = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA journal_mode=WAL")
    return con


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL, pw_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
  created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL,
  was INTEGER, rating REAL NOT NULL DEFAULT 4.5, badge TEXT, description TEXT NOT NULL DEFAULT '',
  image_url TEXT, colors TEXT NOT NULL, stock TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, total INTEGER NOT NULL,
  status TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL,
  address TEXT NOT NULL, rzp_order_id TEXT, rzp_payment_id TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL,
  qty INTEGER NOT NULL, price INTEGER NOT NULL);
"""

SEED = [
    ("Aero Dash", "Running", 5499, 6999, 4.7, "Sale", [6, 7, 8, 9, 10, 11], ["#F2F3EE", "#E8470F", "#1A1E1C", "#D5D8D0"], "Featherlight mesh upper and a springy foam midsole for daily 5K to 10K runs."),
    ("Court Mono", "Basketball", 8999, None, 4.6, "New", [7, 8, 9, 10, 11], ["#16181A", "#F5C400", "#F2F2EE", "#2B2F32"], "High-grip outsole, padded collar and a lockdown strap for quick cuts on indoor courts."),
    ("Ridge Trail", "Trail", 7499, None, 4.5, None, [6, 7, 8, 9, 10], ["#5E6B4A", "#E9D8A6", "#2A2F25", "#4A563A"], "Deep lugs, rock plate and a water-shedding upper for loose gravel and wet roots."),
    ("Daily Low", "Lifestyle", 3999, None, 4.4, None, [6, 7, 8, 9, 10, 11], ["#F7F7F5", "#1F3A5F", "#E7E5DC", "#DEDED8"], "A clean low top that goes with jeans, chinos and everything between."),
    ("Pulse Max", "Running", 9999, None, 4.9, "New", [7, 8, 9, 10], ["#1D2B64", "#43E3C1", "#F4F4F0", "#14204B"], "Plated, high-stack foam for tempo days and race morning."),
    ("Terra Hi", "Lifestyle", 6299, 7499, 4.3, "Sale", [6, 7, 8, 9, 11], ["#B5835A", "#2D1E14", "#EFE6D8", "#9A6D47"], "Suede high top with a gum sole. Breaks in softly and ages well."),
    ("Night Shift", "Basketball", 7999, None, 4.5, None, [8, 9, 10, 11], ["#0F1012", "#FF3D6E", "#0F1012", "#25272B"], "All-black build with reflective trim. Cushioned heel for hard landings."),
    ("Cloud Slip", "Lifestyle", 3499, None, 4.2, None, [6, 7, 8, 9, 10, 11], ["#C9D6E8", "#FFFFFF", "#F6F7F9", "#AEBED6"], "Easy slip-on knit with a stretch collar. Light enough to forget you're wearing it."),
    ("Summit GTX", "Trail", 11499, None, 4.8, None, [7, 8, 9, 10, 11], ["#C2410C", "#1C1917", "#1C1917", "#9A3412"], "Waterproof membrane and a stiff midsole built for long ridge days."),
    ("Tempo Lite", "Running", 4499, None, 4.4, None, [6, 7, 8, 9, 10, 11], ["#E6F2FF", "#2563EB", "#E6E9EE", "#C9DDF2"], "Breathable, neutral and light. A reliable first pair for new runners."),
    ("Retro 84", "Lifestyle", 5299, 5999, 4.6, "Sale", [6, 7, 8, 9, 10], ["#F4EDE1", "#C1121F", "#F4EDE1", "#E4D9C6"], "Old-school court profile with a stitched stripe and a cupsole you can feel."),
    ("Flash Rise", "Basketball", 6799, None, 4.3, None, [6, 7, 8, 9, 10, 11], ["#E11D48", "#FDE047", "#F5F5F4", "#BE123C"], "Bright, bouncy and fast. A forgiving fit for guards who play on their toes."),
]


def _u(photo_id):
    return f"https://images.unsplash.com/photo-{photo_id}?auto=format&fit=crop&w=900&q=75"


# Free-to-use Unsplash photos (Unsplash License). They are stand-ins: replace them with
# photos of your own products in the admin panel before you sell anything.
IMAGES = {
    "Aero Dash": _u("1600185365926-3a2ce3cdb9eb"),
    "Court Mono": _u("1654130491481-dc83a0a05e4e"),
    "Ridge Trail": _u("1499852848443-3004d6dc4cfc"),
    "Daily Low": _u("1634671494478-18ae96453241"),
    "Pulse Max": _u("1571008887538-b36bb32f4571"),
    "Terra Hi": _u("1542272604-78d13c1f741a"),
    "Night Shift": _u("1460353581641-37baddab0fa2"),
    "Cloud Slip": _u("1551747777-458b63c6ae38"),
    "Summit GTX": _u("1679284392448-e0812fbe3e8b"),
    "Tempo Lite": _u("1615743472612-93b21e520fad"),
    "Retro 84": _u("1615743472612-93b21e520fad"),
    "Flash Rise": _u("1654130491481-dc83a0a05e4e"),
}


def hash_pw(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 240_000)
    return salt, digest.hex()


def init_db():
    con = db()
    con.executescript(SCHEMA)
    if con.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        for name, cat, price, was, rating, badge, sizes, colors, desc in SEED:
            stock = {str(s): 12 for s in sizes}
            con.execute(
                "INSERT INTO products(name,category,price,was,rating,badge,description,colors,stock) VALUES(?,?,?,?,?,?,?,?,?)",
                (name, cat, price, was, rating, badge, desc, json.dumps(colors), json.dumps(stock)),
            )
    con.execute("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)")
    if not con.execute("SELECT 1 FROM meta WHERE k='images_v1'").fetchone():
        for pname, url in IMAGES.items():
            con.execute("UPDATE products SET image_url=? WHERE name=? AND image_url IS NULL", (url, pname))
        con.execute("INSERT INTO meta(k,v) VALUES('images_v1','1')")
    if con.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0] == 0:
        email = os.environ.get("ADMIN_EMAIL", "admin@sneakezy.local").lower()
        password = os.environ.get("ADMIN_PASSWORD")
        generated = not password
        password = password or secrets.token_urlsafe(10)
        salt, h = hash_pw(password)
        con.execute(
            "INSERT OR IGNORE INTO users(name,email,salt,pw_hash,role,created) VALUES(?,?,?,?,?,?)",
            ("Store Admin", email, salt, h, "admin", int(time.time())),
        )
        print("\n  Admin account created")
        print(f"    email:    {email}")
        print(f"    password: {password}" + ("   (generated, shown once; set ADMIN_PASSWORD to choose your own)" if generated else ""))
        print()
    con.close()


# ---------------------------------------------------------------- helpers
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
_attempts = {}


def throttle(key, limit=10, window=300):
    now = time.time()
    hits = [t for t in _attempts.get(key, []) if now - t < window]
    if len(hits) >= limit:
        raise ApiError(429, "Too many attempts. Please wait a few minutes and try again.")
    hits.append(now)
    _attempts[key] = hits


def clean(value, label, min_len=1, max_len=200):
    if not isinstance(value, str):
        raise ApiError(400, f"{label} is required.")
    value = value.strip()
    if not (min_len <= len(value) <= max_len):
        raise ApiError(400, f"{label} must be {min_len} to {max_len} characters.")
    return value


def to_int(value, label, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{label} must be a whole number.")
    if not lo <= n <= hi:
        raise ApiError(400, f"{label} must be between {lo} and {hi}.")
    return n


def product_row(r, admin=False):
    d = {
        "id": r["id"], "name": r["name"], "category": r["category"], "price": r["price"],
        "was": r["was"], "rating": r["rating"], "badge": r["badge"], "description": r["description"],
        "image_url": r["image_url"], "colors": json.loads(r["colors"]),
    }
    stock = json.loads(r["stock"])
    d["sizes"] = sorted(int(s) for s, q in stock.items() if q > 0)
    d["left"] = {s: q for s, q in stock.items() if 0 < q <= 3}
    if admin:
        d["stock"] = stock
        d["active"] = bool(r["active"])
    return d


def order_row(con, r, with_user=False):
    items = [dict(i) for i in con.execute("SELECT product_id,name,size,qty,price FROM order_items WHERE order_id=?", (r["id"],))]
    d = {
        "id": r["id"], "subtotal": r["subtotal"], "shipping": r["shipping"], "total": r["total"],
        "status": r["status"], "payment_method": r["payment_method"], "payment_status": r["payment_status"],
        "address": json.loads(r["address"]), "created": r["created"], "items": items,
    }
    if with_user:
        u = con.execute("SELECT name,email FROM users WHERE id=?", (r["user_id"],)).fetchone()
        d["customer"] = {"name": u["name"], "email": u["email"]} if u else None
    return d


def validate_product(body):
    name = clean(body.get("name"), "Name", 2, 80)
    category = body.get("category")
    if category not in CATEGORIES:
        raise ApiError(400, "Choose a valid category.")
    price = to_int(body.get("price"), "Price", 1, 1_000_000)
    was = body.get("was")
    was = to_int(was, "Old price", 1, 1_000_000) if was not in (None, "") else None
    rating = float(body.get("rating") or 4.5)
    if not 1 <= rating <= 5:
        raise ApiError(400, "Rating must be between 1 and 5.")
    badge = body.get("badge") or None
    if badge not in (None, "New", "Sale"):
        raise ApiError(400, "Badge must be New, Sale or empty.")
    description = clean(body.get("description", ""), "Description", 0, 600)
    image_url = (body.get("image_url") or "").strip() or None
    if image_url and not re.match(r"^https://[^\s\"'<>]+$", image_url):
        raise ApiError(400, "Image URL must start with https://")
    colors = body.get("colors") or ["#F2F3EE", "#E8470F", "#1A1E1C", "#D5D8D0"]
    if not (isinstance(colors, list) and len(colors) == 4 and all(isinstance(c, str) and re.match(r"^#[0-9a-fA-F]{6}$", c) for c in colors)):
        raise ApiError(400, "Colours must be four hex values like #FFFFFF.")
    raw = body.get("stock") or {}
    stock = {}
    for s in SIZES:
        q = to_int(raw.get(str(s), 0), f"Stock for UK {s}", 0, 100_000)
        stock[str(s)] = q
    return (name, category, price, was, rating, badge, description, image_url, json.dumps(colors), json.dumps(stock))


# ---------------------------------------------------------------- business logic
def create_user(body):
    name = clean(body.get("name"), "Name", 2, 80)
    email = clean(body.get("email"), "Email", 5, 254).lower()
    if not EMAIL_RE.match(email):
        raise ApiError(400, "Enter a valid email address.")
    password = body.get("password")
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise ApiError(400, "Password must be 8 to 128 characters.")
    salt, h = hash_pw(password)
    con = db()
    try:
        cur = con.execute("INSERT INTO users(name,email,salt,pw_hash,created) VALUES(?,?,?,?,?)", (name, email, salt, h, int(time.time())))
    except sqlite3.IntegrityError:
        con.close()
        raise ApiError(409, "An account with this email already exists.")
    uid = cur.lastrowid
    token = new_session(con, uid)
    con.close()
    return {"token": token, "user": {"id": uid, "name": name, "email": email, "role": "customer"}}


def new_session(con, uid):
    token = secrets.token_urlsafe(32)
    con.execute("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)", (token, uid, int(time.time()) + SESSION_DAYS * 86400))
    return token


def login(body, ip):
    throttle("login:" + ip)
    email = clean(body.get("email"), "Email", 3, 254).lower()
    password = body.get("password")
    if not isinstance(password, str):
        raise ApiError(400, "Password is required.")
    con = db()
    u = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    salt = u["salt"] if u else "00" * 16
    _, h = hash_pw(password, salt)
    if not u or not hmac.compare_digest(h, u["pw_hash"]):
        con.close()
        raise ApiError(401, "Email or password is incorrect.")
    token = new_session(con, u["id"])
    con.close()
    return {"token": token, "user": {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]}}


def create_order(user, body):
    items = body.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 30:
        raise ApiError(400, "Your cart is empty.")
    merged = {}
    for it in items:
        pid = to_int(it.get("product_id"), "Product", 1, 10**9)
        size = to_int(it.get("size"), "Size", 1, 20)
        qty = to_int(it.get("qty"), "Quantity", 1, 10)
        merged[(pid, size)] = merged.get((pid, size), 0) + qty
    a = body.get("address") or {}
    address = {
        "name": clean(a.get("name"), "Full name", 2, 80),
        "phone": clean(a.get("phone"), "Phone", 10, 15),
        "line1": clean(a.get("line1"), "Address", 5, 200),
        "city": clean(a.get("city"), "City", 2, 80),
        "state": clean(a.get("state"), "State", 2, 80),
        "pin": clean(a.get("pin"), "PIN code", 6, 6),
    }
    if not re.match(r"^\+?[0-9 ]{10,15}$", address["phone"]):
        raise ApiError(400, "Enter a valid phone number.")
    if not address["pin"].isdigit():
        raise ApiError(400, "PIN code must be 6 digits.")
    method = body.get("payment")
    if method not in ("cod", "online"):
        raise ApiError(400, "Choose a payment method.")
    if method == "online" and not (RZP_KEY and RZP_SECRET):
        raise ApiError(400, "Online payment is not set up on this store yet. Please choose Cash on Delivery.")

    con = db()
    try:
        con.execute("BEGIN IMMEDIATE")
        lines, subtotal = [], 0
        for (pid, size), qty in merged.items():
            p = con.execute("SELECT * FROM products WHERE id=? AND active=1", (pid,)).fetchone()
            if not p:
                raise ApiError(404, "One of the pairs in your cart is no longer available.")
            stock = json.loads(p["stock"])
            have = stock.get(str(size), 0)
            if have < qty:
                raise ApiError(409, f"Only {have} left of {p['name']} in UK {size}." if have else f"{p['name']} in UK {size} is sold out.")
            stock[str(size)] = have - qty
            con.execute("UPDATE products SET stock=? WHERE id=?", (json.dumps(stock), pid))
            subtotal += p["price"] * qty
            lines.append((pid, p["name"], size, qty, p["price"]))
        shipping = 0 if subtotal >= FREE_SHIPPING_ABOVE else SHIPPING_FEE
        total = subtotal + shipping
        status = "placed" if method == "cod" else "pending"
        cur = con.execute(
            "INSERT INTO orders(user_id,subtotal,shipping,total,status,payment_method,payment_status,address,created) VALUES(?,?,?,?,?,?,?,?,?)",
            (user["id"], subtotal, shipping, total, status, method, "pending", json.dumps(address), int(time.time())),
        )
        oid = cur.lastrowid
        for pid, name, size, qty, price in lines:
            con.execute("INSERT INTO order_items(order_id,product_id,name,size,qty,price) VALUES(?,?,?,?,?,?)", (oid, pid, name, size, qty, price))
        con.execute("COMMIT")
    except BaseException:
        if con.in_transaction:
            con.execute("ROLLBACK")
        con.close()
        raise
    out = order_row(con, con.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone())
    con.close()
    return out


def restock(con, order_id):
    for it in con.execute("SELECT product_id,size,qty FROM order_items WHERE order_id=?", (order_id,)).fetchall():
        p = con.execute("SELECT stock FROM products WHERE id=?", (it["product_id"],)).fetchone()
        if p:
            stock = json.loads(p["stock"])
            stock[str(it["size"])] = stock.get(str(it["size"]), 0) + it["qty"]
            con.execute("UPDATE products SET stock=? WHERE id=?", (json.dumps(stock), it["product_id"]))


def razorpay_create(user, body):
    oid = to_int(body.get("order_id"), "Order", 1, 10**9)
    con = db()
    o = con.execute("SELECT * FROM orders WHERE id=? AND user_id=?", (oid, user["id"])).fetchone()
    if not o or o["payment_method"] != "online" or o["payment_status"] == "paid":
        con.close()
        raise ApiError(404, "Order not found.")
    payload = json.dumps({"amount": o["total"] * 100, "currency": "INR", "receipt": f"sneakezy_{oid}"}).encode()
    auth = base64.b64encode(f"{RZP_KEY}:{RZP_SECRET}".encode()).decode()
    req = urllib.request.Request("https://api.razorpay.com/v1/orders", payload, {"Content-Type": "application/json", "Authorization": "Basic " + auth})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, ValueError):
        con.close()
        raise ApiError(502, "Could not reach the payment provider. Please try again.")
    con.execute("UPDATE orders SET rzp_order_id=? WHERE id=?", (data["id"], oid))
    con.close()
    return {"key": RZP_KEY, "rzp_order_id": data["id"], "amount": o["total"] * 100, "currency": "INR"}


def razorpay_verify(user, body):
    oid = to_int(body.get("order_id"), "Order", 1, 10**9)
    rid, pid, sig = (str(body.get(k, "")) for k in ("razorpay_order_id", "razorpay_payment_id", "razorpay_signature"))
    con = db()
    o = con.execute("SELECT * FROM orders WHERE id=? AND user_id=?", (oid, user["id"])).fetchone()
    if not o or o["rzp_order_id"] != rid:
        con.close()
        raise ApiError(404, "Order not found.")
    expected = hmac.new(RZP_SECRET.encode(), f"{rid}|{pid}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        con.close()
        raise ApiError(400, "Payment could not be verified.")
    con.execute("UPDATE orders SET payment_status='paid', status='placed', rzp_payment_id=? WHERE id=? AND status='pending'", (pid, oid))
    out = order_row(con, con.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone())
    con.close()
    return out


# ---------------------------------------------------------------- HTTP
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://lumberjack.razorpay.com",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "SneakEzy/1.0"

    def log_message(self, fmt, *args):
        print("  %s %s" % (self.command, self.path.split("?")[0]), "->", args[1] if len(args) > 1 else "")

    # -- plumbing
    def send_json(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 100_000:
            raise ApiError(413, "Request too large.")
        if not n:
            return {}
        try:
            data = json.loads(self.rfile.read(n))
        except ValueError:
            raise ApiError(400, "Invalid JSON.")
        if not isinstance(data, dict):
            raise ApiError(400, "Invalid JSON.")
        return data

    def user(self, required=True, admin=False):
        auth = self.headers.get("Authorization", "")
        u = None
        if auth.startswith("Bearer "):
            con = db()
            row = con.execute(
                "SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
                (auth[7:], int(time.time())),
            ).fetchone()
            con.close()
            u = dict(row) if row else None
        if required and not u:
            raise ApiError(401, "Please sign in to continue.")
        if admin and (not u or u["role"] != "admin"):
            raise ApiError(403, "Admin access only.")
        return u

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PUT(self): self.route("PUT")
    def do_PATCH(self): self.route("PATCH")
    def do_DELETE(self): self.route("DELETE")

    def route(self, method):
        path = urlparse(self.path).path
        try:
            if path.startswith("/api/"):
                self.send_json(200, self.api(method, path))
            elif method == "GET":
                self.static(path)
            else:
                raise ApiError(405, "Method not allowed.")
        except ApiError as e:
            self.send_json(e.status, {"error": e.message})
        except Exception as e:  # never leak internals
            print("  ERROR", repr(e))
            self.send_json(500, {"error": "Something went wrong on our side. Please try again."})

    def static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (STATIC / rel).resolve()
        if not str(f).startswith(str(STATIC.resolve())) or not f.is_file():
            raise ApiError(404, "Not found.")
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(f.name)[0] or "application/octet-stream") + ("; charset=utf-8" if f.suffix in (".html", ".js", ".css") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    # -- API routes
    def api(self, method, path):
        ip = self.client_address[0]
        parts = [p for p in path[len("/api/"):].split("/") if p]
        if not parts or len(parts) > 3:
            raise ApiError(404, "Not found.")
        rid = int(parts.pop()) if parts[-1].isdigit() and len(parts) > 1 else None
        res = "/".join(parts)

        if res == "config" and method == "GET":
            return {"razorpay_key": RZP_KEY or None, "free_shipping_above": FREE_SHIPPING_ABOVE, "shipping_fee": SHIPPING_FEE}
        if res == "products" and method == "GET":
            con = db()
            rows = con.execute("SELECT * FROM products WHERE active=1 ORDER BY id").fetchall()
            out = [product_row(r) for r in rows]
            con.close()
            return out
        if res == "register" and method == "POST":
            throttle("reg:" + ip, 8, 3600)
            return create_user(self.body())
        if res == "login" and method == "POST":
            return login(self.body(), ip)
        if res == "logout" and method == "POST":
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                con = db()
                con.execute("DELETE FROM sessions WHERE token=?", (auth[7:],))
                con.close()
            return {"ok": True}
        if res == "me" and method == "GET":
            return {"user": self.user(required=False)}
        if res == "orders" and method == "GET" and rid is None:
            u = self.user()
            con = db()
            rows = con.execute("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC", (u["id"],)).fetchall()
            out = [order_row(con, r) for r in rows]
            con.close()
            return out
        if res == "orders" and method == "POST" and rid is None:
            return create_order(self.user(), self.body())
        if path == "/api/pay/create" and method == "POST":
            return razorpay_create(self.user(), self.body())
        if path == "/api/pay/verify" and method == "POST":
            return razorpay_verify(self.user(), self.body())

        # ---- admin
        if res == "admin/stats" and method == "GET":
            self.user(admin=True)
            con = db()
            s = con.execute("SELECT COUNT(*) n, COALESCE(SUM(total),0) rev FROM orders WHERE status!='cancelled' AND (payment_method='cod' OR payment_status='paid')").fetchone()
            out = {
                "orders": s["n"], "revenue": s["rev"],
                "customers": con.execute("SELECT COUNT(*) FROM users WHERE role='customer'").fetchone()[0],
                "low_stock": [{"id": r["id"], "name": r["name"], "units": sum(json.loads(r["stock"]).values())} for r in con.execute("SELECT * FROM products WHERE active=1").fetchall() if sum(json.loads(r["stock"]).values()) < 20],
            }
            con.close()
            return out
        if res == "admin/orders" and method == "GET":
            self.user(admin=True)
            con = db()
            out = [order_row(con, r, True) for r in con.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 200").fetchall()]
            con.close()
            return out
        if res == "admin/orders" and method == "PATCH" and rid:
            self.user(admin=True)
            status = self.body().get("status")
            if status not in ORDER_STATUSES:
                raise ApiError(400, "Unknown status.")
            con = db()
            try:
                con.execute("BEGIN IMMEDIATE")
                o = con.execute("SELECT * FROM orders WHERE id=?", (rid,)).fetchone()
                if not o:
                    raise ApiError(404, "Order not found.")
                if o["status"] == "cancelled":
                    raise ApiError(409, "A cancelled order cannot be changed.")
                if status == "cancelled":
                    restock(con, rid)
                pay = "paid" if (status == "delivered" and o["payment_method"] == "cod") else o["payment_status"]
                con.execute("UPDATE orders SET status=?, payment_status=? WHERE id=?", (status, pay, rid))
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                raise
            out = order_row(con, con.execute("SELECT * FROM orders WHERE id=?", (rid,)).fetchone(), True)
            con.close()
            return out
        if res == "admin/products" and method == "GET" and rid is None:
            self.user(admin=True)
            con = db()
            out = [product_row(r, True) for r in con.execute("SELECT * FROM products ORDER BY id").fetchall()]
            con.close()
            return out
        if res == "admin/products" and method == "POST" and rid is None:
            self.user(admin=True)
            vals = validate_product(self.body())
            con = db()
            cur = con.execute("INSERT INTO products(name,category,price,was,rating,badge,description,image_url,colors,stock) VALUES(?,?,?,?,?,?,?,?,?,?)", vals)
            out = product_row(con.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone(), True)
            con.close()
            return out
        if res == "admin/products" and method == "PUT" and rid:
            self.user(admin=True)
            vals = validate_product(self.body())
            con = db()
            cur = con.execute("UPDATE products SET name=?,category=?,price=?,was=?,rating=?,badge=?,description=?,image_url=?,colors=?,stock=? WHERE id=?", vals + (rid,))
            if cur.rowcount == 0:
                con.close()
                raise ApiError(404, "Product not found.")
            out = product_row(con.execute("SELECT * FROM products WHERE id=?", (rid,)).fetchone(), True)
            con.close()
            return out
        if res == "admin/products" and method == "DELETE" and rid:
            self.user(admin=True)
            con = db()
            con.execute("UPDATE products SET active=0 WHERE id=?", (rid,))
            con.close()
            return {"ok": True}
        raise ApiError(404, "Not found.")


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"  SneakEzy running at http://{HOST}:{PORT}   (Ctrl+C to stop)")
    if not (RZP_KEY and RZP_SECRET):
        print("  Online payments: off (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable). Cash on Delivery works.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
