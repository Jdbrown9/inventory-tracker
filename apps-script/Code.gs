const EVENT_LOG_SHEET_NAME = "Event Log";
const EVENT_LOG_HEADERS = [
  "Timestamp",
  "Event Type",
  "Item Name",
  "Readable ID",
  "Barcode",
  "Status",
  "Checked Out To",
  "Actor",
  "Details",
];

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";

  if (action === "getInventory") {
    return jsonResponse(getInventory());
  }

  if (action === "getCategories") {
    return jsonResponse(getLookupSheet("Categories"));
  }

  if (action === "getLocations") {
    return jsonResponse(getLookupSheet("Locations"));
  }

  if (action === "getEventLog") {
    return jsonResponse(getEventLog());
  }

  if (action === "getAppData") {
    return jsonResponse({
      success: true,
      inventory: getInventory().data || [],
      categories: getLookupSheet("Categories").data || [],
      locations: getLookupSheet("Locations").data || [],
      eventLog: getEventLog().data || [],
    });
  }

  return jsonResponse({
    success: false,
    message: "Invalid action",
  });
}

function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : "";
    const data = JSON.parse(raw);
    const action = data.action || "";

    if (action === "addItem") {
      return jsonResponse(addItem(data.payload));
    }

    if (action === "updateItem") {
      return jsonResponse(updateItem(data.payload));
    }

    if (action === "publishChanges") {
      return jsonResponse(publishChanges(data.payload));
    }

    return jsonResponse({
      success: false,
      message: "Invalid action",
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      message: error.toString(),
    });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`Sheet not found: ${name}`);
  return sheet;
}

function getOrCreateSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function getInventory() {
  const sheet = getSheet("Inventory");
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return {
      success: true,
      data: [],
    };
  }

  const headers = values[0];
  const rows = values.slice(1).filter((row) => row.join("") !== "");

  const data = rows.map((row, index) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    obj.rowNumber = index + 2;
    return obj;
  });

  return {
    success: true,
    data,
  };
}

function getEventLog() {
  const sheet = getOrCreateSheet(EVENT_LOG_SHEET_NAME, EVENT_LOG_HEADERS);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return {
      success: true,
      data: [],
    };
  }

  const headers = values[0];
  const rows = values.slice(1).filter((row) => row.join("") !== "");

  const data = rows
    .map((row, index) => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i];
      });
      obj.rowNumber = index + 2;
      return obj;
    })
    .reverse();

  return {
    success: true,
    data,
  };
}

function appendEventLog(entry) {
  const sheet = getOrCreateSheet(EVENT_LOG_SHEET_NAME, EVENT_LOG_HEADERS);

  sheet.appendRow([
    entry.timestamp || new Date(),
    entry.eventType || "Updated",
    entry.itemName || "",
    entry.readableId || "",
    entry.barcode || "",
    entry.status || "",
    entry.checkedOutTo || "",
    entry.actor || "",
    entry.details || "",
  ]);
}

function getLookupSheet(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return {
      success: true,
      data: [],
    };
  }

  const headers = values[0];
  const rows = values.slice(1).filter((row) => row.join("") !== "");

  const data = rows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });

  return {
    success: true,
    data,
  };
}

function getLookupAsMap(sheetName, keyColumn) {
  const lookup = getLookupSheet(sheetName).data;
  const map = {};

  lookup.forEach((row) => {
    const key = String(row[keyColumn]).padStart(2, "0");
    map[key] = row;
  });

  return map;
}

function getNextSerialNumber(categoryCode, locationCode) {
  const sheet = getSheet("Inventory");
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return "0001";
  }

  const headers = values[0];
  const categoryIndex = headers.indexOf("Category Code");
  const locationIndex = headers.indexOf("Location Code");
  const serialIndex = headers.indexOf("Serial Number");

  let maxSerial = 0;

  values.slice(1).forEach((row) => {
    const rowCategory = String(row[categoryIndex]).padStart(2, "0");
    const rowLocation = String(row[locationIndex]).padStart(2, "0");

    if (rowCategory === String(categoryCode).padStart(2, "0") && rowLocation === String(locationCode).padStart(2, "0")) {
      const serial = parseInt(row[serialIndex], 10);
      if (!isNaN(serial) && serial > maxSerial) {
        maxSerial = serial;
      }
    }
  });

  return String(maxSerial + 1).padStart(4, "0");
}

function addItem(payload, options) {
  const sheet = getSheet("Inventory");

  const categories = getLookupAsMap("Categories", "Category Code");
  const locations = getLookupAsMap("Locations", "Location Code");

  const categoryCode = String(payload.categoryCode).padStart(2, "0");
  const locationCode = String(payload.locationCode).padStart(2, "0");

  const category = categories[categoryCode];
  const location = locations[locationCode];

  if (!category) throw new Error("Invalid category code");
  if (!location) throw new Error("Invalid location code");

  const serialNumber = getNextSerialNumber(categoryCode, locationCode);
  const barcode = `${categoryCode}${locationCode}${serialNumber}`;
  const readableId = `${category["Short Code"]}-${location["Short Code"]}-${serialNumber}`;
  const now = new Date();

  sheet.appendRow([
    payload.itemName || "",
    categoryCode,
    category["Category Name"],
    locationCode,
    location["Location Name"],
    serialNumber,
    barcode,
    readableId,
    Number(payload.quantity || 1),
    payload.status || "Active",
    payload.condition || "",
    payload.notes || "",
    Number(payload.estimatedValue || 0),
    now,
  ]);

  const item = {
    rowNumber: sheet.getLastRow(),
    itemName: payload.itemName || "",
    categoryCode,
    categoryName: category["Category Name"],
    locationCode,
    locationName: location["Location Name"],
    serialNumber,
    barcode,
    readableId,
    quantity: Number(payload.quantity || 1),
    status: payload.status || "Active",
    condition: payload.condition || "",
    notes: payload.notes || "",
    estimatedValue: Number(payload.estimatedValue || 0),
    lastUpdated: now,
  };

  if (!options || !options.skipEventLog) {
    appendEventLog({
      timestamp: now,
      eventType: "Created",
      itemName: item.itemName,
      readableId: item.readableId,
      barcode: item.barcode,
      status: item.status,
      details: "New item added",
    });
  }

  return {
    success: true,
    message: "Item added",
    item,
  };
}

function updateItem(payload, options) {
  const sheet = getSheet("Inventory");
  const rowNumber = Number(payload.rowNumber);

  if (!rowNumber || rowNumber < 2) {
    throw new Error("Invalid row number");
  }

  const existing = sheet.getRange(rowNumber, 1, 1, 14).getValues()[0];
  if (!existing || existing.join("") === "") {
    throw new Error("Row not found");
  }

  const before = {
    itemName: existing[0],
    categoryCode: existing[1],
    categoryName: existing[2],
    locationCode: existing[3],
    locationName: existing[4],
    serialNumber: existing[5],
    barcode: existing[6],
    readableId: existing[7],
    quantity: existing[8],
    status: existing[9],
    condition: existing[10],
    notes: existing[11],
    estimatedValue: existing[12],
    lastUpdated: existing[13],
  };

  const now = new Date();
  const after = {
    itemName: payload.itemName ?? before.itemName,
    categoryCode: payload.categoryCode ?? before.categoryCode,
    categoryName: payload.categoryName ?? before.categoryName,
    locationCode: payload.locationCode ?? before.locationCode,
    locationName: payload.locationName ?? before.locationName,
    serialNumber: payload.serialNumber ?? before.serialNumber,
    barcode: payload.barcode ?? before.barcode,
    readableId: payload.readableId ?? before.readableId,
    quantity: payload.quantity ?? before.quantity,
    status: payload.status ?? before.status,
    condition: payload.condition ?? before.condition,
    notes: payload.notes ?? before.notes,
    estimatedValue: payload.estimatedValue ?? before.estimatedValue,
    lastUpdated: now,
  };

  sheet.getRange(rowNumber, 1, 1, 14).setValues([[
    after.itemName,
    after.categoryCode,
    after.categoryName,
    after.locationCode,
    after.locationName,
    after.serialNumber,
    after.barcode,
    after.readableId,
    after.quantity,
    after.status,
    after.condition,
    after.notes,
    after.estimatedValue,
    now,
  ]]);

  if (!options || !options.skipEventLog) {
    appendEventLog(buildUpdatedItemEvent(payload, before, after, now));
  }

  return {
    success: true,
    message: "Item updated",
    before,
    item: after,
  };
}

function buildUpdatedItemEvent(payload, before, after, timestamp) {
  const scanAction = String(payload.lastScanAction || "").trim();
  const eventType = scanAction || "Updated";
  const checkedOutTo = payload.checkedOutTo ?? "";
  const actor = checkedOutTo || before.checkedOutTo || "";

  let details = "Item details updated";
  if (eventType === "Checked Out") {
    details = `Checked out to ${checkedOutTo || "unassigned"}`;
  } else if (eventType === "Checked In") {
    details = "Item checked in";
  } else if (String(before.status || "") !== String(after.status || "")) {
    details = `Status changed from ${before.status || "blank"} to ${after.status || "blank"}`;
  }

  return {
    timestamp,
    eventType,
    itemName: after.itemName,
    readableId: after.readableId,
    barcode: after.barcode,
    status: after.status,
    checkedOutTo,
    actor,
    details,
  };
}

function publishChanges(payload) {
  const newItems = payload.newItems || [];
  const updatedItems = payload.updatedItems || [];

  const results = {
    added: 0,
    updated: 0,
  };

  newItems.forEach((item) => {
    const result = addItem(item, { skipEventLog: true });
    appendEventLog({
      timestamp: new Date(),
      eventType: "Created",
      itemName: result.item.itemName,
      readableId: result.item.readableId,
      barcode: result.item.barcode,
      status: result.item.status,
      details: "New item added",
    });
    results.added += 1;
  });

  updatedItems.forEach((item) => {
    const result = updateItem(item, { skipEventLog: true });
    appendEventLog(buildUpdatedItemEvent(item, result.before, result.item, new Date()));
    results.updated += 1;
  });

  return {
    success: true,
    message: "Changes published",
    results: results,
  };
}
