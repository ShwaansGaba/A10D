// ==============================================================
// DigiLocker Aadhaar Verification Gateway - Client Application
// ==============================================================

let currentSessionId = null;
let pollTimer = null;
let currentAadhaarData = null;
let appConfig = {};

document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();
  
  await fetchConfig();
  setupEventListeners();
  checkUrlCallbackParams();
});

function safeCreateIcons() {
  try {
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  } catch (e) {
    console.warn('Lucide icon render warning:', e);
  }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
    updateConfigUI();
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function updateConfigUI() {
  const modeText = document.getElementById('modeText');
  const envIsProd = appConfig.environment === 'prod';
  const isSim = appConfig.useSimulation;

  if (isSim) {
    modeText.innerText = 'Simulator Mode';
    modeText.className = 'text-amber-400 font-semibold';
  } else if (envIsProd) {
    modeText.innerText = 'Live API (Prod)';
    modeText.className = 'text-blue-400 font-semibold';
  } else {
    modeText.innerText = 'Test API';
    modeText.className = 'text-emerald-400 font-semibold';
  }

  // Settings inputs
  document.getElementById('cfgApiKey').value = appConfig.apiKey || '';
  document.getElementById('cfgApiSecret').value = appConfig.apiSecret || '';
  document.getElementById('cfgRedirectUrl').value = appConfig.redirectUrl || '';
  document.getElementById('cfgUseSim').checked = appConfig.useSimulation || false;

  const btnTest = document.getElementById('setEnvTest');
  const btnProd = document.getElementById('setEnvProd');
  if (envIsProd) {
    btnProd.className = 'py-2 px-3 rounded-lg border font-semibold text-xs transition bg-blue-600 text-white border-blue-500';
    btnTest.className = 'py-2 px-3 rounded-lg border font-semibold text-xs transition bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200';
  } else {
    btnTest.className = 'py-2 px-3 rounded-lg border font-semibold text-xs transition bg-blue-600 text-white border-blue-500';
    btnProd.className = 'py-2 px-3 rounded-lg border font-semibold text-xs transition bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200';
  }
}

function setupEventListeners() {
  document.getElementById('startVerificationBtn').addEventListener('click', startVerification);
  document.getElementById('fallbackSimulatorBtn').addEventListener('click', () => {
    document.getElementById('modeRadioSim').checked = true;
    startVerification();
  });

  document.getElementById('cancelSessionBtn').addEventListener('click', resetToStep1);
  document.getElementById('verifyAnotherBtn').addEventListener('click', resetToStep1);
  document.getElementById('checkStatusManualBtn').addEventListener('click', () => checkSessionStatus(true));
  document.getElementById('downloadJsonBtn').addEventListener('click', downloadKycJson);

  // Settings Modal
  const modal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('openSettingsNoticeBtn')?.addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('closeSettingsBtn').addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('setEnvTest').addEventListener('click', () => {
    appConfig.environment = 'test';
    updateConfigUI();
  });
  document.getElementById('setEnvProd').addEventListener('click', () => {
    appConfig.environment = 'prod';
    updateConfigUI();
  });

  document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const payload = {
      environment: appConfig.environment,
      apiKey: document.getElementById('cfgApiKey').value.trim(),
      apiSecret: document.getElementById('cfgApiSecret').value.trim(),
      redirectUrl: document.getElementById('cfgRedirectUrl').value.trim(),
      useSimulation: document.getElementById('cfgUseSim').checked,
    };

    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      appConfig = data.config;
      updateConfigUI();
      modal.classList.add('hidden');
      alert('Configuration updated successfully!');
    }
  });
}

async function startVerification() {
  const isSimSelected = document.getElementById('modeRadioSim').checked;
  const startBtn = document.getElementById('startVerificationBtn');
  startBtn.disabled = true;
  startBtn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> Contacting DigiLocker...`;

  document.getElementById('diagnosticAlert').classList.add('hidden');

  try {
    const res = await fetch('/api/digilocker/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        force_simulation: isSimSelected,
        redirect_url: appConfig.redirectUrl || window.location.origin + '/callback'
      })
    });

    const json = await res.json();

    if (res.ok && json.data) {
      currentSessionId = json.data.session_id;
      const authUrl = json.data.authorization_url;

      // Transition to Step 2
      showStep(2);
      document.getElementById('reopenAuthLink').href = authUrl;

      // Open DigiLocker in a new window/popup
      const authWindow = window.open(authUrl, '_blank', 'width=600,height=750');

      // Start polling status
      startPolling(currentSessionId, authWindow);
    } else {
      // Error handling
      if (json.is_privilege_error || json.code === 403) {
        showDiagnosticAlert(json.error || 'Insufficient privilege. Please enable DigiLocker KYC in Sandbox dashboard or run the Simulator.');
      } else {
        alert('Error: ' + (json.error || json.message || 'Failed to initiate session'));
      }
    }
  } catch (err) {
    alert('Network error connecting to verification gateway: ' + err.message);
  } finally {
    startBtn.disabled = false;
    startBtn.innerHTML = `<i data-lucide="lock" class="w-4 h-4 mr-2"></i><span>Verify with DigiLocker</span>`;
    safeCreateIcons();
  }
}

function showDiagnosticAlert(msg) {
  const alertEl = document.getElementById('diagnosticAlert');
  document.getElementById('diagnosticMessage').innerText = msg;
  alertEl.classList.remove('hidden');
  safeCreateIcons();
}

function startPolling(sessionId, authWindow) {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    await checkSessionStatus(false);
  }, 2500);
}

async function checkSessionStatus(manualTrigger = false) {
  if (!currentSessionId) return;

  try {
    const res = await fetch(`/api/digilocker/status?session_id=${encodeURIComponent(currentSessionId)}`);
    const json = await res.json();

    const status = json.data?.status || json.status;

    if (status === 'succeeded' || status === 'completed') {
      if (pollTimer) clearInterval(pollTimer);
      await fetchAndDisplayDocument(currentSessionId);
    } else if (status === 'failed' || status === 'denied') {
      if (pollTimer) clearInterval(pollTimer);
      alert('DigiLocker consent was denied or failed. Please try again.');
      resetToStep1();
    } else if (manualTrigger) {
      alert('Current session status: ' + (status || 'Waiting for consent'));
    }
  } catch (e) {
    console.warn('Status poll check failed:', e);
  }
}

async function fetchAndDisplayDocument(sessionId) {
  try {
    const res = await fetch(`/api/digilocker/document?session_id=${encodeURIComponent(sessionId)}`);
    const json = await res.json();

    if (res.ok && json.data) {
      currentAadhaarData = json.data;
      renderAadhaarCard(json.data, sessionId, json.mode);
      showStep(3);
    } else {
      alert('Unable to retrieve Aadhaar document: ' + (json.error || 'Unknown error'));
      resetToStep1();
    }
  } catch (err) {
    alert('Error fetching document: ' + err.message);
    resetToStep1();
  }
}

function renderAadhaarCard(data, sessionId, mode) {
  document.getElementById('aadhaarName').innerText = data.name || 'Aadhaar Holder';
  document.getElementById('aadhaarDob').innerText = data.dob || '--';
  document.getElementById('aadhaarGender').innerText = (data.gender || 'MALE') + (data.gender === 'FEMALE' ? ' / महिला' : ' / पुरुष');
  document.getElementById('aadhaarCareOf').innerText = data.care_of || 'Care of Guardian';
  document.getElementById('aadhaarAddress').innerText = data.address || 'Address registered with UIDAI';
  document.getElementById('aadhaarNumber').innerText = data.masked_aadhaar || 'XXXX XXXX 1234';

  // Photo
  const photoImg = document.getElementById('aadhaarPhoto');
  const avatarDiv = document.getElementById('aadhaarAvatar');
  if (data.photo) {
    photoImg.src = data.photo.startsWith('data:') ? data.photo : `data:image/jpeg;base64,${data.photo}`;
    photoImg.classList.remove('hidden');
    avatarDiv.classList.add('hidden');
  } else {
    // Generate initials avatar
    const initials = (data.name || 'RS').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    avatarDiv.innerText = initials;
    avatarDiv.classList.remove('hidden');
    photoImg.classList.add('hidden');
  }

  // Metadata
  document.getElementById('metaSessionId').innerText = sessionId;
  document.getElementById('metaMode').innerText = (mode || 'Sandbox').toUpperCase();
  document.getElementById('metaTime').innerText = new Date().toLocaleString();

  safeCreateIcons();
}

function showStep(stepNumber) {
  const view1 = document.getElementById('viewInitiate');
  const view2 = document.getElementById('viewWaiting');
  const view3 = document.getElementById('viewResult');

  view1.classList.add('hidden');
  view2.classList.add('hidden');
  view3.classList.add('hidden');

  const s1 = document.getElementById('stepIndicator1');
  const s2 = document.getElementById('stepIndicator2');
  const s3 = document.getElementById('stepIndicator3');

  s1.className = 'step-badge flex flex-col items-center';
  s2.className = 'step-badge flex flex-col items-center';
  s3.className = 'step-badge flex flex-col items-center';

  if (stepNumber === 1) {
    view1.classList.remove('hidden');
    s1.classList.add('active');
  } else if (stepNumber === 2) {
    view2.classList.remove('hidden');
    s1.classList.add('completed');
    s2.classList.add('active');
  } else if (stepNumber === 3) {
    view3.classList.remove('hidden');
    s1.classList.add('completed');
    s2.classList.add('completed');
    s3.classList.add('completed', 'active');
  }

  safeCreateIcons();
}

function resetToStep1() {
  if (pollTimer) clearInterval(pollTimer);
  currentSessionId = null;
  currentAadhaarData = null;
  showStep(1);
}

function checkUrlCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const status = params.get('status');

  if (sessionId && status === 'success') {
    currentSessionId = sessionId;
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
    fetchAndDisplayDocument(sessionId);
  }
}

function downloadKycJson() {
  if (!currentAadhaarData) return;
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentAadhaarData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `Aadhaar_KYC_${currentAadhaarData.name?.replace(/\s+/g, '_') || 'Verified'}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
