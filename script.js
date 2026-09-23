/* RK-CMS - Supabase version */
const { createClient } = window.supabase;
const db = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

let chemicals = [];
let consumptionLogs = [];
let currentUser = null;
let currentProfile = null;

const departments = ["Washing","Dyeing","Printing","Maintenance","ETP","Boiler","Housekeeping","Fabric Washing","Yarn Dyeing","Embroidery","Cutting","Sewing","Packing","Other"];

function fillDepartmentSelects() {
    const selects = [document.getElementById("department"), document.getElementById("consumptionDepartment")];
    selects.forEach(select => {
        if (!select) return;
        select.innerHTML = '<option value="">Select Department</option>' +
            departments.map(d => `<option>${escapeHTML(d)}</option>`).join("");
    });
    const filter = document.getElementById("departmentFilter");
    filter.innerHTML = '<option value="">All Departments</option>' +
        departments.map(d => `<option>${escapeHTML(d)}</option>`).join("");
}

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = document.getElementById(pageId);
    if (!page) return;
    page.classList.add("active");

    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === pageId);
    });

    const titles = {dashboard:"Dashboard",inventory:"Chemical Inventory",addChemical:"Add Chemical",consumption:"Consumption Log",reports:"Reports"};
    document.getElementById("pageTitle").innerText = titles[pageId] || "RK-CMS";

    if (pageId === "dashboard") updateDashboard();
    if (pageId === "inventory") renderInventory();
    if (pageId === "consumption") { loadConsumption(); populateConsumptionChemicals(); }
    if (pageId === "reports") updateReports();
}

document.addEventListener("click", e => {
    const btn = e.target.closest("[data-page]");
    if (btn) showPage(btn.dataset.page);
});

async function loadProfile() {
    const { data, error } = await db.from("profiles").select("*").eq("id", currentUser.id).single();
    if (error) throw error;
    currentProfile = data;
    document.getElementById("userInfo").innerText =
        `👤 ${data.full_name || currentUser.email} • ${data.role.toUpperCase()}`;
    document.querySelectorAll(".admin-only").forEach(el => {
        el.classList.toggle("hidden", data.role !== "admin");
    });
    document.querySelectorAll(".admin-only-page").forEach(el => {
        el.classList.toggle("hidden", data.role !== "admin");
    });
}

async function loadChemicals() {
    const { data, error } = await db.from("chemicals").select("*").order("created_at", {ascending:false});
    if (error) throw error;
    chemicals = data || [];
    updateDashboard();
    renderInventory();
    populateConsumptionChemicals();
    updateReports();
}

async function loadConsumption() {
    const { data, error } = await db.from("consumption_logs")
        .select("*, chemicals(name, chemical_code)")
        .order("consumption_date", {ascending:false})
        .order("created_at", {ascending:false});
    if (error) { console.error(error); return; }
    consumptionLogs = data || [];
    const table = document.getElementById("consumptionTable");
    table.innerHTML = consumptionLogs.length ? consumptionLogs.map(l => `
        <tr>
            <td>${l.consumption_date}</td>
            <td>${escapeHTML(l.chemicals?.chemical_code || "")} - ${escapeHTML(l.chemicals?.name || "")}</td>
            <td>${escapeHTML(l.department)}</td>
            <td>${Number(l.quantity).toFixed(2)} ${escapeHTML(l.unit)}</td>
            <td>${escapeHTML(l.used_by || "-")}</td>
            <td>${escapeHTML(l.purpose || "-")}</td>
            <td>${escapeHTML(l.recorded_by || "")}</td>
        </tr>`).join("") :
        `<tr><td colspan="7" style="text-align:center;padding:30px;">No consumption records found.</td></tr>`;
}

function populateConsumptionChemicals() {
    const select = document.getElementById("consumptionChemical");
    if (!select) return;
    select.innerHTML = '<option value="">Select Chemical</option>' + chemicals.map(c =>
        `<option value="${c.id}">${escapeHTML(c.chemical_code)} - ${escapeHTML(c.name)} (Stock: ${c.stock} ${escapeHTML(c.unit)})</option>`
    ).join("");
}

document.getElementById("consumptionChemical").addEventListener("change", e => {
    const c = chemicals.find(x => String(x.id) === String(e.target.value));
    document.getElementById("consumptionUnit").value = c?.unit || "";
});

document.getElementById("chemicalForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (currentProfile?.role !== "admin") return alert("Admin access required.");

    const nextCode = "CHM" + String(chemicals.length + 1).padStart(5, "0");
    const payload = {
        chemical_code: nextCode,
        chemical_name: document.getElementById("chemicalName").value.trim(),
        cas_no: document.getElementById("casNumber").value.trim(),
        supplier: document.getElementById("supplier").value.trim(),
        department: document.getElementById("department").value,
        hazard: document.getElementById("hazard").value,
        stock: Number(document.getElementById("stock").value) || 0,
        unit: document.getElementById("unit").value,
        storage_location: document.getElementById("storage").value.trim(),
        purchase_date: document.getElementById("purchaseDate").value || null,
        expiry_date: document.getElementById("expiryDate").value || null,
        sds_available: document.getElementById("sds").value,
        ghs_available: document.getElementById("ghs").value,
        remarks: document.getElementById("remarks").value.trim(),
        created_by: currentUser.id
    };

    const { error } = await db.from("chemicals").insert(payload);
    if (error) return alert(error.message);
    alert(`Chemical added successfully.\nChemical ID: ${nextCode}`);
    e.target.reset();
    await loadChemicals();
    showPage("inventory");
});

document.getElementById("consumptionForm").addEventListener("submit", async e => {
    e.preventDefault();
    const chemical = chemicals.find(c => String(c.id) === String(document.getElementById("consumptionChemical").value));
    const qty = Number(document.getElementById("consumptionQty").value);
    if (!chemical) return alert("Select a chemical.");
    if (qty <= 0) return alert("Enter a valid quantity.");
    if (qty > Number(chemical.stock)) return alert(`Insufficient stock. Available: ${chemical.stock} ${chemical.unit}`);

    const log = {
        chemical_id: chemical.id,
        consumption_date: document.getElementById("consumptionDate").value,
        department: document.getElementById("consumptionDepartment").value,
        quantity: qty,
        unit: chemical.unit,
        used_by: document.getElementById("consumptionUser").value.trim(),
        purpose: document.getElementById("consumptionPurpose").value.trim(),
        remarks: document.getElementById("consumptionRemarks").value.trim(),
        recorded_by: currentUser.id
    };

    const { error: logError } = await db.from("consumption_logs").insert(log);
    if (logError) return alert(logError.message);

    const { error: stockError } = await db.from("chemicals").update({stock: Number(chemical.stock) - qty}).eq("id", chemical.id);
    if (stockError) return alert("Consumption saved, but stock update failed: " + stockError.message);

    alert("Consumption recorded successfully.");
    e.target.reset();
    document.getElementById("consumptionUnit").value = "";
    await loadChemicals();
    await loadConsumption();
});

function updateDashboard() {
    document.getElementById("totalChemicals").innerText = chemicals.length;
    document.getElementById("stockChemicals").innerText = chemicals.filter(c => Number(c.stock) > 0).length;
    document.getElementById("hazardousChemicals").innerText = chemicals.filter(c => c.hazard !== "Non-Hazardous").length;
    document.getElementById("expiryChemicals").innerText = chemicals.filter(isExpiryDue).length;
    renderRecent();
}

function isExpiryDue(c) {
    if (!c.expiry_date) return false;
    const d = new Date(c.expiry_date);
    const today = new Date();
    today.setHours(0,0,0,0);
    return (d - today) / 86400000 <= 30;
}

function renderInventory() {
    const search = (document.getElementById("searchChemical")?.value || "").toLowerCase();
    const dept = document.getElementById("departmentFilter")?.value || "";
    const hazard = document.getElementById("hazardFilter")?.value || "";
    const table = document.getElementById("inventoryTable");

    const filtered = chemicals.filter(c =>
        (`${c.name} ${c.chemical_code} ${c.cas || ""}`).toLowerCase().includes(search) &&
        (!dept || c.department === dept) &&
        (!hazard || c.hazard === hazard)
    );

    table.innerHTML = filtered.length ? filtered.map(c => `
        <tr>
            <td><strong>${escapeHTML(c.chemical_code)}</strong></td>
            <td>${escapeHTML(c.name)}</td><td>${escapeHTML(c.cas || "")}</td>
            <td>${escapeHTML(c.department)}</td>
            <td><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard)}</span></td>
            <td>${Number(c.stock).toFixed(2)}</td><td>${escapeHTML(c.unit)}</td>
            <td>${escapeHTML(c.storage || "")}</td><td>${c.expiry_date || "-"}</td>
            <td>${currentProfile?.role === "admin" ? `<button class="delete-btn" onclick="deleteChemical(${c.id})">Delete</button>` : '<span class="readonly-note">View only</span>'}</td>
        </tr>`).join("") :
        `<tr><td colspan="10" style="text-align:center;padding:30px;">No chemical records found.</td></tr>`;
}

function renderRecent() {
    const table = document.getElementById("recentTable");
    const recent = chemicals.slice(0,5);
    table.innerHTML = recent.length ? recent.map(c => `
        <tr><td>${escapeHTML(c.chemical_code)}</td><td>${escapeHTML(c.name)}</td><td>${escapeHTML(c.department)}</td>
        <td>${Number(c.stock).toFixed(2)} ${escapeHTML(c.unit)}</td><td><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard)}</span></td></tr>`).join("") :
        `<tr><td colspan="5" style="text-align:center;padding:25px;">No chemical records available.</td></tr>`;
}

async function deleteChemical(id) {
    if (currentProfile?.role !== "admin") return;
    const c = chemicals.find(x => x.id === id);
    if (!c || !confirm(`Delete ${c.name} (${c.chemical_code})?`)) return;
    const { error } = await db.from("chemicals").delete().eq("id", id);
    if (error) return alert(error.message);
    await loadChemicals();
}

function updateReports() {
    document.getElementById("sdsAvailable").innerText = chemicals.filter(c => c.sds === "Yes").length;
    document.getElementById("sdsMissing").innerText = chemicals.filter(c => c.sds === "No").length;
    document.getElementById("ghsMissing").innerText = chemicals.filter(c => c.ghs === "No").length;
}

function hazardClass(h) {
    if (h === "Non-Hazardous") return "status-good";
    if (h === "Flammable" || h === "Corrosive") return "status-danger";
    return "status-warning";
}

function escapeHTML(v) {
    return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function csvDownload(filename, headers, rows) {
    const csv = [headers,...rows].map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
    const a = document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

function exportCSV() {
    csvDownload("Chemical_Inventory.csv",
        ["Chemical ID","Chemical Name","CAS Number","Supplier","Department","Hazard","Stock","Unit","Storage Location","Purchase Date","Expiry / Review Date","SDS Available","GHS Label Available","Remarks"],
        chemicals.map(c => [c.chemical_code,c.name,c.cas,c.supplier,c.department,c.hazard,c.stock,c.unit,c.storage,c.purchase_date,c.expiry_date,c.sds,c.ghs,c.remarks]));
}
function exportConsumptionCSV() {
    csvDownload("Chemical_Consumption_Log.csv",
        ["Date","Chemical","Department","Quantity","Unit","Used By","Purpose","Remarks","Recorded By"],
        consumptionLogs.map(l => [l.consumption_date,l.chemicals?.name,l.department,l.quantity,l.unit,l.used_by,l.purpose,l.remarks,l.recorded_by]));
}

document.getElementById("searchChemical").addEventListener("input", renderInventory);
document.getElementById("departmentFilter").addEventListener("change", renderInventory);
document.getElementById("hazardFilter").addEventListener("change", renderInventory);

document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errorBox = document.getElementById("loginError");
    const button = e.target.querySelector("button[type='submit']");
    errorBox.innerText = "";
    button.disabled = true;
    button.querySelector("span:first-child").innerText = "Signing in...";

    try {
        const {data,error} = await db.auth.signInWithPassword({
            email: document.getElementById("loginEmail").value.trim(),
            password: document.getElementById("loginPassword").value
        });
        if (error) throw error;
        currentUser = data.user;
        await startApp();
    } catch (err) {
        console.error(err);
        errorBox.innerText = err.message || "Invalid email or password.";
    } finally {
        button.disabled = false;
        button.querySelector("span:first-child").innerText = "Sign In";
    }
});

document.getElementById("togglePassword").addEventListener("click", function() {
    const input = document.getElementById("loginPassword");
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    this.innerText = isPassword ? "Hide" : "Show";
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await db.auth.signOut();
    location.reload();
});

async function startApp() {
    try {
        // Keep dashboard hidden while authentication/profile/data are loading.
        document.getElementById("appShell").classList.add("hidden");

        await loadProfile();
        await loadChemicals();
        await loadConsumption();

        document.getElementById("loginPage").classList.add("hidden");
        document.getElementById("appShell").classList.remove("hidden");
        showPage("dashboard");
    } catch (err) {
        console.error(err);
        document.getElementById("loginPage").classList.remove("hidden");
        document.getElementById("appShell").classList.add("hidden");
        document.getElementById("loginError").innerText =
            err.message || "Unable to load your account.";
        await db.auth.signOut();
    }
}

(async function init() {
    fillDepartmentSelects();
    document.getElementById("consumptionDate").value = new Date().toISOString().slice(0,10);
    const {data} = await db.auth.getSession();
    if (data.session) {
        currentUser = data.session.user;
        await startApp();
    }
})();
