// ========================================
// FIREBASE CONFIGURATION
// ========================================
// Firebase project: monitoring-hasil-stamping
// Database URL from ESP32 code

const FIREBASE_CONFIG = {
  databaseURL: "https://monitoring-hasil-stamping-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Firebase Realtime Database REST API helper
const FirebaseDB = {
  baseURL: FIREBASE_CONFIG.databaseURL,

  // GET data from a path
  async get(path) {
    try {
      const response = await fetch(`${this.baseURL}/${path}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Firebase GET ${path}:`, error);
      throw error;
    }
  },

  // PUT (overwrite) data at a path
  async put(path, data) {
    try {
      const response = await fetch(`${this.baseURL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Firebase PUT ${path}:`, error);
      throw error;
    }
  },

  // POST (push) data to a path
  async post(path, data) {
    try {
      const response = await fetch(`${this.baseURL}/${path}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Firebase POST ${path}:`, error);
      throw error;
    }
  },

  // Listen to changes using Server-Sent Events (SSE)
  listen(path, callback) {
    const url = `${this.baseURL}/${path}.json`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        callback(data, null);
      } catch (e) {
        callback(null, e);
      }
    };

    eventSource.onerror = (error) => {
      console.error(`Firebase SSE ${path}:`, error);
      callback(null, error);
    };

    return eventSource;
  }
};



// Sequential log helper: writes logs as login_000001, command_000001, setting_000001, etc.
function sanitizeFirebaseKey(key) {
  return String(key || '-')
    .replace(/[.#$\[\]/]/g, '-')
    .replace(/\s+/g, '-');
}

function firebaseLogPrefix(category) {
  const map = {
    login: 'login',
    command: 'command',
    settings: 'setting',
    emergency: 'emergency',
    manual_mode: 'manual'
  };
  return map[category] || category.replace(/[^a-zA-Z0-9_]/g, '_');
}

function makeSequentialId(prefix, number) {
  return `${prefix}_${String(number).padStart(6, '0')}`;
}

function extractMaxSequentialNumber(nodeData, prefix) {
  if (!nodeData || typeof nodeData !== 'object') return 0;
  let maxNumber = 0;
  const pattern = new RegExp(`^${prefix}_(\\d+)$`);
  Object.keys(nodeData).forEach((key) => {
    const match = key.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      if (!Number.isNaN(value) && value > maxNumber) maxNumber = value;
    }
  });
  return maxNumber;
}

async function writeNumberedFirebaseLog(dateKey, category, payload) {
  const safeDate = sanitizeFirebaseKey(dateKey);
  const safeCategory = sanitizeFirebaseKey(category);
  const prefix = firebaseLogPrefix(safeCategory);
  const basePath = `stamping_box/logs/${safeDate}/${safeCategory}`;

  let nextNumber = 1;
  try {
    const existing = await FirebaseDB.get(basePath);
    nextNumber = extractMaxSequentialNumber(existing, prefix) + 1;
  } catch (error) {
    nextNumber = 1;
  }

  const logId = makeSequentialId(prefix, nextNumber);
  const logPayload = {
    log_id: logId,
    log_number: nextNumber,
    log_category: safeCategory,
    ...payload
  };

  return FirebaseDB.put(`${basePath}/${logId}`, logPayload);
}

// Machine name constant (matches ESP32)
const MACHINE_NAME = "Mesin Stamping Box";
