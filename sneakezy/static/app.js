"use strict";
/* SneakEzy storefront: shop, accounts, cart, checkout, order history. */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN");
const CATS = ["All", "Running", "Basketball", "Trail", "Lifestyle"];
const SIZES = [6, 7, 8, 9, 10, 11];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const S = {
  products: [], config: { free_shipping_above: 7999, shipping_fee: 149 }, user: null,
  token: store.get("sz_token", null), cart: store.get("sz_cart", {}), saved: new Set(store.get("sz_saved", [])),
  cat: "All", size: null, max: 12000, q: "", sort: "featured", savedOnly: false,
  cmp: new Set(), recent: store.get("sz_recent", []), quiz: { step: 0, a: {} },
};

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (S.token) headers.Authorization = "Bearer " + S.token;
  const res = await fetch("/api/" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) { const err = new Error(data.error || "Something went wrong."); err.status = res.status; throw err; }
  return data;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2600); }

/* ---------- Shoe art (SVG fallback when a product has no photo) ---------- */
function shoeSVG(c) {
  const [up, ac, so, dk] = c;
  return `<svg viewBox="0 0 420 250" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<ellipse cx="215" cy="216" rx="175" ry="9" fill="#000" opacity=".14"/>
<path d="M26 176Q26 152 58 152H342Q396 152 396 182Q396 206 362 206H62Q26 206 26 176Z" fill="${so}"/>
<path d="M34 190H388" stroke="${ac}" stroke-width="4" opacity=".9" stroke-linecap="round"/>
<path d="M50 154C46 120 50 84 66 58C74 44 98 44 110 54C126 66 142 80 170 88L228 98C292 108 338 124 372 148C384 156 388 154 382 154Z" fill="${up}"/>
<path d="M300 110C338 124 366 140 382 154H296Z" fill="${dk}"/>
<path d="M50 154C46 120 52 90 64 66L98 70C86 100 86 130 92 154Z" fill="${ac}"/>
<path d="M66 58C78 50 98 52 110 58C102 68 80 70 66 64Z" fill="#000" opacity=".35"/>
<path d="M110 54L152 38Q164 36 164 48L142 80Z" fill="${dk}"/>
<path d="M112 134C152 118 204 130 256 126" stroke="${ac}" stroke-width="9" fill="none" stroke-linecap="round"/>
<g stroke="${ac}" stroke-width="5" stroke-linecap="round" opacity=".95"><path d="M156 92L180 78"/><path d="M178 102L204 86"/><path d="M202 110L230 94"/><path d="M228 116L258 102"/></g>
<path d="M60 152H340" stroke="#000" opacity=".12" stroke-width="2"/></svg>`;
}
function art(p) {
  const svg = p.colors.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)) ? shoeSVG(p.colors) : "";
  return p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" onerror="this.remove()">${svg}` : svg;
}
const heartSVG = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.6 2.7 5 6.2 5c2.1 0 3.6 1.1 5.8 3.4C14.2 6.1 15.7 5 17.8 5c3.500 0 5.300 3.600 3.800 6.800C19.500 16.400 12 21 12 21z"/></svg>';

/* ---------- Cart ---------- */
const byId = (id) => S.products.find((p) => p.id === +id);
function cartLines() {
  return Object.entries(S.cart).map(([k, qty]) => { const [id, size] = k.split("|"); return { k, p: byId(id), size: +size, qty }; }).filter((l) => l.p);
}
const subtotal = () => cartLines().reduce((t, l) => t + l.p.price * l.qty, 0);
const shippingFor = (sub) => (sub === 0 || sub >= S.config.free_shipping_above ? 0 : S.config.shipping_fee);
function saveCart() { store.set("sz_cart", S.cart); renderCart(); }
function renderCart() {
  const lines = cartLines(), sub = subtotal(), left = Math.max(0, S.config.free_shipping_above - sub);
  $("#cartCount").textContent = lines.reduce((a, l) => a + l.qty, 0) || "";
  $("#items").innerHTML = lines.length ? lines.map((l) => `
    <div class="item"><div class="th">${art(l.p)}</div><div>
      <h4>${esc(l.p.name)}</h4><small>UK ${l.size} · ${fmt(l.p.price)}</small>
      <div class="row"><div class="qty"><button data-dec="${l.k}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-inc="${l.k}" aria-label="Increase">+</button></div><button class="rm" data-rm="${l.k}">Remove</button></div>
    </div></div>`).join("") : `<div class="empty" style="margin-top:16px">Your cart is empty. Pick a pair you like and choose a size.</div>`;
  $("#sum").innerHTML = `
    <div class="bar2"><i style="width:${Math.min(100, (sub / S.config.free_shipping_above) * 100)}%"></i></div>
    <div class="ship">${sub === 0 ? "Free shipping above " + fmt(S.config.free_shipping_above) : left ? `Add ${fmt(left)} more for free shipping` : "You've unlocked free shipping"}</div>
    <div class="line"><span>Subtotal</span><b>${fmt(sub)}</b></div>
    <a class="btn block" href="#/checkout" id="toCheckout" ${lines.length ? "" : 'aria-disabled="true" style="opacity:.5;pointer-events:none"'}>Checkout</a>`;
}
function openCart() { renderCart(); $("#drawer").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on"); }
function closeAll() { $("#modal").classList.remove("on"); $("#scrim").classList.remove("on"); $("#drawer").classList.remove("on"); $("#drawer").setAttribute("aria-hidden", "true"); }

/* ---------- Shop view ---------- */
function visible() {
  const r = S.products.filter((p) => (S.cat === "All" || p.category === S.cat) && p.price <= S.max && (!S.size || p.sizes.includes(S.size)) && (!S.savedOnly || S.saved.has(p.id)) && (p.name + " " + p.category + " " + p.description).toLowerCase().includes(S.q.toLowerCase()));
  const by = { low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price, rating: (a, b) => b.rating - a.rating, featured: (a, b) => a.id - b.id };
  return r.sort(by[S.sort]);
}
function shopView() {
  const hero = S.products[0];
  $("#view").innerHTML = `
  <section class="hero">
    <div><h1>Find your next pair. <em>Fast.</em></h1>
      <p>Running, courts, trails and everyday streets. Filter by size and budget, then check out with Cash on Delivery or online payment.</p>
      <div class="row"><a class="btn" href="#shop" id="shopNow">Browse the drop</a><a class="btn ghost" href="#/quiz" id="quizStart">Find my pair in 4 questions</a></div></div>
    <div class="heroart" aria-hidden="true">${hero ? art(hero) : ""}</div>
  </section>
  <div class="stats"><span><b>${S.products.length}</b> styles</span><span><b>UK 6–11</b> sizes</span><span><b>${fmt(S.config.free_shipping_above)}+</b> ships free</span><span><b>30-day</b> returns</span></div>
  ${recentHTML()}
  <section id="shop" class="tools" aria-label="Filters">
    <div class="row"><input class="search" id="q" type="search" placeholder="Search by name or type, e.g. trail" aria-label="Search sneakers" value="${esc(S.q)}">
      <select class="sort" id="sort" aria-label="Sort by">${[["featured", "Sort: Featured"], ["low", "Price: low to high"], ["high", "Price: high to low"], ["rating", "Top rated"]].map(([v, t]) => `<option value="${v}" ${S.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="row"><span class="lab">Type</span>${CATS.map((c) => `<button class="chip" data-cat="${c}">${c}</button>`).join("")}</div>
    <div class="row"><span class="lab">UK size</span><button class="chip sz" data-fsize="">Any</button>${SIZES.map((s) => `<button class="chip sz" data-fsize="${s}">${s}</button>`).join("")}</div>
    <div class="row price"><span class="lab">Max price</span><input type="range" id="maxp" min="3000" max="12000" step="500" value="${S.max}" aria-label="Maximum price"><output id="maxpOut"></output></div>
  </section>
  <div class="meta"><span id="resCount"></span><button class="chip" id="reset">Reset filters</button></div>
  <section class="grid" id="grid" aria-live="polite"></section>`;
  renderGrid();
}
function renderGrid() {
  if (!$("#grid")) return;
  const r = visible();
  $("#resCount").textContent = r.length + (r.length === 1 ? " pair" : " pairs") + (S.savedOnly ? " saved" : "");
  $("#grid").innerHTML = r.length ? r.map((p) => `
    <article class="card">
      <button class="art" data-open="${p.id}" aria-label="Quick view ${esc(p.name)}">${art(p)}${p.badge ? `<span class="badge ${p.badge === "Sale" ? "sale" : ""}">${esc(p.badge)}</span>` : ""}</button>
      <button class="heart" data-heart="${p.id}" aria-pressed="${S.saved.has(p.id)}" aria-label="Save ${esc(p.name)}">${heartSVG}</button>
      <div class="info"><span class="cat">${esc(p.category)}</span><h3>${esc(p.name)}</h3><div class="row" style="justify-content:space-between"><span class="rate">★ ${Number(p.rating).toFixed(1)}</span><button class="cmpbtn" data-cmp="${p.id}" aria-pressed="${S.cmp.has(p.id)}">+ Compare</button></div>${lowTag(p)}
        <div class="foot"><span class="pr">${fmt(p.price)}${p.was ? `<s>${fmt(p.was)}</s>` : ""}</span>${p.sizes.length ? `<button class="add" data-open="${p.id}">Add</button>` : `<span class="rate">Sold out</span>`}</div></div>
    </article>`).join("") : `<div class="empty">No pairs match those filters. Try a bigger budget or a different size.</div>`;
  document.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cat === S.cat));
  document.querySelectorAll("[data-fsize]").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.fsize || null) == (S.size || null)));
  $("#maxpOut").textContent = S.max >= 12000 ? "Any" : fmt(S.max);
  updateBadges();
}
function updateBadges() {
  $("#savedCount").textContent = S.saved.size || "";
  $("#savedBtn").setAttribute("aria-pressed", S.savedOnly);
  updateCmp();
}

/* ---------- Quick view ---------- */
let pick = null;
function openModal(id) {
  const p = byId(id); if (!p) return; pick = { id: p.id, size: null };
  S.recent = [p.id, ...S.recent.filter((x) => x !== p.id)].slice(0, 6); store.set("sz_recent", S.recent);
  $("#modal").classList.remove("wide");
  const lows = Object.entries(p.left || {}).sort((a, b) => a[0] - b[0]).map(([s, q]) => `UK ${s}: only ${q} left`).join(" · ");
  $("#modal").innerHTML = `
    <button class="close" data-close aria-label="Close">✕</button>
    <div class="mart">${art(p)}</div>
    <div class="mbody"><span class="lab">${esc(p.category)} · ★ ${Number(p.rating).toFixed(1)}</span>
      <h2>${esc(p.name)}</h2>
      <div class="pr" style="font-size:1.3rem">${fmt(p.price)}${p.was ? `<s>${fmt(p.was)}</s>` : ""}</div>
      <p>${esc(p.description)}</p>
      <div><span class="lab">Select UK size</span><div class="sizes" style="margin-top:8px">${SIZES.map((s) => { const ok = p.sizes.includes(s); return `<button class="chip sz ${ok ? "" : "off"}" data-pick="${s}" ${ok ? "" : "disabled"} aria-pressed="false">${s}</button>`; }).join("")}</div>
        <p style="font-size:.85rem;margin-top:8px">${lows ? `<span class="lowtag">${lows}</span><br>` : ""}<a href="#/size-guide" style="color:var(--accent)">Not sure of your size? Size guide</a></p></div>
      <div class="row" style="margin-top:auto"><button class="btn" id="mAdd" ${p.sizes.length ? "" : "disabled"}>Add to cart</button><button class="btn ghost" data-heart="${p.id}" aria-pressed="${S.saved.has(p.id)}">${S.saved.has(p.id) ? "Saved" : "Save"}</button></div>
    </div>`;
  $("#modal").classList.add("on"); $("#scrim").classList.add("on"); $("#modal .close").focus();
}

/* ---------- Account ---------- */
function accountView() {
  if (S.user) {
    $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>Hi, ${esc(S.user.name.split(" ")[0])}</h1><p class="sub">${esc(S.user.email)}</p>
      <div class="row"><a class="btn" href="#/orders">My orders</a>${S.user.role === "admin" ? '<a class="btn ghost" href="/admin.html">Store admin</a>' : ""}<button class="btn ghost" id="logout">Sign out</button></div></section></div>`;
    return;
  }
  const mode = location.hash.includes("register") ? "register" : "login";
  $("#view").innerHTML = `<div class="narrow"><section class="panel">
    <div class="tabs"><button class="chip" data-mode="login" aria-pressed="${mode === "login"}">Sign in</button><button class="chip" data-mode="register" aria-pressed="${mode === "register"}">Create account</button></div>
    <h1>${mode === "login" ? "Welcome back" : "Join SneakEzy"}</h1><p class="sub">${mode === "login" ? "Sign in to check out and track your orders." : "It takes ten seconds."}</p>
    <form class="form" id="authForm" data-mode="${mode}" novalidate>
      ${mode === "register" ? '<label>Full name<input class="input" id="aName" autocomplete="name" required></label>' : ""}
      <label>Email<input class="input" id="aEmail" type="email" autocomplete="email" required></label>
      <label>Password${mode === "register" ? " (8+ characters)" : ""}<input class="input" id="aPass" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required></label>
      <div class="err" id="aErr" role="alert"></div>
      <button class="btn block" type="submit">${mode === "login" ? "Sign in" : "Create account"}</button>
    </form></section></div>`;
}
function setUser(user, token) {
  S.user = user; if (token !== undefined) { S.token = token; store.set("sz_token", token); }
  $("#accountLink").textContent = user ? user.name.split(" ")[0] : "Sign in";
}

/* ---------- Checkout ---------- */
function checkoutView() {
  const lines = cartLines();
  if (!lines.length) { $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>Your cart is empty</h1><p class="sub">Add a pair first.</p><a class="btn" href="#/">Back to shop</a></section></div>`; return; }
  if (!S.user) { toast("Sign in to continue to checkout"); location.hash = "#/account"; S.after = "#/checkout"; return; }
  const sub = subtotal(), ship = shippingFor(sub), online = !!S.config.razorpay_key;
  $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>Checkout</h1><p class="sub">Delivering across India.</p>
    <form class="form" id="coForm" novalidate>
      <label>Full name<input class="input" id="cName" value="${esc(S.user.name)}" autocomplete="name" required></label>
      <label>Phone<input class="input" id="cPhone" type="tel" autocomplete="tel" placeholder="10-digit mobile number" required></label>
      <label>Address<textarea class="input" id="cLine1" autocomplete="street-address" required></textarea></label>
      <div class="two"><label>City<input class="input" id="cCity" autocomplete="address-level2" required></label><label>State<input class="input" id="cState" autocomplete="address-level1" required></label></div>
      <label>PIN code<input class="input" id="cPin" inputmode="numeric" maxlength="6" autocomplete="postal-code" required></label>
      <div class="pay"><span class="lab">Payment</span>
        <label><input type="radio" name="pay" value="cod" checked> Cash on Delivery</label>
        <label style="${online ? "" : "opacity:.5"}"><input type="radio" name="pay" value="online" ${online ? "" : "disabled"}> UPI, cards and netbanking ${online ? "" : "(not enabled yet)"}</label></div>
      <div class="line"><span>Items (${lines.reduce((a, l) => a + l.qty, 0)})</span><span>${fmt(sub)}</span></div>
      <div class="line"><span>Shipping</span><span>${ship ? fmt(ship) : "Free"}</span></div>
      <div class="line"><b>Total</b><b>${fmt(sub + ship)}</b></div>
      <div class="err" id="cErr" role="alert"></div>
      <button class="btn block" type="submit" id="placeBtn">Place order</button>
    </form></section></div>`;
}
function loadRazorpay() {
  return new Promise((ok, no) => {
    if (window.Razorpay) return ok();
    const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = ok; s.onerror = () => no(new Error("Could not load the payment window."));
    document.body.appendChild(s);
  });
}
async function placeOrder(e) {
  e.preventDefault();
  const err = $("#cErr"), btn = $("#placeBtn"); err.textContent = "";
  const method = document.querySelector('input[name="pay"]:checked').value;
  const body = {
    items: cartLines().map((l) => ({ product_id: l.p.id, size: l.size, qty: l.qty })), payment: method,
    address: { name: $("#cName").value, phone: $("#cPhone").value, line1: $("#cLine1").value, city: $("#cCity").value, state: $("#cState").value, pin: $("#cPin").value },
  };
  btn.disabled = true; btn.textContent = "Placing order…";
  try {
    const order = await api("orders", { method: "POST", body });
    if (method === "online") {
      const pay = await api("pay/create", { method: "POST", body: { order_id: order.id } });
      await loadRazorpay();
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: pay.key, amount: pay.amount, currency: pay.currency, order_id: pay.rzp_order_id, name: "SneakEzy", description: "Order #" + order.id,
          prefill: { name: body.address.name, contact: body.address.phone, email: S.user.email },
          handler: async (r) => { try { await api("pay/verify", { method: "POST", body: { order_id: order.id, ...r } }); resolve(); } catch (x) { reject(x); } },
          modal: { ondismiss: () => reject(new Error("Payment was cancelled. Your order is saved as pending in My orders.")) },
        });
        rz.open();
      });
    }
    S.cart = {}; saveCart(); await loadProducts();
    location.hash = "#/done/" + order.id;
  } catch (x) {
    err.textContent = x.message; btn.disabled = false; btn.textContent = "Place order";
    if (x.status === 409) { await loadProducts(); }
  }
}

/* ---------- Orders ---------- */
async function ordersView(doneId) {
  if (!S.user) { location.hash = "#/account"; S.after = "#/orders"; return; }
  $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>Loading…</h1></section></div>`;
  try {
    const orders = await api("orders");
    const banner = doneId ? `<section class="panel"><h1>Order #${+doneId} confirmed</h1><p class="sub">Thanks for shopping with SneakEzy. We'll ship it soon and you can track the status below.</p></section>` : "";
    $("#view").innerHTML = `<div class="narrow">${banner}<h2 style="font:800 1.6rem var(--display);margin:24px 0 14px">My orders</h2>${orders.length ? orders.map((o) => `
      <article class="order"><header><b>Order #${o.id}</b><span class="pill ${esc(o.status)}">${esc(o.status)}</span></header>
        <small style="color:var(--muted);font-family:var(--mono)">${new Date(o.created * 1000).toLocaleString("en-IN")} · ${o.payment_method === "cod" ? "Cash on Delivery" : "Online"} · ${esc(o.payment_status)}</small>
        ${o.items.map((i) => `<div class="line" style="margin-top:8px"><span>${esc(i.name)} · UK ${i.size} × ${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`).join("")}
        <div class="line" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px"><b>Total</b><b>${fmt(o.total)}</b></div>
        <p style="color:var(--muted);font-size:.85rem;margin:8px 0 0">Ships to ${esc(o.address.name)}, ${esc(o.address.line1)}, ${esc(o.address.city)}, ${esc(o.address.state)} ${esc(o.address.pin)}</p>
      </article>`).join("") : `<div class="empty">No orders yet.</div>`}</div>`;
  } catch (x) { $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>Couldn't load orders</h1><p class="sub">${esc(x.message)}</p></section></div>`; }
}

/* ---------- Standout features: finder quiz, size guide, compare, recently viewed, low stock ---------- */
function sat(hex) {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
}
const lookOf = (p) => (Math.max(sat(p.colors[0]), sat(p.colors[1])) > 0.6 ? "bold" : "clean");
function lowTag(p) {
  const e = Object.entries(p.left || {}); if (!e.length) return "";
  const [s, q] = e.sort((a, b) => a[1] - b[1])[0];
  return `<span class="lowtag">Only ${q} left in UK ${s}</span>`;
}
function recentHTML() {
  const items = S.recent.map(byId).filter(Boolean);
  if (!items.length) return "";
  return `<section class="recent" aria-label="Recently viewed"><span class="lab">Recently viewed</span><div class="rrow">${items.map((p) => `<button class="rcard" data-open="${p.id}"><span class="th">${art(p)}</span><span>${esc(p.name)}</span></button>`).join("")}</div></section>`;
}
function updateCmp() {
  const bar = $("#cmpBar"); if (!bar) return;
  bar.hidden = S.cmp.size === 0; $("#cmpCount").textContent = S.cmp.size; $("#cmpGo").disabled = S.cmp.size < 2;
}
function openCompare() {
  const ps = [...S.cmp].map(byId).filter(Boolean);
  const row = (label, fn) => `<tr><th scope="row">${label}</th>${ps.map((p) => `<td>${fn(p)}</td>`).join("")}</tr>`;
  $("#modal").classList.add("wide");
  $("#modal").innerHTML = `<button class="close" data-close aria-label="Close">✕</button><div class="mbody" style="grid-column:1/-1"><h2>Compare</h2><div style="overflow-x:auto"><table class="cmp"><tbody>
    <tr><th></th>${ps.map((p) => `<td><div class="th" style="min-height:110px">${art(p)}</div><b>${esc(p.name)}</b></td>`).join("")}</tr>
    ${row("Price", (p) => fmt(p.price))}${row("Type", (p) => esc(p.category))}${row("Rating", (p) => "★ " + Number(p.rating).toFixed(1))}
    ${row("UK sizes in stock", (p) => p.sizes.join(", ") || "Sold out")}${row("Look", (p) => (lookOf(p) === "bold" ? "Bold" : "Clean"))}${row("Details", (p) => esc(p.description))}
    <tr><th></th>${ps.map((p) => `<td><button class="btn mini" data-open="${p.id}">Choose size</button></td>`).join("")}</tr></tbody></table></div></div>`;
  $("#modal").classList.add("on"); $("#scrim").classList.add("on");
}

const QUIZ = [
  { k: "use", q: "What will you wear them for?", o: [["Running", "Running"], ["Basketball", "Basketball"], ["Trail", "Trails and hikes"], ["Lifestyle", "Everyday and style"]] },
  { k: "budget", q: "What's your budget?", o: [["5000", "Under ₹5,000"], ["8000", "Under ₹8,000"], ["99999", "No limit"]] },
  { k: "size", q: "Which UK size do you wear?", o: SIZES.map((s) => [String(s), "UK " + s]) },
  { k: "look", q: "Which look fits you?", o: [["bold", "Bold and colourful"], ["clean", "Clean and neutral"]] },
];
function quizView() {
  const st = S.quiz;
  if (st.step >= QUIZ.length) return quizResult();
  const Q = QUIZ[st.step];
  $("#view").innerHTML = `<div class="narrow"><section class="panel"><span class="lab">Question ${st.step + 1} of ${QUIZ.length}</span>
    <div class="bar2" style="margin:10px 0 18px"><i style="width:${(st.step / QUIZ.length) * 100}%"></i></div><h1>${Q.q}</h1>
    <div class="qopts">${Q.o.map(([v, t]) => `<button class="qbtn" data-qa="${v}">${t}</button>`).join("")}</div>
    ${st.step ? '<p style="margin:16px 0 0"><button class="rm" data-qback>Back</button></p>' : ""}</section></div>`;
}
function quizResult() {
  const a = S.quiz.a, size = +a.size, max = +a.budget;
  const top = S.products.filter((p) => p.sizes.includes(size)).map((p) => {
    let s = p.rating * 0.5; const why = [];
    if (p.category === a.use) { s += 4; why.push("Made for " + (a.use === "Lifestyle" ? "everyday wear" : a.use.toLowerCase())); }
    if (p.price <= max) { s += 3; why.push("Within your budget"); } else s -= 3;
    if (lookOf(p) === a.look) { s += 2; why.push(a.look === "bold" ? "Bold colours" : "Clean, neutral look"); }
    why.push("In stock in UK " + size);
    return { p, s, why };
  }).sort((x, y) => y.s - x.s).slice(0, 3);
  $("#view").innerHTML = `<div class="narrow"><section class="panel"><span class="lab">Your matches</span>
    <h1>${top.length ? "Your top " + (top.length > 1 ? top.length + " pairs" : "pair") : "No pairs in your size right now"}</h1>
    <p class="sub">${top.length ? "Ranked by use, budget, look and what's in stock in UK " + size + "." : "Try another size or check back soon."}</p>
    ${top.map(({ p, why }, i) => `<article class="order" style="display:grid;grid-template-columns:110px 1fr;gap:14px">
      <button class="th" data-open="${p.id}" style="border:0;min-height:90px;padding:0" aria-label="View ${esc(p.name)}">${art(p)}</button>
      <div><span class="pill">#${i + 1} match</span><h3 style="margin:6px 0 2px;font:800 1.2rem var(--display)">${esc(p.name)}</h3><div class="pr">${fmt(p.price)}</div>
      <p style="color:var(--muted);font-size:.85rem;margin:6px 0 10px">${why.map(esc).join(" · ")}</p><button class="add" data-open="${p.id}">Choose size</button></div></article>`).join("")}
    <button class="btn ghost" data-qrestart>Retake quiz</button></section></div>`;
}

const CHART = [[6, 24.5], [7, 25.4], [8, 26.2], [9, 27.1], [10, 27.9], [11, 28.8]];
function sizeView() {
  $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>Size guide</h1>
    <p class="sub">Stand on a sheet of paper, mark your longest toe and your heel, then measure the gap in centimetres. Measure both feet and use the larger number.</p>
    <label style="display:grid;gap:6px;font-weight:500;font-size:.85rem">Foot length (cm)<input class="input" id="foot" type="number" step="0.1" min="18" max="35" placeholder="e.g. 26.0" inputmode="decimal"></label>
    <div class="order" id="footOut" style="margin:14px 0 0" aria-live="polite">Enter your foot length to get a size.</div>
    <h2 style="font:800 1.2rem var(--display);margin:22px 0 8px">Size chart</h2>
    <div style="overflow-x:auto"><table class="cmp"><tbody><tr><th>UK</th><th>US (men)</th><th>EU (approx.)</th><th>Foot length</th></tr>${CHART.map(([u, c]) => `<tr><td>${u}</td><td>${u + 1}</td><td>${u + 33.5}</td><td>${c} cm</td></tr>`).join("")}</tbody></table></div>
    <p style="color:var(--muted);font-size:.85rem">Charts differ between brands. If you are between two sizes, choose the larger one. This is a general guide, not a guarantee of fit.</p></section></div>`;
}
function sizeCalc() {
  const v = parseFloat($("#foot").value), out = $("#footOut");
  if (!v) { out.textContent = "Enter your foot length to get a size."; return; }
  if (v < 18 || v > 35) { out.textContent = "That length looks off. Check the measurement and try again."; return; }
  const hit = CHART.find(([, c]) => c >= v + 0.4);
  out.innerHTML = !hit ? "Your foot is longer than our UK 11 (28.8 cm), so we don't stock your size yet."
    : v + 0.4 < CHART[0][1] - 0.8 ? `UK 6 is our smallest size, so it may be a little roomy. Your size is probably smaller than we stock.`
    : `Your size: <b>UK ${hit[0]}</b> · US ${hit[0] + 1} · EU ${hit[0] + 33.5}`;
}

/* ---------- Router + events ---------- */
function route() {
  closeAll();
  const h = location.hash || "#/";
  if (h === "#shop" && $("#shop")) { $("#shop").scrollIntoView(); return; }
  if (h.startsWith("#/account")) accountView();
  else if (h === "#/quiz") quizView();
  else if (h === "#/size-guide") sizeView();
  else if (h === "#/checkout") checkoutView();
  else if (h === "#/orders") ordersView();
  else if (h.startsWith("#/done/")) ordersView(h.split("/")[2]);
  else shopView();
  if (!h.startsWith("#shop")) window.scrollTo(0, 0);
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button,a"); if (!t) return; const d = t.dataset;
  if (d.cat) { S.cat = d.cat; renderGrid(); }
  else if (d.fsize !== undefined) { S.size = d.fsize ? +d.fsize : null; renderGrid(); }
  else if (d.open) openModal(+d.open);
  else if (d.heart) { const id = +d.heart; S.saved.has(id) ? S.saved.delete(id) : S.saved.add(id); store.set("sz_saved", [...S.saved]); renderGrid(); updateBadges(); if ($("#modal").classList.contains("on")) { t.setAttribute("aria-pressed", S.saved.has(id)); t.textContent = S.saved.has(id) ? "Saved" : "Save"; } toast(S.saved.has(id) ? "Saved to your list" : "Removed from saved"); }
  else if (d.pick) { pick.size = +d.pick; document.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", b === t)); }
  else if (t.id === "mAdd") { if (!pick.size) return toast("Choose a size first"); const k = pick.id + "|" + pick.size; S.cart[k] = Math.min(10, (S.cart[k] || 0) + 1); saveCart(); closeAll(); toast("Added to cart"); }
  else if (d.close !== undefined) closeAll();
  else if (d.inc) { S.cart[d.inc] = Math.min(10, S.cart[d.inc] + 1); saveCart(); }
  else if (d.dec) { S.cart[d.dec] > 1 ? S.cart[d.dec]-- : delete S.cart[d.dec]; saveCart(); }
  else if (d.rm) { delete S.cart[d.rm]; saveCart(); }
  else if (d.mode) { location.hash = d.mode === "register" ? "#/account/register" : "#/account"; }
  else if (d.cmp) { const id = +d.cmp; if (S.cmp.has(id)) S.cmp.delete(id); else if (S.cmp.size >= 3) toast("Compare up to 3 pairs at a time"); else S.cmp.add(id); document.querySelectorAll(`[data-cmp="${id}"]`).forEach((b) => b.setAttribute("aria-pressed", S.cmp.has(id))); updateCmp(); }
  else if (t.id === "cmpGo") openCompare();
  else if (t.id === "cmpClear") { S.cmp.clear(); document.querySelectorAll("[data-cmp]").forEach((b) => b.setAttribute("aria-pressed", "false")); updateCmp(); }
  else if (t.id === "quizStart" || t.id === "navQuiz") { S.quiz = { step: 0, a: {} }; if (location.hash === "#/quiz") quizView(); }
  else if (d.qa !== undefined) { S.quiz.a[QUIZ[S.quiz.step].k] = d.qa; S.quiz.step++; quizView(); }
  else if (d.qback !== undefined) { S.quiz.step = Math.max(0, S.quiz.step - 1); quizView(); }
  else if (d.qrestart !== undefined) { S.quiz = { step: 0, a: {} }; quizView(); }
  else if (t.id === "cartBtn") openCart();
  else if (t.id === "closeCart") closeAll();
  else if (t.id === "toCheckout") closeAll();
  else if (t.id === "savedBtn") { S.savedOnly = !S.savedOnly; if (!$("#grid")) { location.hash = "#/"; } else renderGrid(); updateBadges(); if (S.savedOnly && !S.saved.size) toast("Tap the heart on a pair to save it"); }
  else if (t.id === "randomBtn") { if (S.products.length) openModal(S.products[Math.floor(Math.random() * S.products.length)].id); }
  else if (t.id === "reset") { Object.assign(S, { cat: "All", size: null, max: 12000, q: "", sort: "featured", savedOnly: false }); shopView(); }
  else if (t.id === "logout") { try { await api("logout", { method: "POST" }); } catch (x) {} setUser(null, null); store.set("sz_token", null); location.hash = "#/"; toast("Signed out"); }
  else if (t.id === "themeBtn") { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = dark ? "light" : "dark"; store.set("sz_theme", r.dataset.theme); }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") { S.q = e.target.value.trim(); renderGrid(); }
  if (e.target.id === "maxp") { S.max = +e.target.value; renderGrid(); }
  if (e.target.id === "foot") sizeCalc();
});
document.addEventListener("change", (e) => { if (e.target.id === "sort") { S.sort = e.target.value; renderGrid(); } });
document.addEventListener("submit", async (e) => {
  if (e.target.id === "coForm") return placeOrder(e);
  if (e.target.id === "authForm") {
    e.preventDefault(); const f = e.target, reg = f.dataset.mode === "register", err = $("#aErr"); err.textContent = "";
    try {
      const data = await api(reg ? "register" : "login", { method: "POST", body: { name: reg ? $("#aName").value : undefined, email: $("#aEmail").value, password: $("#aPass").value } });
      setUser(data.user, data.token); toast("Welcome, " + data.user.name.split(" ")[0]);
      const next = S.after || "#/"; S.after = null; location.hash = next; if (location.hash === next) route();
    } catch (x) { err.textContent = x.message; }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
$("#scrim").addEventListener("click", closeAll);
window.addEventListener("hashchange", route);

async function loadProducts() { S.products = await api("products"); for (const k of Object.keys(S.cart)) { const [id, size] = k.split("|"); const p = byId(id); if (!p || !p.sizes.includes(+size)) delete S.cart[k]; } store.set("sz_cart", S.cart); renderCart(); }

(async function boot() {
  const th = store.get("sz_theme", null); if (th) document.documentElement.dataset.theme = th;
  try {
    const [cfg] = await Promise.all([api("config"), loadProducts()]); S.config = cfg;
    if (S.token) { const me = await api("me"); if (me.user) setUser(me.user); else { S.token = null; store.set("sz_token", null); } }
  } catch (x) { $("#view").innerHTML = `<div class="narrow"><section class="panel"><h1>We can't reach the store right now</h1><p class="sub">Please refresh in a moment.</p></section></div>`; return; }
  updateBadges(); renderCart(); route();
})();
