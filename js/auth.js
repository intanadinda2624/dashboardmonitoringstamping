// ========================================
// AUTHENTICATION (Local - matches ESP32)
// ========================================

const WEB_USERS = [
  { username: "admin", password: "admin123", role: "ADMIN" },
  { username: "operator", password: "operator123", role: "OPERATOR" },
  { username: "viewer", password: "viewer123", role: "VIEWER" }
];

function getSession() {
  try {
    const s = sessionStorage.getItem('stamping_session');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function setSession(username, role) {
  sessionStorage.setItem('stamping_session', JSON.stringify({ username, role, ts: Date.now() }));
}

function clearSession() {
  sessionStorage.removeItem('stamping_session');
}

function isLoggedIn() {
  return getSession() !== null;
}

function getCurrentUser() {
  return getSession() || { username: '-', role: 'VIEWER' };
}

function isAdmin() { return getCurrentUser().role === 'ADMIN'; }
function isOperator() { return getCurrentUser().role === 'OPERATOR'; }
function isViewer() { return getCurrentUser().role === 'VIEWER'; }
function canControlMachine() { return isLoggedIn() && (isAdmin() || isOperator()); }
function canChangeThreshold() { return isLoggedIn() && isAdmin(); }
function canViewReportFull() { return isLoggedIn() && (isAdmin() || isViewer()); }

function authDateKey(date = new Date()) {
  return date.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' }).replace(/\//g, '-');
}

function authTimeText(date = new Date()) {
  return date.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
}

function authTimestamp(date = new Date()) {
  return `${authDateKey(date)} ${authTimeText(date)}`;
}

function writeAuthLog(action, username, role, detail) {
  const now = new Date();
  return writeNumberedFirebaseLog(authDateKey(now), 'login', {
    timestamp: authTimestamp(now),
    production_date: authDateKey(now),
    production_time: authTimeText(now),
    username: username,
    role: role,
    action: action,
    detail: detail,
    machine_name: MACHINE_NAME
  }).catch(() => {});
}

// Login handler (called from login form)
function handleLogin(event) {
  event.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('loginError');
  const btnText = document.getElementById('loginText');
  const spinner = document.getElementById('loginSpinner');

  errorEl.style.display = 'none';
  btnText.textContent = 'Memproses...';
  spinner.style.display = 'inline-block';

  // Small delay for UX
  setTimeout(() => {
    const user = WEB_USERS.find(u => u.username === username && u.password === password);

    if (user) {
      setSession(user.username, user.role);
      
      // Log to Firebase
      writeAuthLog('LOGIN_SUCCESS', user.username, user.role, 'User berhasil login via web online');

      window.location.href = 'dashboard.html';
    } else {
      errorEl.textContent = 'Username atau password salah.';
      errorEl.style.display = 'block';
      btnText.textContent = 'LOGIN';
      spinner.style.display = 'none';

      // Log failed attempt
      writeAuthLog('LOGIN_FAILED', username, 'UNKNOWN', 'Percobaan login gagal via web online');
    }
  }, 500);

  return false;
}

// Logout
function doLogout() {
  const user = getCurrentUser();
  
  writeAuthLog('LOGOUT', user.username, user.role, 'User logout dari web online');

  clearSession();
  window.location.href = 'index.html';
}

// Toggle password visibility
function togglePassword() {
  const pwInput = document.getElementById('password');
  if (pwInput) {
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
  }
}

// Auth guard - redirect to login if not authenticated
function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// Update navbar user info
function updateNavUser() {
  const user = getCurrentUser();
  const badge = document.getElementById('userBadge');
  const name = document.getElementById('userName');
  if (badge) badge.textContent = user.role;
  if (name) name.textContent = user.username;
}
