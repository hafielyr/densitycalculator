/**
 * Density Observer — Google Apps Script backend
 *
 * Receives observation records POSTed by the PWA and appends them to a Google
 * Sheet. If a row with the same `id` already exists it is updated in place
 * (idempotent retries from the offline queue).
 *
 * --- One-time setup ---
 * 1. Create a Google Sheet. Copy its ID from the URL (the long token between
 *    /d/ and /edit) and put it in Script Properties: File → Project settings →
 *    Script properties → Add property → name: SHEET_ID, value: <id>.
 *    (Or hard-code DEFAULT_SHEET_ID below.)
 * 2. Optionally set SHEET_NAME (default: "Observasi").
 * 3. Deploy → New deployment → Type: Web app
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the deployment URL (ends in /exec) and paste it into the app's
 *    Settings → "URL Google Apps Script" field.
 *
 * --- Schema ---
 * Columns are written in the order listed in COLUMNS below. Photo content is
 * never sent by the app (only metadata); local IndexedDB keeps the image.
 */

const DEFAULT_SHEET_ID = '1k3O7tFzXEZbAFUYMwWgkaLSOGDGU4RkR540uiQCEh1s'; // Surabaya Vaganza 2026
const DEFAULT_SHEET_NAME = 'Observasi';

const COLUMNS = [
  'id', 'createdAt', 'timestamp', 'updatedAt',
  'surveyorId', 'surveyorName', 'segmentCode',
  'zoneNo', 'zoneLokasi', 'mapsUrl',
  'width', 'length', 'area',
  'densityClass1', 'densityClass2', 'densityClass3', 'densityClassOverall',
  'overallOverridden', 'densityFactor',
  'estPeople', 'estPeopleAuto', 'estPeopleManual', 'isOverridden',
  'weather', 'incidentCategory', 'incidentNotes',
  'decisionTreePath',
  'photoSize', 'photoTimestamp', 'photoHasImage',
  'syncedAt'
];

function doGet() {
  return _json({ ok: true, service: 'density-observer', columns: COLUMNS });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _json({ ok: false, error: 'empty body' });
    }
    const record = JSON.parse(e.postData.contents);

    if (record && record.type === 'COORDINATOR_ALERT') {
      _appendAlert_(record);
      return _json({ ok: true, kind: 'alert' });
    }

    if (!record || !record.id) {
      return _json({ ok: false, error: 'missing id' });
    }

    _upsert_(record);
    return _json({ ok: true, id: record.id });
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) });
  }
}

function _sheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID') || DEFAULT_SHEET_ID;
  const name = props.getProperty('SHEET_NAME') || DEFAULT_SHEET_NAME;
  if (!id) throw new Error('SHEET_ID is not configured (Script Properties).');
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  _ensureHeader_(sheet);
  return sheet;
}

function _ensureHeader_(sheet) {
  const range = sheet.getRange(1, 1, 1, COLUMNS.length);
  const current = range.getValues()[0] || [];
  let needs = current.length !== COLUMNS.length;
  for (let i = 0; !needs && i < COLUMNS.length; i++) {
    if (current[i] !== COLUMNS[i]) needs = true;
  }
  if (needs) {
    range.setValues([COLUMNS]);
    sheet.setFrozenRows(1);
  }
}

function _rowFor_(r) {
  const ep = r.estimatedPeople || {};
  const dc = r.densityClasses || {};
  const ph = r.photo || {};
  const zn = r.zone || {};
  const dim = r.dimensions || {};
  const inc = r.incident || {};
  const map = {
    id: r.id || '',
    createdAt: r.createdAt || '',
    timestamp: r.timestamp || '',
    updatedAt: r.updatedAt || '',
    surveyorId: r.surveyorId || '',
    surveyorName: r.surveyorName || '',
    segmentCode: r.segmentCode || '',
    zoneNo: zn.no != null ? zn.no : '',
    zoneLokasi: zn.lokasi || '',
    mapsUrl: zn.mapsUrl || '',
    width: dim.width != null ? dim.width : '',
    length: dim.length != null ? dim.length : '',
    area: dim.area != null ? dim.area : '',
    densityClass1: dc.d1 || '',
    densityClass2: dc.d2 || '',
    densityClass3: dc.d3 || '',
    densityClassOverall: dc.overall || r.densityClass || '',
    overallOverridden: !!dc.overallOverridden,
    densityFactor: r.densityFactor != null ? r.densityFactor : '',
    estPeople: ep.manual != null ? ep.manual : (ep.auto != null ? ep.auto : ''),
    estPeopleAuto: ep.auto != null ? ep.auto : '',
    estPeopleManual: ep.manual != null ? ep.manual : '',
    isOverridden: !!ep.isOverridden,
    weather: r.weather || '',
    incidentCategory: inc.category || '',
    incidentNotes: inc.notes || '',
    decisionTreePath: (r.decisionTreePath || []).join('|'),
    photoSize: ph.size != null ? ph.size : '',
    photoTimestamp: ph.timestamp || '',
    photoHasImage: !!ph.hasImage,
    syncedAt: new Date().toISOString()
  };
  return COLUMNS.map((c) => map[c] != null ? map[c] : '');
}

function _upsert_(record) {
  const sheet = _sheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const lastRow = sheet.getLastRow();
    const row = _rowFor_(record);
    if (lastRow > 1) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === record.id) {
          sheet.getRange(i + 2, 1, 1, COLUMNS.length).setValues([row]);
          return;
        }
      }
    }
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}

function _appendAlert_(record) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID') || DEFAULT_SHEET_ID;
  if (!id) return;
  const ss = SpreadsheetApp.openById(id);
  const name = (props.getProperty('ALERT_SHEET_NAME') || 'Alerts');
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['timestamp', 'surveyorId', 'surveyorName', 'segmentCode', 'raw']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    record.timestamp || new Date().toISOString(),
    record.surveyorId || '',
    record.surveyorName || '',
    record.segmentCode || '',
    JSON.stringify(record)
  ]);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
