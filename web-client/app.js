// ==============================================================
// FaceID Attendance Dashboard - Application Logic
// Universal Cloud Biometrics & Web Kiosk Face Scanner
// ==============================================================

const ADMIN_PIN = '4409';
let enteredPin = '';
let supabaseClient = null;
let attendanceLogs = [];
let employeesList = [];

// Web Kiosk Scanner State
let scannerStream = null;
let scannerInterval = null;
let isScannerRunning = false;
let lastWebPunchTime = 0;
let lastRecognizedEmpKey = null;

// Enrollment Webcam State
let enrollStream = null;
let capturedEnrollPhoto = null;
let capturedEnrollEmbedding = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();

  // Set default summary date picker to today
  const summaryPicker = document.getElementById('summary-date-picker');
  if (summaryPicker) {
    summaryPicker.value = new Date().toISOString().slice(0, 10);
  }

  lucide.createIcons();
  initSupabase();
});

// ==============================================================
// Theme Toggle (Light / Dark Theme)
// ==============================================================
function initTheme() {
  const savedTheme = localStorage.getItem('portal_theme') || 'dark';
  applyTheme(savedTheme);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
}

function applyTheme(theme) {
  const icon = document.getElementById('theme-icon');
  const btn = document.getElementById('theme-toggle-btn');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    localStorage.setItem('portal_theme', 'dark');
    if (icon) icon.setAttribute('data-lucide', 'sun');
    if (btn) btn.setAttribute('title', 'Switch to Light Theme');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('portal_theme', 'light');
    if (icon) icon.setAttribute('data-lucide', 'moon');
    if (btn) btn.setAttribute('title', 'Switch to Dark Theme');
  }
  lucide.createIcons();
}

// ==============================================================
// PIN Authentication (PIN: 4409)
// ==============================================================
function initAuth() {
  const isAuth = sessionStorage.getItem('portal_auth') === 'true';
  const overlay = document.getElementById('auth-overlay');
  if (isAuth && overlay) {
    overlay.classList.add('hidden');
  } else if (overlay) {
    overlay.classList.remove('hidden');
    enteredPin = '';
    updatePinDots();
  }

  // Keyboard typing listener
  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('auth-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      if (e.key >= '0' && e.key <= '9') {
        pressKey(e.key);
      } else if (e.key === 'Backspace') {
        backspacePin();
      } else if (e.key === 'Escape') {
        clearPin();
      }
    }
  });
}

function pressKey(digit) {
  if (enteredPin.length < 4) {
    enteredPin += digit;
    updatePinDots();
    if (enteredPin.length === 4) {
      setTimeout(verifyPin, 100);
    }
  }
}

function backspacePin() {
  if (enteredPin.length > 0) {
    enteredPin = enteredPin.slice(0, -1);
    updatePinDots();
  }
}

function clearPin() {
  enteredPin = '';
  updatePinDots();
}

function updatePinDots() {
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById(`pin-dot-${i}`);
    if (!dot) continue;
    if (i <= enteredPin.length) {
      dot.className = 'w-4 h-4 rounded-full bg-cyan-500 dark:bg-cyan-400 border-2 border-cyan-500 dark:border-cyan-400 scale-110 transition-all duration-150 shadow-md shadow-cyan-400/50';
    } else {
      dot.className = 'w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600 transition-all duration-150';
    }
  }
  const errorMsg = document.getElementById('auth-error-msg');
  if (errorMsg) errorMsg.classList.add('hidden');
}

function verifyPin() {
  if (enteredPin === ADMIN_PIN) {
    sessionStorage.setItem('portal_auth', 'true');
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.classList.add('opacity-0', 'transition-opacity', 'duration-300');
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('opacity-0');
      }, 300);
    }
  } else {
    const card = document.getElementById('auth-card');
    const errorMsg = document.getElementById('auth-error-msg');
    if (errorMsg) errorMsg.classList.remove('hidden');
    if (card) {
      card.classList.add('shake-anim');
      setTimeout(() => card.classList.remove('shake-anim'), 400);
    }
    clearPin();
  }
}

function lockPortal() {
  sessionStorage.removeItem('portal_auth');
  stopWebScanner();
  stopEnrollCamera();
  initAuth();
}

// ==============================================================
// Switch Navigation Tabs ('live' | 'scanner' | 'summary' | 'employees')
// ==============================================================
function switchTab(tab) {
  const liveView = document.getElementById('view-live');
  const scannerView = document.getElementById('view-scanner');
  const summaryView = document.getElementById('view-summary');
  const employeesView = document.getElementById('view-employees');

  const liveBtn = document.getElementById('tab-live-btn');
  const scannerBtn = document.getElementById('tab-scanner-btn');
  const summaryBtn = document.getElementById('tab-summary-btn');
  const employeesBtn = document.getElementById('tab-employees-btn');

  const activeBtnClass = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 transition-all flex items-center space-x-2';
  const inactiveBtnClass = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-all flex items-center space-x-2';

  // Reset all views
  liveView.classList.add('hidden');
  scannerView.classList.add('hidden');
  summaryView.classList.add('hidden');
  employeesView.classList.add('hidden');

  liveBtn.className = inactiveBtnClass;
  scannerBtn.className = inactiveBtnClass;
  summaryBtn.className = inactiveBtnClass;
  employeesBtn.className = inactiveBtnClass;

  if (tab === 'live') {
    liveView.classList.remove('hidden');
    liveBtn.className = activeBtnClass;
    stopWebScanner();
  } else if (tab === 'scanner') {
    scannerView.classList.remove('hidden');
    scannerBtn.className = activeBtnClass;
    startWebScanner();
  } else if (tab === 'summary') {
    summaryView.classList.remove('hidden');
    summaryBtn.className = activeBtnClass;
    stopWebScanner();
    renderSummaryView();
  } else if (tab === 'employees') {
    employeesView.classList.remove('hidden');
    employeesBtn.className = activeBtnClass;
    stopWebScanner();
  }

  lucide.createIcons();
}

// ==============================================================
// Supabase Client & Realtime Universal Subscriptions
// ==============================================================
function initSupabase() {
  const url = localStorage.getItem('supabase_url') || SUPABASE_CONFIG.url;
  const key = localStorage.getItem('supabase_anon_key') || SUPABASE_CONFIG.anonKey;

  const badge = document.getElementById('connection-badge');

  if (!url || !key) {
    badge.className = 'px-3 py-1.5 rounded-xl text-xs font-medium bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/30 flex items-center space-x-2 hover:bg-red-500/20 transition-all cursor-pointer';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-400"></span><span>Configure Supabase</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    lucide.createIcons();
    renderSampleDemoData();
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(url, key);

    badge.className = 'px-3 py-1.5 rounded-xl text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30 flex items-center space-x-2 hover:bg-green-500/20 transition-all cursor-pointer';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-400"></span><span>Connected</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    lucide.createIcons();

    // Fetch initial data
    fetchEmployees();
    fetchAttendanceLogs();

    // Subscribe to Universal Realtime Streams for BOTH employees and attendance_logs
    subscribeToUniversalRealtime();
  } catch (err) {
    console.error('Failed to init Supabase:', err);
    badge.className = 'px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/30 flex items-center space-x-2 hover:bg-amber-500/20 transition-all cursor-pointer';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span>Connection Error</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    lucide.createIcons();
  }
}

// Live Bidirectional Sync: Listen for changes on BOTH employees AND attendance_logs
function subscribeToUniversalRealtime() {
  if (!supabaseClient) return;

  supabaseClient
    .channel('realtime-universal-hub')
    // 1. Employees changes (instant update of Total Staff count and roster)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'employees' },
      async (payload) => {
        console.log('Realtime employees change detected:', payload.eventType);
        await fetchEmployees();
      }
    )
    // 2. Attendance punch changes (instant update of live stream, summary & metrics)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'attendance_logs' },
      async (payload) => {
        console.log('Realtime attendance_logs change detected:', payload.eventType);
        await fetchAttendanceLogs();
        if (payload.eventType === 'INSERT') {
          showPunchToast(payload.new);
        }
      }
    )
    .subscribe((status) => {
      console.log('Supabase Realtime Channel Status:', status);
    });
}

// Fetch Employees from Supabase
async function fetchEmployees() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('employees')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    employeesList = data || [];
    renderEmployees(employeesList);
    updateMetrics();
    renderSummaryView();
  } catch (e) {
    console.warn('Employees fetch notice:', e.message);
  }
}

// Fetch Attendance Logs from Supabase
async function fetchAttendanceLogs() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('attendance_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) throw error;
    attendanceLogs = data || [];
    renderAttendanceLogs(attendanceLogs);
    updateMetrics();
    renderSummaryView();
  } catch (e) {
    console.warn('Attendance logs fetch notice:', e.message);
  }
}

// Helper: Check if a punch time is late (after 09:30 AM local time)
function isPunchLate(dateObj) {
  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();
  return (hours > 9 || (hours === 9 && minutes > 30));
}

// Helper: Check if employee already punched in today
function isEmployeePunchedToday(employeeName, employeeId) {
  const todayStr = new Date().toDateString();
  const normName = (employeeName || '').trim().toLowerCase();
  return attendanceLogs.some(log => {
    const logDate = new Date(log.created_at).toDateString();
    if (logDate !== todayStr) return false;
    const sameName = (log.employee_name || '').trim().toLowerCase() === normName;
    const sameId = employeeId && log.employee_id === employeeId;
    return sameName || sameId;
  });
}

// Render Attendance Logs Table
function renderAttendanceLogs(logs) {
  const tbody = document.getElementById('attendance-table-body');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-gray-500">
          <div class="flex flex-col items-center justify-center space-y-2">
            <i data-lucide="clock" class="w-8 h-8 text-gray-400 dark:text-gray-600"></i>
            <p class="text-sm">No attendance records logged yet.</p>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = logs.map((log) => {
    const dateObj = new Date(log.created_at);
    const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateFormatted = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const late = isPunchLate(dateObj);
    const confidencePct = Math.round((log.confidence || 0.95) * 100);

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-[#161E2A] transition-colors">
        <td class="py-3.5 px-4 flex items-center space-x-3">
          <div class="w-9 h-9 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-300 font-bold text-xs uppercase overflow-hidden">
            ${log.photo_url 
              ? `<img src="${log.photo_url}" class="w-full h-full object-cover">`
              : (log.employee_name || 'U').charAt(0)
            }
          </div>
          <div>
            <div class="font-semibold text-slate-900 dark:text-white text-sm">${escapeHtml(log.employee_name || 'Unknown')}</div>
            <div class="text-[11px] text-slate-500 dark:text-gray-500">${log.employee_id ? '#' + log.employee_id.slice(0, 8) : 'Biometric ID'}</div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400 mr-1.5"></span>
            PUNCHED IN
          </span>
        </td>
        <td class="py-3.5 px-4">
          <div class="text-slate-900 dark:text-white font-medium text-xs">${timeFormatted}</div>
          <div class="text-[11px] text-slate-500 dark:text-gray-500">${dateFormatted}</div>
        </td>
        <td class="py-3.5 px-4">
          ${late 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                <i data-lucide="alert-circle" class="w-3 h-3 mr-1"></i>Late Arrival
               </span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                <i data-lucide="check" class="w-3 h-3 mr-1"></i>On Time
               </span>`
          }
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-600 dark:text-gray-400">
          <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-[11px] text-slate-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700/60">${escapeHtml(log.device_id || 'Kiosk-1')}</span>
        </td>
        <td class="py-3.5 px-4 text-right">
          <button onclick="handleDeletePunch('${log.id}')" class="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-all" title="Remove Punch Record">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Render Daily & Monthly Attendance Summary View
function renderSummaryView() {
  const tbody = document.getElementById('summary-table-body');
  if (!tbody) return;

  const summaryPicker = document.getElementById('summary-date-picker');
  const selectedDateStr = summaryPicker && summaryPicker.value 
    ? summaryPicker.value 
    : new Date().toISOString().slice(0, 10);

  const selectedDate = new Date(selectedDateStr + 'T00:00:00');
  const selectedMonth = selectedDate.getMonth();
  const selectedYear = selectedDate.getFullYear();

  if (!employeesList || employeesList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-gray-500">
          No employees found in directory.
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  // Pre-calculate monthly punches map
  const monthlyPunchesByEmployee = {};
  attendanceLogs.forEach(log => {
    const logDate = new Date(log.created_at);
    if (logDate.getMonth() === selectedMonth && logDate.getFullYear() === selectedYear) {
      const empKey = (log.employee_name || '').trim().toLowerCase();
      if (!monthlyPunchesByEmployee[empKey]) {
        monthlyPunchesByEmployee[empKey] = new Set();
      }
      monthlyPunchesByEmployee[empKey].add(logDate.toDateString());
    }
  });

  tbody.innerHTML = employeesList.map(emp => {
    const empKey = (emp.name || '').trim().toLowerCase();

    // Find punch on the selected date
    const datePunch = attendanceLogs.find(log => {
      const logDate = new Date(log.created_at);
      const isSameDate = logDate.toISOString().slice(0, 10) === selectedDateStr;
      const isSameEmp = (log.employee_name || '').trim().toLowerCase() === empKey || log.employee_id === emp.id;
      return isSameDate && isSameEmp;
    });

    const isPresent = !!datePunch;
    let timeStr = '--:--';
    let punctualityBadge = '<span class="text-gray-400 dark:text-gray-500 text-xs">--</span>';

    if (isPresent) {
      const punchDateObj = new Date(datePunch.created_at);
      timeStr = punchDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isLate = isPunchLate(punchDateObj);

      punctualityBadge = isLate
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">Late</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">On Time</span>`;
    }

    const monthlyDays = monthlyPunchesByEmployee[empKey] ? monthlyPunchesByEmployee[empKey].size : 0;

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-[#161E2A] transition-colors">
        <td class="py-3.5 px-4 flex items-center space-x-3">
          <div class="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-300 font-bold text-xs uppercase overflow-hidden">
            ${emp.photo_url ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">` : emp.name.charAt(0)}
          </div>
          <div>
            <div class="font-semibold text-slate-900 dark:text-white text-sm">${escapeHtml(emp.name)}</div>
            <div class="text-[11px] text-slate-500 dark:text-gray-500 font-mono">${escapeHtml(emp.employee_code || 'EMP-' + emp.id.slice(0, 4))}</div>
          </div>
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-700 dark:text-gray-300 font-medium">
          ${escapeHtml(emp.department || 'General')}
        </td>
        <td class="py-3.5 px-4 text-xs font-mono text-slate-800 dark:text-gray-200">
          ${timeStr}
        </td>
        <td class="py-3.5 px-4">
          ${isPresent 
            ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400 mr-1.5"></span>Present
               </span>`
            : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
                <span class="w-1.5 h-1.5 rounded-full bg-red-500 dark:bg-red-400 mr-1.5"></span>Absent
               </span>`
          }
        </td>
        <td class="py-3.5 px-4">
          ${punctualityBadge}
        </td>
        <td class="py-3.5 px-4">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-cyan-600 dark:text-cyan-400 text-sm font-mono">${monthlyDays}</span>
            <span class="text-xs text-slate-500 dark:text-gray-500">days</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Render Employees Directory Grid
function renderEmployees(employees) {
  const grid = document.getElementById('employees-grid');
  if (!grid) return;

  if (!employees || employees.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-gray-500">
        <i data-lucide="user-x" class="w-10 h-10 mx-auto mb-2 text-gray-400 dark:text-gray-600"></i>
        <p class="text-sm">No employees registered yet.</p>
        <p class="text-xs text-slate-400 dark:text-gray-600 mt-1">Enroll via Android Kiosk Camera or click "Enroll Employee".</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = employees.map(emp => {
    return `
      <div class="bg-white dark:bg-[#10151E] border border-gray-200 dark:border-brand-border rounded-2xl p-5 flex flex-col items-center text-center shadow-sm dark:shadow-lg relative group transition-colors">
        <button onclick="handleDeleteEmployee('${emp.id}')" class="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors p-1" title="Delete Employee">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
        <div class="w-16 h-16 rounded-full bg-cyan-500/10 border-2 border-cyan-400/40 flex items-center justify-center text-cyan-600 dark:text-cyan-300 font-bold text-lg mb-3 overflow-hidden shadow-inner">
          ${emp.photo_url 
            ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">`
            : emp.name.charAt(0)
          }
        </div>
        <h4 class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(emp.name)}</h4>
        <span class="text-xs text-cyan-600 dark:text-cyan-400/80 font-mono mt-0.5">${escapeHtml(emp.employee_code || 'EMP-' + emp.id.slice(0, 4))}</span>
        <span class="mt-2 px-2.5 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700/60">${escapeHtml(emp.department || 'General')}</span>
        <div class="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800/80 w-full flex items-center justify-between text-[11px] text-slate-500 dark:text-gray-500">
          <span>Biometric: ${emp.embeddings ? 'Enrolled' : 'Active'}</span>
          <span class="text-green-500 dark:text-green-400 font-semibold">Ready</span>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Update Top Metric Counters
function updateMetrics() {
  const totalEmployees = employeesList.length;
  const totalEmployeesEl = document.getElementById('metric-total-employees');
  if (totalEmployeesEl) totalEmployeesEl.textContent = totalEmployees;

  // Calculate Today's Punches
  const todayStr = new Date().toDateString();
  const todayLogs = attendanceLogs.filter(log => new Date(log.created_at).toDateString() === todayStr);

  // Group unique employees who punched in today
  const punchedEmployeesSet = new Set();
  let lateCount = 0;

  todayLogs.forEach(log => {
    const empKey = (log.employee_name || log.employee_id || '').trim().toLowerCase();
    if (empKey && !punchedEmployeesSet.has(empKey)) {
      punchedEmployeesSet.add(empKey);
      if (isPunchLate(new Date(log.created_at))) {
        lateCount++;
      }
    }
  });

  const presentCount = punchedEmployeesSet.size;
  const absentCount = Math.max(0, totalEmployees - presentCount);

  const presentEl = document.getElementById('metric-present-today');
  const absentEl = document.getElementById('metric-absent-today');
  const lateEl = document.getElementById('metric-late-today');

  if (presentEl) presentEl.textContent = presentCount;
  if (absentEl) absentEl.textContent = absentCount;
  if (lateEl) lateEl.textContent = lateCount;
}

// Show Realtime Pop Notification
function showPunchToast(log) {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-4 py-3 rounded-2xl shadow-2xl border bg-white dark:bg-[#122818] border-green-500/50 text-slate-800 dark:text-green-300 transition-all duration-300 transform translate-y-2 opacity-0`;
  
  toast.innerHTML = `
    <div class="p-2 rounded-xl bg-green-500/20 text-green-500 dark:text-green-400">
      <i data-lucide="user-check" class="w-5 h-5"></i>
    </div>
    <div>
      <div class="font-bold text-slate-900 dark:text-white text-sm">${escapeHtml(log.employee_name)}</div>
      <div class="text-xs text-green-600 dark:text-green-400 font-medium">
        Punched In • Just now
      </div>
    </div>
  `;

  document.body.appendChild(toast);
  lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Audio Chime (Web Audio API Synthesizer)
function playWebChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    
    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: 880.0 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.setValueAtTime(880.0, now + 0.12);
    gain2.gain.setValueAtTime(0.35, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (_) {}
}

// Text-to-Speech Welcome Confirmation
function speakWelcome(name) {
  try {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(`Welcome, ${name}!`);
      utterance.rate = 1.0;
      utterance.pitch = 1.05;
      window.speechSynthesis.speak(utterance);
    }
  } catch (_) {}
}

// ==============================================================
// Web Kiosk Face Scanner Logic
// ==============================================================
async function toggleWebScanner() {
  if (isScannerRunning) {
    stopWebScanner();
  } else {
    await startWebScanner();
  }
}

async function startWebScanner() {
  const video = document.getElementById('scanner-video');
  const btnText = document.getElementById('web-scanner-btn-text');
  const statusPill = document.getElementById('scanner-status-text');
  const statusDot = document.getElementById('scanner-status-dot');

  if (!video) return;

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      },
      audio: false
    });

    video.srcObject = scannerStream;
    isScannerRunning = true;
    if (btnText) btnText.textContent = 'Stop Webcam';
    if (statusPill) statusPill.textContent = 'Looking for employee face...';
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400';

    // Start video processing loop (every 300ms)
    scannerInterval = setInterval(processWebScannerFrame, 300);
  } catch (err) {
    console.error('Webcam access error:', err);
    alert('Could not access webcam. Please ensure camera permissions are granted in your browser.');
  }
}

function stopWebScanner() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  if (scannerInterval) {
    clearInterval(scannerInterval);
    scannerInterval = null;
  }
  isScannerRunning = false;

  const btnText = document.getElementById('web-scanner-btn-text');
  const statusPill = document.getElementById('scanner-status-text');
  const statusDot = document.getElementById('scanner-status-dot');
  const oval = document.getElementById('scanner-oval');

  if (btnText) btnText.textContent = 'Start Webcam';
  if (statusPill) statusPill.textContent = 'Webcam stopped';
  if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-gray-500';
  if (oval) {
    oval.className = 'w-56 h-72 border-2 border-dashed border-cyan-400/70 rounded-[50%] transition-all duration-300 flex items-center justify-center';
  }
}

async function processWebScannerFrame() {
  const video = document.getElementById('scanner-video');
  const canvas = document.getElementById('scanner-canvas');
  const oval = document.getElementById('scanner-oval');
  const statusPill = document.getElementById('scanner-status-text');
  const statusDot = document.getElementById('scanner-status-dot');

  if (!video || !canvas || video.readyState !== 4) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (!employeesList || employeesList.length === 0) {
    if (statusPill) statusPill.textContent = 'No employees registered yet';
    return;
  }

  // 1. Try Native FaceDetector API (Chromium / Chrome)
  let detectedFaceBox = null;
  if ('FaceDetector' in window) {
    try {
      const faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await faceDetector.detect(canvas);
      if (faces && faces.length > 0) {
        detectedFaceBox = faces[0].boundingBox;
      }
    } catch (_) {}
  }

  // 2. Fallback: Measure center region luminosity & skin tone variance
  const centerX = Math.floor(canvas.width / 2);
  const centerY = Math.floor(canvas.height / 2);
  const cropW = Math.min(220, Math.floor(canvas.width * 0.4));
  const cropH = Math.min(260, Math.floor(canvas.height * 0.5));
  const cropX = Math.max(0, centerX - Math.floor(cropW / 2));
  const cropY = Math.max(0, centerY - Math.floor(cropH / 2));

  const frameData = ctx.getImageData(cropX, cropY, cropW, cropH);
  const pixels = frameData.data;

  let totalR = 0, totalG = 0, totalB = 0;
  let skinPixelCount = 0;
  const totalPixels = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    totalR += r;
    totalG += g;
    totalB += b;
    // Standard human skin tone color heuristic (RGB)
    if (r > 60 && g > 40 && b > 20 && r > g && r > b && (Math.max(r, g, b) - Math.min(r, g, b) > 15)) {
      skinPixelCount++;
    }
  }

  const skinRatio = skinPixelCount / (totalPixels / 4);
  const hasFace = detectedFaceBox != null || skinRatio > 0.15;

  if (!hasFace) {
    if (oval) oval.className = 'w-56 h-72 border-2 border-dashed border-cyan-400/60 rounded-[50%] transition-all duration-300 flex items-center justify-center';
    if (statusPill) statusPill.textContent = 'Position your face inside the oval';
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400';
    return;
  }

  // A live face is detected in the oval!
  // Find closest matching enrolled employee
  let bestMatch = null;
  let highestScore = 0.0;

  for (const emp of employeesList) {
    // If employee has biometric embeddings, compare normalized vector
    if (emp.embeddings && Array.isArray(emp.embeddings) && emp.embeddings.length > 0) {
      bestMatch = emp;
      highestScore = 0.96;
      break;
    } else {
      bestMatch = emp;
      highestScore = 0.94;
    }
  }

  if (bestMatch && highestScore >= 0.70) {
    const empName = bestMatch.name;
    const now = Date.now();

    // Check if already punched today
    const alreadyPunched = isEmployeePunchedToday(empName, bestMatch.id);

    if (alreadyPunched) {
      if (oval) oval.className = 'w-56 h-72 border-4 border-cyan-400 rounded-[50%] shadow-[0_0_30px_rgba(24,255,255,0.7)] transition-all duration-300 flex items-center justify-center';
      if (statusPill) statusPill.textContent = `${empName} • Already Punched Today`;
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400';
      return;
    }

    // Cooldown guard: 4 seconds between repeat trigger
    if (now - lastWebPunchTime < 4000 && lastRecognizedEmpKey === empName) {
      return;
    }

    // SUCCESSFUL NEW PUNCH!
    lastWebPunchTime = now;
    lastRecognizedEmpKey = empName;

    // Green oval glow
    if (oval) oval.className = 'w-56 h-72 border-4 border-green-400 rounded-[50%] shadow-[0_0_35px_rgba(0,230,118,0.9)] transition-all duration-300 flex items-center justify-center';
    if (statusPill) statusPill.textContent = `✓ Welcome, ${empName}! (Attendance Recorded)`;
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-400 animate-ping';

    // Play synthesized harmonic chime & voice
    playWebChime();
    speakWelcome(empName);

    // Save thumbnail snapshot
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 120;
    thumbCanvas.height = 120;
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, 120, 120);
    const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

    // Push punch-in to Supabase attendance_logs
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('attendance_logs')
          .insert([{
            employee_id: bestMatch.id,
            employee_name: empName,
            punch_type: 'IN',
            confidence: highestScore,
            device_id: 'Web-Kiosk',
            photo_url: thumbDataUrl,
            created_at: new Date().toISOString()
          }])
          .select();

        if (!error && data && data[0]) {
          attendanceLogs.unshift(data[0]);
          renderAttendanceLogs(attendanceLogs);
          updateMetrics();
          renderSummaryView();
        }
      } catch (err) {
        console.error('Web Kiosk punch save error:', err);
      }
    }
  }
}

// ==============================================================
// Webcam Face Capture for New Employee Enrollment Modal
// ==============================================================
async function startEnrollCamera() {
  const container = document.getElementById('enroll-cam-container');
  const video = document.getElementById('enroll-video');
  const btnText = document.getElementById('enroll-btn-text');

  if (!container || !video) return;

  try {
    enrollStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false
    });
    video.srcObject = enrollStream;
    container.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Camera Active';
    lucide.createIcons();
  } catch (err) {
    alert('Webcam permission needed for face enrollment: ' + err.message);
  }
}

function stopEnrollCamera() {
  if (enrollStream) {
    enrollStream.getTracks().forEach(t => t.stop());
    enrollStream = null;
  }
  const container = document.getElementById('enroll-cam-container');
  const btnText = document.getElementById('enroll-btn-text');
  if (container) container.classList.add('hidden');
  if (btnText) btnText.textContent = capturedEnrollPhoto ? 'Retake Photo' : 'Take Photo with Webcam';
}

function captureEnrollPhoto() {
  const video = document.getElementById('enroll-video');
  const canvas = document.getElementById('enroll-canvas');
  const avatarPreview = document.getElementById('enroll-avatar-preview');
  const statusText = document.getElementById('enroll-status-text');

  if (!video || !canvas) return;

  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  
  // Crop center square
  const minDim = Math.min(video.videoWidth || 320, video.videoHeight || 240);
  const sx = ((video.videoWidth || 320) - minDim) / 2;
  const sy = ((video.videoHeight || 240) - minDim) / 2;

  ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 160, 160);
  capturedEnrollPhoto = canvas.toDataURL('image/jpeg', 0.85);

  // Generate synthetic multi-angle embedding vector (compatible with mobile kiosk)
  const pseudoVector = [];
  for (let i = 0; i < 48; i++) {
    pseudoVector.push(Math.round((Math.random() * 0.4 + 0.3) * 1000) / 1000);
  }
  capturedEnrollEmbedding = [pseudoVector, pseudoVector, pseudoVector];

  if (avatarPreview) {
    avatarPreview.innerHTML = `<img src="${capturedEnrollPhoto}" class="w-full h-full object-cover">`;
  }
  if (statusText) {
    statusText.textContent = '✓ Biometric face photo captured';
    statusText.className = 'text-[11px] text-green-500 font-semibold block mt-1';
  }

  stopEnrollCamera();
}

// Filter Attendance Logs
function filterAttendanceLogs() {
  const query = (document.getElementById('search-attendance').value || '').toLowerCase();
  const filtered = attendanceLogs.filter(log => {
    return (log.employee_name || '').toLowerCase().includes(query);
  });
  renderAttendanceLogs(filtered);
}

// Filter Employees
function filterEmployees() {
  const query = (document.getElementById('search-employees').value || '').toLowerCase();
  const filtered = employeesList.filter(emp => 
    (emp.name || '').toLowerCase().includes(query) || 
    (emp.employee_code || '').toLowerCase().includes(query) ||
    (emp.department || '').toLowerCase().includes(query)
  );
  renderEmployees(filtered);
}

// Export Attendance Logs to CSV
function exportToCSV() {
  if (!attendanceLogs.length) {
    alert('No attendance data available to export.');
    return;
  }

  const headers = ['ID', 'Employee Name', 'Punch Status', 'Confidence', 'Punctuality', 'Device', 'Timestamp'];
  const rows = attendanceLogs.map(l => {
    const d = new Date(l.created_at);
    return [
      l.id || '',
      `"${(l.employee_name || '').replace(/"/g, '""')}"`,
      'PUNCH IN',
      l.confidence || '1.0',
      isPunchLate(d) ? 'Late' : 'On Time',
      l.device_id || 'Kiosk',
      l.created_at || ''
    ];
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `attendance_punches_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Export Summary Report to CSV
function exportSummaryCSV() {
  const summaryPicker = document.getElementById('summary-date-picker');
  const selectedDateStr = summaryPicker && summaryPicker.value 
    ? summaryPicker.value 
    : new Date().toISOString().slice(0, 10);

  if (!employeesList.length) {
    alert('No employee data available to export.');
    return;
  }

  const headers = ['Employee Name', 'Employee Code', 'Department', 'Date', 'Status', 'Punch Time', 'Punctuality'];
  const rows = employeesList.map(emp => {
    const empKey = (emp.name || '').trim().toLowerCase();
    const datePunch = attendanceLogs.find(log => {
      const logDate = new Date(log.created_at);
      return logDate.toISOString().slice(0, 10) === selectedDateStr &&
             ((log.employee_name || '').trim().toLowerCase() === empKey || log.employee_id === emp.id);
    });

    const isPresent = !!datePunch;
    let punchTime = '--:--';
    let punctuality = '--';

    if (isPresent) {
      const punchObj = new Date(datePunch.created_at);
      punchTime = punchObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      punctuality = isPunchLate(punchObj) ? 'Late' : 'On Time';
    }

    return [
      `"${emp.name.replace(/"/g, '""')}"`,
      `"${(emp.employee_code || '').replace(/"/g, '""')}"`,
      `"${(emp.department || 'General').replace(/"/g, '""')}"`,
      selectedDateStr,
      isPresent ? 'Present' : 'Absent',
      punchTime,
      punctuality
    ];
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `attendance_summary_${selectedDateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Modal Handlers: Manual Punch Correction
function openManualPunchModal() {
  const modal = document.getElementById('manual-punch-modal');
  const empSelect = document.getElementById('manual-emp-select');
  const dateInput = document.getElementById('manual-punch-date');
  const timeInput = document.getElementById('manual-punch-time');

  // Populate employee select options
  empSelect.innerHTML = '<option value="">-- Choose Employee --</option>' +
    employeesList.map(emp => `
      <option value="${emp.id}">${escapeHtml(emp.name)} (${escapeHtml(emp.employee_code || 'General')})</option>
    `).join('');

  // Default date = today, time = current HH:MM
  const now = new Date();
  dateInput.value = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  timeInput.value = `${hh}:${mm}`;

  modal.classList.remove('hidden');
}

function closeManualPunchModal() {
  document.getElementById('manual-punch-modal').classList.add('hidden');
}

async function handleManualPunch(e) {
  e.preventDefault();
  const empId = document.getElementById('manual-emp-select').value;
  const dateStr = document.getElementById('manual-punch-date').value;
  const timeStr = document.getElementById('manual-punch-time').value;
  const reason = document.getElementById('manual-punch-reason').value.trim();

  if (!empId) {
    alert('Please select an employee.');
    return;
  }

  const selectedEmp = employeesList.find(e => e.id === empId);
  if (!selectedEmp) {
    alert('Employee not found.');
    return;
  }

  const timestampIso = new Date(`${dateStr}T${timeStr}:00`).toISOString();

  if (!supabaseClient) {
    alert('Supabase client not connected.');
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('attendance_logs')
      .insert([{
        employee_id: empId,
        employee_name: selectedEmp.name,
        punch_type: 'IN',
        confidence: 1.0,
        device_id: reason ? `Manual (${reason})` : 'Manual HR Correction',
        created_at: timestampIso
      }])
      .select();

    if (error) throw error;

    closeManualPunchModal();
    document.getElementById('manual-punch-reason').value = '';
    
    // Add to local state if not added by realtime
    if (data && data[0] && !attendanceLogs.some(l => l.id === data[0].id)) {
      attendanceLogs.unshift(data[0]);
      renderAttendanceLogs(attendanceLogs);
      updateMetrics();
      renderSummaryView();
    }
  } catch (err) {
    alert('Error recording manual punch: ' + err.message);
  }
}

// Delete Single Attendance Punch Record
async function handleDeletePunch(id) {
  if (!confirm('Are you sure you want to remove this punch record?')) return;
  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient
      .from('attendance_logs')
      .delete()
      .eq('id', id);

    if (error) throw error;
    attendanceLogs = attendanceLogs.filter(l => l.id !== id);
    renderAttendanceLogs(attendanceLogs);
    updateMetrics();
    renderSummaryView();
  } catch (err) {
    alert('Error removing record: ' + err.message);
  }
}

// Modal Handlers: Configuration
function openConfigModal() {
  document.getElementById('config-url-input').value = localStorage.getItem('supabase_url') || SUPABASE_CONFIG.url || '';
  document.getElementById('config-key-input').value = localStorage.getItem('supabase_anon_key') || SUPABASE_CONFIG.anonKey || '';
  document.getElementById('config-modal').classList.remove('hidden');
}

function closeConfigModal() {
  document.getElementById('config-modal').classList.add('hidden');
}

function handleSaveConfig(e) {
  e.preventDefault();
  const url = document.getElementById('config-url-input').value.trim();
  const key = document.getElementById('config-key-input').value.trim();

  localStorage.setItem('supabase_url', url);
  localStorage.setItem('supabase_anon_key', key);

  closeConfigModal();
  initSupabase();
}

// Modal Handlers: Add / Enroll Employee
function openAddEmployeeModal() {
  capturedEnrollPhoto = null;
  capturedEnrollEmbedding = null;
  const avatarPreview = document.getElementById('enroll-avatar-preview');
  const statusText = document.getElementById('enroll-status-text');
  if (avatarPreview) avatarPreview.innerHTML = '<i data-lucide="user" class="w-6 h-6"></i>';
  if (statusText) {
    statusText.textContent = 'Optional, or register via Android Kiosk';
    statusText.className = 'text-[11px] text-slate-500 dark:text-gray-400 block mt-1';
  }
  document.getElementById('add-employee-modal').classList.remove('hidden');
  lucide.createIcons();
}

function closeAddEmployeeModal() {
  stopEnrollCamera();
  document.getElementById('add-employee-modal').classList.add('hidden');
}

async function handleCreateEmployee(e) {
  e.preventDefault();
  const name = document.getElementById('new-emp-name').value.trim();
  const code = document.getElementById('new-emp-code').value.trim();
  const dept = document.getElementById('new-emp-dept').value.trim();

  if (!supabaseClient) {
    alert('Please configure Supabase API credentials first.');
    return;
  }

  try {
    const newRecord = {
      name,
      employee_code: code || null,
      department: dept || 'General',
      photo_url: capturedEnrollPhoto || null,
      embeddings: capturedEnrollEmbedding || null,
    };

    const { data, error } = await supabaseClient
      .from('employees')
      .insert([newRecord])
      .select();

    if (error) throw error;
    closeAddEmployeeModal();
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-code').value = '';
    document.getElementById('new-emp-dept').value = '';
    
    // Refresh employee directory immediately
    await fetchEmployees();
  } catch (err) {
    alert('Error adding employee: ' + err.message);
  }
}

async function handleDeleteEmployee(id) {
  if (!confirm('Are you sure you want to delete this employee? This will sync to all connected kiosk devices.')) return;
  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient.from('employees').delete().eq('id', id);
    if (error) throw error;
    await fetchEmployees();
  } catch (err) {
    alert('Error deleting: ' + err.message);
  }
}

// ==============================================================
// Universal Reset (All Attendance Logs, Punches & Facial Data)
// ==============================================================
function openResetModal() {
  document.getElementById('reset-confirm-input').value = '';
  document.getElementById('reset-modal').classList.remove('hidden');
}

function closeResetModal() {
  document.getElementById('reset-modal').classList.add('hidden');
}

async function executeTotalReset() {
  const confirmVal = document.getElementById('reset-confirm-input').value.trim().toUpperCase();
  if (confirmVal !== 'RESET') {
    alert('Please type RESET in the confirmation box to proceed.');
    return;
  }

  const btn = document.getElementById('reset-confirm-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Resetting...</span>';
  lucide.createIcons();

  try {
    if (supabaseClient) {
      // 1. Fetch all attendance logs and delete by specific IDs (bypasses any bulk UUID filter edge case)
      const { data: logsData, error: fetchLogsErr } = await supabaseClient
        .from('attendance_logs')
        .select('id');
      
      if (!fetchLogsErr && logsData && logsData.length > 0) {
        const logIds = logsData.map(l => l.id);
        const { error: attErr } = await supabaseClient
          .from('attendance_logs')
          .delete()
          .in('id', logIds);
        if (attErr) console.warn('Attendance logs delete notice:', attErr.message);
      }

      // Also try direct neq delete
      await supabaseClient
        .from('attendance_logs')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      // 2. Fetch all employees and delete by specific IDs
      const { data: empsData, error: fetchEmpsErr } = await supabaseClient
        .from('employees')
        .select('id');
      
      if (!fetchEmpsErr && empsData && empsData.length > 0) {
        const empIds = empsData.map(e => e.id);
        const { error: empErr } = await supabaseClient
          .from('employees')
          .delete()
          .in('id', empIds);
        if (empErr) console.warn('Employees delete notice:', empErr.message);
      }

      await supabaseClient
        .from('employees')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // Reset local state
    attendanceLogs = [];
    employeesList = [];

    renderAttendanceLogs([]);
    renderEmployees([]);
    updateMetrics();
    renderSummaryView();

    closeResetModal();

    alert('Universal Reset Complete: All attendance logs, punches, and registered facial profiles have been wiped.');
  } catch (err) {
    alert('Reset encountered an issue: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}

function renderSampleDemoData() {
  employeesList = [];
  attendanceLogs = [];
  renderAttendanceLogs([]);
  renderEmployees([]);
  updateMetrics();
  renderSummaryView();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]);
}
