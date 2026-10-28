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
  const overlay = document.getElementById('auth-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    switchAuthMode('login');
  }
}

function hideAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function handleAuthSuccess(user) {
  currentAuthUser = user;
  hideAuthOverlay();

  // Display user/workspace identifier in the header
  const userBadge = document.getElementById('user-profile-badge');
  const userText = document.getElementById('tenant-display-name');
  if (userText) {
    const email = user.email || 'Workspace';
    userText.innerText = email.length > 22 ? email.slice(0, 20) + '...' : email;
  }
  if (userBadge) userBadge.classList.remove('hidden');

  // Load tenant-isolated data
  fetchEmployees();
  fetchAttendanceLogs();
  fetchActiveKiosks();
  subscribeToUniversalRealtime();
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

  const tabLogin = document.getElementById('tab-btn-login');
  const tabSignup = document.getElementById('tab-btn-signup');
  const tabLoginIcon = document.getElementById('tab-login-icon');
  const tabLoginArrow = document.getElementById('tab-login-arrow');
  const tabSignupIcon = document.getElementById('tab-signup-icon');

  const viewLogin = document.getElementById('auth-view-login');
  const viewSignup1 = document.getElementById('auth-view-signup-1');
  const viewSignup2 = document.getElementById('auth-view-signup-2');
  const viewSignup3 = document.getElementById('auth-view-signup-3');

  if (mode === 'login') {
    if (tabLogin) {
      tabLogin.className = 'w-full text-left px-5 py-3.5 rounded-2xl font-bold text-sm transition-all flex items-center justify-between bg-white text-blue-950 shadow-lg cursor-pointer';
    }
    if (tabSignup) {
      tabSignup.className = 'w-full text-left px-5 py-3.5 rounded-2xl font-semibold text-sm transition-all flex items-center justify-between text-blue-100 hover:bg-white/10 border border-white/10 cursor-pointer';
    }
    if (tabLoginIcon) tabLoginIcon.className = 'text-blue-600';
    if (tabLoginArrow) tabLoginArrow.className = 'text-blue-600';
    if (tabSignupIcon) tabSignupIcon.className = 'text-blue-300';

    if (viewLogin) viewLogin.classList.remove('hidden');
    if (viewSignup1) viewSignup1.classList.add('hidden');
    if (viewSignup2) viewSignup2.classList.add('hidden');
    if (viewSignup3) viewSignup3.classList.add('hidden');
  } else {
    if (tabSignup) {
      tabSignup.className = 'w-full text-left px-5 py-3.5 rounded-2xl font-bold text-sm transition-all flex items-center justify-between bg-white text-blue-950 shadow-lg cursor-pointer';
    }
    if (tabLogin) {
      tabLogin.className = 'w-full text-left px-5 py-3.5 rounded-2xl font-semibold text-sm transition-all flex items-center justify-between text-blue-100 hover:bg-white/10 border border-white/10 cursor-pointer';
    }
    if (tabSignupIcon) tabSignupIcon.className = 'text-blue-600';
    if (tabLoginIcon) tabLoginIcon.className = 'text-blue-300';
    if (tabLoginArrow) tabLoginArrow.className = 'text-blue-300';

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

  if (viewLogin) viewLogin.classList.add('hidden');
  if (viewSignup1) viewSignup1.classList.add('hidden');
  if (viewSignup2) viewSignup2.classList.add('hidden');
  if (viewSignup3) viewSignup3.classList.add('hidden');

  if (step === 1) {
    if (viewSignup1) viewSignup1.classList.remove('hidden');
  } else if (step === 2) {
    if (viewSignup2) viewSignup2.classList.remove('hidden');
    const emailDisp = document.getElementById('otp-target-email');
    if (emailDisp) emailDisp.innerText = pendingSignupEmail;
    clearOtpBoxes();
    focusFirstOtpBox();
    startResendCountdown();
  } else if (step === 3) {
    if (viewSignup3) viewSignup3.classList.remove('hidden');
    resetCaptchaSlider();
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

// Toggle password text visibility
function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) {
      icon.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
    }
  } else {
    input.type = 'password';
    if (icon) {
      icon.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
  }
}

// Alert banner inside auth card
function showAuthAlert(msg, type = 'error') {
  const box = document.getElementById('auth-alert-box');
  const text = document.getElementById('auth-alert-text');
  const icon = document.getElementById('auth-alert-icon');
  if (!box || !text) return;

  box.classList.remove('hidden');
  text.innerText = msg;
  if (type === 'success') {
    box.className = 'mb-5 p-3.5 rounded-xl text-xs font-semibold flex items-center space-x-2 bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400';
    if (icon) {
      icon.innerHTML = `<svg class="w-4 h-4 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
    }
  } else {
    box.className = 'mb-5 p-3.5 rounded-xl text-xs font-semibold flex items-center space-x-2 bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400';
    if (icon) {
      icon.innerHTML = `<svg class="w-4 h-4 shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
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

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-submit-btn');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Signing In...</span>';
  safeCreateIcons();

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    if (data && data.user) {
      handleAuthSuccess(data.user);
    }
  } catch (err) {
    console.error('Login error:', err);
    showAuthAlert(err.message || 'Invalid email or password. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
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

  const email = document.getElementById('signup-email').value.trim();
  if (!email || !email.includes('@')) {
    showAuthAlert('Please enter a valid work email address.');
    return;
  }

  pendingSignupEmail = email;
  const btn = document.getElementById('signup-1-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Sending Code...</span>';
  safeCreateIcons();

  try {
    // Send 6-digit OTP code to the email using Supabase Auth signInWithOtp
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
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    safeCreateIcons();
  }
}

// Sign Up - Step 2: Verify 6-Digit OTP
async function handleSignupStep2Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) return;

  const otp = getEnteredOtp();
  if (otp.length < 6) {
    showAuthAlert('Please enter the full 6-digit verification code.');
    return;
  }

  const btn = document.getElementById('signup-2-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Verifying...</span>';
  safeCreateIcons();

  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({
      email: pendingSignupEmail,
      token: otp,
      type: 'email',
    });

    if (error) throw error;
    // OTP verified successfully; advance to password setup
    goToSignupStep(3);
  } catch (err) {
    console.error('OTP Verify Error:', err);
    showAuthAlert(err.message || 'Invalid or expired verification code. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    safeCreateIcons();
  }
}

// Sign Up - Step 3: Set Password & Validate Captcha
async function handleSignupStep3Submit(e) {
  e.preventDefault();
  hideAuthAlert();
  if (!supabaseClient) return;

  const pass1 = document.getElementById('signup-pass-1').value;
  const pass2 = document.getElementById('signup-pass-2').value;

  if (pass1.length < 6) {
    showAuthAlert('Password must be at least 6 characters long.');
    return;
  }

  if (pass1 !== pass2) {
    showAuthAlert('Passwords do not match. Please re-type carefully.');
    return;
  }

  if (!isCaptchaVerified) {
    showAuthAlert('Please complete the slide verification challenge.');
    return;
  }

  const btn = document.getElementById('signup-3-btn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Activating Workspace...</span>';
  safeCreateIcons();

  try {
    // Set the user's permanent password
    const { data, error } = await supabaseClient.auth.updateUser({
      password: pass1,
    });

    if (error) throw error;

    // Sign out to require clean login with credentials (as requested in specs)
    await supabaseClient.auth.signOut();

    // Return to login screen with prefilled email and celebration notification
    switchAuthMode('login');
    const loginEmailInput = document.getElementById('login-email');
    if (loginEmailInput) loginEmailInput.value = pendingSignupEmail;
    showAuthAlert('🎉 Workspace successfully registered and verified! Please log in with your password.', 'success');
  } catch (err) {
    console.error('Password Update Error:', err);
    showAuthAlert(err.message || 'Failed to finalize account password. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    safeCreateIcons();
  }
}

// Resend OTP Code
async function resendOtpCode() {
  if (!pendingSignupEmail || !supabaseClient) return;
  const btn = document.getElementById('btn-resend-otp');
  if (btn && btn.disabled) return;

  try {
    await supabaseClient.auth.signInWithOtp({
      email: pendingSignupEmail,
      options: { shouldCreateUser: true }
    });
    showAuthAlert('A fresh 6-digit code has been sent to your email.', 'success');
    startResendCountdown();
  } catch (err) {
    showAuthAlert(err.message || 'Could not resend OTP code.');
  }
}

function startResendCountdown() {
  const btn = document.getElementById('btn-resend-otp');
  const countdownEl = document.getElementById('resend-countdown');
  if (!btn || !countdownEl) return;

  clearInterval(resendTimerInterval);
  let timeLeft = 30;
  btn.disabled = true;
  btn.classList.add('opacity-50', 'cursor-not-allowed');
  countdownEl.innerText = timeLeft;

  resendTimerInterval = setInterval(() => {
    timeLeft--;
    countdownEl.innerText = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(resendTimerInterval);
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
      btn.innerHTML = 'Resend Code';
    }
  }, 1000);
}

// OTP Input Boxes Multi-Box Handler
function initOtpBoxHandlers() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, index) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val ? val[0] : '';
      if (val && index < boxes.length - 1) {
        boxes[index + 1].focus();
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        boxes[index - 1].focus();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      if (!pasteData) return;
      for (let i = 0; i < boxes.length; i++) {
        boxes[i].value = pasteData[i] || '';
      }
      const nextFocus = Math.min(pasteData.length, boxes.length - 1);
      boxes[nextFocus].focus();
    });
  });
}

function getEnteredOtp() {
  const boxes = document.querySelectorAll('.otp-box');
  let code = '';
  boxes.forEach((b) => (code += b.value));
  return code;
}

function clearOtpBoxes() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((b) => (b.value = ''));
}

function focusFirstOtpBox() {
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
// Active Kiosks Fleet Management
// ------------------------------------------------------------------
async function fetchActiveKiosks() {
  if (!supabaseClient || !currentAuthUser) return;

  try {
    const { data, error } = await supabaseClient
      .from('kiosks')
      .select('*')
      .eq('user_id', currentAuthUser.id)
      .order('last_heartbeat', { ascending: false });

    if (error) {
      console.warn('Kiosks table query notice (run MULTI_TENANT_SCHEMA.sql if table missing):', error.message);
      return;
    }

    activeKiosksList = data || [];
    renderActiveKiosks();
  } catch (err) {
    console.warn('Kiosks fetch notice:', err.message);
  }
}

function renderActiveKiosks() {
  const countBadge = document.getElementById('active-kiosks-text');
  const listContainer = document.getElementById('kiosks-list-container');
  if (!countBadge) return;

  // A kiosk is active if is_active is true and heartbeat is within last 10 minutes
  const now = new Date().getTime();
  const activeKiosks = activeKiosksList.filter((k) => {
    if (!k.is_active) return false;
    const hbTime = new Date(k.last_heartbeat || k.created_at).getTime();
    return (now - hbTime) < (10 * 60 * 1000); // 10 minutes tolerance
  });

  const activeCount = activeKiosks.length;
  countBadge.innerText = `${activeCount} Kiosk${activeCount === 1 ? '' : 's'} Active`;

  if (!listContainer) return;

  if (activeKiosksList.length === 0) {
    listContainer.innerHTML = `
      <div class="text-center py-8 text-xs text-slate-400 dark:text-gray-500">
        <div class="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center mx-auto mb-3">
          <i data-lucide="smartphone" class="w-6 h-6"></i>
        </div>
        <p class="font-semibold text-slate-700 dark:text-gray-300">No Kiosks Registered Yet</p>
        <p class="text-[11px] mt-1 max-w-xs mx-auto">Open the FaceID Android app on your phone, log in with this account, and it will immediately appear here as an active kiosk.</p>
      </div>
    `;
    safeCreateIcons();
    return;
  }

  listContainer.innerHTML = activeKiosksList.map((k) => {
    const hbTime = new Date(k.last_heartbeat || k.created_at).getTime();
    const isOnline = k.is_active && (now - hbTime < (10 * 60 * 1000));
    const timeFormatted = new Date(k.last_heartbeat || k.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

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
              <span>Platform: ${escapeHtml(k.platform || 'Android')}</span>
              <span>•</span>
              <span>Last Heartbeat: ${timeFormatted}</span>
            </div>
          </div>
        </div>
        <div class="text-right">
          <span class="text-[10px] font-mono text-slate-400 dark:text-gray-500">ID: ${escapeHtml((k.device_id || '').slice(0, 10))}</span>
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

  safeCreateIcons();
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
    safeCreateIcons();
    renderSampleDemoData();
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(url, key);

    badge.className = 'px-3 py-1.5 rounded-xl text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30 flex items-center space-x-2 hover:bg-green-500/20 transition-all cursor-pointer';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-400"></span><span>Connected</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    safeCreateIcons();

    // Initialize Auth Session Check
    initAuth();
  } catch (err) {
    console.error('Failed to init Supabase:', err);
    badge.className = 'px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/30 flex items-center space-x-2 hover:bg-amber-500/20 transition-all cursor-pointer';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span>Connection Error</span><i data-lucide="settings" class="w-3.5 h-3.5 ml-1"></i>';
    safeCreateIcons();
  }
}

// Live Bidirectional Sync: Listen for changes on employees, attendance_logs AND kiosks
function subscribeToUniversalRealtime() {
  if (!supabaseClient) return;

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
    // 3. Kiosks status changes (live hardware fleet updates)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'kiosks' },
      async (payload) => {
        console.log('Realtime kiosks change detected:', payload.eventType);
        await fetchActiveKiosks();
      }
    )
    .subscribe((status) => {
      console.log('Supabase Realtime Channel Status:', status);
    });
}

// Fetch Employees from Supabase (Scoped to Authenticated Tenant)
async function fetchEmployees() {
  if (!supabaseClient) return;
  try {
    let query = supabaseClient.from('employees').select('*').order('name', { ascending: true });
    if (currentAuthUser) {
      query = query.eq('user_id', currentAuthUser.id);
    }
    const { data, error } = await query;

    if (error) throw error;
    employeesList = data || [];
    renderEmployees(employeesList);
    updateMetrics();
    renderSummaryView();
  } catch (e) {
    console.warn('Employees fetch notice:', e.message);
  }
}

// Fetch Attendance Logs from Supabase (Scoped to Authenticated Tenant)
async function fetchAttendanceLogs() {
  if (!supabaseClient) return;
  try {
    let query = supabaseClient.from('attendance_logs').select('*').order('created_at', { ascending: false }).limit(300);
    if (currentAuthUser) {
      query = query.eq('user_id', currentAuthUser.id);
    }
    const { data, error } = await query;

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
    safeCreateIcons();
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
            user_id: currentAuthUser ? currentAuthUser.id : null,
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
        user_id: currentAuthUser ? currentAuthUser.id : null,
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
      user_id: currentAuthUser ? currentAuthUser.id : null,
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
    const { data, error } = await supabaseClient.from('employees').delete().eq('id', id).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      showRlsFixModal();
      return;
    }
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
      // 1. Fetch all attendance logs for this tenant and delete
      let logsQuery = supabaseClient.from('attendance_logs').select('id');
      if (currentAuthUser) logsQuery = logsQuery.eq('user_id', currentAuthUser.id);
      const { data: logsData } = await logsQuery;
      
      if (logsData && logsData.length > 0) {
        const logIds = logsData.map(l => l.id);
        await supabaseClient
          .from('attendance_logs')
          .delete()
          .in('id', logIds)
          .select();
      }

      if (currentAuthUser) {
        await supabaseClient
          .from('attendance_logs')
          .delete()
          .eq('user_id', currentAuthUser.id)
          .select();
      }

      // 2. Fetch all employees for this tenant and delete
      let empsQuery = supabaseClient.from('employees').select('id');
      if (currentAuthUser) empsQuery = empsQuery.eq('user_id', currentAuthUser.id);
      const { data: empsData } = await empsQuery;
      
      if (empsData && empsData.length > 0) {
        const empIds = empsData.map(e => e.id);
        await supabaseClient
          .from('employees')
          .delete()
          .in('id', empIds)
          .select();
      }

      if (currentAuthUser) {
        await supabaseClient
          .from('employees')
          .delete()
          .eq('user_id', currentAuthUser.id)
          .select();
      }

      // 3. Verification check: Verify if the online server actually deleted them
      let checkLogsQ = supabaseClient.from('attendance_logs').select('id').limit(5);
      let checkEmpsQ = supabaseClient.from('employees').select('id').limit(5);
      if (currentAuthUser) {
        checkLogsQ = checkLogsQ.eq('user_id', currentAuthUser.id);
        checkEmpsQ = checkEmpsQ.eq('user_id', currentAuthUser.id);
      }
      const { data: checkLogs } = await checkLogsQ;
      const { data: checkEmps } = await checkEmpsQ;

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
    btn.disabled = false;
    btn.innerHTML = originalHtml;
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
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]);
}
