/**
 * Google Sheets Integration Module
 * File: backend/sheets-service.js
 */
const { google } = require('googleapis');

/**
 * Fetches client configurations from the Master Config Google Sheet.
 * This sheet acts as our Cloud Database.
 */
async function getClientConfigsFromMasterSheet(masterSpreadsheetId, credentials) {
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: masterSpreadsheetId,
      range: 'Clients!A2:G100',
    });
    
    const rows = response.data.values || [];
    return rows.map(row => {
      let mappingsObj = {};
      try {
        mappingsObj = JSON.parse(row[6] || '{}');
      } catch (err) {
        console.error(`Invalid JSON mapping for client ${row[0]}:`, row[6]);
      }

      return {
        clientName: row[0],
        metaPageId: row[1],
        metaFormId: row[2],
        pageAccessToken: row[3],
        googleSpreadsheetId: row[4],
        googleWorksheetName: row[5],
        mappings: mappingsObj,
        googleAuthCredentials: credentials
      };
    });
  } catch (err) {
    console.error('Error fetching configurations from Master Sheet:', err.message);
    throw err;
  }
}

/**
 * Main routine to append a lead or update it if it exists.
 */
async function appendOrUpdateLead(spreadsheetId, sheetName, leadId, mappedData, credentials) {
  let auth;
  if (credentials.type === 'oauth') {
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(credentials.tokens);
  } else {
    auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
  }

  const sheets = google.sheets({ version: 'v4', auth });

  // Fetch current spreadsheet data
  const range = `${sheetName}!A1:Z1000`;
  let response;
  try {
    response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
  } catch (err) {
    throw new Error(`Failed to fetch spreadsheet: ${err.message}`);
  }

  const rows = response.data.values || [];
  if (rows.length === 0) {
    throw new Error('Spreadsheet worksheet is completely empty. Headers must be defined first.');
  }

  // Header Auto-Detection & Index Mapping
  const headers = rows[0].map(h => h.trim().toLowerCase());
  
  const leadIdHeaderKey = Object.keys(mappedData).find(key => key.toLowerCase().includes('lead id')) || 'Lead ID';
  const leadIdColumnIndex = headers.indexOf(leadIdHeaderKey.toLowerCase());

  if (leadIdColumnIndex === -1) {
    throw new Error(`Required deduplication column header ("${leadIdHeaderKey}") was not found in the spreadsheet.`);
  }

  // Find if Lead ID already exists (Deduplication Check)
  let existingRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[leadIdColumnIndex] === String(leadId)) {
      existingRowIndex = i + 1; // 1-indexed
      break;
    }
  }

  // Construct Row Array in sequence matching spreadsheet headers
  const newRowValues = [];
  rows[0].forEach((header, index) => {
    const matchKey = Object.keys(mappedData).find(k => k.trim().toLowerCase() === header.trim().toLowerCase());
    newRowValues[index] = matchKey ? mappedData[matchKey] : '';
  });

  if (existingRowIndex !== -1) {
    // Update Existing Lead Row
    const updateRange = `${sheetName}!A${existingRowIndex}:${getColName(newRowValues.length)}${existingRowIndex}`;
    console.log(`[Deduplicate] Found existing Lead ID ${leadId} on Row ${existingRowIndex}. Updating...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRowValues]
      }
    });
  } else {
    // Append New Lead Row
    console.log(`[Deduplicate] Lead ID ${leadId} is unique. Appending...`);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [newRowValues]
      }
    });
  }
}

function getColName(n) {
  let ordA = 'A'.charCodeAt(0);
  let ordZ = 'Z'.charCodeAt(0);
  let len = ordZ - ordA + 1;
  let s = "";
  while(n >= 0) {
      s = String.fromCharCode(n % len + ordA) + s;
      n = Math.floor(n / len) - 1;
  }
  return s;
}

module.exports = { appendOrUpdateLead, getClientConfigsFromMasterSheet };
