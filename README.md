# The Behindrooms

A 3D first-person survival horror game in an endless, procedurally generated Backrooms-style office maze. It's built with plain HTML, CSS, JavaScript and [Three.js](https://threejs.org), with no build step, no image or audio files and no dependencies to install.

Collect **30 ★ stars**, survive the day/night cycle, bring the stars back to camp, and step through the Escape Portal.

---

## Run it locally (VS Code)

Browsers block JavaScript modules on `file://` pages, so the game must be served over HTTP:

1. Open this folder in VS Code.
2. Install the **Live Server** extension (by Ritwick Dey).
3. Right-click `index.html` → **Open with Live Server**.

Alternatives: `npx serve .` or `python -m http.server 8000` from this folder, then open <http://localhost:8000>.

## Host it on GitHub Pages

1. Create a new GitHub repository and push the contents of this folder to it (`index.html` must be at the repo root).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then **Save**.
3. After a minute your game is live at `https://<your-username>.github.io/<repo-name>/`.

Three.js is bundled locally in `lib/`, so nothing is fetched from a CDN. The only external request is the Google Fonts stylesheet. If it fails to load, the game falls back to system fonts.

---

## Controls

On phones and tablets, touch controls turn on automatically (change it in **Settings → Touch controls**). Use the left thumbstick to move, drag the right side to look, and **tap anywhere to punch**. On-screen buttons cover attack, use item, jump, interact, sprint, crouch, flashlight, battery, drop peel and pause. Tap hotbar slots to switch items. Play in landscape.

**Keyboard and mouse:**

| Key | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Look |
| **Shift** | Sprint (+20% speed, needs Hunger ≥ 35 and Energy > 0). In a vent: crawl faster |
| **C** | Crouch (hold, or toggle in Settings). Monsters can't hear you. 10 s max, then 20 s to recover |
| **Space** | Jump · climb ladders |
| **E** | Interact: search drawers, pick up, unlock saferooms, sleep, portal, crafting table, chest, vents |
| **L** | Flashlight on/off (or click while holding it) |
| **R** | Replace flashlight battery |
| **F** / **click** | Punch, or swing your weapon. The bar under the crosshair shows the recharge |
| **1–8 / mouse wheel** | Select item. Press a number again to cycle food, drinks, throwables, meds or weapons |
| **Left click** | Use the held item: flashlight toggle, eat, drink, heal, throw |
| **Right click** | Drop a banana peel at your feet |
| **Esc** | Pause |

## How it plays

- **Day (10 min):** fluorescent lights and calm music. Entities are very rare (1 in 50 rooms) and only follow you slowly.
- **Dusk:** the lights flicker violently, then the power dies.
- **Night (6 min):** most rooms go completely dark, the rest keep one dim light, and entities roam. They're **blind** and hunt by **sound**. With **line of sight** at night they chase you, and your flashlight cuts out for a second when one spots you.
- **Health:** monsters hit you for damage (each type differently) instead of killing you outright, so you can fight back or run. Falls hurt too. Health slowly regenerates a while after you were last hurt (much faster at camp). Bandages and first aid kits heal.
- **Escaping:** break line of sight and survive 20 seconds to escape a chase and earn **+1 ★**.
- **Stars:** walking into camp banks the stars you carry. If you die, carried stars are lost (Easy keeps half).

### Monsters

| Type | What it does |
|---|---|
| The Hollow | Tall and eyeless. The all-rounder. |
| The Crawler | Low, six-legged, fast and fragile. Small hits, quick attacks. |
| The Brute | Huge and slow. Hits for 40 and barely flinches. |
| The Hound | Four-legged and very fast. |
| The Smiler | Night only. A shadow with a grin. Your flashlight beam burns it and drives it away. |
| The Mannequin | Can't move while you look at it. Very fast when you don't. |

Tune them in `ENTITY_TYPES` in `js/config.js`.

### The map

- Rooms come in types, each with its own wallpaper and floor (the ceiling stays the same): plain office rooms, **sunken rooms** (a ramp leads down; other doorways are drops), **rooms with holes in the floor** (ladders lead out of each pit), a pitch-dark **Christmas room** with a single tree, **cubicles**, **flooded rooms**, **pillar halls**, red, tiled and concrete rooms.
- Far from camp you can find the **Poolrooms**: white tiles, open halls and pools you can wade through (climb out with the pool ladders).
- **Vents** run above the ceiling. Climb a ladder into one (camp has one) to hide: monsters can't see or hear you. Crawling wears the vent down (faster if you hurry); stay still and it slowly recovers. It collapses at 0, or if you stay longer than 2 minutes, and monsters sometimes claw at it from below. Find a grate and press **E** to drop out.
- About 1 room in 75 has things that **noclipped in** from somewhere else: cars, stop signs, couches, vending machines, shopping carts…

### Loot and crafting

Filing cabinets come in several kinds (standard, rusty with stuck drawers, double, half-sunk into the floor, wooden desks, tall). **Every drawer** is searched on its own and can hold something: batteries, food, drinks, keys, weapons, meds or **materials** (wood, metal, cloth, duct tape). Odds are in `DRAWER_LOOT` in `js/config.js`.

Bring materials to the **crafting table** at camp:

| Recipe | Needs |
|---|---|
| Wooden Club | 3 wood |
| Lead Pipe | 3 metal |
| Crowbar | 4 metal + 1 tape |
| Spiked Bat | 4 wood + 2 metal + 1 tape |
| Fire Axe | 2 wood + 5 metal + 2 tape |
| Bandage (+35 HP) | 2 cloth |
| First Aid Kit (+70 HP) | 3 cloth + 1 tape |
| Battery | 2 metal + 1 tape |
| Saferoom Key | 3 metal + 1 tape |
| Noisemaker | 1 metal + 1 tape (throw it: it rings and lures monsters) |

The **camp chest** stores food, drinks, batteries, meds and materials. They stay there when you die.

**Bananas** are food; eating one leaves a **peel** you can throw or drop so chasers slip. **Rocks** make noise and trip monsters.

### Survival stats

| Stat | Rules |
|---|---|
| **Health** (100) | Lost to monster hits and falls. Regenerates 8 s after the last hit (6× faster at camp). |
| **Sanity** (100) | Drains slowly, faster at night and near monsters. <50 grey tint, <30 vignette, <10 flicker. 0 kills you. |
| **Hunger** (100) | Drains while you move (3× sprinting). Can't sprint below 35. At 0 you slowly lose health. |
| **Energy** (20) | Drains while moving. At 0 you're exhausted. Stand still to recover. |
| **Flashlight** | Each battery lasts 5 minutes. |

### Difficulty

- **Easy:** no jumpscares, quieter audio, monsters hit 30% softer, fewer and slower monsters, more loot and vents, slower stat drain.
- **Normal:** the standard experience.
- **Hard:** intense audio, an 8% chance of a jumpscare when spotted, monsters hit 25% harder, scarcer loot, pitch-black nights.

---

## Project structure

```
index.html          UI screens, HUD, overlays
css/style.css       All styling (VHS / found-footage look)
lib/                Three.js (r187, bundled locally) + license
js/config.js        ← all tuning numbers: speeds, monsters, recipes, loot, difficulty, graphics presets
js/main.js          Game loop, state machine, events, death/win
js/world.js         Infinite chunked maze: room types, heights, vents, baked light, collision, pathfinding
js/cycle.js         Day/night timeline and lighting factors
js/entities.js      Monster AI per type (hearing, sight, chase, attacks) and animation
js/player.js        Movement (ledges, ladders, water, crouch, vents), health, stats, item use
js/items.js         Items, materials, weapons, inventory, thrown rocks / noisemakers / peels
js/hands.js         First-person hand and held-item viewmodel
js/audio.js         Procedural Web Audio: music, breathing, SFX
js/textures.js      Procedural canvas textures and shared materials
js/models.js        Primitive-built 3D models (cabinets, monsters, ladders, vents, junk…)
js/geo.js           Geometry merger for walls and floors
js/ui.js            DOM HUD, hotbar, compass, toasts, screen effects
js/tutorial.js      Interactive tutorial steps
js/guide.js         Test tool: arrow trail to the nearest saferoom
js/combat.js        Melee combat: hit detection, damage, weapon wear, gore particles
js/icons.js         Monochrome SVG icons (used instead of emoji)
js/input.js         Keyboard and mouse
js/touch.js         On-screen touch controls + device detection
```

**Testing tab:** press **Esc** → **TESTING**, or use the hotkeys while playing:

| Key | Tool |
|---|---|
| **N** / **T** | Become nighttime / daytime |
| **M** | Spawn an entity (pick the type in the dropdown) |
| **J** | Spawn a jumpscare (pick the type) |
| **B** | Spawn a trapped bed in front of you |
| **G** | Guide to the nearest saferoom |
| **K** | Give a test kit (materials, meds, noisemakers, weapons, a key) |
| **H** | Heal and refill all stats |
| — | Teleport to a room type (holes, sunken, Christmas, Poolrooms, flooded, cubicles, pillars, vent ladder) |

Turn them all off for release by setting `DEBUG.testTools = false` in `js/config.js`.

**Graphics:** **Settings → GRAPHICS…** has presets (Low / Medium / High / Ultra) and individual settings: render resolution, pixel density, number of real lights, light range, view distance, fog, texture filtering, flashlight shadows, anti-aliasing and the FPS counter.

**Night darkness:** `CYCLE.nightAmbient` and `NIGHT_LIGHTS` in `js/config.js`.

**Tweaking:** almost every gameplay number lives in `js/config.js`.

### Performance notes

- The world is streamed in 24 m chunks. At most one or two are built per frame. Room textures are generated in the background while you're on the menu.
- Each chunk's surfaces are merged into one mesh per material, with **baked lighting** stored per vertex (day + night), so rooms get soft light pools without extra lights. Ceiling lights are one instanced mesh. Whole chunks are culled against the camera frustum.
- Props are hidden beyond about 28 m, where fog hides them anyway.
- Only a small pool of real point lights exists (Graphics → Lights at once). It's reassigned every frame to the most important lights within the light range.
- Entities more than about 44 m away skip AI and animation.
- If you drop below 40 FPS, pick the **Low** graphics preset or lower the render resolution.
