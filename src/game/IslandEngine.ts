import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  groundHeightAt,
  lavaChannelProximity,
  isLavaHazardAt,
  getBiomeZoneAt,
  isSwimmingAt,
  stepPlayerVitals,
  collectResource,
  consumeProvision,
  canLightCampfire,
  evaluateDayNightCycle,
  getISTTimeState,
  findNearestInteractable,
  computeTargetMoveSpeed,
  computeSupplyBoxDriftPosition,
  openSupplyCrate,
  advanceBoatConstruction,
  getBoatStageRequirement,
  resolvePlayerMeleeAttack,
  getBackpackStorageState,
  canStoreInBackpack,
  dropBackpackItem,
  DEFAULT_BACKPACK_CAPACITY,
  stepCameraOrbit,
  camYawToCompassDegrees,
  BiomeZone,
  DayPhase,
  Inventory,
  PlayerVitals,
  InteractableItem,
  MovementGait,
  BoatBuildStage,
  CampfireSiteInfo,
  WATER_LEVEL,
  EXPANDED_ISLAND_RADIUS,
  WORLD_BOUNDARY_RADIUS,
  getExpandedCoastlineRadius,
  grassColorVariationAt,
  freshwaterStreamInfo,
  freshwaterStreamX,
  jungleTrailProximity,
  drinkFreshwater,
  createAnimalPhysicsState,
  applyAnimalKnockback,
  stepAnimalPhysics,
  getStage2HydrologyAt,
} from './rules';
import {
  bakeGroupByMaterial,
  createOrganicBumpTexture,
  sculptOrganicGeometry,
  buildCastawayCharacter,
  buildCoconutPalmTree,
  buildJungleTree,
  buildGrandCanopyTree,
  buildJungleBush,
  buildFallenLog,
  buildJungleUnderstoryPalm,
  buildFreshwaterStreamWaterMesh,
  buildStage2LakesAndRiversMesh,
  createMasterFernGeometry,
  createMasterBushGeometry,
  createMasterFallenLogGeometry,
  createMasterUnderstoryPalmGeometry,
  createMasterRockGeometry,
  buildJungleFern,
  buildBeachCrab,
  buildJungleLizard,
  buildJungleMonkey,
  buildWildBoar,
  buildBird,
  buildInteractableMesh,
  buildVolumetricGodRays,
  buildShorelineSurfFoam,
  buildWaterfallSplashRings,
  buildBioluminescentMushroomCluster,
  CastawayRig,
  WildlifeActor,
  BirdActor,
} from './worldBuilders';

import { IslandAudioEngine } from './audio';

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export interface HudSnapshot {
  state: GameState;
  vitals: PlayerVitals;
  inventory: Inventory;
  biome: BiomeZone;
  dayPhase: DayPhase;
  clockLabel: string;
  istClockWithSeconds: string;
  istDateLabel: string;
  isRealTimeIST: boolean;
  timeOfDay: number;
  isSwimming: boolean;
  inLava: boolean;
  nearbyPrompt: string | null;
  statusToast: string | null;
  campfiresLit: number;
  totalCampfires: number;
  daysSurvived: number;
  resourcesCollected: number;
  victory: boolean;
  gait: MovementGait;
  isBending: boolean;
  joystickX: number;
  joystickY: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  camYaw?: number;
  camCompassDeg?: number;
  volcanoX: number;
  volcanoZ: number;
  campfires: CampfireSiteInfo[];
  boatStage: BoatBuildStage;
  supplyBoxOpened: boolean;
  supplyBoxPos: { x: number; z: number; isAshore: boolean };
  boatPos: { x: number; z: number };
  creaturesDefeated: number;
  nearbyCreature: { label: string; hp: number; maxHp: number } | null;
  questObjective: string;
}


export interface IslandEngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
}

// Pre-allocated scratch vectors for zero-GC render loop
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const _color = new THREE.Color();
const _skyNoon = new THREE.Color(0x5bb8ff);
const _skyGolden = new THREE.Color(0xf48c56);
const _skyNight = new THREE.Color(0x132a4a);

// Pre-allocated terrain vertex color palette for zero-GC chunk population
const _sandColor = new THREE.Color(0xe6c88c);
const _wetSandColor = new THREE.Color(0xb8965c);
const _grassLight = new THREE.Color(0x3a8742);
const _grassDeep = new THREE.Color(0x1e5628);
const _grassSunOlive = new THREE.Color(0x5a9e3e);
const _grassTurf = new THREE.Color(0x2d6e36);
const _duneGrass = new THREE.Color(0x7fa052);
const _basaltRock = new THREE.Color(0x3a3532);
const _scorchedRim = new THREE.Color(0x241d1a);
const _lavaGlow = new THREE.Color(0xff4500);
const _dirtTrail = new THREE.Color(0x7c5333);
const _streamBed = new THREE.Color(0x2d4c46);
const _wetWaterfallRock = new THREE.Color(0x22302d);
const _darkLoam = new THREE.Color(0x23381e);
const _richJungleSoil = new THREE.Color(0x2d4c25);
const _emeraldMoss = new THREE.Color(0x33692b);
const _deepMoss = new THREE.Color(0x1b4319);
const _riverbankMoss = new THREE.Color(0x2a5c34);
const _mountainGranite = new THREE.Color(0x4b4844);
const _alpineRidge = new THREE.Color(0x8c8780);
const _expScratchColor = new THREE.Color();
const _coastalTempColor = new THREE.Color();

export class IslandSurvivalEngine {
  private container: HTMLElement;
  private callbacks: IslandEngineCallbacks;
  private isHeadless: boolean;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private calderaLight!: THREE.PointLight;
  private fog!: THREE.FogExp2;

  private audio = new IslandAudioEngine();

  // Character & world entities
  private castaway!: CastawayRig;
  private oceanMesh!: THREE.Mesh;
  private terrainMat!: THREE.MeshStandardMaterial;
  private sanctuaryCoreMesh!: THREE.Mesh;
  private nearLodChunks: THREE.Mesh[] = [];
  private nearLodInnerSegs = 28;
  private midLodChunks: THREE.Mesh[] = [];
  private midLodInnerSegs = 18;
  private farLodChunks: THREE.Mesh[] = [];
  private farLodInnerSegs = 14;
  private currentTerrainMx = 9999;
  private currentTerrainMz = 9999;
  private currentTerrainRx = 9999;
  private currentTerrainRz = 9999;
  private lavaCoreMesh!: THREE.Mesh;
  private lavaStreamMeshes: THREE.Mesh[] = [];
  private smokeInstanced!: THREE.InstancedMesh;
  private emberInstanced!: THREE.InstancedMesh;
  private smokeParticles: Array<{
    x: number;
    y: number;
    z: number;
    vy: number;
    vx: number;
    vz: number;
    scale: number;
    life: number;
    maxLife: number;
  }> = [];
  private emberParticles: Array<{
    x: number;
    y: number;
    z: number;
    vy: number;
    vx: number;
    vz: number;
    life: number;
    maxLife: number;
  }> = [];

  // Freshwater stream, waterfall, mist and atmospheric spore particles
  private streamRibbonMesh: THREE.Mesh | null = null;
  private waterfallCascadeMesh: THREE.Mesh | null = null;
  private waterfallMistInstanced!: THREE.InstancedMesh;
  private waterfallMistParticles: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    scale: number;
    life: number;
    maxLife: number;
  }> = [];
  private jungleSporeInstanced!: THREE.InstancedMesh;
  private jungleSporeParticles: Array<{
    x: number;
    y: number;
    z: number;
    baseY: number;
    phase: number;
    speed: number;
  }> = [];

  // Realistic environmental atmosphere & water effects
  private godRaysGroup: THREE.Group | null = null;
  private shorelineFoamMesh: THREE.Mesh | null = null;
  private waterfallSplashGroup: THREE.Group | null = null;
  private bioluminescentShrooms: THREE.Group[] = [];

  private wildlifeActors: WildlifeActor[] = [];
  private birdActors: BirdActor[] = [];
  private interactables: InteractableItem[] = [];
  private interactableMeshes = new Map<string, THREE.Group>();

  // Simulation & Player physics state
  private gameState: GameState = 'title';
  private victory = false;
  private playerPos = new THREE.Vector3(0, 1.2, 66);
  private playerVel = new THREE.Vector3(0, 0, 0);
  private playerYaw = 0; // Facing North (-Z toward volcano at 0,0)
  private camYaw = 0;
  private camPitch = 0.28;
  private camDist = 6.4;
  private camYawVel = 0;
  private camPitchVel = 0;
  private isGrounded = true;
  private jumpBufferTimer = 0;
  private coyoteTimer = 0;
  private walkCycleDist = 0;
  private stepSoundDist = 0;
  private cameraTrauma = 0;
  private lavaSoundCooldown = 0;

  // Vitals, Inventory & Time
  private vitals: PlayerVitals = {
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    hunger: 100,
    maxHunger: 100,
    thirst: 100,
    maxThirst: 100,
  };
  private inventory: Inventory = {
    coconuts: 1,
    wood: 0,
    food: 0,
    rope: 0,
    hasKnife: false,
    hasRope: false,
    hasMap: false,
  };
  private boatStage: BoatBuildStage = 0;
  private supplyBoxOpened = false;
  private supplyBoxShorePos = { x: -8.5, z: 62.5 };
  private boatSitePos = { x: 6.2, z: 65.5 };
  private creaturesDefeated = 0;
  private attackAnimTimer = 0;
  private useRealTimeIST = true;
  private timeOfDay = getISTTimeState().normalizedTime;
  private lastISTDateLabel = getISTTimeState().dateLabel;
  private daysSurvived = 1;
  private resourcesCollected = 0;
  private campfiresLit = 0;
  private statusToast: string | null = null;
  private toastTimer = 0;

  // Input state
  private keysHeld = new Set<string>();
  private keysJustPressed = new Set<string>();
  private isPointerLocked = false;
  private isDraggingLook = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lookPointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private isTouchRotating = false;
  private gait: MovementGait = 'walk';
  private isBending = false;
  private joystickX = 0;
  private joystickY = 0;

  // Loop & lifecycle
  private animFrameId = 0;
  private lastFrameTime = performance.now();
  private elapsedSimTime = 0;
  private lastHudBroadcast = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, callbacks: IslandEngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isHeadless =
      navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);

    this.initScene();
    this.buildIslandTerrain();
    this.buildOceanAndWaves();
    this.buildVolcanoLavaAndParticles();
    this.populateFloraAndBeachProps();
    this.populateWildlifeAndBirds();
    this.populateInteractableResources();
    this.initPlayer();
    this.bindEvents();

    // Pre-compile shaders once
    this.renderer.compile(this.scene, this.camera);
    this.updateDayNightEnvironment(0);
    this.broadcastHud(true);
    (window as unknown as { __islandEngine?: IslandSurvivalEngine }).__islandEngine = this;
    this.startLoop();
  }

  private initScene(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isHeadless,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(
      this.isHeadless ? 1 : Math.min(window.devicePixelRatio, 1.5)
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isHeadless;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6ec6ff);
    // Atmospheric fog tuned for multi-kilometer island horizon
    this.fog = new THREE.FogExp2(0x7ec8e3, 0.00045);
    this.scene.fog = this.fog;

    // Studio RoomEnvironment reflection map
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.5, 3200);

    // Warm/Cool Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d5a35, 0.75);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d0, 2.2);
    this.sunLight.position.set(55, 78, 45);
    this.sunLight.castShadow = !this.isHeadless;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 210;
    const d = 85;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Glowing molten caldera point light at volcano crater
    this.calderaLight = new THREE.PointLight(0xff4500, 5.5, 58, 1.5);
    this.calderaLight.position.set(0, 29, 0);
    this.scene.add(this.calderaLight);
  }

  /**
   * Evaluates vertex color (r, g, b) at world coordinates (x, z, y).
   * - Preserves the core sanctuary's sandy beach, wet sand, jungle moss, dirt trails, stream bed,
   *   and volcanic basalt/lava glow inside the central sanctuary.
   * - Covers the expanded 10 km radius (20 km diameter) landmass with natural green grass,
   *   subtle multi-scale grass tonal variations, and a natural outer sandy coastline.
   */
  private evaluateTerrainColor(x: number, z: number, y: number, outColor: THREE.Color): void {
    const r = Math.hypot(x, z);

    const sandColor = _sandColor;
    const wetSandColor = _wetSandColor;
    const grassLight = _grassLight;
    const grassDeep = _grassDeep;
    const grassSunOlive = _grassSunOlive;
    const grassTurf = _grassTurf;
    const duneGrass = _duneGrass;
    const basaltRock = _basaltRock;
    const scorchedRim = _scorchedRim;
    const lavaGlow = _lavaGlow;
    const dirtTrail = _dirtTrail;
    const streamBed = _streamBed;
    const wetWaterfallRock = _wetWaterfallRock;

    // 1. Inside or near the core sanctuary (r < 96), evaluate core coloration
    if (r < 96) {
      const lavaProx = lavaChannelProximity(x, z);
      const trailProx = jungleTrailProximity(x, z);
      const streamInfo = freshwaterStreamInfo(x, z);

      if (lavaProx > 0.35) {
        outColor.lerpColors(scorchedRim, lavaGlow, Math.min(1, (lavaProx - 0.35) * 1.6));
      } else if (y < 0.3) {
        outColor.copy(wetSandColor);
      } else if (y < 2.35) {
        const t = Math.max(0, Math.min(1, (y - 0.3) / 2.05));
        outColor.lerpColors(wetSandColor, sandColor, t);
      } else if (y < 8.6 && r > 30) {
        const t = Math.max(0, Math.min(1, (y - 2.35) / 6.25));
        outColor.lerpColors(grassLight, grassDeep, t);
      } else if (r < 17) {
        outColor.copy(scorchedRim);
      } else {
        const t = Math.max(0, Math.min(1, (y - 8.6) / 14));
        outColor.lerpColors(grassDeep, basaltRock, t);
      }

      if (z >= 20 && z <= 69 && x >= -33 && x <= 22 && lavaProx <= 0.28 && y > 1.8 && y < 9.2) {
        const soilNoise = Math.sin(x * 0.72 + z * 0.54) * Math.cos(x * 0.48 - z * 0.82);
        const mossNoise = Math.sin(x * 0.36 - z * 0.44) * 0.5 + 0.5;
        const groundBase = soilNoise > 0.15 ? _darkLoam : _richJungleSoil;
        const mossTone = mossNoise > 0.4 ? _emeraldMoss : _deepMoss;
        outColor.lerp(groundBase, 0.42);
        outColor.lerp(mossTone, mossNoise * 0.58);
      }

      if (trailProx > 0 && lavaProx <= 0.3) {
        outColor.lerp(dirtTrail, trailProx * 0.82);
      }

      if (streamInfo.distToStream < 3.2 && z >= 32.5 && z <= 68.5) {
        const st = Math.max(0, 1 - streamInfo.distToStream / 3.2);
        if (streamInfo.isWaterfall) {
          outColor.lerp(wetWaterfallRock, st * 0.95);
        } else if (streamInfo.distToStream < 1.15) {
          outColor.lerp(streamBed, st * 0.92);
        } else {
          outColor.lerp(_riverbankMoss, st * 0.84);
        }
      }

      if (r <= 74) {
        // Apply Stage 2 lake/river bed & shore coloration inside outer sanctuary fringe (r > 40)
        if (r > 40) {
          const hydro = getStage2HydrologyAt(x, z);
          if (hydro.inWater) {
            outColor.lerp(streamBed, 0.88);
          } else if (hydro.nearShore) {
            outColor.lerp(sandColor, hydro.bedBlend * 0.65);
          }
        }
        return;
      }
    }

    // 2. Stage 2 Expanded Island Coloration: Extended Beach, Hills, Mountains, Lakes & Rivers
    const expColor = _expScratchColor;
    const hydro = getStage2HydrologyAt(x, z);

    if (hydro.inWater) {
      expColor.lerpColors(wetSandColor, streamBed, 0.82);
    } else if (y < 0.35) {
      expColor.copy(wetSandColor);
    } else if (y < 2.38) {
      const t = Math.max(0, Math.min(1, (y - 0.35) / 2.03));
      expColor.lerpColors(wetSandColor, sandColor, t);
    } else {
      const { lushness, sunWarmth, microTone } = grassColorVariationAt(x, z);
      expColor.lerpColors(grassDeep, grassLight, lushness);
      expColor.lerp(grassSunOlive, sunWarmth * 0.46);
      expColor.lerp(grassTurf, (1 - microTone) * 0.34);

      // Stage 2 Hills (y = 10..26m) & Rugged Mountain Peaks (y > 26m)
      if (y > 10.0) {
        const hillFactor = Math.max(0, Math.min(1, (y - 10.0) / 15.0));
        expColor.lerp(grassSunOlive, hillFactor * 0.35);
      }
      if (y > 22.0) {
        const rockFactor = Math.max(0, Math.min(1, (y - 22.0) / 18.0));
        expColor.lerp(_mountainGranite, rockFactor * 0.88);
      }
      if (y > 42.0) {
        const alpineFactor = Math.max(0, Math.min(1, (y - 42.0) / 26.0));
        expColor.lerp(_alpineRidge, alpineFactor * 0.72);
      }

      // Stage 2 Lake & Riverbank sandy-moss shore transition
      if (hydro.nearShore) {
        _coastalTempColor.lerpColors(_riverbankMoss, sandColor, 0.55);
        expColor.lerp(_coastalTempColor, hydro.bedBlend * 0.78);
      }

      // Extended Coastal Dune transition between sandy beach (y=2.38) and full grassland (y=3.25)
      if (y < 3.25) {
        const coastBlend = Math.max(0, Math.min(1, (y - 2.38) / 0.87));
        _coastalTempColor.lerpColors(sandColor, duneGrass, Math.min(1, coastBlend * 1.4));
        expColor.lerpColors(_coastalTempColor, expColor, coastBlend);
      }
    }

    if (r < 96) {
      const blendT = Math.max(0, Math.min(1, (r - 74) / 22));
      outColor.lerp(expColor, blendT);
    } else {
      outColor.copy(expColor);
    }
  }

  /**
   * Populates a chunk BufferGeometry with a 1-quad vertical perimeter skirt so adjacent chunks
   * across different LOD tiers (220m Near, 660m Mid, 1980m Far) join with zero cracks or seams.
   */
  private populateChunkGeometry(
    geo: THREE.BufferGeometry,
    centerX: number,
    centerZ: number,
    size: number,
    innerSegs: number,
    skirtDepth = 3.2
  ): void {
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const normAttr = geo.attributes.normal as THREE.BufferAttribute;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
    let colorAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colorAttr) {
      colorAttr = new THREE.BufferAttribute(new Float32Array(posAttr.count * 3), 3);
      geo.setAttribute('color', colorAttr);
    }

    const gridCols = innerSegs + 3;
    let idx = 0;

    for (let row = 0; row < gridCols; row++) {
      const isRowSkirt = row === 0 || row === innerSegs + 2;
      const clampedRow = Math.max(1, Math.min(innerSegs + 1, row)) - 1;
      const v = clampedRow / innerSegs - 0.5;
      const localZ = v * size;
      const wz = centerZ + localZ;

      for (let col = 0; col < gridCols; col++) {
        const isColSkirt = col === 0 || col === innerSegs + 2;
        const clampedCol = Math.max(1, Math.min(innerSegs + 1, col)) - 1;
        const u = clampedCol / innerSegs - 0.5;
        const localX = u * size;
        const wx = centerX + localX;

        const surfaceY = groundHeightAt(wx, wz);
        const wy = isRowSkirt || isColSkirt ? surfaceY - skirtDepth : surfaceY;

        posAttr.setXYZ(idx, localX, wy, localZ);
        uvAttr.setXY(idx, wx / 220, wz / 220);

        // Analytical / central-difference normal so adjacent chunks share identical edge lighting
        const r = Math.hypot(wx, wz);
        const eps = r < 105 ? 0.65 : 2.5;
        const hL = groundHeightAt(wx - eps, wz);
        const hR = groundHeightAt(wx + eps, wz);
        const hD = groundHeightAt(wx, wz - eps);
        const hU = groundHeightAt(wx, wz + eps);
        const nx = hL - hR;
        const ny = 2 * eps;
        const nz = hD - hU;
        const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
        normAttr.setXYZ(idx, nx * invLen, ny * invLen, nz * invLen);

        this.evaluateTerrainColor(wx, wz, surfaceY, _color);
        colorAttr.setXYZ(idx, _color.r, _color.g, _color.b);

        idx++;
      }
    }

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }

  /**
   * Builds the 3-Tier Chunked LOD Terrain System for the 10 km radius (20 km diameter) island:
   * - Tier 0 (Near Player): 3×3 grid of 220m × 220m High-Detail Chunks (+ 136×136 Core Sanctuary Chunk at 0,0)
   * - Tier 1 (Mid Distance): 8 surrounding 660m × 660m Medium-Detail Chunks covering 1,980m × 1,980m
   * - Tier 2 (Far Distance): 11×11 grid of 1,980m × 1,980m Low-Detail Regional Chunks spanning 21.78 km × 21.78 km
   */
  private buildIslandTerrain(): void {
    const bumpTex = createOrganicBumpTexture(128);
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.04,
      bumpMap: bumpTex,
      bumpScale: 0.18,
    });

    // 1. Permanent High-Resolution Core Sanctuary Chunk (ix=0, iz=0 -> [-110, +110] × [-110, +110])
    const coreSegs = this.isHeadless ? 112 : 148;
    const coreGeo = new THREE.PlaneGeometry(220, 220, coreSegs + 2, coreSegs + 2);
    coreGeo.rotateX(-Math.PI / 2);
    this.populateChunkGeometry(coreGeo, 0, 0, 220, coreSegs, 3.2);
    this.sanctuaryCoreMesh = new THREE.Mesh(coreGeo, this.terrainMat);
    this.sanctuaryCoreMesh.name = 'terrain_core_sanctuary';
    this.sanctuaryCoreMesh.receiveShadow = true;
    this.sanctuaryCoreMesh.castShadow = false;
    this.sanctuaryCoreMesh.matrixAutoUpdate = false;
    this.sanctuaryCoreMesh.updateMatrix();
    this.scene.add(this.sanctuaryCoreMesh);

    // 2. Pool of 9 Near-Player LOD 0 Chunks (220m × 220m each -> 660m × 660m high-detail zone)
    this.nearLodInnerSegs = this.isHeadless ? 22 : 34;
    for (let i = 0; i < 9; i++) {
      const geo = new THREE.PlaneGeometry(
        220,
        220,
        this.nearLodInnerSegs + 2,
        this.nearLodInnerSegs + 2
      );
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.name = `terrain_lod0_${i}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.nearLodChunks.push(mesh);
    }

    // 3. Pool of 8 Mid-Distance LOD 1 Chunks (660m × 660m each -> 1,980m × 1,980m mid-detail zone)
    this.midLodInnerSegs = this.isHeadless ? 10 : 18;
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(
        660,
        660,
        this.midLodInnerSegs + 2,
        this.midLodInnerSegs + 2
      );
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.name = `terrain_lod1_${i}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.midLodChunks.push(mesh);
    }

    // 4. Pool of 8 Far-Distance LOD 2 Regional Chunks (1,980m × 1,980m each -> 5,940m × 5,940m horizon zone)
    this.farLodInnerSegs = this.isHeadless ? 8 : 14;
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.PlaneGeometry(
        1980,
        1980,
        this.farLodInnerSegs + 2,
        this.farLodInnerSegs + 2
      );
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.name = `terrain_lod2_${i}`;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.scene.add(mesh);
      this.farLodChunks.push(mesh);
    }

    // Initial LOD chunk assignment around starting beach (0, 66)
    this.updateTerrainLODChunks(0, 66, true);
  }

  /**
   * Dynamically updates the 3-tier nested chunk hierarchy when the player crosses a 660m macro-chunk boundary.
   * Ensures high detail near the player and lower detail for distant terrain with zero overlap and constant memory.
   */
  private updateTerrainLODChunks(px: number, pz: number, force = false): void {
    const nearIx = THREE.MathUtils.clamp(Math.round(px / 220), -53, 53);
    const nearIz = THREE.MathUtils.clamp(Math.round(pz / 220), -53, 53);
    const activeMx = THREE.MathUtils.clamp(Math.floor((nearIx + 1) / 3), -18, 18);
    const activeMz = THREE.MathUtils.clamp(Math.floor((nearIz + 1) / 3), -18, 18);
    const activeRx = THREE.MathUtils.clamp(Math.floor((activeMx + 1) / 3), -6, 6);
    const activeRz = THREE.MathUtils.clamp(Math.floor((activeMz + 1) / 3), -6, 6);

    if (
      !force &&
      activeMx === this.currentTerrainMx &&
      activeMz === this.currentTerrainMz &&
      activeRx === this.currentTerrainRx &&
      activeRz === this.currentTerrainRz
    ) {
      return;
    }

    const regionChanged =
      force || activeRx !== this.currentTerrainRx || activeRz !== this.currentTerrainRz;

    this.currentTerrainMx = activeMx;
    this.currentTerrainMz = activeMz;
    this.currentTerrainRx = activeRx;
    this.currentTerrainRz = activeRz;

    // 1. Populate the 8 LOD 2 (1,980m × 1,980m) surrounding regional chunks when activeRx/activeRz changes
    if (regionChanged) {
      let farPoolIdx = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue; // Subdivided into LOD 1 + LOD 0 below
          const rx = activeRx + dx;
          const rz = activeRz + dz;
          const mesh = this.farLodChunks[farPoolIdx++];
          if (!mesh) continue;
          const cx = rx * 1980;
          const cz = rz * 1980;
          this.populateChunkGeometry(mesh.geometry, cx, cz, 1980, this.farLodInnerSegs, 4.5);
          mesh.position.set(cx, 0, cz);
          mesh.updateMatrixWorld();
          mesh.visible = true;
        }
      }
    }

    // 2. Populate the 8 LOD 1 (660m × 660m) sibling chunks inside (activeRx, activeRz)
    let midPoolIdx = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const mx = activeRx * 3 + dx;
        const mz = activeRz * 3 + dz;
        if (mx === activeMx && mz === activeMz) {
          continue; // Subdivided into 9 LOD 0 near chunks below
        }
        const mesh = this.midLodChunks[midPoolIdx++];
        if (!mesh) continue;
        const cx = mx * 660;
        const cz = mz * 660;
        this.populateChunkGeometry(mesh.geometry, cx, cz, 660, this.midLodInnerSegs, 3.8);
        mesh.position.set(cx, 0, cz);
        mesh.updateMatrixWorld();
        mesh.visible = true;
      }
    }

    // 3. Populate the 9 LOD 0 (220m × 220m) high-detail near chunks inside (activeMx, activeMz)
    this.sanctuaryCoreMesh.visible = activeMx === 0 && activeMz === 0;
    let nearPoolIdx = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = activeMx * 3 + dx;
        const iz = activeMz * 3 + dz;
        const mesh = this.nearLodChunks[nearPoolIdx++];
        if (!mesh) continue;

        if (ix === 0 && iz === 0) {
          // Covered by the high-resolution permanent sanctuaryCoreMesh
          mesh.visible = false;
          continue;
        }

        const cx = ix * 220;
        const cz = iz * 220;
        this.populateChunkGeometry(mesh.geometry, cx, cz, 220, this.nearLodInnerSegs, 3.2);
        mesh.position.set(cx, 0, cz);
        mesh.updateMatrixWorld();
        mesh.visible = true;
      }
    }
  }

  private buildOceanAndWaves(): void {
    // Opaque horizon-spanning ocean plane (avoids full-screen alpha overdraw on mobile & software GPUs)
    const oceanGeo = new THREE.PlaneGeometry(6400, 6400, 12, 12);
    oceanGeo.rotateX(-Math.PI / 2);

    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0b7285,
      roughness: 0.2,
      metalness: 0.14,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.position.y = WATER_LEVEL;
    this.oceanMesh.receiveShadow = false;
    this.scene.add(this.oceanMesh);

    // Realistic coastal surf foam fringe along southern beach shelf
    this.shorelineFoamMesh = buildShorelineSurfFoam();
    this.scene.add(this.shorelineFoamMesh);

    // Dynamic expanding plunge pool ripples at the waterfall basin
    this.waterfallSplashGroup = buildWaterfallSplashRings();
    this.scene.add(this.waterfallSplashGroup);
  }

  private buildVolcanoLavaAndParticles(): void {
    // Central molten caldera pool inside the crater
    const calderaGeo = new THREE.CircleGeometry(9.8, 28);
    calderaGeo.rotateX(-Math.PI / 2);
    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff5500,
      emissive: 0xff3300,
      emissiveIntensity: 2.4,
      roughness: 0.25,
    });
    this.lavaCoreMesh = new THREE.Mesh(calderaGeo, lavaMat);
    this.lavaCoreMesh.position.set(0, 22.8, 0);
    this.lavaCoreMesh.matrixAutoUpdate = false;
    this.lavaCoreMesh.updateMatrix();
    this.scene.add(this.lavaCoreMesh);

    // 6 glowing lava stream ribbons down the volcano slopes merged into 1 static draw call
    const streamAngles = [0.65, 2.35, -0.85, -2.25, 1.32, 1.82];
    const lavaStreamsRaw = new THREE.Group();
    for (const baseAngle of streamAngles) {
      const points: THREE.Vector3[] = [];
      for (let r = 8.5; r <= 41.5; r += 2.2) {
        const meander = Math.sin(r * 0.26) * 0.11;
        const a = baseAngle + meander;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = groundHeightAt(x, z) + 0.25;
        points.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, 24, 1.45, 6, false);
      const streamMesh = new THREE.Mesh(tubeGeo, lavaMat);
      lavaStreamsRaw.add(streamMesh);
    }
    const bakedStreams = bakeGroupByMaterial(lavaStreamsRaw, false, false);
    this.scene.add(bakedStreams);

    // Smoke plume InstancedMesh (32 rising volumetric smoke puffs)
    const smokeCount = 32;
    const smokeGeo = new THREE.DodecahedronGeometry(1.6, 1);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x454545,
      roughness: 0.95,
      transparent: true,
      opacity: 0.55,
    });
    this.smokeInstanced = new THREE.InstancedMesh(smokeGeo, smokeMat, smokeCount);
    this.smokeInstanced.frustumCulled = false;
    this.scene.add(this.smokeInstanced);

    for (let i = 0; i < smokeCount; i++) {
      this.smokeParticles.push({
        x: (Math.random() - 0.5) * 6,
        y: 23 + Math.random() * 34,
        z: (Math.random() - 0.5) * 6,
        vy: 2.2 + Math.random() * 1.6,
        vx: 0.35 + (Math.random() - 0.5) * 0.4,
        vz: (Math.random() - 0.5) * 0.4,
        scale: 0.8 + Math.random() * 2.4,
        life: Math.random() * 10,
        maxLife: 8 + Math.random() * 5,
      });
    }

    // Glowing Embers InstancedMesh (48 rising sparks)
    const emberCount = 48;
    const emberGeo = new THREE.OctahedronGeometry(0.24, 0);
    const emberMat = new THREE.MeshBasicMaterial({
      color: 0xff9100,
    });
    this.emberInstanced = new THREE.InstancedMesh(emberGeo, emberMat, emberCount);
    this.emberInstanced.frustumCulled = false;
    this.scene.add(this.emberInstanced);

    for (let i = 0; i < emberCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.random() * 18;
      this.emberParticles.push({
        x: Math.cos(a) * rad,
        y: 16 + Math.random() * 26,
        z: Math.sin(a) * rad,
        vy: 3.5 + Math.random() * 3.0,
        vx: (Math.random() - 0.5) * 1.4,
        vz: (Math.random() - 0.5) * 1.4,
        life: Math.random() * 5,
        maxLife: 3.5 + Math.random() * 2.5,
      });
    }
  }

  private populateFloraAndBeachProps(): void {
    const staticIslandGroup = new THREE.Group();

    // 1. Coconut Palm Trees along the beach & coastal border (44 palms)
    for (let i = 0; i < 44; i++) {
      const angle = (i / 44) * Math.PI * 2 + (i % 3) * 0.04;
      // Keep direct spawn corridor at (0, 66) open and well-framed
      if (Math.abs(angle - Math.PI / 2) < 0.08) continue;

      const r = 56 + (i % 5) * 3.4;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (getStage2HydrologyAt(x, z).nearShore) continue;
      const y = groundHeightAt(x, z);
      if (y < 0.35) continue;

      const scale = 0.85 + (i % 4) * 0.12;
      const palm = buildCoconutPalmTree(scale, 0.14 + (i % 3) * 0.06);
      palm.position.set(x, y - 0.1, z);
      palm.rotation.y = angle + Math.PI * 0.5;
      staticIslandGroup.add(palm);
    }

    // 2. Grand Rainforest Canopy Giant Trees (14 towering ancient trees with fluted buttress roots & hanging lianas)
    const grandCanopyCoords = [
      { x: -18.0, z: 42.0, scale: 1.15 },
      { x: -24.0, z: 38.0, scale: 1.1 },
      { x: 9.0, z: 36.0, scale: 1.12 },
      { x: 19.0, z: 40.0, scale: 1.18 },
      { x: -7.5, z: 52.0, scale: 1.05 },
      { x: 12.0, z: 54.0, scale: 1.08 },
      { x: -21.0, z: 52.0, scale: 1.1 },
      { x: 22.0, z: 48.0, scale: 1.14 },
      { x: -6.0, z: 36.0, scale: 1.05 },
      { x: 7.0, z: 48.0, scale: 1.1 },
      { x: 15.0, z: 34.0, scale: 1.06 },
      { x: -16.5, z: 60.0, scale: 1.0 },
      { x: 20.0, z: 35.0, scale: 1.12 },
      { x: -27.0, z: 46.0, scale: 1.15 },
    ];
    grandCanopyCoords.forEach((pt, i) => {
      const y = groundHeightAt(pt.x, pt.z);
      const grandTree = buildGrandCanopyTree(pt.scale);
      grandTree.position.set(pt.x, y - 0.2, pt.z);
      grandTree.rotation.y = i * 1.35;
      staticIslandGroup.add(grandTree);
    });

    // 3. Dense Tropical Trees (56 mid-tier rainforest trees distributed through the jungle)
    for (let i = 0; i < 56; i++) {
      const angle = (i / 56) * Math.PI * 2 + (i % 5) * 0.08;
      const r = 33 + (i % 6) * 3.8;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      // Keep southern dirt trail, beach spawn, clearings, Stage 2 lakes/rivers, and lava clear
      if (jungleTrailProximity(x, z) > 0.45) continue;
      if (Math.hypot(x - 0, z - 44) < 6.8) continue; // Jungle ridge campfire clearing
      if (Math.hypot(x - (-11), z - 40) < 5.8) continue; // Waterfall grotto clearing
      if (Math.hypot(x - 14, z - 46) < 6.2) continue; // Fruit grove clearing
      if (freshwaterStreamInfo(x, z).distToStream < 2.8) continue;
      if (getStage2HydrologyAt(x, z).nearShore) continue;
      if (lavaChannelProximity(x, z) > 0.2) continue;

      const y = groundHeightAt(x, z);
      const scale = 0.85 + (i % 5) * 0.14;
      const tree = buildJungleTree(scale);
      tree.position.set(x, y - 0.15, z);
      tree.rotation.y = i * 1.1;
      staticIslandGroup.add(tree);
    }

    // 4. Freshwater Stream, Waterfall & Stage 2 Lakes and Rivers across the map
    const streamGroup = buildFreshwaterStreamWaterMesh();
    this.streamRibbonMesh = streamGroup.getObjectByName('freshwater_stream_ribbon') as THREE.Mesh;
    this.waterfallCascadeMesh = streamGroup.getObjectByName('waterfall_cascade_mesh') as THREE.Mesh;
    this.scene.add(streamGroup);

    const stage2WaterGroup = buildStage2LakesAndRiversMesh();
    this.scene.add(stage2WaterGroup);

    // Stepped Basalt Cliff Ledges framing the Waterfall at (-12.5, 34) down to plunge pool (-11, 40)
    const bumpTex = createOrganicBumpTexture(256);
    const wetBasaltMat = new THREE.MeshStandardMaterial({
      color: 0x242322,
      bumpMap: bumpTex,
      bumpScale: 0.12,
      roughness: 0.65,
      metalness: 0.15,
    });
    const mossyRockMat = new THREE.MeshStandardMaterial({
      color: 0x384534,
      bumpMap: bumpTex,
      bumpScale: 0.1,
      roughness: 0.85,
      metalness: 0.04,
    });

    const cliffLedges = [
      { x: -14.2, y: 10.8, z: 33.0, sx: 3.2, sy: 3.8, sz: 2.8, r: 0.2 },
      { x: -10.2, y: 10.5, z: 33.2, sx: 2.9, sy: 3.6, sz: 2.6, r: -0.25 },
      { x: -15.0, y: 8.4, z: 35.5, sx: 3.4, sy: 3.2, sz: 2.9, r: 0.4 },
      { x: -9.5, y: 8.2, z: 35.8, sx: 3.1, sy: 3.0, sz: 2.7, r: -0.3 },
      { x: -13.8, y: 6.2, z: 38.5, sx: 2.8, sy: 2.4, sz: 2.6, r: 0.15 },
      { x: -8.8, y: 6.0, z: 38.8, sx: 2.9, sy: 2.5, sz: 2.7, r: -0.2 },
      { x: -12.8, y: 5.6, z: 41.2, sx: 2.6, sy: 1.8, sz: 2.5, r: 0.35 },
      { x: -9.2, y: 5.4, z: 41.5, sx: 2.7, sy: 1.9, sz: 2.4, r: -0.15 },
    ];
    cliffLedges.forEach((c, idx) => {
      const ledgeGeo = sculptOrganicGeometry(
        new THREE.DodecahedronGeometry(1.6, 2),
        0.18,
        2.2,
        idx * 2.1
      );
      ledgeGeo.scale(c.sx * 0.6, c.sy * 0.5, c.sz * 0.6);
      const ledge = new THREE.Mesh(ledgeGeo, idx % 2 === 0 ? wetBasaltMat : mossyRockMat);
      ledge.position.set(c.x, c.y, c.z);
      ledge.rotation.set(c.r * 0.5, idx * 0.8, c.r);
      staticIslandGroup.add(ledge);
    });

    // Natural Mossy Log Footbridge spanning across the freshwater stream at z=47.5
    const bridgeZ = 47.5;
    const bridgeX = freshwaterStreamX(bridgeZ);
    const bridgeY = groundHeightAt(bridgeX, bridgeZ) + 0.15;
    const bridgeLog = buildFallenLog(4.2, 0.32);
    bridgeLog.position.set(bridgeX, bridgeY, bridgeZ);
    // Orient perpendicular to the stream's south-flowing direction so it spans from west bank to east bank
    bridgeLog.rotation.y = 0.08;
    staticIslandGroup.add(bridgeLog);

    // River Stepping Stones across the stream at z=44.5 and z=50.5
    const riverRockMat = new THREE.MeshStandardMaterial({
      color: 0x42403d,
      bumpMap: bumpTex,
      bumpScale: 0.08,
      roughness: 0.82,
    });
    for (const sz of [44.5, 50.8]) {
      const sxCenter = freshwaterStreamX(sz);
      for (const offset of [-0.65, 0.65]) {
        const sx = sxCenter + offset;
        const stoneGeo = sculptOrganicGeometry(new THREE.DodecahedronGeometry(0.38, 1), 0.15, 3.2, sx + sz);
        stoneGeo.scale(1.2, 0.5, 1.1);
        const stone = new THREE.Mesh(stoneGeo, riverRockMat);
        const sy = groundHeightAt(sx, sz) + 0.14;
        stone.position.set(sx, sy, sz);
        staticIslandGroup.add(stone);
      }
    }

    // 5. Sculpted Coastal Basalt Boulders, Conch Shells & Shipwreck Debris on the Southern Beach
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x56524e,
      bumpMap: bumpTex,
      bumpScale: 0.08,
      roughness: 0.86,
      metalness: 0.05,
    });
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xfff0db,
      roughness: 0.28,
      metalness: 0.08,
    });
    shellMat.userData.noShadow = true;

    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r = 64 + (i % 4) * 3.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Keep immediate player spawn footprint at (0, 66) and Stage 2 lake/river beds open
      if (Math.hypot(x, z - 66) < 3.2) continue;
      if (getStage2HydrologyAt(x, z).inWater) continue;

      const y = groundHeightAt(x, z);
      const rockGeo = sculptOrganicGeometry(
        new THREE.IcosahedronGeometry(0.65 + (i % 3) * 0.45, 2),
        0.2,
        2.8,
        i * 1.7
      );
      const rock = new THREE.Mesh(rockGeo, i % 3 === 0 ? mossyRockMat : rockMat);
      rock.scale.set(1.25, 0.72, 1.05);
      rock.position.set(x, y + 0.12, z);
      rock.rotation.set(i * 0.3, i * 0.8, 0);
      staticIslandGroup.add(rock);

      // Scatter spiral conch shells on the sand near rocks
      if (i % 2 === 0) {
        const shellGeo = sculptOrganicGeometry(
          new THREE.ConeGeometry(0.18, 0.36, 10),
          0.12,
          5.0,
          i
        );
        const shell = new THREE.Mesh(shellGeo, shellMat);
        shell.rotation.z = Math.PI / 2 - 0.2;
        shell.rotation.y = i;
        const sx = x + 1.4;
        const sz = z + 0.9;
        shell.position.set(sx, groundHeightAt(sx, sz) + 0.08, sz);
        staticIslandGroup.add(shell);
      }
    }

    // Shipwrecked broken hull timber & torn sail mast on the Southern Beach beside spawn (-7.5, y, 68.5)
    const wreckGroup = new THREE.Group();
    const timberMat = new THREE.MeshStandardMaterial({
      color: 0x4e342e,
      bumpMap: bumpTex,
      bumpScale: 0.05,
      roughness: 0.9,
    });
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xd7ccc8,
      bumpMap: bumpTex,
      bumpScale: 0.02,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    // Keel spine
    const keel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 0.34), timberMat);
    keel.position.set(0, 0.18, 0);
    wreckGroup.add(keel);

    // Curved hull ribs
    for (let r = -2; r <= 2; r++) {
      for (const side of [-1, 1]) {
        const rib = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.12, 1.85, 8),
          timberMat
        );
        rib.position.set(r * 0.85, 0.65, side * 0.72);
        rib.rotation.x = side * -0.48;
        wreckGroup.add(rib);
      }
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.19, 4.9, 10), timberMat);
    mast.position.set(0, 1.85, 0.2);
    mast.rotation.z = 0.38;
    wreckGroup.add(mast);

    const yardarm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.8, 8), timberMat);
    yardarm.position.set(-0.55, 2.85, 0.25);
    yardarm.rotation.x = Math.PI / 2;
    yardarm.rotation.z = 0.25;
    wreckGroup.add(yardarm);

    const tornSailGeo = sculptOrganicGeometry(new THREE.PlaneGeometry(2.4, 1.8, 8, 8), 0.12, 2.5, 4.2);
    const tornSail = new THREE.Mesh(tornSailGeo, sailMat);
    tornSail.position.set(-0.6, 2.25, 0.3);
    tornSail.rotation.y = 0.4;
    tornSail.rotation.z = 0.38;
    wreckGroup.add(tornSail);

    const wx = -7.5;
    const wz = 68.5;
    wreckGroup.position.set(wx, groundHeightAt(wx, wz) - 0.1, wz);
    wreckGroup.rotation.y = 0.45;
    staticIslandGroup.add(wreckGroup);

    // Merge static hero trees, rocks, shells, and shipwreck into single draw calls
    const bakedStaticEnvironment = bakeGroupByMaterial(staticIslandGroup, true, true);
    this.scene.add(bakedStaticEnvironment);

    // =========================================================================
    // 6. ANDROID-OPTIMIZED INSTANCED MESHES FOR DENSE JUNGLE UNDERGROWTH
    // 400+ lush tropical vegetation & ground instances packed into only 5 GPU draw calls!
    // =========================================================================

    // (A) Instanced Ferns (130 instances across the jungle floor)
    const fernGeo = createMasterFernGeometry();
    const fernMat = new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.52,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    fernMat.userData.noShadow = true;
    const fernInstanced = new THREE.InstancedMesh(fernGeo, fernMat, 130);
    fernInstanced.receiveShadow = true;
    fernInstanced.castShadow = false;

    const fernColors = [
      new THREE.Color(0x2e7d32),
      new THREE.Color(0x388e3c),
      new THREE.Color(0x43a047),
      new THREE.Color(0x27672a),
    ];

    let fernIdx = 0;
    for (let i = 0; i < 130; i++) {
      const a = (i / 130) * Math.PI * 2 + (i % 7) * 0.15;
      const r = 31 + (i % 8) * 3.8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (lavaChannelProximity(x, z) > 0.22) continue;
      if (getStage2HydrologyAt(x, z).inWater) continue;
      // Frame clearings and stream banks without encroaching on paths
      if (Math.hypot(x - 0, z - 44) < 3.2) continue; // Campfire center
      if (jungleTrailProximity(x, z) > 0.8) continue; // Trail center

      const y = groundHeightAt(x, z);
      const s = 0.75 + (i % 5) * 0.12;
      _dummyObj.position.set(x, y - 0.04, z);
      _dummyObj.rotation.set(0, i * 1.2, 0);
      _dummyObj.scale.set(s, s * 0.9, s);
      _dummyObj.updateMatrix();
      fernInstanced.setMatrixAt(fernIdx, _dummyObj.matrix);
      fernInstanced.setColorAt(fernIdx, fernColors[i % fernColors.length]);
      fernIdx++;
    }
    fernInstanced.count = fernIdx;
    fernInstanced.computeBoundingSphere();
    if (fernInstanced.instanceColor) fernInstanced.instanceColor.needsUpdate = true;
    this.scene.add(fernInstanced);

    // (B) Instanced Tropical Broadleaf Bushes (85 instances)
    const bushGeo = createMasterBushGeometry();
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0x226b27,
      roughness: 0.55,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    bushMat.userData.noShadow = true;
    const bushInstanced = new THREE.InstancedMesh(bushGeo, bushMat, 85);
    bushInstanced.receiveShadow = true;
    bushInstanced.castShadow = false;

    const bushColors = [
      new THREE.Color(0x1e6123),
      new THREE.Color(0x2e752c),
      new THREE.Color(0x388a36),
    ];

    let bushIdx = 0;
    for (let i = 0; i < 85; i++) {
      const a = (i / 85) * Math.PI * 2 + 0.35;
      const r = 34 + (i % 7) * 4.1;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (lavaChannelProximity(x, z) > 0.2) continue;
      if (getStage2HydrologyAt(x, z).inWater) continue;
      if (jungleTrailProximity(x, z) > 0.5) continue;
      if (Math.hypot(x - 0, z - 44) < 5.2) continue;
      if (Math.hypot(x - (-11), z - 40) < 4.8) continue;

      const y = groundHeightAt(x, z);
      const s = 0.8 + (i % 4) * 0.16;
      _dummyObj.position.set(x, y - 0.05, z);
      _dummyObj.rotation.set(0, i * 1.5, 0);
      _dummyObj.scale.set(s, s * 0.95, s);
      _dummyObj.updateMatrix();
      bushInstanced.setMatrixAt(bushIdx, _dummyObj.matrix);
      bushInstanced.setColorAt(bushIdx, bushColors[i % bushColors.length]);
      bushIdx++;
    }
    bushInstanced.count = bushIdx;
    bushInstanced.computeBoundingSphere();
    if (bushInstanced.instanceColor) bushInstanced.instanceColor.needsUpdate = true;
    this.scene.add(bushInstanced);

    // (C) Instanced River Stones and Forest Boulders (95 instances lining stream and clearings)
    const rockMasterGeo = createMasterRockGeometry();
    const riverRockMasterMat = new THREE.MeshStandardMaterial({
      color: 0x474944,
      bumpMap: bumpTex,
      bumpScale: 0.08,
      roughness: 0.86,
      metalness: 0.05,
    });
    const rockInstanced = new THREE.InstancedMesh(rockMasterGeo, riverRockMasterMat, 95);
    rockInstanced.receiveShadow = true;
    rockInstanced.castShadow = !this.isHeadless;

    const rockColors = [
      new THREE.Color(0x3f423d),
      new THREE.Color(0x4a4d46),
      new THREE.Color(0x56524b),
      new THREE.Color(0x343a32), // mossy
    ];

    let rockIdx = 0;
    // 45 stones lining the freshwater stream banks from z=34 down to z=66
    for (let zi = 34; zi <= 66; zi += 0.72) {
      const streamX = freshwaterStreamX(zi);
      const side = ((Math.floor(zi * 2) % 2) === 0 ? 1 : -1);
      const x = streamX + side * (1.35 + Math.sin(zi * 1.4) * 0.4);
      const y = groundHeightAt(x, zi);
      const s = 0.45 + Math.abs(Math.sin(zi)) * 0.55;

      _dummyObj.position.set(x, y + s * 0.18, zi);
      _dummyObj.rotation.set(zi * 0.3, zi * 0.8, 0);
      _dummyObj.scale.set(s * 1.1, s * 0.7, s * 0.9);
      _dummyObj.updateMatrix();
      rockInstanced.setMatrixAt(rockIdx, _dummyObj.matrix);
      rockInstanced.setColorAt(rockIdx, rockColors[rockIdx % rockColors.length]);
      rockIdx++;
      if (rockIdx >= 95) break;
    }

    // Additional boulders scattered across forest clearings
    for (let i = rockIdx; i < 95; i++) {
      const a = (i / 50) * Math.PI * 2;
      const r = 38 + (i % 5) * 4.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (lavaChannelProximity(x, z) > 0.22) continue;
      if (getStage2HydrologyAt(x, z).inWater) continue;
      if (jungleTrailProximity(x, z) > 0.55) continue;
      if (Math.hypot(x - 0, z - 44) < 4.5) continue;

      const y = groundHeightAt(x, z);
      const s = 0.55 + (i % 4) * 0.22;
      _dummyObj.position.set(x, y + s * 0.2, z);
      _dummyObj.rotation.set(i * 0.4, i * 0.9, 0);
      _dummyObj.scale.set(s * 1.15, s * 0.75, s * 1.0);
      _dummyObj.updateMatrix();
      rockInstanced.setMatrixAt(rockIdx, _dummyObj.matrix);
      rockInstanced.setColorAt(rockIdx, rockColors[i % rockColors.length]);
      rockIdx++;
    }
    rockInstanced.count = rockIdx;
    rockInstanced.computeBoundingSphere();
    if (rockInstanced.instanceColor) rockInstanced.instanceColor.needsUpdate = true;
    this.scene.add(rockInstanced);

    // (D) Instanced Understory Palms (40 slender shade palms)
    const understoryGeo = createMasterUnderstoryPalmGeometry();
    const understoryMat = new THREE.MeshStandardMaterial({
      color: 0x33883b,
      roughness: 0.52,
      side: THREE.DoubleSide,
    });
    understoryMat.userData.noShadow = true;
    const understoryInstanced = new THREE.InstancedMesh(understoryGeo, understoryMat, 40);
    understoryInstanced.receiveShadow = true;
    understoryInstanced.castShadow = false;

    let underIdx = 0;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + 0.18;
      const r = 36 + (i % 6) * 4.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (lavaChannelProximity(x, z) > 0.2) continue;
      if (getStage2HydrologyAt(x, z).nearShore) continue;
      if (jungleTrailProximity(x, z) > 0.5) continue;
      if (Math.hypot(x - 0, z - 44) < 5.5) continue;

      const y = groundHeightAt(x, z);
      const s = 0.75 + (i % 4) * 0.18;
      _dummyObj.position.set(x, y - 0.1, z);
      _dummyObj.rotation.set(0, i * 1.4, 0);
      _dummyObj.scale.set(s, s, s);
      _dummyObj.updateMatrix();
      understoryInstanced.setMatrixAt(underIdx, _dummyObj.matrix);
      underIdx++;
    }
    understoryInstanced.count = underIdx;
    understoryInstanced.computeBoundingSphere();
    this.scene.add(understoryInstanced);

    // (E) Instanced Mossy Fallen Logs (20 logs scattered in jungle clearings)
    const logGeo = createMasterFallenLogGeometry();
    const logMat = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.9,
    });
    const logInstanced = new THREE.InstancedMesh(logGeo, logMat, 20);
    logInstanced.receiveShadow = true;
    logInstanced.castShadow = !this.isHeadless;

    let logIdx = 0;
    const logLocations = [
      { x: -5.5, z: 42.5, ry: 0.45, s: 0.9 },
      { x: 5.8, z: 46.2, ry: -0.65, s: 1.0 },
      { x: -15.5, z: 50.0, ry: 0.85, s: 0.95 },
      { x: 14.5, z: 43.5, ry: -0.32, s: 1.05 },
      { x: -8.0, z: 58.0, ry: 1.15, s: 0.9 },
      { x: 9.0, z: 56.5, ry: -0.85, s: 1.0 },
      { x: -18.5, z: 44.0, ry: 0.25, s: 1.1 },
      { x: 18.0, z: 48.0, ry: -0.55, s: 0.95 },
      { x: -3.5, z: 37.0, ry: 0.75, s: 1.0 },
      { x: 3.8, z: 38.2, ry: -0.4, s: 0.9 },
      { x: -22.0, z: 41.0, ry: 0.92, s: 1.05 },
      { x: 20.5, z: 38.5, ry: -1.05, s: 1.0 },
      { x: -13.5, z: 62.0, ry: 0.35, s: 0.85 },
      { x: 11.5, z: 61.5, ry: -0.45, s: 0.9 },
      { x: -25.0, z: 48.0, ry: 0.6, s: 1.05 },
      { x: 24.0, z: 44.0, ry: -0.7, s: 1.1 },
    ];
    logLocations.forEach((l) => {
      const y = groundHeightAt(l.x, l.z);
      _dummyObj.position.set(l.x, y - 0.05, l.z);
      _dummyObj.rotation.set(0, l.ry, 0);
      _dummyObj.scale.set(l.s, l.s, l.s);
      _dummyObj.updateMatrix();
      logInstanced.setMatrixAt(logIdx, _dummyObj.matrix);
      logIdx++;
    });
    logInstanced.count = logIdx;
    logInstanced.computeBoundingSphere();
    this.scene.add(logInstanced);

    // =========================================================================
    // 7. ATMOSPHERIC DEPTH: WATERFALL MIST & JUNGLE CANOPY SPORES
    // =========================================================================
    // Waterfall rising mist puffs at plunge pool (-11.5, 37.5)
    const mistCount = 20;
    const mistGeo = new THREE.DodecahedronGeometry(0.85, 1);
    const mistMat = new THREE.MeshStandardMaterial({
      color: 0xe0f7fa,
      roughness: 0.95,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    mistMat.userData.noShadow = true;
    this.waterfallMistInstanced = new THREE.InstancedMesh(mistGeo, mistMat, mistCount);
    this.waterfallMistInstanced.frustumCulled = false;
    this.scene.add(this.waterfallMistInstanced);

    for (let i = 0; i < mistCount; i++) {
      this.waterfallMistParticles.push({
        x: -11.5 + (Math.random() - 0.5) * 2.8,
        y: 6.4 + Math.random() * 2.2,
        z: 37.5 + (Math.random() - 0.5) * 2.6,
        vx: (Math.random() - 0.5) * 0.45,
        vy: 0.65 + Math.random() * 0.8,
        vz: 0.2 + (Math.random() - 0.5) * 0.4,
        scale: 0.6 + Math.random() * 1.2,
        life: Math.random() * 4.0,
        maxLife: 3.5 + Math.random() * 2.0,
      });
    }

    // Floating sunlit jungle spores / fireflies
    const sporeCount = 36;
    const sporeGeo = new THREE.SphereGeometry(0.065, 5, 5);
    const sporeMat = new THREE.MeshBasicMaterial({
      color: 0xcdff7a,
    });
    this.jungleSporeInstanced = new THREE.InstancedMesh(sporeGeo, sporeMat, sporeCount);
    this.jungleSporeInstanced.frustumCulled = false;
    this.scene.add(this.jungleSporeInstanced);

    for (let i = 0; i < sporeCount; i++) {
      const a = (i / sporeCount) * Math.PI * 2;
      const r = 34 + (i % 6) * 4.0;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = groundHeightAt(x, z) + 1.2 + Math.random() * 2.5;
      this.jungleSporeParticles.push({
        x,
        y,
        z,
        baseY: y,
        phase: Math.random() * Math.PI * 2,
        speed: 0.8 + Math.random() * 0.8,
      });
    }

    // =========================================================================
    // 8. VOLUMETRIC GOD RAYS (SUN SHAFTS) & BIOLUMINESCENT MUSHROOMS
    // =========================================================================
    // Volumetric sunbeams piercing through the dense canopy gaps
    this.godRaysGroup = buildVolumetricGodRays();
    this.scene.add(this.godRaysGroup);

    // Glowing bioluminescent mushroom clusters along fallen logs and damp riverbanks
    const shroomLocations = [
      { x: -16.2, z: 47.8, s: 1.1 },
      { x: -12.0, z: 38.0, s: 1.0 },
      { x: -13.2, z: 61.8, s: 0.95 },
      { x: 11.2, z: 61.2, s: 0.9 },
      { x: -24.8, z: 47.8, s: 1.15 },
      { x: 23.8, z: 43.8, s: 1.05 },
      { x: -8.5, z: 52.0, s: 1.0 },
      { x: -2.0, z: 45.0, s: 0.85 },
    ];
    shroomLocations.forEach((loc) => {
      const shroom = buildBioluminescentMushroomCluster(loc.s);
      const sy = groundHeightAt(loc.x, loc.z);
      shroom.position.set(loc.x, sy, loc.z);
      this.scene.add(shroom);
      this.bioluminescentShrooms.push(shroom);
    });
  }

  private populateWildlifeAndBirds(): void {
    // 1. Beach Crabs (8 crabs scuttling sideways along the sandy Southern Castaway Cove shoreline)
    const crabShoreCoords = [
      { x: -24.0, z: 62.5 },
      { x: -16.5, z: 63.8 },
      { x: -10.5, z: 64.2 },
      { x: -4.8, z: 65.2 },
      { x: 5.2, z: 65.0 },
      { x: 11.8, z: 64.0 },
      { x: 18.5, z: 63.2 },
      { x: 25.5, z: 62.0 },
    ];
    crabShoreCoords.forEach((pt, i) => {
      const crabGroup = buildBeachCrab();
      const isGiantGuardCrab = i % 2 === 0;
      const baseScale = isGiantGuardCrab ? 1.45 : 1.0;
      crabGroup.scale.setScalar(baseScale);

      const physics = createAnimalPhysicsState({
        id: `crab_${i}`,
        kind: 'crab',
        homeX: pt.x,
        homeZ: pt.z,
        phase: i * 1.3,
        speed: isGiantGuardCrab ? 1.85 : 1.65,
        hostile: isGiantGuardCrab,
        hp: isGiantGuardCrab ? 45 : 25,
        maxHp: isGiantGuardCrab ? 45 : 25,
      });

      crabGroup.position.set(physics.x, physics.y, physics.z);
      crabGroup.rotation.set(physics.pitch, physics.yaw, physics.roll);
      this.scene.add(crabGroup);
      this.wildlifeActors.push({
        id: physics.id,
        kind: 'crab',
        group: crabGroup,
        baseScale,
        physics,
        homeX: physics.homeX,
        homeZ: physics.homeZ,
        phase: physics.phase,
        speed: physics.speed,
        hostile: isGiantGuardCrab,
        hp: physics.hp,
        maxHp: physics.maxHp,
        attackCooldown: 0,
        hitFlashTimer: 0,
      });
    });

    // 2. Jungle Lizards (6 green lizards darting near ferns, clearings, and rocks)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.48;
      const r = 47 + (i % 3) * 4;
      const hx = Math.cos(a) * r;
      const hz = Math.sin(a) * r;
      const lizGroup = buildJungleLizard();
      const physics = createAnimalPhysicsState({
        id: `lizard_${i}`,
        kind: 'lizard',
        homeX: hx,
        homeZ: hz,
        phase: i * 2.1,
        speed: 2.35,
        hostile: false,
      });
      lizGroup.position.set(physics.x, physics.y, physics.z);
      lizGroup.rotation.set(physics.pitch, physics.yaw, physics.roll);
      this.scene.add(lizGroup);
      this.wildlifeActors.push({
        id: physics.id,
        kind: 'lizard',
        group: lizGroup,
        baseScale: 1.0,
        physics,
        homeX: physics.homeX,
        homeZ: physics.homeZ,
        phase: physics.phase,
        speed: physics.speed,
        hostile: false,
        hp: physics.hp,
        maxHp: physics.maxHp,
      });
    }

    // 3. Monkeys (6 monkeys bounding and chattering in jungle clearings)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      const r = 41 + (i % 2) * 4;
      const hx = Math.cos(a) * r;
      const hz = Math.sin(a) * r;
      const monkeyGroup = buildJungleMonkey();
      const physics = createAnimalPhysicsState({
        id: `monkey_${i}`,
        kind: 'monkey',
        homeX: hx,
        homeZ: hz,
        phase: i * 1.7,
        speed: 1.95,
        hostile: false,
      });
      monkeyGroup.position.set(physics.x, physics.y, physics.z);
      monkeyGroup.rotation.set(physics.pitch, physics.yaw, physics.roll);
      this.scene.add(monkeyGroup);
      this.wildlifeActors.push({
        id: physics.id,
        kind: 'monkey',
        group: monkeyGroup,
        baseScale: 1.0,
        physics,
        homeX: physics.homeX,
        homeZ: physics.homeZ,
        phase: physics.phase,
        speed: physics.speed,
        hostile: false,
        hp: physics.hp,
        maxHp: physics.maxHp,
      });
    }

    // 4. Wild Boars (6 aggressive tusked boars patrolling beach edges, jungle trails & northern grasslands)
    const boarCoords = [
      { x: -11.5, z: 54.0 },
      { x: 10.5, z: 52.0 },
      { x: 0.0, z: 43.0 },
      { x: -24.0, z: 34.0 },
      { x: 24.0, z: 32.0 },
      { x: 4.0, z: -36.0 },
    ];
    boarCoords.forEach((pt, i) => {
      const boarGroup = buildWildBoar();
      const baseScale = 1.18;
      boarGroup.scale.setScalar(baseScale);
      const physics = createAnimalPhysicsState({
        id: `boar_${i}`,
        kind: 'boar',
        homeX: pt.x,
        homeZ: pt.z,
        phase: i * 1.4,
        speed: 2.35,
        hostile: true,
        hp: 80,
        maxHp: 80,
      });
      boarGroup.position.set(physics.x, physics.y, physics.z);
      boarGroup.rotation.set(physics.pitch, physics.yaw, physics.roll);
      this.scene.add(boarGroup);
      this.wildlifeActors.push({
        id: physics.id,
        kind: 'boar',
        group: boarGroup,
        baseScale,
        physics,
        homeX: physics.homeX,
        homeZ: physics.homeZ,
        phase: physics.phase,
        speed: physics.speed,
        hostile: true,
        hp: physics.hp,
        maxHp: physics.maxHp,
        attackCooldown: 0,
        hitFlashTimer: 0,
      });
    });

    // 5. Birds in the sky and canopy: Seagulls, Parrots, and Toucans (15 total)
    const speciesList: Array<'seagull' | 'parrot' | 'toucan'> = [
      'seagull',
      'seagull',
      'seagull',
      'seagull',
      'seagull',
      'parrot',
      'parrot',
      'parrot',
      'parrot',
      'parrot',
      'toucan',
      'toucan',
      'toucan',
      'toucan',
      'toucan',
    ];

    speciesList.forEach((species, idx) => {
      const { group, leftWing, rightWing } = buildBird(species);
      const isCoastal = species === 'seagull';
      const orbitR = isCoastal ? 58 + (idx % 3) * 8 : 28 + (idx % 4) * 7;
      const alt = isCoastal ? 14 + (idx % 3) * 3.5 : 12 + (idx % 4) * 2.5;
      const angle = (idx / speciesList.length) * Math.PI * 2;

      this.scene.add(group);
      this.birdActors.push({
        species,
        group,
        leftWing,
        rightWing,
        orbitCenterX: 0,
        orbitCenterZ: 0,
        orbitRadius: orbitR,
        altitude: alt,
        angle,
        speed: 0.35 + (idx % 3) * 0.1,
      });
    });
  }

  private populateInteractableResources(): void {
    //Guaranteed immediate pickups + Sea-Drifted Supply Crate + Escape Boat Shipyard
    const guaranteedPlacements: Array<{
      id: string;
      type: 'coconut' | 'wood' | 'food' | 'rope' | 'campfire' | 'supply_box' | 'boat_site';
      label: string;
      x: number;
      z: number;
    }> = [
      {
        id: 'supply_box_sea',
        type: 'supply_box',
        label: 'Sea-Drifted Supply Box (Knife, Rope & Island Map)',
        x: this.supplyBoxShorePos.x,
        z: this.supplyBoxShorePos.z,
      },
      {
        id: 'boat_shipyard',
        type: 'boat_site',
        label: 'Escape Boat Shipyard',
        x: this.boatSitePos.x,
        z: this.boatSitePos.z,
      },
      { id: 'coco_spawn_1', type: 'coconut', label: 'Fresh Coconut', x: 0.0, z: 61.5 },
      { id: 'wood_spawn_1', type: 'wood', label: 'Sun-Bleached Driftwood', x: -2.2, z: 59.5 },
      { id: 'coco_spawn_2', type: 'coconut', label: 'Beach Coconut', x: 2.6, z: 58.0 },
      { id: 'wood_spawn_2', type: 'wood', label: 'Shipwreck Timber', x: -4.2, z: 64.0 },
      { id: 'wood_spawn_3', type: 'wood', label: 'Dry Jungle Branch', x: 1.5, z: 53.5 },
      { id: 'food_spawn_1', type: 'food', label: 'Wild Island Papaya', x: -1.4, z: 49.5 },
      { id: 'rope_spawn_1', type: 'rope', label: 'Washed-Up Hemp Rope Coil', x: 9.5, z: 62.0 },
      { id: 'camp_beach', type: 'campfire', label: 'Beach Shelter Campfire (Requires 3 Wood)', x: 3.8, z: 62.5 },
      { id: 'camp_jungle', type: 'campfire', label: 'Jungle Ridge Campfire (Requires 3 Wood)', x: 0.0, z: 44.0 },
      { id: 'camp_volcano', type: 'campfire', label: 'Volcano Overlook Beacon (Requires 3 Wood)', x: -2.0, z: 28.5 },
    ];

    for (const p of guaranteedPlacements) {
      this.registerInteractable(p.id, p.type, p.label, p.x, p.z);
    }

    // Additional procedural resources across the beach and jungle
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.2;
      const r = 56 + (i % 3) * 4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (getStage2HydrologyAt(x, z).inWater) continue;
      const type = i % 5 === 0 ? 'rope' : i % 2 === 0 ? 'coconut' : 'wood';
      const label =
        type === 'rope'
          ? 'Salvaged Rigging Rope'
          : type === 'coconut'
          ? 'Fallen Coconut'
          : 'Coastal Driftwood';
      this.registerInteractable(`beach_res_${i}`, type, label, x, z);
    }

    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.35;
      const r = 36 + (i % 4) * 3.8;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (lavaChannelProximity(x, z) > 0.25) continue;
      if (getStage2HydrologyAt(x, z).inWater) continue;
      const type = i % 3 === 0 ? 'wood' : 'food';
      const label = type === 'wood' ? 'Hardwood Log' : 'Tropical Fruit Cluster';
      this.registerInteractable(`jungle_res_${i}`, type, label, x, z);
    }
  }

  private registerInteractable(
    id: string,
    type: 'coconut' | 'wood' | 'food' | 'rope' | 'campfire' | 'supply_box' | 'boat_site',
    label: string,
    x: number,
    z: number
  ): void {
    const y = groundHeightAt(x, z);
    const item: InteractableItem = {
      id,
      type,
      label,
      x,
      y,
      z,
      collected: false,
      lit: false,
    };
    this.interactables.push(item);

    const mesh = buildInteractableMesh(type);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.interactableMeshes.set(id, mesh);
  }

  private initPlayer(): void {
    this.castaway = buildCastawayCharacter();
    const spawnX = 0;
    const spawnZ = 66;
    const spawnY = groundHeightAt(spawnX, spawnZ);
    this.playerPos.set(spawnX, spawnY, spawnZ);
    this.castaway.root.position.copy(this.playerPos);
    this.scene.add(this.castaway.root);
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    const dom = this.renderer.domElement;
    dom.style.touchAction = 'none';
    dom.style.userSelect = 'none';

    dom.addEventListener('pointerdown', this.onCanvasPointerDown);
    window.addEventListener('pointermove', this.onCanvasPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onCanvasPointerUp);
    window.addEventListener('pointercancel', this.onCanvasPointerUp);

    // Native TouchEvent fallback for mobile browsers & multi-finger 360° swipe/pinch
    dom.addEventListener('touchstart', this.onCanvasTouchStart, { passive: false });
    dom.addEventListener('touchmove', this.onCanvasTouchMove, { passive: false });
    dom.addEventListener('touchend', this.onCanvasTouchEnd);
    dom.addEventListener('touchcancel', this.onCanvasTouchEnd);

    // Mouse wheel 3rd-person distance zoom
    dom.addEventListener('wheel', this.onCanvasWheel, { passive: false });

    // Legacy mouse fallback
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);

    this.resizeObserver = new ResizeObserver(() => {
      this.onResize();
    });
    this.resizeObserver.observe(this.container);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (!this.keysHeld.has(code)) {
      this.keysJustPressed.add(code);
    }
    this.keysHeld.add(code);

    // Title screen Enter/Space start handshake
    if (this.gameState === 'title' && (code === 'Enter' || code === 'Space')) {
      e.preventDefault();
      this.startGame();
      return;
    }

    // Pause toggle on Escape or KeyP
    if ((code === 'Escape' || code === 'KeyP') && (this.gameState === 'playing' || this.gameState === 'paused')) {
      e.preventDefault();
      this.togglePause();
      return;
    }

    if (this.gameState !== 'playing') return;

    // Gameplay hotkeys
    if (code === 'KeyE') {
      this.triggerInteract();
    } else if (code === 'KeyK' || code === 'KeyX') {
      this.triggerAttack();
    } else if (code === 'KeyC') {
      this.toggleBend();
    } else if (code === 'KeyV') {
      this.flipCamera180();
    } else if (code === 'KeyF' || code === 'Digit1') {
      this.triggerConsumeProvision('coconut');
    } else if (code === 'Digit2') {
      this.triggerConsumeProvision('food');
    } else if (code === 'KeyM') {
      this.toggleMute();
    } else if (code === 'KeyR') {
      this.restartGame();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
    // Variable jump height cut when Space is released early while ascending
    if (e.code === 'Space' && this.playerVel.y > 2.0) {
      this.playerVel.y *= 0.5;
    }
  };

  private onWindowBlur = (): void => {
    this.keysHeld.clear();
    this.keysJustPressed.clear();
    this.isDraggingLook = false;
    this.lookPointers.clear();
    this.isTouchRotating = false;
    this.joystickX = 0;
    this.joystickY = 0;
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.keysHeld.clear();
      this.keysJustPressed.clear();
      this.isDraggingLook = false;
      this.lookPointers.clear();
      this.isTouchRotating = false;
      this.joystickX = 0;
      this.joystickY = 0;
    }
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  private applyOrbitDelta(dx: number, dy: number, zoomDelta = 0, isTouch = false): void {
    const yawSens = isTouch ? 0.0085 : 0.0062;
    const pitchSens = isTouch ? 0.0062 : 0.0046;
    const next = stepCameraOrbit({
      camYaw: this.camYaw,
      camPitch: this.camPitch,
      camDist: this.camDist,
      deltaX: dx,
      deltaY: dy,
      zoomDelta,
      yawSensitivity: yawSens,
      pitchSensitivity: pitchSens,
    });
    this.camYaw = next.camYaw;
    this.camPitch = next.camPitch;
    this.camDist = next.camDist;

    // Store rotational momentum for smooth finger-flick 360° glide
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
      this.camYawVel = THREE.MathUtils.clamp(-dx * yawSens * 16, -6.5, 6.5);
      this.camPitchVel = THREE.MathUtils.clamp(dy * pitchSens * 12, -3.5, 3.5);
    }
  }

  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (this.gameState !== 'playing') return;
    this.audio.init();
    this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.isDraggingLook = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.camYawVel = 0;
    this.camPitchVel = 0;

    if (this.lookPointers.size === 2) {
      const pts = Array.from(this.lookPointers.values());
      this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  };

  private onCanvasPointerMove = (e: PointerEvent): void => {
    if (this.gameState !== 'playing') return;
    const prev = this.lookPointers.get(e.pointerId);
    if (!prev) return;

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.lookPointers.size >= 2) {
      const pts = Array.from(this.lookPointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const pinchDelta = this.lastPinchDist > 0 ? (this.lastPinchDist - dist) * 0.018 : 0;
      this.lastPinchDist = dist;
      this.applyOrbitDelta(dx * 0.5, dy * 0.5, pinchDelta, e.pointerType === 'touch');
    } else {
      this.applyOrbitDelta(dx, dy, 0, e.pointerType === 'touch');
    }
  };

  private onCanvasPointerUp = (e: PointerEvent): void => {
    this.lookPointers.delete(e.pointerId);
    if (this.lookPointers.size < 2) {
      this.lastPinchDist = 0;
    }
    if (this.lookPointers.size === 0) {
      this.isDraggingLook = false;
    }
  };

  private onCanvasTouchStart = (e: TouchEvent): void => {
    if (this.gameState !== 'playing') return;
    if (this.lookPointers.size > 0) return; // Handled by PointerEvents
    if (e.touches.length >= 1) {
      e.preventDefault();
      this.audio.init();
      const t = e.touches[0];
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
      this.isTouchRotating = true;
      this.camYawVel = 0;
      this.camPitchVel = 0;
      if (e.touches.length >= 2) {
        const t2 = e.touches[1];
        this.lastPinchDist = Math.hypot(t.clientX - t2.clientX, t.clientY - t2.clientY);
      }
    }
  };

  private onCanvasTouchMove = (e: TouchEvent): void => {
    if (this.gameState !== 'playing') return;
    if (this.lookPointers.size > 0 || !this.isTouchRotating) return;
    if (e.touches.length >= 1) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - this.lastTouchX;
      const dy = t.clientY - this.lastTouchY;
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;

      let pinchDelta = 0;
      if (e.touches.length >= 2) {
        const t2 = e.touches[1];
        const dist = Math.hypot(t.clientX - t2.clientX, t.clientY - t2.clientY);
        if (this.lastPinchDist > 0) {
          pinchDelta = (this.lastPinchDist - dist) * 0.018;
        }
        this.lastPinchDist = dist;
      }

      this.applyOrbitDelta(dx, dy, pinchDelta, true);
    }
  };

  private onCanvasTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0) {
      this.isTouchRotating = false;
      this.lastPinchDist = 0;
    } else if (e.touches.length === 1) {
      this.lastTouchX = e.touches[0].clientX;
      this.lastTouchY = e.touches[0].clientY;
      this.lastPinchDist = 0;
    }
  };

  private onCanvasWheel = (e: WheelEvent): void => {
    if (this.gameState !== 'playing') return;
    e.preventDefault();
    this.applyOrbitDelta(0, 0, e.deltaY * 0.004, false);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.gameState !== 'playing') return;
    if (this.lookPointers.size > 0) return;
    this.audio.init();
    this.isDraggingLook = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.gameState !== 'playing') return;

    if (this.isPointerLocked) {
      this.applyOrbitDelta(e.movementX * 0.45, e.movementY * 0.45, 0, false);
    } else if (this.isDraggingLook && this.lookPointers.size === 0) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.applyOrbitDelta(dx, dy, 0, false);
    }
  };

  private onMouseUp = (): void => {
    if (this.lookPointers.size === 0) {
      this.isDraggingLook = false;
    }
  };

  private onResize(): void {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // Public Game Shell Actions
  public startGame(): void {
    this.audio.init();
    this.audio.setPaused(false);
    this.gameState = 'playing';
    document.body.dataset.state = 'playing';
    this.keysHeld.clear();
    this.keysJustPressed.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.showToast(
      'Washed ashore! Search the West Shoreline for the Sea-Drifted Supply Box (Knife, Rope & Map), survive creatures, and build your Escape Boat!'
    );
    this.broadcastHud(true);
  }

  public togglePause(): void {
    if (this.gameState === 'playing') {
      this.gameState = 'paused';
      document.body.dataset.state = 'paused';
      this.audio.setPaused(true);
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    } else if (this.gameState === 'paused') {
      this.gameState = 'playing';
      document.body.dataset.state = 'playing';
      this.audio.setPaused(false);
      this.keysHeld.clear();
    }
    this.broadcastHud(true);
  }

  public returnToTitle(): void {
    this.restartGame(true);
  }

  public restartGame(toTitle = false): void {
    const spawnX = 0;
    const spawnZ = 66;
    const spawnY = groundHeightAt(spawnX, spawnZ);
    this.playerPos.set(spawnX, spawnY, spawnZ);
    this.playerVel.set(0, 0, 0);
    this.playerYaw = 0;
    this.camYaw = 0;
    this.camPitch = 0.28;
    this.isGrounded = true;
    this.gait = 'walk';
    this.isBending = false;
    this.joystickX = 0;
    this.joystickY = 0;

    this.vitals = {
      hp: 100,
      maxHp: 100,
      stamina: 100,
      maxStamina: 100,
      hunger: 100,
      maxHunger: 100,
      thirst: 100,
      maxThirst: 100,
    };
    this.inventory = {
      coconuts: 1,
      wood: 0,
      food: 0,
      rope: 0,
      hasKnife: false,
      hasRope: false,
      hasMap: false,
    };
    this.boatStage = 0;
    this.supplyBoxOpened = false;
    this.creaturesDefeated = 0;
    this.attackAnimTimer = 0;
    this.castaway.knifeGroup.visible = false;

    this.useRealTimeIST = true;
    const ist = getISTTimeState();
    this.timeOfDay = ist.normalizedTime;
    this.lastISTDateLabel = ist.dateLabel;
    this.daysSurvived = 1;
    this.resourcesCollected = 0;
    this.campfiresLit = 0;
    this.victory = false;

    for (const actor of this.wildlifeActors) {
      actor.physics = createAnimalPhysicsState({
        id: actor.id,
        kind: actor.kind,
        homeX: actor.homeX,
        homeZ: actor.homeZ,
        phase: actor.phase,
        speed: actor.speed,
        hostile: actor.hostile,
        hp: actor.maxHp ?? 40,
        maxHp: actor.maxHp ?? 40,
      });
      actor.hp = actor.physics.hp;
      actor.attackCooldown = 0;
      actor.hitFlashTimer = 0;
      actor.group.visible = true;
      actor.group.scale.setScalar(actor.baseScale);
      actor.group.position.set(actor.physics.x, actor.physics.y, actor.physics.z);
      actor.group.rotation.set(actor.physics.pitch, actor.physics.yaw, actor.physics.roll);
    }

    for (const item of this.interactables) {
      item.collected = false;
      item.lit = false;
      const mesh = this.interactableMeshes.get(item.id);
      if (mesh) {
        mesh.visible = true;
        const flame = mesh.getObjectByName('campfire_flame');
        if (flame) flame.visible = false;
        if (item.type === 'boat_site') {
          this.syncBoatShipyardMesh(mesh, 0);
        }
      }
    }

    this.castaway.root.position.copy(this.playerPos);
    this.castaway.root.rotation.set(0, 0, 0);
    this.updateTerrainLODChunks(spawnX, spawnZ, true);

    if (toTitle) {
      this.gameState = 'title';
      document.body.dataset.state = 'title';
      this.audio.setPaused(true);
    } else {
      this.gameState = 'playing';
      document.body.dataset.state = 'playing';
      this.audio.init();
      this.audio.setPaused(false);
      this.showToast('New survival run started! Spot the Sea-Drifted Supply Box washing ashore!');
    }

    this.broadcastHud(true);
  }

  private syncBoatShipyardMesh(boatMesh: THREE.Group, stage: BoatBuildStage): void {
    const s1 = boatMesh.getObjectByName('boat_stage_1');
    const s2 = boatMesh.getObjectByName('boat_stage_2');
    const s3 = boatMesh.getObjectByName('boat_stage_3');
    if (s1) s1.visible = stage >= 1;
    if (s2) s2.visible = stage >= 2;
    if (s3) s3.visible = stage >= 3;
  }

  public setGait(gait: MovementGait): void {
    this.gait = gait;
    if (gait === 'run' && this.isBending) {
      this.isBending = false;
    }
    this.showToast(gait === 'run' ? 'Gait switched to Run (Sprint)' : 'Gait switched to Walk');
    this.broadcastHud(true);
  }

  public toggleBend(forceState?: boolean): void {
    this.isBending = typeof forceState === 'boolean' ? forceState : !this.isBending;
    this.showToast(
      this.isBending
        ? 'Character Bent / Crouched (Low profile & extended ground reach)'
        : 'Character Stood Upright'
    );
    this.broadcastHud(true);
  }

  public setJoystickVector(nx: number, ny: number): void {
    this.joystickX = THREE.MathUtils.clamp(nx, -1, 1);
    this.joystickY = THREE.MathUtils.clamp(ny, -1, 1);
    if (nx === 0 && ny === 0) {
      this.broadcastHud(true);
    }
  }

  public rotateCameraBy(deltaYawRad: number, deltaPitchRad = 0): void {
    this.camYaw = wrapAngleDiff(this.camYaw + deltaYawRad);
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + deltaPitchRad, -0.12, 1.32);
    this.camYawVel = 0;
    this.camPitchVel = 0;
    this.broadcastHud(true);
  }

  public flipCamera180(): void {
    this.camYaw = wrapAngleDiff(this.camYaw + Math.PI);
    this.camYawVel = 0;
    this.camPitchVel = 0;
    const deg = camYawToCompassDegrees(this.camYaw);
    this.showToast(`Rotated 3rd-Person POV 180° (Camera Angle: ${deg}°)`);
    this.broadcastHud(true);
  }

  public teleportTo(x: number, z: number, yaw = 0): void {
    const y = Math.max(WATER_LEVEL - 0.5, groundHeightAt(x, z));
    this.playerPos.set(x, y, z);
    this.playerVel.set(0, 0, 0);
    this.playerYaw = yaw;
    this.camYaw = yaw;
    this.isGrounded = !isSwimmingAt(x, z);
    this.castaway.root.position.copy(this.playerPos);
    this.castaway.root.rotation.y = yaw;
    this.updateTerrainLODChunks(x, z, true);

    const camDist = this.camDist;
    const camOffsetX = Math.sin(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetZ = Math.cos(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetY = Math.sin(this.camPitch) * camDist + 1.65;
    const desiredCamX = this.playerPos.x + camOffsetX;
    const desiredCamZ = this.playerPos.z + camOffsetZ;
    const terrainAtCam = Math.max(WATER_LEVEL + 0.5, groundHeightAt(desiredCamX, desiredCamZ) + 0.85);
    const desiredCamY = Math.max(terrainAtCam, this.playerPos.y + camOffsetY);
    this.camera.position.set(desiredCamX, desiredCamY, desiredCamZ);
    this.camera.lookAt(this.playerPos.x, this.playerPos.y + 1.55, this.playerPos.z);

    this.updateOceanAndLavaAnimation(this.elapsedSimTime, 0.016);
    this.updateDayNightEnvironment(0.016);
    this.renderer.render(this.scene, this.camera);
    this.broadcastHud(true);
  }

  public triggerJump(): void {
    if (this.gameState !== 'playing') return;
    if (this.isBending) {
      this.isBending = false;
    }
    this.jumpBufferTimer = 0.16;
  }

  public toggleMute(): boolean {
    const next = !this.audio.getMuted();
    this.audio.setMuted(next);
    this.broadcastHud(true);
    return next;
  }

  public getMuted(): boolean {
    return this.audio.getMuted();
  }

  public setTimeOfDayPreset(preset: number | 'IST'): void {
    if (preset === 'IST') {
      this.useRealTimeIST = true;
      const ist = getISTTimeState();
      this.timeOfDay = ist.normalizedTime;
      this.showToast(`Synced timeline to Real-Life Indian Standard Time (${ist.clockWithSeconds} IST)`);
    } else {
      this.useRealTimeIST = false;
      this.timeOfDay = ((preset % 1) + 1) % 1;
      const cycle = evaluateDayNightCycle(this.timeOfDay);
      this.showToast(`Previewing ${cycle.phase} lighting (${cycle.clockLabel} IST)`);
    }
    this.updateDayNightEnvironment(0);
    this.renderer.render(this.scene, this.camera);
    this.broadcastHud(true);
  }

  public triggerAttack(): void {
    if (this.gameState !== 'playing') return;
    if (this.attackAnimTimer > 0.12) return;
    this.attackAnimTimer = 0.34;
    this.audio.playJump();

    const combatTargets = this.wildlifeActors
      .filter((a) => a.hostile && (a.hp ?? 0) > 0)
      .map((a) => ({
        id: a.id || 'creature',
        kind: (a.kind === 'boar' ? 'boar' : 'crab') as 'boar' | 'crab',
        x: a.group.position.x,
        z: a.group.position.z,
        hp: a.hp ?? 40,
        maxHp: a.maxHp ?? 40,
      }));

    const res = resolvePlayerMeleeAttack({
      playerX: this.playerPos.x,
      playerZ: this.playerPos.z,
      playerYaw: this.playerYaw,
      hasKnife: !!this.inventory.hasKnife,
      targets: combatTargets,
      reach: 3.9,
    });

    // Startle nearby passive wildlife when the player swings a weapon
    for (const actor of this.wildlifeActors) {
      if (!actor.hostile && Math.hypot(actor.physics.x - this.playerPos.x, actor.physics.z - this.playerPos.z) < 6.5) {
        actor.physics = {
          ...actor.physics,
          behavior: 'flee',
          fleeTimer: Math.max(actor.physics.fleeTimer, 3.0),
        };
      }
    }

    if (res.hitTargetId) {
      const actor = this.wildlifeActors.find((a) => a.id === res.hitTargetId);
      if (actor) {
        const updated = res.updatedTargets.find((t) => t.id === res.hitTargetId);
        const nextHp = updated ? updated.hp : 0;
        actor.hp = nextHp;
        actor.physics = applyAnimalKnockback(
          { ...actor.physics, hp: nextHp },
          this.playerPos.x,
          this.playerPos.z,
          6.8,
          4.1
        );
        actor.hitFlashTimer = actor.physics.hitFlashTimer;
        this.audio.playPickup();

        if (res.killed) {
          actor.group.visible = false;
          this.creaturesDefeated += 1;
          this.inventory = {
            ...this.inventory,
            food: this.inventory.food + 1,
            rope: (this.inventory.rope ?? 0) + 1,
            hasRope: true,
          };
          const creatureName = actor.kind === 'boar' ? 'Wild Boar' : 'Giant Reef Crab';
          this.showToast(
            `Defeated ${creatureName}! Harvested +1 Meat (Food) & +1 Sinew Rope!`
          );
        } else {
          const weaponName = this.inventory.hasKnife ? 'Survival Knife' : 'Bare Fist';
          const creatureName = actor.kind === 'boar' ? 'Wild Boar' : 'Giant Reef Crab';
          this.showToast(
            `Struck ${creatureName} with ${weaponName} (-${res.damageDealt} HP, ${actor.hp}/${actor.maxHp} left)!`
          );
        }
      }
    } else {
      const weaponName = this.inventory.hasKnife ? 'Survival Knife' : 'Fist';
      this.showToast(
        `Swung ${weaponName}! Move within 3.8m of a Wild Boar or Giant Crab to strike.`
      );
    }

    this.broadcastHud(true);
  }

  public triggerInteract(): void {
    if (this.gameState !== 'playing') return;

    // Check if player is near the freshwater stream or waterfall pool to drink
    const streamInfo = freshwaterStreamInfo(this.playerPos.x, this.playerPos.z);

    const { item } = findNearestInteractable(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.interactables,
      this.isBending ? 5.4 : 4.6
    );

    if (streamInfo.nearStream && (!item || Math.hypot(this.playerPos.x - item.x, this.playerPos.z - item.z) > 2.8)) {
      const res = drinkFreshwater(this.vitals);
      this.vitals = res.vitals;
      this.audio.playWaterDrink();
      this.showToast(
        streamInfo.isWaterfall
          ? 'Drank cool mist water from the waterfall plunge pool! (+35 Drink/Thirst, +6 HP)'
          : 'Drank crystal-clear water from the freshwater jungle stream! (+35 Drink/Thirst, +6 HP)'
      );
      this.broadcastHud(true);
      return;
    }

    if (!item) {
      this.showToast(
        'Move closer to the Freshwater Stream, Sea Supply Box, Escape Boat, Coconut, Wood, or Campfire [E].'
      );
      return;
    }

    if (item.type === 'supply_box') {
      item.collected = true;
      this.supplyBoxOpened = true;
      const mesh = this.interactableMeshes.get(item.id);
      if (mesh) mesh.visible = false;

      this.inventory = openSupplyCrate(this.inventory);
      this.castaway.knifeGroup.visible = true;
      this.resourcesCollected += 1;
      this.audio.playPickup();
      this.showToast(
        'Opened Sea-Drifted Supply Box! Found Survival Knife, +3 Hemp Rope & Caldera Island Map!'
      );
      this.broadcastHud(true);
      return;
    }

    if (item.type === 'boat_site') {
      const boatRes = advanceBoatConstruction(this.boatStage, this.inventory);
      if (boatRes.readyToSail) {
        this.victory = true;
        this.gameState = 'gameover';
        document.body.dataset.state = 'gameover';
        if (document.pointerLockElement) document.exitPointerLock?.();
        this.audio.playPickup();
        this.showToast('You boarded your finished Outrigger Escape Boat and sailed to freedom!');
      } else if (boatRes.success) {
        this.boatStage = boatRes.newStage;
        this.inventory = boatRes.inventory;
        const mesh = this.interactableMeshes.get(item.id);
        if (mesh) {
          this.syncBoatShipyardMesh(mesh, this.boatStage);
        }
        this.audio.playPickup();
        this.showToast(boatRes.message);
      } else {
        this.showToast(boatRes.message);
      }
      this.broadcastHud(true);
      return;
    }

    if (item.type === 'campfire') {
      if (canLightCampfire(this.inventory, 3)) {
        this.inventory = { ...this.inventory, wood: this.inventory.wood - 3 };
        item.lit = true;
        this.campfiresLit += 1;
        const mesh = this.interactableMeshes.get(item.id);
        const flame = mesh?.getObjectByName('campfire_flame');
        if (flame) flame.visible = true;
        this.audio.playPickup();
        this.vitals.hp = Math.min(this.vitals.maxHp, this.vitals.hp + 30);

        const totalCampfires = this.interactables.filter((i) => i.type === 'campfire').length;
        this.showToast(
          `Campfire Shelter Lit! (+30 HP & Night Warmth — ${this.campfiresLit}/${totalCampfires} Fires active)`
        );
      } else {
        this.showToast(
          `Need 3 Wood to light ${item.label.split('(')[0].trim()} (Have ${this.inventory.wood}/3 Wood).`
        );
      }
      this.broadcastHud(true);
      return;
    }

    // Collect coconut, wood, food, or rope (respecting Backpack Storage Capacity)
    if (!canStoreInBackpack(this.inventory, 1, DEFAULT_BACKPACK_CAPACITY)) {
      const storage = getBackpackStorageState(this.inventory, DEFAULT_BACKPACK_CAPACITY);
      this.showToast(
        `Backpack Full (${storage.usedSlots}/${storage.maxSlots} slots)! Open Backpack [B] to consume or drop items.`
      );
      this.broadcastHud(true);
      return;
    }

    item.collected = true;
    const mesh = this.interactableMeshes.get(item.id);
    if (mesh) mesh.visible = false;

    this.inventory = collectResource(this.inventory, item.type);
    this.resourcesCollected += 1;
    this.audio.playPickup();

    if (item.type === 'coconut') {
      const maxT = this.vitals.maxThirst ?? 100;
      this.vitals.thirst = Math.min(maxT, (this.vitals.thirst ?? maxT) + 10);
    } else if (item.type === 'food') {
      this.vitals.hunger = Math.min(this.vitals.maxHunger, this.vitals.hunger + 8);
    }

    const storageAfter = getBackpackStorageState(this.inventory, DEFAULT_BACKPACK_CAPACITY);
    this.showToast(
      `Collected ${item.label}! (Backpack ${storageAfter.usedSlots}/${storageAfter.maxSlots})`
    );
    this.broadcastHud(true);
  }

  public dropBackpackItem(kind: 'coconut' | 'food' | 'wood' | 'rope'): void {
    const res = dropBackpackItem(this.inventory, kind);
    if (res.dropped) {
      this.inventory = res.inventory;
      const storage = getBackpackStorageState(this.inventory, DEFAULT_BACKPACK_CAPACITY);
      const labelMap: Record<'coconut' | 'food' | 'wood' | 'rope', string> = {
        coconut: 'Fresh Coconut',
        food: 'Island Provision',
        wood: 'Driftwood Bundle',
        rope: 'Hemp Rope Coil',
      };
      this.showToast(
        `Dropped 1 ${labelMap[kind]} from Backpack (${storage.usedSlots}/${storage.maxSlots} slots used).`
      );
      this.broadcastHud(true);
    }
  }

  public triggerConsumeProvision(preferred?: 'coconut' | 'food'): void {
    if (this.gameState !== 'playing' && this.gameState !== 'paused') return;
    const res = consumeProvision(this.inventory, this.vitals, preferred);
    if (res.consumed) {
      this.inventory = res.inventory;
      this.vitals = res.vitals;
      this.audio.playPickup();
      this.showToast(
        res.consumed === 'coconut'
          ? 'Drank Fresh Coconut Water (+42 Drink/Hydration, +25 Eat, +18 HP)'
          : 'Ate Island Fruit & Meat (+40 Eat/Nourishment, +14 Drink, +30 HP)'
      );
      this.broadcastHud(true);
    } else {
      this.showToast('No Coconuts (Drink) or Food (Eat) in pack!');
    }
  }

  private showToast(msg: string): void {
    this.statusToast = msg;
    this.toastTimer = 3.8;
  }

  private startLoop(): void {
    let lastHeadlessRender = 0;
    let frameCounter = 0;
    const tick = (now: number) => {
      this.animFrameId = requestAnimationFrame(tick);

      // Throttle headless software rendering to ~11fps so screenshots never stall
      if (this.isHeadless && now - lastHeadlessRender < 88) {
        return;
      }
      lastHeadlessRender = now;

      const rawDt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      const dt = Math.min(rawDt, 0.05);

      this.update(dt);
      frameCounter += 1;
      if (!this.isHeadless && frameCounter % 3 === 0) {
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private update(dt: number): void {
    this.elapsedSimTime += dt;

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.statusToast = null;
      }
    }

    // Always animate ambient world (waves, volcano smoke/embers, wildlife, birds)
    this.updateOceanAndLavaAnimation(this.elapsedSimTime, dt);
    this.updateWildlifeAndBirds(this.elapsedSimTime, dt);

    // Synchronize island timeline with real-life Indian Standard Time (IST, UTC+05:30)
    if (this.useRealTimeIST) {
      const ist = getISTTimeState();
      this.timeOfDay = ist.normalizedTime;
      if (ist.dateLabel !== this.lastISTDateLabel) {
        this.lastISTDateLabel = ist.dateLabel;
        if (this.gameState === 'playing') {
          this.daysSurvived += 1;
        }
      }
    } else if (this.gameState === 'playing') {
      const prevTime = this.timeOfDay;
      this.timeOfDay = (this.timeOfDay + dt / 180) % 1;
      if (this.timeOfDay < prevTime) {
        this.daysSurvived += 1;
      }
    }
    const dayState = this.updateDayNightEnvironment(dt);

    if (this.gameState === 'title') {
      // Diegetic In-World Awakening camera framing on the beach looking past our shipwrecked castaway toward the smoking volcano
      const sway = Math.sin(this.elapsedSimTime * 0.45) * 1.4;
      this.camera.position.set(3.2 + sway, 3.1, 72.5);
      this.camera.lookAt(0, 8.5, 18);
      this.animateCastawayRig(dt, false, false, false);
      this.keysJustPressed.clear();
      return;
    }

    if (this.gameState === 'paused' || this.gameState === 'gameover') {
      this.keysJustPressed.clear();
      return;
    }

    // Update player movement & physics
    this.updatePlayerMovement(dt);

    // Check biome, swimming, and lava hazards
    const inLava = isLavaHazardAt(this.playerPos.x, this.playerPos.z);
    const nearLitCampfire = this.interactables.some(
      (i) =>
        i.type === 'campfire' &&
        i.lit &&
        Math.hypot(this.playerPos.x - i.x, this.playerPos.z - i.z) < 5.5
    );

    const isMoving = _moveVec.lengthSq() > 0.01;
    const shiftHeld =
      this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight');
    const swimming = isSwimmingAt(this.playerPos.x, this.playerPos.z);
    const { isSprinting } = computeTargetMoveSpeed({
      gait: this.gait,
      shiftHeld,
      isBending: this.isBending,
      isSwimming: swimming,
      stamina: this.vitals.stamina,
    });

    const vitalsStep = stepPlayerVitals(this.vitals, {
      dt,
      inLava,
      isSprinting,
      isMoving,
      nearLitCampfire,
      isNight: dayState.phase === 'Night',
    });
    this.vitals = vitalsStep.vitals;

    if (vitalsStep.tookLavaDamage) {
      this.cameraTrauma = Math.min(1.0, this.cameraTrauma + dt * 2.5);
      this.lavaSoundCooldown -= dt;
      if (this.lavaSoundCooldown <= 0) {
        this.audio.playLavaBurn();
        this.lavaSoundCooldown = 0.45;
      }
    }

    if (vitalsStep.isDead) {
      this.victory = false;
      this.gameState = 'gameover';
      document.body.dataset.state = 'gameover';
      if (document.pointerLockElement) document.exitPointerLock?.();
      this.broadcastHud(true);
      return;
    }

    // Update spatial ambient audio (waves, birds, volcano rumble, freshwater stream, waterfall)
    const distFromCenter = Math.hypot(this.playerPos.x, this.playerPos.z);
    const streamInfo = freshwaterStreamInfo(this.playerPos.x, this.playerPos.z);
    const distToWaterfall = Math.hypot(this.playerPos.x - (-12.5), this.playerPos.z - 34.0);
    this.audio.updateAmbience(
      dt,
      this.elapsedSimTime,
      distFromCenter,
      dayState.daylightFactor,
      streamInfo.distToStream,
      distToWaterfall
    );

    // Throttle React HUD state updates to ~10Hz
    if (this.elapsedSimTime - this.lastHudBroadcast > 0.1) {
      this.broadcastHud(false);
    }

    this.keysJustPressed.clear();
  }

  private updatePlayerMovement(dt: number): void {
    // Camera-relative movement axes on XZ plane
    _forward.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)).normalize();
    _right.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw)).normalize();

    _moveVec.set(0, 0, 0);
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) _moveVec.add(_forward);
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) _moveVec.sub(_forward);
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) _moveVec.add(_right);
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) _moveVec.sub(_right);

    // Add Virtual Joystick input (joystickY < 0 is forward/up, joystickX > 0 is right)
    if (Math.abs(this.joystickX) > 0.01 || Math.abs(this.joystickY) > 0.01) {
      _moveVec.addScaledVector(_forward, -this.joystickY);
      _moveVec.addScaledVector(_right, this.joystickX);
    }

    // Camera keyboard rotation fallback (Q) & smooth 360° finger-flick rotational inertia
    if (this.keysHeld.has('KeyQ')) this.camYaw = wrapAngleDiff(this.camYaw + 2.1 * dt);
    if (!this.isDraggingLook && !this.isTouchRotating) {
      if (Math.abs(this.camYawVel) > 0.005 || Math.abs(this.camPitchVel) > 0.005) {
        this.camYaw = wrapAngleDiff(this.camYaw + this.camYawVel * dt);
        this.camPitch = THREE.MathUtils.clamp(
          this.camPitch + this.camPitchVel * dt,
          -0.12,
          1.32
        );
        const inertiaDecay = Math.exp(-7.5 * dt);
        this.camYawVel *= inertiaDecay;
        this.camPitchVel *= inertiaDecay;
      } else {
        this.camYawVel = 0;
        this.camPitchVel = 0;
      }
    }

    const rawMag = _moveVec.length();
    const isMoving = rawMag > 0.02;
    const analogScale = Math.min(1.0, rawMag);

    if (isMoving) {
      _moveVec.normalize();
      const targetYaw = Math.atan2(-_moveVec.x, -_moveVec.z);
      // Smoothly damp character facing direction
      const angleDiff = wrapAngleDiff(targetYaw - this.playerYaw);
      this.playerYaw += angleDiff * (1 - Math.exp(-12 * dt));
    }

    const swimming = isSwimmingAt(this.playerPos.x, this.playerPos.z);
    const shiftHeld =
      this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight');

    const { speed: baseSpeed, isSprinting: sprinting } = computeTargetMoveSpeed({
      gait: this.gait,
      shiftHeld,
      isBending: this.isBending,
      isSwimming: swimming,
      stamina: this.vitals.stamina,
    });

    const targetVx = _moveVec.x * baseSpeed * analogScale;
    const targetVz = _moveVec.z * baseSpeed * analogScale;

    const accelDamp = 1 - Math.exp(-10 * dt);
    this.playerVel.x = THREE.MathUtils.lerp(this.playerVel.x, targetVx, accelDamp);
    this.playerVel.z = THREE.MathUtils.lerp(this.playerVel.z, targetVz, accelDamp);

    // Jump buffering & Coyote time
    if (this.keysJustPressed.has('Space')) {
      this.jumpBufferTimer = 0.14;
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    if (this.isGrounded || swimming) {
      this.coyoteTimer = 0.12;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.isBending = false;
      this.playerVel.y = swimming ? 5.5 : 8.6;
      this.isGrounded = false;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.audio.playJump();
      // Takeoff stretch
      this.castaway.bodyGroup.scale.set(0.86, 1.16, 0.86);
    }

    // Apply gravity
    if (!this.isGrounded) {
      this.playerVel.y -= 21.0 * dt;
    }

    // Integrate position and clamp to outer ocean perimeter (WORLD_BOUNDARY_RADIUS = 10,600m)
    this.playerPos.x += this.playerVel.x * dt;
    this.playerPos.z += this.playerVel.z * dt;
    this.playerPos.y += this.playerVel.y * dt;

    const radialDist = Math.hypot(this.playerPos.x, this.playerPos.z);
    if (radialDist > WORLD_BOUNDARY_RADIUS) {
      const scaleBack = WORLD_BOUNDARY_RADIUS / radialDist;
      this.playerPos.x *= scaleBack;
      this.playerPos.z *= scaleBack;
    }

    // Dynamically update 3-tier LOD terrain chunks around the player
    this.updateTerrainLODChunks(this.playerPos.x, this.playerPos.z);

    const groundY = groundHeightAt(this.playerPos.x, this.playerPos.z);
    const minSurfaceY = swimming ? Math.max(groundY, WATER_LEVEL - 0.55) : groundY;

    if (this.playerPos.y <= minSurfaceY) {
      if (!this.isGrounded && this.playerVel.y < -3.0) {
        // Landing squash
        this.castaway.bodyGroup.scale.set(1.18, 0.82, 1.18);
      }
      this.playerPos.y = minSurfaceY;
      this.playerVel.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    // Sync character transform & gait animation
    const horizSpeed = Math.hypot(this.playerVel.x, this.playerVel.z);
    this.walkCycleDist += horizSpeed * dt;
    this.stepSoundDist += horizSpeed * dt;
    const inStream = freshwaterStreamInfo(this.playerPos.x, this.playerPos.z).inStream;
    if (this.stepSoundDist > 2.4 && (this.isGrounded || swimming || inStream)) {
      this.stepSoundDist = 0;
      this.audio.playFootstep(swimming || inStream);
    }

    this.castaway.root.position.copy(this.playerPos);
    this.castaway.root.rotation.y = this.playerYaw;
    this.animateCastawayRig(dt, horizSpeed > 0.35, sprinting, swimming);

    // Smooth 360-degree third-person camera orbit with terrain height protection
    const camDist = this.camDist;
    const camOffsetX = Math.sin(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetZ = Math.cos(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetY = Math.sin(this.camPitch) * camDist + 1.65;

    const desiredCamX = this.playerPos.x + camOffsetX;
    const desiredCamZ = this.playerPos.z + camOffsetZ;
    const terrainAtCam = Math.max(WATER_LEVEL + 0.5, groundHeightAt(desiredCamX, desiredCamZ) + 0.85);
    const desiredCamY = Math.max(terrainAtCam, this.playerPos.y + camOffsetY);

    _camTargetPos.set(desiredCamX, desiredCamY, desiredCamZ);
    const camDamp = 1 - Math.exp(-14 * dt);
    this.camera.position.lerp(_camTargetPos, camDamp);

    // Apply decaying trauma shake when hurt by lava
    let shakeX = 0;
    let shakeY = 0;
    if (this.cameraTrauma > 0) {
      const shake = this.cameraTrauma * this.cameraTrauma * 0.35;
      shakeX = (Math.random() - 0.5) * shake;
      shakeY = (Math.random() - 0.5) * shake;
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.8);
    }

    _camLookAt.set(
      this.playerPos.x + shakeX,
      this.playerPos.y + (this.isBending ? 1.2 : 1.55) + shakeY,
      this.playerPos.z
    );
    this.camera.lookAt(_camLookAt);
  }

  private animateCastawayRig(
    dt: number,
    isMoving: boolean,
    isSprinting: boolean,
    isSwimming: boolean
  ): void {
    // Exponentially damp squash-and-stretch scale back to (1,1,1)
    const scaleDamp = 1 - Math.exp(-10 * dt);
    this.castaway.bodyGroup.scale.lerp(_dummyObj.scale.set(1, 1, 1), scaleDamp);

    if (isSwimming) {
      // Horizontal breaststroke / freestyle swim pose
      this.castaway.bodyGroup.rotation.x = THREE.MathUtils.lerp(
        this.castaway.bodyGroup.rotation.x,
        -0.65,
        scaleDamp
      );
      this.castaway.bodyGroup.position.y = THREE.MathUtils.lerp(
        this.castaway.bodyGroup.position.y,
        0,
        scaleDamp
      );
      const swimPhase = this.elapsedSimTime * 5.5;
      this.castaway.leftArm.rotation.x = Math.sin(swimPhase) * 1.1 - 0.8;
      this.castaway.rightArm.rotation.x = Math.cos(swimPhase) * 1.1 - 0.8;
      this.castaway.leftLeg.rotation.x = Math.sin(swimPhase * 1.3) * 0.45;
      this.castaway.rightLeg.rotation.x = -Math.sin(swimPhase * 1.3) * 0.45;
      return;
    }

    // Bending / Crouching forward posture vs Upright stance on land
    const baseLean = this.isBending
      ? -0.58
      : isMoving
      ? isSprinting
        ? -0.2
        : -0.08
      : 0;
    this.castaway.bodyGroup.rotation.x = THREE.MathUtils.lerp(
      this.castaway.bodyGroup.rotation.x,
      baseLean,
      scaleDamp
    );

    const bendOffsetY = this.isBending ? -0.26 : 0;

    if (isMoving) {
      const strideFreq = this.isBending ? 1.15 : isSprinting ? 1.85 : 1.45;
      const phase = this.walkCycleDist * strideFreq;
      const swingAmp = this.isBending ? 0.38 : isSprinting ? 0.85 : 0.58;
      this.castaway.leftLeg.rotation.x = Math.sin(phase) * swingAmp + (this.isBending ? 0.35 : 0);
      this.castaway.rightLeg.rotation.x = -Math.sin(phase) * swingAmp + (this.isBending ? 0.35 : 0);
      this.castaway.leftArm.rotation.x =
        -Math.sin(phase) * swingAmp * 0.85 + (this.isBending ? -0.55 : 0);
      this.castaway.rightArm.rotation.x =
        Math.sin(phase) * swingAmp * 0.85 + (this.isBending ? -0.55 : 0);
      this.castaway.bodyGroup.position.y =
        bendOffsetY + Math.abs(Math.cos(phase)) * (this.isBending ? 0.04 : 0.08);
    } else {
      const breath = Math.sin(this.elapsedSimTime * 2.2) * 0.04;
      const legBendTarget = this.isBending ? 0.38 : 0;
      const armReachTarget = this.isBending ? -0.68 : breath;

      this.castaway.leftLeg.rotation.x = THREE.MathUtils.lerp(
        this.castaway.leftLeg.rotation.x,
        legBendTarget,
        scaleDamp
      );
      this.castaway.rightLeg.rotation.x = THREE.MathUtils.lerp(
        this.castaway.rightLeg.rotation.x,
        legBendTarget,
        scaleDamp
      );
      this.castaway.leftArm.rotation.x = THREE.MathUtils.lerp(
        this.castaway.leftArm.rotation.x,
        armReachTarget,
        scaleDamp
      );
      this.castaway.rightArm.rotation.x = THREE.MathUtils.lerp(
        this.castaway.rightArm.rotation.x,
        this.isBending ? -0.68 : -breath,
        scaleDamp
      );
      this.castaway.bodyGroup.position.y = THREE.MathUtils.lerp(
        this.castaway.bodyGroup.position.y,
        bendOffsetY,
        scaleDamp
      );
    }

    // Override right arm rotation during active Knife Slash / Melee Attack
    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer = Math.max(0, this.attackAnimTimer - dt);
      const t = 1 - this.attackAnimTimer / 0.34;
      const slashArc = Math.sin(t * Math.PI);
      this.castaway.rightArm.rotation.x = -1.45 * slashArc;
      this.castaway.rightArm.rotation.z = -0.45 * Math.cos(t * Math.PI);
    } else {
      this.castaway.rightArm.rotation.z = 0;
    }
  }

  private updateOceanAndLavaAnimation(elapsed: number, dt: number): void {
    // Gentle ocean tide bob and horizon-following XZ alignment
    this.oceanMesh.position.set(
      Math.round(this.playerPos.x / 64) * 64,
      WATER_LEVEL + Math.sin(elapsed * 1.35) * 0.14,
      Math.round(this.playerPos.z / 64) * 64
    );

    // Pulsing molten caldera glow
    const lavaPulse = 2.0 + Math.sin(elapsed * 3.4) * 0.55;
    (this.lavaCoreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = lavaPulse;
    this.calderaLight.intensity = 5.0 + Math.sin(elapsed * 4.1) * 1.4;

    // Update rising volcano smoke plume instances
    for (let i = 0; i < this.smokeParticles.length; i++) {
      const p = this.smokeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.life = 0;
        p.x = (Math.random() - 0.5) * 6.5;
        p.y = 22.5;
        p.z = (Math.random() - 0.5) * 6.5;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      const progress = p.life / p.maxLife;
      const s = p.scale * (0.7 + progress * 2.2);
      _dummyObj.position.set(p.x, p.y, p.z);
      _dummyObj.scale.set(s, s * 0.8, s);
      _dummyObj.rotation.set(elapsed * 0.2 + i, elapsed * 0.3, 0);
      _dummyObj.updateMatrix();
      this.smokeInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    this.smokeInstanced.instanceMatrix.needsUpdate = true;

    // Update glowing volcano embers
    for (let i = 0; i < this.emberParticles.length; i++) {
      const e = this.emberParticles[i];
      e.life += dt;
      if (e.life >= e.maxLife) {
        e.life = 0;
        const a = Math.random() * Math.PI * 2;
        const rad = Math.random() * 14;
        e.x = Math.cos(a) * rad;
        e.y = 20 + Math.random() * 5;
        e.z = Math.sin(a) * rad;
      } else {
        e.x += (e.vx + Math.sin(elapsed * 2 + i) * 0.5) * dt;
        e.y += e.vy * dt;
        e.z += (e.vz + Math.cos(elapsed * 2 + i) * 0.5) * dt;
      }
      const scale = 1 - (e.life / e.maxLife) * 0.7;
      _dummyObj.position.set(e.x, e.y, e.z);
      _dummyObj.scale.setScalar(scale);
      _dummyObj.rotation.set(elapsed * 3, i, 0);
      _dummyObj.updateMatrix();
      this.emberInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    this.emberInstanced.instanceMatrix.needsUpdate = true;

    // Animate subtle ripples along the freshwater stream ribbon
    if (this.streamRibbonMesh) {
      const pos = this.streamRibbonMesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const t = Math.max(0, Math.min(1, (z - 33) / 35));
        const baseY = 6.2 * Math.pow(1 - t, 1.35) + 0.12;
        const wave = Math.sin(elapsed * 3.8 + z * 1.6) * 0.025;
        pos.setY(i, baseY + wave);
      }
      pos.needsUpdate = true;
    }

    // Animate rising waterfall mist particles at plunge pool (-11.5, 37.5)
    if (this.waterfallMistInstanced) {
      for (let i = 0; i < this.waterfallMistParticles.length; i++) {
        const m = this.waterfallMistParticles[i];
        m.life += dt;
        if (m.life >= m.maxLife) {
          m.life = 0;
          m.x = -11.5 + (Math.random() - 0.5) * 2.8;
          m.y = 6.4 + Math.random() * 1.5;
          m.z = 37.5 + (Math.random() - 0.5) * 2.6;
        } else {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          m.z += m.vz * dt;
        }
        const progress = m.life / m.maxLife;
        const scale = m.scale * (0.8 + progress * 1.8);
        _dummyObj.position.set(m.x, m.y, m.z);
        _dummyObj.scale.set(scale, scale * 0.7, scale);
        _dummyObj.rotation.set(0, elapsed * 0.4 + i, 0);
        _dummyObj.updateMatrix();
        this.waterfallMistInstanced.setMatrixAt(i, _dummyObj.matrix);
      }
      this.waterfallMistInstanced.instanceMatrix.needsUpdate = true;
    }

    // Animate drifting jungle canopy spores / sunlit fireflies
    if (this.jungleSporeInstanced) {
      for (let i = 0; i < this.jungleSporeParticles.length; i++) {
        const sp = this.jungleSporeParticles[i];
        sp.phase += dt * sp.speed;
        const bob = Math.sin(sp.phase) * 0.45;
        const swayX = Math.cos(sp.phase * 0.7) * 0.35;
        _dummyObj.position.set(sp.x + swayX, sp.baseY + bob, sp.z);
        _dummyObj.scale.setScalar(0.8 + Math.sin(sp.phase * 2) * 0.3);
        _dummyObj.updateMatrix();
        this.jungleSporeInstanced.setMatrixAt(i, _dummyObj.matrix);
      }
      this.jungleSporeInstanced.instanceMatrix.needsUpdate = true;
    }

    // Animate shoreline surf foam swell surging against the beach
    if (this.shorelineFoamMesh) {
      const swell = Math.sin(elapsed * 1.6) * 0.5 + 0.5;
      const scaleSwell = 1.0 + swell * 0.016;
      this.shorelineFoamMesh.scale.set(scaleSwell, 1, scaleSwell);
      const foamMat = this.shorelineFoamMesh.material as THREE.MeshStandardMaterial;
      if (foamMat) {
        foamMat.opacity = 0.32 + swell * 0.28;
      }
    }

    // Animate waterfall splash and plunge pool ripples
    if (this.waterfallSplashGroup) {
      for (let i = 0; i < this.waterfallSplashGroup.children.length; i++) {
        const ring = this.waterfallSplashGroup.children[i] as THREE.Mesh;
        const cycle = ((elapsed * 2.2 + i * 0.33) % 1.0);
        const ringScale = 0.75 + cycle * 1.85;
        ring.scale.set(ringScale, 1, ringScale);
        const ringMat = ring.material as THREE.MeshBasicMaterial;
        if (ringMat) {
          ringMat.opacity = (1.0 - cycle) * 0.55;
        }
      }
    }
  }

  private updateWildlifeAndBirds(elapsed: number, dt: number): void {
    const refX = this.playerPos.x;
    const refZ = this.playerPos.z;
    const wildlifeCullDistSq = 68 * 68;
    const pickupCullDistSq = 72 * 72;
    const pickupSpinDistSq = 48 * 48;

    // Ground wildlife 3D physics, terrain slope alignment, hazard avoidance & combat AI
    const isNight = evaluateDayNightCycle(this.timeOfDay).phase === 'Night';
    const playerHorizSpeed = Math.hypot(this.playerVel.x, this.playerVel.z);
    const playerMoving = playerHorizSpeed > 0.35;
    const playerSprinting = playerHorizSpeed > 7.2;

    for (const actor of this.wildlifeActors) {
      if (actor.hostile && (actor.hp ?? 1) <= 0) {
        if (actor.group.visible) actor.group.visible = false;
        continue;
      }

      const dxHome = actor.physics.homeX - refX;
      const dzHome = actor.physics.homeZ - refZ;
      if (dxHome * dxHome + dzHome * dzHome > wildlifeCullDistSq) {
        if (actor.group.visible) actor.group.visible = false;
        continue;
      }
      if (!actor.group.visible) actor.group.visible = true;

      const stepRes = stepAnimalPhysics(actor.physics, {
        dt,
        elapsed,
        playerX: refX,
        playerY: this.playerPos.y,
        playerZ: refZ,
        playerMoving,
        playerSprinting,
        isNight,
        gameState: this.gameState,
      });

      const p = stepRes.state;
      actor.physics = p;
      actor.hp = p.hp;
      actor.attackCooldown = p.attackCooldown;
      actor.hitFlashTimer = p.hitFlashTimer;

      // Apply soft capsule collision separation if player overlaps creature
      if (stepRes.playerPushX !== 0 || stepRes.playerPushZ !== 0) {
        this.playerPos.x += stepRes.playerPushX;
        this.playerPos.z += stepRes.playerPushZ;
      }

      if (stepRes.attackedPlayer && stepRes.dealtDamage > 0) {
        this.vitals.hp = Math.max(0, this.vitals.hp - stepRes.dealtDamage);
        this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.42);
        this.audio.playLavaBurn();
        const cName = actor.kind === 'boar' ? 'Wild Boar' : 'Giant Reef Crab';
        this.showToast(
          `${cName} attacked you (-${stepRes.dealtDamage} HP)! Press [K] or Attack button to fight back!`
        );
      }

      // Species-specific procedural gait articulation & terrain-aligned orientation
      const moveSpd = Math.hypot(p.vx, p.vz);
      const strideFactor = Math.min(1.0, moveSpd / Math.max(0.5, p.speed));
      let strideBounceY = 0;
      let gaitPitchMod = 0;
      let gaitYawMod = 0;
      let gaitRollMod = 0;

      if (actor.kind === 'crab') {
        strideBounceY = p.isGrounded ? Math.abs(Math.sin(p.gaitCycle * 9.5)) * 0.035 * strideFactor : 0;
        gaitRollMod = Math.sin(p.gaitCycle * 9.5) * 0.085 * strideFactor;
      } else if (actor.kind === 'lizard') {
        // Reptilian S-curve body wiggle while darting
        gaitYawMod = Math.sin(p.gaitCycle * 8.0) * 0.14 * strideFactor;
        gaitRollMod = Math.cos(p.gaitCycle * 8.0) * 0.05 * strideFactor;
      } else if (actor.kind === 'monkey') {
        gaitPitchMod = p.isGrounded
          ? Math.sin(p.gaitCycle * 5.0) * 0.08 * strideFactor
          : THREE.MathUtils.clamp(-p.vy * 0.06, -0.28, 0.28);
      } else if (actor.kind === 'boar') {
        strideBounceY = p.isGrounded ? Math.abs(Math.sin(p.gaitCycle * 5.6)) * 0.065 * strideFactor : 0;
        gaitRollMod = Math.sin(p.gaitCycle * 5.6) * 0.06 * strideFactor;
        gaitPitchMod =
          (p.behavior === 'chase' ? -0.09 : 0) +
          Math.cos(p.gaitCycle * 5.6) * 0.045 * strideFactor;
      }

      actor.group.position.set(p.x, p.y + strideBounceY, p.z);
      actor.group.rotation.set(
        p.pitch + gaitPitchMod,
        p.yaw + gaitYawMod,
        p.roll + gaitRollMod
      );

      // Squash-and-stretch impact reaction when struck (without corrupting position.y)
      if (p.hitFlashTimer > 0) {
        const flash = Math.sin((p.hitFlashTimer / 0.28) * Math.PI);
        const s = actor.baseScale;
        actor.group.scale.set(
          s * (1 + flash * 0.22),
          s * (1 - flash * 0.18),
          s * (1 + flash * 0.22)
        );
      } else {
        actor.group.scale.setScalar(actor.baseScale);
      }
    }

    // Birds soaring with aerodynamic banking roll and climb/glide pitch
    for (const bird of this.birdActors) {
      bird.angle += dt * bird.speed;
      const x = bird.orbitCenterX + Math.cos(bird.angle) * bird.orbitRadius;
      const z = bird.orbitCenterZ + Math.sin(bird.angle) * bird.orbitRadius;
      const waveArg = elapsed * 2.0 + bird.angle * 3;
      const y = bird.altitude + Math.sin(waveArg) * 1.2;
      const climbRate = Math.cos(waveArg) * 0.12;
      const bankRoll = 0.22 + Math.sin(elapsed * 1.5 + bird.angle) * 0.08;

      bird.group.position.set(x, y, z);
      bird.group.rotation.set(climbRate, -bird.angle, bankRoll);

      const flap = Math.sin(elapsed * 9.5 + bird.angle * 4) * 0.55;
      bird.leftWing.rotation.z = flap;
      bird.rightWing.rotation.z = -flap;
    }

    // Animate Sea-Drifted Supply Box bobbing in from the ocean waves onto the beach
    const supplyItem = this.interactables.find((i) => i.type === 'supply_box');
    if (supplyItem && !supplyItem.collected) {
      const drift = computeSupplyBoxDriftPosition(
        elapsed,
        this.supplyBoxShorePos.x,
        this.supplyBoxShorePos.z,
        14
      );
      supplyItem.x = drift.x;
      supplyItem.y = drift.y;
      supplyItem.z = drift.z;
      const crateMesh = this.interactableMeshes.get(supplyItem.id);
      if (crateMesh) {
        crateMesh.visible = true;
        crateMesh.position.set(drift.x, drift.y, drift.z);
        crateMesh.rotation.z = Math.sin(elapsed * 2.2) * 0.08;
        crateMesh.rotation.x = Math.cos(elapsed * 1.8) * 0.06;
        const beacon = crateMesh.getObjectByName('crate_beacon');
        if (beacon) {
          beacon.rotation.y = elapsed * 2.5;
        }
      }
    }

    // Gentle hover rotation on nearby uncollected resource pickups
    for (const item of this.interactables) {
      if (
        item.collected ||
        item.type === 'campfire' ||
        item.type === 'supply_box' ||
        item.type === 'boat_site'
      ) {
        continue;
      }
      const mesh = this.interactableMeshes.get(item.id);
      if (!mesh) continue;
      const dx = item.x - refX;
      const dz = item.z - refZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > pickupCullDistSq) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }
      if (!mesh.visible) mesh.visible = true;
      if (distSq < pickupSpinDistSq) {
        mesh.rotation.y = elapsed * 0.9;
      }
    }
  }

  private updateDayNightEnvironment(_dt: number) {
    const cycle = evaluateDayNightCycle(this.timeOfDay);
    const { sunElevation, sunAzimuth, daylightFactor, phase } = cycle;

    // Position directional sun or tropical full moon light along orbital arc centered on player
    const sunDist = 110;
    const isNight = phase === 'Night';
    const lightY = isNight
      ? Math.max(42, Math.abs(sunElevation) * sunDist + 36)
      : Math.max(16, sunElevation * sunDist + 22);
    this.sunLight.position.set(
      this.playerPos.x + (isNight ? -sunAzimuth : sunAzimuth) * sunDist,
      lightY,
      this.playerPos.z + 38
    );
    this.sunLight.target.position.set(this.playerPos.x, 0, this.playerPos.z);

    if (phase === 'Noon') {
      _color.copy(_skyNoon);
      this.sunLight.color.setHex(0xfff4d6);
      this.sunLight.intensity = 2.25;
      this.hemiLight.intensity = 0.82;
    } else if (phase === 'Dawn' || phase === 'Dusk') {
      _color.lerpColors(_skyNight, _skyGolden, Math.max(0.32, daylightFactor));
      this.sunLight.color.setHex(0xff9e5e);
      this.sunLight.intensity = 1.55;
      this.hemiLight.intensity = 0.65;
    } else {
      // Luminous tropical full-moon night so the island remains vibrant and playable during IST night hours
      _color.copy(_skyNight);
      this.sunLight.color.setHex(0x9ec5ff);
      this.sunLight.intensity = 1.38;
      this.hemiLight.intensity = 0.68;
    }

    (this.scene.background as THREE.Color).copy(_color);
    this.fog.color.copy(_color);

    // Update volumetric jungle god rays & moonlight beams
    if (this.godRaysGroup) {
      const rayMat = (this.godRaysGroup.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial;
      if (rayMat) {
        if (phase === 'Noon') {
          rayMat.color.setHex(0xfffae0);
          rayMat.opacity = 0.18 + Math.sin(this.elapsedSimTime * 1.5) * 0.04;
        } else if (phase === 'Dawn' || phase === 'Dusk') {
          rayMat.color.setHex(0xffba77);
          rayMat.opacity = 0.14 + Math.sin(this.elapsedSimTime * 1.2) * 0.03;
        } else {
          // Soft mystical moonbeams through the canopy
          rayMat.color.setHex(0xa5c9ff);
          rayMat.opacity = 0.09 + Math.sin(this.elapsedSimTime * 0.9) * 0.02;
        }
      }
    }

    // Update bioluminescent mushrooms glowing intensity in jungle
    if (this.bioluminescentShrooms.length > 0) {
      const isNightOrDusk = phase === 'Night' || phase === 'Dusk';
      const pulseBase = isNightOrDusk ? 1.2 : 0.45;
      const pulseWave = Math.sin(this.elapsedSimTime * 2.2) * 0.35;
      const targetEmissive = pulseBase + pulseWave;
      for (const shroom of this.bioluminescentShrooms) {
        shroom.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && child.material.emissive) {
            child.material.emissiveIntensity = targetEmissive;
          }
        });
      }
    }

    return cycle;
  }

  private broadcastHud(force: boolean): void {
    if (force) {
      this.lastHudBroadcast = this.elapsedSimTime;
    } else {
      this.lastHudBroadcast = this.elapsedSimTime;
    }

    const ist = getISTTimeState();
    const cycle = evaluateDayNightCycle(this.timeOfDay);
    const biome = getBiomeZoneAt(this.playerPos.x, this.playerPos.z);
    const swimming = isSwimmingAt(this.playerPos.x, this.playerPos.z);
    const inLava = isLavaHazardAt(this.playerPos.x, this.playerPos.z);

    const { item: nearest } = findNearestInteractable(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.interactables,
      this.isBending ? 5.2 : 4.4
    );

    let nearbyPrompt: string | null = null;
    if (nearest) {
      if (nearest.type === 'supply_box') {
        nearbyPrompt = '[E] Pry Open Sea-Drifted Supply Box (Knife, Rope & Island Map)';
      } else if (nearest.type === 'boat_site') {
        if (this.boatStage >= 3) {
          nearbyPrompt = '[E] Board Escape Boat & Sail to Freedom!';
        } else {
          const req = getBoatStageRequirement(this.boatStage);
          nearbyPrompt = req
            ? `[E] Build Escape Boat — ${req.title} (${req.woodNeeded} Wood, ${req.ropeNeeded} Rope${
                req.provisionsNeeded ? `, ${req.provisionsNeeded} Food/Drink` : ''
              })`
            : '[E] Build Escape Boat';
        }
      } else if (nearest.type === 'campfire') {
        nearbyPrompt = `[E] Light ${nearest.label}`;
      } else {
        nearbyPrompt = `[E] Collect ${nearest.label}`;
      }
    } else {
      const streamInfo = freshwaterStreamInfo(this.playerPos.x, this.playerPos.z);
      if (streamInfo.nearStream) {
        nearbyPrompt = streamInfo.isWaterfall
          ? '[E] Drink Waterfall Plunge Pool (+35 Hydration)'
          : '[E] Drink Freshwater Stream (+35 Hydration)';
      }
    }

    // Check if a hostile creature is nearby for HUD combat target bar
    let nearbyCreature: { label: string; hp: number; maxHp: number } | null = null;
    let bestCreatureDist = 11.0;
    for (const actor of this.wildlifeActors) {
      if (!actor.hostile || (actor.hp ?? 0) <= 0) continue;
      const d = Math.hypot(
        this.playerPos.x - actor.group.position.x,
        this.playerPos.z - actor.group.position.z
      );
      if (d < bestCreatureDist) {
        bestCreatureDist = d;
        nearbyCreature = {
          label: actor.kind === 'boar' ? 'Wild Tusked Boar' : 'Giant Reef Crab',
          hp: actor.hp ?? 40,
          maxHp: actor.maxHp ?? 40,
        };
      }
    }

    const driftState = computeSupplyBoxDriftPosition(
      this.elapsedSimTime,
      this.supplyBoxShorePos.x,
      this.supplyBoxShorePos.z,
      14
    );

    let questObjective = '';
    if (!this.supplyBoxOpened) {
      questObjective = driftState.isAshore
        ? '1. Spot & Open the Sea-Drifted Supply Box washed ashore on the SW Beach (Knife, Rope & Map)'
        : '1. Watch the Sea Supply Box drifting in from the ocean waves & open it on the SW Shore';
    } else if (this.boatStage === 0) {
      questObjective =
        '2. Build Escape Boat Hull at Beach Shipyard (Need 3 Wood & 1 Rope) — Eat, Drink & Fight Creatures';
    } else if (this.boatStage === 1) {
      questObjective =
        '3. Build Outrigger & Deck at Shipyard (Need 3 Wood & 1 Rope) — Defeat Boars/Crabs for extra Rope';
    } else if (this.boatStage === 2) {
      questObjective =
        '4. Raise Mast & Sail at Shipyard (Need 3 Wood, 1 Rope & 2 Coconuts/Food for Voyage)';
    } else {
      questObjective = '5. Escape Boat Complete! Press [E] at the Boat Shipyard to Sail to Freedom!';
    }

    const totalCampfires = this.interactables.filter((i) => i.type === 'campfire').length;
    const campfireSites: CampfireSiteInfo[] = this.interactables
      .filter((i) => i.type === 'campfire')
      .map((c) => ({
        id: c.id,
        label: c.label,
        x: c.x,
        z: c.z,
        lit: !!c.lit,
      }));

    this.callbacks.onHudUpdate({
      state: this.gameState,
      vitals: { ...this.vitals },
      inventory: { ...this.inventory },
      biome,
      dayPhase: this.useRealTimeIST ? ist.phase : cycle.phase,
      clockLabel: this.useRealTimeIST ? ist.clockLabel : cycle.clockLabel,
      istClockWithSeconds: this.useRealTimeIST ? ist.clockWithSeconds : cycle.clockWithSeconds,
      istDateLabel: ist.dateLabel,
      isRealTimeIST: this.useRealTimeIST,
      timeOfDay: this.timeOfDay,
      isSwimming: swimming,
      inLava,
      nearbyPrompt,
      statusToast: this.statusToast,
      campfiresLit: this.campfiresLit,
      totalCampfires,
      daysSurvived: this.daysSurvived,
      resourcesCollected: this.resourcesCollected,
      victory: this.victory,
      gait: this.gait,
      isBending: this.isBending,
      joystickX: this.joystickX,
      joystickY: this.joystickY,
      playerX: this.playerPos.x,
      playerZ: this.playerPos.z,
      playerYaw: this.playerYaw,
      camYaw: this.camYaw,
      camCompassDeg: camYawToCompassDegrees(this.camYaw),
      volcanoX: 0,
      volcanoZ: 0,
      campfires: campfireSites,
      boatStage: this.boatStage,
      supplyBoxOpened: this.supplyBoxOpened,
      supplyBoxPos: { x: driftState.x, z: driftState.z, isAshore: driftState.isAshore },
      boatPos: { x: this.boatSitePos.x, z: this.boatSitePos.z },
      creaturesDefeated: this.creaturesDefeated,
      nearbyCreature,
      questObjective,
    });
  }

  public dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('pointermove', this.onCanvasPointerMove);
    window.removeEventListener('pointerup', this.onCanvasPointerUp);
    window.removeEventListener('pointercancel', this.onCanvasPointerUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    const dom = this.renderer?.domElement;
    if (dom) {
      dom.removeEventListener('pointerdown', this.onCanvasPointerDown);
      dom.removeEventListener('touchstart', this.onCanvasTouchStart);
      dom.removeEventListener('touchmove', this.onCanvasTouchMove);
      dom.removeEventListener('touchend', this.onCanvasTouchEnd);
      dom.removeEventListener('touchcancel', this.onCanvasTouchEnd);
      dom.removeEventListener('wheel', this.onCanvasWheel);
      dom.removeEventListener('mousedown', this.onMouseDown);
    }
    this.resizeObserver?.disconnect();
    this.audio.dispose();
    this.renderer.dispose();
  }
}

function wrapAngleDiff(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
