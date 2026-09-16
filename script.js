/* =====================================================
   CHEMICAL MANAGEMENT SYSTEM
   Internal Factory EHS Application
   ===================================================== */


/* -----------------------------------------------------
   DATABASE
----------------------------------------------------- */

let chemicals =
    JSON.parse(localStorage.getItem("chemicals")) || [];


/* -----------------------------------------------------
   PAGE NAVIGATION
----------------------------------------------------- */

function showPage(pageId) {

    document.querySelectorAll(".page")
        .forEach(page => page.classList.remove("active"));

    document.getElementById(pageId)
        .classList.add("active");


    document.querySelectorAll(".nav-btn")
        .forEach(btn => btn.classList.remove("active"));


    const titles = {
        dashboard: "Dashboard",
        inventory: "Chemical Inventory",
        addChemical: "Add Chemical",
        reports: "Reports"
    };

    document.getElementById("pageTitle").innerText =
        titles[pageId];


    if (pageId === "dashboard") {
        updateDashboard();
    }

    if (pageId === "inventory") {
        renderInventory();
    }

    if (pageId === "reports") {
        updateReports();
    }
}


/* -----------------------------------------------------
   GENERATE CHEMICAL ID
----------------------------------------------------- */

function generateChemicalID() {

    const nextNumber = chemicals.length + 1;

    return "CHM" + String(nextNumber).padStart(5, "0");
}


/* -----------------------------------------------------
   ADD CHEMICAL
----------------------------------------------------- */

document.getElementById("chemicalForm")
    .addEventListener("submit", function(event) {

    event.preventDefault();


    const chemical = {

        id: generateChemicalID(),

        name:
            document.getElementById("chemicalName").value.trim(),

        cas:
            document.getElementById("casNumber").value.trim(),

        supplier:
            document.getElementById("supplier").value.trim(),

        department:
            document.getElementById("department").value,

        hazard:
            document.getElementById("hazard").value,

        stock:
            parseFloat(document.getElementById("stock").value) || 0,

        unit:
            document.getElementById("unit").value,

        storage:
            document.getElementById("storage").value.trim(),

        purchaseDate:
            document.getElementById("purchaseDate").value,

        expiry:
            document.getElementById("expiryDate").value,

        sds:
            document.getElementById("sds").value,

        ghs:
            document.getElementById("ghs").value,

        remarks:
            document.getElementById("remarks").value.trim(),

        created:
            new Date().toISOString()

    };


    chemicals.push(chemical);


    localStorage.setItem(
        "chemicals",
        JSON.stringify(chemicals)
    );


    alert(
        "Chemical added successfully.\nChemical ID: "
        + chemical.id
    );


    this.reset();


    showPage("inventory");

});


/* -----------------------------------------------------
   DASHBOARD
----------------------------------------------------- */

function updateDashboard() {

    document.getElementById("totalChemicals")
        .innerText = chemicals.length;


    document.getElementById("stockChemicals")
        .innerText =
        chemicals.filter(c => c.stock > 0).length;


    document.getElementById("hazardousChemicals")
        .innerText =
        chemicals.filter(
            c => c.hazard !== "Non-Hazardous"
        ).length;


    document.getElementById("expiryChemicals")
        .innerText =
        chemicals.filter(isExpiryDue).length;


    renderRecent();
}


/* -----------------------------------------------------
   EXPIRY CHECK
----------------------------------------------------- */

function isExpiryDue(chemical) {

    if (!chemical.expiry) {
        return false;
    }

    const today = new Date();

    const expiryDate =
        new Date(chemical.expiry);


    const difference =
        expiryDate - today;


    const days =
        difference / (1000 * 60 * 60 * 24);


    return days <= 30;
}


/* -----------------------------------------------------
   INVENTORY TABLE
----------------------------------------------------- */

function renderInventory() {

    const search =
        document.getElementById("searchChemical")
            ?.value.toLowerCase() || "";


    const department =
        document.getElementById("departmentFilter")
            ?.value || "";


    const hazard =
        document.getElementById("hazardFilter")
            ?.value || "";


    const table =
        document.getElementById("inventoryTable");


    table.innerHTML = "";


    const filtered =
        chemicals.filter(c => {

            const matchesSearch =
                c.name.toLowerCase()
                    .includes(search) ||

                c.id.toLowerCase()
                    .includes(search) ||

                c.cas.toLowerCase()
                    .includes(search);


            const matchesDepartment =
                !department ||
                c.department === department;


            const matchesHazard =
                !hazard ||
                c.hazard === hazard;


            return (
                matchesSearch &&
                matchesDepartment &&
                matchesHazard
            );

        });


    if (filtered.length === 0) {

        table.innerHTML = `
            <tr>
                <td colspan="10"
                    style="text-align:center;padding:30px;">
                    No chemical records found.
                </td>
            </tr>
        `;

        return;
    }


    filtered.forEach(c => {

        const row =
            document.createElement("tr");


        row.innerHTML = `

            <td><strong>${c.id}</strong></td>

            <td>${escapeHTML(c.name)}</td>

            <td>${escapeHTML(c.cas)}</td>

            <td>${escapeHTML(c.department)}</td>

            <td>
                <span class="status ${hazardClass(c.hazard)}">
                    ${escapeHTML(c.hazard)}
                </span>
            </td>

            <td>${c.stock}</td>

            <td>${escapeHTML(c.unit)}</td>

            <td>${escapeHTML(c.storage)}</td>

            <td>
                ${c.expiry || "-"}
            </td>

            <td>
                <button
                    class="delete-btn"
                    onclick="deleteChemical('${c.id}')">
                    Delete
                </button>
            </td>

        `;


        table.appendChild(row);

    });

}


/* -----------------------------------------------------
   HAZARD CLASS
----------------------------------------------------- */

function hazardClass(hazard) {

    if (hazard === "Non-Hazardous") {
        return "status-good";
    }

    if (
        hazard === "Flammable" ||
        hazard === "Corrosive"
    ) {
        return "status-danger";
    }

    return "status-warning";
}


/* -----------------------------------------------------
   DELETE
----------------------------------------------------- */

function deleteChemical(id) {

    const chemical =
        chemicals.find(c => c.id === id);


    if (!chemical) return;


    const confirmation =
        confirm(
            `Delete ${chemical.name} (${chemical.id})?`
        );


    if (!confirmation) return;


    chemicals =
        chemicals.filter(c => c.id !== id);


    localStorage.setItem(
        "chemicals",
        JSON.stringify(chemicals)
    );


    renderInventory();

    updateDashboard();

}


/* -----------------------------------------------------
   RECENT CHEMICALS
----------------------------------------------------- */

function renderRecent() {

    const table =
        document.getElementById("recentTable");


    table.innerHTML = "";


    const recent =
        [...chemicals]
            .reverse()
            .slice(0, 5);


    if (recent.length === 0) {

        table.innerHTML = `
            <tr>
                <td colspan="5"
                    style="text-align:center;padding:25px;">
                    No chemical records available.
                </td>
            </tr>
        `;

        return;
    }


    recent.forEach(c => {

        const row =
            document.createElement("tr");


        row.innerHTML = `

            <td>${c.id}</td>

            <td>${escapeHTML(c.name)}</td>

            <td>${escapeHTML(c.department)}</td>

            <td>${c.stock} ${escapeHTML(c.unit)}</td>

            <td>
                <span class="status ${hazardClass(c.hazard)}">
                    ${escapeHTML(c.hazard)}
                </span>
            </td>

        `;


        table.appendChild(row);

    });

}


/* -----------------------------------------------------
   REPORTS
----------------------------------------------------- */

function updateReports() {

    document.getElementById("sdsAvailable")
        .innerText =
        chemicals.filter(c => c.sds === "Yes").length;


    document.getElementById("sdsMissing")
        .innerText =
        chemicals.filter(c => c.sds === "No").length;


    document.getElementById("ghsMissing")
        .innerText =
        chemicals.filter(c => c.ghs === "No").length;
}


/* -----------------------------------------------------
   CSV EXPORT
----------------------------------------------------- */

function exportCSV() {

    if (chemicals.length === 0) {

        alert("No chemical data available.");

        return;
    }


    const headers = [

        "Chemical ID",
        "Chemical Name",
        "CAS Number",
        "Supplier",
        "Department",
        "Hazard",
        "Stock",
        "Unit",
        "Storage Location",
        "Purchase Date",
        "Expiry / Review Date",
        "SDS Available",
        "GHS Label Available",
        "Remarks"

    ];


    const rows =
        chemicals.map(c => [

            c.id,
            c.name,
            c.cas,
            c.supplier,
            c.department,
            c.hazard,
            c.stock,
            c.unit,
            c.storage,
            c.purchaseDate,
            c.expiry,
            c.sds,
            c.ghs,
            c.remarks

        ]);


    const csv = [

        headers,

        ...rows

    ].map(row =>

        row.map(value =>

            `"${String(value ?? "")
                .replace(/"/g, '""')}"`

        ).join(",")

    ).join("\n");


    const blob =
        new Blob([csv], {
            type: "text/csv;charset=utf-8;"
        });


    const url =
        URL.createObjectURL(blob);


    const link =
        document.createElement("a");


    link.href = url;

    link.download =
        "Chemical_Inventory.csv";


    link.click();


    URL.revokeObjectURL(url);
}


/* -----------------------------------------------------
   SECURITY / HTML ESCAPE
----------------------------------------------------- */

function escapeHTML(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* -----------------------------------------------------
   INITIAL LOAD
----------------------------------------------------- */

updateDashboard();
