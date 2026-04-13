import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import JsBarcode from "jsbarcode";
import JSZip from "jszip";

const API =
  import.meta.env.VITE_API_URL ||
  "https://script.google.com/macros/s/AKfycbwIxLeglf9YlAPQ9fhga_jF15ZbIcdU4gvKhQfwI1qrwuTf5SwxMXYy1Wa8by9-kXnC/exec";

const LOCAL_STORAGE_KEY = "inventoryTrackerDraftData_v1";
const CHECKOUT_NAMES = ["Jayden", "Andrew", "Nate", "Anna", "Zach"];
const DEFAULT_LABEL_LAYOUT = {
  pageWidth: 8.5,
  pageHeight: 11,
  labelWidth: 2.625,
  labelHeight: 1,
  columns: 3,
  rows: 10,
  topMargin: 0.5,
  leftMargin: 0.1875,
  horizontalGap: 0.125,
  verticalGap: 0,
  skipLabels: 0,
};

const DEFAULT_LABEL_OPTIONS = {
  showItemName: false,
  showReadableId: true,
  showBarcode: true,
  showLocation: false,
  showPropertyText: false,
};

const TWIPS_PER_INCH = 1440;
const LABEL_TEMPLATE_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function roundLabelMeasurement(value, precision = 3) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  const factor = 10 ** precision;
  return Math.round(numericValue * factor) / factor;
}

function twipsToInches(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue / TWIPS_PER_INCH;
}

function average(values) {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (safeValues.length === 0) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function detectLabelColumns(columnWidths) {
  if (!Array.isArray(columnWidths) || columnWidths.length === 0) {
    return { labelColumns: [], gapColumns: [] };
  }

  const largestWidth = Math.max(...columnWidths);
  const threshold = largestWidth * 0.6;
  const labelColumns = [];
  const gapColumns = [];

  columnWidths.forEach((width, index) => {
    if (width >= threshold) {
      labelColumns.push({ index, width });
    } else {
      gapColumns.push({ index, width });
    }
  });

  if (labelColumns.length === 0) {
    return {
      labelColumns: columnWidths.map((width, index) => ({ index, width })),
      gapColumns: [],
    };
  }

  return { labelColumns, gapColumns };
}

async function analyzeDocxLabelTemplate(file) {
  const zip = await JSZip.loadAsync(file);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    throw new Error("This DOCX file is missing word/document.xml.");
  }

  const parser = new DOMParser();
  const xml = parser.parseFromString(documentXml, "application/xml");
  const parserError = xml.querySelector("parsererror");
  if (parserError) {
    throw new Error("The DOCX template could not be parsed.");
  }

  const getWordAttr = (node, localName) => {
    if (!node) return "";
    return (
      node.getAttribute(`w:${localName}`) ||
      node.getAttribute(localName) ||
      ""
    );
  };

  const section = xml.getElementsByTagName("w:sectPr")[0];
  const pageSizeNode = section?.getElementsByTagName("w:pgSz")[0];
  const pageMarginNode = section?.getElementsByTagName("w:pgMar")[0];
  const tableNode = xml.getElementsByTagName("w:tbl")[0];

  if (!section || !pageSizeNode || !pageMarginNode || !tableNode) {
    throw new Error("No supported label table was found in this DOCX template.");
  }

  const pageWidth = roundLabelMeasurement(twipsToInches(getWordAttr(pageSizeNode, "w")));
  const pageHeight = roundLabelMeasurement(twipsToInches(getWordAttr(pageSizeNode, "h")));
  const topMargin = roundLabelMeasurement(twipsToInches(getWordAttr(pageMarginNode, "top")));
  const leftMargin = roundLabelMeasurement(twipsToInches(getWordAttr(pageMarginNode, "left")));
  const columnWidths = Array.from(tableNode.getElementsByTagName("w:gridCol")).map((node) =>
    twipsToInches(getWordAttr(node, "w"))
  );

  const rows = Array.from(tableNode.children).filter((node) => node.tagName === "w:tr");
  const rowHeights = rows
    .map((row) => {
      const trHeightNode = row.getElementsByTagName("w:trHeight")[0];
      return trHeightNode ? twipsToInches(getWordAttr(trHeightNode, "val")) : NaN;
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const { labelColumns, gapColumns } = detectLabelColumns(columnWidths);
  const labelWidth = roundLabelMeasurement(average(labelColumns.map((column) => column.width)));
  const horizontalGap = roundLabelMeasurement(average(gapColumns.map((column) => column.width)));
  const labelHeight = roundLabelMeasurement(
    rowHeights.length > 0 ? average(rowHeights) : (pageHeight - topMargin) / Math.max(rows.length, 1)
  );

  const layout = {
    pageWidth: pageWidth || DEFAULT_LABEL_LAYOUT.pageWidth,
    pageHeight: pageHeight || DEFAULT_LABEL_LAYOUT.pageHeight,
    labelWidth: labelWidth || DEFAULT_LABEL_LAYOUT.labelWidth,
    labelHeight: labelHeight || DEFAULT_LABEL_LAYOUT.labelHeight,
    columns: labelColumns.length || DEFAULT_LABEL_LAYOUT.columns,
    rows: rows.length || DEFAULT_LABEL_LAYOUT.rows,
    topMargin: topMargin || DEFAULT_LABEL_LAYOUT.topMargin,
    leftMargin: leftMargin || DEFAULT_LABEL_LAYOUT.leftMargin,
    horizontalGap,
    verticalGap: DEFAULT_LABEL_LAYOUT.verticalGap,
    skipLabels: 0,
  };

  const confidenceNotes = [];
  if (gapColumns.length === 0) {
    confidenceNotes.push("No explicit spacer columns were found, so horizontal gap was assumed to be 0.");
  }
  if (rowHeights.length === 0) {
    confidenceNotes.push("Row heights were not explicitly defined, so label height was estimated from the page.");
  }

  return {
    layout,
    summary: {
      pageWidth,
      pageHeight,
      labelWidth: layout.labelWidth,
      labelHeight: layout.labelHeight,
      columns: layout.columns,
      rows: layout.rows,
      leftMargin: layout.leftMargin,
      topMargin: layout.topMargin,
      horizontalGap: layout.horizontalGap,
      verticalGap: layout.verticalGap,
      labelsPerPage: layout.columns * layout.rows,
    },
    confidenceNotes,
  };
}

export default function App() {
  // Server-backed data and the current local working draft.
  const [savedInventory, setSavedInventory] = useState([]);
  const [workingInventory, setWorkingInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [eventLog, setEventLog] = useState([]);
  const [eventTypeFilter, setEventTypeFilter] = useState("");

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
  const [statusFilter, setStatusFilter] = useState("");
  const [activeTab, setActiveTab] = useState("inventory");

  // Shared scan state used by both USB and phone-camera flows.
  const [scanSessionName, setScanSessionName] = useState("");
  const [scanInputValue, setScanInputValue] = useState("");
  const [recentScanLog, setRecentScanLog] = useState([]);
  const [scanModeEnabled, setScanModeEnabled] = useState(false);
  const [scanNamePromptOpen, setScanNamePromptOpen] = useState(false);
  const [pendingScanSessionName, setPendingScanSessionName] = useState("");
  const [scanAction, setScanAction] = useState("checkout");
  const [pendingScanAction, setPendingScanAction] = useState("checkout");

  // Label printing workflow state.
  const [labelSearchTerm, setLabelSearchTerm] = useState("");
  const [selectedLabelItemIds, setSelectedLabelItemIds] = useState([]);
  const [labelLayout, setLabelLayout] = useState(DEFAULT_LABEL_LAYOUT);
  const [labelOptions, setLabelOptions] = useState(DEFAULT_LABEL_OPTIONS);
  const [labelTemplateFileName, setLabelTemplateFileName] = useState("");
  const [labelTemplateStatus, setLabelTemplateStatus] = useState("");
  const [labelTemplateError, setLabelTemplateError] = useState("");
  const [labelTemplateDetails, setLabelTemplateDetails] = useState(null);

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
  function Barcode({ value, label, className = "", width = 2, height = 60, displayValue = true }) {
  const ref = useRef();

  useEffect(() => {
    if (!ref.current || !value) return;

    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        width,
        height,
        displayValue,
        text: label || value,
      });
    } catch (error) {
      console.warn("Unable to render barcode preview:", error);
      ref.current.innerHTML = "";
    }
  }, [value, label, width, height, displayValue]);

  return <svg ref={ref} className={className}></svg>;
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

  function calculateLabelPositions(layout) {
    const columns = Math.max(1, Number(layout.columns) || 1);
    const rows = Math.max(1, Number(layout.rows) || 1);
    const positions = [];

    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
        positions.push({
          slotIndex: rowIndex * columns + columnIndex,
          row: rowIndex + 1,
          column: columnIndex + 1,
          top: Number(layout.topMargin) + rowIndex * (Number(layout.labelHeight) + Number(layout.verticalGap)),
          left: Number(layout.leftMargin) + columnIndex * (Number(layout.labelWidth) + Number(layout.horizontalGap)),
          width: Number(layout.labelWidth),
          height: Number(layout.labelHeight),
        });
      }
    }

    return positions;
  }

  function splitLabelsIntoPages(items, layout) {
    const positions = calculateLabelPositions(layout);
    const slotsPerPage = positions.length;
    const skipLabels = Math.max(0, Number(layout.skipLabels) || 0);
    const paddedItems = [...Array(skipLabels).fill(null), ...items];
    const totalPages = Math.max(1, Math.ceil(paddedItems.length / slotsPerPage));

    return Array.from({ length: totalPages }, (_, pageIndex) => {
      const pageItems = paddedItems.slice(pageIndex * slotsPerPage, (pageIndex + 1) * slotsPerPage);
      return positions.map((position, slotIndex) => ({
        ...position,
        item: pageItems[slotIndex] || null,
      }));
    });
  }

  function mapSelectedItemsToPageSlots(items, layout) {
    return splitLabelsIntoPages(items, layout);
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
      "Scan Actor": item["Scan Actor"] || "",
      localId: item.localId || item.Barcode || item["Readable ID"] || `row-${index}`,
      isLocalOnly: Boolean(item.isLocalOnly),
    }));
  }

  function normalizeEventLogRows(rows) {
    return rows.map((entry, index) => ({
      timestamp: entry.Timestamp || entry.timestamp || "",
      eventType: entry["Event Type"] || entry.eventType || "",
      itemName: entry["Item Name"] || entry.itemName || "",
      readableId: entry["Readable ID"] || entry.readableId || "",
      barcode: entry.Barcode || entry.barcode || "",
      status: entry.Status || entry.status || "",
      checkedOutTo: entry["Checked Out To"] || entry.checkedOutTo || "",
      actor: entry.Actor || entry.actor || "",
      details: entry.Details || entry.details || "",
      rowNumber: entry.rowNumber || index + 2,
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
      usbScanInputRef.current?.select();
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
      const eventLogRows = normalizeEventLogRows(data.eventLog || []);

      setSavedInventory(inventoryRows);
      setCategories(categoryRows);
      setLocations(locationRows);
      setEventLog(eventLogRows);

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
      const matchesStatus =
        !statusFilter ||
        String(item.Status || "").trim().toLowerCase() === String(statusFilter).trim().toLowerCase();

      return matchesSearch && matchesCategory && matchesLocation && matchesStatus;
    });
  }, [workingInventory, searchTerm, categoryFilter, locationFilter, statusFilter]);

  // The full row for the currently selected inventory item.
  const selectedItem = useMemo(() => {
    return workingInventory.find((item) => item.localId === selectedItemId) || null;
  }, [workingInventory, selectedItemId]);

  const filteredLabelInventory = useMemo(() => {
    const term = labelSearchTerm.trim().toLowerCase();

    if (!term) return workingInventory;

    return workingInventory.filter((item) =>
      [
        item["Item Name"],
        item["Readable ID"],
        item.Barcode,
        item["Category Name"],
        item["Location Name"],
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [workingInventory, labelSearchTerm]);

  const selectedLabelItems = useMemo(() => {
    const selectedIds = new Set(selectedLabelItemIds);
    return workingInventory.filter((item) => selectedIds.has(item.localId));
  }, [workingInventory, selectedLabelItemIds]);

  const labelPreviewPages = useMemo(() => {
    return mapSelectedItemsToPageSlots(selectedLabelItems, labelLayout);
  }, [selectedLabelItems, labelLayout]);

  const eventLogTypes = useMemo(() => {
    return Array.from(
      new Set(eventLog.map((entry) => entry.eventType).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [eventLog]);

  const filteredEventLog = useMemo(() => {
    if (!eventTypeFilter) return eventLog;

    return eventLog.filter((entry) => entry.eventType === eventTypeFilter);
  }, [eventLog, eventTypeFilter]);

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

    if (!scanSessionName.trim()) {
      const message = `Scan blocked for ${matchedItem["Item Name"]}. Select your name first.`;
      setSelectedItemId(matchedItem.localId);
      setSearchTerm(normalizedBarcode);
      setScannerStatus(message);
      appendScanLog(message, "warning");
      return;
    }

    if (scanAction === "markActive") {
      const now = new Date().toISOString();
      const nextItemState = {
        Status: "Active",
        "Checked Out To": "",
        "Checked Out At": "",
        "Last Scan Action": "Marked Active",
        "Scan Actor": scanSessionName.trim(),
        "Last Updated": now,
      };
      const updatedInventory = workingInventory.map((item) =>
        item.localId === matchedItem.localId ? { ...item, ...nextItemState } : item
      );
      const message = `${matchedItem["Item Name"]} marked active.`;

      setWorkingInventory(updatedInventory);
      setSelectedItemId(matchedItem.localId);
      setSearchTerm(normalizedBarcode);
      setScannerStatus(message);
      appendScanLog(message, "success");
      return;
    }

    const currentStatus = String(matchedItem.Status || "").trim();

    if (currentStatus !== "Checked Out" && currentStatus !== "Active") {
      const message = `Scan blocked for ${matchedItem["Item Name"]}. Only active items can be checked out. Current status: ${currentStatus || "blank"}.`;
      setSelectedItemId(matchedItem.localId);
      setSearchTerm(normalizedBarcode);
      setScannerStatus(message);
      appendScanLog(message, "warning");
      return;
    }

    const now = new Date().toISOString();
    const nextItemState =
      currentStatus === "Checked Out"
        ? {
            Status: "Active",
            "Checked Out To": "",
            "Checked Out At": "",
            "Last Checked In At": now,
            "Last Scan Action": "Checked In",
            "Scan Actor": scanSessionName.trim(),
            "Last Updated": now,
          }
        : {
            Status: "Checked Out",
            "Checked Out To": scanSessionName.trim(),
            "Checked Out At": now,
            "Last Scan Action": "Checked Out",
            "Scan Actor": scanSessionName.trim(),
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
    if (scanModeEnabled) {
      setScannerOpen(false);
      setScanModeEnabled(false);
      setScanNamePromptOpen(false);
      setScannerStatus("Scan mode disabled.");
      return;
    }

    openScanModeNamePrompt();
  }

  function openScanModeNamePrompt() {
    setActiveTab("scan");
    setPendingScanSessionName(scanSessionName || "");
    setPendingScanAction(scanAction);
    setScanNamePromptOpen(true);
  }

  function startScanModeWithName(event) {
    event.preventDefault();

    if (!pendingScanSessionName) {
      setScannerStatus("Select your name to start scan mode.");
      return;
    }

    setScanSessionName(pendingScanSessionName);
    setScanAction(pendingScanAction);
    setScanModeEnabled(true);
    setScanNamePromptOpen(false);
    setScannerStatus("Scan mode enabled. Ready to scan.");
    focusUsbScanInput();
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

  function updateLabelLayout(field, value) {
    setLabelLayout((currentLayout) => ({
      ...currentLayout,
      [field]: value,
    }));
  }

  function updateLabelOption(field) {
    setLabelOptions((currentOptions) => ({
      ...currentOptions,
      [field]: !currentOptions[field],
    }));
  }

  function toggleLabelItem(itemId) {
    setSelectedLabelItemIds((currentIds) =>
      currentIds.includes(itemId)
        ? currentIds.filter((currentId) => currentId !== itemId)
        : [...currentIds, itemId]
    );
  }

  function selectAllFilteredLabelItems() {
    setSelectedLabelItemIds((currentIds) => {
      const nextIds = new Set(currentIds);
      for (const item of filteredLabelInventory) {
        nextIds.add(item.localId);
      }
      return [...nextIds];
    });
  }

  function clearSelectedLabelItems() {
    setSelectedLabelItemIds([]);
  }

  function printLabelPreview() {
    window.print();
  }

  async function handleLabelTemplateUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLabelTemplateFileName(file.name);
    setLabelTemplateStatus("Analyzing template...");
    setLabelTemplateError("");
    setLabelTemplateDetails(null);

    try {
      const analysis = await analyzeDocxLabelTemplate(file);
      setLabelLayout((currentLayout) => ({
        ...currentLayout,
        ...analysis.layout,
        skipLabels: currentLayout.skipLabels,
      }));
      setLabelTemplateDetails(analysis.summary);
      setLabelTemplateStatus("Template imported and layout fields updated.");
      setLabelTemplateError(
        analysis.confidenceNotes.length > 0 ? analysis.confidenceNotes.join(" ") : ""
      );
    } catch (error) {
      console.error("Template import failed:", error);
      setLabelTemplateStatus("");
      setLabelTemplateDetails(null);
      setLabelTemplateError(
        error instanceof Error
          ? error.message
          : "Unable to read that DOCX template. Try a table-based label sheet."
      );
    } finally {
      event.target.value = "";
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
          Status: "Needs Labeled",
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
            "Scan Actor",
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
          scanActor: item["Scan Actor"],
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
            <a
              className="button button-secondary"
              href="https://docs.google.com/spreadsheets/d/1ohg9VZF8Qs5kkLynRIDXuEFbYkwDugCljtrGuh7xwPY/edit?usp=sharing"
              target="_blank"
              rel="noreferrer"
            >
              Master Inventory List
            </a>
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
          <button
            className={`brand-nav-item ${activeTab === "labels" ? "active" : ""}`}
            onClick={() => setActiveTab("labels")}
            type="button"
          >
            Label Printing
          </button>
          <button
            className={`brand-nav-item ${activeTab === "events" ? "active" : ""}`}
            onClick={() => setActiveTab("events")}
            type="button"
          >
            Event Log
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
                <select
                  className="input filter-input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  disabled={loadingApp}
                >
                  <option value="">All statuses</option>
                  <option value="Needs Labeled">Needs Labeled</option>
                  <option value="Active">Active</option>
                  <option value="Checked Out">Checked Out</option>
                  <option value="Missing">Missing</option>
                  <option value="Retired">Retired</option>
                </select>
                {(categoryFilter || locationFilter || statusFilter || searchTerm) && (
                  <button
                    className="button button-secondary scan-button"
                    type="button"
                    onClick={() => {
                      setSearchTerm("");
                      setCategoryFilter("");
                      setLocationFilter("");
                      setStatusFilter("");
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
                  onClick={openScanModeNamePrompt}
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
      ) : activeTab === "scan" ? (
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
              <label>Scan Action</label>
              <select
                className="input"
                value={scanAction}
                onChange={(e) => setScanAction(e.target.value)}
                disabled={!scanModeEnabled}
              >
                <option value="checkout">Check In / Check Out</option>
                <option value="markActive">Mark Active</option>
              </select>
            </div>

            <div className="form-group">
              <label>Actor</label>
              <select
                className="input"
                value={scanSessionName}
                onChange={(e) => setScanSessionName(e.target.value)}
                disabled={!scanModeEnabled}
              >
                <option value="">Select your name</option>
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
      ) : activeTab === "events" ? (
        <div className="event-log-layout">
          <section className="panel event-log-panel">
            <div className="panel-header">
              <p className="panel-kicker">Inventory History</p>
              <h2>Event Log</h2>
              <p>Published activity from the master inventory sheet.</p>
            </div>

            <div className="event-log-toolbar">
              <select
                className="input event-log-filter"
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                disabled={loadingApp || eventLogTypes.length === 0}
              >
                <option value="">All log types</option>
                {eventLogTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
              {eventTypeFilter && (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setEventTypeFilter("")}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="event-log-list">
              {loadingApp ? (
                <div className="empty-state">Loading event log...</div>
              ) : eventLog.length === 0 ? (
                <div className="empty-state">No published inventory events yet.</div>
              ) : filteredEventLog.length === 0 ? (
                <div className="empty-state">No event log entries matched that type.</div>
              ) : (
                filteredEventLog.map((entry) => (
                  <article className="event-log-item" key={`${entry.rowNumber}-${entry.timestamp}`}>
                    <div className="event-log-main">
                      <h3>{entry.eventType || "Inventory Event"}</h3>
                      <span className="event-log-item-name">{entry.itemName || "Inventory item"}</span>
                      <p>{entry.details || "Inventory activity was recorded."}</p>
                    </div>

                    <div className="event-log-meta">
                      <span>
                        <strong>Time</strong>
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "-"}
                      </span>
                      <span>
                        <strong>Readable ID</strong>
                        {entry.readableId || "-"}
                      </span>
                      <span>
                        <strong>Status</strong>
                        {entry.status || "-"}
                      </span>
                      <span>
                        <strong>Checked Out To</strong>
                        {entry.checkedOutTo || "-"}
                      </span>
                      <span>
                        <strong>Actor</strong>
                        {entry.actor || "-"}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="label-printing-layout">
          <section className="panel label-selection-panel">
            <div className="panel-header">
              <p className="panel-kicker">Batch Labels</p>
              <h2>Label Printing</h2>
              <p>Select inventory assets, tune the sheet layout, and preview barcode labels.</p>
            </div>

            <div className="label-toolbar">
              <input
                className="input"
                placeholder="Search labels by item, ID, barcode, category, location..."
                value={labelSearchTerm}
                onChange={(e) => setLabelSearchTerm(e.target.value)}
              />
              <button className="button button-secondary" type="button" onClick={selectAllFilteredLabelItems}>
                Select All Filtered
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={clearSelectedLabelItems}
                disabled={selectedLabelItemIds.length === 0}
              >
                Clear Selection
              </button>
              <span className="selected-count-card">{selectedLabelItemIds.length} selected</span>
            </div>

            <div className="label-item-list">
              {filteredLabelInventory.length === 0 ? (
                <div className="empty-state">No inventory items matched your label search.</div>
              ) : (
                filteredLabelInventory.map((item) => (
                  <label className="label-item-row" key={item.localId}>
                    <input
                      type="checkbox"
                      checked={selectedLabelItemIds.includes(item.localId)}
                      onChange={() => toggleLabelItem(item.localId)}
                    />
                    <span>
                      <strong>{item["Item Name"]}</strong>
                      <small>{item["Readable ID"] || item.Barcode}</small>
                    </span>
                    <span>{item["Category Name"] || "-"}</span>
                    <span>{item["Location Name"] || "-"}</span>
                  </label>
                ))
              )}
            </div>
          </section>

          <aside className="label-controls-stack">
            <section className="panel">
              <div className="panel-header">
                <p className="panel-kicker">Custom Size</p>
                <h2>Sheet Layout</h2>
                <p>All measurements are inches for this first version.</p>
              </div>

              <div className="template-import-panel">
                <label className="button button-secondary button-full template-upload-button">
                  <input
                    type="file"
                    accept={LABEL_TEMPLATE_ACCEPT}
                    onChange={handleLabelTemplateUpload}
                    hidden
                  />
                  Import DOCX Label Template
                </label>
                <p className="template-import-help">
                  Upload a Word label sheet template and the app will try to auto-fill the layout below.
                </p>
                {labelTemplateFileName ? (
                  <div className="template-import-meta">
                    <strong>{labelTemplateFileName}</strong>
                    {labelTemplateStatus ? <span>{labelTemplateStatus}</span> : null}
                  </div>
                ) : null}
                {labelTemplateError ? <div className="template-import-warning">{labelTemplateError}</div> : null}
                {labelTemplateDetails ? (
                  <div className="template-detected-grid">
                    <span><strong>{labelTemplateDetails.columns}</strong> across</span>
                    <span><strong>{labelTemplateDetails.rows}</strong> down</span>
                    <span><strong>{labelTemplateDetails.labelsPerPage}</strong> per page</span>
                    <span>{labelTemplateDetails.labelWidth}" × {labelTemplateDetails.labelHeight}"</span>
                  </div>
                ) : null}
              </div>

              <div className="label-settings-grid">
                {[
                  ["pageWidth", "Page Width"],
                  ["pageHeight", "Page Height"],
                  ["labelWidth", "Label Width"],
                  ["labelHeight", "Label Height"],
                  ["columns", "Columns"],
                  ["rows", "Rows"],
                  ["topMargin", "Top Margin"],
                  ["leftMargin", "Left Margin"],
                  ["horizontalGap", "Horizontal Gap"],
                  ["verticalGap", "Vertical Gap"],
                  ["skipLabels", "Skip Labels"],
                ].map(([field, label]) => (
                  <div className="form-group" key={field}>
                    <label>{label}</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step={field === "columns" || field === "rows" || field === "skipLabels" ? "1" : "0.01"}
                      value={labelLayout[field]}
                      onChange={(e) => updateLabelLayout(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <p className="panel-kicker">Label Content</p>
                <h2>Print Options</h2>
              </div>

              <div className="label-option-list">
                {[
                  ["showBarcode", "Show barcode graphic"],
                  ["showReadableId", "Show readable ID"],
                  ["showItemName", "Show item name"],
                  ["showLocation", "Show location"],
                  ["showPropertyText", "Show property notice"],
                ].map(([field, label]) => (
                  <label className="label-option" key={field}>
                    <input
                      type="checkbox"
                      checked={labelOptions[field]}
                      onChange={() => updateLabelOption(field)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <button
                className="button button-dark button-full"
                type="button"
                onClick={printLabelPreview}
                disabled={selectedLabelItems.length === 0}
              >
                Print Labels
              </button>
            </section>
          </aside>

          <section className="panel label-preview-panel">
            <div className="panel-header">
              <p className="panel-kicker">Print Preview</p>
              <h2>Preview Sheets</h2>
              <p>
                {selectedLabelItems.length} label{selectedLabelItems.length === 1 ? "" : "s"} across{" "}
                {labelPreviewPages.length} page{labelPreviewPages.length === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="label-preview-pages">
              {labelPreviewPages.map((pageSlots, pageIndex) => (
                <div className="label-preview-page-wrap" key={pageIndex}>
                  <span className="detail-label">Page {pageIndex + 1}</span>
                  <div
                    className="label-preview-page"
                    style={{
                      width: `${Number(labelLayout.pageWidth) || 8.5}in`,
                      height: `${Number(labelLayout.pageHeight) || 11}in`,
                    }}
                  >
                    {pageSlots.map((slot) => (
                      <div
                        key={slot.slotIndex}
                        className={`preview-label ${slot.item ? "" : "empty"}`}
                        style={{
                          top: `${slot.top}in`,
                          left: `${slot.left}in`,
                          width: `${slot.width}in`,
                          height: `${slot.height}in`,
                        }}
                      >
                        {slot.item ? (
                          <>
                            {labelOptions.showItemName && (
                              <strong className="preview-label-name">{slot.item["Item Name"]}</strong>
                            )}
                            {labelOptions.showBarcode && (
                              <Barcode
                                className="preview-label-barcode"
                                value={slot.item.Barcode}
                                label={labelOptions.showReadableId ? slot.item["Readable ID"] || slot.item.Barcode : ""}
                                width={2}
                                height={42}
                                displayValue={false}
                              />
                            )}
                            {labelOptions.showReadableId && (
                              <strong className="preview-label-id">
                                {slot.item["Readable ID"] || slot.item.Barcode}
                              </strong>
                            )}
                            {labelOptions.showLocation && (
                              <span className="preview-label-location">{slot.item["Location Name"]}</span>
                            )}
                            {labelOptions.showPropertyText && (
                              <span className="preview-label-property">
                                Property of Allen County War Memorial Coliseum
                              </span>
                            )}
                          </>
                        ) : (
                          <span>Empty</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
                      <option value="Needs Labeled">Needs Labeled</option>
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
                      <option value="Marked Active">Marked Active</option>
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

      {/* Scan mode name prompt */}
      {scanNamePromptOpen && (
        <div className="scanner-modal-overlay" onClick={() => setScanNamePromptOpen(false)}>
          <form className="scanner-modal scan-name-modal" onSubmit={startScanModeWithName} onClick={(e) => e.stopPropagation()}>
            <div className="scanner-modal-header">
              <div>
                <p className="panel-kicker">Scan Mode</p>
                <h2>Start Scan Session</h2>
                <p>Choose who is scanning and what this scan session should do.</p>
              </div>

              <button className="button button-secondary scanner-close" type="button" onClick={() => setScanNamePromptOpen(false)}>
                Close
              </button>
            </div>

            <div className="form-group">
              <label>Actor</label>
              <select
                className="input"
                value={pendingScanSessionName}
                onChange={(e) => setPendingScanSessionName(e.target.value)}
                autoFocus
              >
                <option value="">Select your name</option>
                {CHECKOUT_NAMES.map((checkoutName) => (
                  <option key={checkoutName} value={checkoutName}>
                    {checkoutName}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Scan Action</label>
              <select
                className="input"
                value={pendingScanAction}
                onChange={(e) => setPendingScanAction(e.target.value)}
              >
                <option value="checkout">Check In / Check Out</option>
                <option value="markActive">Mark Active</option>
              </select>
            </div>

            <button className="button button-dark button-full" type="submit">
              Start Scanning
            </button>
          </form>
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
