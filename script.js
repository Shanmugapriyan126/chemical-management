/* RK-CMS – Supabase version (matches schema: profiles, chemicals, consumption_logs, stock_transactions)
   RPCs: record_chemical_consumption, record_stock_transaction · Storage bucket: sds  (see supabase-setup.sql) */
const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const I = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const $ = id => document.getElementById(id);
const DEPTS = ["Washing","Dyeing","Printing","Maintenance","ETP","Boiler","Housekeeping","Fabric Washing","Yarn Dyeing","Embroidery","Cutting","Sewing","Packing","Other"];
const HAZ = ["Flammable","Corrosive","Toxic","Irritant","Oxidizing","Non-Hazardous"];
const UNITS = ["Kg","Litre","Gram","ML","Ton","Drum","Can","Nos"], YN = ["Yes","No"];
const F = [ // key, label, type, options
  ["chemical_name","Chemical name *","text"],["cas_no","CAS number","text"],["manufacturer","Manufacturer","text"],["supplier","Supplier","text"],
  ["department","Department *","select",["",...DEPTS]],["process","Process","text"],["hazard","Hazard class *","select",["",...HAZ]],
  ["stock","Opening stock","number"],["unit","Unit","select",UNITS],["storage_location","Storage location","text"],
  ["purchase_date","Purchase date","date"],["expiry_date","Expiry / review date","date"],
  ["sds_available","SDS available?","select",YN],["ghs_available","GHS label available?","select",YN]];
let chems = [], logs = [], txs = [], names = {}, me = null, profile = null;

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => Number(v || 0), fmt = v => num(v).toLocaleString("en-IN", {maximumFractionDigits: 2});
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const role = () => String(profile?.role || "").toUpperCase();
const admin = () => role() === "ADMIN", canRec = () => role() !== "VIEWER";
const who = id => esc(names[id] || "-");
const act = () => chems.filter(c => c.active !== false);
const fdate = v => v ? new Date(v + "T00:00").toLocaleDateString("en-GB", {day: "2-digit", month: "short", year: "numeric"}) : "-";
const fdt = v => v ? new Date(v).toLocaleString("en-GB", {day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"}) : "-";
function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 3800); }
function modal(html) { $("mbody").innerHTML = html; $("modal").classList.remove("hidden"); }
function closeModal() { $("modal").classList.add("hidden"); }
$("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
document.onkeydown = e => { if (e.key === "Escape") closeModal(); };

const daysLeft = c => c.expiry_date ? Math.round((new Date(c.expiry_date + "T00:00") - new Date().setHours(0,0,0,0)) / 864e5) : null;
const hazTag = h => `<span class="tag ${h === "Non-Hazardous" ? "grn" : ["Flammable","Corrosive"].includes(h) ? "red" : "amb"}">${esc(h || "-")}</span>`;
function issues(c) {
  const d = daysLeft(c), o = [];
  if (d !== null && d < 0) o.push('<span class="tag red">Expired</span>');
  else if (d !== null && d <= 30) o.push(`<span class="tag amb">Review in ${d}d</span>`);
  if (!c.sds_available) o.push('<span class="tag red">No SDS</span>');
  if (!c.ghs_available) o.push('<span class="tag amb">No GHS label</span>');
  return o;
}

/* ---------- navigation ---------- */
const TITLES = {dashboard:"Dashboard",inventory:"Chemical Inventory",addChemical:"Add Chemical",stock:"Stock Ledger",consumption:"Consumption Log",reports:"Reports"};
function show(id) {
  if (id === "addChemical" && !admin()) id = "dashboard";
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.page === id));
  $("pageTitle").textContent = TITLES[id]; render();
}
document.addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b) show(b.dataset.page); });

/* ---------- form helpers (Add + Edit) ---------- */
function fieldsHTML(p, c = {}, edit = false) {
  return F.filter(f => !(edit && f[0] === "stock")).map(([k, l, t, o]) => {
    let v = c[k] ?? (k === "unit" ? "Kg" : t === "number" ? 0 : "");
    if (o === YN) v = c[k] === undefined ? "Yes" : c[k] ? "Yes" : "No";
    const i = t === "select"
      ? `<select id="${p}${k}">${o.map(x => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(x || "Select")}</option>`).join("")}</select>`
      : `<input id="${p}${k}" type="${t}" ${t === "number" ? 'min="0" step="0.01"' : ""} value="${esc(v)}">`;
    return `<div><label>${l}</label>${i}</div>`;
  }).join("") + `<div class="full"><label>Remarks</label><textarea id="${p}remarks">${esc(c.remarks)}</textarea></div>`;
}
function collect(p, edit = false) {
  const o = {};
  F.forEach(([k, , t, opt]) => {
    const el = $(p + k); if (!el || (edit && k === "stock")) return;
    const v = el.value.trim();
    o[k] = opt === YN ? v === "Yes" : t === "number" ? num(v) : v || null;
  });
  o.remarks = $(p + "remarks").value.trim() || null;
  return o;
}
const nextCode = () => "CHM" + String(Math.max(0, ...chems.map(c => +(String(c.chemical_code).match(/(\d+)$/)?.[1] || 0))) + 1).padStart(5, "0");

/* ---------- data ---------- */
async function load() {
  const [a, b, t, p] = await Promise.all([
    db.from("chemicals").select("*").order("created_at", {ascending: false}),
    db.from("consumption_logs").select("*, chemicals(chemical_code,chemical_name)").order("consumption_date", {ascending: false}).order("created_at", {ascending: false}),
    db.from("stock_transactions").select("*, chemicals(chemical_code,chemical_name,unit)").order("created_at", {ascending: false}).limit(300),
    db.from("profiles").select("id,full_name")]);
  if (a.error) throw a.error; if (b.error) throw b.error;
  chems = a.data || []; logs = b.data || []; txs = t.data || [];
  names = Object.fromEntries((p.data || []).map(x => [x.id, x.full_name]));
  render();
}
const rowsOr = (arr, cols, fn) => arr.length ? arr.map(fn).join("") : `<tr><td colspan="${cols}" class="empty">No records found</td></tr>`;
function render() {
  const page = document.querySelector(".page.active")?.id;
  ({dashboard, inventory, stock, consumption, reports}[page] || (() => {}))();
}
const card = (l, v, c = "") => `<div class="card ${c}"><span>${l}</span><b>${v}</b></div>`;
const chemOpts = (first) => `<option value="">${first}</option>` + act().map(c => `<option value="${c.id}">${esc(c.chemical_code)} – ${esc(c.chemical_name)} (${fmt(c.stock)} ${esc(c.unit)})</option>`).join("");

function dashboard() {
  const a = act(), due = a.filter(c => { const d = daysLeft(c); return d !== null && d <= 30; }).length;
  $("kpis").innerHTML = card("Total chemicals", a.length) + card("In stock", a.filter(c => num(c.stock) > 0).length, "grn") +
    card("Hazardous", a.filter(c => c.hazard && c.hazard !== "Non-Hazardous").length, "amb") + card("Expiry / review due", due, "red") + card("SDS missing", a.filter(c => !c.sds_available).length, "red");
  $("alertTable").innerHTML = rowsOr(a.filter(c => issues(c).length).slice(0, 8), 3, c => `<tr><td class="code">${esc(c.chemical_code)}</td><td>${esc(c.chemical_name)}</td><td>${issues(c).join(" ")}</td></tr>`);
  $("recentTable").innerHTML = rowsOr(a.slice(0, 5), 4, c => `<tr><td class="code">${esc(c.chemical_code)}</td><td>${esc(c.chemical_name)}</td><td>${fmt(c.stock)} ${esc(c.unit)}</td><td>${hazTag(c.hazard)}</td></tr>`);
}

function filtered() {
  const q = $("search").value.toLowerCase(), d = $("deptFilter").value, h = $("hazFilter").value, s = $("statFilter").value;
  return chems.filter(c => `${c.chemical_name} ${c.chemical_code} ${c.cas_no} ${c.supplier}`.toLowerCase().includes(q) && (!d || c.department === d) && (!h || c.hazard === h) &&
    (s === "all" || (s === "active") === (c.active !== false)));
}
function inventory() {
  $("invTable").innerHTML = rowsOr(filtered(), 9, c => {
    const d = daysLeft(c), on = c.active !== false;
    return `<tr style="${on ? "" : "opacity:.55"}"><td class="code">${esc(c.chemical_code)}</td><td><b>${esc(c.chemical_name)}</b> ${on ? "" : '<span class="tag">Inactive</span>'}<br><small class="muted">${esc(c.manufacturer || c.supplier || "")}</small></td>
    <td>${esc(c.cas_no || "-")}</td><td>${esc(c.department || "-")}</td><td>${hazTag(c.hazard)}</td>
    <td><b>${fmt(c.stock)}</b> ${esc(c.unit)}</td><td>${esc(c.storage_location || "-")}</td>
    <td>${fdate(c.expiry_date)} ${d !== null && d < 0 ? '<span class="tag red">Expired</span>' : d !== null && d <= 30 ? '<span class="tag amb">Due</span>' : ""}</td>
    <td><div class="acts"><button class="ic" title="View" onclick="viewChem('${c.id}')">${I("eye")}</button>
    ${admin() ? (on ? `<button class="ic" title="Edit" onclick="editChem('${c.id}')">${I("edit")}</button><button class="ic del" title="Deactivate" onclick="setActive('${c.id}',false)">${I("off")}</button>`
      : `<button class="ic" title="Restore" onclick="setActive('${c.id}',true)">${I("undo")}</button>`) : ""}</div></td></tr>`;
  });
}
["search","deptFilter","hazFilter","statFilter"].forEach(id => $(id).addEventListener("input", inventory));

function viewChem(id) {
  const c = chems.find(x => x.id === id), kv = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
  modal(`<h2>${esc(c.chemical_name)} <span class="code">${esc(c.chemical_code)}</span></h2><div class="kv">
    ${kv("CAS", esc(c.cas_no || "-"))}${kv("Manufacturer", esc(c.manufacturer || "-"))}${kv("Supplier", esc(c.supplier || "-"))}${kv("Department", esc(c.department || "-"))}
    ${kv("Process", esc(c.process || "-"))}${kv("Hazard", hazTag(c.hazard))}${kv("Stock", fmt(c.stock) + " " + esc(c.unit))}${kv("Storage", esc(c.storage_location || "-"))}
    ${kv("Purchased", fdate(c.purchase_date))}${kv("Expiry / review", fdate(c.expiry_date))}${kv("GHS label", c.ghs_available ? "Available" : "Missing")}
    ${kv("SDS", c.sds_available ? "Available" : "Missing")}${kv("Last updated", fdt(c.updated_at) + "<br><small>" + who(c.updated_by) + "</small>")}</div>
    <p><span class="muted">Remarks</span><br>${esc(c.remarks || "None")}</p>
    <div class="row">${c.sds_path ? `<button class="ghost" onclick="openSDS('${esc(c.sds_path)}')">${I("file")} Open SDS (${esc(c.sds_file_name || "file")})</button>` : ""}<button class="btn" onclick="closeModal()">Close</button></div>`);
}
async function openSDS(path) {
  const {data, error} = await db.storage.from("sds").createSignedUrl(path, 300);
  if (error) return toast(error.message, 1);
  window.open(data.signedUrl, "_blank");
}
function editChem(id) {
  if (!admin()) return;
  const c = chems.find(x => x.id === id);
  modal(`<h2>Edit ${esc(c.chemical_name)}</h2><p class="muted">Stock changes only through Consumption or the Stock Ledger, so every movement is recorded.</p>
    <form id="editForm"><div class="grid">${fieldsHTML("e_", c, true)}
    <div class="full"><label>SDS file (PDF / image)</label><input type="file" id="e_sds" accept=".pdf,image/*">${c.sds_file_name ? `<small class="muted">Current: ${esc(c.sds_file_name)}</small>` : ""}</div></div>
    <div class="row"><button type="button" class="ghost" onclick="closeModal()">Cancel</button><button class="btn">Save changes</button></div></form>`);
  $("editForm").onsubmit = async e => {
    e.preventDefault(); const p = collect("e_", true);
    if (!p.chemical_name || !p.department || !p.hazard) return toast("Name, department and hazard are required", 1);
    const f = $("e_sds").files[0];
    if (f) {
      const path = `${id}/${Date.now()}_${f.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await db.storage.from("sds").upload(path, f);
      if (up.error) return toast("SDS upload failed: " + up.error.message, 1);
      Object.assign(p, {sds_path: path, sds_file_name: f.name, sds_uploaded_at: new Date().toISOString(), sds_available: true});
    }
    Object.assign(p, {updated_at: new Date().toISOString(), updated_by: me.id});
    const {data, error} = await db.from("chemicals").update(p).eq("id", id).select("id");
    if (error || !data?.length) return toast(error?.message || "Not updated – check Supabase UPDATE policy", 1);
    closeModal(); toast("Chemical updated"); await load();
  };
}
function setActive(id, on) {
  const c = chems.find(x => x.id === id);
  modal(`<h2>${on ? "Restore" : "Deactivate"} ${esc(c.chemical_name)}?</h2>
    <p>${on ? "It will appear again in Inventory, Consumption and Stock forms." : `<b>${esc(c.chemical_code)}</b> will be hidden from forms and counts. Its consumption and stock history is kept.`}</p>
    <div class="row"><button class="ghost" onclick="closeModal()">Cancel</button><button class="btn ${on ? "" : "red"}" id="okAct">${on ? "Restore" : "Deactivate"}</button></div>`);
  $("okAct").onclick = async () => {
    const {error} = await db.from("chemicals").update({active: on, updated_at: new Date().toISOString(), updated_by: me.id}).eq("id", id);
    if (error) return toast(error.message, 1);
    closeModal(); toast(on ? "Chemical restored" : "Chemical deactivated"); await load();
  };
}

/* ---------- add chemical ---------- */
$("addForm").onsubmit = async e => {
  e.preventDefault(); if (!admin()) return toast("Admin access required", 1);
  const p = collect("a_");
  if (!p.chemical_name || !p.department || !p.hazard) return toast("Name, department and hazard are required", 1);
  Object.assign(p, {chemical_code: nextCode(), created_by: me.id, updated_by: me.id, active: true});
  const {data, error} = await db.from("chemicals").insert(p).select("id").single();
  if (error) return toast(error.message, 1);
  if (p.stock > 0) await db.from("stock_transactions").insert({chemical_id: data.id, transaction_type: "OPENING", quantity: p.stock, previous_stock: 0, new_stock: p.stock, remarks: "Opening stock", entered_by: me.id});
  toast("Added " + p.chemical_code); e.target.reset(); await load(); show("inventory");
};

/* ---------- stock ledger ---------- */
const TT = {RECEIPT: "grn", OPENING: "", CONSUMPTION: "amb", ADJUSTMENT: "red"};
function stock() {
  const keep = $("stChem").value; $("stChem").innerHTML = chemOpts("Select chemical"); $("stChem").value = keep;
  $("stTable").innerHTML = rowsOr(txs, 7, t => {
    const q = t.transaction_type === "CONSUMPTION" ? -Math.abs(num(t.quantity)) : num(t.quantity);
    return `<tr><td>${fdt(t.created_at)}</td><td>${esc(t.chemicals?.chemical_code || "")} ${esc(t.chemicals?.chemical_name || "")}</td><td><span class="tag ${TT[t.transaction_type] ?? ""}">${esc(t.transaction_type)}</span></td>
    <td><b>${q > 0 ? "+" : ""}${fmt(q)}</b> ${esc(t.chemicals?.unit || "")}</td><td>${fmt(t.previous_stock)} → ${fmt(t.new_stock)}</td><td>${who(t.entered_by)}</td><td>${esc(t.remarks || "-")}</td></tr>`;
  });
}
$("stType").onchange = () => { $("stQtyLabel").textContent = $("stType").value === "RECEIPT" ? "Quantity received *" : "Physical count (new stock) *"; };
$("stForm").onsubmit = async e => {
  e.preventDefault(); if (!admin()) return toast("Admin access required", 1);
  const type = $("stType").value, q = num($("stQty").value);
  if (!$("stChem").value) return toast("Select a chemical", 1);
  if (type === "RECEIPT" && q <= 0) return toast("Enter a valid quantity", 1);
  const {error} = await db.rpc("record_stock_transaction", {p_chemical_id: $("stChem").value, p_type: type, p_quantity: q, p_remarks: $("stRemarks").value.trim() || null});
  if (error) return toast(error.message, 1);
  toast("Stock entry saved"); e.target.reset(); await load();
};

/* ---------- consumption ---------- */
function consumption() {
  const keep = $("useChem").value; $("useChem").innerHTML = chemOpts("Select chemical"); $("useChem").value = keep;
  $("useTable").innerHTML = rowsOr(logs, 7, l => `<tr><td>${fdate(l.consumption_date)}</td><td>${esc(l.chemicals?.chemical_code || "")} ${esc(l.chemicals?.chemical_name || "")}</td><td>${esc(l.department)}</td>
    <td>${fmt(l.quantity)} ${esc(l.unit)}</td><td>${esc(l.used_by || "-")}</td><td>${esc(l.purpose || "-")}</td><td>${who(l.recorded_by)}</td></tr>`);
}
$("useChem").onchange = () => { $("useUnit").value = chems.find(c => c.id === $("useChem").value)?.unit || ""; };
$("useForm").onsubmit = async e => {
  e.preventDefault(); if (!canRec()) return toast("Your role cannot record consumption", 1);
  const c = chems.find(x => x.id === $("useChem").value), q = num($("useQty").value);
  if (!c) return toast("Select a chemical", 1);
  if (q <= 0) return toast("Enter a valid quantity", 1);
  if (q > num(c.stock)) return toast(`Insufficient stock. Available: ${fmt(c.stock)} ${c.unit}`, 1);
  const {error} = await db.rpc("record_chemical_consumption", {p_chemical_id: c.id, p_consumption_date: $("useDate").value, p_department: $("useDept").value,
    p_quantity: q, p_unit: c.unit, p_used_by: $("useUser").value.trim() || null, p_purpose: $("usePurpose").value.trim() || null, p_remarks: $("useRemarks").value.trim() || null});
  if (error) return toast(error.message, 1);
  toast("Consumption recorded"); e.target.reset(); $("useDate").value = today(); $("useUnit").value = ""; await load();
};

/* ---------- reports & export ---------- */
const inRange = d => (!$("rFrom").value || d >= $("rFrom").value) && (!$("rTo").value || d <= $("rTo").value);
function reports() {
  const a = act();
  $("repKpis").innerHTML = card("SDS available", a.filter(c => c.sds_available).length, "grn") + card("SDS missing", a.filter(c => !c.sds_available).length, "red") +
    card("GHS label missing", a.filter(c => !c.ghs_available).length, "amb") + card("Expired", a.filter(c => c.expiry_date && daysLeft(c) < 0).length, "red");
  const g = {}; logs.filter(l => inRange(l.consumption_date)).forEach(l => { const k = `${l.department}|${l.unit}`; (g[k] ||= {q: 0, n: 0}); g[k].q += num(l.quantity); g[k].n++; });
  $("deptTable").innerHTML = rowsOr(Object.entries(g).sort((x, y) => y[1].q - x[1].q), 3, ([k, v]) => { const [d, u] = k.split("|"); return `<tr><td>${esc(d)}</td><td>${fmt(v.q)} ${esc(u)}</td><td>${v.n}</td></tr>`; });
}
["rFrom","rTo"].forEach(id => $(id).addEventListener("input", reports));
function csv(name, head, rows) {
  const t = [head, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + t], {type: "text/csv;charset=utf-8"}));
  a.download = name + "_" + today() + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportInventory() {
  csv("Chemical_Inventory", ["ID","Name","CAS","Manufacturer","Supplier","Department","Process","Hazard","Stock","Unit","Storage","Purchase","Expiry","SDS","GHS","Status","Remarks"],
    ($("inventory").classList.contains("active") ? filtered() : act()).map(c => [c.chemical_code,c.chemical_name,c.cas_no,c.manufacturer,c.supplier,c.department,c.process,c.hazard,c.stock,c.unit,c.storage_location,c.purchase_date,c.expiry_date,c.sds_available ? "Yes" : "No",c.ghs_available ? "Yes" : "No",c.active !== false ? "Active" : "Inactive",c.remarks]));
}
function exportUsage() {
  csv("Chemical_Consumption", ["Date","Chemical ID","Chemical","Department","Quantity","Unit","Used by","Purpose","Remarks","Recorded by"],
    logs.filter(l => inRange(l.consumption_date)).map(l => [l.consumption_date,l.chemicals?.chemical_code,l.chemicals?.chemical_name,l.department,l.quantity,l.unit,l.used_by,l.purpose,l.remarks,names[l.recorded_by]]));
}

/* ---------- auth & start ---------- */
$("togglePw").onclick = () => { const i = $("loginPassword"), s = i.type === "password"; i.type = s ? "text" : "password"; $("togglePw").textContent = s ? "Hide" : "Show"; };
$("loginForm").onsubmit = async e => {
  e.preventDefault(); $("loginError").textContent = ""; $("loginBtn").disabled = true; $("loginBtn").textContent = "Signing in…";
  const {data, error} = await db.auth.signInWithPassword({email: $("loginEmail").value.trim(), password: $("loginPassword").value});
  if (error) $("loginError").textContent = error.message; else { me = data.user; await start(); }
  $("loginBtn").disabled = false; $("loginBtn").textContent = "Sign in";
};
$("logoutBtn").onclick = async () => { await db.auth.signOut(); location.reload(); };

async function start() {
  try {
    const {data, error} = await db.from("profiles").select("*").eq("id", me.id).single();
    if (error || !data) throw new Error("No RK-CMS profile for this login. Ask the administrator to create it.");
    if (String(data.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") throw new Error("Your RK-CMS account is inactive.");
    profile = data; document.body.classList.toggle("is-admin", admin()); document.body.classList.toggle("can-rec", canRec());
    $("userInfo").textContent = `${data.full_name || me.email} · ${role()}`;
    await load();
    $("loginPage").classList.add("hidden"); $("appShell").classList.remove("hidden"); show("dashboard");
  } catch (err) {
    $("loginError").textContent = err.message || "Unable to load your account."; await db.auth.signOut(); me = profile = null;
    $("loginPage").classList.remove("hidden"); $("appShell").classList.add("hidden");
  }
}
(async function init() {
  $("addFields").innerHTML = fieldsHTML("a_");
  const opt = (a, first) => `<option value="">${first}</option>` + a.map(x => `<option>${x}</option>`).join("");
  $("deptFilter").innerHTML = opt(DEPTS, "All departments"); $("hazFilter").innerHTML = opt(HAZ, "All hazard types"); $("useDept").innerHTML = opt(DEPTS, "Select department");
  $("useDate").value = today();
  const {data} = await db.auth.getSession();
  if (data.session) { me = data.session.user; await start(); }
})();
