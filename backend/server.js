/**
 * production-ready Meta Lead Ads Webhook & Pipeline Server
 * File: backend/server.js
 */
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { appendOrUpdateLead, getClientConfigsFromMasterSheet } = require('./sheets-service');

const app = express();
app.use(express.json());
app.enable('trust proxy');

// Serve static frontend files (dashboard simulator) at the root URL
app.use(express.static(path.join(__dirname, '../')));

app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '../privacy-policy.html'));
});

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'my_super_secure_verify_token_123';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOGS_PATH = path.join(__dirname, 'logs.json');

// Google Service Account Credentials from Environment Variables
const googleCredentials = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : null
};

const GOOGLE_WORKSHEETS = ["Leads_Raw", "SurveyResponses", "New_Form_Submissions", "Archive"];

// Log logger helper
function addLog(clientName, metaFormName, leadId, status, details) {
  try {
    let logs = [];
    if (fs.existsSync(LOGS_PATH)) {
      const raw = fs.readFileSync(LOGS_PATH, 'utf8');
      logs = JSON.parse(raw || '[]');
    }
    logs.unshift({
      timestamp: new Date().toISOString(),
      clientName,
      metaFormName,
      leadId,
      status, // 'Success' or 'Failed'
      details
    });
    if (logs.length > 100) {
      logs = logs.slice(0, 100);
    }
    fs.writeFileSync(LOGS_PATH, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write log:', err.message);
  }
}

// Config database helpers
function readConfigs() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { clients: [], accounts: { meta: [], google: [] } };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw || '{}');
    if (!data.clients) data.clients = [];
    if (!data.accounts) data.accounts = { meta: [], google: [] };
    return data;
  } catch (err) {
    console.error('Failed to read config.json:', err.message);
    return { clients: [], accounts: { meta: [], google: [] } };
  }
}

function writeConfigs(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write config.json:', err.message);
  }
}

// Config database selector helper
async function getClientConfig(pageId, formId) {
  if (process.env.MASTER_SPREADSHEET_ID && googleCredentials.client_email && googleCredentials.private_key) {
    try {
      console.log('[Cloud DB] Querying Master Google Sheet for configurations...');
      const clients = await getClientConfigsFromMasterSheet(process.env.MASTER_SPREADSHEET_ID, googleCredentials);
      return clients.find(c => c.metaPageId === pageId && c.metaFormId === formId);
    } catch (err) {
      console.error('[Cloud DB Error] Falling back to local file database:', err.message);
    }
  }

  try {
    const db = readConfigs();
    const client = db.clients.find(c => c.metaPageId === pageId && c.metaFormId === formId);
    if (client) {
      if (client.googleAccountId) {
        const acc = db.accounts.google.find(g => g.id === client.googleAccountId);
        if (acc) {
          client.googleAuthCredentials = acc.credentials;
        }
      }
      if (client.googleAuthCredentials && client.googleAuthCredentials.client_email && client.googleAuthCredentials.client_email.includes('MOCK_KEY') && googleCredentials.client_email) {
        client.googleAuthCredentials = googleCredentials;
      }
    }
    return client;
  } catch (err) {
    console.error('Failed to load local config fallback:', err.message);
    return null;
  }
}

// 1. Meta Webhook Verification (Handshake)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  res.sendStatus(400);
});

// 2. Lead Capture Trigger Webhook
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  res.status(200).send('EVENT_RECEIVED');

  try {
    for (const entry of body.entry) {
      if (!entry.changes) continue;
      
      for (const change of entry.changes) {
        if (change.field !== 'leadgen') continue;

        const leadVal = change.value;
        const leadId = leadVal.leadgen_id;
        const pageId = leadVal.page_id;
        const formId = leadVal.form_id;
        const timestamp = leadVal.created_time;

        console.log(`[Lead Triggered] Lead ID: ${leadId} for Page: ${pageId}, Form: ${formId}`);

        const clientConfig = await getClientConfig(pageId, formId);
        if (!clientConfig) {
          console.error(`[Error] Configuration not found for Page ID ${pageId} and Form ID ${formId}`);
          addLog('Unknown Client', formId, leadId, 'Failed', `Routing config not found for Page ID ${pageId} and Form ID ${formId}`);
          continue;
        }

        const pageAccessToken = clientConfig.pageAccessToken;
        const leadUrl = `https://graph.facebook.com/v19.0/${leadId}?access_token=${pageAccessToken}`;
        
        let leadData;
        try {
          const leadRes = await axios.get(leadUrl);
          leadData = leadRes.data;
        } catch (apiErr) {
          console.error(`[Error] Meta API Lead fetch failed for Lead ID ${leadId}:`, apiErr.response?.data || apiErr.message);
          addLog(clientConfig.clientName, clientConfig.metaFormName || formId, leadId, 'Failed', `Meta Graph API lead fetch failed: ${apiErr.message}`);
          continue;
        }

        const metaFields = {
          'Lead ID': leadId,
          'Form Name': clientConfig.metaFormName || formId,
          'Campaign Name': leadVal.campaign_name || 'N/A',
          'Ad Set Name': leadVal.adgroup_name || 'N/A',
          'Ad Name': leadVal.ad_name || 'N/A',
          'Submission Time': new Date(timestamp * 1000).toISOString()
        };

        if (leadData.field_data) {
          leadData.field_data.forEach(item => {
            if (item.values && item.values.length > 0) {
              metaFields[item.name] = item.values[0];
            }
          });
        }

        const mappedRow = {};
        const fieldMapping = clientConfig.mappings;

        for (const [metaField, targetHeader] of Object.entries(fieldMapping)) {
          if (targetHeader) {
            mappedRow[targetHeader] = metaFields[metaField] || '';
          }
        }

        if (!mappedRow['Lead ID'] && fieldMapping['Lead ID']) {
          mappedRow[fieldMapping['Lead ID']] = leadId;
        }

        try {
          if (clientConfig.googleSpreadsheetId.includes('MOCK_SHEET_ID') || 
              (clientConfig.googleAuthCredentials && clientConfig.googleAuthCredentials.client_email && clientConfig.googleAuthCredentials.client_email.includes('MOCK_KEY'))) {
            addLog(clientConfig.clientName, clientConfig.metaFormName || formId, leadId, 'Success', 'Executed in Webhook Mode (Simulated sheet sync).');
            console.log(`[Success] Lead ${leadId} synchronized successfully (Simulated).`);
          } else {
            await appendOrUpdateLead(
              clientConfig.googleSpreadsheetId,
              clientConfig.googleWorksheetName,
              leadId,
              mappedRow,
              clientConfig.googleAuthCredentials || googleCredentials
            );
            addLog(clientConfig.clientName, clientConfig.metaFormName || formId, leadId, 'Success', 'Successfully routed lead payload to active Google Sheets worksheet.');
            console.log(`[Success] Lead ${leadId} synchronized successfully.`);
          }
        } catch (sheetErr) {
          console.error(`[Error] Google Sheets Sync failed for client ${clientConfig.clientName}:`, sheetErr.message);
          addLog(clientConfig.clientName, clientConfig.metaFormName || formId, leadId, 'Failed', `Google Sheets sync failed: ${sheetErr.message}`);
        }
      }
    }
  } catch (globalErr) {
    console.error('[Error] Webhook processor error:', globalErr.message);
  }
});

// ==========================================
// CONFIGS AND LOGS API ENDPOINTS FOR CLIENTS
// ==========================================

app.get('/api/configs', (req, res) => {
  const config = readConfigs();
  res.json(config.clients || []);
});

app.post('/api/configs', (req, res) => {
  const clientConfig = req.body;
  if (!clientConfig.clientId) {
    clientConfig.clientId = 'client_' + Date.now();
  }
  const config = readConfigs();
  const index = config.clients.findIndex(c => c.clientId === clientConfig.clientId);
  if (index !== -1) {
    config.clients[index] = { ...config.clients[index], ...clientConfig };
  } else {
    config.clients.push(clientConfig);
  }
  writeConfigs(config);
  res.json({ success: true, client: clientConfig });
});

app.delete('/api/configs/:id', (req, res) => {
  const clientId = req.params.id;
  const config = readConfigs();
  config.clients = config.clients.filter(c => c.clientId !== clientId);
  writeConfigs(config);
  res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOGS_PATH)) {
      return res.json([]);
    }
    const raw = fs.readFileSync(LOGS_PATH, 'utf8');
    res.json(JSON.parse(raw || '[]'));
  } catch (err) {
    res.json([]);
  }
});

app.post('/api/logs/clear', (req, res) => {
  try {
    fs.writeFileSync(LOGS_PATH, '[]', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// DEVELOPER ACCOUNTS MANAGEMENT ENDPOINTS
// ==========================================
app.get('/api/accounts', (req, res) => {
  const config = readConfigs();
  res.json(config.accounts || { meta: [], google: [] });
});

app.post('/api/accounts', (req, res) => {
  const { type, accountName, credentials } = req.body;
  if (!type || !accountName || !credentials) {
    return res.status(400).json({ error: 'Missing account type, name, or credentials.' });
  }

  const config = readConfigs();
  const id = `${type}_acc_${Date.now()}`;
  const newAccount = { id, name: accountName, credentials };

  if (type === 'meta') {
    config.accounts.meta.push(newAccount);
  } else if (type === 'google') {
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    config.accounts.google.push(newAccount);
  }

  writeConfigs(config);
  res.json({ success: true, account: newAccount });
});

// ==========================================
// REAL OAUTH GATEWAY REDIRECT ROUTING
// ==========================================

// Google OAuth
app.get('/auth/google', (req, res) => {
  const clientId = req.query.clientId || process.env.GOOGLE_CLIENT_ID || '1011300378975-5ppk09s3h8bbqsg0kdmoe12kqpq31755.apps.googleusercontent.com';
  const dynamicRedirect = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || dynamicRedirect;
  const clientSecret = req.query.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';

  // Store temporary params in cookie or session if needed, but for simplicity on localhost we pass state
  const stateObj = { clientId, clientSecret, redirectUri };
  const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

  const scope = encodeURIComponent('https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive');
  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;
  res.redirect(googleUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.send('OAuth failed: No authorization code received.');

  try {
    let clientId = process.env.GOOGLE_CLIENT_ID || '1011300378975-5ppk09s3h8bbqsg0kdmoe12kqpq31755.apps.googleusercontent.com';
    let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const dynamicRedirect = `${req.protocol}://${req.get('host')}/auth/google/callback`;
    let redirectUri = process.env.GOOGLE_REDIRECT_URI || dynamicRedirect;

    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
        if (decoded.clientId) clientId = decoded.clientId;
        if (decoded.clientSecret) clientSecret = decoded.clientSecret;
        if (decoded.redirectUri) redirectUri = decoded.redirectUri;
      } catch (e) {}
    }

    // Exchange auth code for tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const tokens = tokenRes.data;
    
    // Get user profile email
    let email = 'Google Account';
    try {
      const infoRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      email = infoRes.data.email || email;
    } catch (e) {}

    // Store in accounts database
    const config = readConfigs();
    const accountId = `google_acc_${Date.now()}`;
    const newAccount = {
      id: accountId,
      name: `Google (${email})`,
      credentials: {
        type: 'oauth',
        tokens,
        client_email: email
      }
    };
    config.accounts.google.push(newAccount);
    writeConfigs(config);

    // Send message to parent window and close popup
    res.send(`
      <script>
        window.opener.postMessage({
          type: 'GOOGLE_OAUTH_SUCCESS',
          accountId: '${accountId}',
          email: '${email}'
        }, '*');
        window.close();
      </script>
      <h2>Connection Successful!</h2>
      <p>Closing authorization dialog...</p>
    `);
  } catch (err) {
    console.error('Google OAuth exchange error:', err.response?.data || err.message);
    res.status(500).send(`OAuth code exchange error: ${JSON.stringify(err.response?.data || err.message)}`);
  }
});

// Facebook OAuth
app.get('/auth/facebook', (req, res) => {
  const clientId = req.query.clientId || process.env.FB_APP_ID || '652209868906131';
  const dynamicRedirect = `${req.protocol}://${req.get('host')}/auth/facebook/callback`;
  const redirectUri = process.env.FB_REDIRECT_URI || dynamicRedirect;
  const clientSecret = req.query.clientSecret || process.env.FB_APP_SECRET || '';

  const stateObj = { clientId, clientSecret, redirectUri };
  const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

  const scope = encodeURIComponent('pages_show_list,leads_retrieval,ads_management,pages_manage_ads,pages_read_engagement,pages_manage_metadata,business_management');
  const fbUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}&response_type=code`;
  res.redirect(fbUrl);
});

app.get('/auth/facebook/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.send('OAuth failed: No code received.');

  try {
    let clientId = process.env.FB_APP_ID || '652209868906131';
    let clientSecret = process.env.FB_APP_SECRET || '';
    const dynamicRedirect = `${req.protocol}://${req.get('host')}/auth/facebook/callback`;
    let redirectUri = process.env.FB_REDIRECT_URI || dynamicRedirect;

    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
        if (decoded.clientId) clientId = decoded.clientId;
        if (decoded.clientSecret) clientSecret = decoded.clientSecret;
        if (decoded.redirectUri) redirectUri = decoded.redirectUri;
      } catch (e) {}
    }

    const tokenRes = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code
      }
    });

    const tokenData = tokenRes.data;

    // Fetch user details
    let email = 'Meta Account';
    try {
      const meRes = await axios.get(`https://graph.facebook.com/me?fields=name,email&access_token=${tokenData.access_token}`);
      email = meRes.data.email || meRes.data.name || email;
    } catch (e) {}

    // Store in database
    const config = readConfigs();
    const accountId = `meta_acc_${Date.now()}`;
    const newAccount = {
      id: accountId,
      name: `Meta (${email})`,
      credentials: {
        token: tokenData.access_token
      }
    };
    config.accounts.meta.push(newAccount);
    writeConfigs(config);

    res.send(`
      <script>
        window.opener.postMessage({
          type: 'META_OAUTH_SUCCESS',
          accountId: '${accountId}',
          email: '${email}'
        }, '*');
        window.close();
      </script>
      <h2>Connection Successful!</h2>
      <p>Closing authorization dialog...</p>
    `);
  } catch (err) {
    console.error('Meta OAuth exchange error:', err.response?.data || err.message);
    res.status(500).send(`OAuth code exchange error: ${JSON.stringify(err.response?.data || err.message)}`);
  }
});

// ==========================================
// REAL META GRAPH API PROXY ROUTING
// ==========================================

app.get('/api/meta/pages', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing access token.' });

  if (token.startsWith('simulated_') || token === 'mock_token' || token === 'mock') {
    return res.json([
      { id: "page_apex_101", name: "Apex Fitness - Main Page", access_token: "mock_page_token_apex" },
      { id: "page_nova_202", name: "Nova Brands Ltd.", access_token: "mock_page_token_nova" },
      { id: "page_re_303", name: "Premier Properties NY", access_token: "mock_page_token_re" }
    ]);
  }

  try {
    const url = `https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`;
    const response = await axios.get(url);
    const pages = (response.data.data || []).map(p => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token
    }));
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/api/meta/forms', async (req, res) => {
  const { pageId, pageAccessToken } = req.query;
  if (!pageId || !pageAccessToken) {
    return res.status(400).json({ error: 'Missing pageId or pageAccessToken.' });
  }

  if (pageAccessToken.startsWith('mock_')) {
    const defaultMocks = [
      { id: "form_apex_free_pass", name: "Free 7-Day Gym Pass Form", pageId: "page_apex_101" },
      { id: "form_nova_survey", name: "Ecom Marketing Survey Form", pageId: "page_nova_202" },
      { id: "form_re_leads", name: "Condo Pricing Sheet Request Form", pageId: "page_re_303" }
    ];
    return res.json(defaultMocks.filter(f => f.pageId === pageId));
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${pageAccessToken}`;
    const response = await axios.get(url);
    const forms = (response.data.data || []).map(f => ({
      id: f.id,
      name: f.name
    }));
    res.json(forms);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/api/meta/form-fields', async (req, res) => {
  const { formId, pageAccessToken } = req.query;
  if (!formId || !pageAccessToken) {
    return res.status(400).json({ error: 'Missing formId or pageAccessToken.' });
  }

  if (pageAccessToken.startsWith('mock_')) {
    const forms = {
      "form_apex_free_pass": [
        { "name": "Lead ID", "placeholder": "10002938481", "type": "text" },
        { "name": "Full Name", "placeholder": "John Doe", "type": "text" },
        { "name": "Email", "placeholder": "john@example.com", "type": "email" },
        { "name": "Phone Number", "placeholder": "+1 555-019-2831", "type": "tel" },
        { "name": "State", "placeholder": "California", "type": "text" },
        { "name": "Country", "placeholder": "United States", "type": "text" }
      ],
      "form_nova_survey": [
        { "name": "Lead ID", "placeholder": "20004928381", "type": "text" },
        { "name": "Full Name", "placeholder": "Sarah Miller", "type": "text" },
        { "name": "Email", "placeholder": "sarah@novashop.com", "type": "email" },
        { "name": "Phone Number", "placeholder": "+44 20 7946 0912", "type": "tel" },
        { "name": "Business Status", "placeholder": "Established Retailer", "type": "text" },
        { "name": "E-commerce Experience", "placeholder": "Over 3 Years", "type": "text" },
        { "name": "Interested Reason", "placeholder": "Scaling international ads", "type": "text" }
      ],
      "form_re_leads": [
        { "name": "Lead ID", "placeholder": "3000982839", "type": "text" },
        { "name": "Full Name", "placeholder": "Alice Watson", "type": "text" },
        { "name": "Email", "placeholder": "alice@gmail.com", "type": "email" },
        { "name": "Phone Number", "placeholder": "+1 202-555-0144", "type": "tel" },
        { "name": "Interested Reason", "placeholder": "Condo pricing request", "type": "text" }
      ]
    };
    return res.json(forms[formId] || []);
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${formId}?fields=questions&access_token=${pageAccessToken}`;
    const response = await axios.get(url);
    const questions = (response.data.questions || []).map(q => ({
      name: q.key,
      placeholder: q.label || '',
      type: 'text'
    }));
    questions.unshift({ name: 'Lead ID', placeholder: 'Lead ID generated by Meta', type: 'text' });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ==========================================
// REAL GOOGLE SHEETS API PROXY ROUTING
// ==========================================

function getSheetsService(credentials) {
  let auth;
  if (credentials.type === 'oauth') {
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || '1011300378975-5ppk09s3h8bbqsg0kdmoe12kqpq31755.apps.googleusercontent.com',
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
  return google.sheets({ version: 'v4', auth });
}

function getDriveService(credentials) {
  let auth;
  if (credentials.type === 'oauth') {
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || '1011300378975-5ppk09s3h8bbqsg0kdmoe12kqpq31755.apps.googleusercontent.com',
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(credentials.tokens);
  } else {
    auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive.readonly']
    );
  }
  return google.drive({ version: 'v3', auth });
}

// Get Spreadsheets list
app.post('/api/google/sheets/list', async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: 'Missing account ID.' });

  if (accountId.startsWith('simulated_') || accountId.includes('MOCK')) {
    return res.json([
      { id: 'simulated_sheet_leads', name: 'Apex Gym Leads Tracker' },
      { id: 'simulated_sheet_ecom', name: 'Nova E-com Marketing Data' },
      { id: 'simulated_sheet_realestate', name: 'NY Real Estate Form Entries' }
    ]);
  }

  try {
    const config = readConfigs();
    const acc = config.accounts.google.find(g => g.id === accountId);
    if (!acc) return res.status(404).json({ error: 'Selected Google Account credentials not found.' });

    const drive = getDriveService(acc.credentials);
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id, name)',
      pageSize: 100,
      orderBy: 'name'
    });

    res.json(response.data.files || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Worksheet Tabs
app.post('/api/google/sheets/tabs', async (req, res) => {
  const { spreadsheetId, accountId } = req.body;
  if (!spreadsheetId) return res.status(400).json({ error: 'Missing spreadsheet ID.' });

  if (spreadsheetId.startsWith('simulated_') || spreadsheetId.includes('MOCK') || spreadsheetId.includes('...')) {
    return res.json(GOOGLE_WORKSHEETS);
  }

  try {
    const config = readConfigs();
    const acc = config.accounts.google.find(g => g.id === accountId);
    if (!acc) return res.status(404).json({ error: 'Selected Google Account credentials not found.' });

    const sheets = getSheetsService(acc.credentials);
    const response = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const tabs = (response.data.sheets || []).map(s => s.properties.title);
    res.json(tabs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Worksheet Columns Headers
app.post('/api/google/sheets/headers', async (req, res) => {
  const { spreadsheetId, sheetName, accountId } = req.body;
  if (!spreadsheetId || !sheetName) {
    return res.status(400).json({ error: 'Missing spreadsheetId or sheetName.' });
  }

  if (spreadsheetId.startsWith('simulated_') || spreadsheetId.includes('MOCK') || spreadsheetId.includes('...')) {
    const defaultHeaders = {
      "Leads_Raw": ["Lead ID", "Form Name", "Date & Time", "Name", "Email", "Phone", "State", "Country", "Campaign"],
      "SurveyResponses": ["Lead ID", "Form Name", "Date & Time", "Name", "Email", "Phone", "Business Status", "Experience", "Reason", "Campaign", "Ad Set", "Ad"],
      "New_Form_Submissions": ["Lead ID", "Form Name", "Date & Time", "Name", "Email", "Phone", "Reason"]
    };
    return res.json(defaultHeaders[sheetName] || ["Lead ID", "Name", "Email", "Phone"]);
  }

  try {
    const config = readConfigs();
    const acc = config.accounts.google.find(g => g.id === accountId);
    if (!acc) return res.status(404).json({ error: 'Selected Google Account credentials not found.' });

    const sheets = getSheetsService(acc.credentials);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Z1`
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Worksheet is empty. Column headers must be defined in the first row.' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// TEST SIMULATION LEAD ENGINE
// ==========================================
app.post('/api/test-lead', async (req, res) => {
  const { clientId, leadId, formValues, isDuplicate } = req.body;
  const config = readConfigs();
  const clientConfig = config.clients.find(c => c.clientId === clientId);
  if (!clientConfig) {
    return res.status(404).json({ error: 'Client configuration not found.' });
  }

  try {
    const metaFields = {
      'Lead ID': leadId,
      'Form Name': clientConfig.metaFormName || clientConfig.metaFormId,
      'Campaign Name': 'Q2 Meta Lead Gen Campaign',
      'Ad Set Name': 'Lookalike Lookups 2%',
      'Ad Name': 'Interactive Video Ad v4',
      'Submission Time': new Date().toISOString(),
      ...formValues
    };

    const mappedRow = {};
    const fieldMapping = clientConfig.mappings;

    for (const [metaField, targetHeader] of Object.entries(fieldMapping)) {
      if (targetHeader) {
        mappedRow[targetHeader] = metaFields[metaField] || '';
      }
    }

    if (!mappedRow['Lead ID'] && fieldMapping['Lead ID']) {
      mappedRow[fieldMapping['Lead ID']] = leadId;
    }

    let isMock = false;
    let details = '';

    if (clientConfig.googleSpreadsheetId.includes('MOCK') || clientConfig.googleSpreadsheetId.includes('simulated') || clientConfig.googleSpreadsheetId.includes('...')) {
      isMock = true;
      details = isDuplicate 
        ? `[Deduplication Match] Lead ID ${leadId} already exists. Mock updated row contents.` 
        : 'Lead data validated. Mock appended new row successfully.';
    } else {
      let googleAuth = googleCredentials;
      if (clientConfig.googleAccountId) {
        const acc = config.accounts.google.find(g => g.id === clientConfig.googleAccountId);
        if (acc) {
          googleAuth = acc.credentials;
        }
      }

      await appendOrUpdateLead(
        clientConfig.googleSpreadsheetId,
        clientConfig.googleWorksheetName,
        leadId,
        mappedRow,
        googleAuth
      );
      details = isDuplicate
        ? `[Deduplication Match] Lead ID ${leadId} existed. Updated active row cells via Sheets API.`
        : 'Successfully appended new lead record via Google Sheets v4 API.';
    }

    addLog(
      clientConfig.clientName,
      clientConfig.metaFormName || clientConfig.metaFormId,
      leadId,
      'Success',
      details
    );

    res.json({ success: true, isMock, details });
  } catch (err) {
    addLog(
      clientConfig.clientName,
      clientConfig.metaFormName || clientConfig.metaFormId,
      leadId,
      'Failed',
      err.message
    );
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cloud Server active on port ${PORT}`);
  console.log(`Interactive Admin Hub available at http://localhost:3000/`);
});
