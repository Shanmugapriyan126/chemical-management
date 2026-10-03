/* RK-CMS - Supabase version
   Updated to match the current Supabase schema:
   chemicals:
     id, chemical_code, chemical_name, cas_no, manufacturer, supplier,
     department, process, hazard, stock, unit, storage_location,
     purchase_date, expiry_date, sds_available, ghs_available,
     remarks, created_by, created_at, updated_at

   consumption_logs:
     id, chemical_id, consumption_date, department, quantity, unit,
     used_by, purpose, remarks, recorded_by, created_at

   IMPORTANT:
   - This file expects window.SUPABASE_URL and window.SUPABASE_ANON_KEY.
   - Consumption uses the Supabase RPC record_chemical_consumption.
*/

const { createClient } = window.supabase;
const db = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

let chemicals = [];
let consumptionLogs = [];
let currentUser = null;
let currentProfile = null;

const departments = [
    "Washing","Dyeing","Printing","Maintenance","ETP","Boiler",
    "Housekeeping","Fabric Washing","Yarn Dyeing","Embroidery",
    "Cutting","Sewing","Packing","Other"
];

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function fillDepartmentSelects() {
    const selects = [
        document.getElementById("department"),
        document.getElementById("consumptionDepartment")
    ];

    selects.forEach(select => {
        if (!select) return;
        select.innerHTML =
            '<option value="">Select Department</option>' +
            departments.map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`).join("");
    });

    const filter = document.getElementById("departmentFilter");
    if (filter) {
        filter.innerHTML =
            '<option value="">All Departments</option>' +
            departments.map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`).join("");
    }
}

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));

    const page = document.getElementById(pageId);
    if (!page) return;

    page.classList.add("active");

    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === pageId);
    });

    const titles = {
        dashboard: "Dashboard",
        inventory: "Chemical Inventory",
        addChemical: "Add Chemical",
        consumption: "Consumption Log",
        reports: "Reports"
    };

    const pageTitle = document.getElementById("pageTitle");
    if (pageTitle) pageTitle.innerText = titles[pageId] || "RK-CMS";

    if (pageId === "dashboard") updateDashboard();
    if (pageId === "inventory") renderInventory();
    if (pageId === "consumption") {
        loadConsumption();
        populateConsumptionChemicals();
    }
    if (pageId === "reports") updateReports();
}

document.addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (button) showPage(button.dataset.page);
});

/* ---------------- PROFILE / AUTH ---------------- */

async function loadProfile() {
    if (!currentUser?.id) {
        throw new Error("No authenticated user found.");
    }

    const { data, error } = await db
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

    if (error || !data) {
        throw new Error(
            "No RK-CMS profile found for this login. Ask the administrator to create your profile."
        );
    }

    if (String(data.status ?? "active").toLowerCase() !== "active") {
        throw new Error("Your RK-CMS account is inactive.");
    }

    currentProfile = data;

    const role = String(data.role || "user").toLowerCase();

    const userInfo = document.getElementById("userInfo");
    if (userInfo) {
        userInfo.innerText =
            `👤 ${data.full_name || currentUser.email} • ${role.toUpperCase()}`;
    }

    document.querySelectorAll(".admin-only").forEach(element => {
        element.classList.toggle("hidden", role !== "admin");
    });

    document.querySelectorAll(".admin-only-page").forEach(element => {
        element.classList.toggle("hidden", role !== "admin");
    });
}

function isAdmin() {
    return String(currentProfile?.role || "").toLowerCase() === "admin";
}

/* ---------------- CHEMICALS ---------------- */

async function loadChemicals() {
    const { data, error } = await db
        .from("chemicals")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) throw error;

    chemicals = data || [];

    updateDashboard();
    renderInventory();
    populateConsumptionChemicals();
    updateReports();
}

function getNextChemicalCode() {
    let maxNumber = 0;

    chemicals.forEach(chemical => {
        const match = String(chemical.chemical_code || "").match(/(\d+)$/);
        if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
    });

    return "CHM" + String(maxNumber + 1).padStart(5, "0");
}

document.getElementById("chemicalForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!isAdmin()) {
        alert("Admin access required.");
        return;
    }

    const chemicalCode = getNextChemicalCode();

    const payload = {
        chemical_code: chemicalCode,
        chemical_name: document.getElementById("chemicalName")?.value.trim(),
        cas_no: document.getElementById("casNumber")?.value.trim() || null,
        manufacturer: document.getElementById("manufacturer")?.value.trim() || null,
        supplier: document.getElementById("supplier")?.value.trim() || null,
        department: document.getElementById("department")?.value || null,
        process: document.getElementById("process")?.value.trim() || null,
        hazard: document.getElementById("hazard")?.value || null,
        stock: Number(document.getElementById("stock")?.value) || 0,
        unit: document.getElementById("unit")?.value || null,
        storage_location: document.getElementById("storage")?.value.trim() || null,
        purchase_date: document.getElementById("purchaseDate")?.value || null,
        expiry_date: document.getElementById("expiryDate")?.value || null,
        sds_available: document.getElementById("sds")?.value === "Yes",
        ghs_available: document.getElementById("ghs")?.value === "Yes",
        remarks: document.getElementById("remarks")?.value.trim() || null,
        created_by: currentUser.id
    };

    if (!payload.chemical_name) {
        alert("Chemical name is required.");
        return;
    }

    const { error } = await db.from("chemicals").insert(payload);

    if (error) {
        alert(error.message);
        return;
    }

    alert(`Chemical added successfully.\nChemical ID: ${chemicalCode}`);

    event.target.reset();

    await loadChemicals();
    showPage("inventory");
});

/* ---------------- CONSUMPTION ---------------- */

async function loadConsumption() {
    const { data, error } = await db
        .from("consumption_logs")
        .select(`
            *,
            chemicals (
                chemical_code,
                chemical_name
            )
        `)
        .order("consumption_date", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    consumptionLogs = data || [];

    const table = document.getElementById("consumptionTable");
    if (!table) return;

    table.innerHTML = consumptionLogs.length
        ? consumptionLogs.map(log => `
            <tr>
                <td>${escapeHTML(log.consumption_date)}</td>
                <td>
                    ${escapeHTML(log.chemicals?.chemical_code || "")}
                    -
                    ${escapeHTML(log.chemicals?.chemical_name || "")}
                </td>
                <td>${escapeHTML(log.department)}</td>
                <td>${Number(log.quantity || 0).toFixed(2)} ${escapeHTML(log.unit)}</td>
                <td>${escapeHTML(log.used_by || "-")}</td>
                <td>${escapeHTML(log.purpose || "-")}</td>
                <td>${escapeHTML(log.recorded_by || "")}</td>
            </tr>
        `).join("")
        : '<tr><td colspan="7" style="text-align:center;padding:30px">No consumption records found.</td></tr>';
}

function populateConsumptionChemicals() {
    const select = document.getElementById("consumptionChemical");
    if (!select) return;

    select.innerHTML =
        '<option value="">Select Chemical</option>' +
        chemicals.map(chemical => `
            <option value="${escapeHTML(chemical.id)}">
                ${escapeHTML(chemical.chemical_code)}
                -
                ${escapeHTML(chemical.chemical_name)}
                (Stock: ${Number(chemical.stock || 0).toFixed(2)} ${escapeHTML(chemical.unit || "")})
            </option>
        `).join("");
}

document.getElementById("consumptionChemical")?.addEventListener("change", event => {
    const chemical = chemicals.find(
        item => String(item.id) === String(event.target.value)
    );

    const unit = document.getElementById("consumptionUnit");
    if (unit) unit.value = chemical?.unit || "";
});

document.getElementById("consumptionForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const chemical = chemicals.find(
        item =>
            String(item.id) ===
            String(document.getElementById("consumptionChemical")?.value)
    );

    const quantity = Number(
        document.getElementById("consumptionQty")?.value
    );

    const consumptionDate =
        document.getElementById("consumptionDate")?.value;

    const department =
        document.getElementById("consumptionDepartment")?.value;

    if (!chemical) {
        alert("Select a chemical.");
        return;
    }

    if (!consumptionDate) {
        alert("Select consumption date.");
        return;
    }

    if (!department) {
        alert("Select department.");
        return;
    }

    if (quantity <= 0) {
        alert("Enter a valid quantity.");
        return;
    }

    if (quantity > Number(chemical.stock || 0)) {
        alert(
            `Insufficient stock. Available: ${chemical.stock || 0} ${chemical.unit || ""}`
        );
        return;
    }

    const { error } = await db.rpc("record_chemical_consumption", {
        p_chemical_id: chemical.id,
        p_consumption_date: consumptionDate,
        p_department: department,
        p_quantity: quantity,
        p_unit: chemical.unit,
        p_used_by:
            document.getElementById("consumptionUser")?.value.trim() || null,
        p_purpose:
            document.getElementById("consumptionPurpose")?.value.trim() || null,
        p_remarks:
            document.getElementById("consumptionRemarks")?.value.trim() || null
    });

    if (error) {
        alert(
            "Consumption was not saved.\n\n" +
            "Make sure the Supabase function record_chemical_consumption exists.\n\n" +
            error.message
        );
        return;
    }

    alert("Consumption recorded successfully.");

    event.target.reset();

    const dateInput = document.getElementById("consumptionDate");
    if (dateInput) {
        dateInput.value = new Date().toISOString().slice(0, 10);
    }

    const unitInput = document.getElementById("consumptionUnit");
    if (unitInput) unitInput.value = "";

    await loadChemicals();
    await loadConsumption();
});

/* ---------------- DASHBOARD ---------------- */

function isExpired(chemical) {
    if (!chemical.expiry_date) return false;

    const expiry = new Date(chemical.expiry_date);
    const today = new Date();

    expiry.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    return expiry < today;
}

function isExpiringSoon(chemical) {
    if (!chemical.expiry_date) return false;

    const expiry = new Date(chemical.expiry_date);
    const today = new Date();

    expiry.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const days = (expiry - today) / 86400000;

    return days >= 0 && days <= 30;
}

function updateDashboard() {
    const total = document.getElementById("totalChemicals");
    const stock = document.getElementById("stockChemicals");
    const hazardous = document.getElementById("hazardousChemicals");
    const expiry = document.getElementById("expiryChemicals");

    if (total) total.innerText = chemicals.length;

    if (stock) {
        stock.innerText =
            chemicals.filter(c => Number(c.stock || 0) > 0).length;
    }

    if (hazardous) {
        hazardous.innerText =
            chemicals.filter(c => c.hazard !== "Non-Hazardous").length;
    }

    if (expiry) {
        expiry.innerText =
            chemicals.filter(c => isExpired(c) || isExpiringSoon(c)).length;
    }

    renderRecent();
}

function hazardClass(hazard) {
    if (hazard === "Non-Hazardous") return "status-good";

    if (
        hazard === "Flammable" ||
        hazard === "Corrosive"
    ) {
        return "status-danger";
    }

    return "status-warning";
}

function renderRecent() {
    const table = document.getElementById("recentTable");
    if (!table) return;

    const recent = chemicals.slice(0, 5);

    table.innerHTML = recent.length
        ? recent.map(chemical => `
            <tr>
                <td>${escapeHTML(chemical.chemical_code)}</td>
                <td>${escapeHTML(chemical.chemical_name)}</td>
                <td>${escapeHTML(chemical.department || "")}</td>
                <td>
                    ${Number(chemical.stock || 0).toFixed(2)}
                    ${escapeHTML(chemical.unit || "")}
                </td>
                <td>
                    <span class="status ${hazardClass(chemical.hazard)}">
                        ${escapeHTML(chemical.hazard || "-")}
                    </span>
                </td>
            </tr>
        `).join("")
        : '<tr><td colspan="5" style="text-align:center;padding:25px">No chemical records available.</td></tr>';
}

/* ---------------- INVENTORY ---------------- */

function formatDate(value) {
    if (!value) return "-";
    const d = new Date(value + (String(value).length === 10 ? "T00:00:00" : ""));
    if (Number.isNaN(d.getTime())) return escapeHTML(value);
    return d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function inventoryActionButtons(c) {
    const id = escapeHTML(c.id);
    if (!isAdmin()) {
        return `
            <div class="action-group">
                <button class="icon-action view" title="View chemical" aria-label="View chemical"
                        onclick="viewChemical('${id}')">⌁</button>
            </div>
        `;
    }

    return `
        <div class="action-group">
            <button class="icon-action view" title="View chemical" aria-label="View chemical"
                    onclick="viewChemical('${id}')">⌁</button>
            <button class="icon-action edit" title="Edit chemical" aria-label="Edit chemical"
                    onclick="editChemical('${id}')">✎</button>
            <button class="icon-action delete" title="Delete chemical" aria-label="Delete chemical"
                    onclick="deleteChemical('${id}')">×</button>
        </div>
    `;
}

function renderInventory() {
    const search = (document.getElementById("searchChemical")?.value || "").toLowerCase();
    const dept = document.getElementById("departmentFilter")?.value || "";
    const hazard = document.getElementById("hazardFilter")?.value || "";
    const table = document.getElementById("inventoryTable");
    if (!table) return;

    const filtered = chemicals.filter(c =>
        `${c.chemical_name || ""} ${c.chemical_code || ""} ${c.cas_no || ""} ${c.supplier || ""}`
            .toLowerCase()
            .includes(search) &&
        (!dept || c.department === dept) &&
        (!hazard || c.hazard === hazard)
    );

    table.innerHTML = filtered.length ? filtered.map(c => `
        <tr>
            <td><span class="code-badge">${escapeHTML(c.chemical_code)}</span></td>
            <td>
                <div class="chemical-cell">
                    <strong>${escapeHTML(c.chemical_name)}</strong>
                    <small>${escapeHTML(c.manufacturer || c.supplier || "Supplier not recorded")}</small>
                </div>
            </td>
            <td>${escapeHTML(c.cas_no || "-")}</td>
            <td>${escapeHTML(c.department || "-")}</td>
            <td><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard || "-")}</span></td>
            <td><strong>${Number(c.stock || 0).toFixed(2)}</strong></td>
            <td>${escapeHTML(c.unit || "-")}</td>
            <td>${escapeHTML(c.storage_location || "-")}</td>
            <td>
                <div class="expiry-cell">
                    <span>${formatDate(c.expiry_date)}</span>
                    ${isExpired(c) ? '<small class="expiry-danger">Expired</small>' :
                      isExpiringSoon(c) ? '<small class="expiry-warning">Review soon</small>' : ''}
                </div>
            </td>
            <td>${inventoryActionButtons(c)}</td>
        </tr>
    `).join("") : `
        <tr>
            <td colspan="10">
                <div class="empty-state">
                    <div class="empty-symbol">∅</div>
                    <strong>No chemical records found</strong>
                    <span>Try changing your search or filter.</span>
                </div>
            </td>
        </tr>
    `;
}

function ensureChemicalModal() {
    if (document.getElementById("chemicalModal")) return;

    document.body.insertAdjacentHTML("beforeend", `
        <div id="chemicalModal" class="rkcms-modal hidden">
            <div class="rkcms-modal-backdrop" onclick="closeChemicalModal()"></div>
            <div class="rkcms-modal-card" role="dialog" aria-modal="true">
                <div class="rkcms-modal-header">
                    <div>
                        <span id="modalEyebrow">CHEMICAL RECORD</span>
                        <h2 id="modalTitle">Chemical</h2>
                    </div>
                    <button class="modal-close" onclick="closeChemicalModal()" aria-label="Close">×</button>
                </div>
                <div id="chemicalModalBody"></div>
            </div>
        </div>
    `);
}

function openChemicalModal() {
    ensureChemicalModal();
    document.getElementById("chemicalModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeChemicalModal() {
    document.getElementById("chemicalModal")?.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

function viewChemical(id) {
    const c = chemicals.find(x => String(x.id) === String(id));
    if (!c) return;

    ensureChemicalModal();

    document.getElementById("modalEyebrow").innerText = "CHEMICAL DETAILS";
    document.getElementById("modalTitle").innerText = c.chemical_name || "Chemical";

    document.getElementById("chemicalModalBody").innerHTML = `
        <div class="detail-grid">
            <div><span>Code</span><strong>${escapeHTML(c.chemical_code)}</strong></div>
            <div><span>CAS No.</span><strong>${escapeHTML(c.cas_no || "-")}</strong></div>
            <div><span>Department</span><strong>${escapeHTML(c.department || "-")}</strong></div>
            <div><span>Process</span><strong>${escapeHTML(c.process || "-")}</strong></div>
            <div><span>Hazard</span><strong><span class="status ${hazardClass(c.hazard)}">${escapeHTML(c.hazard || "-")}</span></strong></div>
            <div><span>Stock</span><strong>${Number(c.stock || 0).toFixed(2)} ${escapeHTML(c.unit || "")}</strong></div>
            <div><span>Supplier</span><strong>${escapeHTML(c.supplier || "-")}</strong></div>
            <div><span>Storage</span><strong>${escapeHTML(c.storage_location || "-")}</strong></div>
            <div><span>Purchase Date</span><strong>${formatDate(c.purchase_date)}</strong></div>
            <div><span>Expiry / Review</span><strong>${formatDate(c.expiry_date)}</strong></div>
            <div><span>SDS</span><strong>${c.sds_available ? "Available" : "Not available"}</strong></div>
            <div><span>GHS Label</span><strong>${c.ghs_available ? "Available" : "Not available"}</strong></div>
        </div>
        <div class="detail-remarks">
            <span>Remarks</span>
            <p>${escapeHTML(c.remarks || "No remarks recorded.")}</p>
        </div>
        <div class="modal-footer">
            ${isAdmin() ? `<button class="secondary-btn" onclick="closeChemicalModal(); editChemical('${escapeHTML(c.id)}')">Edit record</button>` : ""}
            <button class="primary-btn" onclick="closeChemicalModal()">Close</button>
        </div>
    `;

    openChemicalModal();
}

function editChemical(id) {
    if (!isAdmin()) {
        alert("Admin access required.");
        return;
    }

    const c = chemicals.find(x => String(x.id) === String(id));
    if (!c) return;

    ensureChemicalModal();

    document.getElementById("modalEyebrow").innerText = "ADMINISTRATOR";
    document.getElementById("modalTitle").innerText = `Edit ${c.chemical_name || "Chemical"}`;

    const options = (items, selected) =>
        items.map(x => `<option value="${escapeHTML(x)}" ${String(x) === String(selected || "") ? "selected" : ""}>${escapeHTML(x)}</option>`).join("");

    const hazardOptions = ["Flammable","Corrosive","Toxic","Irritant","Oxidizing","Non-Hazardous"];

    document.getElementById("chemicalModalBody").innerHTML = `
        <form id="editChemicalForm" class="edit-form">
            <div class="edit-grid">
                <div class="form-group">
                    <label>Chemical Name *</label>
                    <input id="editChemicalName" required value="${escapeHTML(c.chemical_name || "")}">
                </div>
                <div class="form-group">
                    <label>CAS Number</label>
                    <input id="editCasNo" value="${escapeHTML(c.cas_no || "")}">
                </div>
                <div class="form-group">
                    <label>Supplier</label>
                    <input id="editSupplier" value="${escapeHTML(c.supplier || "")}">
                </div>
                <div class="form-group">
                    <label>Department</label>
                    <select id="editDepartment">${options(departments, c.department)}</select>
                </div>
                <div class="form-group">
                    <label>Hazard Classification</label>
                    <select id="editHazard">${options(hazardOptions, c.hazard)}</select>
                </div>
                <div class="form-group">
                    <label>Stock</label>
                    <input id="editStock" type="number" min="0" step="0.01" value="${Number(c.stock || 0)}">
                </div>
                <div class="form-group">
                    <label>Unit</label>
                    <select id="editUnit">
                        ${options(["Kg","Litre","Gram","ML","Nos"], c.unit)}
                    </select>
                </div>
                <div class="form-group">
                    <label>Storage Location</label>
                    <input id="editStorage" value="${escapeHTML(c.storage_location || "")}">
                </div>
                <div class="form-group">
                    <label>Purchase Date</label>
                    <input id="editPurchaseDate" type="date" value="${escapeHTML(c.purchase_date || "")}">
                </div>
                <div class="form-group">
                    <label>Expiry / Review Date</label>
                    <input id="editExpiryDate" type="date" value="${escapeHTML(c.expiry_date || "")}">
                </div>
                <div class="form-group">
                    <label>SDS Available</label>
                    <select id="editSds">
                        <option value="true" ${c.sds_available === true ? "selected" : ""}>Yes</option>
                        <option value="false" ${c.sds_available !== true ? "selected" : ""}>No</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>GHS Label Available</label>
                    <select id="editGhs">
                        <option value="true" ${c.ghs_available === true ? "selected" : ""}>Yes</option>
                        <option value="false" ${c.ghs_available !== true ? "selected" : ""}>No</option>
                    </select>
                </div>
            </div>
            <div class="form-group edit-remarks">
                <label>Remarks</label>
                <textarea id="editRemarks">${escapeHTML(c.remarks || "")}</textarea>
            </div>
            <div class="modal-footer">
                <button type="button" class="secondary-btn" onclick="closeChemicalModal()">Cancel</button>
                <button type="submit" class="primary-btn">Save Changes</button>
            </div>
        </form>
    `;

    document.getElementById("editChemicalForm").addEventListener("submit", async e => {
        e.preventDefault();

        const payload = {
            chemical_name: document.getElementById("editChemicalName").value.trim(),
            cas_no: document.getElementById("editCasNo").value.trim() || null,
            supplier: document.getElementById("editSupplier").value.trim() || null,
            department: document.getElementById("editDepartment").value || null,
            hazard: document.getElementById("editHazard").value || null,
            stock: Number(document.getElementById("editStock").value) || 0,
            unit: document.getElementById("editUnit").value || null,
            storage_location: document.getElementById("editStorage").value.trim() || null,
            purchase_date: document.getElementById("editPurchaseDate").value || null,
            expiry_date: document.getElementById("editExpiryDate").value || null,
            sds_available: document.getElementById("editSds").value === "true",
            ghs_available: document.getElementById("editGhs").value === "true",
            remarks: document.getElementById("editRemarks").value.trim() || null
        };

        // Keep the update limited to the selected chemical.
        // Returning the updated row also lets us detect an RLS policy that
        // matches the UPDATE command but does not allow this row to be changed.
        payload.updated_at = new Date().toISOString();

        const { data: updatedRow, error } = await db
            .from("chemicals")
            .update(payload)
            .eq("id", c.id)
            .select("id, chemical_code")
            .single();

        if (error) {
            console.error("RK-CMS UPDATE error:", error);
            alert(
                "Chemical could not be updated.\n\n" +
                error.message +
                "\n\nIf this is an RLS error, run the UPDATE policy SQL provided with this update."
            );
            return;
        }

        if (!updatedRow) {
            alert("No chemical was updated. Please verify the Supabase UPDATE policy.");
            return;
        }

        closeChemicalModal();
        await loadChemicals();
        alert("Chemical updated successfully.");
    });
}

async function deleteChemical(id) {
    if (!isAdmin()) return;

    const chemical = chemicals.find(item => String(item.id) === String(id));
    if (!chemical) return;

    ensureChemicalModal();
    document.getElementById("modalEyebrow").innerText = "PERMANENT ACTION";
    document.getElementById("modalTitle").innerText = "Delete chemical?";

    document.getElementById("chemicalModalBody").innerHTML = `
        <div class="delete-confirm">
            <div class="delete-symbol">×</div>
            <h3>${escapeHTML(chemical.chemical_name)}</h3>
            <p>This will permanently remove <strong>${escapeHTML(chemical.chemical_code)}</strong> from the chemical master.</p>
            <div class="modal-footer">
                <button class="secondary-btn" onclick="closeChemicalModal()">Cancel</button>
                <button class="danger-btn" onclick="confirmDeleteChemical('${escapeHTML(chemical.id)}')">Delete Chemical</button>
            </div>
        </div>
    `;

    openChemicalModal();
}

async function confirmDeleteChemical(id) {
    if (!isAdmin()) return;

    const { error } = await db.from("chemicals").delete().eq("id", id);

    if (error) {
        alert("Chemical could not be deleted.\n\n" + error.message);
        return;
    }

    closeChemicalModal();
    await loadChemicals();
}


/* ---------------- REPORTS ---------------- */

function updateReports() {
    const sdsAvailable = document.getElementById("sdsAvailable");
    const sdsMissing = document.getElementById("sdsMissing");
    const ghsMissing = document.getElementById("ghsMissing");

    if (sdsAvailable) {
        sdsAvailable.innerText =
            chemicals.filter(c => c.sds_available === true).length;
    }

    if (sdsMissing) {
        sdsMissing.innerText =
            chemicals.filter(c => c.sds_available !== true).length;
    }

    if (ghsMissing) {
        ghsMissing.innerText =
            chemicals.filter(c => c.ghs_available !== true).length;
    }
}

/* ---------------- CSV EXPORT ---------------- */

function csvDownload(filename, headers, rows) {
    const csv = [headers, ...rows]
        .map(row =>
            row
                .map(value =>
                    `"${String(value ?? "").replace(/"/g, '""')}"`
                )
                .join(",")
        )
        .join("\n");

    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    URL.revokeObjectURL(url);
}

function exportCSV() {
    csvDownload(
        "Chemical_Inventory.csv",
        [
            "Chemical ID",
            "Chemical Name",
            "CAS Number",
            "Manufacturer",
            "Supplier",
            "Department",
            "Process",
            "Hazard",
            "Stock",
            "Unit",
            "Storage Location",
            "Purchase Date",
            "Expiry Date",
            "SDS Available",
            "GHS Label Available",
            "Remarks"
        ],
        chemicals.map(c => [
            c.chemical_code,
            c.chemical_name,
            c.cas_no,
            c.manufacturer,
            c.supplier,
            c.department,
            c.process,
            c.hazard,
            c.stock,
            c.unit,
            c.storage_location,
            c.purchase_date,
            c.expiry_date,
            c.sds_available,
            c.ghs_available,
            c.remarks
        ])
    );
}

function exportConsumptionCSV() {
    csvDownload(
        "Chemical_Consumption_Log.csv",
        [
            "Date",
            "Chemical",
            "Department",
            "Quantity",
            "Unit",
            "Used By",
            "Purpose",
            "Remarks",
            "Recorded By"
        ],
        consumptionLogs.map(log => [
            log.consumption_date,
            log.chemicals?.chemical_name,
            log.department,
            log.quantity,
            log.unit,
            log.used_by,
            log.purpose,
            log.remarks,
            log.recorded_by
        ])
    );
}

/* ---------------- FILTERS ---------------- */

document.getElementById("searchChemical")?.addEventListener(
    "input",
    renderInventory
);

document.getElementById("departmentFilter")?.addEventListener(
    "change",
    renderInventory
);

document.getElementById("hazardFilter")?.addEventListener(
    "change",
    renderInventory
);

/* ---------------- LOGIN ---------------- */

document.getElementById("loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const errorBox = document.getElementById("loginError");
    const button = event.target.querySelector("button[type='submit']");

    if (errorBox) errorBox.innerText = "";

    if (button) {
        button.disabled = true;

        const span = button.querySelector("span:first-child");
        if (span) span.innerText = "Signing in...";
    }

    try {
        const { data, error } = await db.auth.signInWithPassword({
            email: document.getElementById("loginEmail").value.trim(),
            password: document.getElementById("loginPassword").value
        });

        if (error) throw error;

        currentUser = data.user;

        await startApp();
    } catch (error) {
        console.error(error);

        if (errorBox) {
            errorBox.innerText =
                error.message || "Invalid email or password.";
        }
    } finally {
        if (button) {
            button.disabled = false;

            const span = button.querySelector("span:first-child");
            if (span) span.innerText = "Sign In";
        }
    }
});

document.getElementById("togglePassword")?.addEventListener(
    "click",
    function () {
        const input = document.getElementById("loginPassword");
        if (!input) return;

        const isPassword = input.type === "password";

        input.type = isPassword ? "text" : "password";
        this.innerText = isPassword ? "Hide" : "Show";
    }
);

document.getElementById("logoutBtn")?.addEventListener(
    "click",
    async () => {
        await db.auth.signOut();
        location.reload();
    }
);

/* ---------------- APP START ---------------- */

async function startApp() {
    try {
        document.getElementById("appShell")?.classList.add("hidden");

        await loadProfile();
        await loadChemicals();
        await loadConsumption();

        document.getElementById("loginPage")?.classList.add("hidden");
        document.getElementById("appShell")?.classList.remove("hidden");

        showPage("dashboard");
    } catch (error) {
        console.error(error);

        document.getElementById("loginPage")?.classList.remove("hidden");
        document.getElementById("appShell")?.classList.add("hidden");

        const loginError = document.getElementById("loginError");
        if (loginError) {
            loginError.innerText =
                error.message || "Unable to load your account.";
        }

        await db.auth.signOut();

        currentUser = null;
        currentProfile = null;
    }
}


document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeChemicalModal();
});

/* ---------------- INITIALIZATION ---------------- */

(async function init() {
    fillDepartmentSelects();

    const consumptionDate = document.getElementById("consumptionDate");
    if (consumptionDate) {
        consumptionDate.value =
            new Date().toISOString().slice(0, 10);
    }

    document.getElementById("loginPage")?.classList.remove("hidden");
    document.getElementById("appShell")?.classList.add("hidden");

    const { data } = await db.auth.getSession();

    if (data.session) {
        currentUser = data.session.user;
        await startApp();
    }
})();
