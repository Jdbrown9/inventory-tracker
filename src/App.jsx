import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import JsBarcode from "jsbarcode";

const API =
  import.meta.env.VITE_API_URL ||
  "https://script.google.com/macros/s/AKfycbwIxLeglf9YlAPQ9fhga_jF15ZbIcdU4gvKhQfwI1qrwuTf5SwxMXYy1Wa8by9-kXnC/exec";

const LOCAL_STORAGE_KEY = "inventoryTrackerDraftData_v1";
const CHECKOUT_NAMES = ["Jayden", "Andrew", "Nate", "Anna", "Zach"];

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
  const [addAssetModalOpen, setAddAssetModalOpen] = useState(false);
  const [assetLineItems, setAssetLineItems] = useState([
    { lineId: "line-1", name: "", category: "", location: "", quantity: 1 },
  ]);

  // Selected item editor values.
  const [selectedItemId, setSelectedItemId] = useState("");
  const [editingItemName, setEditingItemName] = useState("");
  const [editingCategoryCode, setEditingCategoryCode] = useState("");
  const [editingLocationCode, setEditingLocationCode] = useState("");
  const [editingSerialNumber, setEditingSerialNumber] = useState("");
  const [editingQuantity, setEditingQuantity] = useState(1);
  const [editingNotes, setEditingNotes] = useState("");
  const [editingCondition, setEditingCondition] = useState("");
  const [editingStatus, setEditingStatus] = useState("Active");
  const [editingCheckedOutTo, setEditingCheckedOutTo] = useState("");
  const [editingLastScanAction, setEditingLastScanAction] = useState("");
  const [assetEditorOpen, setAssetEditorOpen] = useState(false);

  // App state for loading, errors, and searching.
  const [loadingApp, setLoadingApp] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasLoadedLocalDraft, setHasLoadedLocalDraft] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [activeTab, setActiveTab] = useState("inventory");

  // Shared scan state used by both USB and phone-camera flows.
  const [scanSessionName, setScanSessionName] = useState("");
  const [scanInputValue, setScanInputValue] = useState("");
  const [recentScanLog, setRecentScanLog] = useState([]);
  const [scanModeEnabled, setScanModeEnabled] = useState(false);

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
    if (!ref.current || !value) return;

    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        text: label || value,
      });
    } catch (error) {
      console.warn("Unable to render barcode preview:", error);
      ref.current.innerHTML = "";
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

  function buildAssetLineItem(overrides = {}) {
    return {
      lineId: `line-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      name: "",
      category: category || "",
      location: location || "",
      quantity: 1,
      ...overrides,
    };
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
    if (activeTab === "scan" && scanModeEnabled) {
      focusUsbScanInput();
    }
  }, [activeTab, scanModeEnabled]);

  // Returns keyboard focus after the camera modal closes.
  useEffect(() => {
    if (!scannerOpen && activeTab === "scan" && scanModeEnabled) {
      focusUsbScanInput();
    }
  }, [scannerOpen, activeTab, scanModeEnabled]);

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
          "Quantity",
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

    return workingInventory.filter((item) => {
      const matchesSearch =
        !term ||
        [
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

      const matchesCategory =
        !categoryFilter ||
        String(item["Category Code"] || "").padStart(2, "0") === String(categoryFilter).padStart(2, "0");
      const matchesLocation =
        !locationFilter ||
        String(item["Location Code"] || "").padStart(2, "0") === String(locationFilter).padStart(2, "0");

      return matchesSearch && matchesCategory && matchesLocation;
    });
  }, [workingInventory, searchTerm, categoryFilter, locationFilter]);

  // The full row for the currently selected inventory item.
  const selectedItem = useMemo(() => {
    return workingInventory.find((item) => item.localId === selectedItemId) || null;
  }, [workingInventory, selectedItemId]);

  // Mirrors the selected row into editable field state.
  useEffect(() => {
    if (selectedItem) {
      setEditingItemName(selectedItem["Item Name"] || "");
      setEditingCategoryCode(String(selectedItem["Category Code"] || "").padStart(2, "0"));
      setEditingLocationCode(String(selectedItem["Location Code"] || "").padStart(2, "0"));
      setEditingSerialNumber(selectedItem["Serial Number"] || "");
      setEditingQuantity(selectedItem.Quantity || 1);
      setEditingNotes(selectedItem.Notes || "");
      setEditingCondition(selectedItem.Condition || "");
      setEditingStatus(selectedItem.Status || "Active");
      setEditingCheckedOutTo(selectedItem["Checked Out To"] || "");
      setEditingLastScanAction(selectedItem["Last Scan Action"] || "");
    } else {
      setEditingItemName("");
      setEditingCategoryCode("");
      setEditingLocationCode("");
      setEditingSerialNumber("");
      setEditingQuantity(1);
      setEditingNotes("");
      setEditingCondition("");
      setEditingStatus("Active");
      setEditingCheckedOutTo("");
      setEditingLastScanAction("");
    }
  }, [selectedItem]);

  // Starts and cleans up the phone camera scanner.
  useEffect(() => {
    if (!scannerOpen) return undefined;
    if (!scanModeEnabled) return undefined;

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
  }, [scannerOpen, workingInventory, scanSessionName, scanModeEnabled]);

  // Handles check-out/check-in rules after any scanner returns a barcode.
  function processScannedBarcode(barcode) {
    if (!scanModeEnabled) {
      const message = "Enable scan mode to process barcode scans.";
      setScannerStatus(message);
      appendScanLog(message, "warning");
      return;
    }

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
    if (!scanModeEnabled) {
      setScannerStatus("Enable scan mode to accept USB scans.");
      focusUsbScanInput();
      return;
    }
    processScannedBarcode(scanInputValue);
    setScanInputValue("");
    focusUsbScanInput();
  }

  function handleScanModeToggle() {
    setScanModeEnabled((currentValue) => {
      const nextValue = !currentValue;

      if (!nextValue) {
        setScannerOpen(false);
        setScannerStatus("Scan mode disabled.");
      } else {
        setScannerStatus("Scan mode enabled. Ready to scan.");
      }

      return nextValue;
    });
  }

  function openAssetEditor(itemId) {
    setSelectedItemId(itemId);
    setAssetEditorOpen(true);
  }

  function saveAssetEditor() {
    if (updateSelectedItemLocally()) {
      setAssetEditorOpen(false);
    }
  }

  function updateAssetLineItem(lineId, field, value) {
    setAssetLineItems((currentLineItems) =>
      currentLineItems.map((lineItem) =>
        lineItem.lineId === lineId ? { ...lineItem, [field]: value } : lineItem
      )
    );
  }

  function addAssetLineItem() {
    setAssetLineItems((currentLineItems) => [...currentLineItems, buildAssetLineItem()]);
  }

  function removeAssetLineItem(lineId) {
    setAssetLineItems((currentLineItems) => {
      if (currentLineItems.length === 1) return currentLineItems;
      return currentLineItems.filter((lineItem) => lineItem.lineId !== lineId);
    });
  }

  // Creates one or more new local inventory items without publishing yet.
  function addItemLocally() {
    if (assetLineItems.length === 0) {
      alert("Please add at least one line item.");
      return;
    }

    for (const lineItem of assetLineItems) {
      if (!lineItem.name.trim()) {
        alert("Please enter an item name for every line item.");
        return;
      }

      if (!lineItem.category || !lineItem.location) {
        alert("Please select a category and location for every line item.");
        return;
      }

      const count = Number(lineItem.quantity);

      if (!Number.isInteger(count) || count < 1) {
        alert("Quantity must be a whole number of 1 or more for every line item.");
        return;
      }
    }

    const inventoryCopy = [...workingInventory];
    const newItems = [];

    for (const lineItem of assetLineItems) {
      const categoryCode = String(lineItem.category).padStart(2, "0");
      const locationCode = String(lineItem.location).padStart(2, "0");
      const count = Number(lineItem.quantity);

      for (let i = 0; i < count; i++) {
        const serialNumber = getNextSerialNumber(categoryCode, locationCode, inventoryCopy);
        const barcode = buildBarcode(categoryCode, locationCode, serialNumber);
        const readableId = buildReadableId(categoryCode, locationCode, serialNumber);

        const newItem = {
          localId: buildLocalItemId(),
          rowNumber: "",
          "Item Name": lineItem.name.trim(),
          "Category Code": categoryCode,
          "Category Name": getCategoryName(categoryCode),
          "Location Code": locationCode,
          "Location Name": getLocationName(locationCode),
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
    }

    const updatedInventory = [...newItems.reverse(), ...workingInventory];
    setWorkingInventory(updatedInventory);

    if (newItems.length > 0) {
      setSelectedItemId(newItems[newItems.length - 1].localId);
    }

    setName("");
    setQuantity(1);
    setAssetLineItems([buildAssetLineItem({ category, location })]);
    setAddAssetModalOpen(false);
  }

  // Saves the right-side editor fields into the working draft.
  function updateSelectedItemLocally() {
    if (!selectedItem) return false;

    const categoryCode = editingCategoryCode ? String(editingCategoryCode).padStart(2, "0") : "";
    const locationCode = editingLocationCode ? String(editingLocationCode).padStart(2, "0") : "";
    const serialNumber = String(editingSerialNumber || "").trim();
    const quantityValue = Number(editingQuantity);

    if (!editingItemName.trim()) {
      alert("Please enter an item name.");
      return false;
    }

    if (!categoryCode || !locationCode) {
      alert("Please select a category and location.");
      return false;
    }

    if (!serialNumber) {
      alert("Please enter a serial number.");
      return false;
    }

    if (!Number.isFinite(quantityValue) || quantityValue < 0) {
      alert("Quantity must be a number of 0 or more.");
      return false;
    }

    const derivedBarcode = buildBarcode(categoryCode, locationCode, serialNumber);
    const derivedReadableId = buildReadableId(categoryCode, locationCode, serialNumber);

    const updatedInventory = workingInventory.map((item) => {
      if (item.localId !== selectedItem.localId) return item;

      return {
        ...item,
        "Item Name": editingItemName.trim(),
        "Category Code": categoryCode,
        "Category Name": getCategoryName(categoryCode) || item["Category Name"],
        "Location Code": locationCode,
        "Location Name": getLocationName(locationCode) || item["Location Name"],
        "Serial Number": serialNumber,
        Barcode: derivedBarcode,
        "Readable ID": derivedReadableId,
        Quantity: quantityValue,
        Status: editingStatus,
        Condition: editingCondition,
        Notes: editingNotes,
        "Checked Out To": editingCheckedOutTo,
        "Last Scan Action": editingLastScanAction,
        "Last Updated": new Date().toISOString(),
      };
    });

    setWorkingInventory(updatedInventory);
    return true;
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
          quantity: item.Quantity || 1,
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
            "Quantity",
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
          quantity: item.Quantity || 1,
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

  const editingDerivedBarcode =
    editingCategoryCode && editingLocationCode && editingSerialNumber
      ? buildBarcode(editingCategoryCode, editingLocationCode, editingSerialNumber)
      : "";
  const editingDerivedReadableId =
    editingCategoryCode && editingLocationCode && editingSerialNumber
      ? buildReadableId(editingCategoryCode, editingLocationCode, editingSerialNumber)
      : "";

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
          <button
            className={`brand-nav-item ${activeTab === "inventory" ? "active" : ""}`}
            onClick={() => setActiveTab("inventory")}
            type="button"
          >
            Inventory
          </button>
          <button
            className={`brand-nav-item ${activeTab === "scan" ? "active" : ""}`}
            onClick={() => setActiveTab("scan")}
            type="button"
          >
            Scan Mode
          </button>
        </div>
      </header>

      {errorMessage && <div className="alert alert-error">{errorMessage}</div>}

      {activeTab === "inventory" ? (
        <div className="inventory-workspace">
        <main className="main-content">
          {/* Searchable inventory list */}
          <section className="panel inventory-panel">
            <div className="inventory-header">
              <div>
                <p className="panel-kicker">Equipment Inventory</p>
                <h2>AV Asset Inventory</h2>
                <p>Search, scan, and click an item to view its barcode or edit locally.</p>
              </div>

              <div className="inventory-tools">
                <input
                  className="input search-input"
                  placeholder="Search items, IDs, barcodes, notes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                  className="input filter-input"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  disabled={loadingApp}
                >
                  <option value="">All categories</option>
                  {categories.map((c, i) => (
                    <option key={i} value={String(c["Category Code"]).padStart(2, "0")}>
                      {c["Category Name"]}
                    </option>
                  ))}
                </select>
                <select
                  className="input filter-input"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  disabled={loadingApp}
                >
                  <option value="">All locations</option>
                  {locations.map((l, i) => (
                    <option key={i} value={String(l["Location Code"]).padStart(2, "0")}>
                      {l["Location Name"]}
                    </option>
                  ))}
                </select>
                {(categoryFilter || locationFilter || searchTerm) && (
                  <button
                    className="button button-secondary scan-button"
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setCategoryFilter("");
                      setLocationFilter("");
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="button button-primary scan-button"
                  onClick={() => setAddAssetModalOpen(true)}
                >
                  Add Assets
                </button>
                <button
                  className="button button-dark scan-button"
                  onClick={() => {
                    setActiveTab("scan");
                    setScanModeEnabled(true);
                  }}
                >
                  Open Scan Mode
                </button>
              </div>
            </div>

            <div className="inventory-action-strip">
              <div className="summary-card compact-summary-card">
                <span className="summary-label">New Assets</span>
                <span className="summary-value">{pendingSummary.added}</span>
              </div>
              <div className="summary-card compact-summary-card">
                <span className="summary-label">Edited Assets</span>
                <span className="summary-value">{pendingSummary.edited}</span>
              </div>
              <button
                className="button button-primary"
                onClick={publishChanges}
                disabled={publishing || pendingSummary.total === 0}
              >
                {publishing ? "Publishing..." : "Publish Updates"}
              </button>
              <button
                className="button button-secondary"
                onClick={discardLocalChanges}
                disabled={publishing || pendingSummary.total === 0}
              >
                Discard Local Changes
              </button>
            </div>

            <div className="inventory-scroll">
              {loadingApp ? (
                <div className="empty-state">Loading inventory...</div>
              ) : filteredInventory.length === 0 ? (
                <div className="empty-state">No inventory matched your search.</div>
              ) : (
                <div className="inventory-list">
                  {filteredInventory.map((item) => (
                    <article
                      key={item.localId}
                      className={`inventory-card ${selectedItemId === item.localId ? "selected" : ""} ${
                        item.isLocalOnly ? "new-item" : ""
                      }`}
                      onClick={() => openAssetEditor(item.localId)}
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
                          <button
                            className="button button-secondary edit-asset-button"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAssetEditor(item.localId);
                            }}
                          >
                            Edit
                          </button>
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
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

        </main>
        </div>
      ) : (
        <div className="scan-mode-layout">
          {/* Unified scan controls for USB and camera workflows */}
          <section className="panel scan-mode-panel">
            <div className="panel-header">
              <p className="panel-kicker">Scan Workspace</p>
              <h2>Toggle Scan Mode</h2>
              <p>Use this tab to check items in and out with either scanner workflow.</p>
            </div>

            <div className="scan-mode-toggle-row">
              <div>
                <span className="detail-label">Scan Mode</span>
                <strong className="scan-mode-toggle-label">
                  {scanModeEnabled ? "Enabled" : "Disabled"}
                </strong>
              </div>
              <button
                className={`button ${scanModeEnabled ? "button-secondary" : "button-dark"}`}
                onClick={handleScanModeToggle}
                type="button"
              >
                {scanModeEnabled ? "Disable Scan Mode" : "Enable Scan Mode"}
              </button>
            </div>

            <div className="form-group">
              <label>Checkout Name</label>
              <select
                className="input"
                value={scanSessionName}
                onChange={(e) => setScanSessionName(e.target.value)}
                disabled={!scanModeEnabled}
              >
                <option value="">Select checkout name</option>
                {CHECKOUT_NAMES.map((checkoutName) => (
                  <option key={checkoutName} value={checkoutName}>
                    {checkoutName}
                  </option>
                ))}
              </select>
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
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={!scanModeEnabled}
                />
              </div>

              <button className="button button-dark button-full" type="submit" disabled={!scanModeEnabled}>
                Process USB Scan
              </button>
            </form>

            <button
              className="button button-secondary button-full"
              onClick={() => setScannerOpen(true)}
              disabled={!scanModeEnabled}
            >
              Open Camera Scanner
            </button>

            <div className="scan-status-card">
              <span className="detail-label">Latest Status</span>
              <strong>{scannerStatus}</strong>
            </div>
          </section>

          <section className="panel scan-mode-panel">
            <div className="panel-header">
              <p className="panel-kicker">Recent Activity</p>
              <h2>Scan Activity</h2>
              <p>Latest scan events across USB and camera input.</p>
            </div>

            <div className="scan-log">
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
        </div>
      )}

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

      {/* Multi-line asset intake modal */}
      {addAssetModalOpen && (
        <div className="scanner-modal-overlay" onClick={() => setAddAssetModalOpen(false)}>
          <div className="scanner-modal add-assets-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scanner-modal-header">
              <div>
                <p className="panel-kicker">Asset Intake</p>
                <h2>Add Inventory Assets</h2>
                <p>Add one or more line items, then create the assets locally before publishing.</p>
              </div>

              <button className="button button-secondary scanner-close" onClick={() => setAddAssetModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="asset-line-items">
              <div className="asset-line-item asset-line-item-header">
                <span>Item Name</span>
                <span>Category</span>
                <span>Location</span>
                <span>Qty</span>
                <span>Action</span>
              </div>

              {assetLineItems.map((lineItem) => (
                <div className="asset-line-item" key={lineItem.lineId}>
                  <input
                    className="input"
                    placeholder="Shure ULXD4 Receiver"
                    value={lineItem.name}
                    onChange={(e) => updateAssetLineItem(lineItem.lineId, "name", e.target.value)}
                  />
                  <select
                    className="input"
                    value={lineItem.category}
                    onChange={(e) => updateAssetLineItem(lineItem.lineId, "category", e.target.value)}
                    disabled={loadingApp}
                  >
                    <option value="">Category</option>
                    {categories.map((c, i) => (
                      <option key={i} value={String(c["Category Code"]).padStart(2, "0")}>
                        {c["Category Name"]} ({String(c["Category Code"]).padStart(2, "0")})
                      </option>
                    ))}
                  </select>
                  <select
                    className="input"
                    value={lineItem.location}
                    onChange={(e) => updateAssetLineItem(lineItem.lineId, "location", e.target.value)}
                    disabled={loadingApp}
                  >
                    <option value="">Location</option>
                    {locations.map((l, i) => (
                      <option key={i} value={String(l["Location Code"]).padStart(2, "0")}>
                        {l["Location Name"]} ({String(l["Location Code"]).padStart(2, "0")})
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={lineItem.quantity}
                    onChange={(e) => updateAssetLineItem(lineItem.lineId, "quantity", e.target.value)}
                  />
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => removeAssetLineItem(lineItem.lineId)}
                    disabled={assetLineItems.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="modal-action-row">
              <button className="button button-secondary" type="button" onClick={addAssetLineItem}>
                Add Line Item
              </button>
              <button className="button button-dark" type="button" onClick={addItemLocally} disabled={loadingApp}>
                Add Assets Locally
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset editor modal */}
      {assetEditorOpen && selectedItem && (
        <div className="scanner-modal-overlay" onClick={() => setAssetEditorOpen(false)}>
          <div className="scanner-modal asset-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scanner-modal-header">
              <div>
                <p className="panel-kicker">Asset Details</p>
                <h2>Edit {selectedItem["Item Name"]}</h2>
                <p>Barcode and readable ID are generated from category, location, and serial number.</p>
              </div>

              <button className="button button-secondary scanner-close" onClick={() => setAssetEditorOpen(false)}>
                Close
              </button>
            </div>

            <div className="editor-layout">
              <div className="selected-item-summary">
                <h3>{selectedItem["Item Name"]}</h3>
                <div className="summary-lines">
                  <div><strong>Readable ID:</strong> {selectedItem["Readable ID"]}</div>
                  <div><strong>Barcode:</strong> {selectedItem.Barcode}</div>
                  <Barcode value={selectedItem.Barcode} label={selectedItem["Readable ID"]} />
                  <div><strong>Category:</strong> {selectedItem["Category Name"]}</div>
                  <div><strong>Location:</strong> {selectedItem["Location Name"]}</div>
                  <div><strong>Checked Out To:</strong> {selectedItem["Checked Out To"] || "-"}</div>
                  <div><strong>Checked Out At:</strong> {selectedItem["Checked Out At"] || "-"}</div>
                  <div><strong>Last Checked In At:</strong> {selectedItem["Last Checked In At"] || "-"}</div>
                  <div><strong>Last Scan Action:</strong> {selectedItem["Last Scan Action"] || "-"}</div>
                </div>
              </div>

              <div className="editor-fields">
                <div className="editor-field-grid">
                  <div className="form-group">
                    <label>Item Name</label>
                    <input
                      className="input"
                      value={editingItemName}
                      onChange={(e) => setEditingItemName(e.target.value)}
                    />
                  </div>

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
                    <label>Category</label>
                    <select
                      className="input"
                      value={editingCategoryCode}
                      onChange={(e) => setEditingCategoryCode(e.target.value)}
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
                      value={editingLocationCode}
                      onChange={(e) => setEditingLocationCode(e.target.value)}
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
                    <label>Serial Number</label>
                    <input
                      className="input"
                      value={editingSerialNumber}
                      onChange={(e) => setEditingSerialNumber(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Quantity</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      value={editingQuantity}
                      onChange={(e) => setEditingQuantity(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Barcode</label>
                    <div className="readonly-field">
                      {editingDerivedBarcode || "Generated from category, location, and serial number"}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Readable ID</label>
                    <div className="readonly-field">
                      {editingDerivedReadableId || "Generated from category, location, and serial number"}
                    </div>
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
                    <label>Checked Out To</label>
                    <input
                      className="input"
                      value={editingCheckedOutTo}
                      onChange={(e) => setEditingCheckedOutTo(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Checked Out At</label>
                    <div className="readonly-field">{selectedItem["Checked Out At"] || "-"}</div>
                  </div>

                  <div className="form-group">
                    <label>Last Checked In At</label>
                    <div className="readonly-field">{selectedItem["Last Checked In At"] || "-"}</div>
                  </div>

                  <div className="form-group">
                    <label>Last Scan Action</label>
                    <select
                      className="input"
                      value={editingLastScanAction}
                      onChange={(e) => setEditingLastScanAction(e.target.value)}
                    >
                      <option value="">None</option>
                      <option value="Checked In">Checked In</option>
                      <option value="Checked Out">Checked Out</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Notes</label>
                  <textarea
                    className="input textarea"
                    value={editingNotes}
                    onChange={(e) => setEditingNotes(e.target.value)}
                  />
                </div>

                <button className="button button-dark" onClick={saveAssetEditor}>
                  Save All Local Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
