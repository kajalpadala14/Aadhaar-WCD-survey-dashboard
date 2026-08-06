const SHEET_NAME = 'Entries';

function doGet(e) {
  const action = (e.parameter.action || '').toString();
  if (action === 'list') {
    const entries = listEntries_();
    return jsonResponse({
      ok: true,
      schemaVersion: '2026-08-06-project-header-v2',
      updatedAt: new Date().toISOString(),
      rowCount: entries.length,
      entries
    });
  }
  return jsonResponse({ ok: false, error: 'invalid action' });
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  if (payload.action !== 'save' && payload.action !== 'delete') {
    return jsonResponse({ ok: false, error: 'invalid action' });
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const map = headerMap_(headers);
  const sno = Number(payload.sno);
  let rowIndex = -1;

  if (sno) {
    for (let i = 1; i < values.length; i++) {
      if (Number(values[i][map.sno]) === sno) {
        rowIndex = i + 1;
        break;
      }
    }
  }

  if (payload.action === 'delete') {
    if (map.deleted < 0) return jsonResponse({ ok: false, error: 'deleted column not found' });

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, map.deleted + 1).setValue(true);
    } else {
      const row = new Array(headers.length).fill('');
      setCell_(row, map, 'sno', sno || nextSno_(values, map.sno));
      setCell_(row, map, 'deleted', true);
      sheet.appendRow(row);
    }
    return jsonResponse({ ok: true });
  }

  const finalSno = sno || nextSno_(values, map.sno);
  const row = rowIndex > 0 ? values[rowIndex - 1] : new Array(headers.length).fill('');
  setCell_(row, map, 'sno', finalSno);
  setCell_(row, map, 'project', payload.project || payload.projectName || payload['Project Name'] || '');
  setCell_(row, map, 'district', payload.district || 'Dantewada');
  setCell_(row, map, 'block', payload.block || '');
  setCell_(row, map, 'gp', payload.gp || '');
  setCell_(row, map, 'village', payload.village || '');
  setCell_(row, map, 'hof', payload.hof || '');
  setCell_(row, map, 'member', payload.member || '');
  setCell_(row, map, 'mobile', payload.mobile || '');
  setCell_(row, map, 'gender', payload.gender || '');
  setCell_(row, map, 'age', payload.age || '');
  setCell_(row, map, 'aadhaar', payload.aadhaar || '');
  setCell_(row, map, 'enrollment', payload.enrollment || '');
  setCell_(row, map, 'remark', payload.remark || '');

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return jsonResponse({ ok: true, sno: finalSno });
}

function listEntries_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(String);
  const map = headerMap_(headers);
  return values.slice(1).filter(row => row[map.sno] !== '').map(row => ({
    sno: value_(row, map, 'sno'),
    project: value_(row, map, 'project'),
    projectName: value_(row, map, 'project'),
    'Project Name': value_(row, map, 'project'),
    district: value_(row, map, 'district'),
    block: value_(row, map, 'block'),
    gp: value_(row, map, 'gp'),
    village: value_(row, map, 'village'),
    hof: value_(row, map, 'hof'),
    member: value_(row, map, 'member'),
    mobile: value_(row, map, 'mobile'),
    gender: value_(row, map, 'gender'),
    age: value_(row, map, 'age'),
    aadhaar: value_(row, map, 'aadhaar'),
    enrollment: value_(row, map, 'enrollment'),
    remark: value_(row, map, 'remark'),
    deleted: value_(row, map, 'deleted') === true || value_(row, map, 'deleted') === 'TRUE'
  }));
}

function headerMap_(headers) {
  const normalized = {};
  headers.forEach((h, i) => normalized[normalize_(h)] = i);
  const fallback = {
    sno: 0,
    project: 1,
    district: -1,
    block: 2,
    gp: 3,
    village: 4,
    hof: 5,
    member: 6,
    mobile: 7,
    gender: 8,
    age: 9,
    aadhaar: 10,
    enrollment: 11,
    remark: 12,
    deleted: 13
  };
  const withFallback = (key, names) => {
    const found = pick_(normalized, names);
    return found >= 0 ? found : fallback[key];
  };
  return {
    sno: withFallback('sno', ['sno', 's no', 'serial no']),
    project: withFallback('project', ['project name', 'project', 'projectname']),
    district: withFallback('district', ['district']),
    block: withFallback('block', ['block']),
    gp: withFallback('gp', ['gp', 'gram panchayat']),
    village: withFallback('village', ['village']),
    hof: withFallback('hof', ['hof', 'head of family']),
    member: withFallback('member', ['member']),
    mobile: withFallback('mobile', ['mobile']),
    gender: withFallback('gender', ['gender']),
    age: withFallback('age', ['age']),
    aadhaar: withFallback('aadhaar', ['aadhaar', 'aadhar', 'aadhaar number']),
    enrollment: withFallback('enrollment', ['enrollment', 'enrollment number']),
    remark: withFallback('remark', ['remark', 'remarks']),
    deleted: withFallback('deleted', ['deleted'])
  };
}

function pick_(map, names) {
  for (const name of names) {
    const key = normalize_(name);
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  }
  return -1;
}

function normalize_(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function value_(row, map, key) {
  return map[key] >= 0 ? row[map[key]] : '';
}

function setCell_(row, map, key, value) {
  if (map[key] >= 0) row[map[key]] = value;
}

function nextSno_(values, snoIndex) {
  if (snoIndex < 0) return values.length;
  return Math.max(0, ...values.slice(1).map(row => Number(row[snoIndex]) || 0)) + 1;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
