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
  crouchEye: 1.0,          // eye height while crouching
  walkSpeed: 3.0,          // m/s
  sprintMult: 1.2,         // +20% when sprinting
  crouchMult: 0.55,        // crouch-walk speed
  jumpVelocity: 4.4,
  gravity: 14,
  stepHeight: 0.36,        // highest ledge you can walk up
  maxEnergy: 20,
  maxHealth: 100,
  sprintHungerMin: 35,     // can't sprint below this hunger
  crouchMax: 10,           // seconds you can stay crouched…
  crouchRecharge: 20,      // …then this long to recharge fully
  fallSafe: 1.7,           // falls shorter than this don't hurt
  fallDamagePerM: 14,      // damage per metre beyond that
  regenDelay: 8,           // seconds after being hurt before health regenerates
  regenRate: 1 / 4,        // HP per second while regenerating
  waterSpeed: 0.7,         // speed multiplier while wading in pools
};

export const VENT = {
  durability: 100,
  drainMove: 2.2,          // per second while crawling
  drainSprint: 5.5,        // per second while crawl-sprinting
  regen: 0.8,              // per second while still (slower than it drops)
  maxTime: 120,            // stay longer than this and it collapses
  crawlSpeed: 1.25,
  crawlSprint: 1.9,
  clawDamage: 12,          // durability lost when a monster claws the vent
  floorY: 3.06,            // height of the duct floor
};

export const FLASHLIGHT = {
  batterySeconds: 300,     // 5 minutes per battery
  startBatteries: 1,       // spares at start (plus the one inside)
  seenCutout: 1.0,         // flashlight dies for this long when a monster spots you
};

export const CYCLE = {
  dayLength: 600,          // 10 minutes
  nightLength: 360,        // 6 minutes
  duskWarning: 10,         // seconds of violent flicker before lights die
  blackout: 2.2,           // full darkness after the power dies
  nightAmbient: 0.022,     // ambient light at night (day = 1) — lower = darker
};

export const STARS_TO_WIN = 30;
export const CHASE_ESCAPE_SECONDS = 20;

// Hearing radii from the design doc (feet), converted to meters at runtime.
export const HEARING = {
  walk: [5, 20],
  sprint: [10, 35],
  rock: 40,
  noisemaker: 70,
  land: 12,
  drawer: 10,
  peel: 8,
  fight: 30,
  eat: 6,
};

export const ENTITY = {
  investigateSpeed: 1.25,  // "move slowly toward the sound"
  followSpeed: 1.0,        // daytime passive follow
  wanderSpeed: 0.8,
  nearRadius: 10,          // sanity drain / "nearby" radius
  redVignetteRadius: 14,
  flickerRadius: 9,
  sightRangeDark: 12,      // night sight range with your flashlight OFF
  sightRangeLit: 22,       // night sight range with your flashlight ON
  tripSeconds: 2.6,
  slipSeconds: 4.0,
};

// Monster types. hp is × the difficulty's entityHp. speed is × your walk speed
// (you sprint at 1.2). dmg = damage per hit, cd = seconds between hits.
export const ENTITY_TYPES = {
  hollow:    { name: 'The Hollow',    hp: 1.0,  dmg: 22, cd: 1.3, reach: 1.25, speed: 1.07, head: 2.25, radius: 0.33, voice: 'breath',  weight: 30, color: 'pale' },
  crawler:   { name: 'The Crawler',   hp: 0.55, dmg: 12, cd: 0.8, reach: 1.0,  speed: 1.12, head: 0.7,  radius: 0.42, voice: 'chitter', weight: 20 },
  brute:     { name: 'The Brute',     hp: 2.2,  dmg: 40, cd: 2.0, reach: 1.6,  speed: 0.86, head: 2.6,  radius: 0.55, voice: 'growl',   weight: 12 },
  hound:     { name: 'The Hound',     hp: 0.75, dmg: 16, cd: 0.9, reach: 1.15, speed: 1.16, head: 0.9,  radius: 0.42, voice: 'pant',    weight: 14 },
  smiler:    { name: 'The Smiler',    hp: 0.5,  dmg: 28, cd: 1.5, reach: 1.2,  speed: 1.0,  head: 1.8,  radius: 0.35, voice: 'hum',     weight: 12, nightOnly: true, fleesLight: true },
  mannequin: { name: 'The Mannequin', hp: 1.3,  dmg: 30, cd: 1.4, reach: 1.2,  speed: 1.35, head: 1.75, radius: 0.32, voice: 'creak',   weight: 10, statue: true },
};

export const DIFFICULTIES = {
  easy: {
    id: 'easy', name: 'Easy',
    jumpscareChance: 0, audioMult: 0.7, breathMult: 0.6, ambientMult: 1.0,
    nightCap: 4, dayCap: 1, nightRoomChance: 0.07, dayRoomChance: 1 / 50,
    entitySpeedMult: 0.92, entityDmgMult: 0.7, statDrainMult: 0.75,
    cabinetChance: 0.37, lootMult: 1.3, entityHp: 95,
    sightMult: 0.85, trapChance: 0.3, saferoomChance: 0.45, ventChance: 0.35,
    starsKeptOnDeath: 0.5, nightLight: 1.0,
  },
  normal: {
    id: 'normal', name: 'Normal',
    jumpscareChance: 0, audioMult: 1.0, breathMult: 1.0, ambientMult: 0.6,
    nightCap: 7, dayCap: 2, nightRoomChance: 0.12, dayRoomChance: 1 / 50,
    entitySpeedMult: 1.0, entityDmgMult: 1.0, statDrainMult: 1.0,
    cabinetChance: 0.255, lootMult: 1.0, entityHp: 120,
    sightMult: 1.0, trapChance: 0.4, saferoomChance: 0.35, ventChance: 0.28,
    starsKeptOnDeath: 0, nightLight: 0.8,
  },
  hard: {
    id: 'hard', name: 'Hard',
    jumpscareChance: 0.08, audioMult: 1.15, breathMult: 1.35, ambientMult: 0.35,
    nightCap: 8, dayCap: 2, nightRoomChance: 0.12, dayRoomChance: 1 / 50,
    entitySpeedMult: 1.0, entityDmgMult: 1.25, statDrainMult: 1.35,
    cabinetChance: 0.18, lootMult: 0.7, entityHp: 145,
    sightMult: 1.1, trapChance: 0.55, saferoomChance: 0.3, ventChance: 0.22,
    starsKeptOnDeath: 0, nightLight: 0.6,
  },
};

// What one drawer can hold (weights out of ~100; the rest is "empty").
// Non-empty weights are scaled by the difficulty's lootMult.
export const DRAWER_LOOT = {
  battery: 8, drink: 7, food: 7, key: 2.5, weapon: 2.2,
  wood: 8, metal: 7, cloth: 4, tape: 3, medkit: 1,
};

// Crafting recipes (use the crafting table at camp).
export const RECIPES = [
  { id: 'club',       out: 'club',       weapon: true, needs: { wood: 3 },                      desc: 'Wooden Club · 18 dmg · 18 hits' },
  { id: 'pipe',       out: 'pipe',       weapon: true, needs: { metal: 3 },                     desc: 'Lead Pipe · 24 dmg · 25 hits' },
  { id: 'crowbar',    out: 'crowbar',    weapon: true, needs: { metal: 4, tape: 1 },            desc: 'Crowbar · 27 dmg · 30 hits' },
  { id: 'spikedbat',  out: 'spikedbat',  weapon: true, needs: { wood: 4, metal: 2, tape: 1 },   desc: 'Spiked Bat · 40 dmg · 24 hits' },
  { id: 'axe',        out: 'axe',        weapon: true, needs: { wood: 2, metal: 5, tape: 2 },   desc: 'Fire Axe · 48 dmg · 14 hits' },
  { id: 'bandage',    out: 'bandage',    needs: { cloth: 2 },                                    desc: 'Bandage · heals 35 HP' },
  { id: 'medkit',     out: 'medkit',     needs: { cloth: 3, tape: 1 },                           desc: 'First Aid Kit · heals 70 HP' },
  { id: 'battery',    out: 'battery',    needs: { metal: 2, tape: 1 },                           desc: 'Battery · 5 min of light' },
  { id: 'key',        out: 'key',        needs: { metal: 3, tape: 1 },                           desc: 'Saferoom Key' },
  { id: 'noisemaker', out: 'noisemaker', needs: { metal: 1, tape: 1 },                           desc: 'Noisemaker · throw it to lure monsters far away' },
];

// Graphics presets. Every value can also be changed on the Graphics page.
//  renderScale  : resolution multiplier          maxLights : real lights at once
//  lightRange   : how far away lights switch on  viewDist  : chunks loaded around you
export const GFX_PRESETS = {
  low:    { renderScale: 0.7,  maxDPR: 1,    maxLights: 5,  lightRange: 30, viewDist: 1, shadows: false, aniso: 2,  fogDay: 30, fogNight: 20 },
  medium: { renderScale: 1.0,  maxDPR: 1.25, maxLights: 8,  lightRange: 42, viewDist: 2, shadows: false, aniso: 8,  fogDay: 60, fogNight: 28 },
  high:   { renderScale: 1.0,  maxDPR: 1.75, maxLights: 10, lightRange: 50, viewDist: 2, shadows: true,  aniso: 16, fogDay: 66, fogNight: 32 },
  ultra:  { renderScale: 1.25, maxDPR: 2,    maxLights: 12, lightRange: 60, viewDist: 3, shadows: true,  aniso: 16, fogDay: 84, fogNight: 36 },
};

// Night lighting. Raise darkRoomChance / lower level for an even darker night.
export const NIGHT_LIGHTS = {
  darkRoomChance: 0.68,   // share of rooms with NO working light at night
  extraLightChance: 0.15, // chance a lit room gets a 2nd light
  level: 0.18,            // brightness of a working night light (day = 1)
  rangeMult: 0.7,         // how far a night light's glow reaches vs. daytime
};

// Testing helpers. Set testTools to false before you release the game.
export const DEBUG = {
  testTools: true,   // Testing tab in the pause menu + hotkeys N / T / M / G / B / J
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  invertY: false,
  fov: 75,
  headBob: true,
  masterVolume: 0.8,
  musicVolume: 0.6,
  brightness: 1.0,
  touchControls: 'auto', // 'auto' (detect phones/tablets), 'on' or 'off'
  crouchToggle: false,   // false = hold C to crouch, true = press C to toggle
  // graphics
  gfxPreset: 'medium',
  renderScale: 1.0,
  maxDPR: 1.25,
  maxLights: 8,
  lightRange: 42,
  viewDist: 2,
  shadows: false,
  aniso: 8,
  fogDay: 60,
  fogNight: 28,
  antialias: true,
  showFps: false,
};
