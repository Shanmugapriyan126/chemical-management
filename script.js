/* =========================================================
   RK-CMS - SUPABASE VERSION
   ========================================================= */

const { createClient } = window.supabase;

const db = createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
);

let chemicals = [];
let consumptionLogs = [];
let currentUser = null;
let currentProfile = null;

const departments = [
    "Washing",
    "Dyeing",
    "Printing",
    "Maintenance",
    "ETP",
    "Boiler",
    "Housekeeping",
    "Fabric Washing",
    "Yarn Dyeing",
    "Embroidery",
    "Cutting",
    "Sewing",
    "Packing",
    "Other"
];


/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/*
   Used when passing Supabase UUID into onclick=""
*/
function escapeJS(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}


/* =========================================================
   DEPARTMENT DROPDOWNS
   ========================================================= */

function fillDepartmentSelects() {

    const selects = [
        document.getElementById("department"),
        document.getElementById("consumptionDepartment")
    ];

    selects.forEach(select => {

        if (!select) return;

        select.innerHTML =
            '<option value="">Select Department</option>' +
            departments
                .map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`)
                .join("");
    });

    const filter = document.getElementById("departmentFilter");

    if (filter) {

        filter.innerHTML =
            '<option value="">All Departments</option>' +
            departments
                .map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`)
                .join("");
    }
}


/* =========================================================
   PAGE NAVIGATION
   ========================================================= */

function showPage(pageId) {

    document
        .querySelectorAll(".page")
        .forEach(page => page.classList.remove("active"));

    const page = document.getElementById(pageId);

    if (!page) return;

    page.classList.add("active");

    document
        .querySelectorAll(".nav-btn")
        .forEach(btn => {

            btn.classList.toggle(
                "active",
                btn.dataset.page === pageId
            );

        });

    const titles = {
        dashboard: "Dashboard",
        inventory: "Chemical Inventory",
        addChemical: "Add Chemical",
        consumption: "Consumption Log",
        reports: "Reports"
    };

    const pageTitle = document.getElementById("pageTitle");

    if (pageTitle) {
        pageTitle.innerText =
            titles[pageId] || "RK-CMS";
    }

    if (pageId === "dashboard") {
        updateDashboard();
    }

    if (pageId === "inventory") {
        renderInventory();
    }

    if (pageId === "consumption") {
        loadConsumption();
        populateConsumptionChemicals();
    }

    if (pageId === "reports") {
        updateReports();
    }
}


document.addEventListener("click", event => {

    const btn = event.target.closest("[data-page]");

    if (btn) {
        showPage(btn.dataset.page);
    }

});


/* =========================================================
   LOAD USER PROFILE
   ========================================================= */

async function loadProfile() {

    const {
        data,
        error
    } = await db
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

    if (error) {
        throw error;
    }

    /*
       Convert role to uppercase.

       ADMIN
       admin
       Admin

       will all become:

       ADMIN
    */

    currentProfile = {
        ...data,
        role: String(data.role || "")
            .trim()
            .toUpperCase()
    };

    const userInfo =
        document.getElementById("userInfo");

    if (userInfo) {

        userInfo.innerText =
            `👤 ${data.full_name || currentUser.email} • ${currentProfile.role}`;

    }

    const isAdmin =
        currentProfile.role === "ADMIN";

    document
        .querySelectorAll(".admin-only")
        .forEach(element => {

            element.classList.toggle(
                "hidden",
                !isAdmin
            );

        });

    document
        .querySelectorAll(".admin-only-page")
        .forEach(element => {

            element.classList.toggle(
                "hidden",
                !isAdmin
            );

        });
}


/* =========================================================
   LOAD CHEMICALS
   ========================================================= */

async function loadChemicals() {

    const {
        data,
        error
    } = await db
        .from("chemicals")
        .select("*")
        .order("created_at", {
            ascending: false
        });

    if (error) {
        throw error;
    }

    chemicals = data || [];

    updateDashboard();
    renderInventory();
    populateConsumptionChemicals();
    updateReports();
}


/* =========================================================
   LOAD CONSUMPTION
   ========================================================= */

async function loadConsumption() {

    const {
        data,
        error
    } = await db
        .from("consumption_logs")
        .select(
            "*, chemicals(chemical_name, chemical_code)"
        )
        .order("consumption_date", {
            ascending: false
        })
        .order("created_at", {
            ascending: false
        });

    if (error) {

        console.error(
            "Consumption load error:",
            error
        );

        return;
    }

    consumptionLogs = data || [];

    const table =
        document.getElementById("consumptionTable");

    if (!table) return;

    table.innerHTML =
        consumptionLogs.length

            ? consumptionLogs
                .map(log => `
                    <tr>
                        <td>
                            ${escapeHTML(log.consumption_date)}
                        </td>

                        <td>
                            ${escapeHTML(
                                log.chemicals?.chemical_code || ""
                            )}
                            -
                            ${escapeHTML(
                                log.chemicals?.chemical_name || ""
                            )}
                        </td>

                        <td>
                            ${escapeHTML(log.department)}
                        </td>

                        <td>
                            ${Number(log.quantity).toFixed(2)}
                            ${escapeHTML(log.unit)}
                        </td>

                        <td>
                            ${escapeHTML(
                                log.used_by || "-"
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                log.purpose || "-"
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                log.recorded_by || ""
                            )}
                        </td>
                    </tr>
                `)
                .join("")

            : `
                <tr>
                    <td
                        colspan="7"
                        style="text-align:center;padding:30px;"
                    >
                        No consumption records found.
                    </td>
                </tr>
            `;
}


/* =========================================================
   CONSUMPTION CHEMICAL DROPDOWN
   ========================================================= */

function populateConsumptionChemicals() {

    const select =
        document.getElementById(
            "consumptionChemical"
        );

    if (!select) return;

    select.innerHTML =
        '<option value="">Select Chemical</option>' +

        chemicals
            .map(chemical => `
                <option value="${escapeHTML(chemical.id)}">
                    ${escapeHTML(chemical.chemical_code)}
                    -
                    ${escapeHTML(chemical.chemical_name)}
                    (Stock:
                    ${Number(chemical.stock || 0)}
                    ${escapeHTML(chemical.unit || "")})
                </option>
            `)
            .join("");
}


const consumptionChemical =
    document.getElementById(
        "consumptionChemical"
    );

if (consumptionChemical) {

    consumptionChemical.addEventListener(
        "change",
        event => {

            const chemical =
                chemicals.find(
                    item =>
                        String(item.id) ===
                        String(event.target.value)
                );

            const unit =
                document.getElementById(
                    "consumptionUnit"
                );

            if (unit) {
                unit.value =
                    chemical?.unit || "";
            }
        }
    );
}


/* =========================================================
   ADD CHEMICAL
   ========================================================= */

const chemicalForm =
    document.getElementById("chemicalForm");

if (chemicalForm) {

    chemicalForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            if (
                currentProfile?.role !==
                "ADMIN"
            ) {

                alert(
                    "Admin access required."
                );

                return;
            }

            const nextCode =
                "CHM" +
                String(
                    chemicals.length + 1
                ).padStart(5, "0");

            const payload = {

                chemical_code:
                    nextCode,

                chemical_name:
                    document
                        .getElementById("chemicalName")
                        .value
                        .trim(),

                cas_no:
                    document
                        .getElementById("casNumber")
                        .value
                        .trim(),

                supplier:
                    document
                        .getElementById("supplier")
                        .value
                        .trim(),

                department:
                    document
                        .getElementById("department")
                        .value,

                hazard:
                    document
                        .getElementById("hazard")
                        .value,

                stock:
                    Number(
                        document
                            .getElementById("stock")
                            .value
                    ) || 0,

                unit:
                    document
                        .getElementById("unit")
                        .value,

                storage_location:
                    document
                        .getElementById("storage")
                        .value
                        .trim(),

                purchase_date:
                    document
                        .getElementById("purchaseDate")
                        .value || null,

                expiry_date:
                    document
                        .getElementById("expiryDate")
                        .value || null,

                sds_available:
                    document
                        .getElementById("sds")
                        .value === "Yes",

                ghs_available:
                    document
                        .getElementById("ghs")
                        .value === "Yes",

                remarks:
                    document
                        .getElementById("remarks")
                        .value
                        .trim(),

                created_by:
                    currentUser.id
            };


            const {
                error
            } = await db
                .from("chemicals")
                .insert(payload);


            if (error) {

                console.error(
                    "Add Chemical Error:",
                    error
                );

                alert(
                    "Unable to add chemical.\n\n" +
                    error.message
                );

                return;
            }


            alert(
                `Chemical added successfully.\n\nChemical ID: ${nextCode}`
            );


            event.target.reset();

            await loadChemicals();

            showPage("inventory");
        }
    );
}


/* =========================================================
   CONSUMPTION FORM
   ========================================================= */

const consumptionForm =
    document.getElementById(
        "consumptionForm"
    );

if (consumptionForm) {

    consumptionForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            const chemical =
                chemicals.find(
                    c =>
                        String(c.id) ===
                        String(
                            document.getElementById(
                                "consumptionChemical"
                            ).value
                        )
                );

            const qty =
                Number(
                    document.getElementById(
                        "consumptionQty"
                    ).value
                );


            if (!chemical) {

                alert(
                    "Select a chemical."
                );

                return;
            }


            if (qty <= 0) {

                alert(
                    "Enter a valid quantity."
                );

                return;
            }


            if (
                qty >
                Number(chemical.stock)
            ) {

                alert(
                    `Insufficient stock. Available: ${chemical.stock} ${chemical.unit}`
                );

                return;
            }


            const log = {

                chemical_id:
                    chemical.id,

                consumption_date:
                    document.getElementById(
                        "consumptionDate"
                    ).value,

                department:
                    document.getElementById(
                        "consumptionDepartment"
                    ).value,

                quantity:
                    qty,

                unit:
                    chemical.unit,

                used_by:
                    document.getElementById(
                        "consumptionUser"
                    ).value
                    .trim(),

                purpose:
                    document.getElementById(
                        "consumptionPurpose"
                    ).value
                    .trim(),

                remarks:
                    document.getElementById(
                        "consumptionRemarks"
                    ).value
                    .trim(),

                recorded_by:
                    currentUser.id
            };


            const {
                error: logError
            } = await db
                .from("consumption_logs")
                .insert(log);


            if (logError) {

                alert(
                    "Unable to save consumption.\n\n" +
                    logError.message
                );

                return;
            }


            const {
                error: stockError
            } = await db
                .from("chemicals")
                .update({
                    stock:
                        Number(chemical.stock) -
                        qty
                })
                .eq(
                    "id",
                    chemical.id
                );


            if (stockError) {

                alert(
                    "Consumption saved, but stock update failed:\n\n" +
                    stockError.message
                );

                return;
            }


            alert(
                "Consumption recorded successfully."
            );


            event.target.reset();

            const unit =
                document.getElementById(
                    "consumptionUnit"
                );

            if (unit) {
                unit.value = "";
            }


            await loadChemicals();

            await loadConsumption();
        }
    );
}


/* =========================================================
   DASHBOARD
   ========================================================= */

function updateDashboard() {

    const total =
        document.getElementById(
            "totalChemicals"
        );

    if (total) {
        total.innerText =
            chemicals.length;
    }


    const stock =
        document.getElementById(
            "stockChemicals"
        );

    if (stock) {

        stock.innerText =
            chemicals.filter(
                c =>
                    Number(c.stock) > 0
            ).length;
    }


    const hazardous =
        document.getElementById(
            "hazardousChemicals"
        );

    if (hazardous) {

        hazardous.innerText =
            chemicals.filter(
                c =>
                    c.hazard !==
                    "Non-Hazardous"
            ).length;
    }


    const expiry =
        document.getElementById(
            "expiryChemicals"
        );

    if (expiry) {

        expiry.innerText =
            chemicals.filter(
                isExpiryDue
            ).length;
    }


    renderRecent();
}


/* =========================================================
   EXPIRY
   ========================================================= */

function isExpiryDue(chemical) {

    if (!chemical.expiry_date) {
        return false;
    }

    const expiry =
        new Date(
            chemical.expiry_date
        );

    const today =
        new Date();

    today.setHours(
        0,
        0,
        0,
        0
    );

    return (
        (expiry - today) /
        86400000
    ) <= 30;
}


/* =========================================================
   CHEMICAL INVENTORY
   ========================================================= */

function renderInventory() {

    const search =
        (
            document.getElementById(
                "searchChemical"
            )?.value || ""
        ).toLowerCase();


    const department =
        document.getElementById(
            "departmentFilter"
        )?.value || "";


    const hazard =
        document.getElementById(
            "hazardFilter"
        )?.value || "";


    const table =
        document.getElementById(
            "inventoryTable"
        );


    if (!table) return;


    const filtered =
        chemicals.filter(
            chemical =>

                (
                    `${chemical.chemical_name || ""}
                    ${chemical.chemical_code || ""}
                    ${chemical.cas_no || ""}`
                )
                .toLowerCase()
                .includes(search)

                &&

                (
                    !department ||
                    chemical.department ===
                    department
                )

                &&

                (
                    !hazard ||
                    chemical.hazard ===
                    hazard
                )
        );


    table.innerHTML =
        filtered.length

            ? filtered
                .map(chemical => `

                    <tr>

                        <td>
                            <strong>
                                ${escapeHTML(
                                    chemical.chemical_code
                                )}
                            </strong>
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.chemical_name
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.cas_no || ""
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.department || ""
                            )}
                        </td>

                        <td>
                            <span
                                class="status ${hazardClass(
                                    chemical.hazard
                                )}"
                            >
                                ${escapeHTML(
                                    chemical.hazard || ""
                                )}
                            </span>
                        </td>

                        <td>
                            ${Number(
                                chemical.stock || 0
                            ).toFixed(2)}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.unit || ""
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.storage_location || ""
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.expiry_date || "-"
                            )}
                        </td>

                        <td>

                            ${
                                currentProfile?.role === "ADMIN"

                                ?

                                `
                                <button
                                    type="button"
                                    class="delete-btn"
                                    onclick="deleteChemical('${escapeJS(
                                        chemical.id
                                    )}')"
                                >
                                    Delete
                                </button>
                                `

                                :

                                `
                                <span class="readonly-note">
                                    View only
                                </span>
                                `
                            }

                        </td>

                    </tr>

                `)
                .join("")

            :

            `
            <tr>
                <td
                    colspan="10"
                    style="text-align:center;padding:30px;"
                >
                    No chemical records found.
                </td>
            </tr>
            `;
}


/* =========================================================
   RECENT CHEMICALS
   ========================================================= */

function renderRecent() {

    const table =
        document.getElementById(
            "recentTable"
        );

    if (!table) return;


    const recent =
        chemicals.slice(0, 5);


    table.innerHTML =
        recent.length

            ? recent
                .map(chemical => `

                    <tr>

                        <td>
                            ${escapeHTML(
                                chemical.chemical_code
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.chemical_name
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                chemical.department || ""
                            )}
                        </td>

                        <td>
                            ${Number(
                                chemical.stock || 0
                            ).toFixed(2)}
                            ${escapeHTML(
                                chemical.unit || ""
                            )}
                        </td>

                        <td>
                            <span
                                class="status ${hazardClass(
                                    chemical.hazard
                                )}"
                            >
                                ${escapeHTML(
                                    chemical.hazard || ""
                                )}
                            </span>
                        </td>

                    </tr>

                `)
                .join("")

            :

            `
            <tr>
                <td
                    colspan="5"
                    style="text-align:center;padding:25px;"
                >
                    No chemical records available.
                </td>
            </tr>
            `;
}


/* =========================================================
   DELETE CHEMICAL
   ========================================================= */

async function deleteChemical(id) {

    console.log(
        "RKCMS Delete clicked. Chemical UUID:",
        id
    );


    /*
       SECURITY CHECK
    */

    if (
        currentProfile?.role !==
        "ADMIN"
    ) {

        alert(
            "Admin access required."
        );

        return;
    }


    /*
       FIND CHEMICAL
    */

    const chemical =
        chemicals.find(
            item =>
                String(item.id) ===
                String(id)
        );


    if (!chemical) {

        alert(
            "Chemical record not found."
        );

        return;
    }


    const chemicalName =
        chemical.chemical_name ||
        "Unknown Chemical";


    const chemicalCode =
        chemical.chemical_code ||
        "N/A";


    try {

        /*
           CHECK CONSUMPTION HISTORY
        */

        const {
            count,
            error: historyError
        } = await db
            .from("consumption_logs")
            .select(
                "id",
                {
                    count: "exact",
                    head: true
                }
            )
            .eq(
                "chemical_id",
                id
            );


        if (historyError) {

            console.error(
                "Consumption history error:",
                historyError
            );


            alert(
                "Unable to check consumption history.\n\n" +
                historyError.message +
                "\n\n" +
                "If this is an RLS error, create a SELECT policy for authenticated users on consumption_logs."
            );

            return;
        }


        /*
           DO NOT DELETE IF HISTORY EXISTS
        */

        if (
            Number(count || 0) > 0
        ) {

            alert(

                "Cannot Delete Chemical\n\n" +

                chemicalCode +
                " - " +
                chemicalName +

                "\n\n" +

                "This chemical has " +
                count +
                " consumption record(s).\n\n" +

                "The chemical cannot be permanently deleted because consumption history must be retained."

            );

            return;
        }


        /*
           CONFIRM
        */

        const confirmed =
            confirm(

                "Are you sure you want to delete this chemical?\n\n" +

                chemicalCode +
                " - " +
                chemicalName

            );


        if (!confirmed) {
            return;
        }


        /*
           DELETE FROM SUPABASE
        */

        const {
            data,
            error
        } = await db
            .from("chemicals")
            .delete()
            .eq(
                "id",
                id
            )
            .select();


        /*
           HANDLE ERROR
        */

        if (error) {

            console.error(
                "Delete chemical error:",
                error
            );


            alert(

                "Unable to delete chemical.\n\n" +

                error.message

            );

            return;
        }


        /*
           VERIFY DELETE
        */

        if (
            !data ||
            data.length === 0
        ) {

            alert(

                "No chemical was deleted.\n\n" +

                "Supabase returned 0 deleted rows."

            );

            return;
        }


        /*
           SUCCESS
        */

        alert(

            "Chemical deleted successfully.\n\n" +

            chemicalCode +
            " - " +
            chemicalName

        );


        /*
           RELOAD DATA
        */

        await loadChemicals();

        showPage(
            "inventory"
        );

    }

    catch (error) {

        console.error(
            "Unexpected delete error:",
            error
        );


        alert(

            "Unexpected error while deleting the chemical.\n\n" +

            error.message

        );
    }
}


/* =========================================================
   REPORTS
   ========================================================= */

function updateReports() {

    const sdsAvailable =
        document.getElementById(
            "sdsAvailable"
        );

    const sdsMissing =
        document.getElementById(
            "sdsMissing"
        );

    const ghsMissing =
        document.getElementById(
            "ghsMissing"
        );


    if (sdsAvailable) {

        sdsAvailable.innerText =
            chemicals.filter(
                chemical =>
                    chemical.sds_available === true
                    ||
                    String(
                        chemical.sds_available
                    ).toLowerCase() ===
                    "yes"
            ).length;
    }


    if (sdsMissing) {

        sdsMissing.innerText =
            chemicals.filter(
                chemical =>
                    chemical.sds_available === false
                    ||
                    String(
                        chemical.sds_available
                    ).toLowerCase() ===
                    "no"
            ).length;
    }


    if (ghsMissing) {

        ghsMissing.innerText =
            chemicals.filter(
                chemical =>
                    chemical.ghs_available === false
                    ||
                    String(
                        chemical.ghs_available
                    ).toLowerCase() ===
                    "no"
            ).length;
    }
}


/* =========================================================
   HAZARD CLASS
   ========================================================= */

function hazardClass(hazard) {

    if (
        hazard ===
        "Non-Hazardous"
    ) {

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


/* =========================================================
   CSV
   ========================================================= */

function csvDownload(
    filename,
    headers,
    rows
) {

    const csv =
        [headers, ...rows]
            .map(
                row =>
                    row
                        .map(
                            value =>
                                `"${String(
                                    value ?? ""
                                ).replace(
                                    /"/g,
                                    '""'
                                )}"`
                        )
                        .join(",")
            )
            .join("\n");


    const url =
        URL.createObjectURL(
            new Blob(
                [csv],
                {
                    type:
                        "text/csv;charset=utf-8;"
                }
            )
        );


    const link =
        document.createElement(
            "a"
        );


    link.href = url;

    link.download =
        filename;

    link.click();

    URL.revokeObjectURL(
        url
    );
}


function exportCSV() {

    csvDownload(

        "Chemical_Inventory.csv",

        [
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
        ],

        chemicals.map(
            chemical => [

                chemical.chemical_code,
                chemical.chemical_name,
                chemical.cas_no,
                chemical.supplier,
                chemical.department,
                chemical.hazard,
                chemical.stock,
                chemical.unit,
                chemical.storage_location,
                chemical.purchase_date,
                chemical.expiry_date,
                chemical.sds_available,
                chemical.ghs_available,
                chemical.remarks

            ]
        )
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

        consumptionLogs.map(
            log => [

                log.consumption_date,

                log.chemicals
                    ?.chemical_name,

                log.department,

                log.quantity,

                log.unit,

                log.used_by,

                log.purpose,

                log.remarks,

                log.recorded_by

            ]
        )
    );
}


/* =========================================================
   SEARCH / FILTER
   ========================================================= */

const searchChemical =
    document.getElementById(
        "searchChemical"
    );

if (searchChemical) {

    searchChemical.addEventListener(
        "input",
        renderInventory
    );
}


const departmentFilter =
    document.getElementById(
        "departmentFilter"
    );

if (departmentFilter) {

    departmentFilter.addEventListener(
        "change",
        renderInventory
    );
}


const hazardFilter =
    document.getElementById(
        "hazardFilter"
    );

if (hazardFilter) {

    hazardFilter.addEventListener(
        "change",
        renderInventory
    );
}


/* =========================================================
   LOGIN
   ========================================================= */

const loginForm =
    document.getElementById(
        "loginForm"
    );


if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();


            const errorBox =
                document.getElementById(
                    "loginError"
                );


            const button =
                event.target.querySelector(
                    "button[type='submit']"
                );


            if (errorBox) {
                errorBox.innerText = "";
            }


            if (button) {

                button.disabled =
                    true;

                const span =
                    button.querySelector(
                        "span:first-child"
                    );

                if (span) {
                    span.innerText =
                        "Signing in...";
                }
            }


            try {

                const {
                    data,
                    error
                } = await db.auth
                    .signInWithPassword({

                        email:
                            document
                                .getElementById(
                                    "loginEmail"
                                )
                                .value
                                .trim(),

                        password:
                            document
                                .getElementById(
                                    "loginPassword"
                                )
                                .value

                    });


                if (error) {
                    throw error;
                }


                currentUser =
                    data.user;


                await startApp();

            }

            catch (error) {

                console.error(
                    "Login Error:",
                    error
                );


                if (errorBox) {

                    errorBox.innerText =
                        error.message ||
                        "Invalid email or password.";

                }
            }

            finally {

                if (button) {

                    button.disabled =
                        false;

                    const span =
                        button.querySelector(
                            "span:first-child"
                        );

                    if (span) {
                        span.innerText =
                            "Sign In";
                    }
                }
            }
        }
    );
}


/* =========================================================
   PASSWORD SHOW / HIDE
   ========================================================= */

const togglePassword =
    document.getElementById(
        "togglePassword"
    );


if (togglePassword) {

    togglePassword.addEventListener(
        "click",
        function () {

            const input =
                document.getElementById(
                    "loginPassword"
                );


            if (!input) return;


            const isPassword =
                input.type ===
                "password";


            input.type =
                isPassword
                    ? "text"
                    : "password";


            this.innerText =
                isPassword
                    ? "Hide"
                    : "Show";
        }
    );
}


/* =========================================================
   LOGOUT
   ========================================================= */

const logoutBtn =
    document.getElementById(
        "logoutBtn"
    );


if (logoutBtn) {

    logoutBtn.addEventListener(
        "click",
        async () => {

            await db.auth.signOut();

            location.reload();
        }
    );
}


/* =========================================================
   START APPLICATION
   ========================================================= */

async function startApp() {

    try {

        const appShell =
            document.getElementById(
                "appShell"
            );


        if (appShell) {

            appShell.classList.add(
                "hidden"
            );
        }


        await loadProfile();

        await loadChemicals();

        await loadConsumption();


        const loginPage =
            document.getElementById(
                "loginPage"
            );


        if (loginPage) {

            loginPage.classList.add(
                "hidden"
            );
        }


        if (appShell) {

            appShell.classList.remove(
                "hidden"
            );
        }


        showPage(
            "dashboard"
        );

    }

    catch (error) {

        console.error(
            "Start App Error:",
            error
        );


        const loginPage =
            document.getElementById(
                "loginPage"
            );


        const appShell =
            document.getElementById(
                "appShell"
            );


        if (loginPage) {

            loginPage.classList.remove(
                "hidden"
            );
        }


        if (appShell) {

            appShell.classList.add(
                "hidden"
            );
        }


        const loginError =
            document.getElementById(
                "loginError"
            );


        if (loginError) {

            loginError.innerText =
                error.message ||
                "Unable to load your account.";
        }


        await db.auth.signOut();
    }
}


/* =========================================================
   INITIALIZE APPLICATION
   ========================================================= */

(async function init() {

    fillDepartmentSelects();


    const consumptionDate =
        document.getElementById(
            "consumptionDate"
        );


    if (consumptionDate) {

        consumptionDate.value =
            new Date()
                .toISOString()
                .slice(0, 10);
    }


    const {
        data
    } = await db.auth.getSession();


    if (data.session) {

        currentUser =
            data.session.user;


        await startApp();
    }

})();


/* =========================================================
   RESPONSIVE NAVIGATION
   ========================================================= */

(function initResponsiveNavigation() {

    const sidebar =
        document.querySelector(
            ".sidebar"
        );


    const menuBtn =
        document.getElementById(
            "mobileMenuBtn"
        );


    const overlay =
        document.getElementById(
            "sidebarOverlay"
        );


    if (
        !sidebar ||
        !menuBtn ||
        !overlay
    ) {

        return;
    }


    function closeSidebar() {

        sidebar.classList.remove(
            "open"
        );

        overlay.classList.remove(
            "show"
        );

        menuBtn.setAttribute(
            "aria-expanded",
            "false"
        );
    }


    function toggleSidebar() {

        const isOpen =
            sidebar.classList.toggle(
                "open"
            );


        overlay.classList.toggle(
            "show",
            isOpen
        );


        menuBtn.setAttribute(
            "aria-expanded",
            String(isOpen)
        );
    }


    menuBtn.addEventListener(
        "click",
        toggleSidebar
    );


    overlay.addEventListener(
        "click",
        closeSidebar
    );


    document.addEventListener(
        "click",
        event => {

            const pageButton =
                event.target.closest(
                    "[data-page]"
                );


            if (
                pageButton &&
                window.innerWidth <= 767
            ) {

                closeSidebar();
            }
        }
    );


    window.addEventListener(
        "resize",
        () => {

            if (
                window.innerWidth > 767
            ) {

                closeSidebar();
            }
        }
    );

})();
