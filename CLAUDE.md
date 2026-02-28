# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tavern Dice** — a medieval-themed 3D RPG dice roller web app. Single-page, no build system, no bundler. Pure HTML/CSS/JS served as static files.

## Running

Open `index.html` directly in a browser, or use any static file server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step, no dependencies to install. All libraries load via CDN import maps.

## Architecture

The entire app lives in three files:

- **`index.html`** — DOM structure, CDN import map for Three.js and cannon-es
- **`script.js`** — All application logic (~1200 lines, single ES module)
- **`style.css`** — Styling with responsive breakpoints at 900px and 480px

### Dependencies (CDN via import map)

- **Three.js v0.160** — 3D rendering (scene, camera, renderer, OrbitControls)
- **cannon-es** (latest) — Physics simulation (gravity, collisions, sleep detection)

### script.js Organization

The file is organized in sequential sections (marked with `// ---` comment headers):

1. **Configuration** (`config` object) — tuning constants (max dice, settle thresholds, colors, ad frequency)
2. **DOM Elements** — cached references to all interactive elements
3. **Power Bar System** — oscillating power/spin meter UI with state machine (`idle` → `power` → `spin` → `done`)
4. **Sound System** — procedural Web Audio API sounds (dice hits, roll tumble, settle chime) with collision throttling
5. **State** — global scene/physics variables, rolling state, camera animation state
6. **Texture/Number Functions** — canvas-based texture generation for dice face labels
7. **Dice Geometry** — `diceData` registry mapping d4/d6/d8/d10/d100/d12/d20 to Three.js geometries, CANNON shapes, and colors
8. **Dice Creation** — `createDie()` factory builds paired Three.js mesh + CANNON body; d4 and d6 have special handling
9. **Rolling Logic** — `handleRollClick()` manages ad interrupts and delegates to `rollDice()` which spawns/launches dice with force/torque scaled by power/spin
10. **Animation Loop** — physics stepping, settlement detection (velocity threshold × frame count), camera lerp transitions
11. **Result Calculation** — `readDieValue()` determines face-up value via dot product of face normals against world-up vector; d4 uses highest-vertex method instead
12. **Ad Logic** — interstitial ad shown every N rolls, blocks roll until dismissed

### Key Patterns

- **Dice value detection**: Each die stores `userData.faceData` (array of `{normal, value}`) on the Three.js mesh. Result reading transforms face normals by the die's world quaternion and picks the one most aligned with up. d4 is a special case using vertex positions instead.
- **d6 uses multi-material** (one material per box face with baked number textures); all other dice use transparent number planes (`PlaneGeometry`) attached as children of the die mesh.
- **Physics-visual sync**: CANNON body positions/quaternions are copied to Three.js meshes each frame in the animation loop.
- **Cache busting**: `script.js` is loaded with a `?v=` query parameter in `index.html` — increment this when deploying changes.

### Performance Architecture

- **Geometry/Shape caches**: `cachedGeometries`, `cachedShapes`, `cachedGeometricFaces` — built once at module load, shared across all dice instances
- **Texture caches**: `numberTextureCache`, `faceTextureCache` — pre-baked at module load via IIFE, avoids canvas rasterization per roll
- **Object pool**: `dicePool` + `acquireDie()` — reuses Three.js meshes and CANNON bodies across rolls; `clearDice()` releases to pool without disposing
- **Shadow toggle**: `directionalLight.castShadow` disabled during active roll, re-enabled on settlement
- **Settle threshold**: 30 frames (was 80) — ~0.5s of near-stillness before result read

### Fonts

- **MedievalSharp** (Google Fonts) — headers, buttons, UI labels
- **Open Sans** (Google Fonts) — numeric results, body text

## Multi-Agent Coordination

When multiple AI agents (Claude Code, Windsurf, Cursor, etc.) work on this project simultaneously:

### Domain boundaries in script.js
- **Config + DOM** (lines 1-50): UI agent
- **Power bars** (lines 50-120): UI agent
- **Sound system** (lines 120-220): Sound agent
- **Textures + geometry** (lines 240-470): Physics/rendering agent
- **Scene init + walls** (lines 460-670): Physics agent
- **Dice data + shapes** (lines 670-770): Physics agent
- **Caches + object pool** (lines 770-920): Physics agent
- **Dice creation + rolling** (lines 920-1030): Physics agent
- **Clear + animation loop** (lines 1030-1160): Physics agent
- **Results + value reading** (lines 1160-1250): Physics agent
- **URL/share/localStorage** (lines 1250+): Feature agent

### Rules
1. Before modifying script.js, check git status for uncommitted changes from another agent
2. Prefer working on non-overlapping line ranges
3. If another agent recently committed changes to your target area, pull first
4. Use feature branches or worktrees when possible for parallel work
5. Commit frequently with descriptive messages so other agents understand changes
