// IW7DLE - 2025/09/19 

const { GlobalKeyboardListener } = require("node-global-key-listener");
const net = require("net");

// --- CAT server settings ---
const CAT_HOST = "127.0.0.1";
const CAT_PORT = 13013;
let cat;

// --- R1 Frequency ---
let currentFreq = 14200000; // 14.200 MHz default
let stepSize = 1000;         // default step 1000 Hz
let pendingStep = 0;
let stepToggleLock = false;  // prevent multiple toggles on key repeat

// --- R2 ZZIS ---
let currentIS = 3000;        // default
let pendingISStep = 0;

// --- R3 ZZLA ---
let currentLA = 50;          // default 0-100
let pendingLAStep = 0;

// --- Other states ---
let pttState = false;
let muteState = false;
const pressedKeys = new Set();
const recentModifiers = new Map();
let lastCombo = "";

// --- Connect/reconnect to CAT ---
function connectCAT() {
  cat = new net.Socket();

  cat.connect(CAT_PORT, CAT_HOST, () => {
    console.log("✅ Connected to Thetis CAT server");
    sendCAT("FA;");    // initial frequency
    sendCAT("ZZIS;");  // initial R2
    sendCAT("ZZLA;");  // initial R3
  });

  cat.on("error", err => console.error("❌ CAT error:", err.message));

  cat.on("close", () => {
    console.log("⚠️ CAT connection closed. Reconnecting in 3s...");
    setTimeout(connectCAT, 3000);
  });

  cat.on("data", data => {
    const msg = data.toString().trim();
    console.log("📡 CAT RX:", msg);

    const cmds = msg.split(";").filter(c => c.length > 0);

    cmds.forEach(cmd => {
      // --- R1 Frequency ---
      if (cmd.startsWith("FA")) {
        const num = parseInt(cmd.substring(2, 13));
        if (!isNaN(num)) {
          currentFreq = num;
          console.log(`🎯 Synced frequency: ${currentFreq / 1000} kHz`);

          if (pendingStep !== 0) {
            setFrequency(currentFreq + pendingStep);
            pendingStep = 0;
          }
        }
      }

      // --- R2 ZZIS ---
      if (cmd.startsWith("ZZIS")) {
        const num = parseInt(cmd.substring(4, 9));
        if (!isNaN(num)) {
          currentIS = num;
          if (pendingISStep !== 0) {
            let newIS = currentIS + pendingISStep;
            newIS = Math.max(100, Math.min(10000, newIS));
            currentIS = newIS;
            sendCAT(`ZZIS${newIS.toString().padStart(5, "0")};`);
            console.log(`➡️ ZZIS set to ${newIS}`);
            pendingISStep = 0;
          }
          console.log(`🎯 Synced ZZIS: ${currentIS}`);
        }
      }

      // --- R3 ZZLA ---
      if (cmd.startsWith("ZZLA")) {
        const num = parseInt(cmd.substring(4));
        if (!isNaN(num)) {
          currentLA = num;
          if (pendingLAStep !== 0) {
            let newLA = currentLA + pendingLAStep;
            newLA = Math.max(0, Math.min(100, newLA));
            currentLA = newLA;
            sendCAT(`ZZLA${newLA.toString().padStart(3, "0")};`);
            console.log(`➡️ ZZLA set to ${newLA}`);
            pendingLAStep = 0;
          }
          console.log(`🎯 Synced ZZLA: ${currentLA}`);
        }
      }
    });
  });
}
connectCAT();

// --- Send CAT command ---
function sendCAT(cmd) {
  if (cat && !cat.destroyed) {
    cat.write(cmd);
    console.log("➡️ CAT TX:", cmd.trim());
  }
}

// --- Set frequency ---
function setFrequency(newFreq) {
  currentFreq = newFreq;
  const cmd = `FA${currentFreq.toString().padStart(11, "0")};`;
  sendCAT(cmd);
}

// --- Keyboard listener ---
const v = new GlobalKeyboardListener();

function updateModifier(key, state) {
  if (state === "DOWN") recentModifiers.set(key, Date.now());
  else recentModifiers.delete(key);
}

function ctrlAltActive() {
  const now = Date.now();
  const ctrlPressed = recentModifiers.get("LEFT CTRL") || recentModifiers.get("RIGHT CTRL");
  const altPressed = recentModifiers.get("LEFT ALT") || recentModifiers.get("RIGHT ALT");
  return (ctrlPressed && now - ctrlPressed < 200) && (altPressed && now - altPressed < 200);
}

v.addListener(e => {
  const key = e.name;

  // Update pressed keys
  if (e.state === "DOWN") pressedKeys.add(key);
  else pressedKeys.delete(key);

  // Update modifiers
  if (["LEFT CTRL","RIGHT CTRL","LEFT ALT","RIGHT ALT"].includes(key)) {
    updateModifier(key, e.state);
  }

  // Debug combo
  const comboStr = Array.from(pressedKeys).sort().join(" + ");
  if (comboStr !== lastCombo) {
    console.log(`⎆ Combo: ${comboStr || "(none)"}`);
    lastCombo = comboStr;
  }

  // --- R1 Step toggle ---
  if (e.state === "DOWN" && key === "F1" && ctrlAltActive() && !stepToggleLock) {
    stepSize = (stepSize === 100 ? 1000 : 100);
    console.log(`🔧 Step size changed to ${stepSize} Hz`);
    stepToggleLock = true;
  }
  if (e.state === "UP" && key === "F1") stepToggleLock = false;

  // Ctrl+Alt combos
  if (ctrlAltActive()) {
    // --- R1 Frequency step (arrows) ---
    if (e.state === "DOWN" && (key === "UP" || key === "UP ARROW")) {
      pendingStep = stepSize;
      sendCAT("FA;");
    }
    if (e.state === "DOWN" && (key === "DOWN" || key === "DOWN ARROW")) {
      pendingStep = -stepSize;
      sendCAT("FA;");
    }

    // --- R2 ZZIS ---
    if (e.state === "DOWN" && key === "PAGE UP") {
      pendingISStep = +100;
      const predictedIS = Math.min(10000, currentIS + pendingISStep);
      console.log(`⏫ ZZIS ↑ predicted: ${predictedIS}`);
      sendCAT("ZZIS;");
    }
    if (e.state === "DOWN" && key === "PAGE DOWN") {
      pendingISStep = -100;
      const predictedIS = Math.max(100, currentIS + pendingISStep);
      console.log(`⏬ ZZIS ↓ predicted: ${predictedIS}`);
      sendCAT("ZZIS;");
    }
    if (e.state === "DOWN" && key === "F2") {
      currentIS = 3000;
      sendCAT(`ZZIS${currentIS.toString().padStart(5, "0")};`);
      console.log("🎚 ZZIS knob pressed → 3000");
    }

    // --- R3 ZZLA ---
    if (e.state === "DOWN" && key === "HOME") {
      pendingLAStep = +5;
      const predictedLA = Math.min(100, currentLA + pendingLAStep);
      console.log(`⏫ ZZLA ↑ predicted: ${predictedLA}`);
      sendCAT("ZZLA;");
    }
    if (e.state === "DOWN" && key === "END") {
      pendingLAStep = -5;
      const predictedLA = Math.max(0, currentLA + pendingLAStep);
      console.log(`⏬ ZZLA ↓ predicted: ${predictedLA}`);
      sendCAT("ZZLA;");
    }
    if (e.state === "DOWN" && key === "F3") {
      //currentLA = 50;
      //sendCAT(`ZZLA${currentLA.toString().padStart(3, "0")};`);
      //console.log("🎚 ZZLA knob pressed → 50");
	    muteState = !muteState;
		sendCAT(muteState ? "ZZMA1;" : "ZZMA0;");
		console.log(`➡️ MUTE ${muteState ? "ON" : "OFF"}`);
    }
 
  }

  // MUTE (F16)
  if (e.state === "DOWN" && key === "F16") {
    muteState = !muteState;
    sendCAT(muteState ? "ZZMA1;" : "ZZMA0;");
    console.log(`➡️ MUTE ${muteState ? "ON" : "OFF"}`);
  }

  // BAND UP/DOWN
  if (e.state === "DOWN" && key === "F22") { sendCAT("BD;"); console.log("➡️ BAND DOWN"); }
  if (e.state === "DOWN" && key === "F23") { sendCAT("BU;"); console.log("➡️ BAND UP"); }

  // PTT toggle
  if (e.state === "DOWN" && key === "F24" || e.state === "DOWN" && key === "F21" ) {
    pttState = !pttState;
    sendCAT(pttState ? "TX;" : "RX;");
    console.log(`➡️ PTT ${pttState ? "ON" : "OFF"}`);
  }
});
