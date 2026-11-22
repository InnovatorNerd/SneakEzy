"use strict";
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN");
const SIZES = [6, 7, 8, 9, 10, 11], CATS = ["Running", "Basketball", "Trail", "Lifestyle"], STATUSES = ["pending", "placed", "shipped", "delivered", "cancelled"];
let token = null; try { token = JSON.parse(localStorage.getItem("sz_admin_token")); } catch (e) {}
let products = [], editing = null;

async function api(path, method = "GET", body) {
  const res = await fetch("/api/" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch (e) {}
  if (!res.ok) { const e = new Error(data.error || "Request failed."); e.status = res.status; throw e; }
  return data;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2400); }

function loginView(msg = "") {
  $("#out").hidden = true;
  $("#app").innerHTML = `<div class="narrow"><section class="panel"><h1>Admin sign in</h1><p class="sub">Use the store admin account printed when the server first started.</p>
    <form class="form" id="lf"><label>Email<input class="input" id="e" type="email" autocomplete="username" required></label>
    <label>Password<input class="input" id="p" type="password" autocomplete="current-password" required></label>
    <div class="err" role="alert">${esc(msg)}</div><button class="btn block">Sign in</button></form></section></div>`;
  $("#lf").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const d = await api("login", "POST", { email: $("#e").value, password: $("#p").value });
      if (d.user.role !== "admin") return loginView("This account is not an admin.");
      token = d.token; localStorage.setItem("sz_admin_token", JSON.stringify(token)); load();
    } catch (x) { loginView(x.message); }
  };
}

async function load() {
  try {
    const [stats, orders, prods] = await Promise.all([api("admin/stats"), api("admin/orders"), api("admin/products")]);
    products = prods; render(stats, orders);
  } catch (x) { if (x.status === 401 || x.status === 403) { token = null; localStorage.removeItem("sz_admin_token"); loginView(); } else toast(x.message); }
}

function render(stats, orders) {
  $("#out").hidden = false;
  $("#app").innerHTML = `
  <div class="stats4">
    <div class="stat"><span class="lab">Revenue</span><b>${fmt(stats.revenue)}</b></div>
    <div class="stat"><span class="lab">Orders</span><b>${stats.orders}</b></div>
    <div class="stat"><span class="lab">Customers</span><b>${stats.customers}</b></div>
    <div class="stat"><span class="lab">Low stock</span><b>${stats.low_stock.length}</b><small style="color:var(--muted)">${stats.low_stock.map((p) => esc(p.name) + " (" + p.units + ")").join(", ") || "All good"}</small></div>
  </div>
  <h2 class="sec">Orders</h2>
  <div class="tablewrap"><table><thead><tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
  ${orders.length ? orders.map((o) => `<tr><td>${o.id}</td>
    <td>${esc(o.customer?.name)}<br><small style="color:var(--muted)">${esc(o.address.phone)}<br>${esc(o.address.line1)}, ${esc(o.address.city)} ${esc(o.address.pin)}</small></td>
    <td>${o.items.map((i) => `${esc(i.name)} UK${i.size}×${i.qty}`).join("<br>")}</td><td>${fmt(o.total)}</td>
    <td>${o.payment_method === "cod" ? "COD" : "Online"}<br><small>${esc(o.payment_status)}</small></td>
    <td>${o.status === "cancelled" ? '<span class="pill cancelled">cancelled</span>' : `<select class="input" style="min-height:36px;width:auto" data-status="${o.id}">${STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select>`}</td></tr>`).join("") : `<tr><td colspan="6" style="color:var(--muted)">No orders yet.</td></tr>`}
  </tbody></table></div>
  <h2 class="sec">Products <button class="btn mini" id="newP" style="margin-left:10px">Add product</button></h2>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Type</th><th>Price</th><th>Stock by size</th><th></th></tr></thead><tbody>
  ${products.map((p) => `<tr style="${p.active ? "" : "opacity:.45"}"><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${fmt(p.price)}</td>
    <td style="font-family:var(--mono);font-size:.8rem">${SIZES.map((s) => `${s}:${p.stock[s] ?? 0}`).join(" ")}</td>
    <td style="white-space:nowrap">${p.active ? `<button class="btn ghost mini" data-edit="${p.id}">Edit</button> <button class="btn ghost mini" data-del="${p.id}">Hide</button>` : "Hidden"}</td></tr>`).join("")}
  </tbody></table></div>
  <div id="editor"></div>`;
}

function editor(p) {
  editing = p || null;
  const v = p || { name: "", category: "Running", price: "", was: "", rating: 4.5, badge: "", description: "", image_url: "", colors: ["#F2F3EE", "#E8470F", "#1A1E1C", "#D5D8D0"], stock: {} };
  $("#editor").innerHTML = `<section class="panel"><h2>${p ? "Edit " + esc(p.name) : "New product"}</h2><p class="sub">Leave the image URL empty to use the drawn sneaker, or paste an https:// photo link (for example from Unsplash or Pexels).</p>
  <form class="form" id="pf">
    <div class="two"><label>Name<input class="input" id="f_name" value="${esc(v.name)}" required></label>
    <label>Type<select class="input" id="f_cat">${CATS.map((c) => `<option ${c === v.category ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
    <div class="two"><label>Price (₹)<input class="input" id="f_price" type="number" min="1" value="${esc(v.price)}" required></label><label>Old price (₹, optional)<input class="input" id="f_was" type="number" min="1" value="${esc(v.was ?? "")}"></label></div>
    <div class="two"><label>Rating (1 to 5)<input class="input" id="f_rating" type="number" step="0.1" min="1" max="5" value="${esc(v.rating)}"></label>
    <label>Badge<select class="input" id="f_badge">${["", "New", "Sale"].map((b) => `<option value="${b}" ${b === (v.badge || "") ? "selected" : ""}>${b || "None"}</option>`).join("")}</select></label></div>
    <label>Description<textarea class="input" id="f_desc">${esc(v.description)}</textarea></label>
    <label>Image URL<input class="input" id="f_img" type="url" placeholder="https://images.unsplash.com/..." value="${esc(v.image_url ?? "")}"></label>
    <div><span class="lab">Drawing colours (upper, accent, sole, shade)</span><div class="colors" style="margin-top:6px">${v.colors.map((c, i) => `<input type="color" id="f_c${i}" value="${esc(c)}">`).join("")}</div></div>
    <div><span class="lab">Stock per UK size</span><div class="stockgrid" style="margin-top:6px">${SIZES.map((s) => `<label>${s}<input class="input" id="f_s${s}" type="number" min="0" value="${v.stock[s] ?? 0}"></label>`).join("")}</div></div>
    <div class="err" id="f_err" role="alert"></div>
    <div class="row"><button class="btn">Save product</button><button class="btn ghost" type="button" id="cancelP">Cancel</button></div>
  </form></section>`;
  $("#editor").scrollIntoView({ behavior: "smooth" });
  $("#cancelP").onclick = () => ($("#editor").innerHTML = "");
  $("#pf").onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {
      name: $("#f_name").value, category: $("#f_cat").value, price: $("#f_price").value, was: $("#f_was").value, rating: $("#f_rating").value,
      badge: $("#f_badge").value, description: $("#f_desc").value, image_url: $("#f_img").value,
      colors: [0, 1, 2, 3].map((i) => $("#f_c" + i).value.toUpperCase()), stock: Object.fromEntries(SIZES.map((s) => [String(s), $("#f_s" + s).value])),
    };
    try { await api(editing ? "admin/products/" + editing.id : "admin/products", editing ? "PUT" : "POST", body); toast("Product saved"); load(); }
    catch (x) { $("#f_err").textContent = x.message; }
  };
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "out") { try { await api("logout", "POST"); } catch (x) {} token = null; localStorage.removeItem("sz_admin_token"); loginView(); }
  else if (t.id === "newP") editor(null);
  else if (t.dataset.edit) editor(products.find((p) => p.id === +t.dataset.edit));
  else if (t.dataset.del) { if (t.dataset.armed) { try { await api("admin/products/" + t.dataset.del, "DELETE"); toast("Product hidden from the store"); load(); } catch (x) { toast(x.message); } } else { t.dataset.armed = "1"; t.textContent = "Confirm hide"; setTimeout(() => { t.dataset.armed = ""; t.textContent = "Hide"; }, 3000); } }
});
document.addEventListener("change", async (e) => {
  const id = e.target.dataset.status; if (!id) return;
  if (e.target.value === "cancelled" && !confirm("Cancel order #" + id + "? Its items go back into stock and this cannot be undone.")) { load(); return; }
  try { await api("admin/orders/" + id, "PATCH", { status: e.target.value }); toast("Order #" + id + " is now " + e.target.value); load(); } catch (x) { toast(x.message); load(); }
});
token ? load() : loginView();
