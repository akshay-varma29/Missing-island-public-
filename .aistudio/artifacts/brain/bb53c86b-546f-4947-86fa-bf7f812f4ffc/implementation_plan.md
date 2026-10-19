# IslandEngine Performance Audit & Modular Decomposition Plan

This plan presents a full performance inspection of the 3,895-line monolithic engine (`IslandSurvivalEngine`), catalogs every function responsible for terrain, trees, rocks, vegetation, and water, identifies GPU draw-call and CPU frame-time bottlenecks, maps out subsystem dependencies, and proposes a safe, zero-regression modular architecture that preserves all gameplay, world coordinates, 3D physics, camera modes, and mobile controls.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **No source files have been modified.** Review the findings and proposed decomposition below and click **Proceed** (or share adjustments) when you are ready to execute the refactoring and performance optimizations.

- **Zero Gameplay or Coordinate Drift**: All world coordinates (`(0, 66)` beach spawn, `(0, 0)` volcano caldera, `(-12.5, 34)` waterfall, Stage 2 lakes/rivers, and 20 km island bounds), deterministic terrain height/color formulas, 3D animal physics, 3rd-person/aerial cameras, and mobile joystick/touch controls remain 100% identical.
- **Public API Compatibility**: `IslandSurvivalEngine` keeps its exact constructor signature and public methods so `App.tsx` and browser verification tests work without breaking changes.

---

## 1. Inventory of Functions: Terrain, Trees, Rocks, Vegetation & Water

### A. Terrain System
| Function / Method | Responsibility & Current Behavior |
| :--- | :--- |
| `buildIslandTerrain()` | Initializes the shared procedural bump texture (`createOrganicBumpTexture(128)`), `MeshStandardMaterial` (`vertexColors: true`), the permanent high-resolution `sanctuaryCoreMesh` (`220m × 220m`, `148×148` inner segments on desktop / `112×112` headless), and pre-allocates mesh pools for **9 Near LOD 0 chunks** (`220m`), **8 Mid LOD 1 chunks** (`660m`), and **8 Far LOD 2 chunks** (`1980m`). |
| `populateChunkGeometry(geo, centerX, centerZ, size, innerSegs, skirtDepth)` | Loops over `(innerSegs + 3)²` vertices per chunk, computing `groundHeightAt(wx, wz)` **5 times per vertex** (center + 4 finite-difference neighbors `hL, hR, hD, hU` for analytical normals) and `evaluateTerrainColor()` once per vertex, then uploads position, normal, UV, and color buffers to the GPU. |
| `evaluateTerrainColor(x, z, y, outColor)` | Computes vertex colors across the core sanctuary (`r < 96m`: wet sand, dry sand, jungle loam/moss, dirt trails, stream bed, basalt, lava glow) and the Stage 2 20 km island (`getStage2HydrologyAt`, `grassColorVariationAt`, hill/mountain granite/alpine gradients). |
| `updateTerrainLODChunks(px, pz, force)` | Rebuilds LOD 0, LOD 1, and LOD 2 chunk geometries whenever the focal point crosses a 660m macro-chunk (`activeMx/Mz`) or 1,980m regional (`activeRx/Rz`) boundary. |

### B. Trees, Rocks & Undergrowth Vegetation
| Function / Method | Responsibility & Current Behavior |
| :--- | :--- |
| `populateFloraAndBeachProps()` | Orchestrates all static trees, cliff ledges, beach boulders, shells, shipwreck timber, instanced undergrowth, and atmospheric flora. |
| `buildCoconutPalmTree(scale, lean)` | Generates **44 coastal palm trees** along `r = 56..70m` (ringed curved trunk segments, 9 arching fronds with leaflet blades, 4 coconuts), merged into `staticIslandGroup`. |
| `buildGrandCanopyTree(scale)` | Generates **14 giant rainforest canopy trees** (sculpted trunk, 5 buttress roots, 6 boughs, 10 sculpted foliage crown clusters across 4 materials, 8 hanging lianas), merged into `staticIslandGroup`. |
| `buildJungleTree(scale)` | Generates **56 mid-tier rainforest trees** across `r = 33..52m` (trunk, root flares, 3 branches, 5 foliage crown clusters across 3 materials), merged into `staticIslandGroup`. |
| **Waterfall Cliff Ledges, Stepping Stones & Beach Boulders** | Inside `populateFloraAndBeachProps()`: creates **8 sculpted basalt/mossy cliff ledges** framing the waterfall, **4 river stepping stones**, **1 mossy log bridge** (`buildFallenLog`), **36 coastal basalt boulders**, and **18 spiral conch shells** on the southern beach, all merged into `bakedStaticEnvironment` via `bakeGroupByMaterial()`. |
| **Instanced Undergrowth & Ground Props** | Creates **5 `THREE.InstancedMesh` batches** inside `populateFloraAndBeachProps()`:<br>1. `fernInstanced` (**130 ferns** via `createMasterFernGeometry`)<br>2. `bushInstanced` (**85 broadleaf bushes** via `createMasterBushGeometry`)<br>3. `rockInstanced` (**95 stream-bank stones & forest boulders** via `createMasterRockGeometry`)<br>4. `understoryInstanced` (**40 slender shade palms** via `createMasterUnderstoryPalmGeometry`)<br>5. `logInstanced` (**16 mossy fallen logs** via `createMasterFallenLogGeometry`) |
| `buildBioluminescentMushroomCluster(scale)` | Spawns **8 unmerged `THREE.Group` clusters** (each containing 4 stalks + 4 caps = **64 individual meshes**) along damp logs and riverbanks. |

### C. Water, Ocean, Lakes, Rivers & Atmospheric Effects
| Function / Method | Responsibility & Current Behavior |
| :--- | :--- |
| `buildOceanAndWaves()` | Creates the horizon ocean `PlaneGeometry(6400, 6400, 12, 12)`, `shorelineFoamMesh` (`buildShorelineSurfFoam`), and `waterfallSplashGroup` (`buildWaterfallSplashRings` — 3 concentric ring meshes). |
| `buildFreshwaterStreamWaterMesh()` | Builds `freshwater_stream_ribbon` (animated vertex-color ribbon from `z = 37..68.5m`) and `waterfall_cascade_mesh` (stepped waterfall curtain at `x = -12.5, z = 33..37.2m`). |
| `buildStage2LakesAndRiversMesh()` | Builds a single merged `BufferGeometry` for all **6 Stage 2 freshwater lakes** (West Mirror Lake, East Oasis Lake, North West/East Alpine Tarns, Macro West/East Basins) and **5 Stage 2 flowing rivers** across the map. |
| `updateOceanAndLavaAnimation(elapsed, dt)` | Animates ocean tide bobbing, lava emissive pulse, volcano `smokeInstanced` (32 instances) and `emberInstanced` (48 instances), **per-vertex CPU wave displacement on `streamRibbonMesh`** (`175 vertices` updated every frame), `waterfallMistInstanced` (20 instances), `jungleSporeInstanced` (36 instances), `shorelineFoamMesh` scale/opacity, and `waterfallSplashGroup` ring scales. |

---

## 2. Identified Performance & Draw-Call Bottlenecks

### Bottleneck 1: Uninstanced Bioluminescent Mushrooms & God Rays (~70 Extra Draw Calls + Per-Frame Scene Graph Traversal)
- **Where**: `populateFloraAndBeachProps()` (lines 1540–1560) and `updateDayNightEnvironment()` (lines 3681–3693).
- **Problem**:
  - Each of the 8 `buildBioluminescentMushroomCluster()` calls creates an unmerged `THREE.Group` with **8 separate child `Mesh` objects** (4 stalks + 4 caps) = **64 individual draw calls** for tiny ground details.
  - Worse, **every single frame** inside `updateDayNightEnvironment()`, the engine runs `shroom.traverse((child) => ...)` across all 8 groups to mutate `child.material.emissiveIntensity`, even though all mushrooms share the exact same cached `shroom_cap_cyan` and `shroom_cap_amber` materials!
  - Similarly, `buildVolumetricGodRays()` creates **6 separate transparent cone meshes** sharing `volumetric_god_ray_mat` instead of merging them into 1 static geometry.
- **Fix**:
  - Merge or bake mushroom clusters (or convert into 3 `InstancedMesh` / baked material groups) and update `shroom_cap_cyan.emissiveIntensity` and `shroom_cap_amber.emissiveIntensity` **directly on the 2 shared cached materials in $O(1)$ time** instead of traversing 64 scene nodes every frame.
  - Merge the 6 static god-ray cones into **1 draw call**.

### Bottleneck 2: Unbatched Static Resource Pickups (~50–70 Draw Calls)
- **Where**: `populateInteractableResources()` & `registerInteractable()` (lines 1771–1864) + `updateWildlifeAndBirds()` (lines 3599–3621).
- **Problem**:
  - The engine spawns **46 interactable items** (coconuts, driftwood bundles, papaya/banana clusters, rope coils, campfires, supply crate, boat shipyard).
  - Even after `bakeGroupByMaterial()`, each individual coconut (`2 materials`), wood bundle (`2 materials`), food cluster (`3 materials`), and rope coil (`1 material`) is its own separate `THREE.Group` in the scene graph (**~85 individual `THREE.Mesh` objects**), and the engine loops through all 46 items every frame to distance-cull and spin them.
- **Fix**:
  - Keep hero interactables (`supply_box`, `boat_site`, 3 `campfires`) as individual groups, and batch or cache shared geometries for standard pickups (`coconut`, `wood`, `food`, `rope`) while maintaining exact pickup IDs, positions, and spin/visibility behavior.

### Bottleneck 3: Duplicate Uncached Materials Inside `populateFloraAndBeachProps()` Breaking Material Consolidation
- **Where**: `populateFloraAndBeachProps()` (lines 1050–1188).
- **Problem**:
  - While `worldBuilders.ts` uses `getCachedMaterial()`, `populateFloraAndBeachProps()` in `IslandEngine.ts` creates **7 brand-new ad-hoc `MeshStandardMaterial` instances** (`wetBasaltMat`, `mossyRockMat`, `riverRockMat`, `rockMat`, `shellMat`, `timberMat`, `sailMat`).
  - Because `bakeGroupByMaterial(staticIslandGroup)` groups by `THREE.Material` reference identity, these ad-hoc materials cannot merge with the existing bark, rock, or fabric materials in `worldBuilders.ts`, adding **7 unnecessary full-island shadow-casting draw calls**.
- **Fix**:
  - Move those materials into the shared material cache in `worldBuilders.ts` (or consolidate identical rock/wood PBR materials) so `bakeGroupByMaterial` merges them into fewer draw calls.

### Bottleneck 4: Synchronous Terrain Chunk Rebuild Frame Spikes (`populateChunkGeometry`)
- **Where**: `populateChunkGeometry()` (lines 598–664) & `updateTerrainLODChunks()` (lines 757–847).
- **Problem**:
  - Each vertex in `populateChunkGeometry` calls `groundHeightAt(wx, wz)` **5 times** (1 center + 4 finite-difference samples `hL, hR, hD, hU`) plus `evaluateTerrainColor()` (which itself calls `getStage2HydrologyAt()`, `lavaChannelProximity()`, `jungleTrailProximity()`, `freshwaterStreamInfo()`).
  - When crossing a chunk boundary, rebuilding **9 Near LOD 0 chunks + 8 Mid LOD 1 chunks + 8 Far LOD 2 chunks** in a single frame evaluates `groundHeightAt()` **~110,000+ times synchronously**, causing a noticeable frame-time spike.
  - Additionally, in **Aerial View**, `updatePlayerMovement()` currently does not update `updateTerrainLODChunks(this.devState.targetX, this.devState.targetZ)` when panning far across the 20 km island, and the ocean plane (`6400×6400`) and camera `far` plane (`3200`) clip when viewing the 20 km island from high altitude.
- **Fix**:
  - **Reuse Grid Heights for Normals**: First compute `surfaceY = groundHeightAt(wx, wz)` into a reusable flat `Float32Array` grid for the chunk, then derive interior vertex normals directly from adjacent grid neighbors `(grid[col-1] - grid[col+1], 2 * step, grid[row-1] - grid[row+1])`! This cuts `groundHeightAt()` calls during chunk generation by **~75% (from 5 calls/vertex down to 1 call/vertex)** while keeping border normals exact.
  - **Fast-Path `evaluateTerrainColor` & `getStage2HydrologyAt`**: Skip expensive inner-sanctuary stream/trail/lava checks when `r > 96m`, and use a bounding-box pre-check before iterating all 6 lakes and 5 river polyline segments in `getStage2HydrologyAt(x, z)`.
  - **Aerial LOD & Horizon Alignment**: Update terrain LOD chunks around the active camera focus (`devState.targetX/Z` in aerial mode, `playerPos.x/z` in 3rd-person) and ensure the ocean plane and camera `far` plane cover high-altitude 20 km aerial views cleanly.

### Bottleneck 5: Per-Frame CPU Vertex Buffer Upload on `streamRibbonMesh` and Unculled Particle Systems
- **Where**: `updateOceanAndLavaAnimation()` (lines 3318–3418).
- **Problem**:
  - Every frame, regardless of whether the player is near the stream or 5 km away, the CPU loops over all 175 vertices of `streamRibbonMesh`, recomputes `Math.pow(1 - t, 1.35)` and `Math.sin(...)`, and sets `pos.needsUpdate = true` (forcing a WebGL buffer sub-data upload every frame).
  - Similarly, `waterfallMistInstanced` (20 instances at `(-11.5, 37.5)`) and `jungleSporeInstanced` (36 instances in `r = 34..54m`) update all instance matrices and upload them to the GPU every frame even when the camera is far away or in high-altitude satellite view.
- **Fix**:
  - Precompute the static `baseY` array for `streamRibbonMesh` once at creation (eliminating `Math.pow()` per vertex per frame), and distance-gate CPU vertex/instance matrix updates for `streamRibbonMesh`, `waterfallMistInstanced`, and `jungleSporeInstanced` when the camera is > 140m away.

### Bottleneck 6: Wildlife & Bird Multi-Mesh Draw Calls (~210 Draw Calls)
- **Where**: `populateWildlifeAndBirds()` (lines 1563–1769).
- **Problem**:
  - 26 ground wildlife actors (8 crabs, 6 lizards, 6 monkeys, 6 boars) and 15 flying birds = **41 animated actors**. Each actor is a `THREE.Group` with 4–6 child meshes (baked body by material + articulated limbs/wings), totaling **~210 draw calls** when all visible.
  - Currently `wildlifeCullDistSq = 68 * 68` culls ground wildlife by `homeX/homeZ` relative to `playerPos`, which is good, but `birdActors` (15 birds × 4 meshes = 60 draw calls) are **never distance-culled** and their `castShadow` is enabled on small wing/body parts.
- **Fix**:
  - Disable shadow casting on small distant bird meshes, distance-cull birds when the camera is far outside the sanctuary, and base visibility culling on the **active camera target** (so aerial view and 3rd-person view both see wildlife accurately).

---

## 3. Dependency & Coupling Analysis

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              src/App.tsx                                │
│  (React HUD, Geographical Map, Backpack Modal, Joystick & Action Btns)  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ instantiates & calls public API
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   src/game/IslandEngine.ts (Coordinator)                │
│  Owns WebGLRenderer, Scene, Camera, GameState, PlayerVitals, Inventory  │
└───┬───────────────┬───────────────┬───────────────┬─────────────────┬───┘
    │               │               │               │                 │
    ▼               ▼               ▼               ▼                 ▼
┌──────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────┐
│terrain.ts│  │  flora.ts  │  │  water.ts  │  │inputCamera.ts│  │actors.ts │
│LOD Chunks│  │Trees,Rocks,│  │Ocean,Lakes,│  │3rd-Person,   │  │Castaway, │
│& Vertex  │  │Undergrowth,│  │Rivers,Lava,│  │Aerial View & │  │Wildlife, │
│Colors    │  │Mushrooms   │  │Particles   │  │Mobile Touch  │  │Pickups   │
└────┬─────┘  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  └────┬─────┘
     │              │               │                │               │
     └──────────────┴───────────────┼────────────────┴───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             Shared Pure Logic & Procedural Asset Foundations            │
│  • src/game/rules.ts         (Terrain height, biomes, hydrology, AI)    │
│  • src/game/worldBuilders.ts (Procedural 3D geometries & PBR materials) │
│  • src/game/developerMode.ts (Aerial presets, camera math, fog curve)   │
│  • src/game/audio.ts         (Web Audio procedural soundscape)          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Dependencies to Preserve
1. **External Dependencies**:
   - `three` (`THREE.WebGLRenderer`, `Scene`, `PerspectiveCamera`, `InstancedMesh`, `BufferGeometry`, `MeshStandardMaterial`, etc.)
   - `three/addons/environments/RoomEnvironment.js`
   - `three/addons/utils/BufferGeometryUtils.js` (`mergeGeometries` in `worldBuilders.ts`)
2. **Internal Module Dependencies**:
   - **`./rules`**: Pure deterministic math (`groundHeightAt`, `getStage2HydrologyAt`, `freshwaterStreamInfo`, `lavaChannelProximity`, `jungleTrailProximity`, `stepPlayerVitals`, `stepAnimalPhysics`, `resolvePlayerMeleeAttack`, `findNearestInteractable`, `stepCameraOrbit`, etc.).
   - **`./worldBuilders`**: Procedural mesh generators and shared material/texture caches (`bakeGroupByMaterial`, `buildCastawayCharacter`, `buildCoconutPalmTree`, `buildGrandCanopyTree`, `buildJungleTree`, `buildStage2LakesAndRiversMesh`, `createMaster*Geometry`, etc.).
   - **`./developerMode`**: Pure aerial camera state, presets, interpolation, and fog density math.
   - **`./audio`**: `IslandAudioEngine` for footsteps, ocean surf, stream/waterfall ambience, pickup chimes, and lava sizzle.
3. **DOM & Test Hooks**:
   - `window.__islandEngine` debug reference used by automated Playwright browser verification.
   - `document.body.dataset.state` (`'title' | 'playing' | 'paused' | 'gameover'`).
   - `HudSnapshot` contract consumed by `src/App.tsx`.

---

## 4. Recommended Modular Split Strategy

To make the codebase clean, fast, and maintainable without risking any regression in coordinates, physics, camera feel, or mobile controls, we recommend splitting `IslandEngine.ts` (3,895 lines) into **5 focused modules** under `src/game/`:

### 1. Terrain & Chunk LOD Module (`TerrainSystem`)
- **Extracted From**: `evaluateTerrainColor`, `populateChunkGeometry`, `buildIslandTerrain`, `updateTerrainLODChunks`, and the terrain vertex color palette.
- **Enhancements**:
  - Implements the **1-sample-per-vertex height grid cache** inside `populateChunkGeometry` (cutting `groundHeightAt()` calls by ~75% during chunk updates).
  - Fast-paths `evaluateTerrainColor` for `r > 96m` and adds bounding-box pre-filtering to `getStage2HydrologyAt`.
  - Updates LOD chunks around the active camera focus (`playerPos` in 3rd-person, `devState.targetX/Z` in aerial view).

### 2. Flora, Trees, Rocks & Undergrowth Module (`FloraSystem`)
- **Extracted From**: `populateFloraAndBeachProps` (44 coconut palms, 14 grand canopy trees, 56 jungle trees, waterfall cliff ledges, log footbridge, stepping stones, 36 coastal boulders, 18 conch shells, shipwreck timber, 5 instanced undergrowth meshes, volumetric god rays, and bioluminescent mushrooms).
- **Enhancements**:
  - Consolidates rock, timber, and shell materials into shared cached materials to reduce baked static draw calls.
  - Merges the 6 god-ray cones into a single mesh and updates bioluminescent mushroom emissive intensity directly on the 2 shared cap materials ($O(1)$ per frame instead of `traverse()` over 64 meshes).

### 3. Water, Ocean, Volcano & Atmosphere Module (`WaterAndAtmosphereSystem`)
- **Extracted From**: `buildOceanAndWaves`, `buildVolcanoLavaAndParticles`, `updateOceanAndLavaAnimation`, `updateDayNightEnvironment`, freshwater stream ribbon, waterfall cascade, Stage 2 lakes & rivers mesh, shoreline surf foam, waterfall splash rings, smoke/ember/mist/spore `InstancedMesh` systems.
- **Enhancements**:
  - Precomputes static `baseY` values on `streamRibbonMesh` and distance-gates CPU vertex/particle matrix uploads when the camera is far away.
  - Expands ocean horizon coverage and camera far plane so both ground-level 3rd-person and high-altitude 20 km aerial views render seamlessly.

### 4. Wildlife, Birds & Interactables Module (`ActorsAndPickupsSystem`)
- **Extracted From**: `populateWildlifeAndBirds`, `populateInteractableResources`, `registerInteractable`, `syncBoatShipyardMesh`, `updateWildlifeAndBirds`, and castaway rig articulation (`animateCastawayRig`).
- **Enhancements**:
  - Distance-culls birds and pickups relative to the active camera focus, disables unnecessary shadow casting on small bird segments, and preserves exact combat knockback, habitat rules, supply crate wave drift, and 3-stage boat construction.

### 5. Core Engine Coordinator, Input & Camera (`IslandEngine.ts`)
- **Retains**: `IslandSurvivalEngine` class shell, `HudSnapshot` & `IslandEngineCallbacks` exports, WebGLRenderer lifecycle, keyboard/mouse/touch/pinch/joystick input bindings (`bindEvents`), 3rd-person & Developer Aerial camera transitions, player movement/swimming/jump physics (`updatePlayerMovement`), combat/interaction triggers (`triggerAttack`, `triggerInteract`), and `broadcastHud`.
- **Guarantee**: All coordinates, physics constants, camera damping, and mobile touch/joystick handlers remain 100% intact.
