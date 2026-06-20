// app.js - Controller for Meta Lead Ads to Google Sheets Hub
(function() {
  const GOOGLE_WORKSHEETS = ["Leads_Raw", "SurveyResponses", "New_Form_Submissions", "Archive"];

  let state = {
    clients: [],
    accounts: { meta: [], google: [] },
    activeClientId: null,
    lastSubmittedLead: null,
    theme: 'dark',
    activeTab: 'dashboard'
  };

  // DOM elements cache
  const el = {
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    resetAppBtn: document.getElementById('reset-app-btn'),
    tabDashboard: document.getElementById('tab-dashboard'),
    tabLogs: document.getElementById('tab-logs'),
    tabBackend: document.getElementById('tab-backend'),
    sectionDashboardView: document.getElementById('section-dashboard-view'),
    sectionEditorView: document.getElementById('section-editor-view'),
    sectionLogsContent: document.getElementById('section-logs-content'),
    sectionBackendContent: document.getElementById('section-backend-content'),

    workflowsContainer: document.getElementById('workflows-container'),
    createWorkflowBtn: document.getElementById('create-workflow-btn'),

    backToDashboardBtn: document.getElementById('back-to-dashboard-btn'),
    editorWorkflowTitle: document.getElementById('editor-workflow-title'),
    editorWorkflowStatusToggle: document.getElementById('editor-workflow-status-toggle'),
    editorWorkflowNameInput: document.getElementById('editor-workflow-name-input'),

    // Meta Node elements
    metaConnNew: document.getElementById('meta-conn-new'),
    metaConnExisting: document.getElementById('meta-conn-existing'),
    metaNewConnectionFields: document.getElementById('meta-new-connection-fields'),
    metaExistingConnectionFields: document.getElementById('meta-existing-connection-fields'),
    metaNewConnectionName: document.getElementById('meta-new-connection-name'),
    editorMetaConnectBtn: document.getElementById('editor-meta-connect-btn'),
    metaAccountsSelect: document.getElementById('meta-accounts-select'),
    metaConfigFields: document.getElementById('meta-config-fields'),
    editorFbPage: document.getElementById('editor-fb-page'),
    editorLeadForm: document.getElementById('editor-lead-form'),

    // Google Node elements
    googleConnNew: document.getElementById('google-conn-new'),
    googleConnExisting: document.getElementById('google-conn-existing'),
    googleNewConnectionFields: document.getElementById('google-new-connection-fields'),
    googleExistingConnectionFields: document.getElementById('google-existing-connection-fields'),
    googleNewConnectionName: document.getElementById('google-new-connection-name'),
    editorGoogleConnectBtn: document.getElementById('editor-google-connect-btn'),
    googleAccountsSelect: document.getElementById('google-accounts-select'),
    googleConfigFields: document.getElementById('google-config-fields'),
    editorGoogleSpreadsheetSelect: document.getElementById('editor-google-spreadsheet-select'),
    editorGoogleSpreadsheetInput: document.getElementById('editor-google-spreadsheet-input'),
    editorFetchTabsBtn: document.getElementById('editor-fetch-tabs-btn'),
    toggleSpreadsheetInputBtn: document.getElementById('toggle-spreadsheet-input-btn'),
    spreadsheetSelectContainer: document.getElementById('spreadsheet-select-container'),
    spreadsheetInputContainer: document.getElementById('spreadsheet-input-container'),
    editorGoogleWorksheet: document.getElementById('editor-google-worksheet'),
    toggleWorksheetInputBtn: document.getElementById('toggle-worksheet-input-btn'),
    worksheetSelectContainer: document.getElementById('worksheet-select-container'),
    worksheetInputContainer: document.getElementById('worksheet-input-container'),
    editorGoogleWorksheetInput: document.getElementById('editor-google-worksheet-input'),
    editorSaveTabManualBtn: document.getElementById('editor-save-tab-manual-btn'),
    toggleColumnsInputBtn: document.getElementById('toggle-columns-input-btn'),
    columnsInputContainer: document.getElementById('columns-input-container'),
    editorManualColumnsInput: document.getElementById('editor-manual-columns-input'),
    editorSaveColumnsManualBtn: document.getElementById('editor-save-columns-manual-btn'),
    mappingFieldsContainer: document.getElementById('mapping-fields-container'),
    editorAutoMatchBtn: document.getElementById('editor-auto-match-btn'),
    editorMappingList: document.getElementById('editor-mapping-list'),

    // Test Sandbox Node
    editorTestSection: document.getElementById('editor-test-section'),
    editorTestInputs: document.getElementById('editor-test-inputs'),
    editorTestSendBtn: document.getElementById('editor-test-send-btn'),
    editorTestDuplicateBtn: document.getElementById('editor-test-duplicate-btn'),
    editorTestResponse: document.getElementById('editor-test-response'),

    editorSaveBtn: document.getElementById('editor-save-btn'),
    editorCancelBtn: document.getElementById('editor-cancel-btn'),

    // History Table Logs
    syncHistoryBody: document.getElementById('sync-history-body'),
    clearDbLogsBtn: document.getElementById('clear-db-logs-btn'),

    // Pabbly style popup modal
    oauthModal: document.getElementById('oauth-modal'),
    pabblyModalTitle: document.getElementById('pabbly-modal-title'),
    modalPabblyLoginContent: document.getElementById('modal-pabbly-login-content'),
    modalSpinnerContent: document.getElementById('modal-spinner-content'),
    modalPabblyLoginBtn: document.getElementById('modal-pabbly-login-btn'),
    modalCancelBtn: document.getElementById('modal-cancel-btn'),
    codeServerDisplay: document.getElementById('code-server-display'),
    codeSheetsDisplay: document.getElementById('code-sheets-display')
  };

  // 1. Backend API Helpers
  async function fetchWorkflows() {
    try {
      const response = await fetch('/api/configs');
      if (response.ok) {
        state.clients = await response.json();
      }
    } catch (e) {
      console.warn('Backend configurations endpoint offline.');
    }
  }

  async function fetchAccounts() {
    try {
      const response = await fetch('/api/accounts');
      if (response.ok) {
        state.accounts = await response.json();
      }
    } catch (e) {
      console.warn('Backend accounts endpoint offline.');
    }
  }

  async function saveWorkflow(client) {
    try {
      await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(client)
      });
    } catch (e) {
      console.warn('Backend configurations save endpoint offline.');
    }
  }

  async function saveAccount(type, name, credentials) {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, accountName: name, credentials })
      });
      if (res.ok) {
        const data = await res.json();
        await fetchAccounts();
        populateAccountsDropdowns();
        return data.account;
      }
    } catch (e) {
      console.warn('Backend accounts save endpoint offline.');
    }
    return null;
  }

  function getActiveClient() {
    return state.clients.find(c => c.clientId === state.activeClientId);
  }

  function populateAccountsDropdowns() {
    const metaAccounts = (state.accounts && state.accounts.meta) || [];
    const googleAccounts = (state.accounts && state.accounts.google) || [];

    el.metaAccountsSelect.innerHTML = '<option value="">-- Choose Logged Connection --</option>' +
      metaAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

    el.googleAccountsSelect.innerHTML = '<option value="">-- Choose Logged Connection --</option>' +
      googleAccounts.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  }

  // 2. Workflows Dashboard list view
  function renderWorkflowsList() {
    el.workflowsContainer.innerHTML = '';
    
    if (state.clients.length === 0) {
      el.workflowsContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 48px; border: 1px dashed var(--border-color); border-radius: var(--radius-lg); background: var(--bg-secondary);">
          <h3>No Workflows Configured</h3>
          <p class="section-subtitle" style="margin-top: 8px;">Create a new workflow to link your Meta Lead Ads form to a Google Sheet.</p>
        </div>
      `;
      return;
    }

    state.clients.forEach(c => {
      const card = document.createElement('div');
      card.className = 'workflow-card';
      const statusChecked = c.isActive !== false ? 'checked' : '';

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 16px;">
          <div class="editor-node-icon meta-icon" style="width: 32px; height: 32px; font-size: 0.9rem;">M</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-muted);">&rarr;</div>
          <div class="editor-node-icon sheets-icon" style="width: 32px; height: 32px; font-size: 0.9rem;">田</div>
          <div style="margin-left: 8px;">
            <h3 style="font-size: 1rem; font-weight: 600; color: var(--text-primary);">${c.clientName}</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">
              Meta Form: <strong>${c.metaFormName || c.metaFormId || 'N/A'}</strong> &rarr; Tab: <strong>${c.googleWorksheetName || 'N/A'}</strong>
            </p>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 20px;">
          <label class="switch">
            <input type="checkbox" class="workflow-toggle" data-id="${c.clientId}" ${statusChecked}>
            <span class="slider"></span>
          </label>
          <button class="btn btn-secondary workflow-edit-btn" data-id="${c.clientId}" style="padding: 6px 12px; font-size: 0.8rem;">Edit</button>
          <button class="btn btn-secondary workflow-delete-btn" data-id="${c.clientId}" style="padding: 6px 12px; font-size: 0.8rem; border-color: rgba(239,68,68,0.2); color: var(--danger);">Delete</button>
        </div>
      `;

      card.querySelector('.workflow-toggle').addEventListener('change', (e) => {
        c.isActive = e.target.checked;
        saveWorkflow(c);
      });

      card.querySelector('.workflow-edit-btn').addEventListener('click', () => {
        state.activeClientId = c.clientId;
        loadWorkflowIntoEditor();
      });

      card.querySelector('.workflow-delete-btn').addEventListener('click', () => {
        if (confirm(`Delete workflow: ${c.clientName}?`)) {
          fetch(`/api/configs/${c.clientId}`, { method: 'DELETE' }).then(() => {
            state.clients = state.clients.filter(item => item.clientId !== c.clientId);
            renderWorkflowsList();
          });
        }
      });

      el.workflowsContainer.appendChild(card);
    });
  }

  // 3. Workflow Editor Canvas
  function loadWorkflowIntoEditor() {
    const client = getActiveClient();
    if (!client) return;

    el.sectionDashboardView.style.display = 'none';
    el.sectionLogsContent.style.display = 'none';
    el.sectionBackendContent.style.display = 'none';
    el.sectionEditorView.style.display = 'block';

    el.editorWorkflowTitle.textContent = client.clientName || 'New Workflow Bridge';
    el.editorWorkflowNameInput.value = client.clientName || '';
    el.editorWorkflowStatusToggle.checked = client.isActive !== false;

    if (client.metaAccountId) {
      el.metaConnExisting.checked = true;
      toggleMetaConnFields('existing');
      el.metaAccountsSelect.value = client.metaAccountId;
      el.metaConfigFields.style.display = 'block';
      fetchMetaPages(client.metaAccountId).then(() => {
        el.editorFbPage.value = client.metaPageId || '';
        if (client.metaPageId) {
          fetchMetaForms(client.metaPageId).then(() => {
            el.editorLeadForm.value = client.metaFormId || '';
            if (client.metaFormId) {
              fetchMetaFormFields(client.metaFormId);
            }
          });
        }
      });
    } else {
      el.metaConnNew.checked = true;
      toggleMetaConnFields('new');
      el.metaNewConnectionName.value = `Facebook Lead Ads #${((state.accounts && state.accounts.meta) || []).length + 1}`;
      el.metaConfigFields.style.display = 'none';
    }

    if (client.googleAccountId) {
      el.googleConnExisting.checked = true;
      toggleGoogleConnFields('existing');
      el.googleAccountsSelect.value = client.googleAccountId;
      el.googleConfigFields.style.display = 'block';
      fetchGoogleSpreadsheets(client.googleAccountId).then(() => {
        el.spreadsheetSelectContainer.style.display = 'block';
        el.spreadsheetInputContainer.style.display = 'none';
        el.toggleSpreadsheetInputBtn.textContent = '🔗 Paste Link/ID instead';

        el.editorGoogleSpreadsheetSelect.value = client.googleSpreadsheetId || '';
        el.editorGoogleSpreadsheetInput.value = client.googleSpreadsheetId || '';

        // If spreadsheetId is saved but not found in the dropdown options, switch to manual input mode
        if (client.googleSpreadsheetId && !el.editorGoogleSpreadsheetSelect.value) {
          el.spreadsheetSelectContainer.style.display = 'none';
          el.spreadsheetInputContainer.style.display = 'flex';
          el.toggleSpreadsheetInputBtn.textContent = '📋 Select from List instead';
        }

        if (client.googleSpreadsheetId) {
          fetchGoogleWorksheets(client.googleSpreadsheetId, client.googleAccountId).then(() => {
            el.editorGoogleWorksheet.value = client.googleWorksheetName || '';
            el.editorGoogleWorksheet.disabled = false;
            if (client.googleWorksheetName) {
              fetchGoogleHeaders(client.googleSpreadsheetId, client.googleWorksheetName, client.googleAccountId);
            }
          });
        }
      });
    } else {
      el.googleConnNew.checked = true;
      toggleGoogleConnFields('new');
      el.googleNewConnectionName.value = `Google Sheets #${((state.accounts && state.accounts.google) || []).length + 1}`;
      el.googleConfigFields.style.display = 'none';
    }

    el.mappingFieldsContainer.style.display = 'none';
    el.editorTestSection.style.display = 'none';
  }

  function toggleMetaConnFields(mode) {
    if (mode === 'new') {
      el.metaNewConnectionFields.style.display = 'block';
      el.metaExistingConnectionFields.style.display = 'none';
    } else {
      el.metaNewConnectionFields.style.display = 'none';
      el.metaExistingConnectionFields.style.display = 'block';
    }
  }

  function toggleGoogleConnFields(mode) {
    if (mode === 'new') {
      el.googleNewConnectionFields.style.display = 'block';
      el.googleExistingConnectionFields.style.display = 'none';
    } else {
      el.googleNewConnectionFields.style.display = 'none';
      el.googleExistingConnectionFields.style.display = 'block';
    }
  }

  // 4. API Dropdowns Population Actions
  async function fetchMetaPages(accountId) {
    const acc = state.accounts.meta.find(a => a.id === accountId);
    if (!acc) return;
    try {
      const response = await fetch(`/api/meta/pages?token=${acc.credentials.token}`);
      if (response.ok) {
        const pages = await response.json();
        el.editorFbPage.innerHTML = '<option value="">-- Choose Facebook Page --</option>' +
          pages.map(p => `<option value="${p.id}" data-token="${p.access_token}">${p.name}</option>`).join('');
      }
    } catch (e) {
      console.error('Failed fetching pages list.');
    }
  }

  async function fetchMetaForms(pageId) {
    const pageOption = el.editorFbPage.querySelector(`option[value="${pageId}"]`);
    if (!pageOption) return;
    const pageAccessToken = pageOption.dataset.token;
    
    try {
      const response = await fetch(`/api/meta/forms?pageId=${pageId}&pageAccessToken=${pageAccessToken}`);
      if (response.ok) {
        const forms = await response.json();
        el.editorLeadForm.innerHTML = '<option value="">-- Select Lead Form --</option>' +
          forms.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
      }
    } catch (e) {
      console.error('Failed fetching forms.');
    }
  }

  async function fetchMetaFormFields(formId) {
    const pageOption = el.editorFbPage.querySelector(`option[value="${el.editorFbPage.value}"]`);
    if (!pageOption) return;
    const pageAccessToken = pageOption.dataset.token;

    try {
      const response = await fetch(`/api/meta/form-fields?formId=${formId}&pageAccessToken=${pageAccessToken}`);
      if (response.ok) {
        const fields = await response.json();
        const client = getActiveClient();
        client.formFields = fields;
        saveWorkflow(client);
        checkRenderMappingNode();
      }
    } catch (e) {
      console.error('Failed fetching fields.');
    }
  }

  async function fetchGoogleSpreadsheets(accountId) {
    try {
      const response = await fetch('/api/google/sheets/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId })
      });
      if (response.ok) {
        const files = await response.json();
        el.editorGoogleSpreadsheetSelect.innerHTML = '<option value="">-- Choose Spreadsheet --</option>' +
          files.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
      } else {
        const errData = await response.json();
        const detailsStr = typeof errData.details === 'object' ? JSON.stringify(errData.details) : errData.details;
        alert(`Failed to load Google Spreadsheets:\nError: ${errData.error || 'Unknown Error'}\nDetails: ${detailsStr || 'None'}`);
      }
    } catch (e) {
      console.error('Failed fetching spreadsheets list.', e);
      alert(`Network error fetching spreadsheets:\n${e.message}`);
    }
  }

  async function fetchGoogleWorksheets(spreadsheetId, accountId) {
    try {
      const response = await fetch('/api/google/sheets/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, accountId })
      });
      if (response.ok) {
        const tabs = await response.json();
        el.editorGoogleWorksheet.innerHTML = '<option value="">-- Choose Tab --</option>' +
          tabs.map(t => `<option value="${t}">${t}</option>`).join('');
      } else {
        const errData = await response.json();
        alert(`Failed to fetch Worksheet Tabs:\nError: ${errData.error || 'Unknown Error'}`);
      }
    } catch (e) {
      console.error('Failed fetching tabs.', e);
      alert(`Network error fetching worksheet tabs:\n${e.message}`);
    }
  }

  async function fetchGoogleHeaders(spreadsheetId, sheetName, accountId) {
    try {
      const response = await fetch('/api/google/sheets/headers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, sheetName, accountId })
      });
      if (response.ok) {
        const headers = await response.json();
        const client = getActiveClient();
        client.sheetHeaders = headers;
        saveWorkflow(client);
        checkRenderMappingNode();
      } else {
        const errData = await response.json();
        alert(`Failed to fetch Worksheet Columns:\nError: ${errData.error || 'Unknown Error'}`);
      }
    } catch (e) {
      console.error('Failed fetching headers.', e);
      alert(`Network error fetching columns:\n${e.message}`);
    }
  }

  function checkRenderMappingNode() {
    const client = getActiveClient();
    if (client && client.formFields && client.sheetHeaders) {
      el.mappingFieldsContainer.style.display = 'block';
      renderEditorMappingList();
      el.editorTestSection.style.display = 'block';
      renderEditorTestInputs();
    }
  }

  // Renders mapped fields
  function renderEditorMappingList() {
    const client = getActiveClient();
    if (!client) return;

    el.editorMappingList.innerHTML = '';

    client.sheetHeaders.forEach(header => {
      const row = document.createElement('div');
      row.className = 'mapping-item';

      const label = document.createElement('div');
      label.className = 'mapping-meta-field';
      label.textContent = header;

      const selector = document.createElement('select');
      selector.className = 'form-select';
      selector.style.padding = '6px 10px';

      const formFieldsOptions = (client.formFields || []).map(f => {
        const selected = client.mappings[f.name] === header ? 'selected' : '';
        return `<option value="${f.name}" ${selected}>Meta Parameter: ${f.name}</option>`;
      });

      const metaMetadataFields = ["Form Name", "Submission Time", "Campaign Name", "Ad Set Name", "Ad Name"];
      const metaMetadataOptions = metaMetadataFields.map(f => {
        const selected = client.mappings[f] === header ? 'selected' : '';
        return `<option value="${f}" ${selected}>Meta Metadata: ${f}</option>`;
      });

      selector.innerHTML = `
        <option value="">[Do Not Sync]</option>
        <optgroup label="Lead Form Responses">
          ${formFieldsOptions.join('')}
        </optgroup>
        <optgroup label="Meta Ad Metadata">
          ${metaMetadataOptions.join('')}
        </optgroup>
      `;

      selector.addEventListener('change', (e) => {
        const selectedMetaField = e.target.value;
        Object.keys(client.mappings).forEach(k => {
          if (client.mappings[k] === header) {
            client.mappings[k] = '';
          }
        });
        if (selectedMetaField) {
          client.mappings[selectedMetaField] = header;
        }
        saveWorkflow(client);
      });

      row.appendChild(label);
      row.appendChild(selector);
      el.editorMappingList.appendChild(row);
    });
  }

  function runEditorAutoMatch() {
    const client = getActiveClient();
    if (!client) return;

    client.sheetHeaders.forEach(header => {
      const normalizedHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      const matchedField = (client.formFields || []).find(f => {
        const normalized = f.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalized.includes(normalizedHeader) || normalizedHeader.includes(normalized);
      });

      if (matchedField) {
        client.mappings[matchedField.name] = header;
        return;
      }

      const metadataFields = ["Form Name", "Submission Time", "Campaign Name", "Ad Set Name", "Ad Name"];
      const matchedMeta = metadataFields.find(f => {
        const normalized = f.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized === 'submissiontime' && normalizedHeader.includes('date')) return true;
        return normalized.includes(normalizedHeader) || normalizedHeader.includes(normalized);
      });

      if (matchedMeta) {
        client.mappings[matchedMeta] = header;
      }
    });

    saveWorkflow(client);
    renderEditorMappingList();
  }

  // 5. Pabbly Auth Modal Flow Simulator
  let oauthTargetType = null;
  function triggerPabblyModal(type) {
    oauthTargetType = type;
    el.modalPabblyLoginContent.style.display = 'block';
    el.modalSpinnerContent.style.display = 'none';

    if (type === 'meta') {
      el.pabblyModalTitle.textContent = 'Connect Facebook Lead Ads';
    } else {
      el.pabblyModalTitle.textContent = 'Connect Google Sheets';
    }

    el.oauthModal.classList.add('active');
  }

  // Actually redirecting to oauth flow
  function startActualOAuthRedirect() {
    const width = 600;
    const height = 650;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    
    const url = oauthTargetType === 'meta' ? '/auth/facebook' : '/auth/google';
    
    window.open(url, `${oauthTargetType.toUpperCase()}_OAuth`, `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`);
    el.oauthModal.classList.remove('active');
  }

  // Listen to OAuth Callback Messages
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || !data.type) return;

    const client = getActiveClient();
    if (!client) return;

    if (data.type === 'META_OAUTH_SUCCESS') {
      await fetchAccounts();
      populateAccountsDropdowns();

      client.metaAccountId = data.accountId;
      client.metaAccount = data.email || 'Meta Account';
      saveWorkflow(client);

      el.metaConnExisting.checked = true;
      toggleMetaConnFields('existing');
      el.metaAccountsSelect.value = data.accountId;
      el.metaConfigFields.style.display = 'block';
      fetchMetaPages(data.accountId);

    } else if (data.type === 'GOOGLE_OAUTH_SUCCESS') {
      await fetchAccounts();
      populateAccountsDropdowns();

      client.googleAccountId = data.accountId;
      client.googleAccount = data.email || 'Google Sheets';
      saveWorkflow(client);

      el.googleConnExisting.checked = true;
      toggleGoogleConnFields('existing');
      el.googleAccountsSelect.value = data.accountId;
      el.googleConfigFields.style.display = 'block';
      fetchGoogleSpreadsheets(data.accountId);
    }
  });

  // 6. Test Injector Inputs
  function renderEditorTestInputs() {
    const client = getActiveClient();
    if (!client) return;

    el.editorTestInputs.innerHTML = '';
    
    (client.formFields || []).forEach(field => {
      if (field.name === 'Lead ID') return;

      const group = document.createElement('div');
      group.className = 'form-group';
      group.style.margin = '0';

      const label = document.createElement('label');
      label.textContent = field.name;

      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.className = 'form-input';
      input.placeholder = field.placeholder || '';
      input.dataset.fieldName = field.name;
      input.value = getRandomMockText(field.name);

      group.appendChild(label);
      group.appendChild(input);
      el.editorTestInputs.appendChild(group);
    });
  }

  function getRandomMockText(fieldName) {
    const mocks = {
      "Full Name": ["Thomas Anderson", "Bruce Miller", "Linda Croft", "Selina Kyle", "Arthur Dent"],
      "Email": ["neo@matrix.co", "bruce@millers.org", "linda@croft.com", "selina@wayne.com", "arthur@galaxy.net"],
      "Phone Number": ["+1 415-555-9831", "+1 312-555-8910", "+1 202-555-4309", "+1 650-555-0199", "+44 20 7946 0192"],
      "State": ["California", "Illinois", "New York", "Texas", "London"],
      "Country": ["United States", "United States", "United States", "United States", "United Kingdom"]
    };
    if (mocks[fieldName]) {
      const idx = Math.floor(Math.random() * mocks[fieldName].length);
      return mocks[fieldName][idx];
    }
    return 'Mock Value';
  }

  async function testEditorSend(isDuplicate = false) {
    const client = getActiveClient();
    if (!client) return;

    el.editorTestResponse.style.display = 'block';
    el.editorTestResponse.style.color = '#34d399';
    el.editorTestResponse.textContent = 'Sending webhook payload post request to API...';

    let leadId;
    let values = {};

    if (isDuplicate && state.lastSubmittedLead) {
      leadId = state.lastSubmittedLead.leadId;
      values = state.lastSubmittedLead.values;
    } else {
      leadId = String(Math.floor(1000000000 + Math.random() * 9000000000));
      
      const inputs = el.editorTestInputs.querySelectorAll('.form-input');
      inputs.forEach(input => {
        values[input.dataset.fieldName] = input.value;
      });

      state.lastSubmittedLead = { leadId, values: JSON.parse(JSON.stringify(values)) };
    }

    try {
      const response = await fetch('/api/test-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.clientId,
          leadId,
          formValues: values,
          isDuplicate
        })
      });

      const resData = await response.json();
      
      if (response.ok) {
        el.editorTestResponse.innerHTML = `
          <div>Sync Request: <strong>Success (200 OK)</strong></div>
          <div style="margin-top: 4px; color: #94a3b8;">${resData.details}</div>
          <div style="margin-top: 4px; color: #f59e0b;">Webhook payload: ${JSON.stringify({ leadId, formValues: values })}</div>
        `;
      } else {
        el.editorTestResponse.style.color = '#f87171';
        el.editorTestResponse.textContent = `Sync Request failed: ${resData.error}`;
      }
    } catch (e) {
      el.editorTestResponse.style.color = '#f87171';
      el.editorTestResponse.textContent = `Router offline: ${e.message}`;
    }
  }

  // 7. Sync logs history list
  async function fetchHistoryLogs() {
    try {
      const response = await fetch('/api/logs');
      if (!response.ok) return;
      const logs = await response.json();

      el.syncHistoryBody.innerHTML = '';
      
      if (logs.length === 0) {
        el.syncHistoryBody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No sync log events found. Ingest leads to generate entries.</td>
          </tr>
        `;
        return;
      }

      logs.forEach(log => {
        const tr = document.createElement('tr');
        const badgeClass = log.status.toLowerCase() === 'success' ? 'success' : 'failed';
        const timestamp = new Date(log.timestamp).toLocaleString();

        tr.innerHTML = `
          <td>${timestamp}</td>
          <td><strong>${log.clientName}</strong></td>
          <td><code>${log.metaFormName}</code></td>
          <td><code>${log.leadId}</code></td>
          <td><span class="logs-status-badge ${badgeClass}">${log.status}</span></td>
          <td>${log.details}</td>
        `;
        el.syncHistoryBody.appendChild(tr);
      });
    } catch (e) {
      console.warn('Unable to query logs history.', e);
    }
  }

  // 8. Navigation Tab Controllers
  function switchTab(tabName) {
    state.activeTab = tabName;

    el.tabDashboard.classList.remove('active');
    el.tabLogs.classList.remove('active');
    el.tabBackend.classList.remove('active');

    el.sectionDashboardView.style.display = 'none';
    el.sectionEditorView.style.display = 'none';
    el.sectionLogsContent.style.display = 'none';
    el.sectionBackendContent.style.display = 'none';

    if (tabName === 'dashboard') {
      el.tabDashboard.classList.add('active');
      el.sectionDashboardView.style.display = 'block';
      renderWorkflowsList();
    } else if (tabName === 'logs') {
      el.tabLogs.classList.add('active');
      el.sectionLogsContent.style.display = 'block';
      fetchHistoryLogs();
    } else if (tabName === 'backend') {
      el.tabBackend.classList.add('active');
      el.sectionBackendContent.style.display = 'block';
    }
  }

  // 9. Event Listeners Setup
  function setupEventListeners() {
    el.themeToggleBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', state.theme);
      localStorage.setItem('theme_preference', state.theme);
    });

    el.resetAppBtn.addEventListener('click', async () => {
      if (confirm('Reset dashboard config data to initial settings?')) {
        state.clients = [];
        await saveWorkflow({ clientId: 'clear' });
        await fetchWorkflows();
        switchTab('dashboard');
      }
    });

    el.tabDashboard.addEventListener('click', () => switchTab('dashboard'));
    el.tabLogs.addEventListener('click', () => switchTab('logs'));
    el.tabBackend.addEventListener('click', () => switchTab('backend'));

    el.createWorkflowBtn.addEventListener('click', () => {
      const clientName = prompt('Enter Workflow Name:', 'Acme Corp Leads Bridge');
      if (!clientName) return;

      const newId = 'client_' + Date.now();
      const newClient = {
        "clientId": newId,
        "clientName": clientName,
        "metaAccountId": "",
        "metaPageId": "",
        "metaPageName": "",
        "metaFormId": "",
        "metaFormName": "",
        "googleAccountId": "",
        "googleSpreadsheetId": "",
        "googleSpreadsheetName": "",
        "googleWorksheetName": "",
        "isActive": true,
        "mappings": {},
        "formFields": [],
        "sheetHeaders": [],
        "sheetRows": []
      };

      state.clients.push(newClient);
      state.activeClientId = newId;
      saveWorkflow(newClient);
      loadWorkflowIntoEditor();
    });

    el.backToDashboardBtn.addEventListener('click', () => switchTab('dashboard'));
    el.editorCancelBtn.addEventListener('click', () => switchTab('dashboard'));

    // Connection Radios Toggle Listeners
    el.metaConnNew.addEventListener('change', () => toggleMetaConnFields('new'));
    el.metaConnExisting.addEventListener('change', () => toggleMetaConnFields('existing'));
    el.googleConnNew.addEventListener('change', () => toggleGoogleConnFields('new'));
    el.googleConnExisting.addEventListener('change', () => toggleGoogleConnFields('existing'));

    // Connection button triggers pabbly auth modal popup
    el.editorMetaConnectBtn.addEventListener('click', () => triggerPabblyModal('meta'));
    el.editorGoogleConnectBtn.addEventListener('click', () => triggerPabblyModal('google'));

    // Modal login button actions redirecting to actual OAuth
    el.modalPabblyLoginBtn.addEventListener('click', () => startActualOAuthRedirect());
    el.modalCancelBtn.addEventListener('click', () => el.oauthModal.classList.remove('active'));

    // Select options connection accounts selection
    el.metaAccountsSelect.addEventListener('change', () => {
      const client = getActiveClient();
      if (client) {
        client.metaAccountId = el.metaAccountsSelect.value;
        saveWorkflow(client);
        if (client.metaAccountId) {
          el.metaConfigFields.style.display = 'block';
          fetchMetaPages(client.metaAccountId);
        } else {
          el.metaConfigFields.style.display = 'none';
        }
      }
    });

    el.googleAccountsSelect.addEventListener('change', () => {
      const client = getActiveClient();
      if (client) {
        client.googleAccountId = el.googleAccountsSelect.value;
        saveWorkflow(client);
        if (client.googleAccountId) {
          el.googleConfigFields.style.display = 'block';
          fetchGoogleSpreadsheets(client.googleAccountId);
        } else {
          el.googleConfigFields.style.display = 'none';
        }
      }
    });

    // Page selection
    el.editorFbPage.addEventListener('change', () => {
      const client = getActiveClient();
      if (client) {
        client.metaPageId = el.editorFbPage.value;
        client.metaPageName = el.editorFbPage.options[el.editorFbPage.selectedIndex].text;
        saveWorkflow(client);
        if (client.metaPageId) {
          fetchMetaForms(client.metaPageId);
        }
      }
    });

    // Form selection
    el.editorLeadForm.addEventListener('change', () => {
      const client = getActiveClient();
      if (client) {
        client.metaFormId = el.editorLeadForm.value;
        client.metaFormName = el.editorLeadForm.options[el.editorLeadForm.selectedIndex].text;
        saveWorkflow(client);
        if (client.metaFormId) {
          fetchMetaFormFields(client.metaFormId);
        }
      }
    });

    // Spreadsheet selection change - fetch worksheets/tabs dynamically
    el.editorGoogleSpreadsheetSelect.addEventListener('change', () => {
      const client = getActiveClient();
      const spreadsheetId = el.editorGoogleSpreadsheetSelect.value;
      if (client) {
        client.googleSpreadsheetId = spreadsheetId;
        client.googleSpreadsheetName = el.editorGoogleSpreadsheetSelect.options[el.editorGoogleSpreadsheetSelect.selectedIndex].text;
        saveWorkflow(client);
        if (spreadsheetId) {
          fetchGoogleWorksheets(spreadsheetId, client.googleAccountId).then(() => {
            el.editorGoogleWorksheet.disabled = false;
          });
        } else {
          el.editorGoogleWorksheet.innerHTML = '<option value="">-- Choose Tab Name --</option>';
          el.editorGoogleWorksheet.disabled = true;
        }
      }
    });

    // Toggle Spreadsheet Input mode
    el.toggleSpreadsheetInputBtn.addEventListener('click', () => {
      const isSelectVisible = el.spreadsheetSelectContainer.style.display !== 'none';
      if (isSelectVisible) {
        el.spreadsheetSelectContainer.style.display = 'none';
        el.spreadsheetInputContainer.style.display = 'flex';
        el.toggleSpreadsheetInputBtn.textContent = '📋 Select from List instead';
      } else {
        el.spreadsheetSelectContainer.style.display = 'block';
        el.spreadsheetInputContainer.style.display = 'none';
        el.toggleSpreadsheetInputBtn.textContent = '🔗 Paste Link/ID instead';
      }
    });

    // Fetch tabs for manually pasted Spreadsheet Link or ID
    el.editorFetchTabsBtn.addEventListener('click', () => {
      const client = getActiveClient();
      let inputVal = el.editorGoogleSpreadsheetInput.value.trim();
      if (!inputVal) return alert('Please paste a Spreadsheet URL or ID first.');

      // Extract spreadsheet ID if a full Google Sheets URL was pasted
      let spreadsheetId = inputVal;
      const match = inputVal.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        spreadsheetId = match[1];
      }

      if (client) {
        client.googleSpreadsheetId = spreadsheetId;
        client.googleSpreadsheetName = 'Manual Input Sheet';
        saveWorkflow(client);
        fetchGoogleWorksheets(spreadsheetId, client.googleAccountId).then(() => {
          el.editorGoogleWorksheet.disabled = false;
        });
      }
    });

    // Worksheet Tabs selection
    el.editorGoogleWorksheet.addEventListener('change', () => {
      const client = getActiveClient();
      if (client) {
        client.googleWorksheetName = el.editorGoogleWorksheet.value;
        saveWorkflow(client);
        if (client.googleWorksheetName) {
          fetchGoogleHeaders(client.googleSpreadsheetId, client.googleWorksheetName, client.googleAccountId);
        }
      }
    });

    // Toggle manual worksheet name input mode
    el.toggleWorksheetInputBtn.addEventListener('click', () => {
      const isSelectVisible = el.worksheetSelectContainer.style.display !== 'none';
      if (isSelectVisible) {
        el.worksheetSelectContainer.style.display = 'none';
        el.worksheetInputContainer.style.display = 'flex';
        el.toggleWorksheetInputBtn.textContent = '📋 Select from List instead';
      } else {
        el.worksheetSelectContainer.style.display = 'block';
        el.worksheetInputContainer.style.display = 'none';
        el.toggleWorksheetInputBtn.textContent = '🔗 Type Tab Name manually';
      }
    });

    // Save manually entered worksheet tab name
    el.editorSaveTabManualBtn.addEventListener('click', () => {
      const client = getActiveClient();
      const tabVal = el.editorGoogleWorksheetInput.value.trim();
      if (!tabVal) return alert('Please enter a Tab Name first.');

      if (client) {
        client.googleWorksheetName = tabVal;
        saveWorkflow(client);
        if (client.googleSpreadsheetId) {
          fetchGoogleWorksheets(client.googleSpreadsheetId, client.googleAccountId).then(() => {
            fetchGoogleHeaders(client.googleSpreadsheetId, tabVal, client.googleAccountId);
          }).catch(() => {
            // If API fails to fetch, still check headers or fallback
            fetchGoogleHeaders(client.googleSpreadsheetId, tabVal, client.googleAccountId);
          });
        } else {
          alert(`Saved tab: "${tabVal}". Please make sure to connect a spreadsheet link so columns can be loaded!`);
        }
      }
    });

    // Toggle manual columns names input mode
    el.toggleColumnsInputBtn.addEventListener('click', () => {
      const isInputVisible = el.columnsInputContainer.style.display === 'flex';
      if (isInputVisible) {
        el.columnsInputContainer.style.display = 'none';
      } else {
        el.columnsInputContainer.style.display = 'flex';
        const client = getActiveClient();
        if (client && client.sheetHeaders && client.sheetHeaders.length > 0) {
          el.editorManualColumnsInput.value = client.sheetHeaders.join(', ');
        }
      }
    });

    // Save manually entered column names
    el.editorSaveColumnsManualBtn.addEventListener('click', () => {
      const client = getActiveClient();
      const colsVal = el.editorManualColumnsInput.value.trim();
      if (!colsVal) return alert('Please enter some comma-separated column names.');

      const headers = colsVal.split(',').map(h => h.trim()).filter(h => h.length > 0);
      if (headers.length === 0) return alert('No valid column names found.');

      if (client) {
        client.sheetHeaders = headers;
        saveWorkflow(client);
        checkRenderMappingNode();
        el.columnsInputContainer.style.display = 'none';
        alert(`Successfully defined ${headers.length} columns manually! You can now map fields below.`);
      }
    });

    el.editorAutoMatchBtn.addEventListener('click', () => runEditorAutoMatch());
    el.editorTestSendBtn.addEventListener('click', () => testEditorSend(false));
    el.editorTestDuplicateBtn.addEventListener('click', () => testEditorSend(true));

    el.editorSaveBtn.addEventListener('click', () => {
      const client = getActiveClient();
      if (client) {
        client.clientName = el.editorWorkflowNameInput.value || client.clientName;
        client.isActive = el.editorWorkflowStatusToggle.checked;
        saveWorkflow(client);
      }
      switchTab('dashboard');
    });

    el.clearDbLogsBtn.addEventListener('click', async () => {
      if (confirm('Clear history database entries?')) {
        try {
          const res = await fetch('/api/logs/clear', { method: 'POST' });
          if (res.ok) {
            fetchHistoryLogs();
          }
        } catch (e) {
          console.warn('Backend logs cleaner offline.');
        }
      }
    });
  }

  function loadCodeSnippets() {
    fetch('/backend/server.js')
      .then(res => res.ok ? res.text() : '')
      .then(text => el.codeServerDisplay.textContent = text || '// API server offline.');

    fetch('/backend/sheets-service.js')
      .then(res => res.ok ? res.text() : '')
      .then(text => el.codeSheetsDisplay.textContent = text || '// Sheets module offline.');
  }

  function loadPreferredTheme() {
    const saved = localStorage.getItem('theme_preference');
    state.theme = saved || 'dark';
    document.body.setAttribute('data-theme', state.theme);
  }

  // 10. Init
  window.addEventListener('DOMContentLoaded', async () => {
    loadPreferredTheme();
    await fetchAccounts();
    await fetchWorkflows();
    
    populateAccountsDropdowns();
    renderWorkflowsList();
    setupEventListeners();
    loadCodeSnippets();
  });

})();
