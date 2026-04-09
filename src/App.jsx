import { useEffect, useMemo, useState } from "react";

const API =
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
      alert("Quantity must be a whole number of 1 or more.");
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
    <div
      style={{
        padding: "24px",
        fontFamily: "Arial, sans-serif",
        maxWidth: "1200px",
        margin: "0 auto",
        backgroundColor: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "8px" }}>Inventory Tracker</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Local draft mode enabled. Changes are saved in your browser until you publish them.
      </p>

      {errorMessage && (
        <div
          style={{
            marginBottom: "20px",
            padding: "12px 16px",
            borderRadius: "8px",
            backgroundColor: "#ffe5e5",
            color: "#8a1f1f",
            border: "1px solid #f0b3b3",
          }}
        >
          {errorMessage}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "360px 1fr",
          gap: "20px",
          alignItems: "start",
        }}
      >
        <div>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "20px",
              marginBottom: "20px",
              backgroundColor: "white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Add Item Locally</h2>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                Item Name
              </label>
              <input
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  boxSizing: "border-box",
                }}
                placeholder="Item name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                Category
              </label>
              <select
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  boxSizing: "border-box",
                }}
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

            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                Location
              </label>
              <select
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  boxSizing: "border-box",
                }}
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

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                Number of Items to Create
              </label>
              <input
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  boxSizing: "border-box",
                }}
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <button
              onClick={addItemLocally}
              disabled={loadingApp}
              style={{
                padding: "10px 16px",
                border: "none",
                borderRadius: "8px",
                backgroundColor: "#111",
                color: "white",
                cursor: loadingApp ? "not-allowed" : "pointer",
                width: "100%",
              }}
            >
              Add Locally
            </button>
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "20px",
              backgroundColor: "white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Unpublished Changes</h2>
            <div style={{ marginBottom: "8px" }}>
              <strong>New items:</strong> {pendingSummary.added}
            </div>
            <div style={{ marginBottom: "16px" }}>
              <strong>Edited items:</strong> {pendingSummary.edited}
            </div>

            <button
              onClick={publishChanges}
              disabled={publishing || pendingSummary.total === 0}
              style={{
                padding: "10px 16px",
                border: "none",
                borderRadius: "8px",
                backgroundColor:
                  publishing || pendingSummary.total === 0 ? "#777" : "#0b6e4f",
                color: "white",
                cursor:
                  publishing || pendingSummary.total === 0 ? "not-allowed" : "pointer",
                width: "100%",
                marginBottom: "10px",
              }}
            >
              {publishing ? "Publishing..." : "Publish Changes"}
            </button>

            <button
              onClick={discardLocalChanges}
              disabled={publishing || pendingSummary.total === 0}
              style={{
                padding: "10px 16px",
                border: "1px solid #ccc",
                borderRadius: "8px",
                backgroundColor: "white",
                color: "#111",
                cursor:
                  publishing || pendingSummary.total === 0 ? "not-allowed" : "pointer",
                width: "100%",
              }}
            >
              Discard Local Changes
            </button>
          </div>
        </div>

        <div>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "20px",
              marginBottom: "20px",
              backgroundColor: "white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Inventory</h2>

            {loadingApp ? (
              <p>Loading inventory...</p>
            ) : workingInventory.length === 0 ? (
              <p>No inventory found.</p>
            ) : (
              workingInventory.map((item) => (
                <div
                  key={item.localId}
                  onClick={() => setSelectedItemId(item.localId)}
                  style={{
                    border: selectedItemId === item.localId ? "2px solid #111" : "1px solid #ddd",
                    borderRadius: "10px",
                    marginBottom: "12px",
                    padding: "14px",
                    backgroundColor: item.isLocalOnly ? "#eefaf5" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "17px" }}>
                        {item["Item Name"]}
                      </div>
                      <div style={{ marginTop: "6px" }}>
                        <strong>Readable ID:</strong> {item["Readable ID"]}
                      </div>
                      <div>
                        <strong>Barcode:</strong> {item.Barcode}
                      </div>
                      <div>
                        <strong>Category:</strong> {item["Category Name"]}
                      </div>
                      <div>
                        <strong>Location:</strong> {item["Location Name"]}
                      </div>
                      <div>
                        <strong>Status:</strong> {item.Status}
                      </div>
                    </div>

                    <div>
                      {item.isLocalOnly && (
                        <div
                          style={{
                            fontSize: "12px",
                            padding: "6px 8px",
                            borderRadius: "999px",
                            backgroundColor: "#d9f5e8",
                            color: "#0b6e4f",
                            fontWeight: "bold",
                          }}
                        >
                          NEW
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "20px",
              backgroundColor: "white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Edit Selected Item Locally</h2>

            {!selectedItem ? (
              <p>Select an item from the list.</p>
            ) : (
              <>
                <div style={{ marginBottom: "12px" }}>
                  <strong>{selectedItem["Item Name"]}</strong>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                    Status
                  </label>
                  <select
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid #ccc",
                      boxSizing: "border-box",
                    }}
                    value={editingStatus}
                    onChange={(e) => setEditingStatus(e.target.value)}
                  >
                    <option value="Active">Active</option>
                    <option value="Missing">Missing</option>
                    <option value="Retired">Retired</option>
                  </select>
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                    Condition
                  </label>
                  <input
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid #ccc",
                      boxSizing: "border-box",
                    }}
                    value={editingCondition}
                    onChange={(e) => setEditingCondition(e.target.value)}
                  />
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: "bold" }}>
                    Notes
                  </label>
                  <textarea
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid #ccc",
                      boxSizing: "border-box",
                      minHeight: "100px",
                      resize: "vertical",
                    }}
                    value={editingNotes}
                    onChange={(e) => setEditingNotes(e.target.value)}
                  />
                </div>

                <button
                  onClick={updateSelectedItemLocally}
                  style={{
                    padding: "10px 16px",
                    border: "none",
                    borderRadius: "8px",
                    backgroundColor: "#111",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Save Local Edit
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}