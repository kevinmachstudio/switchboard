"use strict";

const byId = (id) => document.getElementById(id);
const panel = byId("panel");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const storageKey = "switchboard.positions.v1";

function loadState() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || {}; }
  catch { return {}; }
}

const saved = loadState();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
const integer = (value, min, max, fallback = min) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

const positions = {
  toggle: saved.toggle === true,
  dial: integer(saved.dial, 0, 23),
  slider: integer(saved.slider, 0, 6, 3),
  wheel: typeof saved.wheel === "number" && Number.isFinite(saved.wheel) ? mod(saved.wheel, 1800) : 0,
  rocker: saved.rocker === true,
  light: saved.light !== false,
  muted: saved.muted === true,
};

function saveState() {
  try { localStorage.setItem(storageKey, JSON.stringify(positions)); }
  catch { /* Private or restricted storage. */ }
}

const moving = new Set();
let frameId = 0;
let lastFrame = 0;

function animate(part) {
  moving.add(part);
  if (!frameId) frameId = requestAnimationFrame(step);
}

function step(now) {
  frameId = 0;
  const elapsed = lastFrame ? clamp((now - lastFrame) / 1000, .001, .034) : 1 / 60;
  lastFrame = now;
  for (const part of moving) {
    if (!part.advance(elapsed)) moving.delete(part);
  }
  if (moving.size) frameId = requestAnimationFrame(step);
  else lastFrame = 0;
}

function spring(element, start, { stiffness = 460, damping = 32 } = {}) {
  const part = {
    value: start,
    target: start,
    speed: 0,
    draw() {
      element.style.setProperty("--position", part.value.toFixed(3));
    },
    follow(value) {
      moving.delete(part);
      part.value = part.target = value;
      part.speed = 0;
      part.draw();
    },
    settle(target, speed = 0) {
      if (reducedMotion.matches) {
        part.follow(target);
        return;
      }
      part.target = target;
      part.speed = speed;
      animate(part);
    },
    advance(dt) {
      if (!reducedMotion.matches) {
        // Small integration steps keep the spring stable on slower displays.
        const slices = Math.ceil(dt / .008);
        const h = dt / slices;
        for (let slice = 0; slice < slices; slice++) {
          part.speed += ((part.target - part.value) * stiffness - part.speed * damping) * h;
          part.value += part.speed * h;
        }
        if (Math.abs(part.target - part.value) > .001 || Math.abs(part.speed) > .025) {
          part.draw();
          return true;
        }
      }
      part.follow(part.target);
      return false;
    },
  };
  part.draw();
  return part;
}

let audio;
let master;
let noiseBuffer;
const pendingSounds = [];

function unlockAudio() {
  if (positions.muted) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!audio) {
      audio = new Audio();
      master = audio.createGain();
      master.gain.value = .52;
      master.connect(audio.destination);
      noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * .12), audio.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state !== "running") {
      audio.resume().then(() => {
        const queued = pendingSounds.splice(0);
        for (const item of queued) {
          if (performance.now() - item.time < 700) sound(item.name, item.value);
        }
      }).catch(() => {});
    }
  } catch { /* Sound is optional in restricted contexts. */ }
}

function tone(at, start, end, length, gain, type = "sine") {
  const wave = audio.createOscillator();
  const envelope = audio.createGain();
  wave.type = type;
  wave.frequency.setValueAtTime(start, at);
  wave.frequency.exponentialRampToValueAtTime(end, at + length);
  envelope.gain.setValueAtTime(.0001, at);
  envelope.gain.exponentialRampToValueAtTime(gain, at + .003);
  envelope.gain.exponentialRampToValueAtTime(.0001, at + length);
  wave.connect(envelope).connect(master);
  wave.start(at);
  wave.stop(at + length + .006);
}

function noise(at, frequency, length, gain, resonance = .8) {
  const burst = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();
  burst.buffer = noiseBuffer;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = resonance;
  envelope.gain.setValueAtTime(gain, at);
  envelope.gain.exponentialRampToValueAtTime(.0001, at + length);
  burst.connect(filter).connect(envelope).connect(master);
  burst.start(at, Math.random() * .01, length);
}

const voices = {
  toggle(at, pitch, on) {
    noise(at, (on ? 1650 : 1120) * pitch, .041, .21, 1.3);
    tone(at, (on ? 390 : 290) * pitch, 102 * pitch, .047, .15, "triangle");
    noise(at + .015, 2400 * pitch, .018, .091);
  },
  arcade(at, pitch) {
    tone(at, 180 * pitch, 52 * pitch, .098, .39, "triangle");
    noise(at, 790 * pitch, .055, .18);
  },
  arcadeUp(at, pitch) {
    noise(at, 1200 * pitch, .026, .08);
    tone(at, 146 * pitch, 82 * pitch, .034, .09, "triangle");
  },
  dialGrip(at, pitch) {
    noise(at, 680 * pitch, .020, .065, 1.9);
  },
  dial(at, pitch, detent) {
    const tick = (980 + (detent % 5) * 85) * pitch;
    noise(at, tick, .022, .125, 2.2);
    tone(at, tick, tick * .68, .019, .062, "triangle");
  },
  slider(at, pitch, notch) {
    noise(at, (510 + notch * 55) * pitch, .033, .16, 2.6);
    tone(at, (285 + notch * 19) * pitch, 180 * pitch, .028, .06);
  },
  sliderGrip(at, pitch) {
    noise(at, 580 * pitch, .023, .075, 1.6);
  },
  wheel(at, pitch, speed) {
    const resonance = (610 + Math.min(Math.abs(speed), 1700) * .5) * pitch;
    noise(at, resonance, .039, .13, 3);
    tone(at, 200 * pitch, 126 * pitch, .035, .028, "triangle");
  },
  rocker(at, pitch, on) {
    noise(at, (on ? 880 : 725) * pitch, .064, .24, 1.4);
    tone(at, (on ? 225 : 175) * pitch, 65 * pitch, .058, .24, "triangle");
    noise(at + .023, 1800 * pitch, .019, .08);
  },
  key(at, pitch, index) {
    noise(at, (2490 + index * 65) * pitch, .021, .14, 1.8);
    tone(at, (545 + index * 34) * pitch, 245 * pitch, .035, .1, "triangle");
  },
  keyUp(at, pitch, index) {
    noise(at, (1550 + index * 48) * pitch, .018, .091, 2.3);
  },
  pull(at, pitch) {
    noise(at, 530 * pitch, .069, .14, 2.8);
  },
  cord(at, pitch, on) {
    tone(at, (on ? 465 : 343) * pitch, (on ? 536 : 192) * pitch, .094, .13, "triangle");
    noise(at, 1450 * pitch, .057, .19, 1.7);
  },
  cordUp(at, pitch) {
    noise(at, 850 * pitch, .051, .11, 2.2);
  },
  reward(at, pitch, index) {
    const melody = [
      [392, 494, 587, 784],
      [523, 659, 880, 1047],
      [330, 440, 554, 880],
    ][index];
    melody.forEach((note, beat) => {
      const start = at + beat * .095;
      tone(start, note * pitch, note * pitch, .16, .17, "triangle");
      tone(start, note * 2 * pitch, note * 2 * pitch, .084, .045);
    });
  },
};

function sound(name, value) {
  if (positions.muted || !audio) return;
  if (audio.state !== "running") {
    if (pendingSounds.length === 12) pendingSounds.shift();
    pendingSounds.push({ name, value, time: performance.now() });
    return;
  }
  voices[name](audio.currentTime + .002, .96 + Math.random() * .08, value);
}

function feedback(name, strength, value) {
  sound(name, value);
  if (typeof navigator.vibrate === "function") {
    try { navigator.vibrate(strength); }
    catch { /* Vibration is optional. */ }
  }
}

for (const eventName of ["pointerdown", "pointerup", "touchend", "keydown"]) {
  document.addEventListener(eventName, unlockAudio, { capture: true, passive: true });
}

function interaction(element, handlers) {
  let pointer = null;
  let heldKey = null;

  element.addEventListener("pointerdown", (event) => {
    if (pointer !== null || heldKey !== null || event.button !== 0) return;
    event.preventDefault();
    if (event.pointerType === "mouse") element.focus({ preventScroll: true });
    pointer = event.pointerId;
    try { element.setPointerCapture(pointer); }
    catch { /* Pointer may already have been released. */ }
    handlers.down(event);
  });

  element.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointer) handlers.move?.(event);
  });

  function end(event) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    handlers.up?.(event, event.type !== "pointerup");
  }

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    element.addEventListener(type, end);
  }

  element.addEventListener("keydown", (event) => {
    if (pointer !== null || event.altKey || event.ctrlKey || event.metaKey) return;
    if (handlers.key?.(event.key)) {
      event.preventDefault();
      return;
    }
    if (!handlers.press || ![" ", "Enter"].includes(event.key)) return;
    event.preventDefault();
    if (heldKey !== null || event.repeat) return;
    heldKey = event.key;
    handlers.press();
  });

  function releaseKey() {
    if (heldKey === null) return;
    heldKey = null;
    handlers.keyUp?.();
  }

  element.addEventListener("keyup", (event) => {
    if (event.key === heldKey) {
      event.preventDefault();
      releaseKey();
    }
  });
  element.addEventListener("blur", releaseKey);
}

function lamp(element, attribute, active) {
  element.closest(".module").toggleAttribute(attribute, active);
}

const combinations = [
  ["key1", "key5", "key9", "key5", "key1"],
  ["arcade", "arcade", "arcade", "toggle", "arcade"],
  ["slider-bottom", "slider-top", "slider-bottom", "cord"],
];
const maxCombinationLength = Math.max(...combinations.map((sequence) => sequence.length));
const actions = [];
let rewardTimeout;

function recordAction(action) {
  actions.push(action);
  if (actions.length > maxCombinationLength) actions.shift();
  const reward = combinations.findIndex((sequence) =>
    sequence.every((entry, index) => entry === actions[actions.length - sequence.length + index])
  );
  if (reward < 0) return;
  actions.length = 0;
  if (panel.dataset.reward === String(reward + 1)) {
    delete panel.dataset.reward;
    void panel.offsetWidth;
  }
  panel.dataset.reward = reward + 1;
  feedback("reward", [15, 45, 18, 45, 24], reward);
  clearTimeout(rewardTimeout);
  rewardTimeout = setTimeout(() => { delete panel.dataset.reward; }, 850);
}

const toggle = byId("toggle");
const lever = spring(toggle, positions.toggle ? -1 : 1, { stiffness: 620, damping: 32 });
toggle.setAttribute("aria-checked", positions.toggle);
lamp(toggle, "data-lit", positions.toggle);

function flipToggle() {
  positions.toggle = !positions.toggle;
  const target = positions.toggle ? -1 : 1;
  if (!reducedMotion.matches) lever.follow(lever.value + (target - lever.value) * .32);
  lever.settle(target, target * 18);
  toggle.setAttribute("aria-checked", positions.toggle);
  lamp(toggle, "data-lit", positions.toggle);
  feedback("toggle", 16, positions.toggle);
  recordAction("toggle");
  saveState();
}

interaction(toggle, { down: flipToggle, press: flipToggle });

const arcade = byId("arcade");
const plunger = spring(arcade, 0, { stiffness: 570, damping: 27 });
function pressArcade() {
  plunger.follow(.74);
  plunger.settle(1, 9);
  lamp(arcade, "data-held", true);
  feedback("arcade", 20);
  recordAction("arcade");
}
function releaseArcade() {
  plunger.settle(0, -6);
  lamp(arcade, "data-held", false);
  sound("arcadeUp");
}
interaction(arcade, { down: pressArcade, up: releaseArcade, press: pressArcade, keyUp: releaseArcade });

const dial = byId("dial");
const degreesPerDetent = 15;
const dialMotion = spring(dial, positions.dial * degreesPerDetent, { stiffness: 550, damping: 30 });
let dialAngle = dialMotion.value;
let dialDetent = Math.round(dialAngle / degreesPerDetent);
let lastBearing;
dial.setAttribute("aria-valuenow", positions.dial);

function bearing(event) {
  const rect = dial.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = event.clientY - rect.top - rect.height / 2;
  return Math.hypot(x, y) < 8 ? null : Math.atan2(y, x) * 180 / Math.PI;
}

function setDetent(next) {
  if (dialDetent === next) return;
  dialDetent = next;
  positions.dial = mod(next, 24);
  dial.setAttribute("aria-valuenow", positions.dial);
  feedback("dial", 7, positions.dial);
  saveState();
}

interaction(dial, {
  down(event) {
    dialAngle = dialMotion.value;
    dialMotion.follow(dialAngle);
    lastBearing = bearing(event);
    lamp(dial, "data-held", true);
    sound("dialGrip");
    recordAction("dial");
  },
  move(event) {
    const next = bearing(event);
    if (next !== null && lastBearing !== null) {
      dialAngle += mod(next - lastBearing + 180, 360) - 180;
      dialMotion.follow(dialAngle);
      setDetent(Math.round(dialAngle / degreesPerDetent));
    }
    lastBearing = next;
  },
  up() {
    dialMotion.settle(dialDetent * degreesPerDetent);
    lamp(dial, "data-held", false);
  },
  key(key) {
    const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 4, PageDown: -4 }[key];
    if (!direction && key !== "Home" && key !== "End") return false;
    recordAction("dial");
    const cycle = dialDetent - mod(dialDetent, 24);
    setDetent(direction ? dialDetent + direction : cycle + (key === "End" ? 23 : 0));
    dialMotion.settle(dialDetent * degreesPerDetent);
    return true;
  },
});

const slider = byId("slider");
const sliderGuide = slider.querySelector(".slider-guide");
const sliderGrip = slider.querySelector(".slider-grip");
const slideMotion = spring(slider, positions.slider, { stiffness: 570, damping: 32 });
let slideAnchorY;
let slideAnchorValue;
let slideNotchSize;
slider.setAttribute("aria-valuenow", positions.slider);

function setNotch(value) {
  if (positions.slider === value) return;
  positions.slider = value;
  slider.setAttribute("aria-valuenow", value);
  feedback("slider", 7, value);
  saveState();
}

function moveSlider(y) {
  const value = clamp(slideAnchorValue + (slideAnchorY - y) / slideNotchSize, 0, 6);
  slideMotion.follow(value);
  setNotch(Math.round(value));
}

function recordSlider() {
  const action = { 0: "slider-bottom", 6: "slider-top" }[positions.slider] || "slider";
  recordAction(action);
}

interaction(slider, {
  down(event) {
    const guide = sliderGuide.getBoundingClientRect();
    const grip = sliderGrip.getBoundingClientRect();
    const grabbed = event.clientY >= grip.top && event.clientY <= grip.bottom &&
      event.clientX >= grip.left - 8 && event.clientX <= grip.right + 8;
    slideNotchSize = guide.height / 6;
    slideAnchorY = grabbed ? event.clientY : guide.bottom;
    slideAnchorValue = grabbed ? slideMotion.value : 0;
    const previousNotch = positions.slider;
    moveSlider(event.clientY);
    if (positions.slider === previousNotch) sound("sliderGrip");
    lamp(slider, "data-held", true);
  },
  move(event) { moveSlider(event.clientY); },
  up(_event, cancelled) {
    slideMotion.settle(positions.slider);
    lamp(slider, "data-held", false);
    if (!cancelled) recordSlider();
  },
  key(key) {
    const offset = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 2, PageDown: -2 }[key];
    if (!offset && key !== "Home" && key !== "End") return false;
    setNotch(offset ? clamp(positions.slider + offset, 0, 6) : key === "End" ? 6 : 0);
    slideMotion.settle(positions.slider);
    recordSlider();
    return true;
  },
});

const wheel = byId("wheel");
let wheelOffset = positions.wheel;
let wheelReadout = -1;
let wheelSpeed = 0;
let wheelTouchAt;
let wheelTouchX;
let lastWheelTick = -Infinity;

function drawWheel() {
  wheel.style.setProperty("--position", wheelOffset.toFixed(3));
  const readout = Math.floor(mod(wheelOffset, 1800) / 10);
  if (readout !== wheelReadout) {
    wheelReadout = readout;
    wheel.setAttribute("aria-valuenow", readout);
  }
}

function wheelTick(previous, speed) {
  const now = performance.now();
  if (Math.floor(previous / 15) === Math.floor(wheelOffset / 15) || now - lastWheelTick < 42) return;
  lastWheelTick = now;
  if (Math.abs(speed) < 1500) sound("wheel", speed);
}

function saveWheel() {
  positions.wheel = mod(wheelOffset, 1800);
  saveState();
}

const flywheel = {
  advance(dt) {
    const previous = wheelOffset;
    wheelSpeed *= Math.exp(-4.2 * dt);
    if (reducedMotion.matches || Math.abs(wheelSpeed) < 14) {
      wheelSpeed = 0;
      wheelOffset = mod(wheelOffset, 1800);
      drawWheel();
      saveWheel();
      return false;
    }
    wheelOffset += wheelSpeed * dt;
    drawWheel();
    wheelTick(previous, wheelSpeed);
    return true;
  },
};

drawWheel();
interaction(wheel, {
  down(event) {
    moving.delete(flywheel);
    wheelSpeed = 0;
    wheelTouchAt = event.timeStamp;
    wheelTouchX = event.clientX;
    lamp(wheel, "data-held", true);
    feedback("wheel", 6, 0);
    recordAction("wheel");
  },
  move(event) {
    const delta = event.clientX - wheelTouchX;
    const elapsed = Math.max(4, event.timeStamp - wheelTouchAt);
    const previous = wheelOffset;
    wheelOffset += delta;
    wheelSpeed = .28 * wheelSpeed + .72 * clamp(delta * 1000 / elapsed, -2600, 2600);
    wheelTouchX = event.clientX;
    wheelTouchAt = event.timeStamp;
    drawWheel();
    wheelTick(previous, wheelSpeed);
  },
  up(event, cancelled) {
    lamp(wheel, "data-held", false);
    if (!cancelled && !reducedMotion.matches && event.timeStamp - wheelTouchAt < 95 && Math.abs(wheelSpeed) >= 25) {
      feedback("wheel", 9, wheelSpeed);
      animate(flywheel);
    }
    saveWheel();
  },
  key(key) {
    const offset = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 60, PageDown: -60 }[key];
    if (!offset && key !== "Home" && key !== "End") return false;
    moving.delete(flywheel);
    wheelOffset = offset ? mod(wheelOffset + offset, 1800) : key === "End" ? 1790 : 0;
    drawWheel();
    feedback("wheel", 7, offset ? offset * 11 : 0);
    recordAction("wheel");
    saveWheel();
    return true;
  },
});
window.addEventListener("pagehide", saveWheel);

const rocker = byId("rocker");
const rockerMotion = spring(rocker, positions.rocker ? -1 : 1, { stiffness: 600, damping: 31 });

function paintRocker() {
  rocker.setAttribute("aria-checked", positions.rocker);
  lamp(rocker, "data-lit", positions.rocker);
}
paintRocker();

function setRocker(on) {
  const target = on ? -1 : 1;
  if (!reducedMotion.matches) rockerMotion.follow(rockerMotion.value + (target - rockerMotion.value) * .24);
  rockerMotion.settle(target, positions.rocker === on ? -target * 8 : target * 12);
  positions.rocker = on;
  paintRocker();
  feedback("rocker", 14, on);
  recordAction("rocker");
  saveState();
}

interaction(rocker, {
  down(event) {
    const rect = rocker.getBoundingClientRect();
    setRocker(event.clientY < rect.top + rect.height / 2);
  },
  press() { setRocker(!positions.rocker); },
  key(key) {
    if (key === "ArrowUp") setRocker(true);
    else if (key === "ArrowDown") setRocker(false);
    else return false;
    return true;
  },
});

const keys = document.querySelectorAll(".keypad button");
const heldKeys = new Set();
for (const [index, key] of keys.entries()) {
  const keyMotion = spring(key, 0, { stiffness: 620, damping: 30 });
  function pressKey() {
    keyMotion.follow(.8);
    keyMotion.settle(1, 8);
    heldKeys.add(key);
    lamp(key, "data-held", true);
    feedback("key", 7, index);
    recordAction("key" + (index + 1));
  }
  function releaseKey() {
    keyMotion.settle(0, -8);
    heldKeys.delete(key);
    lamp(key, "data-held", heldKeys.size > 0);
    sound("keyUp", index);
  }
  interaction(key, { down: pressKey, up: releaseKey, press: pressKey, keyUp: releaseKey });
}

const cord = byId("cord");
const cordAssembly = cord.querySelector(".cord-assembly");
const cordMotion = spring(cord, 0, { stiffness: 490, damping: 24 });
let cordAnchor;
let cordLimit;
let cordTripped;

function paintLight() {
  panel.toggleAttribute("data-dark", !positions.light);
  byId("pilot").setAttribute("aria-label", positions.light ? "Panel light on" : "Panel light off");
  cord.setAttribute("aria-checked", positions.light);
  lamp(cord, "data-lit", positions.light);
}
paintLight();

function flipLight() {
  positions.light = !positions.light;
  paintLight();
  feedback("cord", 15, positions.light);
  recordAction("cord");
  saveState();
}

function cordTravel() {
  const assembly = cordAssembly.getBoundingClientRect();
  const scale = assembly.height / 91;
  const usableTravel = cord.getBoundingClientRect().bottom - assembly.top - 59 * scale;
  return Math.max(8, Math.min(39 * scale, usableTravel));
}

function releaseCord() {
  const pulled = cordMotion.value > 4;
  cordMotion.settle(0, pulled ? -50 : 0);
  lamp(cord, "data-held", false);
  if (pulled) sound("cordUp");
}

interaction(cord, {
  down(event) {
    cordAnchor = event.clientY - clamp(cordMotion.value, 0, cordTravel());
    cordLimit = cordTravel();
    cordTripped = false;
    cordMotion.follow(event.clientY - cordAnchor);
    lamp(cord, "data-held", true);
    sound("pull");
  },
  move(event) {
    const distance = clamp(event.clientY - cordAnchor, 0, cordLimit);
    cordMotion.follow(distance);
    if (!cordTripped && distance >= cordLimit * .74) {
      cordTripped = true;
      flipLight();
    }
  },
  up: releaseCord,
  press() {
    cordMotion.settle(cordTravel());
    lamp(cord, "data-held", true);
    flipLight();
  },
  keyUp: releaseCord,
});

const mute = byId("mute");
mute.setAttribute("aria-pressed", positions.muted);
function toggleMute() {
  positions.muted = !positions.muted;
  mute.setAttribute("aria-pressed", positions.muted);
  if (master) master.gain.value = positions.muted ? 0 : .52;
  if (positions.muted) pendingSounds.length = 0;
  else unlockAudio();
  saveState();
}
interaction(mute, { down: toggleMute, press: toggleMute });

document.addEventListener("contextmenu", (event) => event.preventDefault());

const install = byId("install");
const hint = byId("ios-hint");
const dismiss = byId("dismiss");
const standalone = matchMedia("(display-mode: standalone)");
const isiOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installPrompt;
let hintDismissed = saved.hintDismissed === true;

function syncInstallHint() {
  const installed = standalone.matches || navigator.standalone === true;
  hint.hidden = !isiOS || installed || hintDismissed;
  install.hidden = !installPrompt || installed;
}
syncInstallHint();
standalone.addEventListener?.("change", syncInstallHint);

function dismissInstallHint() {
  hintDismissed = true;
  positions.hintDismissed = true;
  saveState();
  syncInstallHint();
}
positions.hintDismissed = hintDismissed;
interaction(dismiss, { down: dismissInstallHint, press: dismissInstallHint });

window.addEventListener("beforeinstallprompt", (event) => {
  if (typeof event.prompt !== "function") return;
  event.preventDefault();
  installPrompt = event;
  syncInstallHint();
});

// The browser's installation dialog requires a trusted activation from this button.
install.addEventListener("click", async () => {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  try { await prompt.prompt(); }
  catch { /* The browser can withdraw the install offer. */ }
  syncInstallHint();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  syncInstallHint();
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
}
