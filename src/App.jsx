import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API =
  import.meta.env.VITE_API_URL ||
  "https://script.google.com/macros/s/AKfycbwIxLeglf9YlAPQ9fhga_jF15ZbIcdU4gvKhQfwI1qrwuTf5SwxMXYy1Wa8by9-kXnC/exec";

const LOCAL_STORAGE_KEY = "inventoryTrackerDraftData_v1";

export default function App() {
  const [savedInventory, setSavedInventory] = useState([]);
  const [workingInventory, setWorkingInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [selectedItemId, setSelectedItemId] = useState("");
  const [editingNotes, setEditingNotes] = useState("");
  const [editingCondition, setEditingCondition] = useState("");
  const [editingStatus, setEditingStatus] = useState("Active");

  const [loadingApp, setLoadingApp] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasLoadedLocalDraft, setHasLoadedLocalDraft] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  function saveDraftToLocalStorage(inventory) {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        workingInventory: inventory,
        savedAt: new Date().toISOString(),
      })
    );
  }

  function clearDraftFromLocalStorage() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  function buildLocalItemId() {
    return `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  function getCategoryName(code) {
    const match = categories.find(
      (c) => String(c["Category Code"]).padStart(2, "0") === String(code).padStart(2, "0")
    );
    return match ? match["Category Name"] : "";
  }

  function getCategoryShort(code) {
    const match = categories.find(
      (c) => String(c["Category Code"]).padStart(2, "0") === String(code).padStart(2, "0")
    );
    return match ? match["Short Code"] : "";
  }

  function getLocationName(code) {
    const match = locations.find(
      (l) => String(l["Location Code"]).padStart(2, "0") === String(code).padStart(2, "0")
    );
    return match ? match["Location Name"] : "";
  }

  function getLocationShort(code) {
    const match = locations.find(
      (l) => String(l["Location Code"]).padStart(2, "0") === String(code).padStart(2, "0")
    );
    return match ? match["Short Code"] : "";
  }

  function buildBarcode(categoryCode, locationCode, serialNumber) {
    return `${String(categoryCode).padStart(2, "0")}${String(locationCode).padStart(2, "0")}${String(
      serialNumber
    ).padStart(4, "0")}`;
  }

  function buildReadableId(categoryCode, locationCode, serialNumber) {
    const catShort = getCategoryShort(categoryCode);
    const locShort = getLocationShort(locationCode);
    return `${catShort}-${locShort}-${String(serialNumber).padStart(4, "0")}`;
  }

  function getNextSerialNumber(categoryCode, locationCode, inventory) {
    const matches = inventory
      .filter(
        (item) =>
          String(item["Category Code"]).padStart(2, "0") === String(categoryCode).padStart(2, "0") &&
          String(item["Location Code"]).padStart(2, "0") === String(locationCode).padStart(2, "0")
      )
      .map((item) => parseInt(item["Serial Number"], 10))
      .filter((num) => !Number.isNaN(num));

    const next = matches.length > 0 ? Math.max(...matches) + 1 : 1;
    return String(next).padStart(4, "0");
  }

  function normalizeInventoryRows(rows) {
    return rows.map((item, index) => ({
      ...item,
      localId: item.localId || item.Barcode || item["Readable ID"] || `row-${index}`,
      isLocalOnly: Boolean(item.isLocalOnly),
    }));
  }

  async function loadAppData() {
    try {
      setLoadingApp(true);
      setErrorMessage("");

      const res = await fetch(API + "?action=getAppData");
      const data = await res.json();

      const inventoryRows = normalizeInventoryRows(data.inventory || []);
      const categoryRows = data.categories || [];
      const locationRows = data.locations || [];

      setSavedInventory(inventoryRows);
      setCategories(categoryRows);
      setLocations(locationRows);

      if (categoryRows.length > 0 && !category) {
        setCategory(String(categoryRows[0]["Category Code"]).padStart(2, "0"));
      }

      if (locationRows.length > 0 && !location) {
        setLocation(String(locationRows[0]["Location Code"]).padStart(2, "0"));
      }

      const localDraftRaw = localStorage.getItem(LOCAL_STORAGE_KEY);

      if (localDraftRaw) {
        try {
          const localDraft = JSON.parse(localDraftRaw);
          if (localDraft.workingInventory && Array.isArray(localDraft.workingInventory)) {
            setWorkingInventory(normalizeInventoryRows(localDraft.workingInventory));
          } else {
            setWorkingInventory(inventoryRows);
          }
        } catch {
          setWorkingInventory(inventoryRows);
        }
      } else {
        setWorkingInventory(inventoryRows);
      }
    } catch (error) {
      console.error("Failed to load app data:", error);
      setErrorMessage("Failed to load app data.");
    } finally {
      setLoadingApp(false);
      setHasLoadedLocalDraft(true);
    }
  }

  useEffect(() => {
    loadAppData();
  }, []);

  useEffect(() => {
    if (!hasLoadedLocalDraft) return;
    saveDraftToLocalStorage(workingInventory);
  }, [workingInventory, hasLoadedLocalDraft]);

  const pendingSummary = useMemo(() => {
    const savedMap = new Map(savedInventory.map((item) => [item.localId, item]));
    let added = 0;
    let edited = 0;

    for (const item of workingInventory) {
      if (item.isLocalOnly) {
        added += 1;
      } else {
        const saved = savedMap.get(item.localId);
        if (!saved) continue;

        const fieldsToCheck = [
          "Item Name",
          "Category Code",
          "Category Name",
          "Location Code",
          "Location Name",
          "Serial Number",
          "Barcode",
          "Readable ID",
          "Status",
          "Condition",
          "Notes",
        ];

        const changed = fieldsToCheck.some(
          (field) => String(item[field] ?? "") !== String(saved[field] ?? "")
        );

        if (changed) {
          edited += 1;
        }
      }
    }

    return {
      added,
      edited,
      total: added + edited,
    };
  }, [workingInventory, savedInventory]);

  const filteredInventory = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) return workingInventory;

    return workingInventory.filter((item) => {
      return [
        item["Item Name"],
        item["Readable ID"],
        item["Barcode"],
        item["Category Name"],
        item["Location Name"],
        item["Status"],
        item["Condition"],
        item["Notes"],
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [workingInventory, searchTerm]);

  const selectedItem = useMemo(() => {
    return workingInventory.find((item) => item.localId === selectedItemId) || null;
  }, [workingInventory, selectedItemId]);

  useEffect(() => {
    if (selectedItem) {
      setEditingNotes(selectedItem.Notes || "");
      setEditingCondition(selectedItem.Condition || "");
      setEditingStatus(selectedItem.Status || "Active");
    } else {
      setEditingNotes("");
      setEditingCondition("");
      setEditingStatus("Active");
    }
  }, [selectedItem]);

  function addItemLocally() {
    if (!name.trim()) {
      alert("Please enter an item name.");
      return;
    }

    if (!category || !location) {
      alert("Please wait for categories and locations to load.");
      return;
    }

    const count = Number(quantity);

    if (!Number.isInteger(count) || count < 1) {
      alert("Number of items must be a whole number of 1 or more.");
      return;
    }

    const inventoryCopy = [...workingInventory];
    const newItems = [];

    for (let i = 0; i < count; i++) {
      const serialNumber = getNextSerialNumber(category, location, inventoryCopy);
      const barcode = buildBarcode(category, location, serialNumber);
      const readableId = buildReadableId(category, location, serialNumber);

      const newItem = {
        localId: buildLocalItemId(),
        rowNumber: "",
        "Item Name": name.trim(),
        "Category Code": String(category).padStart(2, "0"),
        "Category Name": getCategoryName(category),
        "Location Code": String(location).padStart(2, "0"),
        "Location Name": getLocationName(location),
        "Serial Number": serialNumber,
        Barcode: barcode,
        "Readable ID": readableId,
        Quantity: 1,
        Status: "Active",
        Condition: "Good",
        Notes: "",
        "Last Updated": new Date().toISOString(),
        isLocalOnly: true,
      };

      newItems.push(newItem);
      inventoryCopy.push(newItem);
    }

    const updatedInventory = [...newItems.reverse(), ...workingInventory];
    setWorkingInventory(updatedInventory);

    if (newItems.length > 0) {
      setSelectedItemId(newItems[newItems.length - 1].localId);
    }

    setName("");
    setQuantity(1);
  }

  function updateSelectedItemLocally() {
    if (!selectedItem) return;

    const updatedInventory = workingInventory.map((item) => {
      if (item.localId !== selectedItem.localId) return item;

      return {
        ...item,
        Notes: editingNotes,
        Condition: editingCondition,
        Status: editingStatus,
        "Last Updated": new Date().toISOString(),
      };
    });

    setWorkingInventory(updatedInventory);
  }

  function discardLocalChanges() {
    const confirmed = window.confirm("Discard all unpublished local changes?");
    if (!confirmed) return;

    setWorkingInventory(savedInventory);
    clearDraftFromLocalStorage();
    setSelectedItemId("");
    setErrorMessage("");
  }

  async function publishChanges() {
    if (pendingSummary.total === 0) {
      alert("There are no unpublished changes.");
      return;
    }

    try {
      setPublishing(true);
      setErrorMessage("");

      const newItems = workingInventory
        .filter((item) => item.isLocalOnly)
        .map((item) => ({
          itemName: item["Item Name"],
          categoryCode: item["Category Code"],
          locationCode: item["Location Code"],
          quantity: 1,
          status: item.Status || "Active",
          condition: item.Condition || "",
          notes: item.Notes || "",
        }));

      const updatedItems = workingInventory
        .filter((item) => !item.isLocalOnly)
        .filter((item) => {
          const saved = savedInventory.find((s) => s.localId === item.localId);
          if (!saved) return false;

          const fieldsToCheck = [
            "Item Name",
            "Category Code",
            "Category Name",
            "Location Code",
            "Location Name",
            "Serial Number",
            "Barcode",
            "Readable ID",
            "Status",
            "Condition",
            "Notes",
          ];

          return fieldsToCheck.some(
            (field) => String(item[field] ?? "") !== String(saved[field] ?? "")
          );
        })
        .map((item) => ({
          rowNumber: item.rowNumber,
          itemName: item["Item Name"],
          categoryCode: item["Category Code"],
          categoryName: item["Category Name"],
          locationCode: item["Location Code"],
          locationName: item["Location Name"],
          serialNumber: item["Serial Number"],
          barcode: item.Barcode,
          readableId: item["Readable ID"],
          quantity: 1,
          status: item.Status,
          condition: item.Condition,
          notes: item.Notes,
        }));

      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "publishChanges",
          payload: {
            newItems,
            updatedItems,
          },
        }),
      });

      const text = await res.text();

      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Server returned invalid response.");
      }

      if (!res.ok || data.success === false) {
        throw new Error(data.message || "Failed to publish changes.");
      }

      clearDraftFromLocalStorage();
      await loadAppData();
      alert("Changes published successfully.");
    } catch (error) {
      console.error("Publish error:", error);
      setErrorMessage(error.message || "Failed to publish changes.");
      alert(error.message || "Failed to publish changes.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Allen County AV Inventory</p>
          <h1>Inventory Tracker</h1>
          <p className="subtext">
            Local draft mode is enabled. Changes stay in your browser until you publish them.
          </p>
        </div>

        <div className="topbar-actions">
          <div className="stat-pill">
            <span className="stat-pill-label">New</span>
            <span className="stat-pill-value">{pendingSummary.added}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-pill-label">Edited</span>
            <span className="stat-pill-value">{pendingSummary.edited}</span>
          </div>
          <button
            className="button button-primary"
            onClick={publishChanges}
            disabled={publishing || pendingSummary.total === 0}
          >
            {publishing ? "Publishing..." : "Publish Changes"}
          </button>
        </div>
      </header>

      {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

      <div className="dashboard-grid">
        <aside className="sidebar">
          <section className="panel">
            <div className="panel-header">
              <h2>Add Items</h2>
              <p>Create individually tracked assets with unique serials.</p>
            </div>

            <div className="form-group">
              <label>Item Name</label>
              <input
                className="input"
                placeholder="Shure ULXD4 Receiver"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Category</label>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={loadingApp}
              >
                <option value="">Select category</option>
                {categories.map((c, i) => (
                  <option key={i} value={String(c["Category Code"]).padStart(2, "0")}>
                    {c["Category Name"]} ({String(c["Category Code"]).padStart(2, "0")})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Location</label>
              <select
                className="input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={loadingApp}
              >
                <option value="">Select location</option>
                {locations.map((l, i) => (
                  <option key={i} value={String(l["Location Code"]).padStart(2, "0")}>
                    {l["Location Name"]} ({String(l["Location Code"]).padStart(2, "0")})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Number of Items to Create</label>
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <button className="button button-dark button-full" onClick={addItemLocally} disabled={loadingApp}>
              Add Locally
            </button>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Unpublished Changes</h2>
              <p>Keep working quickly, then push everything at once.</p>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-label">New Items</span>
                <span className="summary-value">{pendingSummary.added}</span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Edited Items</span>
                <span className="summary-value">{pendingSummary.edited}</span>
              </div>
            </div>

            <button
              className="button button-primary button-full"
              onClick={publishChanges}
              disabled={publishing || pendingSummary.total === 0}
            >
              {publishing ? "Publishing..." : "Publish Changes"}
            </button>

            <button
              className="button button-secondary button-full"
              onClick={discardLocalChanges}
              disabled={publishing || pendingSummary.total === 0}
            >
              Discard Local Changes
            </button>
          </section>
        </aside>

        <main className="main-content">
          <section className="panel inventory-panel">
            <div className="inventory-header">
              <div>
                <h2>Inventory</h2>
                <p>Search and select an item to edit locally.</p>
              </div>

              <input
                className="input search-input"
                placeholder="Search items, IDs, barcodes, notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="inventory-scroll">
              {loadingApp ? (
                <div className="empty-state">Loading inventory...</div>
              ) : filteredInventory.length === 0 ? (
                <div className="empty-state">No inventory matched your search.</div>
              ) : (
                <div className="inventory-list">
                  {filteredInventory.map((item) => (
                    <button
                      key={item.localId}
                      className={`inventory-card ${selectedItemId === item.localId ? "selected" : ""} ${
                        item.isLocalOnly ? "new-item" : ""
                      }`}
                      onClick={() => setSelectedItemId(item.localId)}
                    >
                      <div className="inventory-card-top">
                        <div>
                          <h3>{item["Item Name"]}</h3>
                          <div className="meta-row">
                            <span className="badge badge-id">{item["Readable ID"]}</span>
                            <span className="badge badge-barcode">{item.Barcode}</span>
                          </div>
                        </div>

                        <div className="inventory-card-right">
                          {item.isLocalOnly && <span className="badge badge-new">NEW</span>}
                          <span className={`badge badge-status status-${String(item.Status || "").toLowerCase()}`}>
                            {item.Status}
                          </span>
                        </div>
                      </div>

                      <div className="detail-grid">
                        <div>
                          <span className="detail-label">Category</span>
                          <span className="detail-value">{item["Category Name"]}</span>
                        </div>
                        <div>
                          <span className="detail-label">Location</span>
                          <span className="detail-value">{item["Location Name"]}</span>
                        </div>
                        <div>
                          <span className="detail-label">Condition</span>
                          <span className="detail-value">{item.Condition || "—"}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Edit Selected Item</h2>
              <p>Changes stay local until you publish.</p>
            </div>

            {!selectedItem ? (
              <div className="empty-state">Select an item from the inventory list.</div>
            ) : (
              <div className="editor-layout">
                <div className="selected-item-summary">
                  <h3>{selectedItem["Item Name"]}</h3>
                  <div className="summary-lines">
                    <div><strong>Readable ID:</strong> {selectedItem["Readable ID"]}</div>
                    <div><strong>Barcode:</strong> {selectedItem.Barcode}</div>
                    <div><strong>Category:</strong> {selectedItem["Category Name"]}</div>
                    <div><strong>Location:</strong> {selectedItem["Location Name"]}</div>
                  </div>
                </div>

                <div className="editor-fields">
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      className="input"
                      value={editingStatus}
                      onChange={(e) => setEditingStatus(e.target.value)}
                    >
                      <option value="Active">Active</option>
                      <option value="Missing">Missing</option>
                      <option value="Retired">Retired</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Condition</label>
                    <input
                      className="input"
                      value={editingCondition}
                      onChange={(e) => setEditingCondition(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      className="input textarea"
                      value={editingNotes}
                      onChange={(e) => setEditingNotes(e.target.value)}
                    />
                  </div>

                  <button className="button button-dark" onClick={updateSelectedItemLocally}>
                    Save Local Edit
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
