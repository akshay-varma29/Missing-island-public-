import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  groundHeightAt,
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
  MovementGait,
  BoatBuildStage,
  CampfireSiteInfo,
  WATER_LEVEL,
  WORLD_BOUNDARY_RADIUS,
  freshwaterStreamInfo,
  drinkFreshwater,
  applyAnimalKnockback,
} from './rules';
import {
  buildCastawayCharacter,
  CastawayRig,
} from './worldBuilders';
import { IslandAudioEngine } from './audio';
import {
  DeveloperModeState,
  CameraViewMode,
  AerialPresetId,
  createInitialDeveloperModeState,
  getAerialPreset,
  computeAerialCameraPosition,
  lerpCameraTransform,
  stepAerialPan,
  computeOptimalFogDensity,
  clampAerialAltitude,
  formatAerialReadout,
  DEFAULT_GROUND_FOG_DENSITY,
} from './developerMode';
import { TerrainSystem } from './terrainSystem';
import { FloraSystem } from './floraSystem';
import { WaterAndAtmosphereSystem } from './waterSystem';
import { ActorsAndPickupsSystem, animateCastawayRig } from './actorsSystem';

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
  devMode: {
    enabled: boolean;
    viewMode: CameraViewMode;
    activePresetId: AerialPresetId | null;
    altitude: number;
    altitudeLabel: string;
    targetCoords: string;
    compassHeading: number;
    clearSkies: boolean;
  };
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

  // Modular subsystems
  private terrain!: TerrainSystem;
  private flora!: FloraSystem;
  private water!: WaterAndAtmosphereSystem;
  private actors!: ActorsAndPickupsSystem;
  private castaway!: CastawayRig;

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

  // Developer Mode & Aerial Camera State
  private devState: DeveloperModeState = createInitialDeveloperModeState();

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
    this.terrain = new TerrainSystem(this.scene, this.isHeadless);
    this.water = new WaterAndAtmosphereSystem(this.scene);
    this.flora = new FloraSystem(this.scene, this.isHeadless);
    this.actors = new ActorsAndPickupsSystem(
      this.scene,
      this.supplyBoxShorePos,
      this.boatSitePos
    );
    this.initPlayer();
    this.bindEvents();

    // Pre-compile shaders once
    this.renderer.compile(this.scene, this.camera);
    this.water.updateDayNightEnvironment(
      this.timeOfDay,
      this.elapsedSimTime,
      this.playerPos.x,
      this.playerPos.z,
      this.sunLight,
      this.hemiLight,
      this.fog,
      this.flora.godRaysGroup
    );
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

    // Extended far plane (24,000m) so both ground 3rd-person and high-altitude 20km aerial views render cleanly
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.5, 24000);

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

    if (this.gameState === 'title' && (code === 'Enter' || code === 'Space')) {
      e.preventDefault();
      this.startGame();
      return;
    }

    if (
      (code === 'Escape' || code === 'KeyP') &&
      (this.gameState === 'playing' || this.gameState === 'paused')
    ) {
      e.preventDefault();
      this.togglePause();
      return;
    }

    if (this.gameState !== 'playing') return;

    if (code === 'KeyE') {
      this.triggerInteract();
    } else if (code === 'KeyK' || code === 'KeyX') {
      this.triggerAttack();
    } else if (code === 'KeyC') {
      this.toggleBend();
    } else if (code === 'KeyV') {
      if (this.devState.viewMode !== 'third_person') {
        this.setCameraViewMode('third_person');
      } else if (e.shiftKey) {
        this.flipCamera180();
      } else {
        this.setCameraViewMode('aerial_sanctuary');
      }
    } else if (code === 'Backquote' || code === 'F2') {
      e.preventDefault();
      this.toggleDeveloperMode();
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
    if (this.devState.viewMode !== 'third_person') {
      const yawSens = isTouch ? 0.007 : 0.005;
      const pitchSens = isTouch ? 0.005 : 0.0035;
      this.devState.yawRad = wrapAngleDiff(this.devState.yawRad - dx * yawSens);
      this.devState.pitchRad = THREE.MathUtils.clamp(
        this.devState.pitchRad + dy * pitchSens,
        0.35,
        1.54
      );
      if (zoomDelta !== 0) {
        this.devState.altitude = clampAerialAltitude(this.devState.altitude + zoomDelta * 50);
      }
      this.broadcastHud(false);
      return;
    }

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
    if (this.lookPointers.size > 0) return;
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
    if (this.devState.viewMode !== 'third_person') {
      const delta = e.deltaY * 0.45;
      this.devState.altitude = clampAerialAltitude(this.devState.altitude + delta);
      this.broadcastHud(false);
      return;
    }
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

    this.actors.resetAll();

    this.castaway.root.position.copy(this.playerPos);
    this.castaway.root.rotation.set(0, 0, 0);
    this.terrain.updateLODChunks(spawnX, spawnZ, true);

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

  public toggleDeveloperMode(force?: boolean): void {
    const next = typeof force === 'boolean' ? force : !this.devState.enabled;
    this.devState.enabled = next;
    if (!next && this.devState.viewMode !== 'third_person') {
      this.setCameraViewMode('third_person');
    }
    this.showToast(
      next ? 'Developer Mode Active — Use Aerial View or Presets [V]' : 'Developer Mode Closed'
    );
    this.broadcastHud(true);
  }

  public setCameraViewMode(mode: CameraViewMode, presetId?: AerialPresetId): void {
    this.devState.viewMode = mode;
    if (mode === 'third_person') {
      this.devState.targetPresetId = null;
      this.terrain.updateLODChunks(this.playerPos.x, this.playerPos.z);
      this.showToast('Camera switched to 3rd-Person Player View [V to switch]');
    } else {
      this.devState.enabled = true;
      if (presetId) {
        this.selectAerialPreset(presetId);
      } else if (mode === 'aerial_sanctuary') {
        this.selectAerialPreset('sanctuary');
      } else if (mode === 'aerial_island_20km') {
        this.selectAerialPreset('island_20km');
      } else {
        this.devState.targetX = this.playerPos.x;
        this.devState.targetZ = this.playerPos.z;
        this.devState.altitude = 120;
        this.devState.pitchRad = 1.25;
        this.devState.yawRad = this.camYaw;
      }
      this.terrain.updateLODChunks(this.devState.targetX, this.devState.targetZ);
      this.showToast("Aerial Bird's-Eye View Active — Press [V] anytime to return to 3rd-Person");
    }
    this.broadcastHud(true);
  }

  public selectAerialPreset(presetId: AerialPresetId): void {
    const p = getAerialPreset(presetId);
    this.devState.enabled = true;
    this.devState.targetPresetId = presetId;
    this.devState.viewMode =
      presetId === 'island_20km' ? 'aerial_island_20km' : 'aerial_sanctuary';
    this.devState.targetX = p.targetX;
    this.devState.targetZ = p.targetZ;
    this.devState.altitude = p.altitude;
    this.devState.pitchRad = (p.pitchDeg * Math.PI) / 180;
    this.devState.yawRad = (p.yawDeg * Math.PI) / 180;
    this.terrain.updateLODChunks(this.devState.targetX, this.devState.targetZ);
    this.showToast(`Aerial Vantage: ${p.label} (Alt: ${p.altitude}m)`);
    this.broadcastHud(true);
  }

  public setAerialAltitude(alt: number): void {
    this.devState.altitude = clampAerialAltitude(alt);
    this.broadcastHud(false);
  }

  public rotateAerialCamera(deltaYawRad: number, deltaPitchRad = 0): void {
    this.devState.yawRad = wrapAngleDiff(this.devState.yawRad + deltaYawRad);
    this.devState.pitchRad = THREE.MathUtils.clamp(
      this.devState.pitchRad + deltaPitchRad,
      0.35,
      1.54
    );
    this.broadcastHud(false);
  }

  public teleportPlayerToAerialTarget(): void {
    this.teleportTo(this.devState.targetX, this.devState.targetZ, this.devState.yawRad);
    this.setCameraViewMode('third_person');
    this.showToast(
      `Teleported Castaway to Aerial View Focus (${Math.round(this.devState.targetX)}m, ${Math.round(
        this.devState.targetZ
      )}m)`
    );
  }

  public toggleDevClearSkies(): boolean {
    this.devState.clearSkies = !this.devState.clearSkies;
    this.showToast(
      this.devState.clearSkies
        ? 'Aerial Clear Skies Enabled (Infinite Horizon)'
        : 'Natural Tropical Fog Enabled'
    );
    this.broadcastHud(true);
    return this.devState.clearSkies;
  }

  public getDeveloperModeState(): DeveloperModeState {
    return { ...this.devState };
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
    this.terrain.updateLODChunks(x, z, true);

    const camDist = this.camDist;
    const camOffsetX = Math.sin(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetZ = Math.cos(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetY = Math.sin(this.camPitch) * camDist + 1.65;
    const desiredCamX = this.playerPos.x + camOffsetX;
    const desiredCamZ = this.playerPos.z + camOffsetZ;
    const terrainAtCam = Math.max(
      WATER_LEVEL + 0.5,
      groundHeightAt(desiredCamX, desiredCamZ) + 0.85
    );
    const desiredCamY = Math.max(terrainAtCam, this.playerPos.y + camOffsetY);
    this.camera.position.set(desiredCamX, desiredCamY, desiredCamZ);
    this.camera.lookAt(this.playerPos.x, this.playerPos.y + 1.55, this.playerPos.z);

    this.water.updateOceanAndLavaAnimation(
      this.elapsedSimTime,
      0.016,
      this.playerPos.x,
      this.playerPos.z,
      this.calderaLight
    );
    this.water.updateDayNightEnvironment(
      this.timeOfDay,
      this.elapsedSimTime,
      this.playerPos.x,
      this.playerPos.z,
      this.sunLight,
      this.hemiLight,
      this.fog,
      this.flora.godRaysGroup
    );
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
    this.water.updateDayNightEnvironment(
      this.timeOfDay,
      this.elapsedSimTime,
      this.playerPos.x,
      this.playerPos.z,
      this.sunLight,
      this.hemiLight,
      this.fog,
      this.flora.godRaysGroup
    );
    this.renderer.render(this.scene, this.camera);
    this.broadcastHud(true);
  }

  public triggerAttack(): void {
    if (this.gameState !== 'playing') return;
    if (this.attackAnimTimer > 0.12) return;
    this.attackAnimTimer = 0.34;
    this.audio.playJump();

    const combatTargets = this.actors.wildlifeActors
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

    for (const actor of this.actors.wildlifeActors) {
      if (
        !actor.hostile &&
        Math.hypot(actor.physics.x - this.playerPos.x, actor.physics.z - this.playerPos.z) < 6.5
      ) {
        actor.physics = {
          ...actor.physics,
          behavior: 'flee',
          fleeTimer: Math.max(actor.physics.fleeTimer, 3.0),
        };
      }
    }

    if (res.hitTargetId) {
      const actor = this.actors.wildlifeActors.find((a) => a.id === res.hitTargetId);
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
          this.showToast(`Defeated ${creatureName}! Harvested +1 Meat (Food) & +1 Sinew Rope!`);
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

    const streamInfo = freshwaterStreamInfo(this.playerPos.x, this.playerPos.z);

    const { item } = findNearestInteractable(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.actors.interactables,
      this.isBending ? 5.4 : 4.6
    );

    if (
      streamInfo.nearStream &&
      (!item || Math.hypot(this.playerPos.x - item.x, this.playerPos.z - item.z) > 2.8)
    ) {
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
      const mesh = this.actors.interactableMeshes.get(item.id);
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
        const mesh = this.actors.interactableMeshes.get(item.id);
        if (mesh) {
          this.actors.syncBoatShipyardMesh(mesh, this.boatStage);
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
        const mesh = this.actors.interactableMeshes.get(item.id);
        const flame = mesh?.getObjectByName('campfire_flame');
        if (flame) flame.visible = true;
        this.audio.playPickup();
        this.vitals.hp = Math.min(this.vitals.maxHp, this.vitals.hp + 30);

        const totalCampfires = this.actors.interactables.filter(
          (i) => i.type === 'campfire'
        ).length;
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

    if (!canStoreInBackpack(this.inventory, 1, DEFAULT_BACKPACK_CAPACITY)) {
      const storage = getBackpackStorageState(this.inventory, DEFAULT_BACKPACK_CAPACITY);
      this.showToast(
        `Backpack Full (${storage.usedSlots}/${storage.maxSlots} slots)! Open Backpack [B] to consume or drop items.`
      );
      this.broadcastHud(true);
      return;
    }

    item.collected = true;
    const mesh = this.actors.interactableMeshes.get(item.id);
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

    const isAerial = this.devState.viewMode !== 'third_person';
    const focusX = isAerial ? this.devState.targetX : this.playerPos.x;
    const focusZ = isAerial ? this.devState.targetZ : this.playerPos.z;

    // Animate ocean, lava, waterfall mist, stream waves, and wildlife
    this.water.updateOceanAndLavaAnimation(
      this.elapsedSimTime,
      dt,
      focusX,
      focusZ,
      this.calderaLight
    );

    this.actors.updateWildlifeAndBirds({
      elapsed: this.elapsedSimTime,
      dt,
      timeOfDay: this.timeOfDay,
      gameState: this.gameState,
      playerPos: this.playerPos,
      playerVel: this.playerVel,
      cullFocusX: focusX,
      cullFocusZ: focusZ,
      isAerial,
      onPlayerAttacked: (dealtDamage, kind) => {
        this.vitals.hp = Math.max(0, this.vitals.hp - dealtDamage);
        this.cameraTrauma = Math.min(1.0, this.cameraTrauma + 0.42);
        this.audio.playLavaBurn();
        const cName = kind === 'boar' ? 'Wild Boar' : 'Giant Reef Crab';
        this.showToast(
          `${cName} attacked you (-${dealtDamage} HP)! Press [K] or Attack button to fight back!`
        );
      },
    });

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

    const dayState = this.water.updateDayNightEnvironment(
      this.timeOfDay,
      this.elapsedSimTime,
      this.playerPos.x,
      this.playerPos.z,
      this.sunLight,
      this.hemiLight,
      this.fog,
      this.flora.godRaysGroup
    );

    if (this.gameState === 'title') {
      const sway = Math.sin(this.elapsedSimTime * 0.45) * 1.4;
      this.camera.position.set(3.2 + sway, 3.1, 72.5);
      this.camera.lookAt(0, 8.5, 18);
      this.attackAnimTimer = animateCastawayRig({
        castaway: this.castaway,
        dt,
        elapsedSimTime: this.elapsedSimTime,
        walkCycleDist: this.walkCycleDist,
        isMoving: false,
        isSprinting: false,
        isSwimming: false,
        isBending: this.isBending,
        attackAnimTimer: this.attackAnimTimer,
      });
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
    const nearLitCampfire = this.actors.interactables.some(
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

    // Update spatial ambient audio
    const distFromCenter = Math.hypot(this.playerPos.x, this.playerPos.z);
    const streamInfo = freshwaterStreamInfo(this.playerPos.x, this.playerPos.z);
    const distToWaterfall = Math.hypot(this.playerPos.x - -12.5, this.playerPos.z - 34.0);
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
    const isAerial = this.devState.viewMode !== 'third_person';

    if (isAerial) {
      // In Aerial mode: WASD / Arrow keys and joystick pan the aerial target across the map
      let fwd = 0;
      let rgt = 0;
      if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) fwd += 1;
      if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) fwd -= 1;
      if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) rgt += 1;
      if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) rgt -= 1;

      if (Math.abs(this.joystickY) > 0.05) fwd -= this.joystickY;
      if (Math.abs(this.joystickX) > 0.05) rgt += this.joystickX;

      const turbo = this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight');
      const altScale = Math.max(1, this.devState.altitude / 80);
      const panSpeed = (turbo ? 150 : 55) * Math.sqrt(altScale);

      const nextTarget = stepAerialPan(
        {
          targetX: this.devState.targetX,
          targetZ: this.devState.targetZ,
          yawRad: this.devState.yawRad,
        },
        { forward: fwd, right: rgt },
        panSpeed,
        dt
      );
      this.devState.targetX = nextTarget.targetX;
      this.devState.targetZ = nextTarget.targetZ;

      if (this.keysHeld.has('KeyQ')) {
        this.devState.yawRad = wrapAngleDiff(this.devState.yawRad + 1.8 * dt);
      }
      if (this.keysHeld.has('KeyE')) {
        this.devState.yawRad = wrapAngleDiff(this.devState.yawRad - 1.8 * dt);
      }
      if (this.keysHeld.has('KeyR') || this.keysHeld.has('Equal')) {
        this.devState.altitude = clampAerialAltitude(
          this.devState.altitude + 180 * dt * Math.sqrt(altScale)
        );
      }
      if (this.keysHeld.has('KeyF') || this.keysHeld.has('Minus')) {
        this.devState.altitude = clampAerialAltitude(
          this.devState.altitude - 180 * dt * Math.sqrt(altScale)
        );
      }

      // Dynamically update LOD chunks around the aerial focal point
      this.terrain.updateLODChunks(this.devState.targetX, this.devState.targetZ);

      // Castaway character rests safely in place while developer surveys area from above
      this.playerVel.set(0, 0, 0);
      this.castaway.root.position.copy(this.playerPos);
      this.castaway.root.rotation.y = this.playerYaw;
      this.attackAnimTimer = animateCastawayRig({
        castaway: this.castaway,
        dt,
        elapsedSimTime: this.elapsedSimTime,
        walkCycleDist: this.walkCycleDist,
        isMoving: false,
        isSprinting: false,
        isSwimming: false,
        isBending: this.isBending,
        attackAnimTimer: this.attackAnimTimer,
      });
    } else {
      // Camera-relative movement axes on XZ plane for 3rd-person gameplay
      _forward.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)).normalize();
      _right.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw)).normalize();

      _moveVec.set(0, 0, 0);
      if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) _moveVec.add(_forward);
      if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) _moveVec.sub(_forward);
      if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) _moveVec.add(_right);
      if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) _moveVec.sub(_right);

      if (Math.abs(this.joystickX) > 0.01 || Math.abs(this.joystickY) > 0.01) {
        _moveVec.addScaledVector(_forward, -this.joystickY);
        _moveVec.addScaledVector(_right, this.joystickX);
      }

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
        const yawDiff = wrapAngleDiff(targetYaw - this.playerYaw);
        const turnDamp = 1 - Math.exp(-13 * dt);
        this.playerYaw = wrapAngleDiff(this.playerYaw + yawDiff * turnDamp);
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

      const targetSpeed = isMoving ? baseSpeed * analogScale : 0;
      const accelLambda = isMoving ? 15 : 12;
      const velDamp = 1 - Math.exp(-accelLambda * dt);

      this.playerVel.x = THREE.MathUtils.lerp(
        this.playerVel.x,
        _moveVec.x * targetSpeed,
        velDamp
      );
      this.playerVel.z = THREE.MathUtils.lerp(
        this.playerVel.z,
        _moveVec.z * targetSpeed,
        velDamp
      );

      // Jump buffer & Coyote time
      if (this.keysJustPressed.has('Space')) {
        if (this.isBending) {
          this.isBending = false;
        }
        this.jumpBufferTimer = 0.14;
      }
      if (this.jumpBufferTimer > 0) {
        this.jumpBufferTimer -= dt;
      }
      if (this.isGrounded || swimming) {
        this.coyoteTimer = 0.12;
      } else if (this.coyoteTimer > 0) {
        this.coyoteTimer -= dt;
      }

      if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
        this.playerVel.y = swimming ? 6.4 : 9.4;
        this.isGrounded = false;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.audio.playJump();
        this.castaway.bodyGroup.scale.set(0.86, 1.18, 0.86);
      }

      const gravity = swimming
        ? -7.5
        : this.playerVel.y < 0
        ? -28.0
        : -20.0;
      this.playerVel.y += gravity * dt;

      this.playerPos.x += this.playerVel.x * dt;
      this.playerPos.z += this.playerVel.z * dt;
      this.playerPos.y += this.playerVel.y * dt;

      // Keep player within the 10 km expanded island & surrounding ocean boundary
      const radialDist = Math.hypot(this.playerPos.x, this.playerPos.z);
      if (radialDist > WORLD_BOUNDARY_RADIUS) {
        const scaleBack = WORLD_BOUNDARY_RADIUS / radialDist;
        this.playerPos.x *= scaleBack;
        this.playerPos.z *= scaleBack;
      }

      // Dynamically update 3-tier LOD terrain chunks around the player
      this.terrain.updateLODChunks(this.playerPos.x, this.playerPos.z);

      const groundY = groundHeightAt(this.playerPos.x, this.playerPos.z);
      const minSurfaceY = swimming ? Math.max(groundY, WATER_LEVEL - 0.55) : groundY;

      if (this.playerPos.y <= minSurfaceY) {
        if (!this.isGrounded && this.playerVel.y < -3.0) {
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
      this.attackAnimTimer = animateCastawayRig({
        castaway: this.castaway,
        dt,
        elapsedSimTime: this.elapsedSimTime,
        walkCycleDist: this.walkCycleDist,
        isMoving: horizSpeed > 0.35,
        isSprinting: sprinting,
        isSwimming: swimming,
        isBending: this.isBending,
        attackAnimTimer: this.attackAnimTimer,
      });
    }

    // 1. Third-person camera orbit position calculation with terrain height protection
    const camDist = this.camDist;
    const camOffsetX = Math.sin(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetZ = Math.cos(this.camYaw) * Math.cos(this.camPitch) * camDist;
    const camOffsetY = Math.sin(this.camPitch) * camDist + 1.65;

    const desiredCamX = this.playerPos.x + camOffsetX;
    const desiredCamZ = this.playerPos.z + camOffsetZ;
    const terrainAtCam = Math.max(
      WATER_LEVEL + 0.5,
      groundHeightAt(desiredCamX, desiredCamZ) + 0.85
    );
    const desiredCamY = Math.max(terrainAtCam, this.playerPos.y + camOffsetY);

    let shakeX = 0;
    let shakeY = 0;
    if (this.cameraTrauma > 0) {
      const shake = this.cameraTrauma * this.cameraTrauma * 0.35;
      shakeX = (Math.random() - 0.5) * shake;
      shakeY = (Math.random() - 0.5) * shake;
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.8);
    }

    const thirdPersonTransform = {
      posX: desiredCamX,
      posY: desiredCamY,
      posZ: desiredCamZ,
      lookX: this.playerPos.x + shakeX,
      lookY: this.playerPos.y + (this.isBending ? 1.2 : 1.55) + shakeY,
      lookZ: this.playerPos.z,
    };

    // Transition smoothing between 3rd-person and Aerial views
    const targetProgress = isAerial ? 1.0 : 0.0;
    const transitionRate = 3.6;
    if (this.devState.transitionProgress < targetProgress) {
      this.devState.transitionProgress = Math.min(
        targetProgress,
        this.devState.transitionProgress + dt * transitionRate
      );
    } else if (this.devState.transitionProgress > targetProgress) {
      this.devState.transitionProgress = Math.max(
        targetProgress,
        this.devState.transitionProgress - dt * transitionRate
      );
    }

    if (this.devState.transitionProgress <= 0.001) {
      // Pure 3rd Person View (Standard Gameplay)
      _camTargetPos.set(desiredCamX, desiredCamY, desiredCamZ);
      const camDamp = 1 - Math.exp(-14 * dt);
      this.camera.position.lerp(_camTargetPos, camDamp);
      _camLookAt.set(
        thirdPersonTransform.lookX,
        thirdPersonTransform.lookY,
        thirdPersonTransform.lookZ
      );
      this.camera.lookAt(_camLookAt);
      this.fog.density = DEFAULT_GROUND_FOG_DENSITY;
    } else {
      // Aerial Camera View with seamless blending
      const targetGroundY = groundHeightAt(this.devState.targetX, this.devState.targetZ);
      const aerialTransform = computeAerialCameraPosition({
        targetX: this.devState.targetX,
        targetZ: this.devState.targetZ,
        targetGroundY,
        altitude: this.devState.altitude,
        yawRad: this.devState.yawRad,
        pitchRad: this.devState.pitchRad,
      });

      const blended = lerpCameraTransform(
        thirdPersonTransform,
        aerialTransform,
        this.devState.transitionProgress
      );

      const damp = 1 - Math.exp(-12 * dt);
      _camTargetPos.set(blended.posX, blended.posY, blended.posZ);
      this.camera.position.lerp(_camTargetPos, damp);
      _camLookAt.set(blended.lookX, blended.lookY, blended.lookZ);
      this.camera.lookAt(_camLookAt);

      // Adaptive fog density so high-altitude satellite views remain crystal-clear
      this.fog.density = computeOptimalFogDensity(
        this.camera.position.y,
        this.devState.clearSkies
      );
    }
  }

  private broadcastHud(_force: boolean): void {
    this.lastHudBroadcast = this.elapsedSimTime;

    const ist = getISTTimeState();
    const cycle = evaluateDayNightCycle(this.timeOfDay);
    const biome = getBiomeZoneAt(this.playerPos.x, this.playerPos.z);
    const swimming = isSwimmingAt(this.playerPos.x, this.playerPos.z);
    const inLava = isLavaHazardAt(this.playerPos.x, this.playerPos.z);

    const { item: nearest } = findNearestInteractable(
      this.playerPos.x,
      this.playerPos.y,
      this.playerPos.z,
      this.actors.interactables,
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

    let nearbyCreature: { label: string; hp: number; maxHp: number } | null = null;
    let bestCreatureDist = 11.0;
    for (const actor of this.actors.wildlifeActors) {
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
      questObjective =
        '5. Escape Boat Complete! Press [E] at the Boat Shipyard to Sail to Freedom!';
    }

    const totalCampfires = this.actors.interactables.filter(
      (i) => i.type === 'campfire'
    ).length;
    const campfireSites: CampfireSiteInfo[] = this.actors.interactables
      .filter((i) => i.type === 'campfire')
      .map((c) => ({
        id: c.id,
        label: c.label,
        x: c.x,
        z: c.z,
        lit: !!c.lit,
      }));

    const aerialReadout = formatAerialReadout({
      targetX: this.devState.targetX,
      targetZ: this.devState.targetZ,
      altitude: this.devState.altitude,
      yawRad: this.devState.yawRad,
    });

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
      devMode: {
        enabled: this.devState.enabled,
        viewMode: this.devState.viewMode,
        activePresetId: this.devState.targetPresetId,
        altitude: this.devState.altitude,
        altitudeLabel: aerialReadout.altitudeLabel,
        targetCoords: aerialReadout.coordinates,
        compassHeading: aerialReadout.compassHeading,
        clearSkies: this.devState.clearSkies,
      },
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
