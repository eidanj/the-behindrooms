// ─────────────────────────────────────────────────────────────
//  THE BEHINDROOMS — tuning constants
//  Everything gameplay-related lives here so it's easy to tweak.
//  1 world unit = 1 meter.
// ─────────────────────────────────────────────────────────────

export const CELL = 3;                 // size of one maze cell (m)
export const CHUNK_CELLS = 8;          // cells per chunk side
export const CHUNK_SIZE = CELL * CHUNK_CELLS; // 24 m
export const WALL_H = 3.0;             // ceiling height
export const WALL_T = 0.2;             // wall thickness
export const DOOR_GAP = 1.3;           // doorway width
export const DOOR_H = 2.55;            // doorway height
export const FT = 0.3048;              // feet → meters

export const PLAYER = {
  radius: 0.32,
  eyeHeight: 1.62,
  walkSpeed: 3.0,          // m/s
  sprintMult: 1.2,         // +20% when sprinting
  jumpVelocity: 4.4,
  gravity: 14,
  stepHeight: 0.3,
  maxEnergy: 20,
  sprintHungerMin: 35,     // can't sprint below this hunger
};

export const FLASHLIGHT = {
  batterySeconds: 300,     // 5 minutes per battery
  startBatteries: 1,       // spares at start (plus the one inside)
};

export const CYCLE = {
  dayLength: 600,          // 10 minutes
  nightLength: 360,        // 6 minutes
  duskWarning: 10,         // seconds of violent flicker before lights die
  blackout: 2.2,           // full darkness after the power dies
};

export const STARS_TO_WIN = 30;
export const CHASE_ESCAPE_SECONDS = 20;

// Hearing radii from the design doc (feet), converted to meters at runtime.
export const HEARING = {
  walk: [5, 20],
  sprint: [10, 35],
  rock: 40,
  land: 12,
  drawer: 10,
  peel: 8,
  fight: 30,
};

export const ENTITY = {
  chaseSpeedMin: 1.05,     // × player walk speed
  chaseSpeedMax: 1.10,
  investigateSpeed: 1.25,  // "move slowly toward the sound"
  followSpeed: 1.0,        // daytime passive follow
  wanderSpeed: 0.8,
  killRange: 0.95,
  nearRadius: 10,          // sanity drain / "nearby" radius
  redVignetteRadius: 14,
  flickerRadius: 9,
  sightRangeDark: 12,      // night sight range with your flashlight OFF
  sightRangeLit: 22,       // night sight range with your flashlight ON
  tripSeconds: 2.6,
  slipSeconds: 4.0,
};

export const DIFFICULTIES = {
  easy: {
    id: 'easy', name: 'Easy',
    blurb: 'No jumpscares, quieter audio, brighter nights, fewer and 8% slower entities, more loot, slower stat drain.',
    jumpscareChance: 0, audioMult: 0.7, breathMult: 0.6, ambientMult: 1.6,
    nightCap: 4, dayCap: 1, nightRoomChance: 0.07, dayRoomChance: 1 / 50,
    entitySpeedMult: 0.92, statDrainMult: 0.75,
    drawerChance: 0.44, loot: { battery: 26, drink: 20, food: 15, key: 10, weapon: 9 }, entityHp: 95,
    floorItemMult: 1.3, sightMult: 0.85, trapChance: 0.3, saferoomChance: 0.45,
    starsKeptOnDeath: 0.5,
  },
  normal: {
    id: 'normal', name: 'Normal',
    blurb: 'The standard experience. No jumpscares, normal audio, brightness, loot and stat drain.',
    jumpscareChance: 0, audioMult: 1.0, breathMult: 1.0, ambientMult: 1.0,
    nightCap: 7, dayCap: 2, nightRoomChance: 0.12, dayRoomChance: 1 / 50,
    entitySpeedMult: 1.0, statDrainMult: 1.0,
    drawerChance: 0.30, loot: { battery: 20, drink: 15, food: 10, key: 8, weapon: 7 }, entityHp: 120,
    floorItemMult: 1.0, sightMult: 1.0, trapChance: 0.4, saferoomChance: 0.35,
    starsKeptOnDeath: 0,
  },
  hard: {
    id: 'hard', name: 'Hard',
    blurb: 'Intense audio, rare jumpscares (8%), faster stat drain, scarcer drawers, batteries, food and drinks.',
    jumpscareChance: 0.08, audioMult: 1.15, breathMult: 1.35, ambientMult: 0.8,
    nightCap: 7, dayCap: 2, nightRoomChance: 0.12, dayRoomChance: 1 / 50,
    entitySpeedMult: 1.0, statDrainMult: 1.35,
    drawerChance: 0.21, loot: { battery: 14, drink: 10, food: 7, key: 6, weapon: 5 }, entityHp: 145,
    floorItemMult: 0.85, sightMult: 1.1, trapChance: 0.55, saferoomChance: 0.3,
    starsKeptOnDeath: 0,
  },
};

export const QUALITY = {
  // poolLights = how many real lights exist at once; lightRange = how far away (m) lights switch on
  low:    { label: 'Low',    renderScale: 0.6,  maxDPR: 1,   poolLights: 4, lightRange: 24, loadRadius: 1, shadows: false, anisotropy: 1, fogDay: 34, fogNight: 26 },
  medium: { label: 'Medium', renderScale: 0.85, maxDPR: 1,   poolLights: 6, lightRange: 32, loadRadius: 2, shadows: false, anisotropy: 4, fogDay: 54, fogNight: 32 },
  high:   { label: 'High',   renderScale: 1.0,  maxDPR: 1.5, poolLights: 8, lightRange: 38, loadRadius: 2, shadows: true,  anisotropy: 8, fogDay: 60, fogNight: 36 },
};

// Night lighting. Raise darkRoomChance / lower level for an even darker night.
export const NIGHT_LIGHTS = {
  darkRoomChance: 0.55,   // share of rooms with NO working light at night
  extraLightChance: 0.2,  // chance a lit room gets a 2nd light
  level: 0.24,            // brightness of a working night light (day = 1)
  rangeMult: 0.75,        // how far a night light's glow reaches vs. daytime
};

// Testing helpers. Set testTools to false before you release the game.
export const DEBUG = {
  testTools: true,   // Test tools in the pause menu + hotkeys N / T / M / G / B
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  invertY: false,
  fov: 75,
  headBob: true,
  masterVolume: 0.8,
  musicVolume: 0.6,
  brightness: 1.0,
  quality: 'medium',
  showFps: false,
  touchControls: 'auto', // 'auto' (detect phones/tablets), 'on' or 'off'
};
