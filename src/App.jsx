import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import JsBarcode from "jsbarcode";

const API =
  import.meta.env.VITE_API_URL ||
  "https://script.google.com/macros/s/AKfycbwIxLeglf9YlAPQ9fhga_jF15ZbIcdU4gvKhQfwI1qrwuTf5SwxMXYy1Wa8by9-kXnC/exec";

const LOCAL_STORAGE_KEY = "inventoryTrackerDraftData_v1";

export default function App() {
  // Server-backed data and the current local working draft.
  const [savedInventory, setSavedInventory] = useState([]);
  const [workingInventory, setWorkingInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);

  // Asset intake form values.
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState(1);

  // Selected item editor values.
  const [selectedItemId, setSelectedItemId] = useState("");
  const [editingNotes, setEditingNotes] = useState("");
  const [editingCondition, setEditingCondition] = useState("");
  const [editingStatus, setEditingStatus] = useState("Active");

  // App state for loading, errors, and searching.
  const [loadingApp, setLoadingApp] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasLoadedLocalDraft, setHasLoadedLocalDraft] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Shared scan state used by both USB and phone-camera flows.
  const [scanSessionName, setScanSessionName] = useState("");
  const [scanInputValue, setScanInputValue] = useState("");
  const [recentScanLog, setRecentScanLog] = useState([]);

  // Camera scanner modal state and the always-ready USB input ref.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("Ready to scan.");
  const scannerRef = useRef(null);
  const usbScanInputRef = useRef(null);

  // Persists the local draft so refreshes do not wipe in-progress work.
  function saveDraftToLocalStorage(inventory) {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        workingInventory: inventory,
        savedAt: new Date().toISOString(),
      })
    );
  }

  // Renders a printable barcode preview for the selected item.
  function Barcode({ value, label }) {
  const ref = useRef();

  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        text: label || value,
      });
    }
  }, [value, label]);

  return <svg ref={ref}></svg>;
}

  // Removes the saved local draft after reset or publish.
  function clearDraftFromLocalStorage() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  // Creates a client-side-only ID for items that do not exist in Sheets yet.
  function buildLocalItemId() {
    return `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  // Code lookup helpers keep barcode/ID generation tied to sheet data.
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

  // Normalizes incoming rows so local-only and scan-tracking fields always exist.
  function normalizeInventoryRows(rows) {
    return rows.map((item, index) => ({
      ...item,
      "Checked Out To": item["Checked Out To"] || "",
      "Checked Out At": item["Checked Out At"] || "",
      "Last Checked In At": item["Last Checked In At"] || "",
      "Last Scan Action": item["Last Scan Action"] || "",
      localId: item.localId || item.Barcode || item["Readable ID"] || `row-${index}`,
      isLocalOnly: Boolean(item.isLocalOnly),
    }));
  }

  // Keeps a short newest-first activity feed for recent scans.
  function appendScanLog(message, type) {
    const entry = {
      message,
      type,
      timestamp: new Date().toISOString(),
    };

    setRecentScanLog((currentLog) => [entry, ...currentLog].slice(0, 10));
  }

  // Returns focus to the USB scanner field after scans and modal changes.
  function focusUsbScanInput() {
    window.requestAnimationFrame(() => {
      usbScanInputRef.current?.focus();
    });
  }

  // Loads the app from Sheets and restores any saved local draft.
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

  // Initial app bootstrap.
  useEffect(() => {
    loadAppData();
  }, []);

  // Writes local inventory edits to browser storage.
  useEffect(() => {
    if (!hasLoadedLocalDraft) return;
    saveDraftToLocalStorage(workingInventory);
  }, [workingInventory, hasLoadedLocalDraft]);

  // Keeps the USB scanner field ready on first load.
  useEffect(() => {
    focusUsbScanInput();
  }, []);

  // Returns keyboard focus after the camera modal closes.
  useEffect(() => {
    if (!scannerOpen) {
      focusUsbScanInput();
    }
  }, [scannerOpen]);

  // Dashboard counts for unpublished additions and edits.
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
          "Checked Out To",
          "Checked Out At",
          "Last Checked In At",
          "Last Scan Action",
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

  // Search filtering across the main inventory list.
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

  // The full row for the currently selected inventory item.
  const selectedItem = useMemo(() => {
    return workingInventory.find((item) => item.localId === selectedItemId) || null;
  }, [workingInventory, selectedItemId]);

  // Mirrors the selected row into editable field state.
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

  // Starts and cleans up the phone camera scanner.
  useEffect(() => {
    if (!scannerOpen) return undefined;

    if (!window.isSecureContext) {
      setScannerError("Camera scanning requires HTTPS or localhost.");
      setScannerStatus("");
      return undefined;
    }

    let isMounted = true;
    let html5QrcodeInstance = null;

    async function startScanner() {
      try {
        setScannerError("");
        setScannerStatus("Starting camera...");

        const { Html5Qrcode } = await import("html5-qrcode");
        if (!isMounted) return;

        html5QrcodeInstance = new Html5Qrcode("scanner-reader");
        scannerRef.current = html5QrcodeInstance;

        await html5QrcodeInstance.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 260, height: 130 },
            aspectRatio: 1.7778,
            rememberLastUsedCamera: true,
            showTorchButtonIfSupported: true,
            showZoomSliderIfSupported: true,
          },
          (decodedText) => {
            if (!isMounted) return;

            const cleanValue = String(decodedText || "").trim();
            processScannedBarcode(cleanValue);

            setScannerOpen(false);
          },
          () => {}
        );

        if (isMounted) {
          setScannerStatus("Point your camera at a barcode.");
        }
      } catch (error) {
        console.error("Scanner failed to start:", error);
        if (isMounted) {
          setScannerError(
            "Unable to start the camera scanner. Check camera permissions and try again."
          );
          setScannerStatus("");
        }
      }
    }

    startScanner();

    return () => {
      isMounted = false;

      async function cleanupScanner() {
        const scanner = scannerRef.current || html5QrcodeInstance;
        if (!scanner) return;

        try {
          const state = scanner.getState?.();
          if (state === 2 || state === 3) {
            await scanner.stop();
          }
        } catch (error) {
          console.warn("Scanner stop warning:", error);
        }

        try {
          await scanner.clear();
        } catch (error) {
          console.warn("Scanner clear warning:", error);
        }

        if (scannerRef.current === scanner) {
          scannerRef.current = null;
        }
      }

      cleanupScanner();
    };
  }, [scannerOpen, workingInventory, scanSessionName]);

  // Handles check-out/check-in rules after any scanner returns a barcode.
  function processScannedBarcode(barcode) {
    const normalizedBarcode = String(barcode || "").trim();

    if (!normalizedBarcode) {
      const message = "No barcode was provided.";
      setScannerStatus(message);
      appendScanLog(message, "warning");
      return;
    }

    const normalizedLookup = normalizedBarcode.toLowerCase();
    const matchedItem = workingInventory.find((item) => {
      return (
        String(item.Barcode || "").trim().toLowerCase() === normalizedLookup ||
        String(item["Readable ID"] || "").trim().toLowerCase() === normalizedLookup
      );
    });

    if (!matchedItem) {
      const message = `Scanned ${normalizedBarcode}. No inventory match found.`;
      setSearchTerm(normalizedBarcode);
      setScannerStatus(message);
      appendScanLog(message, "warning");
      return;
    }

    if (String(matchedItem.Status || "").trim() !== "Checked Out" && !scanSessionName.trim()) {
      const message = `Scan blocked for ${matchedItem["Item Name"]}. Enter a checkout name first.`;
      setSelectedItemId(matchedItem.localId);
      setSearchTerm(normalizedBarcode);
      setScannerStatus(message);
      appendScanLog(message, "warning");
      return;
    }

    const now = new Date().toISOString();
    const nextItemState =
      String(matchedItem.Status || "").trim() === "Checked Out"
        ? {
            Status: "Active",
            "Checked Out To": "",
            "Checked Out At": "",
            "Last Checked In At": now,
            "Last Scan Action": "Checked In",
            "Last Updated": now,
          }
        : {
            Status: "Checked Out",
            "Checked Out To": scanSessionName.trim(),
            "Checked Out At": now,
            "Last Scan Action": "Checked Out",
            "Last Updated": now,
          };

    const updatedInventory = workingInventory.map((item) =>
      item.localId === matchedItem.localId ? { ...item, ...nextItemState } : item
    );

    const action = nextItemState["Last Scan Action"];
    const message =
      action === "Checked In"
        ? `${matchedItem["Item Name"]} checked in.`
        : `${matchedItem["Item Name"]} checked out to ${scanSessionName.trim()}.`;

    setWorkingInventory(updatedInventory);
    setSelectedItemId(matchedItem.localId);
    setSearchTerm(normalizedBarcode);
    setScannerStatus(message);
    appendScanLog(message, "success");
  }

  // Lets USB scanners submit through the hidden keyboard-style Enter flow.
  function handleUsbScanSubmit(event) {
    event.preventDefault();
    processScannedBarcode(scanInputValue);
    setScanInputValue("");
    focusUsbScanInput();
  }

  // Creates one or more new local inventory items without publishing yet.
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
        "Checked Out To": "",
        "Checked Out At": "",
        "Last Checked In At": "",
        "Last Scan Action": "",
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

  // Saves the right-side editor fields into the working draft.
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

  // Resets the local draft back to the last loaded server state.
  function discardLocalChanges() {
    const confirmed = window.confirm("Discard all unpublished local changes?");
    if (!confirmed) return;

    setWorkingInventory(savedInventory);
    clearDraftFromLocalStorage();
    setSelectedItemId("");
    setErrorMessage("");
  }

  // Pushes local additions and edits back to the Apps Script backend.
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
            "Checked Out To",
            "Checked Out At",
            "Last Checked In At",
            "Last Scan Action",
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
          checkedOutTo: item["Checked Out To"],
          checkedOutAt: item["Checked Out At"],
          lastCheckedInAt: item["Last Checked In At"],
          lastScanAction: item["Last Scan Action"],
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
      {/* Top banner and publish controls */}
      <header className="brand-banner">
        <div className="brand-banner-top">
          <div>
            <p className="eyebrow">Allen County War Memorial Coliseum</p>
            <img
              src={`${import.meta.env.BASE_URL}assets/header_logo.svg`}
              alt="Allen County War Memorial Coliseum"
              className="header-logo"
            />
            <p className="subtext">
              Internal equipment tracking for the Allen County War Memorial Coliseum AV Department.
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
              {publishing ? "Publishing..." : "Publish Updates"}
            </button>
          </div>
        </div>

        <div className="brand-nav">
          <span className="brand-nav-item active">Inventory</span>
          <span className="brand-nav-item">AV Department</span>
          <span className="brand-nav-item">Operations Portal</span>
        </div>
      </header>

      {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

      <div className="dashboard-grid">
        <aside className="sidebar">
          {/* Local asset creation */}
          <section className="panel accent-panel">
            <div className="panel-header">
              <p className="panel-kicker">Asset Intake</p>
              <h2>Add Inventory Assets</h2>
              <p>Create individually tracked AV assets with unique serials.</p>
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
              Add Assets Locally
            </button>
          </section>

          {/* Draft summary and publishing actions */}
          <section className="panel">
            <div className="panel-header">
              <p className="panel-kicker">Draft Queue</p>
              <h2>Pending Updates</h2>
              <p>Work locally first, then push all AV inventory changes at once.</p>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-label">New Assets</span>
                <span className="summary-value">{pendingSummary.added}</span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Edited Assets</span>
                <span className="summary-value">{pendingSummary.edited}</span>
              </div>
            </div>

            <button
              className="button button-primary button-full"
              onClick={publishChanges}
              disabled={publishing || pendingSummary.total === 0}
            >
              {publishing ? "Publishing..." : "Publish Updates"}
            </button>

            <button
              className="button button-secondary button-full"
              onClick={discardLocalChanges}
              disabled={publishing || pendingSummary.total === 0}
            >
              Discard Local Changes
            </button>
          </section>

          {/* Unified scan controls for USB and camera workflows */}
          <section className="panel scan-mode-panel">
            <div className="panel-header">
              <p className="panel-kicker">Toggle Scan Mode</p>
              <h2>Toggle Scan Mode</h2>
              <p>Scan items with a USB scanner or phone camera using one shared workflow.</p>
            </div>

            <div className="form-group">
              <label>Checkout Name</label>
              <input
                className="input"
                placeholder="Who is checking items out?"
                value={scanSessionName}
                onChange={(e) => setScanSessionName(e.target.value)}
              />
            </div>

            <form className="scan-form" onSubmit={handleUsbScanSubmit}>
              <div className="form-group">
                <label>USB Scanner Input</label>
                <input
                  ref={usbScanInputRef}
                  className="input"
                  placeholder="Scan barcode or type readable ID"
                  value={scanInputValue}
                  onChange={(e) => setScanInputValue(e.target.value)}
                  onBlur={focusUsbScanInput}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              <button className="button button-dark button-full" type="submit">
                Process USB Scan
              </button>
            </form>

            <button className="button button-secondary button-full" onClick={() => setScannerOpen(true)}>
              Open Camera Scanner
            </button>

            <div className="scan-status-card">
              <span className="detail-label">Latest Status</span>
              <strong>{scannerStatus}</strong>
            </div>

            <div className="scan-log">
              <div className="panel-header">
                <h2>Recent Activity</h2>
                <p>Latest scan events across USB and camera input.</p>
              </div>

              {recentScanLog.length === 0 ? (
                <div className="empty-state">No scans yet. Start with a barcode or readable ID.</div>
              ) : (
                recentScanLog.map((entry) => (
                  <div key={`${entry.timestamp}-${entry.message}`} className={`scan-log-item ${entry.type}`}>
                    <strong>{entry.message}</strong>
                    <span>{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        <main className="main-content">
          {/* Searchable inventory list */}
          <section className="panel inventory-panel">
            <div className="inventory-header">
              <div>
                <p className="panel-kicker">Equipment Inventory</p>
                <h2>AV Asset Inventory</h2>
                <p>Search, scan, and select an item to edit locally.</p>
              </div>

              <div className="inventory-tools">
                <input
                  className="input search-input"
                  placeholder="Search items, IDs, barcodes, notes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button className="button button-dark scan-button" onClick={() => setScannerOpen(true)}>
                  Scan Barcode
                </button>
              </div>
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
                          <span
                            className={`badge badge-status status-${String(item.Status || "")
                              .toLowerCase()
                              .replace(/\s+/g, "-")}`}
                          >
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

          {/* Selected asset detail and local edit form */}
          <section className="panel">
            <div className="panel-header">
              <p className="panel-kicker">Asset Details</p>
              <h2>Edit Selected Asset</h2>
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
                    <Barcode
                      value={selectedItem.Barcode}
                       label={selectedItem["Readable ID"]}
                    />
                    <div><strong>Category:</strong> {selectedItem["Category Name"]}</div>
                    <div><strong>Location:</strong> {selectedItem["Location Name"]}</div>
                    <div><strong>Checked Out To:</strong> {selectedItem["Checked Out To"] || "-"}</div>
                    <div><strong>Checked Out At:</strong> {selectedItem["Checked Out At"] || "-"}</div>
                    <div><strong>Last Checked In At:</strong> {selectedItem["Last Checked In At"] || "-"}</div>
                    <div><strong>Last Scan Action:</strong> {selectedItem["Last Scan Action"] || "-"}</div>
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
                      <option value="Checked Out">Checked Out</option>
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

      <footer className="site-footer">
        <div>
          <strong>Allen County War Memorial Coliseum</strong>
          <span>4000 Parnell Avenue, Fort Wayne, Indiana 46805</span>
        </div>
        <div>
          <span>AV Department Inventory Portal</span>
          <span>260-482-9502</span>
        </div>
      </footer>

      {/* Phone camera scanning modal */}
      {scannerOpen && (
        <div className="scanner-modal-overlay" onClick={() => setScannerOpen(false)}>
          <div className="scanner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scanner-modal-header">
              <div>
                <p className="panel-kicker">Barcode Scanner</p>
                <h2>Scan Inventory Barcode</h2>
                <p>Use your phone camera to scan a barcode and jump directly to the asset.</p>
              </div>

              <button className="button button-secondary scanner-close" onClick={() => setScannerOpen(false)}>
                Close
              </button>
            </div>

            {scannerError ? <div className="alert alert-error scanner-alert">{scannerError}</div> : null}

            <div id="scanner-reader" className="scanner-reader"></div>

            <div className="scanner-status-row">
              <span className="scanner-status">{scannerStatus}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
