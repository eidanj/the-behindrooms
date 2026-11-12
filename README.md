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

| Key | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Look |
| **Shift** | Sprint (+20% speed, needs Hunger ≥ 35 and Energy > 0) |
| **Space** | Jump |
| **E** | Interact: search drawers, pick up, unlock saferooms, sleep, portal |
| **L** | Flashlight on/off |
| **R** | Replace flashlight battery |
| **1–6 / mouse wheel** | Select item. Press 1–6 again to cycle food or drink types |
| **Left click** | Use held item (eat, drink, throw, toggle flashlight) |
| **Right click** | Drop a banana peel at your feet |
| **Esc** | Pause |

## How it plays

- **Day (10 min):** bright fluorescent lights and calm music. Entities are very rare (1 in 50 rooms) and only follow you slowly.
- **Dusk:** the lights flicker violently, then the power dies.
- **Night (6 min):** about half the rooms go completely dark and the rest keep one (rarely 2–3) dim light, the music turns tense, and entities are common. They're **blind** and hunt by **sound**. Walking can be heard from 5–20 ft away and sprinting from 10–35 ft (each entity hears a little differently). With **line of sight** at night they sprint 5–10% faster than your walk, so sprint away.
- **Escaping:** break line of sight and survive 20 seconds to escape a chase and earn **+1 ★**.
- **Saferooms:** locked rooms entities can't enter. Keys come from drawers (8%). 15% have a **bed** that lets you sleep through the night. At night the bed may be **trapped**. Listen for breathing and look for a bulge with a limb sticking out. Sleeping in it kills you. **Jump on it 4 times** (within about 7 seconds of the first hit) to squash the monster for **+1 ★**.
- **Rocks:** throw to make noise and lure entities, or hit one to trip it. **Banana peels:** throw or drop them, and chasing entities that step on one slip and fall.
- **Stars:** walking into camp banks the stars you carry. If you die, carried stars are lost (Easy keeps half).

### Survival stats

| Stat | Rules |
|---|---|
| **Sanity** (100) | −1 / 2 min (day), −1 / 30 s (night), −1 / 5 s near an entity. Hunger < 35: −1 / 15 s. Hunger ≥ 35: +1 / 30 s (not near monsters). Faster recovery in camp. <50 grey tint and you tire faster, <30 black vignette, <10 violent flicker. Reaching 0 kills you. |
| **Hunger** (100) | −1 per 10 s walking, −3 per 10 s sprinting, paused when standing still. You can't sprint below 35. |
| **Energy** (20) | −1 per minute walking, −1 per 15 s sprinting. At 0 you're exhausted (slower, no sprint). Stand still to slowly recover. |
| **Flashlight** | Each battery lasts 5 minutes. |

### Loot

Filing cabinets appear in about 30% of rooms on Normal (44% Easy, 21% Hard).

Drawer contents (Normal): 20% battery · 15% drink · 10% food · 8% saferoom key · 47% empty.

| Item | Effect |
|---|---|
| Bread (60% of food) | +4–8 Hunger |
| Granola Bar (35% of food) | +5–9 Hunger |
| Cookie (5% of food) | +3–6 Hunger, +0–2 Energy, permanent +0.5% speed (max +5%) |
| Coffee (20% of drinks) | +5 Hunger, +2 Energy, +15% speed for 30 s, then a 10 s crash (−10% speed, dimmer vision) |
| Energy Drink (15% of drinks) | +2–4 Hunger, +4 Energy, +20% speed for 45 s, then a 10 s crash (−15% speed, dimmer vision) |
| Almond Water (65% of drinks) | +3 Hunger, +1 Energy, +8 Sanity |

### Difficulty

- **Easy:** no jumpscares, quieter audio, brighter nights, fewer entities that are 8% slower, more loot, slower stat drain.
- **Normal:** the standard experience.
- **Hard:** intense audio, an 8% chance of a jumpscare when spotted or caught, faster stat drain, scarcer loot.

---

## Project structure

```
index.html          UI screens, HUD, overlays
css/style.css       All styling (VHS / found-footage look)
lib/                Three.js (r187, bundled locally) + license
js/config.js        ← all tuning numbers: speeds, timers, difficulty, quality presets
js/main.js          Game loop, state machine, events, death/win
js/world.js         Infinite chunked maze, collision, line-of-sight, pathfinding, lighting pool
js/cycle.js         Day/night timeline and lighting factors
js/entities.js      Monster AI (hearing, sight, chase, escape) and animation
js/player.js        Movement, head-bob, stats, flashlight, item use
js/items.js         Item definitions, inventory, thrown rocks and banana peels
js/hands.js         First-person hand and held-item viewmodel
js/audio.js         Procedural Web Audio: music, breathing, SFX
js/textures.js      Procedural canvas textures and shared materials
js/models.js        Primitive-built 3D models (cabinets, beds, tents, portal, creature…)
js/geo.js           Geometry merger for walls and floors
js/ui.js            DOM HUD, hotbar, compass, toasts, screen effects
js/tutorial.js      Interactive tutorial steps
js/guide.js         Test tool: arrow trail to the nearest saferoom
js/input.js         Keyboard and mouse
```

**Test tools:** press **Esc** to pause, then use the **Test tools** panel, or press the hotkey while playing:

| Key | Tool |
|---|---|
| **N** | Become nighttime. Jumps to just before nightfall, so the flicker and power cut still play. |
| **T** | Become daytime. Skips to morning. |
| **M** | Spawn a monster 6–16 m away, in view if possible. |
| **G** | Guide to the nearest saferoom with floor arrows, a beacon over the door and a compass marker. Press again to turn it off. |

Turn them all off for release by setting `DEBUG.testTools = false` in `js/config.js`.

**Night darkness:** `NIGHT_LIGHTS` in `js/config.js` controls how many rooms go fully dark at night and how bright the remaining lights are.

**Tweaking:** almost every gameplay number lives in `js/config.js`, including day/night length, speeds, hearing radii, difficulty presets and graphics quality presets.

### Performance notes

- The world is streamed in 24 m chunks. Chunks outside the load radius are disposed, and at most one or two are built per frame to avoid hitches.
- Each chunk's walls, floor and ceiling are merged into a few meshes, and ceiling lights are a single instanced mesh. Whole chunks are culled against the camera frustum.
- Props (cabinets, beds, rocks) are hidden beyond about 26 m, where fog hides them anyway.
- Only a small pool of real point lights exists (4–8 depending on quality). It's reassigned every frame to the most important lights within `lightRange` (24–38 m), and lights fade in near the edge of that range.
- Entities more than about 44 m away skip AI and animation. Their breathing audio only exists within 30 m.
- If you drop below 40 FPS, set **Settings → Graphics quality** to **Low**.
