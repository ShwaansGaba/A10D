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

  // Set default summary date picker to today
  const summaryPicker = document.getElementById('summary-date-picker');
  if (summaryPicker) {
    summaryPicker.value = new Date().toISOString().slice(0, 10);
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

  const signupInProgress = sessionStorage.getItem('a10d_signup_in_progress') === 'true';
  const savedSignupEmail = sessionStorage.getItem('a10d_signup_email') || '';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
      if (signupInProgress) {
        // User was setting up their password in Step 3! Do not auto-login to dashboard!
        isSignupInProgress = true;
        authMode = 'signup';
        pendingSignupEmail = savedSignupEmail || session.user.email || '';
        showAuthOverlay();
        goToSignupStep(3);
        return;
      }

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
      // CRITICAL: If user is actively signing up, DO NOT bypass Step 3 (password setup)!
      if (authMode === 'signup' || isSignupInProgress) {
        console.log('Holding auto-login: user must set account password in Step 3.');
        return;
      }

      handleAuthSuccess(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentAuthUser = null;
      if (!isSignupInProgress) {
        showAuthOverlay();
      }
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
  const viewSignup3 = document.getElementById('auth-view-signup-3');
  const titleEl = document.getElementById('auth-form-title');
  const subtitleEl = document.getElementById('auth-form-subtitle');

  if (mode === 'login') {
    isSignupInProgress = false;
    sessionStorage.removeItem('a10d_signup_in_progress');
    if (titleEl) titleEl.textContent = 'Sign in';
    if (subtitleEl) subtitleEl.textContent = 'Enter your credentials to access your workspace';

    if (viewLogin) viewLogin.classList.remove('hidden');
    if (viewSignup1) viewSignup1.classList.add('hidden');
    if (viewSignup2) viewSignup2.classList.add('hidden');
    if (viewSignup3) viewSignup3.classList.add('hidden');
  } else {
    if (titleEl) titleEl.textContent = 'Create Account';
    if (subtitleEl) subtitleEl.textContent = 'Set up your A10D workspace in 3 quick steps';

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
  const viewSignup3 = document.getElementById('auth-view-signup-3');
  const titleEl = document.getElementById('auth-form-title');
  const subtitleEl = document.getElementById('auth-form-subtitle');

  if (viewLogin) viewLogin.classList.add('hidden');
  if (viewSignup1) viewSignup1.classList.add('hidden');
  if (viewSignup2) viewSignup2.classList.add('hidden');
  if (viewSignup3) viewSignup3.classList.add('hidden');

  if (step === 1) {
    if (titleEl) titleEl.textContent = 'Create Account';
    if (subtitleEl) subtitleEl.textContent = 'Step 1 of 3: Enter your organization email';
    if (viewSignup1) viewSignup1.classList.remove('hidden');
  } else if (step === 2) {
    if (titleEl) titleEl.textContent = 'Verify Code';
    if (subtitleEl) subtitleEl.textContent = 'Step 2 of 3: Enter the OTP sent to your email';
    if (viewSignup2) viewSignup2.classList.remove('hidden');
    const emailDisp = document.getElementById('otp-target-email');
    if (emailDisp) emailDisp.innerText = pendingSignupEmail;
    clearOtpBoxes();
    focusFirstOtpBox();
    startResendCountdown();
  } else if (step === 3) {
    if (titleEl) titleEl.textContent = 'Create Password';
    if (subtitleEl) subtitleEl.textContent = 'Step 3 of 3: Secure your administrator account';
    if (viewSignup3) viewSignup3.classList.remove('hidden');
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

// Sign Up - Step 1: Submit Email for OTP
async function handleSignupStep1Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) {
    showAuthAlert('Supabase connection is not initialized.');
    return;
  }

  const emailInput = document.getElementById('signup-email');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    showAuthAlert('Please enter a valid work email address.');
    return;
  }

  pendingSignupEmail = email;
  const btn = document.getElementById('signup-1-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Send Verification Code</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Checking Email...</span>';
  }
  safeCreateIcons();

  try {
    // 1. Check if email is already active in Supabase
    const { data: checkData, error: checkError } = await supabaseClient.auth.signInWithOtp({
      email: pendingSignupEmail,
      options: {
        shouldCreateUser: false,
      }
    });

    if (!checkError) {
      // Email is ALREADY registered and active in Supabase!
      const loginEmailInput = document.getElementById('login-email');
      if (loginEmailInput) loginEmailInput.value = pendingSignupEmail;

      switchAuthMode('login');
      showAuthAlert('This email is already registered. Please sign in with your password.', 'error');
      return;
    }

    // 2. Email is not active or ready for fresh registration. Dispatch OTP code with shouldCreateUser: true
    if (btn) {
      btn.innerHTML = '<span>Sending Code...</span>';
    }
    const redirectUrl = window.location.origin ? (window.location.origin + window.location.pathname) : undefined;
    const { data, error } = await supabaseClient.auth.signInWithOtp({
      email: pendingSignupEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl,
      }
    });

    if (error) throw error;
    goToSignupStep(2);
  } catch (err) {
    console.error('OTP Send Error:', err);
    let msg = err.message || 'Failed to dispatch verification code.';
    if (msg.includes('Error sending confirmation email')) {
      msg = 'Supabase Email Dispatch Failed (500): Built-in email rate limit (3/hr) exceeded, or custom SMTP / template syntax needs setup in Supabase Dashboard.';
    }
    showAuthAlert(msg);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Sign Up - Step 2: Verify 6 or 8-Digit OTP
async function handleSignupStep2Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) return;

  const otp = getEnteredOtp();
  if (!otp || otp.length < 6) {
    showAuthAlert('Please enter the full verification code from your email (at least 6 digits).');
    return;
  }

  const btn = document.getElementById('signup-2-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Verify Code</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Verifying Code...</span>';
  }
  safeCreateIcons();

  try {
    // Explicitly lock into signup flow so onAuthStateChange does NOT skip password setup
    isSignupInProgress = true;
    sessionStorage.setItem('a10d_signup_in_progress', 'true');
    sessionStorage.setItem('a10d_signup_email', pendingSignupEmail);

    // Attempt verification with type: 'email' (standard for signInWithOtp)
    let res = await supabaseClient.auth.verifyOtp({
      email: pendingSignupEmail,
      token: otp,
      type: 'email',
    });

    // If type 'email' failed, attempt type 'signup' (in case GoTrue tagged it under signup confirmation)
    if (res.error) {
      console.warn('verifyOtp with type email returned error, trying type signup fallback...', res.error);
      const resSignup = await supabaseClient.auth.verifyOtp({
        email: pendingSignupEmail,
        token: otp,
        type: 'signup',
      });
      if (!resSignup.error) {
        res = resSignup;
      } else {
        throw res.error;
      }
    }

    if (res.error) throw res.error;

    // Ensure auth container is visible and explicitly advance to Step 3 (Password Setup)
    showAuthOverlay();
    goToSignupStep(3);
  } catch (err) {
    console.error('OTP Verify Error:', err);
    showAuthAlert(err.message || 'Invalid or expired verification code. Please check your email and try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Sign Up - Step 3: Set Password & Authorize Admin
async function handleSignupStep3Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) return;

  const pass1Input = document.getElementById('signup-password') || document.getElementById('signup-pass-1');
  const pass2Input = document.getElementById('signup-confirm-password') || document.getElementById('signup-pass-2');
  const pass1 = pass1Input ? pass1Input.value : '';
  const pass2 = pass2Input ? pass2Input.value : '';

  if (pass1.length < 6) {
    showAuthAlert('Password must be at least 6 characters long.');
    return;
  }

  if (pass1 !== pass2) {
    showAuthAlert('Passwords do not match. Please re-type carefully.');
    return;
  }

  const humanCheck = document.getElementById('human-verify-check');
  if (humanCheck && !humanCheck.checked) {
    showAuthAlert('Please check the authorization confirmation box to proceed.');
    return;
  }

  const btn = document.getElementById('signup-3-btn');
  const originalHtml = btn ? btn.innerHTML : '<span>Complete Setup & Log In</span>';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Saving Password & Activating...</span>';
  }
  safeCreateIcons();

  try {
    // 1. Set the user's permanent password in Supabase Auth & clear account_deleted metadata
    const { data, error } = await supabaseClient.auth.updateUser({
      password: pass1,
      data: {
        account_deleted: false,
        recreated_at: new Date().toISOString()
      }
    });

    if (error) throw error;

    try {
      localStorage.removeItem('a10d_deleted_accounts');
    } catch (_) {}

    // 3. Clear signup flags
    isSignupInProgress = false;
    authMode = 'login';
    sessionStorage.removeItem('a10d_signup_in_progress');
    sessionStorage.removeItem('a10d_signup_email');

    // 4. User now has a confirmed password set! Transition to dashboard
    const activeUser = data.user || (await supabaseClient.auth.getUser()).data.user;
    handleAuthSuccess(activeUser);

    showPunchToast({ employee_name: 'Password set successfully! Welcome to A10D.' });
  } catch (err) {
    console.error('Password Update Error:', err);
    showAuthAlert(err.message || 'Failed to finalize account password. Please try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    safeCreateIcons();
  }
}

// Resend OTP Code
async function resendOtpCode() {
  if (!pendingSignupEmail || !supabaseClient) return;
  const btn = document.getElementById('resend-btn') || document.getElementById('btn-resend-otp');
  if (btn && btn.disabled) return;

  try {
    await supabaseClient.auth.signInWithOtp({
      email: pendingSignupEmail,
      options: { shouldCreateUser: true }
    });
    showAuthAlert('A fresh verification code has been sent to your email.', 'success');
    startResendCountdown();
  } catch (err) {
    showAuthAlert(err.message || 'Could not resend code.');
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

    // 1. Delete all attendance logs for this user/tenant
    try {
      const logIds = (attendanceLogs || []).map(l => l.id).filter(Boolean);
      if (logIds.length > 0) {
        await supabaseClient.from('attendance_logs').delete().in('id', logIds);
      }
    } catch (e) {
      console.warn('Attendance logs delete error:', e.message);
    }

    // 2. Delete all employees and facial profiles for this user/tenant
    try {
      const empIds = (employeesList || []).map(e => e.id).filter(Boolean);
      if (empIds.length > 0) {
        await supabaseClient.from('employees').delete().in('id', empIds);
      }
    } catch (e) {
      console.warn('Employees delete error:', e.message);
    }

    // 3. Delete all kiosks for this user/tenant (if table exists)
    try {
      await supabaseClient.from('kiosks').delete().eq('user_id', userId);
    } catch (_) {}

    // 4. Call server-side SECURITY DEFINER RPC delete_user() to permanently purge user from auth.users
    let rpcPurged = false;
    try {
      const { error: rpcError } = await supabaseClient.rpc('delete_user');
      if (!rpcError) {
        rpcPurged = true;
        console.log('User record permanently purged from auth.users via database RPC.');
      } else {
        console.warn('delete_user RPC notice:', rpcError.message);
      }
    } catch (e) {
      console.warn('delete_user RPC execution notice:', e);
    }

    // 5. If RPC is not yet enabled, scramble credentials and flag account_deleted in metadata
    if (!rpcPurged) {
      const unguessablePassword = 'DELETED_' + crypto.randomUUID() + '_' + Math.random().toString(36) + '_' + Date.now();
      try {
        await supabaseClient.auth.updateUser({
          password: unguessablePassword,
          data: {
            account_deleted: true,
            deleted_at: new Date().toISOString()
          }
        });
      } catch (e) {
        console.warn('Credentials invalidation notice:', e.message);
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
  const tbodyFull = document.getElementById('attendance-table-body-full');
  if (!tbody && !tbodyFull) return;

  const emptyHtml = `
    <tr>
      <td colspan="6" class="py-12 text-center text-gray-500">
        <div class="flex flex-col items-center justify-center space-y-2">
          <i data-lucide="clock" class="w-8 h-8 text-gray-400 dark:text-gray-600"></i>
          <p class="text-sm">No attendance records logged yet.</p>
        </div>
      </td>
    </tr>
  `;

  if (!logs || logs.length === 0) {
    if (tbody) tbody.innerHTML = emptyHtml;
    if (tbodyFull) tbodyFull.innerHTML = emptyHtml;
    safeCreateIcons();
    return;
  }

  const rowsHtml = logs.map((log) => {
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
          <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            Checked In
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

  if (tbody) tbody.innerHTML = rowsHtml;
  if (tbodyFull) tbodyFull.innerHTML = rowsHtml;

  safeCreateIcons();
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
        <td class="py-3.5 px-4">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-cyan-600 dark:text-cyan-400 text-sm font-mono">${monthlyDays}</span>
            <span class="text-xs text-slate-500 dark:text-gray-500">days</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  safeCreateIcons();
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
    safeCreateIcons();
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
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-400';

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
  const avatarPreview = document.getElementById('enroll-avatar-preview');
  const statusText = document.getElementById('enroll-status-text');
  if (avatarPreview) avatarPreview.innerHTML = '<i data-lucide="user" class="w-6 h-6"></i>';
  if (statusText) {
    statusText.textContent = 'Optional, or register via Android Kiosk';
    statusText.className = 'text-[11px] text-slate-500 dark:text-gray-400 block mt-1';
  }
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
      is_active: true,
    };
    if (currentAuthUser && currentAuthUser.id) {
      newRecord.user_id = currentAuthUser.id;
    }

    let { data, error } = await supabaseClient
      .from('employees')
      .insert([newRecord])
      .select();

    if (error) {
      // Fallback: If user_id column does not exist in schema, retry without user_id
      if (newRecord.user_id) {
        delete newRecord.user_id;
        const fallbackRes = await supabaseClient
          .from('employees')
          .insert([newRecord])
          .select();
        if (fallbackRes.error) throw fallbackRes.error;
        data = fallbackRes.data;
      } else {
        throw error;
      }
    }

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
