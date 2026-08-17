const HEADER_ALIASES = {
  sno: ['क्र.', 'क्र', 'S.No.', 'S.No', 'sno', 'serial'],
  block: ['ब्लॉक', 'Block', 'block'],
  gp: ['ग्राम पंचायत', 'Gram Panchayat', 'GP', 'gp'],
  village: ['ग्राम', 'गाँव', 'Village', 'village'],
  member: ['सदस्य का नाम', 'Member', 'member', 'Name'],
  age: ['आयु', 'Age', 'age'],
  gender: ['लिंग', 'Gender', 'gender'],
  maritalStatus: ['वैवाहिक स्थिति', 'Marital Status', 'maritalStatus'],
  hof: ['मुखिया का नाम', 'परिवार मुखिया', 'Head of Family', 'hof'],
  fatherName: ['पिताजी का नाम', 'पिता का नाम', 'Father Name', 'fatherName'],
  entryValue: ['दर्ज विवरण', 'Entry Detail', 'Entry Value', 'aadhaar', 'enrollment'],
  remark: ['रिमार्क', 'Remark', 'remark']
};

const REQUIRED_HEADERS = ['sno', 'block', 'gp', 'village', 'member', 'age', 'gender', 'hof', 'entryValue', 'remark'];

function doGet(e) {
  const action = (e.parameter.action || 'list').toLowerCase();
  if (action === 'list') return jsonResponse({ ok: true, entries: listEntries() });
  return jsonResponse({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'save') {
      const saved = saveEntry(payload);
      return jsonResponse({ ok: true, entry: saved });
    }
    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function listEntries() {
  const sheet = getTargetSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headerMap = getHeaderMap(values[0]);
  return values.slice(1).map((row, index) => {
    const entryValue = text(valueAt(row, headerMap.entryValue));
    return {
      sno: text(valueAt(row, headerMap.sno)) || String(index + 1),
      district: 'Dantewada',
      block: text(valueAt(row, headerMap.block)),
      gp: text(valueAt(row, headerMap.gp)),
      village: text(valueAt(row, headerMap.village)),
      member: text(valueAt(row, headerMap.member)),
      age: Number(valueAt(row, headerMap.age)) || 0,
      gender: text(valueAt(row, headerMap.gender)),
      maritalStatus: text(valueAt(row, headerMap.maritalStatus)),
      hof: text(valueAt(row, headerMap.hof)),
      fatherName: text(valueAt(row, headerMap.fatherName)) || text(valueAt(row, headerMap.hof)),
      aadhaar: onlyDigits(entryValue).length === 12 ? onlyDigits(entryValue) : '',
      enrollment: onlyDigits(entryValue).length === 28 ? onlyDigits(entryValue) : '',
      remark: text(valueAt(row, headerMap.remark)),
      entryValue
    };
  }).filter(entry => entry.member || entry.hof || entry.block || entry.gp || entry.village);
}

function saveEntry(payload) {
  const sheet = getTargetSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const headerMap = getHeaderMap(headers);
  const rowNumber = findRowNumber(values, headerMap, payload);
  const targetRow = rowNumber || Math.max(sheet.getLastRow() + 1, 2);
  const current = targetRow <= sheet.getLastRow()
    ? sheet.getRange(targetRow, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];

  const aadhaar = onlyDigits(payload.aadhaar);
  const enrollment = onlyDigits(payload.enrollment);
  const entryValue = aadhaar || enrollment || text(payload.entryValue);
  const nextSno = payload.sno || valueAt(current, headerMap.sno) || String(targetRow - 1);

  setCell(current, headerMap.sno, nextSno);
  setCell(current, headerMap.block, payload.block);
  setCell(current, headerMap.gp, payload.gp);
  setCell(current, headerMap.village, payload.village);
  setCell(current, headerMap.member, payload.member);
  setCell(current, headerMap.age, payload.age || 0);
  setCell(current, headerMap.gender, payload.gender);
  setCell(current, headerMap.maritalStatus, payload.maritalStatus);
  setCell(current, headerMap.hof, payload.hof);
  setCell(current, headerMap.fatherName, payload.fatherName);
  setCell(current, headerMap.entryValue, entryValue);
  setCell(current, headerMap.remark, payload.remark);

  sheet.getRange(targetRow, 1, 1, headers.length).setValues([current.slice(0, headers.length)]);
  return {
    sno: nextSno,
    block: text(payload.block),
    gp: text(payload.gp),
    village: text(payload.village),
    member: text(payload.member),
    aadhaar,
    enrollment,
    remark: text(payload.remark)
  };
}

function findRowNumber(values, headerMap, payload) {
  const sno = text(payload.sno);
  if (sno && headerMap.sno >= 0) {
    for (let i = 1; i < values.length; i++) {
      if (text(valueAt(values[i], headerMap.sno)) === sno) return i + 1;
    }
  }

  const member = text(payload.member).toLowerCase();
  const hof = text(payload.hof).toLowerCase();
  const village = text(payload.village).toLowerCase();
  if (!member || !hof || !village) return null;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (
      text(valueAt(row, headerMap.member)).toLowerCase() === member &&
      text(valueAt(row, headerMap.hof)).toLowerCase() === hof &&
      text(valueAt(row, headerMap.village)).toLowerCase() === village
    ) {
      return i + 1;
    }
  }
  return null;
}

function getTargetSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
}

function getHeaderMap(headers) {
  const normalized = headers.map(h => normalizeHeader(h));
  const map = {};
  Object.keys(HEADER_ALIASES).forEach(key => {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    const index = normalized.findIndex(h => aliases.includes(h));
    if (index === -1 && REQUIRED_HEADERS.includes(key)) {
      throw new Error('Missing required column: ' + HEADER_ALIASES[key][0]);
    }
    map[key] = index;
  });
  return map;
}

function normalizeHeader(value) {
  return text(value).replace(/\s+/g, '').replace(/[:：]/g, '').toLowerCase();
}

function valueAt(row, index) {
  return index >= 0 ? row[index] : '';
}

function setCell(row, index, value) {
  if (index === undefined || index < 0) return;
  row[index] = value === undefined || value === null ? '' : value;
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function onlyDigits(value) {
  return text(value).replace(/\D/g, '');
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
