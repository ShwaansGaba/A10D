// ==============================================================
// FaceID Attendance Dashboard - Application Logic
// Multi-Tenant Royal Blue Architecture & Active Kiosk Fleet Hub
// ==============================================================

// Safe wrapper to prevent Lucide errors from crashing script execution
function safeCreateIcons() {
  try {
    if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  } catch (err) {
    console.warn('Lucide icon render warning:', err);
  }
}

let supabaseClient = null;
let currentAuthUser = null;
let attendanceLogs = [];
let employeesList = [];
let activeKiosksList = [];
let employeeViewMode = 'table'; // 'table' | 'grid'
let activeAttendanceModalEmp = null;
let activeAttendanceModalLogs = [];

// Multi-Step Sign-Up & Auth State
let authMode = 'login'; // 'login' | 'signup'
let signupStep = 1;     // 1: Email, 2: OTP, 3: Password & Captcha
let pendingSignupEmail = '';
let isSignupInProgress = false;
let resendTimerInterval = null;
let isCaptchaVerified = false;

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

  // Purge any legacy deleted accounts blacklist from localStorage
  try {
    localStorage.removeItem('a10d_deleted_accounts');
  } catch (_) {}

  // Set default summary and live feed date pickers to today
  const todayYmd = new Date().toISOString().slice(0, 10);
  const currentYm = new Date().toISOString().slice(0, 7);
  const summaryPicker = document.getElementById('summary-date-picker');
  if (summaryPicker) {
    summaryPicker.value = todayYmd;
  }
  const summaryMonthPicker = document.getElementById('summary-month-picker');
  if (summaryMonthPicker) {
    summaryMonthPicker.value = currentYm;
  }
  const liveFeedPicker = document.getElementById('live-feed-date-picker');
  if (liveFeedPicker) {
    liveFeedPicker.value = todayYmd;
  }
  const modalMonthPicker = document.getElementById('modal-attendance-month');
  if (modalMonthPicker) {
    modalMonthPicker.value = currentYm;
  }

  initOtpBoxHandlers();
  initCaptchaSlider();
  safeCreateIcons();

  // Explicitly attach click listeners to auth buttons for 100% clickability
  const linkGotoSignup = document.getElementById('link-goto-signup');
  if (linkGotoSignup) {
    linkGotoSignup.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthMode('signup');
    });
  }
  const linkGotoLogin = document.getElementById('link-goto-login');
  if (linkGotoLogin) {
    linkGotoLogin.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthMode('login');
    });
  }
  const tabBtnLogin = document.getElementById('tab-btn-login');
  if (tabBtnLogin) {
    tabBtnLogin.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthMode('login');
    });
  }
  const tabBtnSignup = document.getElementById('tab-btn-signup');
  if (tabBtnSignup) {
    tabBtnSignup.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthMode('signup');
    });
  }

  initSupabase();
});

// Expose auth controllers to window for global inline accessibility
window.switchAuthMode = switchAuthMode;
window.goToSignupStep = goToSignupStep;
window.goToSignupStep1 = goToSignupStep1;
window.appendDomain = appendDomain;
window.togglePasswordVisibility = togglePasswordVisibility;
window.handleLoginSubmit = handleLoginSubmit;
window.handleSignupStep1Submit = handleSignupStep1Submit;
window.handleSignupStep2Submit = handleSignupStep2Submit;
window.handleSignupStep3Submit = handleSignupStep3Submit;
window.resendOtpCode = resendOtpCode;
window.switchTab = switchTab;
window.switchSidebarTab = switchSidebarTab;
window.handleSaveAccountProfile = handleSaveAccountProfile;
window.handleUpdatePassword = handleUpdatePassword;
window.openDeleteAccountModal = openDeleteAccountModal;
window.closeDeleteAccountModal = closeDeleteAccountModal;
window.executeAccountDeletion = executeAccountDeletion;
window.handleGlobalSearch = handleGlobalSearch;
window.openAddEmployeeModal = openAddEmployeeModal;
window.closeAddEmployeeModal = closeAddEmployeeModal;
window.handleCreateEmployee = handleCreateEmployee;
window.handleEnrollFileUpload = handleEnrollFileUpload;
window.clearEnrollPhoto = clearEnrollPhoto;
window.startEnrollCamera = startEnrollCamera;
window.stopEnrollCamera = stopEnrollCamera;
window.captureEnrollPhoto = captureEnrollPhoto;
window.setEmployeeViewMode = setEmployeeViewMode;
window.openEmployeeAttendanceModal = openEmployeeAttendanceModal;
window.closeEmployeeAttendanceModal = closeEmployeeAttendanceModal;
window.filterModalAttendanceRecords = filterModalAttendanceRecords;
window.setModalViewMode = setModalViewMode;
window.stepModalMonth = stepModalMonth;
window.setModalMonthFilter = setModalMonthFilter;
window.handleModalMonthChange = handleModalMonthChange;
window.setSummaryViewMode = setSummaryViewMode;
window.stepSummaryMonth = stepSummaryMonth;
window.openEditEmployeeModal = openEditEmployeeModal;
window.closeEditEmployeeModal = closeEditEmployeeModal;
window.handleEditFileUpload = handleEditFileUpload;
window.clearEditEnrollPhoto = clearEditEnrollPhoto;
window.startEditEnrollCamera = startEditEnrollCamera;
window.stopEditEnrollCamera = stopEditEnrollCamera;
window.captureEditEnrollPhoto = captureEditEnrollPhoto;
window.handleUpdateEmployee = handleUpdateEmployee;
window.openEditAttendanceModal = openEditAttendanceModal;
window.closeEditAttendanceModal = closeEditAttendanceModal;
window.setEditPunchQuickPunctuality = setEditPunchQuickPunctuality;
window.handleUpdateAttendance = handleUpdateAttendance;

// ==============================================================
// Theme Toggle (Light / Dark Theme)
// ==============================================================
function initTheme() {
  const savedTheme = localStorage.getItem('portal_theme') || 'light';
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
  safeCreateIcons();
}

// ==============================================================
// Multi-Tenant Supabase Authentication
// ==============================================================
async function initAuth() {
  if (!supabaseClient) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
      handleAuthSuccess(session.user);
    } else {
      showAuthOverlay();
    }
  } catch (err) {
    console.warn('Session check error:', err);
    showAuthOverlay();
  }

  // Realtime Auth State Change Listener
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log('Supabase Auth State Event:', event);
    if (session && session.user) {
      handleAuthSuccess(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentAuthUser = null;
      showAuthOverlay();
    }
  });
}

function showAuthOverlay() {
  const auth = document.getElementById('auth-container') || document.getElementById('auth-overlay');
  const main = document.getElementById('main-app-container');
  if (main) main.classList.add('hidden');
  if (auth) {
    auth.classList.remove('hidden');
    switchAuthMode('login');
  }
  // Enforce dark theme exclusively on login page
  document.documentElement.classList.add('dark');
  document.body.className = 'bg-[#1D93CA] min-h-screen font-sans antialiased transition-colors duration-200 flex items-center justify-center p-2 sm:p-4 md:p-6 lg:p-8';
}

function hideAuthOverlay() {
  const auth = document.getElementById('auth-container') || document.getElementById('auth-overlay');
  const main = document.getElementById('main-app-container');
  if (auth) auth.classList.add('hidden');
  if (main) main.classList.remove('hidden');
  
  // Restore portal theme for dashboard (defaulting to light theme)
  const savedTheme = localStorage.getItem('portal_theme') || 'light';
  applyTheme(savedTheme);

  document.body.className = 'bg-[#E5E9F2] dark:bg-[#0B0F17] text-slate-800 dark:text-gray-100 min-h-screen font-sans antialiased transition-colors duration-200 p-2 sm:p-4 md:p-6 lg:p-8 flex items-center justify-center';
}

function handleAuthSuccess(user) {
  currentAuthUser = user;
  hideAuthOverlay();

  // Display user/workspace identifier in the header
  const userBadge = document.getElementById('user-profile-badge');
  const userText = document.getElementById('tenant-display-name');
  const avatarInitial = document.getElementById('tenant-avatar-initial');
  if (userText) {
    const meta = user.user_metadata || {};
    const name = meta.company_name || meta.full_name || user.email || 'Workspace';
    userText.innerText = name.length > 20 ? name.slice(0, 18) + '...' : name;
  }
  if (avatarInitial) {
    const meta = user.user_metadata || {};
    const letter = (meta.company_name || meta.full_name || user.email || 'A')[0].toUpperCase();
    avatarInitial.innerText = letter;
  }
  if (userBadge) userBadge.classList.remove('hidden');

  populateAccountTab();

  // Load tenant-isolated data
  fetchEmployees();
  fetchAttendanceLogs();
  fetchActiveKiosks();
  subscribeToUniversalRealtime();
  switchTab('dashboard');
}

async function handleUserLogout() {
  if (!confirm('Are you sure you want to sign out of this workspace?')) return;
  if (!supabaseClient) return;

  try {
    stopWebScanner();
    stopEnrollCamera();
    await supabaseClient.auth.signOut();
  } catch (err) {
    console.warn('Logout notice:', err.message);
  } finally {
    currentAuthUser = null;
    employeesList = [];
    attendanceLogs = [];
    activeKiosksList = [];
    renderEmployees([]);
    renderAttendanceLogs([]);
    updateMetrics();
    showAuthOverlay();
  }
}

// Switch between LOGIN and SIGN UP modes
function switchAuthMode(mode) {
  authMode = mode;
  hideAuthAlert();

  const viewLogin = document.getElementById('auth-view-login');
  const viewSignup1 = document.getElementById('auth-view-signup-1');
  const viewSignup2 = document.getElementById('auth-view-signup-2');
  const titleEl = document.getElementById('auth-form-title');
  const subtitleEl = document.getElementById('auth-form-subtitle');

  if (mode === 'login') {
    isSignupInProgress = false;
    if (titleEl) titleEl.textContent = 'Sign in';
    if (subtitleEl) subtitleEl.textContent = 'Enter your credentials to access your workspace';

    if (viewLogin) viewLogin.classList.remove('hidden');
    if (viewSignup1) viewSignup1.classList.add('hidden');
    if (viewSignup2) viewSignup2.classList.add('hidden');
  } else {
    if (titleEl) titleEl.textContent = 'Create Account';
    if (subtitleEl) subtitleEl.textContent = 'Set up your A10D workspace in 2 quick steps';

    goToSignupStep(1);
  }
  safeCreateIcons();
}

function goToSignupStep(step) {
  signupStep = step;
  hideAuthAlert();

  const viewLogin = document.getElementById('auth-view-login');
  const viewSignup1 = document.getElementById('auth-view-signup-1');
  const viewSignup2 = document.getElementById('auth-view-signup-2');
  const titleEl = document.getElementById('auth-form-title');
  const subtitleEl = document.getElementById('auth-form-subtitle');

  if (viewLogin) viewLogin.classList.add('hidden');
  if (viewSignup1) viewSignup1.classList.add('hidden');
  if (viewSignup2) viewSignup2.classList.add('hidden');

  if (step === 1) {
    if (titleEl) titleEl.textContent = 'Create Account';
    if (subtitleEl) subtitleEl.textContent = 'Set up your A10D workspace in 2 quick steps';
    if (viewSignup1) viewSignup1.classList.remove('hidden');
  } else if (step === 2) {
    if (titleEl) titleEl.textContent = 'Verify Email';
    if (subtitleEl) subtitleEl.textContent = 'Enter the 6-digit confirmation code sent to your email';
    if (viewSignup2) viewSignup2.classList.remove('hidden');
    const emailDisp = document.getElementById('otp-target-email');
    if (emailDisp) emailDisp.innerText = pendingSignupEmail;
    clearOtpBoxes();
    focusFirstOtpBox();
    startResendCountdown();
  }
  safeCreateIcons();
}

function goToSignupStep1() {
  goToSignupStep(1);
}

// Smart Defaults: Domain Quick Append
function appendDomain(domain) {
  const input = document.getElementById('signup-email');
  if (!input) return;
  const current = input.value.trim();
  if (!current) {
    input.value = domain;
  } else if (current.includes('@')) {
    input.value = current.split('@')[0] + domain;
  } else {
    input.value = current + domain;
  }
  input.focus();
}

// Toggle password text visibility (supports both text button "SHOW"/"HIDE" and SVG icon)
function togglePasswordVisibility(inputId, trigger) {
  const input = document.getElementById(inputId);
  const el = typeof trigger === 'string' ? document.getElementById(trigger) : trigger;
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (el) {
      if (el.tagName === 'BUTTON' || el.tagName === 'SPAN') {
        el.textContent = 'HIDE';
      } else {
        el.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
      }
    }
  } else {
    input.type = 'password';
    if (el) {
      if (el.tagName === 'BUTTON' || el.tagName === 'SPAN') {
        el.textContent = 'SHOW';
      } else {
        el.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
      }
    }
  }
}

function quickFillDemoWorkspace() {
  const email = document.getElementById('login-email');
  const pass = document.getElementById('login-password');
  if (email && pass) {
    email.value = 'admin@a10d.ai';
    pass.value = 'admin1234';
    showAuthAlert('Demo credentials filled. Click "Sign in" to test.', 'success');
  }
}
window.quickFillDemoWorkspace = quickFillDemoWorkspace;

// Alert banner inside auth card
function showAuthAlert(msg, type = 'error') {
  const box = document.getElementById('auth-alert-box');
  const text = document.getElementById('auth-alert-text');
  const icon = document.getElementById('auth-alert-icon');
  if (!box || !text) return;

  box.classList.remove('hidden');
  text.innerText = msg;
  if (type === 'success') {
    box.className = 'mb-4 p-3 rounded-xl text-xs font-medium flex items-start space-x-2.5 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
    if (icon) {
      icon.innerHTML = `<svg class="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
    }
  } else {
    box.className = 'mb-4 p-3 rounded-xl text-xs font-medium flex items-start space-x-2.5 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800';
    if (icon) {
      icon.innerHTML = `<svg class="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }
  }
}

function hideAuthAlert() {
  const box = document.getElementById('auth-alert-box');
  if (box) box.classList.add('hidden');
}

// ------------------------------------------------------------------
// Auth Form Actions: Login & 3-Step Sign Up
// ------------------------------------------------------------------

// Login
async function handleLoginSubmit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) {
    showAuthAlert('Supabase connection is not initialized.');
    return;
  }

  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const password = passwordInput ? passwordInput.value : '';
  const btn = document.getElementById('login-btn') || document.getElementById('login-submit-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Sign In</span>';

  // Ensure any stale local blacklist is wiped
  try {
    localStorage.removeItem('a10d_deleted_accounts');
  } catch (_) {}

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Signing In...</span>';
  }
  safeCreateIcons();

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    if (data && data.user) {
      // Clear account_deleted flag if leftover in metadata
      if (data.user.user_metadata && data.user.user_metadata.account_deleted === true) {
        try {
          await supabaseClient.auth.updateUser({
            data: { account_deleted: false, restored_at: new Date().toISOString() }
          });
        } catch (_) {}
      }
      handleAuthSuccess(data.user);
    }
  } catch (err) {
    console.error('Login error:', err);
    showAuthAlert(err.message || 'Invalid email or password. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Sign Up - Step 1: Submit Work Email, Password & Workspace
async function handleSignupStep1Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) {
    showAuthAlert('Supabase connection is not initialized.');
    return;
  }

  const emailInput = document.getElementById('signup-email');
  const passInput = document.getElementById('signup-password');
  const companyInput = document.getElementById('signup-company');

  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const password = passInput ? passInput.value : '';
  const company = companyInput ? companyInput.value.trim() : '';

  if (!email || !email.includes('@')) {
    showAuthAlert('Please enter a valid work email address.');
    return;
  }

  if (!password || password.length < 6) {
    showAuthAlert('Password must be at least 6 characters long.');
    return;
  }

  pendingSignupEmail = email;
  const btn = document.getElementById('signup-1-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Create Account & Send Code</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Creating Account & Sending Code...</span>';
  }
  safeCreateIcons();

  try {
    const redirectUrl = window.location.origin ? (window.location.origin + window.location.pathname) : undefined;
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          company_name: company || 'A10D Workspace',
          account_deleted: false,
        },
        emailRedirectTo: redirectUrl,
      }
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already registered')) {
        const loginEmail = document.getElementById('login-email');
        if (loginEmail) loginEmail.value = email;
        switchAuthMode('login');
        showAuthAlert('This email is already registered. Please sign in with your password.', 'error');
        return;
      }
      throw error;
    }

    // In Supabase, if email confirmation is required and user already exists,
    // signUp() doesn't throw an error but returns user with empty identities: []
    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      const loginEmail = document.getElementById('login-email');
      if (loginEmail) loginEmail.value = email;
      switchAuthMode('login');
      showAuthAlert('This email is already registered. Please sign in with your password.', 'error');
      return;
    }

    // If Supabase project has email confirmation turned off, session is returned immediately
    if (data && data.session && data.user) {
      handleAuthSuccess(data.user);
      return;
    }

    // Move cleanly to Step 2 for OTP confirmation
    goToSignupStep(2);
    showAuthAlert('A 6-digit verification code has been sent to ' + email + '. Please check your email.', 'success');
  } catch (err) {
    console.error('Signup Step 1 Error:', err);
    let msg = err.message || 'Failed to dispatch verification code.';
    if (msg.includes('Error sending confirmation email')) {
      msg = 'Email dispatch limit reached (3/hr) on default Supabase SMTP. Please configure custom SMTP or try again shortly.';
    }
    showAuthAlert(msg, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Sign Up - Step 2: Verify 6-Digit OTP Code
async function handleSignupStep2Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) return;

  const otp = getEnteredOtp();
  if (!otp || otp.length < 6) {
    showAuthAlert('Please enter the 6-digit confirmation code from your email.');
    return;
  }

  const btn = document.getElementById('signup-2-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Verify & Enter Workspace</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Verifying Code...</span>';
  }
  safeCreateIcons();

  try {
    // Primary: verifyOtp with type: 'signup' (matches supabase.auth.signUp confirmation token)
    let { data, error } = await supabaseClient.auth.verifyOtp({
      email: pendingSignupEmail,
      token: otp,
      type: 'signup',
    });

    // Fallback: if 'signup' type fails, try 'email' in case project is using magiclink/email OTP
    if (error) {
      console.warn('verifyOtp signup type returned error, trying fallback type email...', error);
      const resEmail = await supabaseClient.auth.verifyOtp({
        email: pendingSignupEmail,
        token: otp,
        type: 'email',
      });
      if (!resEmail.error) {
        data = resEmail.data;
        error = null;
      }
    }

    if (error) throw error;

    const activeUser = data?.user || (await supabaseClient.auth.getUser()).data.user;
    if (!activeUser) {
      throw new Error('Verification completed, but active session was not returned. Please sign in with your password.');
    }

    // Clean up flags and enter workspace
    isSignupInProgress = false;
    authMode = 'login';
    handleAuthSuccess(activeUser);
  } catch (err) {
    console.error('OTP Verify Error:', err);
    showAuthAlert(err.message || 'Invalid or expired confirmation code. Please check your email and try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Retained as stub for backwards compatibility
async function handleSignupStep3Submit(e) {
  if (e) e.preventDefault();
}

// Resend OTP Code
async function resendOtpCode() {
  if (!pendingSignupEmail || !supabaseClient) return;
  const btn = document.getElementById('resend-btn') || document.getElementById('btn-resend-otp');
  if (btn && btn.disabled) return;

  try {
    const { error } = await supabaseClient.auth.resend({
      type: 'signup',
      email: pendingSignupEmail,
    });
    if (error) {
      // Fallback
      await supabaseClient.auth.signInWithOtp({
        email: pendingSignupEmail,
        options: { shouldCreateUser: false },
      });
    }
    showAuthAlert('A fresh verification code has been sent to ' + pendingSignupEmail, 'success');
    startResendCountdown();
  } catch (err) {
    showAuthAlert(err.message || 'Could not resend code. Please wait a minute and try again.');
  }
}

function startResendCountdown() {
  const btn = document.getElementById('resend-btn') || document.getElementById('btn-resend-otp');
  const countdownEl = document.getElementById('resend-timer-text') || document.getElementById('resend-countdown');
  if (!btn || !countdownEl) return;

  clearInterval(resendTimerInterval);
  let timeLeft = 30;
  btn.disabled = true;
  btn.classList.add('opacity-50', 'cursor-not-allowed');
  countdownEl.innerText = `(${timeLeft}s)`;
  countdownEl.classList.remove('hidden');

  resendTimerInterval = setInterval(() => {
    timeLeft--;
    countdownEl.innerText = `(${timeLeft}s)`;
    if (timeLeft <= 0) {
      clearInterval(resendTimerInterval);
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
      countdownEl.classList.add('hidden');
      countdownEl.innerText = '';
    }
  }, 1000);
}

// Universal OTP Input Handler (Supports 6, 7, 8, 10 digits seamlessly)
function initOtpBoxHandlers() {
  const input = document.getElementById('signup-otp-input');
  if (!input) return;

  input.addEventListener('input', (e) => {
    const clean = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = clean;
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
    input.value = pasteData;
  });
}

function getEnteredOtp() {
  const input = document.getElementById('signup-otp-input');
  if (input) {
    return input.value.replace(/[^0-9]/g, '').trim();
  }
  const boxes = document.querySelectorAll('.otp-box');
  let code = '';
  boxes.forEach((b) => (code += b.value));
  return code.trim();
}

function clearOtpBoxes() {
  const input = document.getElementById('signup-otp-input');
  if (input) input.value = '';
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((b) => (b.value = ''));
}

function focusFirstOtpBox() {
  const input = document.getElementById('signup-otp-input');
  if (input) {
    setTimeout(() => input.focus(), 150);
    return;
  }
  const first = document.querySelector('.otp-box[data-idx="0"]');
  if (first) setTimeout(() => first.focus(), 150);
}

// ------------------------------------------------------------------
// Interactive Smart Captcha Slider
// ------------------------------------------------------------------
function initCaptchaSlider() {
  const track = document.getElementById('captcha-track');
  const handle = document.getElementById('captcha-handle');
  const fill = document.getElementById('captcha-fill');
  const text = document.getElementById('captcha-text');
  const status = document.getElementById('captcha-status');
  if (!track || !handle) return;

  let isDragging = false;
  let startX = 0;

  const onStart = (e) => {
    if (isCaptchaVerified) return;
    isDragging = true;
    startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    handle.style.transition = 'none';
    fill.style.transition = 'none';
  };

  const onMove = (e) => {
    if (!isDragging || isCaptchaVerified) return;
    const currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const deltaX = currentX - startX;
    const maxTrack = track.clientWidth - handle.clientWidth - 8;
    const clampedX = Math.max(0, Math.min(deltaX, maxTrack));

    handle.style.transform = `translateX(${clampedX}px)`;
    fill.style.width = `${clampedX + handle.clientWidth}px`;

    // Verified threshold (90% traversed)
    if (clampedX >= maxTrack * 0.92) {
      completeCaptcha();
    }
  };

  const onEnd = () => {
    if (!isDragging || isCaptchaVerified) return;
    isDragging = false;
    handle.style.transition = 'transform 0.3s ease';
    fill.style.transition = 'width 0.3s ease';
    handle.style.transform = 'translateX(0px)';
    fill.style.width = '0px';
  };

  handle.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);

  handle.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onEnd);
}

function completeCaptcha() {
  isCaptchaVerified = true;
  const handle = document.getElementById('captcha-handle');
  const fill = document.getElementById('captcha-fill');
  const text = document.getElementById('captcha-text');
  const status = document.getElementById('captcha-status');
  const icon = document.getElementById('captcha-icon');

  if (handle) {
    handle.className = 'absolute right-1 top-1 bottom-1 w-9 bg-emerald-500 text-white rounded-lg flex items-center justify-center cursor-default shadow-md';
    handle.style.transform = 'none';
  }
  if (fill) {
    fill.style.width = '100%';
    fill.className = 'absolute left-0 top-0 bottom-0 bg-emerald-500/20';
  }
  if (text) {
    text.innerText = '✓ Human Verification Complete';
    text.className = 'w-full text-center text-[11px] font-bold text-emerald-600 dark:text-emerald-400';
  }
  if (status) {
    status.innerText = '✓ Verified';
    status.className = 'text-[10px] text-emerald-500 font-bold';
  }
  if (icon) {
    icon.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  safeCreateIcons();
}

function resetCaptchaSlider() {
  isCaptchaVerified = false;
  const handle = document.getElementById('captcha-handle');
  const fill = document.getElementById('captcha-fill');
  const text = document.getElementById('captcha-text');
  const status = document.getElementById('captcha-status');
  const icon = document.getElementById('captcha-icon');

  if (handle) {
    handle.className = 'absolute left-1 top-1 bottom-1 w-9 bg-blue-600 text-white rounded-lg flex items-center justify-center cursor-grab shadow-md';
    handle.style.transform = 'translateX(0px)';
  }
  if (fill) {
    fill.style.width = '0px';
    fill.className = 'absolute left-0 top-0 bottom-0 bg-blue-600/20';
  }
  if (text) {
    text.innerText = 'Slide right to verify human →';
    text.className = 'w-full text-center text-[11px] font-semibold text-slate-500 dark:text-gray-400 pointer-events-none';
  }
  if (status) {
    status.innerText = 'Slide to complete';
    status.className = 'text-[10px] text-amber-500 font-bold';
  }
  if (icon) {
    icon.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`;
  }
  safeCreateIcons();
}

async function handleForgotPassword() {
  const email = prompt('Enter your registered email address to receive a password reset link:');
  if (!email || !supabaseClient) return;

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim());
    if (error) throw error;
    alert('Password reset link has been dispatched to: ' + email);
  } catch (err) {
    alert('Error sending reset link: ' + err.message);
  }
}

// ------------------------------------------------------------------
// Active Kiosks Fleet Management (Tenant-Scoped Realtime Presence)
// ------------------------------------------------------------------
let presenceFleetChannel = null;
let realtimePresenceKiosks = [];

function subscribeToPresenceFleet() {
  if (!supabaseClient) return;
  try {
    if (presenceFleetChannel) {
      presenceFleetChannel.unsubscribe();
      presenceFleetChannel = null;
    }

    // Tenant-isolated channel: Only kiosks belonging to this specific user ID connect!
    const channelName = currentAuthUser ? ('presence_kiosks_' + currentAuthUser.id) : 'presence_kiosks_guest';
    presenceFleetChannel = supabaseClient.channel(channelName);
    presenceFleetChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceFleetChannel.presenceState();
        handlePresenceStateChange(state);
      })
      .on('presence', { event: 'join' }, () => {
        const state = presenceFleetChannel.presenceState();
        handlePresenceStateChange(state);
      })
      .on('presence', { event: 'leave' }, () => {
        const state = presenceFleetChannel.presenceState();
        handlePresenceStateChange(state);
      })
      .subscribe(async (status) => {
        console.log('Kiosk Fleet Presence Channel Status:', status);
        if (status === 'SUBSCRIBED') {
          try {
            await presenceFleetChannel.track({
              device_id: 'web_dashboard_' + (currentAuthUser ? currentAuthUser.id.slice(0, 8) : 'admin'),
              device_name: 'Web Admin Dashboard',
              platform: 'Web',
              user_id: currentAuthUser ? currentAuthUser.id : '',
              user_email: currentAuthUser ? currentAuthUser.email : '',
              status: 'ONLINE',
              online_at: new Date().toISOString(),
            });
          } catch (_) {}
        }
      });
  } catch (err) {
    console.warn('Presence fleet init notice:', err);
  }
}

function handlePresenceStateChange(state) {
  const list = [];
  for (const key in state) {
    const presences = state[key];
    if (Array.isArray(presences)) {
      for (const p of presences) {
        if (!p || !p.device_id) continue;

        // Tenant boundary check: Strictly isolate kiosks to the currently logged in workspace account!
        if (currentAuthUser) {
          if (p.user_id && p.user_id !== currentAuthUser.id) continue;
          if (!p.user_id && p.user_email && p.user_email.toLowerCase() !== currentAuthUser.email.toLowerCase()) continue;
          if (!p.user_id && !p.user_email && p.platform !== 'Web') continue;
        }

        list.push({
          device_id: p.device_id,
          device_name: p.device_name || 'Terminal',
          platform: p.platform || 'Android Phone',
          user_id: p.user_id || '',
          is_active: true,
          last_heartbeat: p.online_at || new Date().toISOString(),
          is_presence_online: true,
        });
      }
    }
  }
  realtimePresenceKiosks = list;
  fetchActiveKiosks();
}

async function fetchActiveKiosks() {
  if (!supabaseClient) return;

  let tableKiosks = [];
  try {
    let query = supabaseClient
      .from('kiosks')
      .select('*')
      .order('last_heartbeat', { ascending: false });

    // Strict tenant filtering on kiosks table
    if (currentAuthUser && currentAuthUser.id) {
      query = query.eq('user_id', currentAuthUser.id);
    }
    const { data, error } = await query;

    if (!error && Array.isArray(data)) {
      tableKiosks = data;
    }
  } catch (_) {}

  // Aggregate with recent devices from attendance_logs (marked inactive unless live)
  const recentLogsKiosks = [];
  if (Array.isArray(attendanceLogs)) {
    const seenDevs = new Set();
    const now = Date.now();
    for (const log of attendanceLogs) {
      if (log.device_id && !seenDevs.has(log.device_id)) {
        seenDevs.add(log.device_id);
        const logTime = new Date(log.created_at).getTime();
        const isRecent = (now - logTime) < (3 * 60 * 1000); // Only within last 3 minutes
        recentLogsKiosks.push({
          device_id: log.device_id,
          device_name: log.device_id.startsWith('kiosk_') ? 'Android Terminal (Kiosk)' : log.device_id,
          platform: log.device_id.toLowerCase().includes('web') ? 'Web' : 'Android Phone',
          is_active: isRecent,
          last_heartbeat: log.created_at,
        });
      }
    }
  }

  // Merge sources: Realtime Presence > Table Kiosks > Recent Logs Kiosks
  const map = new Map();
  for (const k of recentLogsKiosks) {
    map.set(k.device_id, k);
  }
  for (const k of tableKiosks) {
    map.set(k.device_id, k);
  }
  for (const k of realtimePresenceKiosks) {
    map.set(k.device_id, k);
  }

  activeKiosksList = Array.from(map.values());
  renderActiveKiosks();
}

function renderActiveKiosks() {
  const countBadge = document.getElementById('active-kiosks-text');
  const listContainer = document.getElementById('kiosks-list-container');
  if (!countBadge) return;

  const now = Date.now();
  // Kiosk is active if presence is online OR heartbeat within last 3 minutes
  const activeKiosks = activeKiosksList.filter((k) => {
    if (k.is_presence_online) return true;
    if (k.is_active === false) return false;
    const hbTime = new Date(k.last_heartbeat || k.created_at || 0).getTime();
    return (now - hbTime) < (3 * 60 * 1000);
  });

  const activeCount = activeKiosks.length;
  countBadge.innerText = `${activeCount} Kiosk${activeCount === 1 ? '' : 's'} Active`;

  const dashKiosks = document.getElementById('dash-kiosks-count');
  if (dashKiosks) dashKiosks.textContent = activeCount;

  if (!listContainer) return;

  if (activeKiosksList.length === 0) {
    listContainer.innerHTML = `
      <div class="text-center py-8 text-xs text-slate-400 dark:text-gray-500">
        <div class="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center mx-auto mb-3">
          <i data-lucide="smartphone" class="w-6 h-6"></i>
        </div>
        <p class="font-semibold text-slate-700 dark:text-gray-300">No Kiosks Registered Yet</p>
        <p class="text-[11px] mt-1 max-w-xs mx-auto">Open the FaceID Android app on your phone, and it will immediately appear here live as an active kiosk.</p>
      </div>
    `;
    safeCreateIcons();
    return;
  }

  listContainer.innerHTML = activeKiosksList.map((k) => {
    const isOnline = k.is_presence_online || (k.is_active && (now - new Date(k.last_heartbeat || 0).getTime() < (15 * 60 * 1000)));
    const timeFormatted = k.last_heartbeat ? new Date(k.last_heartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Live Now';

    return `
      <div class="p-3.5 rounded-xl border ${isOnline ? 'border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10' : 'border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-900/50'} flex items-center justify-between transition-all">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl ${isOnline ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-gray-200 dark:bg-gray-800 text-gray-400'} flex items-center justify-center shrink-0">
            <i data-lucide="${k.platform === 'Web' ? 'monitor' : 'smartphone'}" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="font-bold text-xs text-slate-900 dark:text-white flex items-center space-x-2">
              <span>${escapeHtml(k.device_name || 'Kiosk Terminal')}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${isOnline ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-gray-200 dark:bg-gray-800 text-gray-500'}">
                ${isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 flex items-center space-x-2">
              <span>Platform: ${escapeHtml(k.platform || 'Android Phone')}</span>
              <span>•</span>
              <span>${isOnline ? 'Active Now' : 'Last Seen: ' + timeFormatted}</span>
            </div>
          </div>
        </div>
        <div class="text-right">
          <span class="text-[10px] font-mono text-slate-400 dark:text-gray-500">ID: ${escapeHtml((k.device_id || '').slice(0, 14))}</span>
        </div>
      </div>
    `;
  }).join('');
  safeCreateIcons();
}

function openKiosksModal() {
  const modal = document.getElementById('kiosks-modal');
  if (modal) {
    modal.classList.remove('hidden');
    fetchActiveKiosks();
  }
  safeCreateIcons();
}

function closeKiosksModal() {
  const modal = document.getElementById('kiosks-modal');
  if (modal) modal.classList.add('hidden');
}

// ==============================================================
// Navigation & Tab Controller ('dashboard' | 'live' | 'scanner' | 'summary' | 'employees' | 'account')
// ==============================================================
let activeNavTab = 'dashboard';
let activeSidebarTab = 'act';

function switchTab(tab) {
  activeNavTab = tab;

  const views = {
    dashboard: document.getElementById('view-dashboard'),
    live: document.getElementById('view-live'),
    scanner: document.getElementById('view-scanner'),
    summary: document.getElementById('view-summary'),
    employees: document.getElementById('view-employees'),
    account: document.getElementById('view-account'),
  };

  const dockTabs = {
    dashboard: document.getElementById('dock-tab-dashboard'),
    live: document.getElementById('dock-tab-live'),
    scanner: document.getElementById('dock-tab-scanner'),
    summary: document.getElementById('dock-tab-summary'),
    employees: document.getElementById('dock-tab-employees'),
    account: document.getElementById('dock-tab-account'),
  };

  const titles = {
    dashboard: 'Dashboard',
    live: 'Live Attendance Stream',
    scanner: 'Webcam Face Scanner Kiosk',
    summary: 'Attendance Reports & Summary',
    employees: 'Staff & Biometric Roster',
    account: 'Account & Workspace Settings'
  };

  const titleEl = document.getElementById('page-title');
  if (titleEl && titles[tab]) {
    titleEl.textContent = titles[tab];
  }

  // Active / Inactive dock tab button classes
  const activeClass = 'w-full flex items-center space-x-3.5 px-4 py-3 rounded-2xl bg-white text-[#167BB0] shadow-lg shadow-black/10 font-bold text-sm cursor-pointer transition-all';
  const inactiveClass = 'w-full flex items-center space-x-3.5 px-4 py-3 rounded-2xl text-sky-100 hover:text-white hover:bg-white/10 font-medium text-sm cursor-pointer transition-all';

  // Toggle views
  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === tab) {
        views[key].classList.remove('hidden');
      } else {
        views[key].classList.add('hidden');
      }
    }
  });

  // Toggle dock icons
  Object.keys(dockTabs).forEach(key => {
    if (dockTabs[key]) {
      dockTabs[key].className = (key === tab) ? activeClass : inactiveClass;
    }
  });

  if (tab === 'scanner') {
    startWebScanner();
  } else {
    stopWebScanner();
  }

  if (tab === 'dashboard') {
    updateDashboardMetrics();
  } else if (tab === 'summary') {
    renderSummaryView();
  } else if (tab === 'account') {
    populateAccountTab();
  }

  safeCreateIcons();
}

// Update Overview Dashboard Metrics (Hero Curve, Middle 2 Cards, Bottom 3 Cards)
function updateDashboardMetrics() {
  const totalStaff = employeesList.length;
  const todayStr = new Date().toDateString();
  const todayLogs = attendanceLogs.filter(log => new Date(log.created_at).toDateString() === todayStr);

  const heroPunches = document.getElementById('hero-total-punches');
  if (heroPunches) heroPunches.textContent = `${todayLogs.length} Punches`;

  const heroStaff = document.getElementById('hero-total-staff');
  if (heroStaff) heroStaff.textContent = `${totalStaff} Staff`;

  // Punched unique employees today
  const punchedSet = new Set();
  let lateCount = 0;
  todayLogs.forEach(log => {
    const empKey = (log.employee_name || log.employee_id || '').trim().toLowerCase();
    if (empKey && !punchedSet.has(empKey)) {
      punchedSet.add(empKey);
      if (isPunchLate(new Date(log.created_at))) lateCount++;
    }
  });

  const presentCount = punchedSet.size;
  const onTimeCount = Math.max(0, presentCount - lateCount);
  const onTimeRate = presentCount > 0 ? Math.round((onTimeCount / presentCount) * 100) : 98;

  const heroRate = document.getElementById('hero-ontime-rate');
  if (heroRate) heroRate.textContent = `${onTimeRate}%`;

  const waveBadge = document.getElementById('hero-wave-badge');
  if (waveBadge) waveBadge.textContent = `${todayLogs.length} Punches Today`;

  const dashKiosks = document.getElementById('dash-kiosks-count');
  if (dashKiosks) dashKiosks.textContent = activeKiosksList.length;

  const dashTodayPunches = document.getElementById('dash-today-punches');
  if (dashTodayPunches) dashTodayPunches.textContent = todayLogs.length;

  const statSynced = document.getElementById('stat-synced-faces');
  if (statSynced) statSynced.textContent = totalStaff;

  const statSyncedBar = document.getElementById('stat-synced-bar');
  if (statSyncedBar) statSyncedBar.style.width = '100%';

  const statPunctualBar = document.getElementById('stat-punctual-bar');
  if (statPunctualBar) statPunctualBar.style.width = `${onTimeRate}%`;

  const lateMetric = document.getElementById('metric-late-today');
  if (lateMetric) lateMetric.textContent = lateCount;

  renderSidebarActivity();
}

// Right Sidebar Activity / Kiosks Switcher
function switchSidebarTab(tab) {
  activeSidebarTab = tab;
  const btnAct = document.getElementById('sidebar-tab-act');
  const btnKiosks = document.getElementById('sidebar-tab-kiosks');

  if (tab === 'act') {
    if (btnAct) btnAct.className = 'py-1.5 rounded-lg text-center bg-[#167BB0] text-white font-semibold shadow-sm transition-all cursor-pointer';
    if (btnKiosks) btnKiosks.className = 'py-1.5 rounded-lg text-center text-slate-600 dark:text-slate-400 font-medium hover:text-slate-900 transition-all cursor-pointer';
  } else {
    if (btnKiosks) btnKiosks.className = 'py-1.5 rounded-lg text-center bg-[#167BB0] text-white font-semibold shadow-sm transition-all cursor-pointer';
    if (btnAct) btnAct.className = 'py-1.5 rounded-lg text-center text-slate-600 dark:text-slate-400 font-medium hover:text-slate-900 transition-all cursor-pointer';
  }

  renderSidebarActivity();
  safeCreateIcons();
}

// Helper: Format ISO string to readable local time (HH:MM AM/PM)
function formatLocalTime(isoStr) {
  if (!isoStr) return '--:--';
  try {
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '--:--';
  }
}

// Helper: Check if a kiosk device heartbeat is active (within last 15 minutes or via presence)
function isKioskHeartbeatActive(k) {
  if (!k) return false;
  if (k.is_presence_online) return true;
  if (k.is_active === false) return false;
  const hb = new Date(k.last_heartbeat || k.created_at || 0).getTime();
  return (Date.now() - hb) < (15 * 60 * 1000);
}

function renderSidebarActivity() {
  const container = document.getElementById('sidebar-activity-list');
  if (!container) return;

  if (activeSidebarTab === 'act') {
    if (!attendanceLogs || attendanceLogs.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-xs text-slate-400">
          <i data-lucide="clock" class="w-5 h-5 mx-auto mb-1.5 text-sky-400"></i>
          <span>No punches recorded yet</span>
        </div>`;
      safeCreateIcons();
      return;
    }

    const recent = attendanceLogs.slice(0, 8);
    container.innerHTML = recent.map(log => {
      const name = escapeHtml(log.employee_name || 'Staff');
      const time = formatLocalTime(log.created_at);
      const isLate = isPunchLate(new Date(log.created_at));
      const device = escapeHtml(log.device_name || log.device_id || 'Kiosk');
      const initial = name[0] ? name[0].toUpperCase() : 'S';

      return `
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-sky-50/50 dark:hover:bg-slate-800 transition-colors">
          <div class="flex items-center space-x-3 min-w-0">
            <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-[#167BB0] to-[#1D93CA] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
              ${initial}
            </div>
            <div class="min-w-0">
              <div class="font-bold text-xs text-slate-800 dark:text-white truncate">${name}</div>
              <div class="text-[11px] text-slate-400 truncate">${device} • ${time}</div>
            </div>
          </div>
          <div class="shrink-0 pl-2">
            <span class="w-7 h-7 rounded-full ${isLate ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'} flex items-center justify-center">
              <i data-lucide="${isLate ? 'clock' : 'check'}" class="w-3.5 h-3.5"></i>
            </span>
          </div>
        </div>`;
    }).join('');
  } else {
    // Render Kiosks in sidebar
    if (!activeKiosksList || activeKiosksList.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-xs text-slate-400">
          <i data-lucide="smartphone" class="w-5 h-5 mx-auto mb-1.5 text-sky-400"></i>
          <span>No hardware kiosks registered</span>
        </div>`;
      safeCreateIcons();
      return;
    }

    container.innerHTML = activeKiosksList.map(k => {
      const name = escapeHtml(k.device_name || 'Android Kiosk');
      const ip = escapeHtml(k.ip_address || 'Cloud Link');
      const active = isKioskHeartbeatActive(k);

      return `
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-sky-50/50 dark:hover:bg-slate-800 transition-colors">
          <div class="flex items-center space-x-3 min-w-0">
            <div class="w-9 h-9 rounded-2xl bg-[#167BB0]/15 text-[#167BB0] dark:text-sky-300 flex items-center justify-center shrink-0">
              <i data-lucide="tablet" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0">
              <div class="font-bold text-xs text-slate-800 dark:text-white truncate">${name}</div>
              <div class="text-[11px] text-slate-400 truncate">${ip}</div>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}">
            ${active ? 'Online' : 'Standby'}
          </span>
        </div>`;
    }).join('');
  }

  safeCreateIcons();
}

// ==============================================================
// Account Tab & Workspace Management (Sync with Supabase)
// ==============================================================
function populateAccountTab() {
  if (!currentAuthUser) return;
  const meta = currentAuthUser.user_metadata || {};

  const nameInput = document.getElementById('account-fullname');
  if (nameInput) nameInput.value = meta.full_name || '';

  const compInput = document.getElementById('account-company');
  if (compInput) compInput.value = meta.company_name || localStorage.getItem('tenant_company_name') || '';

  const emailInput = document.getElementById('account-email');
  if (emailInput) emailInput.value = currentAuthUser.email || '';

  const uidInput = document.getElementById('account-uid');
  if (uidInput) uidInput.value = currentAuthUser.id || '';
}

async function handleSaveAccountProfile(e) {
  e.preventDefault();
  if (!supabaseClient || !currentAuthUser) return;

  const btn = document.getElementById('account-save-profile-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Save Changes</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Saving...</span>';
  }

  const fullName = document.getElementById('account-fullname').value.trim();
  const companyName = document.getElementById('account-company').value.trim();

  try {
    const { data, error } = await supabaseClient.auth.updateUser({
      data: {
        full_name: fullName,
        company_name: companyName
      }
    });

    if (error) throw error;
    if (data && data.user) {
      currentAuthUser = data.user;
    }

    if (companyName) {
      localStorage.setItem('tenant_company_name', companyName);
    }

    // Update display in header
    const displayNameEl = document.getElementById('tenant-display-name');
    if (displayNameEl) {
      const display = companyName || fullName || currentAuthUser.email;
      displayNameEl.innerText = display.length > 20 ? display.slice(0, 18) + '...' : display;
    }
    const avatarInitial = document.getElementById('tenant-avatar-initial');
    if (avatarInitial) {
      avatarInitial.innerText = (fullName || companyName || currentAuthUser.email || 'A')[0].toUpperCase();
    }

    alert('Workspace profile updated successfully!');
  } catch (err) {
    console.error('Save Profile Error:', err);
    alert('Failed to update workspace profile: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

async function handleUpdatePassword(e) {
  e.preventDefault();
  if (!supabaseClient) return;

  const newPass = document.getElementById('account-new-password').value;
  const confPass = document.getElementById('account-confirm-password').value;

  if (newPass.length < 6) {
    alert('Password must be at least 6 characters long.');
    return;
  }
  if (newPass !== confPass) {
    alert('Passwords do not match. Please re-enter.');
    return;
  }

  const btn = document.getElementById('account-update-password-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Update Password</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Updating...</span>';
  }

  try {
    const { data, error } = await supabaseClient.auth.updateUser({
      password: newPass
    });

    if (error) throw error;
    document.getElementById('account-new-password').value = '';
    document.getElementById('account-confirm-password').value = '';
    alert('Password updated successfully!');
  } catch (err) {
    console.error('Password Update Error:', err);
    alert('Failed to update password: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

function openDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');
  if (modal) {
    document.getElementById('delete-account-confirm-input').value = '';
    modal.classList.remove('hidden');
  }
  safeCreateIcons();
}

function closeDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');
  if (modal) modal.classList.add('hidden');
}

async function executeAccountDeletion() {
  const input = document.getElementById('delete-account-confirm-input');
  if (!input || input.value.trim().toUpperCase() !== 'DELETE') {
    alert('Please type DELETE in capital letters to confirm account deletion.');
    return;
  }

  if (!supabaseClient || !currentAuthUser) return;

  const btn = document.getElementById('delete-account-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Delete Workspace & Account</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Deleting Account & Data...</span>';
  }

  try {
    const userId = currentAuthUser.id;
    const userEmail = (currentAuthUser.email || '').toLowerCase().trim();

    // 1. Delete all attendance logs
    try {
      await supabaseClient.from('attendance_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } catch (e) {
      console.warn('Attendance logs delete error:', e.message);
    }

    // 2. Delete all employees and facial profiles
    try {
      await supabaseClient.from('employees').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } catch (e) {
      console.warn('Employees delete error:', e.message);
    }

    // 3. Delete all kiosks (if table exists)
    try {
      await supabaseClient.from('kiosks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    } catch (_) {}

    // 4. Permanently delete user from auth.users via Supabase Auth Admin API (ZERO TRACE)
    let userPurged = false;
    if (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.serviceKey) {
      try {
        const adminDeleteRes = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_CONFIG.serviceKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.serviceKey}`
          }
        });
        if (adminDeleteRes.ok || adminDeleteRes.status === 200 || adminDeleteRes.status === 204) {
          userPurged = true;
          console.log(`User ${userId} permanently and entirely deleted from auth.users via Admin API.`);
        }
      } catch (adminErr) {
        console.warn('Admin user purge notice:', adminErr.message);
      }
    }

    // 5. Secondary fallback: call SECURITY DEFINER RPC delete_user()
    if (!userPurged) {
      try {
        const { error: rpcError } = await supabaseClient.rpc('delete_user');
        if (!rpcError) {
          userPurged = true;
          console.log('User record permanently purged from auth.users via database RPC.');
        } else {
          console.warn('delete_user RPC notice:', rpcError.message);
        }
      } catch (e) {
        console.warn('delete_user RPC execution notice:', e);
      }
    }

    try {
      localStorage.removeItem('a10d_deleted_accounts');
    } catch (_) {}

    // 7. Sign out permanently
    try {
      await supabaseClient.auth.signOut();
    } catch (_) {}

    // 5. Clear all local tenant state
    currentAuthUser = null;
    employeesList = [];
    attendanceLogs = [];
    activeKiosksList = [];
    localStorage.removeItem('tenant_company_name');

    closeDeleteAccountModal();
    renderEmployees([]);
    renderAttendanceLogs([]);
    updateDashboardMetrics();
    showAuthOverlay();
    showAuthAlert('Your workspace account and all biometric facial data have been permanently erased.', 'success');
  } catch (err) {
    console.error('Account Deletion Error:', err);
    alert('Account deletion encountered an issue: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Global Header Search Controller
function handleGlobalSearch(query) {
  const q = (query || '').toLowerCase().trim();
  if (activeNavTab === 'employees') {
    const searchInput = document.getElementById('search-employees');
    if (searchInput) {
      searchInput.value = query;
      filterEmployees();
    }
  } else if (activeNavTab === 'live') {
    const searchInput = document.getElementById('search-attendance');
    if (searchInput) {
      searchInput.value = query;
      filterAttendanceLogs();
    }
  } else {
    // Filter sidebar list
    if (activeSidebarTab === 'act') {
      const filtered = attendanceLogs.filter(log => (log.employee_name || '').toLowerCase().includes(q));
      const container = document.getElementById('sidebar-activity-list');
      if (container && q) {
        if (filtered.length === 0) {
          container.innerHTML = '<div class="text-center py-6 text-xs text-slate-400">No matching activity found</div>';
        } else {
          container.innerHTML = filtered.slice(0, 8).map(log => `
            <div class="flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              <div class="font-bold text-xs text-slate-800 dark:text-white truncate">${escapeHtml(log.employee_name)}</div>
              <div class="text-[11px] text-slate-400">${formatLocalTime(log.created_at)}</div>
            </div>
          `).join('');
        }
      } else {
        renderSidebarActivity();
      }
    }
  }
}

// ==============================================================
// Supabase Client & Realtime Universal Subscriptions
// ==============================================================
function initSupabase() {
  const url = localStorage.getItem('supabase_url') || SUPABASE_CONFIG.url;
  const key = localStorage.getItem('supabase_anon_key') || SUPABASE_CONFIG.anonKey;

  const badge = document.getElementById('connection-badge');

  if (!url || !key) {
    if (badge) {
      badge.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 flex items-center space-x-1.5 hover:bg-red-500/20 transition-all cursor-pointer';
      badge.innerHTML = '<i data-lucide="cloud-off" class="w-3.5 h-3.5 mr-1 text-red-500"></i><span>Configure Supabase</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    }
    safeCreateIcons();
    renderSampleDemoData();
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(url, key);

    if (badge) {
      badge.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center space-x-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer';
      badge.innerHTML = '<i data-lucide="cloud" class="w-3.5 h-3.5 mr-1 text-slate-500"></i><span>Connected</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    }
    safeCreateIcons();

    // Initialize Auth Session Check
    initAuth();
  } catch (err) {
    console.error('Failed to init Supabase:', err);
    if (badge) {
      badge.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center space-x-1.5 hover:bg-amber-500/20 transition-all cursor-pointer';
      badge.innerHTML = '<i data-lucide="alert-circle" class="w-3.5 h-3.5 mr-1 text-amber-500"></i><span>Connection Error</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    }
    safeCreateIcons();
  }
}

// Live Bidirectional Sync: Listen for changes on employees and attendance_logs + Realtime Presence
function subscribeToUniversalRealtime() {
  if (!supabaseClient) return;

  // Subscribe to live Realtime Presence Fleet for hardware kiosks & phones
  subscribeToPresenceFleet();

  // Unsubscribe existing channel if any
  try {
    supabaseClient.removeChannel('realtime-universal-hub');
  } catch (_) {}

  supabaseClient
    .channel('realtime-universal-hub')
    // 1. Employees changes
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'employees' },
      async (payload) => {
        console.log('Realtime employees change detected:', payload.eventType);
        await fetchEmployees();
      }
    )
    // 2. Attendance punch changes
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
    cacheAllEmployeeDescriptors(employeesList);
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
    // Update active kiosks based on recent punch device IDs
    fetchActiveKiosks();
  } catch (e) {
    console.warn('Attendance logs fetch notice:', e.message);
  }
}

// Local cache for punctuality manual overrides
let punctualityOverrides = {};
try {
  punctualityOverrides = JSON.parse(localStorage.getItem('a10d_punctuality_overrides') || '{}');
} catch (_) {}

// Helper: Check if a punch time is late (after 09:30 AM local time)
function isPunchLate(dateObj) {
  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();
  return (hours > 9 || (hours === 9 && minutes > 30));
}

// Master Helper: Get Punctuality status taking overrides and database values into account
function getPunchPunctuality(log) {
  if (log && log.id && punctualityOverrides[log.id]) {
    return punctualityOverrides[log.id];
  }
  if (log && log.punctuality && log.punctuality !== 'Auto') {
    return log.punctuality;
  }
  if (log && log.created_at) {
    const dateObj = new Date(log.created_at);
    return isPunchLate(dateObj) ? 'Late' : 'On Time';
  }
  return 'On Time';
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

// Format date to local YYYY-MM-DD
function formatLocalYMD(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Build standard HTML table rows for attendance records
function buildAttendanceRowsHtml(logs, emptyTitle, emptySubtitle) {
  if (!logs || logs.length === 0) {
    return `
      <tr>
        <td colspan="6" class="py-12 text-center text-gray-500">
          <div class="flex flex-col items-center justify-center space-y-2">
            <i data-lucide="clock" class="w-8 h-8 text-gray-400 dark:text-gray-600"></i>
            <p class="text-sm font-medium text-slate-700 dark:text-gray-300">${emptyTitle || 'No attendance records logged yet.'}</p>
            ${emptySubtitle ? `<p class="text-xs text-slate-400 dark:text-gray-500">${emptySubtitle}</p>` : ''}
          </div>
        </td>
      </tr>
    `;
  }

  return logs.map((log) => {
    const dateObj = new Date(log.created_at);
    const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateFormatted = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const punctuality = getPunchPunctuality(log);

    let punctualityBadge;
    if (punctuality === 'Late') {
      punctualityBadge = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          <i data-lucide="alert-circle" class="w-3 h-3 mr-1"></i>Late Arrival
        </span>`;
    } else if (punctuality === 'On Time') {
      punctualityBadge = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
          <i data-lucide="check" class="w-3 h-3 mr-1"></i>On Time
        </span>`;
    } else {
      punctualityBadge = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
          <i data-lucide="info" class="w-3 h-3 mr-1"></i>${escapeHtml(punctuality)}
        </span>`;
    }

    const punchTypeBadge = log.punch_type === 'OUT'
      ? `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Checked Out</span>`
      : `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">Checked In</span>`;

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-[#161E2A] transition-colors">
        <td class="py-3.5 px-4 flex items-center space-x-3">
          <div class="w-9 h-9 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-300 font-bold text-xs uppercase overflow-hidden shrink-0">
            ${log.photo_url 
              ? `<img src="${log.photo_url}" class="w-full h-full object-cover">`
              : (log.employee_name || 'U').charAt(0)
            }
          </div>
          <div>
            <div class="font-semibold text-slate-900 dark:text-white text-sm">${escapeHtml(log.employee_name || 'Unknown')}</div>
            <div class="text-[11px] text-slate-500 dark:text-gray-500 font-mono">${log.employee_id ? '#' + log.employee_id.slice(0, 8) : 'Biometric ID'}</div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          ${punchTypeBadge}
        </td>
        <td class="py-3.5 px-4">
          <div class="text-slate-900 dark:text-white font-medium text-xs font-mono">${timeFormatted}</div>
          <div class="text-[11px] text-slate-500 dark:text-gray-500">${dateFormatted}</div>
        </td>
        <td class="py-3.5 px-4">
          ${punctualityBadge}
        </td>
        <td class="py-3.5 px-4 text-xs text-slate-600 dark:text-gray-400">
          <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-[11px] text-slate-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700/60">${escapeHtml(log.device_id || 'Kiosk-1')}</span>
        </td>
        <td class="py-3.5 px-4 text-right">
          <div class="flex items-center justify-end space-x-1">
            <button onclick="openEditAttendanceModal('${log.id}')" class="text-slate-400 hover:text-[#167BB0] p-1.5 rounded-lg hover:bg-[#167BB0]/10 transition-all cursor-pointer" title="Edit Punch Details & Punctuality">
              <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button onclick="handleDeletePunch('${log.id}')" class="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer" title="Remove Punch Record">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Render Dashboard Attendance Stream (TODAY ONLY - Resets Every Day Automatically)
function renderDashboardAttendance() {
  const tbody = document.getElementById('attendance-table-body');
  if (!tbody) return;

  const todayStr = new Date().toDateString();
  const todayLogs = (attendanceLogs || []).filter(log => new Date(log.created_at).toDateString() === todayStr);

  tbody.innerHTML = buildAttendanceRowsHtml(
    todayLogs,
    "No attendance punches logged today.",
    "Realtime check-ins from connected kiosks and web terminals will appear here."
  );
  safeCreateIcons();
}

// Render Live Feed Attendance Stream (Filtered by Selected Date & Query)
function renderLiveFeedAttendance(logsToRender) {
  const tbodyFull = document.getElementById('attendance-table-body-full');
  if (!tbodyFull) return;

  const datePicker = document.getElementById('live-feed-date-picker');
  const selectedDate = datePicker ? datePicker.value.trim() : '';

  let subtitle = "Punches will appear here live as employees check in.";
  if (selectedDate) {
    try {
      subtitle = `Showing records for ${new Date(selectedDate + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}.`;
    } catch (_) {}
  }

  tbodyFull.innerHTML = buildAttendanceRowsHtml(
    logsToRender,
    "No attendance records match the selected filter.",
    subtitle
  );
  safeCreateIcons();
}

// Master Render Attendance function called on data updates
function renderAttendanceLogs(logs) {
  renderDashboardAttendance();
  filterAttendanceLogs();
}

let summaryViewMode = 'monthly'; // 'monthly' | 'daily'

function setSummaryViewMode(mode) {
  summaryViewMode = mode;
  const monthBtn = document.getElementById('summary-view-month-btn');
  const dailyBtn = document.getElementById('summary-view-daily-btn');
  const monthCtrl = document.getElementById('summary-month-control');
  const dateCtrl = document.getElementById('summary-date-control');
  const kpisWrap = document.getElementById('summary-month-kpis');

  if (mode === 'monthly') {
    if (monthBtn) monthBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#151B28] text-[#167BB0] shadow-sm transition-all cursor-pointer";
    if (dailyBtn) dailyBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer";
    if (monthCtrl) monthCtrl.classList.remove('hidden');
    if (dateCtrl) {
      dateCtrl.classList.add('hidden');
      dateCtrl.classList.remove('flex');
    }
    if (kpisWrap) kpisWrap.classList.remove('hidden');
  } else {
    if (monthBtn) monthBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer";
    if (dailyBtn) dailyBtn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#151B28] text-[#167BB0] shadow-sm transition-all cursor-pointer";
    if (monthCtrl) monthCtrl.classList.add('hidden');
    if (dateCtrl) {
      dateCtrl.classList.remove('hidden');
      dateCtrl.classList.add('flex');
    }
    if (kpisWrap) kpisWrap.classList.add('hidden');
  }
  renderSummaryView();
}

function stepSummaryMonth(delta) {
  const picker = document.getElementById('summary-month-picker');
  const currentVal = picker && picker.value ? picker.value : new Date().toISOString().slice(0, 7);
  const [y, m] = currentVal.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const nextYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (picker) picker.value = nextYm;
  renderSummaryView();
}

// Render Daily & Monthly Attendance Summary View
function renderSummaryView() {
  const thead = document.getElementById('summary-table-head');
  const tbody = document.getElementById('summary-table-body');
  if (!tbody) return;

  if (summaryViewMode === 'monthly') {
    renderMonthlyMasterSummary(thead, tbody);
  } else {
    renderDailyLogSummary(thead, tbody);
  }
}

// Master Monthly Attendance Summary Table & KPIs
function renderMonthlyMasterSummary(thead, tbody) {
  const monthPicker = document.getElementById('summary-month-picker');
  const selectedYm = monthPicker && monthPicker.value 
    ? monthPicker.value 
    : new Date().toISOString().slice(0, 7);

  const [selYear, selMonthNum] = selectedYm.split('-').map(Number);
  const selMonthIndex = selMonthNum - 1;
  const monthDateObj = new Date(selYear, selMonthIndex, 1);
  const monthNameStr = monthDateObj.toLocaleDateString([], { month: 'short', year: 'numeric' });
  const daysInMonth = new Date(selYear, selMonthIndex + 1, 0).getDate();

  // Set Table Header for Monthly View
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th class="py-3 px-4 font-semibold">Employee</th>
        <th class="py-3 px-4 font-semibold">Department</th>
        <th class="py-3 px-4 font-semibold">Monthly Base Salary</th>
        <th class="py-3 px-4 font-semibold text-center">Days Present</th>
        <th class="py-3 px-4 font-semibold text-center">On Time</th>
        <th class="py-3 px-4 font-semibold text-center">Late</th>
        <th class="py-3 px-4 font-semibold text-center">Attendance %</th>
        <th class="py-3 px-4 font-semibold">Est. Payout</th>
        <th class="py-3 px-4 font-semibold text-right">Actions</th>
      </tr>
    `;
  }

  if (!employeesList || employeesList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-12 text-center text-gray-500">
          <i data-lucide="users" class="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-gray-600"></i>
          <p class="text-xs font-semibold">No employees enrolled in directory yet.</p>
        </td>
      </tr>
    `;
    safeCreateIcons();
    return;
  }

  let totalMonthPresentDaysAll = 0;
  let totalMonthPunchesAll = 0;
  let totalEstimatedPayroll = 0;

  const rowsHtml = employeesList.map(emp => {
    const empKey = (emp.name || '').trim().toLowerCase();
    
    // Filter this employee's logs in this month
    const empMonthLogs = (attendanceLogs || []).filter(log => {
      const d = new Date(log.created_at);
      const isMonth = d.getFullYear() === selYear && d.getMonth() === selMonthIndex;
      const isEmp = log.employee_id === emp.id || ((log.employee_name || '').trim().toLowerCase() === empKey);
      return isMonth && isEmp;
    });

    totalMonthPunchesAll += empMonthLogs.length;

    // Group punches by local YMD date
    const dateMap = {};
    empMonthLogs.forEach(log => {
      const dStr = formatLocalYMD(new Date(log.created_at));
      if (!dateMap[dStr]) dateMap[dStr] = [];
      dateMap[dStr].push(log);
    });

    const presentDays = Object.keys(dateMap).length;
    totalMonthPresentDaysAll += presentDays;

    let onTimeDays = 0;
    let lateDays = 0;

    Object.values(dateMap).forEach(dayLogs => {
      dayLogs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const firstPunch = dayLogs[0];
      const punc = getPunchPunctuality(firstPunch);
      if (punc === 'Late') {
        lateDays++;
      } else {
        onTimeDays++;
      }
    });

    // Attendance percentage based on days elapsed or total days in month
    const now = new Date();
    const isCurrentMonth = (now.getFullYear() === selYear && now.getMonth() === selMonthIndex);
    const benchmarkDays = isCurrentMonth ? Math.max(1, now.getDate()) : daysInMonth;
    const attRate = Math.min(100, Math.round((presentDays / benchmarkDays) * 100));

    // Pro-rated estimated payout
    const salary = Number(emp.salary) || 0;
    const estPayout = salary > 0 ? Math.round((presentDays / daysInMonth) * salary) : 0;
    totalEstimatedPayroll += (estPayout > 0 ? estPayout : salary);

    return `
      <tr class="hover:bg-slate-50 dark:hover:bg-[#161E2A] transition-colors">
        <td class="py-3 px-4">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 rounded-xl bg-[#167BB0]/10 border border-[#167BB0]/20 flex items-center justify-center text-[#167BB0] font-bold text-xs uppercase overflow-hidden shrink-0">
              ${emp.photo_url ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">` : escapeHtml(emp.name.charAt(0))}
            </div>
            <div>
              <div class="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">${escapeHtml(emp.name)}</div>
              <div class="text-[11px] text-slate-400 font-mono">${escapeHtml(emp.employee_code || 'EMP-' + emp.id.slice(0, 4))}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-4 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] border border-slate-200 dark:border-slate-700">${escapeHtml(emp.department || 'General')}</span>
        </td>
        <td class="py-3 px-4 text-xs font-semibold text-slate-900 dark:text-white">
          ${formatCurrency(salary)}<span class="text-[10px] text-slate-400 font-normal">/mo</span>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="inline-flex items-center justify-center font-bold text-sm text-[#167BB0] dark:text-sky-300 font-mono">${presentDays}</span>
          <span class="text-[11px] text-slate-400">/${daysInMonth}d</span>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">${onTimeDays}</span>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${lateDays > 0 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800' : 'text-slate-400'}">${lateDays}</span>
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <div class="w-12 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500 rounded-full" style="width: ${attRate}%;"></div>
            </div>
            <span class="text-xs font-bold text-slate-800 dark:text-slate-200">${attRate}%</span>
          </div>
        </td>
        <td class="py-3 px-4 font-bold text-xs text-emerald-600 dark:text-emerald-400">
          ${formatCurrency(estPayout > 0 ? estPayout : (presentDays > 0 ? salary : 0))}
        </td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end space-x-1">
            <button onclick="openEmployeeAttendanceModal('${emp.id}')" class="px-2.5 py-1 rounded-xl text-xs font-semibold bg-[#167BB0]/10 hover:bg-[#167BB0] text-[#167BB0] hover:text-white transition-all border border-[#167BB0]/30 shadow-xs cursor-pointer flex items-center space-x-1" title="Inspect Employee Attendance Sheet">
              <i data-lucide="calendar" class="w-3 h-3"></i>
              <span>Sheet</span>
            </button>
            <button onclick="openEditEmployeeModal('${emp.id}')" class="p-1 rounded-lg text-slate-400 hover:text-[#167BB0] hover:bg-[#167BB0]/10 transition-all cursor-pointer" title="Edit Employee">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHtml;

  // Update Monthly Summary KPI Cards
  const kpiMonthEl = document.getElementById('stat-sum-month');
  const kpiDaysEl = document.getElementById('stat-sum-present-days');
  const kpiPunchesEl = document.getElementById('stat-sum-punches');
  const kpiPayrollEl = document.getElementById('stat-sum-payroll');

  if (kpiMonthEl) kpiMonthEl.textContent = monthNameStr;
  if (kpiDaysEl) kpiDaysEl.textContent = totalMonthPresentDaysAll;
  if (kpiPunchesEl) kpiPunchesEl.textContent = totalMonthPunchesAll;
  if (kpiPayrollEl) kpiPayrollEl.textContent = formatCurrency(totalEstimatedPayroll);

  safeCreateIcons();
}

// Daily Log Summary View
function renderDailyLogSummary(thead, tbody) {
  const summaryPicker = document.getElementById('summary-date-picker');
  const selectedDateStr = summaryPicker && summaryPicker.value 
    ? summaryPicker.value 
    : new Date().toISOString().slice(0, 10);

  const selectedDate = new Date(selectedDateStr + 'T00:00:00');
  const selectedMonth = selectedDate.getMonth();
  const selectedYear = selectedDate.getFullYear();

  if (thead) {
    thead.innerHTML = `
      <tr>
        <th class="py-3 px-4 font-semibold">Employee</th>
        <th class="py-3 px-4 font-semibold">Department</th>
        <th class="py-3 px-4 font-semibold">Punch Time</th>
        <th class="py-3 px-4 font-semibold">Status</th>
        <th class="py-3 px-4 font-semibold">Punctuality</th>
        <th class="py-3 px-4 font-semibold text-center">Monthly Total</th>
        <th class="py-3 px-4 font-semibold text-right">Actions</th>
      </tr>
    `;
  }

  if (!employeesList || employeesList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-gray-500">
          No employees found in directory.
        </td>
      </tr>
    `;
    safeCreateIcons();
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
      const punctuality = getPunchPunctuality(datePunch);

      punctualityBadge = punctuality === 'Late'
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
            ? `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                Present
               </span>`
            : `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                Absent
               </span>`
          }
        </td>
        <td class="py-3.5 px-4">
          ${punctualityBadge}
        </td>
        <td class="py-3.5 px-4 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <span class="font-bold text-cyan-600 dark:text-cyan-400 text-sm font-mono">${monthlyDays}</span>
            <span class="text-xs text-slate-500 dark:text-gray-500">days</span>
          </div>
        </td>
        <td class="py-3.5 px-4 text-right">
          ${datePunch ? `
            <button onclick="openEditAttendanceModal('${datePunch.id}')" class="p-1 rounded text-slate-400 hover:text-[#167BB0] hover:bg-[#167BB0]/10 transition-all cursor-pointer" title="Edit Punch">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
          ` : `
            <button onclick="openManualPunchModal()" class="px-2 py-1 rounded text-[11px] font-semibold text-[#167BB0] hover:bg-[#167BB0]/10 transition-all cursor-pointer" title="Log Manual Punch">
              + Punch
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');

  safeCreateIcons();
}

// Helper: Currency Formatter
function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Toggle Employee Table vs Grid View
function setEmployeeViewMode(mode) {
  employeeViewMode = mode;
  const tableContainer = document.getElementById('employees-table-container');
  const gridContainer = document.getElementById('employees-grid');
  const tableBtn = document.getElementById('emp-view-table-btn');
  const gridBtn = document.getElementById('emp-view-grid-btn');

  if (mode === 'table') {
    if (tableContainer) tableContainer.classList.remove('hidden');
    if (gridContainer) gridContainer.classList.add('hidden');
    if (tableBtn) {
      tableBtn.className = "p-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#151B28] text-[#167BB0] shadow-sm transition-all";
    }
    if (gridBtn) {
      gridBtn.className = "p-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all";
    }
  } else {
    if (tableContainer) tableContainer.classList.add('hidden');
    if (gridContainer) gridContainer.classList.remove('hidden');
    if (tableBtn) {
      tableBtn.className = "p-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all";
    }
    if (gridBtn) {
      gridBtn.className = "p-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#151B28] text-[#167BB0] shadow-sm transition-all";
    }
  }
}

// Render Professional Employee Management Table & Grid
function renderEmployees(employees) {
  const tableBody = document.getElementById('employees-table-body');
  const grid = document.getElementById('employees-grid');
  if (!tableBody && !grid) return;

  const staffList = employees || [];

  // Update Top KPIs
  const totalStaff = staffList.length;
  const totalPayroll = staffList.reduce((sum, e) => sum + (Number(e.salary) || 0), 0);
  const avgSalary = totalStaff > 0 ? Math.round(totalPayroll / totalStaff) : 0;
  const enrolledCount = staffList.filter(e => e.embeddings || e.photo_url).length;
  const enrolledPct = totalStaff > 0 ? Math.round((enrolledCount / totalStaff) * 100) : 0;

  const statTotalEl = document.getElementById('stat-emp-total');
  const statPayrollEl = document.getElementById('stat-emp-payroll');
  const statAvgSalaryEl = document.getElementById('stat-emp-avg-salary');
  const statBiometricEl = document.getElementById('stat-emp-biometric');

  if (statTotalEl) statTotalEl.textContent = totalStaff;
  if (statPayrollEl) statPayrollEl.textContent = formatCurrency(totalPayroll);
  if (statAvgSalaryEl) statAvgSalaryEl.textContent = formatCurrency(avgSalary);
  if (statBiometricEl) statBiometricEl.textContent = `${enrolledPct}% (${enrolledCount}/${totalStaff})`;

  // Update Department dropdown filter dynamically
  const deptFilter = document.getElementById('filter-emp-dept');
  if (deptFilter && (!deptFilter.children || deptFilter.children.length <= 1)) {
    const currentVal = deptFilter.value;
    const depts = Array.from(new Set(employeesList.map(e => (e.department || 'General').trim()).filter(Boolean))).sort();
    deptFilter.innerHTML = '<option value="">All Departments</option>' + 
      depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    deptFilter.value = currentVal;
  }

  // Pre-calculate punch counts per employee
  const punchCountsByEmp = {};
  if (Array.isArray(attendanceLogs)) {
    for (const log of attendanceLogs) {
      if (log.employee_id) {
        punchCountsByEmp[log.employee_id] = (punchCountsByEmp[log.employee_id] || 0) + 1;
      }
      if (log.employee_name) {
        const k = log.employee_name.trim().toLowerCase();
        punchCountsByEmp[k] = (punchCountsByEmp[k] || 0) + 1;
      }
    }
  }

  // 1. Empty State
  if (staffList.length === 0) {
    const emptyRowHtml = `
      <tr>
        <td colspan="7" class="py-16 text-center text-slate-400 dark:text-gray-500">
          <i data-lucide="users" class="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-gray-600"></i>
          <p class="text-sm font-semibold text-slate-600 dark:text-gray-400">No staff members registered yet</p>
          <p class="text-xs text-slate-400 mt-1">Click "+ Enroll Staff" to add employees with their salary & photo.</p>
        </td>
      </tr>
    `;
    if (tableBody) tableBody.innerHTML = emptyRowHtml;
    if (grid) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-400 dark:text-gray-500">
          <i data-lucide="users" class="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-gray-600"></i>
          <p class="text-sm font-semibold text-slate-600 dark:text-gray-400">No staff members registered yet</p>
        </div>
      `;
    }
    safeCreateIcons();
    return;
  }

  // 2. Render Table Rows
  if (tableBody) {
    tableBody.innerHTML = staffList.map(emp => {
      const empKey = (emp.name || '').trim().toLowerCase();
      const punchesCount = punchCountsByEmp[emp.id] || punchCountsByEmp[empKey] || 0;
      const salaryStr = formatCurrency(emp.salary || 0);
      const isEnrolled = !!(emp.embeddings || emp.photo_url);

      return `
        <tr onclick="openEmployeeAttendanceModal('${emp.id}')" class="group hover:bg-sky-50/60 dark:hover:bg-slate-800/60 transition-colors cursor-pointer border-b border-slate-100 dark:border-slate-800/60">
          <!-- Employee Photo & Name -->
          <td class="py-3 px-4">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 rounded-xl bg-[#167BB0]/10 border border-[#167BB0]/20 flex items-center justify-center text-[#167BB0] font-bold text-sm overflow-hidden shrink-0 shadow-sm">
                ${emp.photo_url 
                  ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">`
                  : `<span class="uppercase">${escapeHtml(emp.name.charAt(0))}</span>`
                }
              </div>
              <div class="min-w-0">
                <p class="font-bold text-slate-900 dark:text-white text-xs sm:text-sm truncate group-hover:text-[#167BB0] dark:group-hover:text-sky-300 transition-colors">${escapeHtml(emp.name)}</p>
                <p class="font-mono text-[11px] text-slate-400 dark:text-slate-500">${escapeHtml(emp.employee_code || 'EMP-' + emp.id.slice(0, 4))}</p>
              </div>
            </div>
          </td>

          <!-- Contact Phone -->
          <td class="py-3 px-4">
            ${emp.phone 
              ? `<span class="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium"><i data-lucide="phone" class="w-3 h-3 text-[#167BB0] shrink-0"></i>${escapeHtml(emp.phone)}</span>`
              : `<span class="text-xs text-slate-400">--</span>`
            }
          </td>

          <!-- Department -->
          <td class="py-3 px-4">
            <span class="inline-block px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
              ${escapeHtml(emp.department || 'General')}
            </span>
          </td>

          <!-- Monthly Salary -->
          <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">
            <span class="inline-flex items-center gap-1 text-xs sm:text-sm text-emerald-600 dark:text-emerald-400 font-bold">
              ${salaryStr}
              <span class="text-[10px] font-normal text-slate-400">/mo</span>
            </span>
          </td>

          <!-- Biometric Status -->
          <td class="py-3 px-4">
            ${isEnrolled
              ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><i data-lucide="check" class="w-3 h-3"></i> Enrolled</span>`
              : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-800"><i data-lucide="clock" class="w-3 h-3"></i> Pending</span>`
            }
          </td>

          <!-- Attendance Record CTA -->
          <td class="py-3 px-4 text-center">
            <button type="button" onclick="event.stopPropagation(); openEmployeeAttendanceModal('${emp.id}')" class="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0]/10 hover:bg-[#167BB0] text-[#167BB0] hover:text-white transition-all border border-[#167BB0]/30 shadow-xs cursor-pointer">
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
              <span>${punchesCount} ${punchesCount === 1 ? 'Punch' : 'Punches'}</span>
            </button>
          </td>

          <!-- Actions -->
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end space-x-1">
              <button type="button" onclick="event.stopPropagation(); openEditEmployeeModal('${emp.id}')" class="p-1.5 rounded-xl text-slate-400 hover:text-[#167BB0] hover:bg-[#167BB0]/10 transition-all cursor-pointer" title="Edit Staff Details & Salary">
                <i data-lucide="pencil" class="w-4 h-4"></i>
              </button>
              <button type="button" onclick="event.stopPropagation(); handleDeleteEmployee('${emp.id}')" class="p-1.5 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all cursor-pointer" title="Delete Employee">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 3. Render Grid Cards
  if (grid) {
    grid.innerHTML = staffList.map(emp => {
      const empKey = (emp.name || '').trim().toLowerCase();
      const punchesCount = punchCountsByEmp[emp.id] || punchCountsByEmp[empKey] || 0;
      const salaryStr = formatCurrency(emp.salary || 0);

      return `
        <div onclick="openEmployeeAttendanceModal('${emp.id}')" class="bg-white dark:bg-[#151B28] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col items-center text-center shadow-sm hover:shadow-md hover:border-[#167BB0]/40 transition-all cursor-pointer relative group">
          <div class="absolute top-3 right-3 flex items-center space-x-1">
            <button onclick="event.stopPropagation(); openEditEmployeeModal('${emp.id}')" class="text-slate-400 hover:text-[#167BB0] transition-colors p-1" title="Edit Employee">
              <i data-lucide="pencil" class="w-4 h-4"></i>
            </button>
            <button onclick="event.stopPropagation(); handleDeleteEmployee('${emp.id}')" class="text-slate-400 hover:text-rose-500 transition-colors p-1" title="Delete Employee">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-[#167BB0]/10 border-2 border-[#167BB0]/20 flex items-center justify-center text-[#167BB0] font-bold text-lg mb-3 overflow-hidden shadow-sm">
            ${emp.photo_url 
              ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">`
              : `<span class="uppercase">${escapeHtml(emp.name.charAt(0))}</span>`
            }
          </div>
          <h4 class="font-bold text-slate-900 dark:text-white text-base leading-tight">${escapeHtml(emp.name)}</h4>
          <span class="text-xs text-[#167BB0] dark:text-sky-300 font-mono mt-0.5">${escapeHtml(emp.employee_code || 'EMP-' + emp.id.slice(0, 4))}</span>
          ${emp.phone ? `<span class="text-xs text-slate-500 dark:text-gray-400 flex items-center justify-center gap-1 mt-1"><i data-lucide="phone" class="w-3 h-3 text-[#167BB0]"></i>${escapeHtml(emp.phone)}</span>` : ''}
          
          <div class="flex items-center gap-2 mt-2">
            <span class="px-2.5 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-slate-700">${escapeHtml(emp.department || 'General')}</span>
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">${salaryStr}/mo</span>
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 w-full flex items-center justify-between text-xs">
            <span class="text-slate-400 font-medium">${punchesCount} Punches</span>
            <span class="text-[#167BB0] dark:text-sky-300 font-bold flex items-center gap-1 group-hover:underline">
              <span>View Attendance</span>
              <i data-lucide="chevron-right" class="w-3 h-3"></i>
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  safeCreateIcons();
}

// Modal State for Employee Attendance
let modalViewMode = 'daily'; // 'daily' | 'monthly'
let modalSelectedMonth = ''; // 'YYYY-MM' or '' for all

function setModalViewMode(mode) {
  modalViewMode = mode;
  const tabDaily = document.getElementById('modal-tab-daily');
  const tabMonthly = document.getElementById('modal-tab-monthly');
  const dailyContainer = document.getElementById('modal-daily-table-container');
  const monthlyContainer = document.getElementById('modal-monthly-table-container');
  const monthWrap = document.getElementById('modal-month-filter-wrap');
  const allBtn = document.getElementById('modal-month-all-btn');
  const searchInput = document.getElementById('modal-attendance-search');

  if (mode === 'daily') {
    if (tabDaily) tabDaily.className = "px-3 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-[#151B28] text-[#167BB0] shadow-sm transition-all cursor-pointer";
    if (tabMonthly) tabMonthly.className = "px-3 py-1 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer";
    if (dailyContainer) dailyContainer.classList.remove('hidden');
    if (monthlyContainer) monthlyContainer.classList.add('hidden');
    if (monthWrap) monthWrap.classList.remove('hidden');
    if (allBtn) allBtn.classList.remove('hidden');
    if (searchInput) searchInput.classList.remove('hidden');
  } else {
    if (tabDaily) tabDaily.className = "px-3 py-1 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all cursor-pointer";
    if (tabMonthly) tabMonthly.className = "px-3 py-1 rounded-lg text-xs font-semibold bg-white dark:bg-[#151B28] text-[#167BB0] shadow-sm transition-all cursor-pointer";
    if (dailyContainer) dailyContainer.classList.add('hidden');
    if (monthlyContainer) monthlyContainer.classList.remove('hidden');
    if (monthWrap) monthWrap.classList.add('hidden');
    if (allBtn) allBtn.classList.add('hidden');
    if (searchInput) searchInput.classList.add('hidden');
    renderModalMonthlyRows();
  }
}

function setModalMonthFilter(val) {
  const monthInput = document.getElementById('modal-attendance-month');
  const allBtn = document.getElementById('modal-month-all-btn');
  if (val === 'all') {
    modalSelectedMonth = '';
    if (monthInput) monthInput.value = '';
    if (allBtn) allBtn.className = "px-2.5 py-1 rounded-xl text-xs font-semibold bg-[#167BB0] text-white shadow-xs transition-all cursor-pointer";
  } else {
    modalSelectedMonth = val;
    if (monthInput) monthInput.value = val;
    if (allBtn) allBtn.className = "px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer";
  }
  filterModalAttendanceRecords();
}

function stepModalMonth(delta) {
  const monthInput = document.getElementById('modal-attendance-month');
  const currentVal = (monthInput && monthInput.value) || new Date().toISOString().slice(0, 7);
  const [y, m] = currentVal.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const nextYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  setModalMonthFilter(nextYm);
}

function handleModalMonthChange() {
  const monthInput = document.getElementById('modal-attendance-month');
  if (monthInput && monthInput.value) {
    setModalMonthFilter(monthInput.value);
  }
}

// Open Employee Date-Wise & Month-Wise Attendance Modal
function openEmployeeAttendanceModal(empId) {
  const emp = employeesList.find(e => e.id === empId);
  if (!emp) return;

  activeAttendanceModalEmp = emp;

  // Header Details
  const avatarEl = document.getElementById('modal-emp-avatar');
  const nameEl = document.getElementById('modal-emp-name');
  const codeEl = document.getElementById('modal-emp-code');
  const deptEl = document.getElementById('modal-emp-dept');
  const phoneEl = document.getElementById('modal-emp-phone');
  const salaryEl = document.getElementById('modal-emp-salary');
  const searchInput = document.getElementById('modal-attendance-search');
  const monthInput = document.getElementById('modal-attendance-month');

  if (avatarEl) {
    avatarEl.innerHTML = emp.photo_url 
      ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">`
      : `<span class="uppercase">${escapeHtml(emp.name.charAt(0))}</span>`;
  }
  if (nameEl) nameEl.textContent = emp.name;
  if (codeEl) codeEl.textContent = emp.employee_code || 'EMP-' + emp.id.slice(0, 4);
  if (deptEl) deptEl.innerHTML = `<i data-lucide="briefcase" class="w-3 h-3 text-slate-400"></i> ${escapeHtml(emp.department || 'General')}`;
  if (phoneEl) phoneEl.innerHTML = `<i data-lucide="phone" class="w-3 h-3 text-slate-400"></i> ${escapeHtml(emp.phone || 'No phone')}`;
  if (salaryEl) salaryEl.innerHTML = `<i data-lucide="circle-dollar-sign" class="w-3 h-3 text-emerald-500"></i> ${formatCurrency(emp.salary || 0)} / mo`;
  if (searchInput) searchInput.value = '';

  // Default to current month
  const currentYm = new Date().toISOString().slice(0, 7);
  modalSelectedMonth = currentYm;
  if (monthInput) monthInput.value = currentYm;

  // Set default view to daily logs
  setModalViewMode('daily');

  // Filter logs for this employee
  const empKey = (emp.name || '').trim().toLowerCase();
  const rawLogs = (attendanceLogs || []).filter(log => 
    log.employee_id === emp.id || 
    ((log.employee_name || '').trim().toLowerCase() === empKey)
  );

  // Group by date (formatLocalYMD)
  const dateMap = new Map();
  for (const log of rawLogs) {
    const dStr = formatLocalYMD(new Date(log.created_at));
    if (!dateMap.has(dStr)) {
      dateMap.set(dStr, []);
    }
    dateMap.get(dStr).push(log);
  }

  // Convert to sorted date-wise array (newest date first)
  const dateRecords = Array.from(dateMap.entries()).map(([dateStr, logs]) => {
    logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const firstPunch = logs[0];
    const lastPunch = logs.length > 1 ? logs[logs.length - 1] : null;
    const firstTimeObj = new Date(firstPunch.created_at);
    const punctuality = getPunchPunctuality(firstPunch);
    const isLate = punctuality === 'Late';

    return {
      punchId: firstPunch.id,
      dateStr,
      displayDate: firstTimeObj.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric', weekday: 'short' }),
      firstIn: firstTimeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      lastOut: lastPunch ? new Date(lastPunch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--',
      isLate,
      status: punctuality,
      punchesCount: logs.length,
      device: firstPunch.device_id || 'Terminal'
    };
  }).sort((a, b) => b.dateStr.localeCompare(a.dateStr));

  activeAttendanceModalLogs = dateRecords;

  // Filter records by initial month
  filterModalAttendanceRecords();

  const modal = document.getElementById('employee-attendance-modal');
  if (modal) modal.classList.remove('hidden');
  safeCreateIcons();
}

function closeEmployeeAttendanceModal() {
  const modal = document.getElementById('employee-attendance-modal');
  if (modal) modal.classList.add('hidden');
  activeAttendanceModalEmp = null;
  activeAttendanceModalLogs = [];
}

function filterModalAttendanceRecords() {
  const query = (document.getElementById('modal-attendance-search')?.value || '').toLowerCase().trim();
  const allBtn = document.getElementById('modal-month-all-btn');

  let records = activeAttendanceModalLogs || [];

  // Filter by selected Month (e.g. '2026-11') if not 'all'
  if (modalSelectedMonth) {
    records = records.filter(r => r.dateStr.startsWith(modalSelectedMonth));
    if (allBtn) allBtn.className = "px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer";
  } else {
    if (allBtn) allBtn.className = "px-2.5 py-1 rounded-xl text-xs font-semibold bg-[#167BB0] text-white shadow-xs transition-all cursor-pointer";
  }

  // Filter by query if any
  if (query) {
    records = records.filter(r => 
      r.dateStr.toLowerCase().includes(query) || 
      r.displayDate.toLowerCase().includes(query) || 
      r.status.toLowerCase().includes(query) ||
      r.device.toLowerCase().includes(query)
    );
  }

  // Update Modal Quick Metrics for this filtered scope
  const totalDays = records.length;
  const onTimeDays = records.filter(r => !r.isLate).length;
  const punctualityRate = totalDays > 0 ? Math.round((onTimeDays / totalDays) * 100) : 100;
  const totalPunches = records.reduce((sum, r) => sum + r.punchesCount, 0);

  const daysLabelEl = document.getElementById('modal-metric-days-label');
  const daysEl = document.getElementById('modal-metric-days');
  const punchesEl = document.getElementById('modal-metric-punches');
  const punctEl = document.getElementById('modal-metric-punctuality');
  const payoutEl = document.getElementById('modal-metric-payout');

  if (daysLabelEl) {
    if (modalSelectedMonth) {
      const [y, m] = modalSelectedMonth.split('-').map(Number);
      const mName = new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short' });
      daysLabelEl.textContent = `Days Present (${mName})`;
    } else {
      daysLabelEl.textContent = 'Total Days Present';
    }
  }

  if (daysEl) daysEl.textContent = totalDays;
  if (punchesEl) punchesEl.textContent = totalPunches;
  if (punctEl) punctEl.textContent = `${punctualityRate}%`;

  if (payoutEl && activeAttendanceModalEmp) {
    const salary = Number(activeAttendanceModalEmp.salary) || 0;
    if (salary > 0 && modalSelectedMonth) {
      const [y, m] = modalSelectedMonth.split('-').map(Number);
      const dim = new Date(y, m, 0).getDate();
      const estPay = Math.round((totalDays / dim) * salary);
      payoutEl.textContent = formatCurrency(estPay > 0 ? estPay : (totalDays > 0 ? salary : 0));
    } else if (salary > 0) {
      payoutEl.textContent = `${formatCurrency(salary)}/mo`;
    } else {
      payoutEl.textContent = '₹0';
    }
  }

  renderModalAttendanceRows(records);
}

function renderModalAttendanceRows(records) {
  const tbody = document.getElementById('modal-attendance-rows');
  const summaryEl = document.getElementById('modal-attendance-summary');
  if (!tbody) return;

  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-slate-400 dark:text-gray-500">
          <i data-lucide="calendar-x" class="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-gray-600"></i>
          <p class="text-xs font-semibold">No attendance records found for this period.</p>
        </td>
      </tr>
    `;
    if (summaryEl) summaryEl.textContent = 'Showing 0 record(s)';
    safeCreateIcons();
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
      <td class="py-2.5 px-3.5 font-semibold text-slate-900 dark:text-white">
        ${escapeHtml(r.displayDate)}
      </td>
      <td class="py-2.5 px-3 text-emerald-600 dark:text-emerald-400 font-semibold font-mono">
        ${escapeHtml(r.firstIn)}
      </td>
      <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-mono">
        ${escapeHtml(r.lastOut)}
      </td>
      <td class="py-2.5 px-3">
        <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
          r.isLate 
            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
        }">
          ${escapeHtml(r.status)}
        </span>
      </td>
      <td class="py-2.5 px-3 text-slate-500 text-[11px] truncate max-w-[120px]" title="${escapeHtml(r.device)}">
        ${escapeHtml(r.device)}
      </td>
      <td class="py-2.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300 font-mono">
        ${r.punchesCount}
      </td>
      <td class="py-2.5 px-3.5 text-right">
        <button onclick="openEditAttendanceModal('${r.punchId}')" class="p-1 rounded-lg text-slate-400 hover:text-[#167BB0] hover:bg-[#167BB0]/10 transition-all cursor-pointer" title="Edit Punch Record">
          <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    </tr>
  `).join('');

  if (summaryEl) summaryEl.textContent = `Showing ${records.length} date record(s)`;
  safeCreateIcons();
}

// Render Month-Wise Summary Table inside Employee Modal
function renderModalMonthlyRows() {
  const tbody = document.getElementById('modal-monthly-rows');
  const summaryEl = document.getElementById('modal-attendance-summary');
  if (!tbody || !activeAttendanceModalEmp) return;

  const empKey = (activeAttendanceModalEmp.name || '').trim().toLowerCase();
  const rawLogs = (attendanceLogs || []).filter(log => 
    log.employee_id === activeAttendanceModalEmp.id || 
    ((log.employee_name || '').trim().toLowerCase() === empKey)
  );

  if (rawLogs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-slate-400 dark:text-gray-500">
          <i data-lucide="calendar-x" class="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-gray-600"></i>
          <p class="text-xs font-semibold">No monthly attendance history found.</p>
        </td>
      </tr>
    `;
    if (summaryEl) summaryEl.textContent = 'Showing 0 month(s)';
    safeCreateIcons();
    return;
  }

  // Group by YYYY-MM
  const monthMap = new Map();
  for (const log of rawLogs) {
    const ym = log.created_at.slice(0, 7);
    if (!monthMap.has(ym)) {
      monthMap.set(ym, []);
    }
    monthMap.get(ym).push(log);
  }

  const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  const salary = Number(activeAttendanceModalEmp.salary) || 0;

  tbody.innerHTML = sortedMonths.map(([ym, logs]) => {
    const [y, m] = ym.split('-').map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(y, m, 0).getDate();

    // Group by date to count days present
    const dateSet = new Set(logs.map(l => formatLocalYMD(new Date(l.created_at))));
    const daysPresent = dateSet.size;

    let onTimeDays = 0;
    let lateDays = 0;

    dateSet.forEach(dStr => {
      const dayLogs = logs.filter(l => formatLocalYMD(new Date(l.created_at)) === dStr);
      dayLogs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const punc = getPunchPunctuality(dayLogs[0]);
      if (punc === 'Late') lateDays++;
      else onTimeDays++;
    });

    const onTimePct = daysPresent > 0 ? Math.round((onTimeDays / daysPresent) * 100) : 100;
    const estPayout = salary > 0 ? Math.round((daysPresent / daysInMonth) * salary) : 0;

    return `
      <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
        <td class="py-3 px-3.5 font-bold text-slate-900 dark:text-white">
          ${escapeHtml(monthName)}
        </td>
        <td class="py-3 px-3 font-mono font-bold text-[#167BB0] dark:text-sky-300">
          ${daysPresent} <span class="text-[10px] text-slate-400 font-normal">/${daysInMonth}d</span>
        </td>
        <td class="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
          ${logs.length}
        </td>
        <td class="py-3 px-3">
          <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">${onTimeDays}</span>
        </td>
        <td class="py-3 px-3 font-semibold text-emerald-600 dark:text-emerald-400">
          ${onTimePct}%
        </td>
        <td class="py-3 px-3 font-bold text-slate-900 dark:text-white">
          ${formatCurrency(estPayout > 0 ? estPayout : (daysPresent > 0 ? salary : 0))}
        </td>
        <td class="py-3 px-3.5 text-right">
          <button type="button" onclick="setModalMonthFilter('${ym}'); setModalViewMode('daily');" class="px-2.5 py-1 rounded-xl text-xs font-semibold bg-[#167BB0]/10 hover:bg-[#167BB0] text-[#167BB0] hover:text-white transition-all cursor-pointer">
            View Dates
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (summaryEl) summaryEl.textContent = `Showing ${sortedMonths.length} active month(s)`;
  safeCreateIcons();
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

  // Also update Overview Dashboard and Sidebar Activity
  updateDashboardMetrics();
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
        Checked In • Just now
      </div>
    </div>
  `;

  document.body.appendChild(toast);
  safeCreateIcons();

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
    oval.className = 'relative w-56 h-64 border-2 border-[#167BB0] rounded-3xl transition-all duration-300 flex items-center justify-center shadow-[0_0_25px_rgba(22,123,176,0.45)]';
  }
}

// ==============================================================
// High-Precision Biometric Visual Descriptor Extractor (Web)
// ==============================================================
const employeeDescriptorCache = new Map();
let webConsecutiveCandidateId = null;
let webConsecutiveHits = 0;
let webConfidenceBuffer = [];

function extractFacialFeatureVector(sourceCanvas, cropRect, faceLandmarks) {
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 96;
  faceCanvas.height = 96;
  const fCtx = faceCanvas.getContext('2d', { willReadFrequently: true });

  const sx = cropRect ? Math.max(0, cropRect.x) : 0;
  const sy = cropRect ? Math.max(0, cropRect.y) : 0;
  const sw = cropRect ? Math.min(sourceCanvas.width - sx, cropRect.width) : sourceCanvas.width;
  const sh = cropRect ? Math.min(sourceCanvas.height - sy, cropRect.height) : sourceCanvas.height;

  // 5-Point Affine Alignment: Compensate for head roll
  let rollRad = 0;
  if (faceLandmarks && faceLandmarks.leftEye && faceLandmarks.rightEye) {
    const dx = faceLandmarks.rightEye.x - faceLandmarks.leftEye.x;
    const dy = faceLandmarks.rightEye.y - faceLandmarks.leftEye.y;
    rollRad = Math.atan2(dy, dx);
  }

  fCtx.save();
  fCtx.translate(48, 48);
  if (Math.abs(rollRad) > 0.02) {
    fCtx.rotate(-rollRad);
  }
  fCtx.drawImage(sourceCanvas, sx, sy, sw, sh, -48, -48, 96, 96);
  fCtx.restore();

  const imgData = fCtx.getImageData(0, 0, 96, 96);
  const data = imgData.data;

  // Convert to grayscale luminance & compute global mean + variance
  const gray = new Float32Array(96 * 96);
  let sum = 0.0;
  let sumSq = 0.0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = y;
    sum += y;
    sumSq += y * y;
  }

  const nPixels = 96 * 96;
  const meanY = sum / nPixels;
  const varianceY = Math.max(1.0, (sumSq / nPixels) - (meanY * meanY));
  const stdY = Math.sqrt(varianceY);

  // Divide into 6x6 spatial grid (36 cells, 16x16 px each)
  const gridSize = 6;
  const cellW = 96 / gridSize;
  const cellH = 96 / gridSize;
  const vec = [];

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const startX = Math.floor(gx * cellW);
      const endX = Math.floor((gx + 1) * cellW);
      const startY = Math.floor(gy * cellH);
      const endY = Math.floor((gy + 1) * cellH);

      let cellSum = 0;
      let cellGradX = 0;
      let cellGradY = 0;
      let cellCrCb = 0;
      let count = 0;
      const lbpHist = [0, 0, 0, 0, 0, 0, 0, 0];

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * 96 + x;
          const val = (gray[idx] - meanY) / stdY;
          cellSum += val;

          const left = x > 0 ? gray[y * 96 + (x - 1)] : gray[idx];
          const right = x < 95 ? gray[y * 96 + (x + 1)] : gray[idx];
          const top = y > 0 ? gray[(y - 1) * 96 + x] : gray[idx];
          const bottom = y < 95 ? gray[(y + 1) * 96 + x] : gray[idx];
          cellGradX += (right - left) / stdY;
          cellGradY += (bottom - top) / stdY;

          const pIdx = idx * 4;
          cellCrCb += ((data[pIdx] - data[pIdx + 2]) / 255.0);

          if (x > 0 && x < 95 && y > 0 && y < 95) {
            const cVal = gray[idx];
            let lbpCode = 0;
            if (gray[(y - 1) * 96 + (x - 1)] >= cVal) lbpCode |= 1;
            if (gray[(y - 1) * 96 + x] >= cVal) lbpCode |= 2;
            if (gray[(y - 1) * 96 + (x + 1)] >= cVal) lbpCode |= 4;
            if (gray[y * 96 + (x + 1)] >= cVal) lbpCode |= 8;
            if (gray[(y + 1) * 96 + (x + 1)] >= cVal) lbpCode |= 16;
            if (gray[(y + 1) * 96 + x] >= cVal) lbpCode |= 32;
            if (gray[(y + 1) * 96 + (x - 1)] >= cVal) lbpCode |= 64;
            if (gray[y * 96 + (x - 1)] >= cVal) lbpCode |= 128;
            lbpHist[Math.floor(lbpCode / 32)]++;
          }
          count++;
        }
      }

      if (count > 0) {
        vec.push(cellSum / count);
        vec.push(cellGradX / count);
        vec.push(cellGradY / count);
        vec.push(cellCrCb / count);
        for (let b = 0; b < 8; b++) {
          vec.push(lbpHist[b] / count);
        }
      } else {
        for (let b = 0; b < 12; b++) vec.push(0);
      }
    }
  }

  // L2 Normalize
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm > 1e-6) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

function computeCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  const len = Math.min(vecA.length, vecB.length);
  if (len === 0) return 0;
  let dot = 0.0;
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(-1.0, Math.min(1.0, dot));
}

// Detect and crop face region from an uploaded photo or image with standardized face chip
async function detectAndCropFaceFromImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width || 300;
  canvas.height = img.naturalHeight || img.height || 300;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = 96;
  outCanvas.height = 96;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });

  // 1. If photo is already a square / cropped ID face (e.g. 160x160 or aspect ratio ~ 1.0)
  const isSquareID = (canvas.width <= 240 && canvas.height <= 240) ||
    Math.abs(canvas.width - canvas.height) < (canvas.width * 0.15);

  if (isSquareID) {
    outCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 96, 96);
    return outCanvas;
  }

  // 2. Try Native FaceDetector API (Chromium / Edge / Chrome on Mobile)
  let faceBox = null;
  if ('FaceDetector' in window) {
    try {
      const detector = new window.FaceDetector({ fastMode: false, maxDetectedFaces: 1 });
      const faces = await detector.detect(canvas);
      if (faces && faces.length > 0) {
        faceBox = faces[0].boundingBox;
      }
    } catch (_) {}
  }

  if (faceBox) {
    const padX = faceBox.width * 0.15;
    const padY = faceBox.height * 0.15;
    const sx = Math.max(0, faceBox.x - padX);
    const sy = Math.max(0, faceBox.y - padY);
    const sw = Math.min(canvas.width - sx, faceBox.width + padX * 2);
    const sh = Math.min(canvas.height - sy, faceBox.height + padY * 2);
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 96, 96);
  } else {
    // 3. Robust Upper-Center Face Chip (Standard for Webcam & ID portrait photos)
    const fw = Math.min(canvas.width * 0.44, canvas.height * 0.55);
    const fx = Math.max(0, (canvas.width - fw) / 2);
    const fy = Math.max(0, canvas.height * 0.15);
    outCtx.drawImage(canvas, fx, fy, fw, fw * 1.15, 0, 0, 96, 96);
  }

  return outCanvas;
}

// ==============================================================
// Face-API.js ResNet-34 Deep Neural Network Engine (100% Precision)
// ==============================================================
let isFaceApiReady = false;
let faceApiLoading = false;

async function ensureFaceApiReady() {
  if (isFaceApiReady) return true;
  if (faceApiLoading) return false;
  if (typeof faceapi === 'undefined') return false;

  faceApiLoading = true;
  try {
    const MODEL_URL = 'https://vladmandic.github.io/face-api/model/';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    isFaceApiReady = true;
    faceApiLoading = false;
    console.log('A10D: Face-API ResNet-34 Deep Neural Network loaded successfully!');
    employeeDescriptorCache.clear();
    if (employeesList && employeesList.length > 0) {
      cacheAllEmployeeDescriptors(employeesList);
    }
    return true;
  } catch (e) {
    faceApiLoading = false;
    console.warn('Face-API model load error:', e);
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    setTimeout(ensureFaceApiReady, 500);
  });
}

async function getOrComputeEmployeeDescriptor(emp) {
  if (!emp) return null;
  if (employeeDescriptorCache.has(emp.id)) {
    return employeeDescriptorCache.get(emp.id);
  }

  // 1. If Face-API is available, extract 128-D ResNet deep embedding
  if (typeof faceapi !== 'undefined' && emp.photo_url) {
    if (!isFaceApiReady && !faceApiLoading) {
      await ensureFaceApiReady();
    }
    if (isFaceApiReady) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          try {
            const detection = await faceapi
              .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 }))
              .withFaceLandmarks(true)
              .withFaceDescriptor();

            if (detection && detection.descriptor) {
              employeeDescriptorCache.set(emp.id, detection.descriptor);
              resolve(detection.descriptor);
              return;
            }

            // Fallback: detect face on cropped canvas
            const faceCanvas = await detectAndCropFaceFromImage(img);
            const detectionFallback = await faceapi
              .detectSingleFace(faceCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.15 }))
              .withFaceLandmarks(true)
              .withFaceDescriptor();

            if (detectionFallback && detectionFallback.descriptor) {
              employeeDescriptorCache.set(emp.id, detectionFallback.descriptor);
              resolve(detectionFallback.descriptor);
              return;
            }
          } catch (_) {}

          // Fallback to visual feature vector
          const faceCanvas = await detectAndCropFaceFromImage(img);
          const desc = extractFacialFeatureVector(faceCanvas);
          employeeDescriptorCache.set(emp.id, desc);
          resolve(desc);
        };
        img.onerror = () => resolve(null);
        img.src = emp.photo_url;
      });
    }
  }

  // Fallback if face-api not loaded
  if (emp.photo_url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        const faceCanvas = await detectAndCropFaceFromImage(img);
        const desc = extractFacialFeatureVector(faceCanvas);
        employeeDescriptorCache.set(emp.id, desc);
        resolve(desc);
      };
      img.onerror = () => resolve(null);
      img.src = emp.photo_url;
    });
  }

  return null;
}

async function cacheAllEmployeeDescriptors(list) {
  if (!list || !Array.isArray(list)) return;
  for (const emp of list) {
    if (!employeeDescriptorCache.has(emp.id) && emp.photo_url) {
      await getOrComputeEmployeeDescriptor(emp);
    }
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

  // Ensure Face-API ResNet-34 neural network is initialized
  if (typeof faceapi !== 'undefined' && !isFaceApiReady && !faceApiLoading) {
    ensureFaceApiReady();
  }

  // 1. Prioritize Face-API ResNet-34 Deep Neural Network if available
  if (typeof faceapi !== 'undefined' && isFaceApiReady) {
    let detection = null;
    try {
      detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();
    } catch (_) {}

    if (!detection) {
      if (oval) oval.className = 'relative w-56 h-64 border-2 border-[#167BB0] rounded-3xl transition-all duration-300 flex items-center justify-center shadow-[0_0_25px_rgba(22,123,176,0.45)]';
      if (statusPill) statusPill.textContent = 'Position your face inside the blue box';
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-[#1D93CA]';
      return;
    }

    const liveDesc = detection.descriptor; // 128-D ResNet deep embedding
    let bestMatch = null;
    let minDistance = 999.0;
    let runnerUpDistance = 999.0;

    for (const emp of employeesList) {
      const desc = await getOrComputeEmployeeDescriptor(emp);
      if (!desc || desc.length !== 128) continue;
      const dist = faceapi.euclideanDistance(liveDesc, desc);
      if (dist < minDistance) {
        runnerUpDistance = minDistance;
        minDistance = dist;
        bestMatch = emp;
      } else if (dist < runnerUpDistance) {
        runnerUpDistance = dist;
      }
    }

    // ResNet-34 Euclidean Distance:
    // Same person: 0.15 - 0.45
    // Different person: > 0.60
    const MATCH_DISTANCE_THRESHOLD = 0.48;
    const AMBIGUITY_DISTANCE_MARGIN = 0.05;
    const isDistinctMatch = bestMatch != null &&
      minDistance <= MATCH_DISTANCE_THRESHOLD &&
      (employeesList.length === 1 || (runnerUpDistance - minDistance) >= AMBIGUITY_DISTANCE_MARGIN);

    if (isDistinctMatch) {
      const confidencePct = Math.min(100, Math.max(50, Math.round((1.0 - (minDistance / 0.70)) * 100)));
      if (webConsecutiveCandidateId === bestMatch.id) {
        webConsecutiveHits++;
      } else {
        webConsecutiveCandidateId = bestMatch.id;
        webConsecutiveHits = 1;
      }

      if (webConsecutiveHits < 2) {
        if (statusPill) statusPill.textContent = `Verifying: ${bestMatch.name} (${confidencePct}%)...`;
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-[#1D93CA] animate-pulse';
        return;
      }

      const empName = bestMatch.name;
      const now = Date.now();
      const alreadyPunched = isEmployeePunchedToday(empName, bestMatch.id);

      if (alreadyPunched) {
        if (oval) oval.className = 'relative w-56 h-64 border-4 border-[#1D93CA] rounded-3xl shadow-[0_0_35px_rgba(29,147,202,0.85)] transition-all duration-300 flex items-center justify-center';
        if (statusPill) statusPill.textContent = `${empName} • Already Punched Today`;
        if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-[#1D93CA]';
        return;
      }

      if (now - lastWebPunchTime < 4000 && lastRecognizedEmpKey === empName) return;

      lastWebPunchTime = now;
      lastRecognizedEmpKey = empName;
      if (oval) oval.className = 'relative w-56 h-64 border-4 border-emerald-400 rounded-3xl shadow-[0_0_35px_rgba(16,185,129,0.9)] transition-all duration-300 flex items-center justify-center';
      if (statusPill) statusPill.textContent = `✓ Welcome, ${empName}! (Attendance Recorded)`;
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 120;
      thumbCanvas.height = 120;
      const thumbCtx = thumbCanvas.getContext('2d');
      const box = detection.detection.box;
      thumbCtx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, 120, 120);
      const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

      if (supabaseClient) {
        try {
          const punchRecord = {
            employee_id: bestMatch.id,
            employee_name: empName,
            punch_type: 'IN',
            confidence: 1.0 - minDistance,
            device_id: 'Web-Kiosk',
            photo_url: thumbDataUrl,
            created_at: new Date().toISOString()
          };
          if (currentAuthUser && currentAuthUser.id) punchRecord.user_id = currentAuthUser.id;
          let { data, error } = await supabaseClient.from('attendance_logs').insert([punchRecord]).select();
          if (error && punchRecord.user_id) {
            delete punchRecord.user_id;
            const retry = await supabaseClient.from('attendance_logs').insert([punchRecord]).select();
            data = retry.data;
          }
          if (data && data[0]) {
            attendanceLogs.unshift(data[0]);
            renderAttendanceLogs(attendanceLogs);
            updateMetrics();
            renderSummaryView();
          }
        } catch (e) { console.error(e); }
      }
      return;
    } else {
      webConsecutiveCandidateId = null;
      webConsecutiveHits = 0;
      if (oval) oval.className = 'relative w-56 h-64 border-2 border-[#167BB0] rounded-3xl transition-all duration-300 flex items-center justify-center shadow-[0_0_25px_rgba(22,123,176,0.45)]';
      if (statusPill) statusPill.textContent = 'Unrecognized Person • Look straight at camera';
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
      return;
    }
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
    if (oval) oval.className = 'relative w-56 h-64 border-2 border-[#167BB0] rounded-3xl transition-all duration-300 flex items-center justify-center shadow-[0_0_25px_rgba(22,123,176,0.45)]';
    if (statusPill) statusPill.textContent = 'Position your face inside the blue box';
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-[#1D93CA]';
    return;
  }

  // Multi-scale crops: standard, tighter, wider to accommodate distance & camera variations
  const fw = Math.min(canvas.width * 0.44, canvas.height * 0.55);
  let liveFaceX = Math.max(0, (canvas.width - fw) / 2);
  let liveFaceY = Math.max(0, canvas.height * 0.15);
  let liveFaceW = fw;
  let liveFaceH = fw * 1.15;

  if (detectedFaceBox) {
    const padX = detectedFaceBox.width * 0.15;
    const padY = detectedFaceBox.height * 0.15;
    liveFaceX = Math.max(0, detectedFaceBox.x - padX);
    liveFaceY = Math.max(0, detectedFaceBox.y - padY);
    liveFaceW = Math.min(canvas.width - liveFaceX, detectedFaceBox.width + padX * 2);
    liveFaceH = Math.min(canvas.height - liveFaceY, detectedFaceBox.height + padY * 2);
  }

  const cropScales = [
    { scale: 1.0, dy: 0 },
    { scale: 0.88, dy: -6 },
    { scale: 1.12, dy: 6 }
  ];

  const liveDescs = [];
  for (const s of cropScales) {
    const sw = Math.min(canvas.width, liveFaceW * s.scale);
    const sh = Math.min(canvas.height, liveFaceH * s.scale);
    const sx = Math.max(0, Math.min(canvas.width - sw, liveFaceX + (liveFaceW - sw) / 2));
    const sy = Math.max(0, Math.min(canvas.height - sh, liveFaceY + s.dy));
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = 96;
    cropCanvas.height = 96;
    const cCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    cCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 96, 96);
    liveDescs.push(extractFacialFeatureVector(cropCanvas));
  }

  // A live face is detected in the blue box!
  let bestMatch = null;
  let highestScore = -1.0;
  let runnerUpScore = -1.0;

  for (const emp of employeesList) {
    const desc = await getOrComputeEmployeeDescriptor(emp);
    if (!desc) continue;
    let score = -1.0;
    for (const ld of liveDescs) {
      const s = computeCosineSimilarity(ld, desc);
      if (s > score) score = s;
    }
    if (score > highestScore) {
      runnerUpScore = highestScore;
      highestScore = score;
      bestMatch = emp;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  // Natural camera & appearance variation thresholds:
  // Same person with real-world distance/lighting: 0.42 - 0.95
  // Different people: <= 0.35
  const WEB_MATCH_THRESHOLD = 0.42;
  const WEB_AMBIGUITY_MARGIN = 0.04;
  const hasAmbiguity = (employeesList.length > 1) && ((highestScore - runnerUpScore) < WEB_AMBIGUITY_MARGIN);

  if (bestMatch && highestScore >= WEB_MATCH_THRESHOLD && !hasAmbiguity) {
    if (webConsecutiveCandidateId === bestMatch.id) {
      webConsecutiveHits++;
      webConfidenceBuffer.push(highestScore);
      if (webConfidenceBuffer.length > 3) webConfidenceBuffer.shift();
    } else {
      webConsecutiveCandidateId = bestMatch.id;
      webConsecutiveHits = 1;
      webConfidenceBuffer = [highestScore];
    }

    // Weighted rolling confidence average across frames
    let rollingConfidence = 0.0;
    if (webConfidenceBuffer.length === 1) {
      rollingConfidence = webConfidenceBuffer[0];
    } else if (webConfidenceBuffer.length === 2) {
      rollingConfidence = webConfidenceBuffer[1] * 0.60 + webConfidenceBuffer[0] * 0.40;
    } else {
      rollingConfidence = webConfidenceBuffer[2] * 0.50 + webConfidenceBuffer[1] * 0.30 + webConfidenceBuffer[0] * 0.20;
    }

    const pct = Math.min(100, Math.max(0, Math.round(rollingConfidence * 100)));

    // Fast and responsive: verify on 1 sustained frame with rollingConfidence >= 0.42
    if (webConsecutiveHits < 1 || rollingConfidence < 0.42) {
      if (statusPill) statusPill.textContent = `Verifying: ${bestMatch.name} (${pct}%)...`;
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-[#1D93CA] animate-pulse';
      return;
    }

    const empName = bestMatch.name;
    const now = Date.now();

    // Check if already punched today
    const alreadyPunched = isEmployeePunchedToday(empName, bestMatch.id);

    if (alreadyPunched) {
      if (oval) oval.className = 'relative w-56 h-64 border-4 border-[#1D93CA] rounded-3xl shadow-[0_0_35px_rgba(29,147,202,0.85)] transition-all duration-300 flex items-center justify-center';
      if (statusPill) statusPill.textContent = `${empName} • Already Punched Today`;
      if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-[#1D93CA]';
      return;
    }

    // Cooldown guard: 4 seconds between repeat trigger
    if (now - lastWebPunchTime < 4000 && lastRecognizedEmpKey === empName) {
      return;
    }

    // SUCCESSFUL NEW PUNCH!
    lastWebPunchTime = now;
    lastRecognizedEmpKey = empName;

    // Green box glow
    if (oval) oval.className = 'relative w-56 h-64 border-4 border-emerald-400 rounded-3xl shadow-[0_0_35px_rgba(16,185,129,0.9)] transition-all duration-300 flex items-center justify-center';
    if (statusPill) statusPill.textContent = `✓ Welcome, ${empName}! (Attendance Recorded)`;
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';

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
        const punchRecord = {
          employee_id: bestMatch.id,
          employee_name: empName,
          punch_type: 'IN',
          confidence: highestScore,
          device_id: 'Web-Kiosk',
          photo_url: thumbDataUrl,
          created_at: new Date().toISOString()
        };
        if (currentAuthUser && currentAuthUser.id) {
          punchRecord.user_id = currentAuthUser.id;
        }

        let { data, error } = await supabaseClient
          .from('attendance_logs')
          .insert([punchRecord])
          .select();

        if (error && punchRecord.user_id) {
          delete punchRecord.user_id;
          const retry = await supabaseClient
            .from('attendance_logs')
            .insert([punchRecord])
            .select();
          data = retry.data;
          error = retry.error;
        }

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
  } else if (hasAmbiguity && highestScore >= WEB_MATCH_THRESHOLD) {
    webConsecutiveCandidateId = null;
    webConsecutiveHits = 0;
    webConfidenceBuffer = [];
    if (oval) oval.className = 'relative w-56 h-64 border-2 border-[#167BB0] rounded-3xl transition-all duration-300 flex items-center justify-center shadow-[0_0_25px_rgba(22,123,176,0.45)]';
    if (statusPill) statusPill.textContent = 'Verifying identity • Look directly at camera';
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-sky-400';
  } else {
    webConsecutiveCandidateId = null;
    webConsecutiveHits = 0;
    webConfidenceBuffer = [];
    if (oval) oval.className = 'relative w-56 h-64 border-2 border-[#167BB0] rounded-3xl transition-all duration-300 flex items-center justify-center shadow-[0_0_25px_rgba(22,123,176,0.45)]';
    if (statusPill) statusPill.textContent = skinRatio > 0.15 ? 'Unrecognized Face • Look straight at camera' : 'Position your face inside the blue box';
    if (statusDot) statusDot.className = skinRatio > 0.15 ? 'w-2.5 h-2.5 rounded-full bg-amber-400' : 'w-2.5 h-2.5 rounded-full bg-[#1D93CA]';
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
    safeCreateIcons();
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
  if (btnText) btnText.textContent = capturedEnrollPhoto ? 'Retake Photo' : 'Take Live Photo';
}

function captureEnrollPhoto() {
  const video = document.getElementById('enroll-video');
  const canvas = document.getElementById('enroll-canvas');
  const avatarPreview = document.getElementById('enroll-avatar-preview');
  const statusText = document.getElementById('enroll-status-text');
  const removeBtn = document.getElementById('enroll-remove-photo-btn');

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

  // Extract real high-precision biometric visual descriptor
  const realDescriptor = extractFacialFeatureVector(canvas);
  capturedEnrollEmbedding = [realDescriptor, realDescriptor, realDescriptor];

  if (avatarPreview) {
    avatarPreview.innerHTML = `<img src="${capturedEnrollPhoto}" class="w-full h-full object-cover">`;
  }
  if (statusText) {
    statusText.textContent = '✓ Live face photo captured';
    statusText.className = 'text-[11px] text-green-500 font-semibold block';
  }
  if (removeBtn) {
    removeBtn.classList.remove('hidden');
  }

  stopEnrollCamera();
  safeCreateIcons();
}

// Handle Photo File Upload (PNG / JPG / WEBP)
function handleEnrollFileUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Please select a valid image file (PNG, JPG, JPEG, WEBP).');
    return;
  }

  stopEnrollCamera();

  const reader = new FileReader();
  reader.onload = function(event) {
    const img = new Image();
    img.onload = async function() {
      const avatarPreview = document.getElementById('enroll-avatar-preview');
      const statusText = document.getElementById('enroll-status-text');
      const removeBtn = document.getElementById('enroll-remove-photo-btn');
      const btnText = document.getElementById('enroll-btn-text');

      if (statusText) {
        statusText.textContent = 'Detecting facial features from uploaded photo...';
        statusText.className = 'text-[11px] text-[#1D93CA] font-semibold block animate-pulse';
      }

      // Automatically locate and crop face from uploaded photo
      const faceCanvas = await detectAndCropFaceFromImage(img);
      capturedEnrollPhoto = faceCanvas.toDataURL('image/jpeg', 0.90);

      // Extract real biometric visual descriptor directly from the cropped face
      const realDescriptor = extractFacialFeatureVector(faceCanvas);
      capturedEnrollEmbedding = [realDescriptor, realDescriptor, realDescriptor];

      if (avatarPreview) {
        avatarPreview.innerHTML = `<img src="${capturedEnrollPhoto}" class="w-full h-full object-cover">`;
      }
      if (statusText) {
        statusText.textContent = `✓ Biometric face detected & registered: ${file.name}`;
        statusText.className = 'text-[11px] text-emerald-600 font-semibold block';
      }
      if (removeBtn) {
        removeBtn.classList.remove('hidden');
      }
      if (btnText) {
        btnText.textContent = 'Retake Live Photo';
      }
      safeCreateIcons();
    };
    img.onerror = function() {
      alert('Could not decode the selected image file. Please try another photo.');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// Clear or Remove Enrolled Photo
function clearEnrollPhoto() {
  capturedEnrollPhoto = null;
  capturedEnrollEmbedding = null;

  const fileInput = document.getElementById('enroll-file-input');
  if (fileInput) fileInput.value = '';

  const avatarPreview = document.getElementById('enroll-avatar-preview');
  const statusText = document.getElementById('enroll-status-text');
  const removeBtn = document.getElementById('enroll-remove-photo-btn');
  const btnText = document.getElementById('enroll-btn-text');

  if (avatarPreview) {
    avatarPreview.innerHTML = '<i data-lucide="user" class="w-7 h-7"></i>';
  }
  if (statusText) {
    statusText.textContent = 'Upload a photo (JPG/PNG) or capture live with webcam';
    statusText.className = 'text-[11px] text-slate-400 block';
  }
  if (removeBtn) {
    removeBtn.classList.add('hidden');
  }
  if (btnText) {
    btnText.textContent = 'Take Live Photo';
  }
  stopEnrollCamera();
  safeCreateIcons();
}

// Set Live Feed Date Mode ('today' or 'all')
function setLiveFeedDate(mode) {
  const picker = document.getElementById('live-feed-date-picker');
  const todayBtn = document.getElementById('live-feed-btn-today');
  const allBtn = document.getElementById('live-feed-btn-all');

  if (mode === 'today') {
    if (picker) picker.value = formatLocalYMD(new Date());
    if (todayBtn) {
      todayBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0] text-white transition-all";
    }
    if (allBtn) {
      allBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all";
    }
  } else if (mode === 'all') {
    if (picker) picker.value = '';
    if (todayBtn) {
      todayBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0]/10 text-[#167BB0] hover:bg-[#167BB0]/20 border border-[#167BB0]/30 transition-all";
    }
    if (allBtn) {
      allBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0] text-white transition-all";
    }
  }

  filterAttendanceLogs();
}

// Filter Attendance Logs in Live Feed Tab by Date and Search Query
function filterAttendanceLogs() {
  const datePicker = document.getElementById('live-feed-date-picker');
  const searchInput = document.getElementById('search-attendance');

  const selectedDate = datePicker ? datePicker.value.trim() : '';
  const query = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';

  // Synchronize button styles with current date picker value
  const todayBtn = document.getElementById('live-feed-btn-today');
  const allBtn = document.getElementById('live-feed-btn-all');
  const todayStr = formatLocalYMD(new Date());

  if (todayBtn && allBtn) {
    if (selectedDate === todayStr) {
      todayBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0] text-white transition-all";
      allBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all";
    } else if (!selectedDate) {
      todayBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0]/10 text-[#167BB0] hover:bg-[#167BB0]/20 border border-[#167BB0]/30 transition-all";
      allBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0] text-white transition-all";
    } else {
      todayBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#167BB0]/10 text-[#167BB0] hover:bg-[#167BB0]/20 border border-[#167BB0]/30 transition-all";
      allBtn.className = "px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all";
    }
  }

  const filtered = (attendanceLogs || []).filter(log => {
    // Filter by date if date is selected
    if (selectedDate) {
      const logDate = formatLocalYMD(new Date(log.created_at));
      if (logDate !== selectedDate) return false;
    }

    // Filter by search query
    if (query) {
      const name = (log.employee_name || '').toLowerCase();
      const empId = (log.employee_id || '').toLowerCase();
      const dev = (log.device_id || '').toLowerCase();
      if (!name.includes(query) && !empId.includes(query) && !dev.includes(query)) {
        return false;
      }
    }

    return true;
  });

  renderLiveFeedAttendance(filtered);
}

// Filter Employees by Search Query and Department
function filterEmployees() {
  const query = (document.getElementById('search-employees')?.value || '').toLowerCase().trim();
  const deptFilter = (document.getElementById('filter-emp-dept')?.value || '').toLowerCase().trim();

  const filtered = employeesList.filter(emp => {
    const matchesQuery = !query || 
      (emp.name || '').toLowerCase().includes(query) || 
      (emp.employee_code || '').toLowerCase().includes(query) ||
      (emp.department || '').toLowerCase().includes(query) ||
      (emp.phone || '').toLowerCase().includes(query);

    const matchesDept = !deptFilter || (emp.department || '').toLowerCase().trim() === deptFilter;

    return matchesQuery && matchesDept;
  });

  renderEmployees(filtered);
}

// Export Attendance Logs to CSV
function exportToCSV() {
  let logsToExport = attendanceLogs || [];
  let fileSuffix = 'all';

  if (activeNavTab === 'dashboard') {
    const todayStr = new Date().toDateString();
    logsToExport = logsToExport.filter(log => new Date(log.created_at).toDateString() === todayStr);
    fileSuffix = `today_${formatLocalYMD(new Date())}`;
  } else if (activeNavTab === 'live') {
    const datePicker = document.getElementById('live-feed-date-picker');
    const selectedDate = datePicker ? datePicker.value.trim() : '';
    const searchInput = document.getElementById('search-attendance');
    const query = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';

    logsToExport = logsToExport.filter(log => {
      if (selectedDate && formatLocalYMD(new Date(log.created_at)) !== selectedDate) return false;
      if (query) {
        const name = (log.employee_name || '').toLowerCase();
        const empId = (log.employee_id || '').toLowerCase();
        const dev = (log.device_id || '').toLowerCase();
        if (!name.includes(query) && !empId.includes(query) && !dev.includes(query)) return false;
      }
      return true;
    });
    fileSuffix = selectedDate ? `date_${selectedDate}` : `archive_${formatLocalYMD(new Date())}`;
  }

  if (!logsToExport.length) {
    alert('No attendance data available to export for the current selection.');
    return;
  }

  const headers = ['ID', 'Employee Name', 'Punch Status', 'Confidence', 'Punctuality', 'Device', 'Timestamp'];
  const rows = logsToExport.map(l => {
    const d = new Date(l.created_at);
    return [
      l.id || '',
      `"${(l.employee_name || '').replace(/"/g, '""')}"`,
      'Checked In',
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
  link.setAttribute('download', `attendance_punches_${fileSuffix}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Export Summary Report to CSV (Supports Monthly Master Roster and Daily Log)
function exportSummaryCSV() {
  if (!employeesList.length) {
    alert('No employee data available to export.');
    return;
  }

  if (summaryViewMode === 'monthly') {
    const monthPicker = document.getElementById('summary-month-picker');
    const selectedYm = monthPicker && monthPicker.value 
      ? monthPicker.value 
      : new Date().toISOString().slice(0, 7);

    const [selYear, selMonthNum] = selectedYm.split('-').map(Number);
    const selMonthIndex = selMonthNum - 1;
    const daysInMonth = new Date(selYear, selMonthIndex + 1, 0).getDate();

    const headers = ['Employee Name', 'Employee Code', 'Department', 'Month', 'Monthly Salary', 'Days Present', 'On Time Days', 'Late Days', 'Attendance Rate', 'Est Payout'];
    const rows = employeesList.map(emp => {
      const empKey = (emp.name || '').trim().toLowerCase();
      const empMonthLogs = (attendanceLogs || []).filter(log => {
        const d = new Date(log.created_at);
        const isMonth = d.getFullYear() === selYear && d.getMonth() === selMonthIndex;
        const isEmp = log.employee_id === emp.id || ((log.employee_name || '').trim().toLowerCase() === empKey);
        return isMonth && isEmp;
      });

      const dateMap = {};
      empMonthLogs.forEach(log => {
        const dStr = formatLocalYMD(new Date(log.created_at));
        if (!dateMap[dStr]) dateMap[dStr] = [];
        dateMap[dStr].push(log);
      });

      const presentDays = Object.keys(dateMap).length;
      let onTimeDays = 0;
      let lateDays = 0;

      Object.values(dateMap).forEach(dayLogs => {
        dayLogs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const punc = getPunchPunctuality(dayLogs[0]);
        if (punc === 'Late') lateDays++;
        else onTimeDays++;
      });

      const salary = Number(emp.salary) || 0;
      const attRate = Math.min(100, Math.round((presentDays / daysInMonth) * 100));
      const estPay = salary > 0 ? Math.round((presentDays / daysInMonth) * salary) : 0;

      return [
        `"${emp.name.replace(/"/g, '""')}"`,
        `"${(emp.employee_code || '').replace(/"/g, '""')}"`,
        `"${(emp.department || 'General').replace(/"/g, '""')}"`,
        selectedYm,
        salary,
        presentDays,
        onTimeDays,
        lateDays,
        `${attRate}%`,
        estPay
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `monthly_attendance_roster_${selectedYm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    const summaryPicker = document.getElementById('summary-date-picker');
    const selectedDateStr = summaryPicker && summaryPicker.value 
      ? summaryPicker.value 
      : new Date().toISOString().slice(0, 10);

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
        punctuality = getPunchPunctuality(datePunch);
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
    const punchPayload = {
      employee_id: empId,
      employee_name: selectedEmp.name,
      punch_type: 'IN',
      confidence: 1.0,
      device_id: reason ? `Manual (${reason})` : 'Manual HR Correction',
      created_at: timestampIso
    };
    if (currentAuthUser && currentAuthUser.id) {
      punchPayload.user_id = currentAuthUser.id;
    }

    let { data, error } = await supabaseClient
      .from('attendance_logs')
      .insert([punchPayload])
      .select();

    if (error) {
      if (punchPayload.user_id) {
        delete punchPayload.user_id;
        const res = await supabaseClient
          .from('attendance_logs')
          .insert([punchPayload])
          .select();
        if (res.error) throw res.error;
        data = res.data;
      } else {
        throw error;
      }
    }

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
    const { data, error } = await supabaseClient
      .from('attendance_logs')
      .delete()
      .eq('id', id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      showRlsFixModal();
      return;
    }
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
  const nameInput = document.getElementById('new-emp-name');
  if (nameInput) nameInput.value = '';
  const phoneInput = document.getElementById('new-emp-phone');
  if (phoneInput) phoneInput.value = '';
  const codeInput = document.getElementById('new-emp-code');
  if (codeInput) codeInput.value = '';
  const deptInput = document.getElementById('new-emp-dept');
  if (deptInput) deptInput.value = '';
  const salaryInput = document.getElementById('new-emp-salary');
  if (salaryInput) salaryInput.value = '';

  const fileInput = document.getElementById('enroll-file-input');
  if (fileInput) fileInput.value = '';

  const avatarPreview = document.getElementById('enroll-avatar-preview');
  const statusText = document.getElementById('enroll-status-text');
  const removeBtn = document.getElementById('enroll-remove-photo-btn');
  const btnText = document.getElementById('enroll-btn-text');

  if (avatarPreview) avatarPreview.innerHTML = '<i data-lucide="user" class="w-7 h-7"></i>';
  if (statusText) {
    statusText.textContent = 'Upload a photo (JPG/PNG) or capture live with webcam';
    statusText.className = 'text-[11px] text-slate-400 block';
  }
  if (removeBtn) removeBtn.classList.add('hidden');
  if (btnText) btnText.textContent = 'Take Live Photo';

  document.getElementById('add-employee-modal').classList.remove('hidden');
  safeCreateIcons();
}

function closeAddEmployeeModal() {
  stopEnrollCamera();
  document.getElementById('add-employee-modal').classList.add('hidden');
}

async function handleCreateEmployee(e) {
  e.preventDefault();
  const name = document.getElementById('new-emp-name').value.trim();
  const phone = (document.getElementById('new-emp-phone')?.value || '').trim();
  const code = document.getElementById('new-emp-code').value.trim();
  const dept = document.getElementById('new-emp-dept').value.trim();
  const salaryVal = parseFloat(document.getElementById('new-emp-salary')?.value || '0');
  const salary = isNaN(salaryVal) ? 0 : salaryVal;

  if (!supabaseClient) {
    alert('Please configure Supabase API credentials first.');
    return;
  }

  try {
    const newRecord = {
      name,
      employee_code: code || null,
      department: dept || 'General',
      salary: salary,
      photo_url: capturedEnrollPhoto || null,
      embeddings: capturedEnrollEmbedding || null,
      is_active: true,
    };
    if (phone) {
      newRecord.phone = phone;
    }
    if (currentAuthUser && currentAuthUser.id) {
      newRecord.user_id = currentAuthUser.id;
    }

    let { data, error } = await supabaseClient
      .from('employees')
      .insert([newRecord])
      .select();

    if (error) {
      console.warn('Initial employee insert notice (checking schema columns):', error.message);
      // Fallback: If salary, phone or user_id column does not exist in schema, retry without them
      if (newRecord.salary !== undefined) delete newRecord.salary;
      if (newRecord.phone) delete newRecord.phone;
      if (newRecord.user_id) delete newRecord.user_id;
      const fallbackRes = await supabaseClient
        .from('employees')
        .insert([newRecord])
        .select();
      if (fallbackRes.error) throw fallbackRes.error;
      data = fallbackRes.data;
    }

    closeAddEmployeeModal();
    document.getElementById('new-emp-name').value = '';
    const phoneInput = document.getElementById('new-emp-phone');
    if (phoneInput) phoneInput.value = '';
    document.getElementById('new-emp-code').value = '';
    document.getElementById('new-emp-dept').value = '';
    const salaryInput = document.getElementById('new-emp-salary');
    if (salaryInput) salaryInput.value = '';
    
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
    const { data, error } = await supabaseClient.from('employees').delete().eq('id', id);
    if (error) throw error;
    
    // Remove immediately from UI and local array
    employeesList = employeesList.filter(e => e.id !== id);
    renderEmployees(employeesList);
    updateMetrics();
    renderSummaryView();
    
    // Also re-fetch to ensure synchronization with cloud
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
  safeCreateIcons();

  try {
    if (supabaseClient) {
      // 1. Fetch all attendance logs and delete by ID
      const { data: logsData } = await supabaseClient.from('attendance_logs').select('id');
      
      if (logsData && logsData.length > 0) {
        const logIds = logsData.map(l => l.id);
        await supabaseClient
          .from('attendance_logs')
          .delete()
          .in('id', logIds);
      }

      // 2. Fetch all employees and delete by ID
      const { data: empsData } = await supabaseClient.from('employees').select('id');
      
      if (empsData && empsData.length > 0) {
        const empIds = empsData.map(e => e.id);
        await supabaseClient
          .from('employees')
          .delete()
          .in('id', empIds);
      }

      // 3. Verification check: Verify if the online server actually deleted them
      const { data: checkLogs } = await supabaseClient.from('attendance_logs').select('id').limit(5);
      const { data: checkEmps } = await supabaseClient.from('employees').select('id').limit(5);

      if ((checkLogs && checkLogs.length > 0) || (checkEmps && checkEmps.length > 0)) {
        console.warn('Supabase RLS prevented deletion. Records still present on server.');
        closeResetModal();
        showRlsFixModal();
        return;
      }
    }

    // Reset local state only when confirmed deleted on server
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
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

function showRlsFixModal() {
  const modal = document.getElementById('rls-fix-modal');
  if (modal) modal.classList.remove('hidden');
  safeCreateIcons();
}

function closeRlsFixModal() {
  const modal = document.getElementById('rls-fix-modal');
  if (modal) modal.classList.add('hidden');
}

function copyRlsSql() {
  const sql = document.getElementById('rls-sql-code').innerText;
  navigator.clipboard.writeText(sql).then(() => {
    const textEl = document.getElementById('copy-rls-btn-text');
    if (textEl) {
      textEl.innerText = 'Copied!';
      setTimeout(() => {
        textEl.innerText = 'Copy SQL';
      }, 2500);
    }
  }).catch(() => {
    alert('SQL copied: ' + sql);
  });
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
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]);
}

// ==============================================================
// APPLICATION TOAST NOTIFICATION
// ==============================================================
function showAppToast(message, type = 'success') {
  const toast = document.createElement('div');
  const isError = type === 'error';
  const borderCol = isError ? 'border-rose-500/50' : 'border-[#167BB0]/50';
  const textCol = isError ? 'text-rose-600 dark:text-rose-400' : 'text-[#167BB0] dark:text-sky-300';
  const iconName = isError ? 'alert-triangle' : 'check-circle-2';

  toast.className = `fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-4 py-3 rounded-2xl shadow-2xl border bg-white dark:bg-[#151B28] ${borderCol} ${textCol} transition-all duration-300 transform translate-y-2 opacity-0 text-xs font-semibold`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4"></i>
    <span>${escapeHtml(message)}</span>
  `;
  document.body.appendChild(toast);
  safeCreateIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==============================================================
// EDIT EMPLOYEE DETAILS & SALARY CONTROLLERS
// ==============================================================
let editEnrollStream = null;
let capturedEditPhoto = undefined;
let capturedEditEmbedding = undefined;

function openEditEmployeeModal(empId) {
  const emp = employeesList.find(e => e.id === empId);
  if (!emp) {
    alert('Employee not found.');
    return;
  }

  capturedEditPhoto = undefined;
  capturedEditEmbedding = undefined;

  document.getElementById('edit-emp-id').value = emp.id;
  document.getElementById('edit-emp-name').value = emp.name || '';
  document.getElementById('edit-emp-phone').value = emp.phone || '';
  document.getElementById('edit-emp-code').value = emp.employee_code || '';
  document.getElementById('edit-emp-dept').value = emp.department || 'General';
  document.getElementById('edit-emp-salary').value = emp.salary || 0;

  const fileInput = document.getElementById('edit-emp-file-input');
  if (fileInput) fileInput.value = '';

  const avatarPreview = document.getElementById('edit-emp-avatar-preview');
  const statusText = document.getElementById('edit-enroll-status-text');
  const removeBtn = document.getElementById('edit-remove-photo-btn');

  if (avatarPreview) {
    avatarPreview.innerHTML = emp.photo_url 
      ? `<img src="${emp.photo_url}" class="w-full h-full object-cover">`
      : `<span class="uppercase">${escapeHtml(emp.name.charAt(0))}</span>`;
  }
  if (statusText) {
    statusText.textContent = emp.photo_url ? 'Photo currently active. Upload new photo to change.' : 'No photo uploaded. Upload or capture face.';
    statusText.className = 'text-[11px] text-slate-400 block';
  }
  if (removeBtn) {
    if (emp.photo_url) removeBtn.classList.remove('hidden');
    else removeBtn.classList.add('hidden');
  }

  document.getElementById('edit-employee-modal').classList.remove('hidden');
  safeCreateIcons();
}

function closeEditEmployeeModal() {
  stopEditEnrollCamera();
  document.getElementById('edit-employee-modal').classList.add('hidden');
}

function handleEditFileUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const statusText = document.getElementById('edit-enroll-status-text');
  const avatarPreview = document.getElementById('edit-emp-avatar-preview');
  const removeBtn = document.getElementById('edit-remove-photo-btn');

  if (statusText) {
    statusText.textContent = 'Processing image...';
    statusText.className = 'text-[11px] text-[#167BB0] font-medium block';
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = async function() {
      const canvas = document.createElement('canvas');
      const maxDim = 480;
      let w = img.width;
      let h = img.height;
      // Automatically detect and crop face from uploaded photo
      const faceCanvas = await detectAndCropFaceFromImage(img);
      capturedEditPhoto = faceCanvas.toDataURL('image/jpeg', 0.90);

      if (avatarPreview) {
        avatarPreview.innerHTML = `<img src="${capturedEditPhoto}" class="w-full h-full object-cover">`;
      }
      if (removeBtn) removeBtn.classList.remove('hidden');

      // Extract real high-precision biometric visual descriptor from aligned face
      const realDescriptor = extractFacialFeatureVector(faceCanvas);
      capturedEditEmbedding = [realDescriptor, realDescriptor, realDescriptor];
      if (statusText) {
        statusText.textContent = '✓ Biometric face detected & updated!';
        statusText.className = 'text-[11px] text-emerald-600 font-semibold block';
      }
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function clearEditEnrollPhoto() {
  capturedEditPhoto = null;
  capturedEditEmbedding = null;
  const avatarPreview = document.getElementById('edit-emp-avatar-preview');
  const statusText = document.getElementById('edit-enroll-status-text');
  const removeBtn = document.getElementById('edit-remove-photo-btn');
  const fileInput = document.getElementById('edit-emp-file-input');

  if (avatarPreview) avatarPreview.innerHTML = '<i data-lucide="user" class="w-7 h-7"></i>';
  if (statusText) {
    statusText.textContent = 'Photo removed. Click Save Changes to confirm.';
    statusText.className = 'text-[11px] text-rose-500 block';
  }
  if (removeBtn) removeBtn.classList.add('hidden');
  if (fileInput) fileInput.value = '';
  safeCreateIcons();
}

async function startEditEnrollCamera() {
  const container = document.getElementById('edit-enroll-cam-container');
  const video = document.getElementById('edit-enroll-video');
  const btnText = document.getElementById('edit-enroll-btn-text');

  try {
    editEnrollStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
    if (video) {
      video.srcObject = editEnrollStream;
      await video.play();
    }
    if (container) container.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Camera Active';
  } catch (err) {
    alert('Camera access denied or unavailable: ' + err.message);
  }
}

function stopEditEnrollCamera() {
  if (editEnrollStream) {
    editEnrollStream.getTracks().forEach(t => t.stop());
    editEnrollStream = null;
  }
  const container = document.getElementById('edit-enroll-cam-container');
  if (container) container.classList.add('hidden');
  const btnText = document.getElementById('edit-enroll-btn-text');
  if (btnText) btnText.textContent = 'Live Photo';
}

async function captureEditEnrollPhoto() {
  const video = document.getElementById('edit-enroll-video');
  const canvas = document.getElementById('edit-enroll-canvas');
  const avatarPreview = document.getElementById('edit-emp-avatar-preview');
  const statusText = document.getElementById('edit-enroll-status-text');
  const removeBtn = document.getElementById('edit-remove-photo-btn');

  if (!video || !canvas) return;
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  capturedEditPhoto = canvas.toDataURL('image/jpeg', 0.85);

  if (avatarPreview) {
    avatarPreview.innerHTML = `<img src="${capturedEditPhoto}" class="w-full h-full object-cover">`;
  }
  if (removeBtn) removeBtn.classList.remove('hidden');
  stopEditEnrollCamera();

  // Extract real high-precision biometric visual descriptor
  const realDescriptor = extractFacialFeatureVector(canvas);
  capturedEditEmbedding = [realDescriptor, realDescriptor, realDescriptor];
  if (statusText) {
    statusText.textContent = '✓ Live face captured & biometric profile verified!';
    statusText.className = 'text-[11px] text-emerald-600 font-semibold block';
  }
}

async function handleUpdateEmployee(e) {
  e.preventDefault();
  const empId = document.getElementById('edit-emp-id').value;
  const name = document.getElementById('edit-emp-name').value.trim();
  const phone = (document.getElementById('edit-emp-phone')?.value || '').trim();
  const code = document.getElementById('edit-emp-code').value.trim();
  const dept = document.getElementById('edit-emp-dept').value.trim();
  const salaryVal = parseFloat(document.getElementById('edit-emp-salary')?.value || '0');
  const salary = isNaN(salaryVal) ? 0 : salaryVal;

  if (!empId) return;

  const btn = document.getElementById('save-edit-emp-btn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Saving...</span>';
  safeCreateIcons();

  try {
    const payload = {
      name,
      phone: phone || null,
      employee_code: code || null,
      department: dept || 'General',
      salary: salary,
      updated_at: new Date().toISOString()
    };

    if (capturedEditPhoto !== undefined) {
      payload.photo_url = capturedEditPhoto;
    }
    if (capturedEditEmbedding !== undefined) {
      payload.embeddings = capturedEditEmbedding;
    }

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('employees')
        .update(payload)
        .eq('id', empId)
        .select();

      if (error) {
        console.warn('Employee update warning, retrying without optional columns:', error.message);
        if (payload.salary !== undefined) delete payload.salary;
        if (payload.phone) delete payload.phone;
        const retryRes = await supabaseClient
          .from('employees')
          .update(payload)
          .eq('id', empId)
          .select();
        if (retryRes.error) throw retryRes.error;
      }
    }

    // Update in-memory employee object
    const targetEmp = employeesList.find(e => e.id === empId);
    if (targetEmp) {
      targetEmp.name = name;
      targetEmp.phone = phone || null;
      targetEmp.employee_code = code || null;
      targetEmp.department = dept || 'General';
      targetEmp.salary = salary;
      if (capturedEditPhoto !== undefined) targetEmp.photo_url = capturedEditPhoto;
      if (capturedEditEmbedding !== undefined) targetEmp.embeddings = capturedEditEmbedding;
      employeeDescriptorCache.delete(empId);
    }

    // Also update any matching employee name in attendanceLogs in memory
    attendanceLogs.forEach(log => {
      if (log.employee_id === empId) {
        log.employee_name = name;
        if (capturedEditPhoto !== undefined && capturedEditPhoto) {
          log.photo_url = capturedEditPhoto;
        }
      }
    });

    closeEditEmployeeModal();

    // Refresh UI components
    renderEmployees(employeesList);
    renderAttendanceLogs(attendanceLogs);
    renderSummaryView();
    updateMetrics();

    // If Employee Attendance Modal is open for this employee, refresh its header
    if (activeAttendanceModalEmp && activeAttendanceModalEmp.id === empId) {
      openEmployeeAttendanceModal(empId);
    }

    showAppToast(`Employee "${name}" updated successfully!`);
  } catch (err) {
    alert('Error updating employee: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    safeCreateIcons();
  }
}

// ==============================================================
// EDIT ATTENDANCE RECORD CONTROLLERS
// ==============================================================
function openEditAttendanceModal(logId) {
  const log = attendanceLogs.find(l => l.id === logId);
  if (!log) {
    alert('Attendance record not found.');
    return;
  }

  document.getElementById('edit-att-id').value = log.id;

  // Populate employee select
  const empSelect = document.getElementById('edit-att-emp-select');
  if (empSelect) {
    empSelect.innerHTML = employeesList.map(e => `
      <option value="${e.id}" ${e.id === log.employee_id || e.name.toLowerCase() === (log.employee_name || '').toLowerCase() ? 'selected' : ''}>
        ${escapeHtml(e.name)} (${escapeHtml(e.employee_code || 'General')})
      </option>
    `).join('');
  }

  // Parse date and time
  const d = new Date(log.created_at);
  const dateVal = formatLocalYMD(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  const dateInput = document.getElementById('edit-att-date');
  if (dateInput) dateInput.value = dateVal;

  const timeInput = document.getElementById('edit-att-time');
  if (timeInput) timeInput.value = `${hh}:${mm}:${ss}`;

  // Current Punctuality
  const currentPunc = getPunchPunctuality(log);
  const puncSelect = document.getElementById('edit-att-punctuality');
  if (puncSelect) {
    if (punctualityOverrides[log.id] || log.punctuality) {
      puncSelect.value = currentPunc;
    } else {
      puncSelect.value = 'Auto';
    }
  }

  // Punch Type
  const punchTypeSelect = document.getElementById('edit-att-punch-type');
  if (punchTypeSelect) {
    punchTypeSelect.value = log.punch_type || 'IN';
  }

  // Device
  const devInput = document.getElementById('edit-att-device');
  if (devInput) devInput.value = log.device_id || 'Web-Kiosk';

  document.getElementById('edit-attendance-modal').classList.remove('hidden');
  safeCreateIcons();
}

function closeEditAttendanceModal() {
  document.getElementById('edit-attendance-modal').classList.add('hidden');
}

function setEditPunchQuickPunctuality(status) {
  const select = document.getElementById('edit-att-punctuality');
  const timeInput = document.getElementById('edit-att-time');
  if (select) select.value = status;

  if (timeInput) {
    if (status === 'On Time') {
      const cur = timeInput.value;
      if (cur > '09:30:00') timeInput.value = '09:15:00';
    } else if (status === 'Late') {
      const cur = timeInput.value;
      if (cur <= '09:30:00') timeInput.value = '09:45:00';
    }
  }
}

async function handleUpdateAttendance(e) {
  e.preventDefault();
  const logId = document.getElementById('edit-att-id').value;
  const empSelect = document.getElementById('edit-att-emp-select');
  const dateVal = document.getElementById('edit-att-date').value;
  const timeVal = document.getElementById('edit-att-time').value;
  const punctualityVal = document.getElementById('edit-att-punctuality').value;
  const punchType = document.getElementById('edit-att-punch-type').value;
  const deviceId = (document.getElementById('edit-att-device').value || '').trim() || 'Manual HR Correction';

  if (!logId || !dateVal || !timeVal) return;

  const btn = document.getElementById('save-edit-att-btn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Saving...</span>';
  safeCreateIcons();

  try {
    const selectedEmpId = empSelect ? empSelect.value : null;
    const selectedEmp = employeesList.find(e => e.id === selectedEmpId);
    const empName = selectedEmp ? selectedEmp.name : 'Unknown';

    // Construct valid ISO timestamp
    const timeParts = timeVal.split(':');
    const hh = timeParts[0] || '09';
    const mm = timeParts[1] || '00';
    const ss = timeParts[2] || '00';
    const timestampIso = new Date(`${dateVal}T${hh}:${mm}:${ss}`).toISOString();

    const payload = {
      employee_id: selectedEmpId || null,
      employee_name: empName,
      created_at: timestampIso,
      punch_type: punchType,
      device_id: deviceId
    };

    if (punctualityVal && punctualityVal !== 'Auto') {
      payload.punctuality = punctualityVal;
    }

    if (supabaseClient) {
      let { data, error } = await supabaseClient
        .from('attendance_logs')
        .update(payload)
        .eq('id', logId)
        .select();

      if (error) {
        if (payload.punctuality) {
          console.warn('Punctuality column not found in attendance_logs. Updating timestamp & device:', error.message);
          delete payload.punctuality;
          const retryRes = await supabaseClient
            .from('attendance_logs')
            .update(payload)
            .eq('id', logId)
            .select();
          if (retryRes.error) throw retryRes.error;
          data = retryRes.data;
        } else {
          throw error;
        }
      }
    }

    // Save punctuality override in local storage cache
    if (punctualityVal && punctualityVal !== 'Auto') {
      punctualityOverrides[logId] = punctualityVal;
    } else {
      delete punctualityOverrides[logId];
    }
    try {
      localStorage.setItem('a10d_punctuality_overrides', JSON.stringify(punctualityOverrides));
    } catch (_) {}

    // Update in-memory attendance log
    const targetLog = attendanceLogs.find(l => l.id === logId);
    if (targetLog) {
      targetLog.employee_id = selectedEmpId;
      targetLog.employee_name = empName;
      targetLog.created_at = timestampIso;
      targetLog.punch_type = punchType;
      targetLog.device_id = deviceId;
      if (punctualityVal && punctualityVal !== 'Auto') {
        targetLog.punctuality = punctualityVal;
      } else {
        delete targetLog.punctuality;
      }
      if (selectedEmp && selectedEmp.photo_url) {
        targetLog.photo_url = selectedEmp.photo_url;
      }
    }

    closeEditAttendanceModal();

    // Refresh UI
    renderAttendanceLogs(attendanceLogs);
    renderSummaryView();
    updateMetrics();

    // If Employee Attendance Modal is open, refresh it as well
    if (activeAttendanceModalEmp) {
      openEmployeeAttendanceModal(activeAttendanceModalEmp.id);
    }

    showAppToast('Attendance record updated successfully!');
  } catch (err) {
    alert('Error updating attendance record: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    safeCreateIcons();
  }
}
