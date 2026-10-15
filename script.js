/* =====================================================================
   RK-CMS - Chemical Management System (Supabase)
   Final version - dark teal theme (matches the RK-CMS mobile app)

   Tables used:
     profiles, chemicals, consumption_logs (+ RPC record_chemical_consumption)
   Added by supabase-setup.sql:
     chemicals.active, chemicals.sds_file_path / sds_file_name / sds_uploaded_at
     Storage bucket: sds-files (private)
   ===================================================================== */

const { createClient } = window.supabase;

const db = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* ---------------- STATE & CONSTANTS ---------------- */

let allChemicals = [];      // every row, including removed (active = false)
let chemicals = [];         // active rows only
let consumptionLogs = [];
let ledgerRows = [];
let profileNames = {};      // user id -> full name
let currentUser = null;
let currentProfile = null;
let liveChannel = null;
let refreshTimer = null;
let pollTimer = null;
let liveOn = false;

const SDS_BUCKET = "sds-files";
const SDS_MAX_BYTES = 10 * 1024 * 1024;

const departments = [
    "Washing", "Dyeing", "Printing", "Maintenance", "ETP", "Boiler",
    "Housekeeping", "Fabric Washing", "Yarn Dyeing", "Embroidery",
    "Cutting", "Sewing", "Packing", "Other"
];
const hazardTypes = ["Flammable", "Corrosive", "Toxic", "Irritant", "Oxidizing", "Non-Hazardous"];
const units = ["Kg", "Gram", "Liter", "ML", "Ton", "Nos", "Drum", "Can"];

/* ---------------- HELPERS ---------------- */

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function $(id) { return document.getElementById(id); }

function toast(message, type = "info") {
    const host = $("toastHost");
    if (!host) { alert(message); return; }
    const icons = { success: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><div>${escapeHTML(message)}</div>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 8000 : 4000);
}

function optionList(items, selected) {
    return items.map(x =>
        `<option value="${escapeHTML(x)}" ${String(x) === String(selected ?? "") ? "selected" : ""}>${escapeHTML(x)}</option>`
    ).join("");
}

function fillSelects() {
    ["department", "consumptionDepartment"].forEach(id => {
        const el = $(id);
        if (el) el.innerHTML = '<option value="">Select department</option>' + optionList(departments);
    });
    const filter = $("departmentFilter");
    if (filter) filter.innerHTML = '<option value="">All Departments</option>' + optionList(departments);
    const unit = $("unit");
    if (unit) unit.innerHTML = optionList(units, "Kg");
}

function formatDate(value) {
    if (!value) return "-";
    const d = new Date(value + (String(value).length === 10 ? "T00:00:00" : ""));
    if (Number.isNaN(d.getTime())) return escapeHTML(value);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isAdmin() {
    return String(currentProfile?.role || "").toLowerCase() === "admin";
}

function isArchived(c) { return c.active === false; }

function daysToExpiry(c) {
    if (!c.expiry_date) return null;
    const expiry = new Date(c.expiry_date + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((expiry - today) / 86400000);
}
function isExpired(c) { const d = daysToExpiry(c); return d !== null && d < 0; }
function isExpiringSoon(c) { const d = daysToExpiry(c); return d !== null && d >= 0 && d <= 30; }

function hazardClass(h) {
    if (h === "Non-Hazardous") return "status-good";
    if (h === "Flammable" || h === "Corrosive") return "status-danger";
    return "status-warning";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recordedByName(value) {
    if (!value) return "-";
    if (!UUID_RE.test(String(value))) return String(value);
    if (profileNames[value]) return profileNames[value];
    if (currentUser && value === currentUser.id) return currentProfile?.full_name || currentUser.email;
    return "Staff";
}

/* ---------------- NAVIGATION ---------------- */

function showPage(pageId) {
    if (pageId === "addChemical" && !isAdmin()) pageId = "dashboard";

    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = $(pageId);
    if (!page) return;
    page.classList.add("active");

    document.querySelectorAll(".nav-btn, .bn-btn, .bn-fab").forEach(btn =>
        btn.classList.toggle("active", btn.dataset.page === pageId)
    );

    const titles = {
        dashboard: "Dashboard", inventory: "Inventory", addChemical: "Add Chemical",
        consumption: "Record Use", ledger: "Stock Ledger", reports: "Reports", settings: "Settings"
    };
    const title = $("pageTitle");
    if (title) title.innerText = titles[pageId] || "RK-CMS";

    if (pageId === "dashboard") updateDashboard();
    if (pageId === "inventory") renderInventory();
    if (pageId === "consumption") { populateConsumptionChemicals(); loadConsumption(); }
    if (pageId === "ledger") loadLedger();
    if (pageId === "reports") updateReports();
    if (pageId === "settings") renderSettings();
    window.scrollTo({ top: 0 });
}

document.addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (button) showPage(button.dataset.page);
});

/* ---------------- PROFILE ---------------- */

async function loadProfile() {
    if (!currentUser?.id) throw new Error("No authenticated user found.");

    const { data, error } = await db.from("profiles").select("*").eq("id", currentUser.id).single();

    if (error || !data) {
        throw new Error("No RK-CMS profile found for this login. Ask the administrator to create your profile.");
    }
    if (String(data.status ?? "active").toLowerCase() !== "active") {
        throw new Error("Your RK-CMS account is inactive.");
    }

    currentProfile = data;
    const role = String(data.role || "user").toLowerCase();

    const info = $("userInfo");
    if (info) {
        info.innerHTML = `<i class="fa-solid fa-user"></i><span>${escapeHTML(data.full_name || currentUser.email)} • ${escapeHTML(role.toUpperCase())}</span>`;
    }

    renderSettings();
    updateGreeting();

    document.querySelectorAll(".admin-only, .admin-only-page").forEach(el =>
        el.classList.toggle("hidden", role !== "admin")
    );
}

function renderSettings() {
    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set("setName", currentProfile?.full_name || "-");
    set("setEmail", currentUser?.email || "-");
    set("setRole", String(currentProfile?.role || "-").toUpperCase());
    set("setLive", liveOn ? "Connected" : "Not connected");
}

function updateGreeting() {
    const name = currentProfile?.full_name || (currentUser?.email || "").split("@")[0] || "";
    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };

    set("heroDate", new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" }));
    set("heroName", name ? `Hello, ${name}` : "Hello");

    const attention = chemicals.filter(c => isExpired(c) || isExpiringSoon(c) || Number(c.stock || 0) <= 0).length;
    set("heroStatus", attention
        ? `${attention} need${attention === 1 ? "s" : ""} attention · ${chemicals.length} active`
        : `All chemicals are in order · ${chemicals.length} active`);
}

async function loadProfileNames() {
    // Best effort: RLS may only allow users to see their own profile.
    const { data } = await db.from("profiles").select("id, full_name");
    profileNames = {};
    (data || []).forEach(p => { if (p.full_name) profileNames[p.id] = p.full_name; });
}

/* ---------------- CHEMICALS ---------------- */

async function loadChemicals() {
    const { data, error } = await db.from("chemicals").select("*").order("created_at", { ascending: false });
    if (error) throw error;

    allChemicals = data || [];
    chemicals = allChemicals.filter(c => !isArchived(c));

    updateDashboard();
    renderInventory();
    populateConsumptionChemicals();
    updateReports();
}

function getNextChemicalCode() {
    let max = 0;
    allChemicals.forEach(c => {
        const m = String(c.chemical_code || "").match(/(\d+)$/);
        if (m) max = Math.max(max, Number(m[1]));
    });
    return "CHM" + String(max + 1).padStart(5, "0");
}

/* ---------------- SDS FILES ---------------- */

function validateSdsFile(file) {
    if (!file) return null;
    const okType = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) return "SDS file must be a PDF or an image.";
    if (file.size > SDS_MAX_BYTES) return "SDS file must be smaller than 10 MB.";
    return null;
}

function safeFileName(name) {
    return String(name || "sds").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
}

async function uploadSds(chemicalId, file) {
    const path = `${chemicalId}/${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await db.storage.from(SDS_BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false
    });
    if (error) throw error;
    return path;
}

async function removeSdsObject(path) {
    if (!path) return;
    await db.storage.from(SDS_BUCKET).remove([path]); // best effort
}

async function viewSds(id) {
    const c = allChemicals.find(x => String(x.id) === String(id));
    if (!c?.sds_file_path) { toast("No SDS file has been uploaded for this chemical.", "info"); return; }

    const tab = window.open("about:blank", "_blank");
    const { data, error } = await db.storage.from(SDS_BUCKET).createSignedUrl(c.sds_file_path, 120);

    if (error || !data?.signedUrl) {
        if (tab) tab.close();
        toast("SDS file could not be opened. " + (error?.message || ""), "error");
        return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
}

function sdsTag(c) {
    if (c.sds_file_path) return '<span class="sds-tag yes"><i class="fa-solid fa-file-pdf"></i>Uploaded</span>';
    if (c.sds_available) return '<span class="sds-tag yes"><i class="fa-solid fa-circle-check"></i>Available</span>';
    return '<span class="sds-tag no"><i class="fa-solid fa-circle-minus"></i>Missing</span>';
}

$("sdsFile")?.addEventListener("change", e => {
    const file = e.target.files[0];
    const label = e.target.previousElementSibling;
    const name = $("sdsFileName");
    const problem = validateSdsFile(file);
    if (problem) {
        toast(problem, "error");
        e.target.value = "";
        if (name) name.innerText = "Choose SDS file";
        label?.classList.remove("has-file");
        return;
    }
    if (name) name.innerText = file ? file.name : "Choose SDS file";
    label?.classList.toggle("has-file", !!file);
});

$("chemicalForm")?.addEventListener("reset", () => {
    setTimeout(() => {
        const name = $("sdsFileName");
        if (name) name.innerText = "Choose SDS file";
        document.querySelector('label[for="sdsFile"]')?.classList.remove("has-file");
        const unit = $("unit"); if (unit) unit.value = "Kg";
    }, 0);
});

/* ---------------- ADD CHEMICAL ---------------- */

$("chemicalForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!isAdmin()) { toast("Admin access required.", "error"); return; }

    const form = event.target;
    const submit = form.querySelector("button[type='submit']");
    const file = $("sdsFile")?.files[0] || null;

    const problem = validateSdsFile(file);
    if (problem) { toast(problem, "error"); return; }

    const name = $("chemicalName").value.trim();
    if (!name) { toast("Chemical name is required.", "error"); return; }

    const val = id => $(id)?.value.trim() || null;

    submit.disabled = true;
    try {
        let inserted = null, code = "";

        // Retry if two admins create a code at the same moment.
        for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
            code = getNextChemicalCode();
            const payload = {
                chemical_code: code,
                chemical_name: name,
                cas_no: val("casNumber"),
                manufacturer: val("manufacturer"),
                supplier: val("supplier"),
                department: $("department").value || null,
                process: val("process"),
                hazard: $("hazard").value || null,
                stock: Number($("stock").value) || 0,
                unit: $("unit").value || null,
                storage_location: val("storage"),
                purchase_date: $("purchaseDate").value || null,
                expiry_date: $("expiryDate").value || null,
                sds_available: file ? true : $("sds").value === "Yes",
                ghs_available: $("ghs").value === "Yes",
                remarks: val("remarks"),
                created_by: currentUser.id
            };

            const { data, error } = await db.from("chemicals").insert(payload).select("id").single();
            if (!error) { inserted = data; break; }
            if (error.code === "23505") { await loadChemicals(); continue; }
            throw error;
        }
        if (!inserted) throw new Error("Could not generate a unique chemical ID. Please try again.");

        let sdsNote = "";
        if (file) {
            try {
                const path = await uploadSds(inserted.id, file);
                const { error } = await db.from("chemicals").update({
                    sds_file_path: path,
                    sds_file_name: file.name,
                    sds_uploaded_at: new Date().toISOString(),
                    sds_available: true
                }).eq("id", inserted.id);
                if (error) throw error;
            } catch (err) {
                console.error("SDS upload failed:", err);
                sdsNote = " The SDS file could not be uploaded - open Edit to retry. (" + err.message + ")";
            }
        }

        form.reset();
        await loadChemicals();
        showPage("inventory");
        toast(`Chemical ${code} added.${sdsNote}`, sdsNote ? "error" : "success");
    } catch (err) {
        console.error(err);
        toast("Chemical could not be saved. " + err.message, "error");
    } finally {
        submit.disabled = false;
    }
});

/* ---------------- CONSUMPTION ---------------- */

async function loadConsumption() {
    const { data, error } = await db
        .from("consumption_logs")
        .select("*, chemicals ( chemical_code, chemical_name )")
        .order("consumption_date", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) { console.error(error); return; }

    consumptionLogs = data || [];
    await loadProfileNames();

    const table = $("consumptionTable");
    if (!table) return;

    table.innerHTML = consumptionLogs.length
        ? consumptionLogs.map(log => `
            <tr>
                <td>${formatDate(log.consumption_date)}</td>
                <td>${escapeHTML(log.chemicals?.chemical_code || "")} - ${escapeHTML(log.chemicals?.chemical_name || "")}</td>
                <td>${escapeHTML(log.department)}</td>
                <td>${Number(log.quantity || 0).toFixed(2)} ${escapeHTML(log.unit)}</td>
                <td>${escapeHTML(log.used_by || "-")}</td>
                <td>${escapeHTML(log.purpose || "-")}</td>
                <td>${escapeHTML(recordedByName(log.recorded_by))}</td>
            </tr>`).join("")
        : `<tr><td colspan="7"><div class="empty-state"><div class="empty-symbol"><i class="fa-solid fa-droplet"></i></div><strong>No consumption records yet</strong><span>Use the form above to record the first one.</span></div></td></tr>`;
}

function populateConsumptionChemicals() {
    const select = $("consumptionChemical");
    if (!select) return;

    const previous = select.value; // keep the user's choice when live updates arrive

    select.innerHTML = '<option value="">Select chemical</option>' +
        chemicals.map(c => `
            <option value="${escapeHTML(c.id)}">${escapeHTML(c.chemical_code)} - ${escapeHTML(c.chemical_name)} (Stock: ${Number(c.stock || 0).toFixed(2)} ${escapeHTML(c.unit || "")})</option>
        `).join("");

    if (previous && chemicals.some(c => String(c.id) === previous)) select.value = previous;
}

$("consumptionChemical")?.addEventListener("change", event => {
    const chemical = chemicals.find(c => String(c.id) === String(event.target.value));
    const unit = $("consumptionUnit");
    if (unit) unit.value = chemical?.unit || "";
});

$("consumptionForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const submit = event.target.querySelector("button[type='submit']");
    const chemical = chemicals.find(c => String(c.id) === String($("consumptionChemical").value));
    const quantity = Number($("consumptionQty").value);
    const date = $("consumptionDate").value;
    const department = $("consumptionDepartment").value;

    if (!chemical) { toast("Select a chemical.", "error"); return; }
    if (!date) { toast("Select the consumption date.", "error"); return; }
    if (!department) { toast("Select a department.", "error"); return; }
    if (!(quantity > 0)) { toast("Enter a valid quantity.", "error"); return; }
    if (quantity > Number(chemical.stock || 0)) {
        toast(`Insufficient stock. Available: ${Number(chemical.stock || 0).toFixed(2)} ${chemical.unit || ""}`, "error");
        return;
    }

    submit.disabled = true;
    const { error } = await db.rpc("record_chemical_consumption", {
        p_chemical_id: chemical.id,
        p_consumption_date: date,
        p_department: department,
        p_quantity: quantity,
        p_unit: chemical.unit,
        p_used_by: $("consumptionUser").value.trim() || null,
        p_purpose: $("consumptionPurpose").value.trim() || null,
        p_remarks: $("consumptionRemarks").value.trim() || null
    });
    submit.disabled = false;

    if (error) {
        toast("Consumption was not saved. " + error.message, "error");
        return;
    }

    toast("Consumption recorded.", "success");
    event.target.reset();
    $("consumptionDate").value = new Date().toISOString().slice(0, 10);
    $("consumptionUnit").value = "";

    await loadChemicals();
    await loadConsumption();
});

/* ---------------- DASHBOARD ---------------- */

function updateDashboard() {
    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };

    set("totalChemicals", chemicals.length);
    set("stockChemicals", chemicals.filter(c => Number(c.stock || 0) > 0).length);
    set("hazardousChemicals", chemicals.filter(c => c.hazard && c.hazard !== "Non-Hazardous").length);
    set("expiryChemicals", chemicals.filter(c => isExpired(c) || isExpiringSoon(c)).length);

    updateGreeting();

    const table = $("recentTable");
    if (!table) return;
    const recent = chemicals.slice(0, 5);

    table.innerHTML = recent.length
        ? recent.map(c => `
            <tr>
                <td><span class="code-badge">${escapeHTML(c.chemical_code)}</span></td>
                <td>${escapeHTML(c.chemical_name)}</td>
                <td>${escapeHTML(c.department || "")}</td>
                <td>${Number(c.stock || 0).toFixed(2)} ${escapeHTML(c.unit || "")}</td>
                <td><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard || "-")}</span></td>
            </tr>`).join("")
        : '<tr><td colspan="5"><div class="empty-state"><div class="empty-symbol"><i class="fa-solid fa-flask"></i></div><strong>No chemicals yet</strong></div></td></tr>';
}

/* ---------------- INVENTORY ---------------- */

function inventoryActionButtons(c) {
    const id = escapeHTML(c.id);
    const view = `<button class="icon-action view" title="View details" aria-label="View details" onclick="viewChemical('${id}')"><i class="fa-solid fa-eye"></i></button>`;
    const sds = `<button class="icon-action sds" title="Open SDS file" aria-label="Open SDS file" onclick="viewSds('${id}')" ${c.sds_file_path ? "" : "disabled"}><i class="fa-solid fa-file-pdf"></i></button>`;

    if (!isAdmin()) return `<div class="action-group">${view}${sds}</div>`;

    if (isArchived(c)) {
        return `<div class="action-group">${view}
            <button class="icon-action restore" title="Restore chemical" aria-label="Restore chemical" onclick="restoreChemical('${id}')"><i class="fa-solid fa-rotate-left"></i></button></div>`;
    }

    return `<div class="action-group">${view}${sds}
        <button class="icon-action edit" title="Edit chemical" aria-label="Edit chemical" onclick="editChemical('${id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-action delete" title="Remove chemical" aria-label="Remove chemical" onclick="deleteChemical('${id}')"><i class="fa-solid fa-trash"></i></button></div>`;
}

function renderInventory() {
    const table = $("inventoryTable");
    if (!table) return;

    const search = ($("searchChemical")?.value || "").toLowerCase();
    const dept = $("departmentFilter")?.value || "";
    const hazard = $("hazardFilter")?.value || "";
    const showArchived = isAdmin() && $("showArchived")?.checked;

    const source = showArchived ? allChemicals : chemicals;

    const filtered = source.filter(c =>
        `${c.chemical_name || ""} ${c.chemical_code || ""} ${c.cas_no || ""} ${c.supplier || ""} ${c.manufacturer || ""}`
            .toLowerCase().includes(search) &&
        (!dept || c.department === dept) &&
        (!hazard || c.hazard === hazard)
    );

    table.innerHTML = filtered.length ? filtered.map(c => `
        <tr class="${isArchived(c) ? "archived-row" : ""}">
            <td><span class="code-badge">${escapeHTML(c.chemical_code)}</span></td>
            <td><div class="chemical-cell"><strong>${escapeHTML(c.chemical_name)}</strong>
                <small>${isArchived(c) ? "Removed" : escapeHTML(c.manufacturer || c.supplier || "Supplier not recorded")}</small></div></td>
            <td>${escapeHTML(c.cas_no || "-")}</td>
            <td>${escapeHTML(c.department || "-")}</td>
            <td><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard || "-")}</span></td>
            <td><strong>${Number(c.stock || 0).toFixed(2)}</strong></td>
            <td>${escapeHTML(c.unit || "-")}</td>
            <td>${escapeHTML(c.storage_location || "-")}</td>
            <td><div class="expiry-cell"><span>${formatDate(c.expiry_date)}</span>
                ${isExpired(c) ? '<small class="expiry-danger">Expired</small>'
                  : isExpiringSoon(c) ? '<small class="expiry-warning">Review soon</small>' : ""}</div></td>
            <td>${sdsTag(c)}</td>
            <td>${inventoryActionButtons(c)}</td>
        </tr>`).join("") : `
        <tr><td colspan="11"><div class="empty-state">
            <div class="empty-symbol"><i class="fa-solid fa-magnifying-glass"></i></div>
            <strong>No chemical records found</strong><span>Try changing your search or filters.</span>
        </div></td></tr>`;
}

["searchChemical"].forEach(id => $(id)?.addEventListener("input", renderInventory));
["departmentFilter", "hazardFilter", "showArchived"].forEach(id => $(id)?.addEventListener("change", renderInventory));

/* ---------------- MODAL ---------------- */

function ensureChemicalModal() {
    if ($("chemicalModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
        <div id="chemicalModal" class="rkcms-modal hidden">
            <div class="rkcms-modal-backdrop" onclick="closeChemicalModal()"></div>
            <div class="rkcms-modal-card" role="dialog" aria-modal="true">
                <div class="rkcms-modal-header">
                    <div><span id="modalEyebrow">CHEMICAL RECORD</span><h2 id="modalTitle">Chemical</h2></div>
                    <button class="modal-close" onclick="closeChemicalModal()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div id="chemicalModalBody"></div>
            </div>
        </div>`);
}
function openChemicalModal() {
    ensureChemicalModal();
    $("chemicalModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
}
function closeChemicalModal() {
    $("chemicalModal")?.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

function viewChemical(id) {
    const c = allChemicals.find(x => String(x.id) === String(id));
    if (!c) return;
    ensureChemicalModal();

    $("modalEyebrow").innerText = isArchived(c) ? "REMOVED CHEMICAL" : "CHEMICAL DETAILS";
    $("modalTitle").innerText = c.chemical_name || "Chemical";

    $("chemicalModalBody").innerHTML = `
        <div class="detail-grid">
            <div><span>Code</span><strong>${escapeHTML(c.chemical_code)}</strong></div>
            <div><span>CAS No.</span><strong>${escapeHTML(c.cas_no || "-")}</strong></div>
            <div><span>Department</span><strong>${escapeHTML(c.department || "-")}</strong></div>
            <div><span>Process</span><strong>${escapeHTML(c.process || "-")}</strong></div>
            <div><span>Hazard</span><strong><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard || "-")}</span></strong></div>
            <div><span>Stock</span><strong>${Number(c.stock || 0).toFixed(2)} ${escapeHTML(c.unit || "")}</strong></div>
            <div><span>Manufacturer</span><strong>${escapeHTML(c.manufacturer || "-")}</strong></div>
            <div><span>Supplier</span><strong>${escapeHTML(c.supplier || "-")}</strong></div>
            <div><span>Storage</span><strong>${escapeHTML(c.storage_location || "-")}</strong></div>
            <div><span>Purchase date</span><strong>${formatDate(c.purchase_date)}</strong></div>
            <div><span>Expiry / Review</span><strong>${formatDate(c.expiry_date)}</strong></div>
            <div><span>GHS label</span><strong>${c.ghs_available ? "Available" : "Not available"}</strong></div>
        </div>
        <div class="sds-box">
            <div class="sds-info ${c.sds_file_path ? "" : "none"}">
                <i class="fa-solid ${c.sds_file_path ? "fa-file-pdf" : "fa-file-circle-xmark"}"></i>
                <span>${c.sds_file_path ? escapeHTML(c.sds_file_name || "SDS file") : (c.sds_available ? "SDS available (no file uploaded)" : "SDS not available")}</span>
            </div>
            ${c.sds_file_path ? `<div class="sds-actions"><button class="primary-btn" onclick="viewSds('${escapeHTML(c.id)}')"><i class="fa-solid fa-arrow-up-right-from-square"></i>Open SDS</button></div>` : ""}
        </div>
        <div class="detail-remarks"><span>Remarks</span><p>${escapeHTML(c.remarks || "No remarks recorded.")}</p></div>
        <div class="modal-footer">
            ${isAdmin() && !isArchived(c) ? `<button class="secondary-btn" onclick="closeChemicalModal(); editChemical('${escapeHTML(c.id)}')"><i class="fa-solid fa-pen"></i>Edit</button>` : ""}
            <button class="primary-btn" onclick="closeChemicalModal()">Close</button>
        </div>`;

    openChemicalModal();
}

/* ---------------- EDIT ---------------- */

function editChemical(id) {
    if (!isAdmin()) { toast("Admin access required.", "error"); return; }
    const c = allChemicals.find(x => String(x.id) === String(id));
    if (!c) return;
    ensureChemicalModal();

    $("modalEyebrow").innerText = "ADMINISTRATOR";
    $("modalTitle").innerText = `Edit ${c.chemical_name || "chemical"}`;

    const unitChoices = units.includes(c.unit) || !c.unit ? units : [c.unit, ...units];

    $("chemicalModalBody").innerHTML = `
        <form id="editChemicalForm" class="edit-form">
            <div class="edit-grid">
                <div class="form-group"><label>Chemical Name *</label><input id="editChemicalName" required value="${escapeHTML(c.chemical_name || "")}"></div>
                <div class="form-group"><label>CAS Number</label><input id="editCasNo" value="${escapeHTML(c.cas_no || "")}"></div>
                <div class="form-group"><label>Manufacturer</label><input id="editManufacturer" value="${escapeHTML(c.manufacturer || "")}"></div>
                <div class="form-group"><label>Supplier</label><input id="editSupplier" value="${escapeHTML(c.supplier || "")}"></div>
                <div class="form-group"><label>Department</label><select id="editDepartment">${optionList(departments, c.department)}</select></div>
                <div class="form-group"><label>Process / Use</label><input id="editProcess" value="${escapeHTML(c.process || "")}"></div>
                <div class="form-group"><label>Hazard Classification</label><select id="editHazard">${optionList(hazardTypes, c.hazard)}</select></div>
                <div class="form-group"><label>Stock</label><input id="editStock" type="number" min="0" step="0.01" value="${Number(c.stock || 0)}"></div>
                <div class="form-group"><label>Unit</label><select id="editUnit">${optionList(unitChoices, c.unit)}</select></div>
                <div class="form-group"><label>Storage Location</label><input id="editStorage" value="${escapeHTML(c.storage_location || "")}"></div>
                <div class="form-group"><label>Purchase Date</label><input id="editPurchaseDate" type="date" value="${escapeHTML(c.purchase_date || "")}"></div>
                <div class="form-group"><label>Expiry / Review Date</label><input id="editExpiryDate" type="date" value="${escapeHTML(c.expiry_date || "")}"></div>
                <div class="form-group"><label>SDS Available</label>
                    <select id="editSds"><option value="true" ${c.sds_available === true ? "selected" : ""}>Yes</option><option value="false" ${c.sds_available !== true ? "selected" : ""}>No</option></select></div>
                <div class="form-group"><label>GHS Label Available</label>
                    <select id="editGhs"><option value="true" ${c.ghs_available === true ? "selected" : ""}>Yes</option><option value="false" ${c.ghs_available !== true ? "selected" : ""}>No</option></select></div>
            </div>

            <div class="form-group edit-remarks"><label>SDS file</label></div>
            <div class="sds-box">
                <div class="sds-info ${c.sds_file_path ? "" : "none"}">
                    <i class="fa-solid ${c.sds_file_path ? "fa-file-pdf" : "fa-file-circle-xmark"}"></i>
                    <span>${c.sds_file_path ? escapeHTML(c.sds_file_name || "SDS file") : "No file uploaded"}</span>
                </div>
                <div class="sds-actions">
                    ${c.sds_file_path ? `<button type="button" class="secondary-btn" onclick="viewSds('${escapeHTML(c.id)}')"><i class="fa-solid fa-arrow-up-right-from-square"></i>Open</button>
                    <button type="button" class="secondary-btn" onclick="removeSdsFile('${escapeHTML(c.id)}')"><i class="fa-solid fa-trash"></i>Remove file</button>` : ""}
                    <label class="secondary-btn" for="editSdsFile" style="cursor:pointer"><i class="fa-solid fa-cloud-arrow-up"></i><span id="editSdsFileName">${c.sds_file_path ? "Replace file" : "Upload file"}</span></label>
                    <input type="file" id="editSdsFile" accept=".pdf,image/*" class="visually-hidden">
                </div>
            </div>

            <div class="form-group edit-remarks"><label>Remarks</label><textarea id="editRemarks">${escapeHTML(c.remarks || "")}</textarea></div>

            <div class="modal-footer" style="margin-top:18px">
                <button type="button" class="secondary-btn" onclick="closeChemicalModal()">Cancel</button>
                <button type="submit" class="primary-btn"><i class="fa-solid fa-floppy-disk"></i>Save changes</button>
            </div>
        </form>`;

    $("editSdsFile").addEventListener("change", e => {
        const file = e.target.files[0];
        const problem = validateSdsFile(file);
        if (problem) { toast(problem, "error"); e.target.value = ""; return; }
        $("editSdsFileName").innerText = file ? file.name : (c.sds_file_path ? "Replace file" : "Upload file");
    });

    $("editChemicalForm").addEventListener("submit", async e => {
        e.preventDefault();
        const submit = e.target.querySelector("button[type='submit']");
        const file = $("editSdsFile").files[0] || null;

        const problem = validateSdsFile(file);
        if (problem) { toast(problem, "error"); return; }

        const v = id => $(id).value.trim() || null;
        const payload = {
            chemical_name: $("editChemicalName").value.trim(),
            cas_no: v("editCasNo"),
            manufacturer: v("editManufacturer"),
            supplier: v("editSupplier"),
            department: $("editDepartment").value || null,
            process: v("editProcess"),
            hazard: $("editHazard").value || null,
            stock: Number($("editStock").value) || 0,
            unit: $("editUnit").value || null,
            storage_location: v("editStorage"),
            purchase_date: $("editPurchaseDate").value || null,
            expiry_date: $("editExpiryDate").value || null,
            sds_available: (c.sds_file_path || file) ? true : $("editSds").value === "true",
            ghs_available: $("editGhs").value === "true",
            remarks: v("editRemarks")
        };

        submit.disabled = true;
        try {
            let newPath = null;
            if (file) {
                newPath = await uploadSds(c.id, file);
                payload.sds_file_path = newPath;
                payload.sds_file_name = file.name;
                payload.sds_uploaded_at = new Date().toISOString();
            }

            const { data: rows, error } = await db.from("chemicals").update(payload).eq("id", c.id).select("id");

            if (error) {
                if (newPath) await removeSdsObject(newPath);
                throw error;
            }
            if (!rows || rows.length === 0) {
                if (newPath) await removeSdsObject(newPath);
                throw new Error("No row was updated. Check the UPDATE policy on chemicals (see supabase-setup.sql).");
            }

            if (newPath && c.sds_file_path) await removeSdsObject(c.sds_file_path);

            closeChemicalModal();
            await loadChemicals();
            toast("Chemical updated.", "success");
        } catch (err) {
            console.error("RK-CMS update error:", err);
            toast("Chemical could not be updated. " + err.message, "error");
        } finally {
            submit.disabled = false;
        }
    });

    openChemicalModal();
}

async function removeSdsFile(id) {
    if (!isAdmin()) return;
    const c = allChemicals.find(x => String(x.id) === String(id));
    if (!c?.sds_file_path) return;
    if (!confirm("Remove the uploaded SDS file for this chemical?")) return;

    const { data: rows, error } = await db.from("chemicals").update({
        sds_file_path: null, sds_file_name: null, sds_uploaded_at: null, sds_available: false
    }).eq("id", id).select("id");

    if (error || !rows?.length) {
        toast("SDS file could not be removed. " + (error?.message || "Check the UPDATE policy."), "error");
        return;
    }
    await removeSdsObject(c.sds_file_path);
    await loadChemicals();
    toast("SDS file removed.", "success");
    editChemical(id);
}

/* ---------------- REMOVE (SOFT DELETE) / RESTORE ----------------
   A hard DELETE fails once a chemical has consumption history because the
   consumption_logs foreign key is ON DELETE RESTRICT. Removing a chemical
   now sets active = false, which hides it everywhere but keeps every
   consumption and stock record for audit.
------------------------------------------------------------------ */

function deleteChemical(id) {
    if (!isAdmin()) return;
    const c = allChemicals.find(x => String(x.id) === String(id));
    if (!c) return;
    ensureChemicalModal();

    $("modalEyebrow").innerText = "REMOVE CHEMICAL";
    $("modalTitle").innerText = "Remove this chemical?";
    $("chemicalModalBody").innerHTML = `
        <div class="delete-confirm">
            <div class="delete-symbol"><i class="fa-solid fa-trash"></i></div>
            <h3>${escapeHTML(c.chemical_name)} <small>(${escapeHTML(c.chemical_code)})</small></h3>
            <p>It will be hidden from inventory and from the consumption form. Past consumption and stock records are kept for audit, and you can restore it later.</p>
            <div class="modal-footer">
                <button class="secondary-btn" onclick="closeChemicalModal()">Cancel</button>
                <button class="danger-btn" id="confirmRemoveBtn" onclick="confirmDeleteChemical('${escapeHTML(c.id)}')">Remove chemical</button>
            </div>
        </div>`;
    openChemicalModal();
}

async function setChemicalActive(id, active) {
    const { data: rows, error } = await db.from("chemicals").update({ active }).eq("id", id).select("id");

    if (error) {
        const missing = /column .*active/i.test(error.message) || error.code === "42703";
        toast(missing
            ? "Run supabase-setup.sql in the Supabase SQL Editor first (the 'active' column is missing)."
            : "Action failed. " + error.message, "error");
        return false;
    }
    if (!rows || rows.length === 0) {
        toast("Nothing was changed. Check the UPDATE policy on chemicals (see supabase-setup.sql).", "error");
        return false;
    }
    return true;
}

async function confirmDeleteChemical(id) {
    if (!isAdmin()) return;
    const btn = $("confirmRemoveBtn"); if (btn) btn.disabled = true;

    if (await setChemicalActive(id, false)) {
        closeChemicalModal();
        await loadChemicals();
        toast("Chemical removed. History is kept.", "success");
    } else if (btn) btn.disabled = false;
}

async function restoreChemical(id) {
    if (!isAdmin()) return;
    if (await setChemicalActive(id, true)) {
        await loadChemicals();
        toast("Chemical restored.", "success");
    }
}

/* ---------------- STOCK LEDGER ----------------
   Reads the stock_transactions table. Column names are matched
   flexibly (quantity / qty, balance_after / balance, ...) so it keeps
   working if your ledger uses slightly different names.
------------------------------------------------------------------ */

function pick(row, keys) {
    for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    return null;
}

function ledgerView(row) {
    const chem = allChemicals.find(c => String(c.id) === String(row.chemical_id));
    const qty = pick(row, ["quantity", "qty", "quantity_change", "change", "amount"]);
    const type = pick(row, ["transaction_type", "type", "txn_type", "movement_type", "reason"]);
    const dateRaw = pick(row, ["transaction_date", "created_at", "date"]);
    const typeText = type ? String(type) : "-";
    let signed = qty === null ? null : Number(qty);
    // If the ledger stores unsigned quantities, infer direction from the type.
    if (signed !== null && signed > 0 && /(out|consum|use|issue|deduct)/i.test(typeText)) signed = -signed;
    return {
        date: dateRaw ? String(dateRaw).slice(0, 10) : "",
        code: chem?.chemical_code || "",
        name: chem?.chemical_name || "Unknown chemical",
        chemicalId: row.chemical_id,
        type: typeText,
        qty: signed,
        unit: pick(row, ["unit"]) || chem?.unit || "",
        balance: pick(row, ["balance_after", "closing_balance", "balance", "stock_after", "new_stock"]),
        note: pick(row, ["remarks", "reference", "notes", "note", "purpose"]) || "",
        by: recordedByName(pick(row, ["recorded_by", "created_by", "user_id"]))
    };
}

async function loadLedger() {
    let res = await db.from("stock_transactions").select("*").order("created_at", { ascending: false }).limit(1000);
    if (res.error) res = await db.from("stock_transactions").select("*").limit(1000); // no created_at column

    const table = $("ledgerTable");
    if (!table) return;

    if (res.error) {
        console.error("Stock ledger error:", res.error);
        table.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-symbol"><i class="fa-solid fa-triangle-exclamation"></i></div><strong>Stock ledger could not be loaded</strong><span>${escapeHTML(res.error.message)}</span></div></td></tr>`;
        return;
    }

    ledgerRows = res.data || [];
    fillLedgerChemicalFilter();
    renderLedger();
}

function fillLedgerChemicalFilter() {
    const select = $("ledgerChemical");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">All chemicals</option>' +
        allChemicals.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.chemical_code)} - ${escapeHTML(c.chemical_name)}</option>`).join("");
    if (previous) select.value = previous;
}

function filteredLedger() {
    const search = ($("ledgerSearch")?.value || "").toLowerCase();
    const chem = $("ledgerChemical")?.value || "";
    return ledgerRows.map(ledgerView).filter(v =>
        (!chem || String(v.chemicalId) === chem) &&
        `${v.code} ${v.name} ${v.type} ${v.note}`.toLowerCase().includes(search)
    );
}

function renderLedger() {
    const table = $("ledgerTable");
    if (!table) return;
    const rows = filteredLedger();

    table.innerHTML = rows.length ? rows.map(v => `
        <tr>
            <td>${formatDate(v.date)}</td>
            <td><div class="chemical-cell"><strong>${escapeHTML(v.name)}</strong><small>${escapeHTML(v.code)}</small></div></td>
            <td>${escapeHTML(v.type)}</td>
            <td>${v.qty === null ? "-" : `<span class="${v.qty >= 0 ? "qty-in" : "qty-out"}">${v.qty > 0 ? "+" : ""}${v.qty.toFixed(2)} ${escapeHTML(v.unit)}</span>`}</td>
            <td>${v.balance === null ? "-" : Number(v.balance).toFixed(2)}</td>
            <td>${escapeHTML(v.note || "-")}</td>
            <td>${escapeHTML(v.by)}</td>
        </tr>`).join("") : `
        <tr><td colspan="7"><div class="empty-state"><div class="empty-symbol"><i class="fa-solid fa-clipboard-list"></i></div>
        <strong>No stock movements yet</strong><span>Stock changes will be listed here.</span></div></td></tr>`;
}

$("ledgerSearch")?.addEventListener("input", renderLedger);
$("ledgerChemical")?.addEventListener("change", renderLedger);

function exportLedgerCSV() {
    csvDownload("Stock_Ledger.csv",
        ["Date", "Chemical ID", "Chemical", "Type", "Quantity", "Unit", "Balance", "Note", "By"],
        filteredLedger().map(v => [v.date, v.code, v.name, v.type, v.qty, v.unit, v.balance, v.note, v.by]));
}

async function refreshAll() {
    try {
        await loadChemicals();
        await loadConsumption();
        await loadLedger();
        toast("Data refreshed.", "success");
    } catch (e) {
        toast("Refresh failed. " + e.message, "error");
    }
}

/* ---------------- REPORTS ---------------- */

function updateReports() {
    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set("sdsAvailable", chemicals.filter(c => c.sds_available === true).length);
    set("sdsMissing", chemicals.filter(c => c.sds_available !== true).length);
    set("ghsMissing", chemicals.filter(c => c.ghs_available !== true).length);
}

/* ---------------- CSV EXPORT ---------------- */

function csvCell(value) {
    let s = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // block spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
}

function csvDownload(filename, headers, rows) {
    const csv = "\uFEFF" + [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
    csvDownload("Chemical_Inventory.csv",
        ["Chemical ID", "Chemical Name", "CAS Number", "Manufacturer", "Supplier", "Department", "Process",
         "Hazard", "Stock", "Unit", "Storage Location", "Purchase Date", "Expiry Date",
         "SDS Available", "SDS File", "GHS Label Available", "Remarks"],
        chemicals.map(c => [c.chemical_code, c.chemical_name, c.cas_no, c.manufacturer, c.supplier, c.department,
            c.process, c.hazard, c.stock, c.unit, c.storage_location, c.purchase_date, c.expiry_date,
            c.sds_available ? "Yes" : "No", c.sds_file_name || "", c.ghs_available ? "Yes" : "No", c.remarks]));
}

function exportConsumptionCSV() {
    csvDownload("Chemical_Consumption_Log.csv",
        ["Date", "Chemical ID", "Chemical", "Department", "Quantity", "Unit", "Used By", "Purpose", "Remarks", "Recorded By"],
        consumptionLogs.map(l => [l.consumption_date, l.chemicals?.chemical_code, l.chemicals?.chemical_name,
            l.department, l.quantity, l.unit, l.used_by, l.purpose, l.remarks, recordedByName(l.recorded_by)]));
}

/* ---------------- REALTIME ---------------- */

function setLive(state) {
    const pill = $("livePill");
    if (!pill) return;
    liveOn = state === "on";
    pill.className = "live-pill " + state;
    pill.querySelector("span").innerText = state === "on" ? "Live" : state === "off" ? "Offline" : "Connecting…";
    const sl = $("setLive"); if (sl) sl.innerText = liveOn ? "Connected" : "Not connected";
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
        try { await loadChemicals(); await loadConsumption(); await loadLedger(); }
        catch (e) { console.error("Live refresh failed:", e); }
    }, 400);
}

function startRealtime() {
    stopRealtime();
    setLive("connecting");

    liveChannel = db.channel("rkcms-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "chemicals" }, scheduleRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "consumption_logs" }, scheduleRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "stock_transactions" }, scheduleRefresh)
        .subscribe(status => {
            if (status === "SUBSCRIBED") setLive("on");
            else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setLive("off");
        });

    // Safety net: if realtime is unavailable, refresh every 60 seconds.
    pollTimer = setInterval(() => {
        if (!liveOn && !document.hidden) scheduleRefresh();
    }, 60000);
}

function stopRealtime() {
    clearTimeout(refreshTimer);
    clearInterval(pollTimer);
    if (liveChannel) { db.removeChannel(liveChannel); liveChannel = null; }
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentProfile) scheduleRefresh();
});

/* ---------------- LOGIN / LOGOUT ---------------- */

$("loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const errorBox = $("loginError");
    const button = event.target.querySelector("button[type='submit']");
    const label = button?.querySelector("span");

    if (errorBox) errorBox.innerText = "";
    if (button) button.disabled = true;
    if (label) label.innerText = "Signing in...";

    try {
        const { data, error } = await db.auth.signInWithPassword({
            email: $("loginEmail").value.trim(),
            password: $("loginPassword").value
        });
        if (error) throw error;
        currentUser = data.user;
        await startApp();
    } catch (error) {
        console.error(error);
        if (errorBox) errorBox.innerText = error.message || "Invalid email or password.";
    } finally {
        if (button) button.disabled = false;
        if (label) label.innerText = "Sign in";
    }
});

$("togglePassword")?.addEventListener("click", function () {
    const input = $("loginPassword");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    this.innerHTML = `<i class="fa-solid ${show ? "fa-eye-slash" : "fa-eye"}"></i>`;
    this.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

$("logoutBtn")?.addEventListener("click", async () => {
    stopRealtime();
    await db.auth.signOut();
    location.reload();
});

/* ---------------- APP START ---------------- */

async function startApp() {
    try {
        $("appShell")?.classList.add("hidden");

        await loadProfile();
        await loadChemicals();
        await loadConsumption();
        loadLedger().catch(console.error);

        $("loginPage")?.classList.add("hidden");
        $("appShell")?.classList.remove("hidden");

        showPage("dashboard");
        startRealtime();
    } catch (error) {
        console.error(error);
        $("loginPage")?.classList.remove("hidden");
        $("appShell")?.classList.add("hidden");

        const loginError = $("loginError");
        if (loginError) {
            loginError.innerText = "RK-CMS could not load your data. Refresh to retry. Details: " +
                (error.message || "Unable to load your account.");
        }
        // The saved session is kept on purpose so a temporary network/RLS error does not sign the user out.
    }
}

document.addEventListener("keydown", e => { if (e.key === "Escape") closeChemicalModal(); });

/* Inline onclick handlers need these on window. */
Object.assign(window, {
    viewChemical, editChemical, deleteChemical, confirmDeleteChemical, restoreChemical,
    viewSds, removeSdsFile, closeChemicalModal, exportCSV, exportConsumptionCSV, exportLedgerCSV, refreshAll
});

/* ---------------- MOBILE TABLE LABELS ----------------
   On phones, tables turn into cards; each cell shows its column name. */
document.querySelectorAll("table.stack").forEach(table => {
    const heads = [...table.querySelectorAll("thead th")].map(th => th.innerText.trim());
    const body = table.querySelector("tbody");
    if (!body) return;
    const label = () => body.querySelectorAll("tr").forEach(tr =>
        [...tr.children].forEach((td, i) => { if (!td.hasAttribute("colspan")) td.setAttribute("data-label", heads[i] || ""); })
    );
    new MutationObserver(label).observe(body, { childList: true });
    label();
});

/* ---------------- INIT ---------------- */

(async function init() {
    fillSelects();

    const date = $("consumptionDate");
    if (date) date.value = new Date().toISOString().slice(0, 10);

    $("loginPage")?.classList.remove("hidden");
    $("appShell")?.classList.add("hidden");

    const { data } = await db.auth.getSession();
    if (data.session) {
        currentUser = data.session.user;
        await startApp();
    }
})();
