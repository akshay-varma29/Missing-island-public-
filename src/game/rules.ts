/**
 * Pure game rules, terrain math, lava hazard detection, day/night cycle,
 * and resource/inventory logic for Caldera Castaway.
 */

export type BiomeZone = 'ocean' | 'beach' | 'jungle' | 'volcano' | 'caldera';
export type DayPhase = 'Dawn' | 'Noon' | 'Dusk' | 'Night';
export type ResourceType = 'coconut' | 'wood' | 'food' | 'rope';
export type MovementGait = 'walk' | 'run';
export type BoatBuildStage = 0 | 1 | 2 | 3;

export interface Inventory {
  coconuts: number;
  wood: number;
  food: number;
  rope?: number;
  hasKnife?: boolean;
  hasRope?: boolean;
  hasMap?: boolean;
}

export interface PlayerVitals {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  thirst?: number;
  maxThirst?: number;
}

export interface InteractableItem {
  id: string;
  type: ResourceType | 'campfire' | 'supply_box' | 'boat_site';
  label: string;
  x: number;
  y: number;
  z: number;
  collected: boolean;
  lit?: boolean;
}

export const CORE_SANCTUARY_RADIUS = 88;
export const EXPANDED_ISLAND_RADIUS = 10000; // 10 km target radius
export const EXPANDED_ISLAND_DIAMETER = 20000; // 20 km target diameter
export const WORLD_BOUNDARY_RADIUS = 11400; // Walkable & swimmable world boundary outside the 10 km coastline
export const ISLAND_RADIUS = EXPANDED_ISLAND_RADIUS;
export const WATER_LEVEL = 0.0;
export const SWIM_DEPTH_THRESHOLD = -0.65;

/**
 * Deterministic 2D pseudo-noise for organic island ridges and coastline variation.
 */
export function pseudoNoise2D(x: number, z: number): number {
  const n1 = Math.sin(x * 0.065 + z * 0.045) * Math.cos(x * 0.045 - z * 0.075);
  const n2 = Math.sin(x * 0.14 - z * 0.11) * 0.45;
  const n3 = Math.cos(x * 0.27 + z * 0.23) * 0.2;
  return n1 + n2 + n3;
}

export const EXTENDED_BEACH_BELT_WIDTH = 26;
export const EXTENDED_OUTER_COAST_BEACH_WIDTH = 380;

/**
 * Computes the exact southern ocean shoreline z-coordinate at world coordinate x.
 * Stage 2 extends the starting beach seaward and laterally into sweeping golden bays,
 * while keeping z >= getSouthernCoastlineZ(x) strictly open ocean with NO land in front.
 */
export function getSouthernCoastlineZ(x: number): number {
  const shoreNoise =
    Math.sin(x * 0.05 + 0.35) * 1.55 +
    Math.cos(x * 0.12 - 0.5) * 0.9 +
    Math.sin(x * 0.006) * 2.2;
  const absX = Math.abs(x);
  const wingExtension = absX > 16 ? Math.min(1, (absX - 16) / 36) * 2.8 : 0;
  const baseShoreZ = 71.8 + wingExtension + shoreNoise;

  // As we approach the far East or West outer corners of the 20 km island (absX > 8800m),
  // the southern coastline curves northward to meet the eastern and western outer coasts
  if (absX > 8800) {
    const flankT = Math.min(1, (absX - 8800) / 1800);
    return baseShoreZ - flankT * flankT * 12000;
  }
  return baseShoreZ;
}

export const MACRO_ISLAND_CENTER_X = 0;
export const MACRO_ISLAND_CENTER_Z = -9900;
export const MACRO_ISLAND_HALF_X = 10600;
export const MACRO_ISLAND_HALF_Z = 10100;

/**
 * Computes the outer boundary radius (in meters) of the vast 20 km island landmass
 * relative to the macro island center at (MACRO_ISLAND_CENTER_X, MACRO_ISLAND_CENTER_Z).
 * The southern shoreline kisses the starting beach at z ≈ 69m, and the vast landmass
 * extends across the back side (northwards to z ≈ -19,800m, and ±9,800m East/West).
 */
export function getExpandedCoastlineRadius(angle: number): number {
  const p = 6.5;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const rx = 10800;
  const rz = 10500;
  const invR = Math.pow(
    Math.pow(Math.abs(cosA) / rx, p) +
      Math.pow(Math.abs(sinA) / rz, p),
    1 / p
  );
  const baseR = 1 / invR;
  const organicNoise =
    Math.sin(angle * 4 + 0.5) * 160 +
    Math.cos(angle * 6 - 0.8) * 120 +
    Math.sin(angle * 3 + 1.2) * 130;
  // Damp noise smoothly at southern shoreline so it aligns with the starting beach cove
  const southFactor = Math.max(0, Math.sin(angle));
  return baseR + organicNoise * (1 - 0.85 * southFactor);
}

/**
 * Computes subtle multi-scale grass color variation factors at world coordinates (x, z)
 * so the 10 km expanded grassland has natural tonal shifts without placing individual grass meshes.
 */
export function grassColorVariationAt(x: number, z: number): {
  lushness: number;
  sunWarmth: number;
  microTone: number;
} {
  const lushness =
    0.5 +
    0.5 *
      (Math.sin(x * 0.065 + z * 0.052) * 0.48 +
        Math.cos(x * 0.018 - z * 0.022) * 0.32 +
        Math.sin(x * 0.0045 + z * 0.0038) * 0.2);
  const sunWarmth =
    0.5 +
    0.5 *
      (Math.sin(x * 0.085 - z * 0.072 + 1.2) * 0.54 +
        Math.cos(x * 0.028 + z * 0.024) * 0.46);
  const microTone =
    0.5 +
    0.5 *
      (Math.sin(x * 0.16 + z * 0.13) * Math.cos(x * 0.14 - z * 0.17) * 0.72 +
        Math.sin(x * 0.04 - z * 0.05) * 0.28);
  return { lushness, sunWarmth, microTone };
}

/**
 * Computes the core sanctuary height at (x, z) for the starting beach (0, 66),
 * freshwater stream, jungle, and central volcano caldera.
 * Note: For z >= southernShoreZ, the terrain drops strictly into the ocean.
 */
function coreSanctuaryHeightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const angle = Math.atan2(z, x);

  const coastMod =
    Math.sin(angle * 3 + 0.5) * 4.2 +
    Math.cos(angle * 5 - 0.8) * 2.5 +
    Math.sin(angle * 2) * 3.0;
  const effectiveRadius = CORE_SANCTUARY_RADIUS + coastMod;

  if (r > effectiveRadius + 24) {
    return -7.5;
  }

  const normR = r / effectiveRadius;
  let height = 0;

  if (normR >= 1.0) {
    const seaProgress = Math.min(1, (r - effectiveRadius) / 22);
    height = -0.2 - seaProgress * 6.8;
  } else if (normR > 0.72) {
    const t = (1.0 - normR) / 0.28;
    height = t * 2.4 + pseudoNoise2D(x * 0.5, z * 0.5) * 0.22 * t;
  } else if (normR > 0.36) {
    const t = (0.72 - normR) / 0.36;
    const smoothT = t * t * (3 - 2 * t);
    height = 2.4 + smoothT * 6.4 + pseudoNoise2D(x, z) * 1.15;
  } else {
    const t = (0.36 - normR) / 0.36;
    const cone = 8.8 + Math.pow(t, 1.48) * 24.5;
    const ridgeNoise = pseudoNoise2D(x * 1.3, z * 1.3) * 1.2 * (1 - t * 0.5);
    height = cone + ridgeNoise;

    if (r < 13.5) {
      const craterT = 1 - r / 13.5;
      const depression = Math.pow(craterT, 1.7) * 11.5;
      height -= depression;
    }
  }

  if (r >= 9 && r <= 44) {
    const channelFactor = lavaChannelProximity(x, z);
    if (channelFactor > 0) {
      height -= channelFactor * 1.15;
    }
  }

  if (z >= 33 && z <= 69 && x < -5) {
    const streamInfo = freshwaterStreamInfo(x, z);
    if (streamInfo.streamBedDepth > 0) {
      height -= streamInfo.streamBedDepth;
    }
  }

  if (Math.abs(z - 47.5) < 0.65) {
    const streamX = freshwaterStreamX(47.5);
    const distToBridgeAxis = Math.abs(x - streamX);
    if (distToBridgeAxis < 1.9) {
      const bridgeArch = Math.cos((distToBridgeAxis / 1.9) * Math.PI * 0.5) * 0.38;
      height = Math.max(height, groundHeightAtBase(x, z) + bridgeArch);
    }
  }

  return height;
}

// ============================================================================
// STAGE 2 WORLD TOPOGRAPHY & HYDROLOGY:
// Extended Beach, Hills & Mountain Ranges, and Freshwater Lakes & Rivers
// ============================================================================

export interface Stage2TopographicPeak {
  id: string;
  name: string;
  kind: 'hill' | 'mountain';
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  heightGain: number;
  ridgeAngle: number;
}

export interface Stage2Lake {
  id: string;
  name: string;
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  waterLevel: number;
  maxDepth: number;
}

export interface Stage2River {
  id: string;
  name: string;
  width: number;
  depth: number;
  waypoints: ReadonlyArray<{ x: number; z: number; waterY: number }>;
}

export interface Stage2HydrologyInfo {
  inLake: boolean;
  inRiver: boolean;
  inWater: boolean;
  nearShore: boolean;
  waterSurfaceY: number;
  waterDepth: number;
  bedBlend: number;
  featureId: string | null;
  featureName: string | null;
}

export const STAGE2_HILLS_AND_MOUNTAINS: readonly Stage2TopographicPeak[] = [
  // Near-field & mid-field Hills (visible right from the beach & sanctuary foothills)
  {
    id: 'hill_west_bluff',
    name: 'West Headland Hill',
    kind: 'hill',
    x: -138,
    z: 6,
    radiusX: 58,
    radiusZ: 38,
    heightGain: 16.5,
    ridgeAngle: 0.24,
  },
  {
    id: 'hill_east_foothill',
    name: 'East Oasis Hill',
    kind: 'hill',
    x: 142,
    z: 8,
    radiusX: 60,
    radiusZ: 38,
    heightGain: 17.5,
    ridgeAngle: -0.26,
  },
  {
    id: 'hill_northwest_knoll',
    name: 'Emerald Tarn Hill',
    kind: 'hill',
    x: -112,
    z: -128,
    radiusX: 74,
    radiusZ: 64,
    heightGain: 21.5,
    ridgeAngle: 0.38,
  },
  {
    id: 'hill_northeast_downs',
    name: 'Sunrise Ridge Hill',
    kind: 'hill',
    x: 118,
    z: -134,
    radiusX: 78,
    radiusZ: 66,
    heightGain: 22.5,
    ridgeAngle: -0.34,
  },
  // Near-field & mid-field Mountain Peaks framing the sanctuary horizon
  {
    id: 'mtn_west_sentinel',
    name: 'West Sentinel Mountain',
    kind: 'mountain',
    x: -235,
    z: -88,
    radiusX: 96,
    radiusZ: 84,
    heightGain: 48.0,
    ridgeAngle: 0.5,
  },
  {
    id: 'mtn_east_twin_crag',
    name: 'Twin Crag Mountain',
    kind: 'mountain',
    x: 245,
    z: -94,
    radiusX: 102,
    radiusZ: 88,
    heightGain: 51.0,
    ridgeAngle: -0.46,
  },
  {
    id: 'mtn_north_crown_ridge',
    name: 'North Highland Massif',
    kind: 'mountain',
    x: -165,
    z: -265,
    radiusX: 128,
    radiusZ: 108,
    heightGain: 60.0,
    ridgeAngle: 0.18,
  },
  {
    id: 'mtn_northeast_spire',
    name: 'Cloudwatch Mountain',
    kind: 'mountain',
    x: 175,
    z: -280,
    radiusX: 134,
    radiusZ: 112,
    heightGain: 64.0,
    ridgeAngle: -0.22,
  },
  // Regional Hills & Mountain Ranges across the 20 km expanded map
  {
    id: 'hill_midwest_downs',
    name: 'Westward Rolling Hills',
    kind: 'hill',
    x: -1200,
    z: -1150,
    radiusX: 650,
    radiusZ: 540,
    heightGain: 28.0,
    ridgeAngle: 0.3,
  },
  {
    id: 'hill_central_highlands',
    name: 'Heartland Rolling Hills',
    kind: 'hill',
    x: 920,
    z: -2800,
    radiusX: 760,
    radiusZ: 620,
    heightGain: 32.0,
    ridgeAngle: -0.25,
  },
  {
    id: 'mtn_western_cordillera_south',
    name: 'Western Cordillera South',
    kind: 'mountain',
    x: -3200,
    z: -3800,
    radiusX: 1450,
    radiusZ: 1250,
    heightGain: 118.0,
    ridgeAngle: 0.42,
  },
  {
    id: 'mtn_eastern_sierra_south',
    name: 'Eastern Sierra Peak',
    kind: 'mountain',
    x: 3400,
    z: -4200,
    radiusX: 1500,
    radiusZ: 1300,
    heightGain: 125.0,
    ridgeAngle: -0.38,
  },
  {
    id: 'mtn_western_cordillera_north',
    name: 'Western Cordillera Summit',
    kind: 'mountain',
    x: -4400,
    z: -9200,
    radiusX: 1850,
    radiusZ: 1600,
    heightGain: 155.0,
    ridgeAngle: 0.35,
  },
  {
    id: 'mtn_eastern_sierra_north',
    name: 'Eastern Sierra Massif',
    kind: 'mountain',
    x: 4600,
    z: -9600,
    radiusX: 1900,
    radiusZ: 1650,
    heightGain: 162.0,
    ridgeAngle: -0.32,
  },
  {
    id: 'mtn_northern_alps_west',
    name: 'Northern Alpine Crest West',
    kind: 'mountain',
    x: -1800,
    z: -13500,
    radiusX: 1750,
    radiusZ: 1450,
    heightGain: 172.0,
    ridgeAngle: 0.15,
  },
  {
    id: 'mtn_northern_alps_east',
    name: 'Northern Alpine Crest East',
    kind: 'mountain',
    x: 2100,
    z: -14200,
    radiusX: 1800,
    radiusZ: 1500,
    heightGain: 178.0,
    ridgeAngle: -0.18,
  },
];

export const STAGE2_LAKES: readonly Stage2Lake[] = [
  // Near-field Walkable Lakes flanking the Sanctuary & Extended Beach
  {
    id: 'lake_west_lagoon',
    name: 'West Mirror Lake',
    x: -54,
    z: 32,
    radiusX: 13.5,
    radiusZ: 10.5,
    waterLevel: 2.25,
    maxDepth: 1.85,
  },
  {
    id: 'lake_east_oasis',
    name: 'East Oasis Lake',
    x: 56,
    z: 34,
    radiusX: 14.5,
    radiusZ: 11.0,
    waterLevel: 2.3,
    maxDepth: 1.9,
  },
  {
    id: 'lake_north_emerald',
    name: 'Emerald Foothill Lake',
    x: -48,
    z: -62,
    radiusX: 18.0,
    radiusZ: 14.0,
    waterLevel: 4.8,
    maxDepth: 2.2,
  },
  {
    id: 'lake_northeast_crag',
    name: 'Twin Crag Tarn',
    x: 52,
    z: -64,
    radiusX: 17.5,
    radiusZ: 13.5,
    waterLevel: 4.9,
    maxDepth: 2.2,
  },
  // Regional Lakes across the 20 km island map
  {
    id: 'lake_caldera_north',
    name: 'Lake Caldera North',
    x: -380,
    z: -520,
    radiusX: 95,
    radiusZ: 72,
    waterLevel: 5.4,
    maxDepth: 2.8,
  },
  {
    id: 'lake_sunrise_basin',
    name: 'Sunrise Basin Lake',
    x: 420,
    z: -560,
    radiusX: 105,
    radiusZ: 78,
    waterLevel: 5.6,
    maxDepth: 2.9,
  },
  {
    id: 'lake_silver_valley',
    name: 'Silver Valley Lake',
    x: 1650,
    z: -3400,
    radiusX: 380,
    radiusZ: 280,
    waterLevel: 6.2,
    maxDepth: 3.4,
  },
  {
    id: 'lake_westwatch',
    name: 'Westwatch Highland Lake',
    x: -1950,
    z: -4800,
    radiusX: 440,
    radiusZ: 320,
    waterLevel: 6.8,
    maxDepth: 3.6,
  },
  {
    id: 'lake_heartland_great',
    name: 'Heartland Great Lake',
    x: 550,
    z: -8200,
    radiusX: 680,
    radiusZ: 490,
    waterLevel: 5.8,
    maxDepth: 4.0,
  },
];

export const STAGE2_RIVERS: readonly Stage2River[] = [
  {
    id: 'river_west_channel',
    name: 'West Lagoon River',
    width: 4.4,
    depth: 1.35,
    waypoints: [
      { x: -48, z: -62, waterY: 4.8 },
      { x: -60, z: -15, waterY: 3.5 },
      { x: -54, z: 32, waterY: 2.25 },
      { x: -55, z: 52, waterY: 1.45 },
      { x: -56, z: 71.5, waterY: 0.12 },
    ],
  },
  {
    id: 'river_east_channel',
    name: 'East Oasis River',
    width: 4.5,
    depth: 1.4,
    waypoints: [
      { x: 52, z: -64, waterY: 4.9 },
      { x: 62, z: -14, waterY: 3.6 },
      { x: 56, z: 34, waterY: 2.3 },
      { x: 57, z: 52, waterY: 1.5 },
      { x: 58, z: 71.5, waterY: 0.12 },
    ],
  },
  {
    id: 'river_north_highland',
    name: 'Northern Foothill River',
    width: 4.6,
    depth: 1.45,
    waypoints: [
      { x: -380, z: -520, waterY: 5.4 },
      { x: -190, z: -280, waterY: 5.1 },
      { x: -48, z: -62, waterY: 4.8 },
      { x: 0, z: -64, waterY: 4.85 },
      { x: 52, z: -64, waterY: 4.9 },
      { x: 210, z: -290, waterY: 5.2 },
      { x: 420, z: -560, waterY: 5.6 },
    ],
  },
  {
    id: 'river_great_western',
    name: 'Great Western River',
    width: 14.0,
    depth: 2.3,
    waypoints: [
      { x: 550, z: -8200, waterY: 5.8 },
      { x: -950, z: -6400, waterY: 6.3 },
      { x: -1950, z: -4800, waterY: 6.8 },
      { x: -1180, z: -2400, waterY: 6.0 },
      { x: -380, z: -520, waterY: 5.4 },
    ],
  },
  {
    id: 'river_great_eastern',
    name: 'Great Eastern River',
    width: 14.0,
    depth: 2.3,
    waypoints: [
      { x: 550, z: -8200, waterY: 5.8 },
      { x: 1150, z: -5600, waterY: 6.0 },
      { x: 1650, z: -3400, waterY: 6.2 },
      { x: 1020, z: -1850, waterY: 5.9 },
      { x: 420, z: -560, waterY: 5.6 },
    ],
  },
];

const _HILL_MTN_TRIG = STAGE2_HILLS_AND_MOUNTAINS.map((p) => ({
  cosA: Math.cos(p.ridgeAngle),
  sinA: Math.sin(p.ridgeAngle),
  maxR: Math.max(p.radiusX, p.radiusZ),
  invRx2: 1 / (p.radiusX * p.radiusX),
  invRz2: 1 / (p.radiusZ * p.radiusZ),
}));

const EMPTY_STAGE2_HYDROLOGY: Stage2HydrologyInfo = Object.freeze({
  inLake: false,
  inRiver: false,
  inWater: false,
  nearShore: false,
  waterSurfaceY: 0,
  waterDepth: 0,
  bedBlend: 0,
  featureId: null,
  featureName: null,
});

/**
 * Computes the elevation gain contributed by Stage 2 Hills & Mountains at world coordinates (x, z).
 */
export function getStage2HillMountainElevationAt(x: number, z: number): number {
  if (z > 68 || (Math.abs(x) < 68 && z > -48)) {
    return 0;
  }
  let maxGain = 0;

  for (let i = 0; i < STAGE2_HILLS_AND_MOUNTAINS.length; i++) {
    const p = STAGE2_HILLS_AND_MOUNTAINS[i];
    const trig = _HILL_MTN_TRIG[i];
    const dx = x - p.x;
    const dz = z - p.z;
    // Quick bounding-box reject before trig
    if (Math.abs(dx) > trig.maxR || Math.abs(dz) > trig.maxR) continue;

    const lx = dx * trig.cosA - dz * trig.sinA;
    const lz = dx * trig.sinA + dz * trig.cosA;
    const normD2 = lx * lx * trig.invRx2 + lz * lz * trig.invRz2;
    if (normD2 >= 1.0) continue;

    const d = Math.sqrt(normD2);
    let gain = 0;
    if (p.kind === 'hill') {
      const bell = Math.pow(1 - normD2, 1.85);
      const ridgeMod = 1 + 0.1 * Math.sin(lx * 0.07 + lz * 0.05);
      gain = p.heightGain * bell * ridgeMod;
    } else {
      const cone = Math.pow(1 - d, 1.55) * (1 + 0.65 * d);
      const cragNoise =
        1 +
        0.16 * Math.abs(Math.sin(lx * 0.055 + lz * 0.038)) +
        0.08 * Math.cos(lx * 0.11 - lz * 0.09);
      gain = p.heightGain * cone * cragNoise;
    }

    if (gain > maxGain) {
      maxGain = gain;
    }
  }

  return maxGain;
}

/**
 * Evaluates Stage 2 Freshwater Lakes and Rivers at world coordinates (x, z).
 */
export function getStage2HydrologyAt(x: number, z: number): Stage2HydrologyInfo {
  // Fast spatial reject outside all Stage 2 lakes/rivers or inside central volcano/beach core
  if (z > 86 || z < -9400 || x < -2750 || x > 2350 || (Math.abs(x) < 35 && z > -42)) {
    return EMPTY_STAGE2_HYDROLOGY;
  }

  let lakeMatch: Stage2HydrologyInfo | null = null;

  // 1. Check Stage 2 Lakes
  for (let i = 0; i < STAGE2_LAKES.length; i++) {
    const lake = STAGE2_LAKES[i];
    const dx = x - lake.x;
    const dz = z - lake.z;
    const bankMargin = Math.max(9.5, lake.radiusX * 0.72);
    if (Math.abs(dx) > lake.radiusX + bankMargin || Math.abs(dz) > lake.radiusZ + bankMargin) {
      continue;
    }

    const shoreRipple =
      1 +
      0.06 * Math.sin(dx * 0.18 + dz * 0.14) +
      0.04 * Math.cos(dx * 0.11 - dz * 0.21);
    const effRx = lake.radiusX * shoreRipple;
    const effRz = lake.radiusZ * shoreRipple;
    const normR = Math.hypot(dx / effRx, dz / effRz);

    if (normR <= 1.72) {
      const inLake = normR <= 1.0;
      const nearShore = normR <= 1.36;
      const bowlFactor = inLake ? Math.max(0.22, 1 - Math.pow(normR, 2.0)) : 0;
      const waterDepth = inLake ? lake.maxDepth * bowlFactor : 0;
      // Full 1.0 blend across the immediate shoreline berm [1.0, 1.24] so bank vertices always sit above waterLevel
      const rawBlend =
        normR <= 1.24
          ? 1.0
          : Math.max(0, 1 - (normR - 1.24) / 0.48);
      lakeMatch = {
        inLake,
        inRiver: false,
        inWater: inLake,
        nearShore,
        waterSurfaceY: lake.waterLevel,
        waterDepth,
        bedBlend: rawBlend * rawBlend * (3 - 2 * rawBlend),
        featureId: lake.id,
        featureName: lake.name,
      };
      if (inLake) {
        return lakeMatch;
      }
      break;
    }
  }

  // 2. Check Stage 2 Rivers (allows river channels to cut through lake bank rims at inlets/outlets)
  for (let rIdx = 0; rIdx < STAGE2_RIVERS.length; rIdx++) {
    const river = STAGE2_RIVERS[rIdx];
    const pts = river.waypoints;
    const halfW = river.width * 0.5;
    const bermW = halfW + 2.2;
    const bankOuterW = bermW + Math.max(4.5, river.width * 0.95);

    for (let s = 0; s < pts.length - 1; s++) {
      const p0 = pts[s];
      const p1 = pts[s + 1];
      const minX = Math.min(p0.x, p1.x) - bankOuterW - 4;
      const maxX = Math.max(p0.x, p1.x) + bankOuterW + 4;
      const minZ = Math.min(p0.z, p1.z) - bankOuterW - 4;
      const maxZ = Math.max(p0.z, p1.z) + bankOuterW + 4;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;

      const vx = p1.x - p0.x;
      const vz = p1.z - p0.z;
      const segLen2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - p0.x) * vx + (z - p0.z) * vz) / segLen2));
      const projX = p0.x + vx * t;
      const projZ = p0.z + vz * t;

      // Subtle natural river meander perpendicular to segment
      const segLen = Math.sqrt(segLen2);
      const perpX = -vz / segLen;
      const perpZ = vx / segLen;
      const meanderAmp = river.width < 6 ? 1.15 : 8.5;
      const meander = Math.sin(t * Math.PI * 2) * meanderAmp;
      const centerX = projX + perpX * meander;
      const centerZ = projZ + perpZ * meander;

      const dist = Math.hypot(x - centerX, z - centerZ);
      if (dist <= bankOuterW) {
        const waterSurfaceY = p0.waterY + (p1.waterY - p0.waterY) * t;
        const inRiver = dist <= halfW;
        const nearShore = dist <= bermW + 1.2;
        const profile = inRiver ? Math.max(0.25, 1 - Math.pow(dist / halfW, 2)) : 0;
        const waterDepth = inRiver ? river.depth * profile : 0;
        const rawBlend =
          dist <= bermW
            ? 1.0
            : Math.max(0, 1 - (dist - bermW) / (bankOuterW - bermW));
        const riverMatch: Stage2HydrologyInfo = {
          inLake: false,
          inRiver,
          inWater: inRiver,
          nearShore,
          waterSurfaceY,
          waterDepth,
          bedBlend: rawBlend * rawBlend * (3 - 2 * rawBlend),
          featureId: river.id,
          featureName: river.name,
        };
        if (inRiver || !lakeMatch || riverMatch.bedBlend > lakeMatch.bedBlend) {
          return riverMatch;
        }
      }
    }
  }

  if (lakeMatch) {
    return lakeMatch;
  }

  return EMPTY_STAGE2_HYDROLOGY;
}

/**
 * Computes the elevation of the vast island landmass located entirely on the BACK SIDE
 * (North, Northwest, Northeast) of the starting beach, including Stage 2 Hills, Mountains,
 * Extended Outer Beaches, and Lake/River basins.
 */
function expandedLandmassHeightAt(x: number, z: number): number {
  const dx = x - MACRO_ISLAND_CENTER_X;
  const dz = z - MACRO_ISLAND_CENTER_Z;
  const rMacro = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const outerCoastRadius = getExpandedCoastlineRadius(angle);

  // Deep surrounding ocean beyond the island perimeter
  if (rMacro > outerCoastRadius + 360) {
    return -16.0;
  }

  // Underwater seabed slope outside the shoreline
  if (rMacro >= outerCoastRadius) {
    const seaProgress = Math.min(1, (rMacro - outerCoastRadius) / 360);
    return -0.25 - seaProgress * 15.75;
  }

  // Multi-scale gentle rolling grassland elevation (walkable undulating terrain between ~2.6m and ~16.5m)
  const macroRolling =
    Math.sin(x * 0.0032 + z * 0.0026) * Math.cos(x * 0.0022 - z * 0.003) * 3.8;
  const midMeadow =
    Math.sin(x * 0.014 - z * 0.011) * 1.75 +
    Math.cos(x * 0.011 + z * 0.015) * 1.35;
  const microUndulation =
    Math.sin(x * 0.048 + z * 0.041) * Math.cos(x * 0.036 - z * 0.052) * 0.78;

  const hillMountainGain = getStage2HillMountainElevationAt(x, z);
  const rawLandHeight =
    Math.max(2.6, 5.2 + macroRolling + midMeadow + microUndulation) + hillMountainGain;

  // Stage 2 Extended Outer Coastal Beach slope along the outer 380 m perimeter of the island
  const distFromOuterShore = outerCoastRadius - rMacro;
  let resultH = rawLandHeight;
  if (distFromOuterShore < EXTENDED_OUTER_COAST_BEACH_WIDTH) {
    const t = Math.max(0, distFromOuterShore / EXTENDED_OUTER_COAST_BEACH_WIDTH);
    const smoothCoast = t * t * (3 - 2 * t);
    const beachSlope = 0.55 + t * 2.15;
    resultH = beachSlope * (1 - smoothCoast) + rawLandHeight * smoothCoast;
  }

  return resultH;
}

/**
 * Computes exact ground height at world coordinates (x, z):
 * - IN FRONT OF THE BEACH (South, z >= getSouthernCoastlineZ(x)):
 *   STRICTLY OPEN TROPICAL OCEAN. Zero land in front of the beach!
 * - BACK SIDE OF THE BEACH (North, z < getSouthernCoastlineZ(x)):
 *   Contains the ENTIRE island landmass:
 *   Stage 2 Extended Southern Beach, freshwater stream, emerald jungle,
 *   central volcano caldera at (0, 0), and Stage 2 Hills, Mountains, Lakes, and Rivers!
 */
export function groundHeightAt(x: number, z: number): number {
  const southernShoreZ = getSouthernCoastlineZ(x);

  // 1. IN FRONT OF THE BEACH: Strictly open ocean water! ZERO land in front of the beach!
  if (z >= southernShoreZ) {
    const seaDist = z - southernShoreZ;
    return -0.25 - Math.min(15.75, seaDist * 0.36 + (seaDist > 20 ? (seaDist - 20) * 0.16 : 0));
  }

  // 2. Stage 2 Extended Southern Beach Belt:
  // Keeps the central spawn beach (|x| < 30) gently sloped over 15.5m, while extending a broad
  // 26m-deep golden sandy beach belt across the eastern and western coastal wings.
  const distFromSouthShore = southernShoreZ - z;
  const absX = Math.abs(x);
  const centralBlend = smoothstep01((absX - 24) / 18);
  const activeBeachWidth = 15.5 * (1 - centralBlend) + EXTENDED_BEACH_BELT_WIDTH * centralBlend;
  const isBeachFrontZone = distFromSouthShore < activeBeachWidth && absX < 6800;

  let height = 0;

  if (isBeachFrontZone) {
    const t = Math.min(1, Math.max(0, distFromSouthShore / activeBeachWidth));
    height =
      Math.min(2.32, 0.35 + Math.pow(t, 0.62) * 1.92) +
      pseudoNoise2D(x * 0.4, z * 0.4) * 0.05 * t;
  } else {
    const r = Math.hypot(x, z);

    if (r <= 44) {
      height = coreSanctuaryHeightAt(x, z);
    } else if (r <= 68) {
      height = coreSanctuaryHeightAt(x, z) + getStage2HillMountainElevationAt(x, z);
    } else {
      const expandedH = expandedLandmassHeightAt(x, z);
      if (r < 110) {
        const coreH = coreSanctuaryHeightAt(x, z) + getStage2HillMountainElevationAt(x, z);
        const blendT = smoothstep01((r - 68) / 42);
        height = Math.max(2.4, coreH) * (1 - blendT) + expandedH * blendT;
      } else {
        height = expandedH;
      }
    }
  }

  // 3. Carve & Rim Stage 2 Freshwater Lakes & Rivers across the island (outside central volcano cone r > 40)
  const r = Math.hypot(x, z);
  if (r > 40) {
    const hydro = getStage2HydrologyAt(x, z);
    if (hydro.bedBlend > 0) {
      const oceanT = smoothstep01((southernShoreZ - z) / 5.0);
      if (hydro.inWater) {
        // Inside lake/river basin: always carve below waterSurfaceY so terrain never pokes through water
        height = hydro.waterSurfaceY - hydro.waterDepth;
      } else {
        // Along shoreline bank: smoothly blend both uphill slopes AND downhill slopes to a natural shore rim
        // slightly above waterSurfaceY so water discs/ribbons never float in mid-air or clip into hills
        const shoreRimY = hydro.waterSurfaceY + 0.22 * oceanT;
        height = height * (1 - hydro.bedBlend) + shoreRimY * hydro.bedBlend;
      }
    }
  }

  return height;
}

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function groundHeightAtBase(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = 0.45;
  if (r < 10) {
    h = 24.5 - (10 - r) * 1.5;
  } else if (r <= 48) {
    const t = (r - 10) / 38;
    h = 24.5 * Math.pow(1 - t, 1.45) + 0.35;
  } else if (r <= 72) {
    const t = (r - 48) / 24;
    h = 0.35 * (1 - t) + 0.15;
  }
  return h;
}

/**
 * Computes the x-coordinate of the freshwater stream center line at world coordinate z.
 * Runs through the southwest jungle from the rocky ridge at z=33 down to coastal shallows at z=68.
 */
export function freshwaterStreamX(z: number): number {
  if (z < 33 || z > 69) return -12.0;
  const t = (z - 33) / 36;
  const baseX = -12.5 - t * 3.5;
  const meander = Math.sin((z - 33) * 0.26) * 1.45 + Math.cos((z - 33) * 0.14) * 0.7 - 0.7;
  return baseX + meander;
}

export interface FreshwaterStreamInfo {
  inStream: boolean;
  nearStream: boolean;
  isWaterfall: boolean;
  distToStream: number;
  waterSurfaceY: number;
  streamBedDepth: number;
}

/**
 * Returns detailed freshwater stream and waterfall info at (x, z).
 */
export function freshwaterStreamInfo(x: number, z: number): FreshwaterStreamInfo {
  if (z >= 32 && z <= 69 && x <= -3 && x >= -25) {
    const streamX = freshwaterStreamX(z);
    const dist = Math.abs(x - streamX);
    const isWaterfall = z >= 32.5 && z <= 37.5 && dist < 3.2;

    // Stream bed width ~2.2m (radius 1.1m, bank transition up to 2.4m)
    let streamBedDepth = 0;
    if (dist < 2.4 && z >= 34) {
      const intensity = 1 - dist / 2.4;
      streamBedDepth = intensity * intensity * (isWaterfall ? 0.3 : 0.48);
    }

    // Water surface elevation drops from ~10.4m at waterfall top to 0.12m at beach entry
    const t = Math.max(0, Math.min(1, (z - 33) / 35));
    const waterSurfaceY = isWaterfall
      ? 10.4 - ((z - 33) / 4.5) * 4.2
      : 6.2 * Math.pow(1 - t, 1.35) + 0.12;

    const inStream = dist < 1.35 && z >= 34.5 && z <= 68.5;
    const nearStream = dist < 4.2 && z >= 32.5 && z <= 68.5;

    if (nearStream || streamBedDepth > 0) {
      return {
        inStream,
        nearStream,
        isWaterfall,
        distToStream: dist,
        waterSurfaceY,
        streamBedDepth,
      };
    }
  }

  // Also check Stage 2 Lakes and Rivers so players can wade and drink fresh water from any lake or river
  const hydro = getStage2HydrologyAt(x, z);
  if (hydro.nearShore) {
    return {
      inStream: hydro.inWater,
      nearStream: hydro.nearShore,
      isWaterfall: false,
      distToStream: hydro.inWater ? 0.5 : 2.2,
      waterSurfaceY: hydro.waterSurfaceY,
      streamBedDepth: hydro.waterDepth,
    };
  }

  return {
    inStream: false,
    nearStream: false,
    isWaterfall: false,
    distToStream: 999,
    waterSurfaceY: 0,
    streamBedDepth: 0,
  };
}

/**
 * Computes proximity [0..1] to the island's natural dirt trails.
 * - Main South-to-North trail connecting Beach Campfire (3.8, 62.5) -> Jungle Ridge Campfire (0, 44) -> Volcano Overlook (-2, 28.5)
 * - West trail branching to Freshwater Stream & Waterfall grotto
 * - East trail branching to sunlit Fruit Grove clearing
 */
export function jungleTrailProximity(x: number, z: number): number {
  if (z < 26 || z > 70) return 0;

  // 1. Main trail: connecting South Beach to Jungle Ridge and Volcano Overlook
  let mainX = 0;
  if (z <= 44) {
    const t = (z - 28.5) / 15.5;
    mainX = -2.0 + Math.max(0, Math.min(1, t)) * 2.0;
  } else if (z <= 62.5) {
    const t = (z - 44) / 18.5;
    mainX = Math.sin(t * Math.PI) * 1.6 + t * 3.8;
  } else {
    const t = (z - 62.5) / 5.5;
    mainX = 3.8 - t * 2.4;
  }
  const distMain = Math.abs(x - mainX);

  // 2. West branch to stream: starts at Jungle Ridge campfire (0, 44), curves to stream footbridge (-16, 47.5)
  let distWest = 999;
  if (x <= 0.5 && x >= -17.5 && z >= 42 && z <= 50) {
    const t = Math.min(1, Math.max(0, -x / 16.0));
    const targetZ = 44 + Math.sin(t * Math.PI * 0.5) * 3.5;
    distWest = Math.abs(z - targetZ);
  }

  // 3. East branch to fruit grove: starts at (0, 44), curves to (15, 46)
  let distEast = 999;
  if (x >= -0.5 && x <= 16 && z >= 42 && z <= 49) {
    const t = x / 15;
    const targetZ = 44 + Math.sin(t * Math.PI * 0.5) * 2.0;
    distEast = Math.abs(z - targetZ);
  }

  const minDist = Math.min(distMain, distWest, distEast);
  const trailWidth = 2.2;
  if (minDist < trailWidth) {
    return 1 - minDist / trailWidth;
  }
  return 0;
}

/**
 * Quenches castaway's thirst by drinking crystal-clear freshwater from the stream or waterfall pool.
 */
export function drinkFreshwater(vitals: PlayerVitals): { vitals: PlayerVitals; restoredThirst: number } {
  const maxThirst = vitals.maxThirst ?? 100;
  const curThirst = vitals.thirst ?? maxThirst;
  const newThirst = Math.min(maxThirst, curThirst + 35);
  return {
    vitals: {
      ...vitals,
      thirst: newThirst,
      hp: Math.min(vitals.maxHp, vitals.hp + 6),
      stamina: Math.min(vitals.maxStamina, vitals.stamina + 15),
    },
    restoredThirst: newThirst - curThirst,
  };
}

/**
 * Returns [0..1] proximity to a molten lava flow stream or central caldera pool.
 * 1.0 = directly inside molten lava core; > 0.35 = hazardous lava contact.
 */
export function lavaChannelProximity(x: number, z: number): number {
  const r = Math.hypot(x, z);

  // Central crater caldera lava pool
  if (r < 9.8) {
    return 1.0;
  }

  // 4 glowing lava streams flowing down the volcano slopes (NE, NW, SE, SW-ish, avoiding direct South spawn path)
  if (r >= 9.0 && r <= 43.0) {
    const streamAngles = [0.65, 2.35, -0.85, -2.25]; // radians (keeps +Z=1.57 South path clear!)
    const angle = Math.atan2(z, x);
    // Add slight sinuous meander to the lava streams based on radius
    const meander = Math.sin(r * 0.26) * 0.11;

    let best = 0;
    for (const targetAngle of streamAngles) {
      let diff = Math.abs( wrapAngle(angle - (targetAngle + meander)) );
      // Arc width in world units at radius r
      const arcDist = diff * r;
      const streamHalfWidth = 2.15 * (1 - (r - 9) / 42 * 0.35);
      if (arcDist < streamHalfWidth) {
        const intensity = 1 - arcDist / streamHalfWidth;
        if (intensity > best) best = intensity;
      }
    }
    return best;
  }

  return 0;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Determines whether world position (x, z) is hazardous molten lava.
 */
export function isLavaHazardAt(x: number, z: number): boolean {
  return lavaChannelProximity(x, z) > 0.38;
}

/**
 * Classifies the biome zone at world coordinates (x, z).
 */
export function getBiomeZoneAt(x: number, z: number): BiomeZone {
  const r = Math.hypot(x, z);
  if (r < 11.5) return 'caldera';
  const h = groundHeightAt(x, z);
  if (h < WATER_LEVEL - 0.15) return 'ocean';
  if (r < 33 || (r < 52 && h > 9.2)) return 'volcano';
  if (h < 2.35 || (r > 63 && r <= 78 && z > 42 && Math.abs(x) < 36)) return 'beach';
  return 'jungle';
}

/**
 * Determines if the player is currently swimming at (x, y, z).
 */
export function isSwimmingAt(x: number, z: number): boolean {
  const groundY = groundHeightAt(x, z);
  return groundY < SWIM_DEPTH_THRESHOLD;
}

/**
 * Updates player vitals for a simulation step dt (including Hunger/Eat, Thirst/Drink, Lava, and Campfire warmth).
 */
export function stepPlayerVitals(
  vitals: PlayerVitals,
  params: {
    dt: number;
    inLava: boolean;
    isSprinting: boolean;
    isMoving: boolean;
    nearLitCampfire: boolean;
    isNight?: boolean;
  }
): { vitals: PlayerVitals; tookLavaDamage: boolean; isDead: boolean } {
  const { dt, inLava, isSprinting, isMoving, nearLitCampfire, isNight = false } = params;
  let hp = vitals.hp;
  let stamina = vitals.stamina;
  let hunger = vitals.hunger;
  const maxThirst = vitals.maxThirst ?? 100;
  let thirst = vitals.thirst ?? maxThirst;
  let tookLavaDamage = false;

  // Lava hazard deals 28 HP/sec
  if (inLava) {
    hp = Math.max(0, hp - 28 * dt);
    tookLavaDamage = true;
  } else if (nearLitCampfire && hp < vitals.maxHp) {
    // Resting near a lit campfire restores health and wards off night chill
    hp = Math.min(vitals.maxHp, hp + 6.5 * dt);
  }

  // Hunger (Eat) slowly ticks down over time
  hunger = Math.max(0, hunger - 0.62 * dt);
  if (hunger <= 0) {
    hp = Math.max(0, hp - 3.0 * dt);
  }

  // Thirst (Drink) ticks down over time (slightly faster when sprinting in daytime heat)
  const thirstDrain = (isSprinting && isMoving ? 1.05 : 0.72) * (isNight ? 0.8 : 1.0);
  thirst = Math.max(0, thirst - thirstDrain * dt);
  if (thirst <= 0) {
    hp = Math.max(0, hp - 3.2 * dt);
  }

  // Stamina drain when sprinting while moving, otherwise regenerates based on nourishment & hydration
  if (isSprinting && isMoving && stamina > 0) {
    stamina = Math.max(0, stamina - 22 * dt);
  } else {
    const wellFedAndHydrated = hunger > 20 && thirst > 20;
    const regenRate = wellFedAndHydrated ? 18 : 10;
    stamina = Math.min(vitals.maxStamina, stamina + regenRate * dt);
  }

  return {
    vitals: {
      ...vitals,
      hp,
      stamina,
      hunger,
      thirst,
      maxThirst,
    },
    tookLavaDamage,
    isDead: hp <= 0,
  };
}

/**
 * Collects a resource item into the player's inventory.
 */
export function collectResource(
  inventory: Inventory,
  type: ResourceType
): Inventory {
  if (type === 'coconut') {
    return { ...inventory, coconuts: inventory.coconuts + 1 };
  }
  if (type === 'wood') {
    return { ...inventory, wood: inventory.wood + 1 };
  }
  if (type === 'rope') {
    return {
      ...inventory,
      rope: (inventory.rope ?? 0) + 1,
      hasRope: true,
    };
  }
  return { ...inventory, food: inventory.food + 1 };
}

/**
 * Consumes a coconut (Drink + light nourishment) or food item (Eat + hearty nourishment)
 * to restore HP, Hunger (Eat), Thirst (Drink), and Stamina.
 */
export function consumeProvision(
  inventory: Inventory,
  vitals: PlayerVitals,
  preferred?: 'coconut' | 'food'
): { inventory: Inventory; vitals: PlayerVitals; consumed: 'coconut' | 'food' | null } {
  const tryOrder: Array<'coconut' | 'food'> =
    preferred === 'food' ? ['food', 'coconut'] : ['coconut', 'food'];
  const maxThirst = vitals.maxThirst ?? 100;
  const curThirst = vitals.thirst ?? maxThirst;

  for (const item of tryOrder) {
    if (item === 'coconut' && inventory.coconuts > 0) {
      return {
        inventory: { ...inventory, coconuts: inventory.coconuts - 1 },
        vitals: {
          ...vitals,
          hp: Math.min(vitals.maxHp, vitals.hp + 18),
          hunger: Math.min(vitals.maxHunger, vitals.hunger + 25),
          thirst: Math.min(maxThirst, curThirst + 42),
          maxThirst,
          stamina: Math.min(vitals.maxStamina, vitals.stamina + 30),
        },
        consumed: 'coconut',
      };
    }
    if (item === 'food' && inventory.food > 0) {
      return {
        inventory: { ...inventory, food: inventory.food - 1 },
        vitals: {
          ...vitals,
          hp: Math.min(vitals.maxHp, vitals.hp + 30),
          hunger: Math.min(vitals.maxHunger, vitals.hunger + 40),
          thirst: Math.min(maxThirst, curThirst + 14),
          maxThirst,
          stamina: Math.min(vitals.maxStamina, vitals.stamina + 25),
        },
        consumed: 'food',
      };
    }
  }

  return { inventory, vitals, consumed: null };
}

/**
 * Checks if the player can light a signal/shelter campfire (requires >= 3 wood).
 */
export function canLightCampfire(inventory: Inventory, woodRequired = 3): boolean {
  return inventory.wood >= woodRequired;
}

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // UTC+05:30 (19,800,000 ms)

export interface ISTTimeState {
  normalizedTime: number;
  hours: number;
  minutes: number;
  seconds: number;
  clockLabel: string;
  clockWithSeconds: string;
  dateLabel: string;
  timezoneLabel: 'IST';
  phase: DayPhase;
}

/**
 * Computes day/night cycle state from normalized timeOfDay in [0, 1).
 * 0.0 = Sunrise (06:00), 0.25 = Noon (12:00), 0.5 = Sunset (18:00), 0.75 = Midnight (00:00).
 */
export function evaluateDayNightCycle(timeOfDay: number): {
  normalizedTime: number;
  phase: DayPhase;
  sunElevation: number;
  sunAzimuth: number;
  daylightFactor: number;
  clockLabel: string;
  clockWithSeconds: string;
} {
  const t = ((timeOfDay % 1) + 1) % 1;
  const angle = t * Math.PI * 2;
  // sin(angle) is +1 at t=0.25 (Noon), 0 at t=0 (Dawn) and t=0.5 (Dusk), -1 at t=0.75 (Midnight)
  const sunElevation = Math.sin(angle);
  const sunAzimuth = Math.cos(angle);
  const daylightFactor = Math.max(0, Math.min(1, (sunElevation + 0.18) / 1.18));

  let phase: DayPhase = 'Noon';
  if (t >= 0.92 || t < 0.14) {
    phase = 'Dawn';
  } else if (t >= 0.14 && t < 0.42) {
    phase = 'Noon';
  } else if (t >= 0.42 && t < 0.62) {
    phase = 'Dusk';
  } else {
    phase = 'Night';
  }

  // Convert t=0 -> 06:00, t=0.25 -> 12:00, t=0.5 -> 18:00, t=0.75 -> 00:00
  const totalSeconds = Math.floor(Math.round(((t * 24 + 6) % 24) * 3600)) % 86400;
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const clockLabel = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  const clockWithSeconds = `${clockLabel}:${String(secs).padStart(2, '0')}`;

  return {
    normalizedTime: t,
    phase,
    sunElevation,
    sunAzimuth,
    daylightFactor,
    clockLabel,
    clockWithSeconds,
  };
}

/**
 * Computes real-life Indian Standard Time (IST, UTC+05:30) from a UTC timestamp (ms)
 * and maps it 1:1 onto the island's 24-hour solar timeline:
 * - 06:00 IST -> normalizedTime 0.00 (Dawn)
 * - 12:00 IST -> normalizedTime 0.25 (Noon)
 * - 18:00 IST -> normalizedTime 0.50 (Dusk)
 * - 00:00 IST -> normalizedTime 0.75 (Midnight / Night)
 */
export function getISTTimeState(utcTimestampMs: number = Date.now()): ISTTimeState {
  const istDate = new Date(utcTimestampMs + IST_OFFSET_MS);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const millis = istDate.getUTCMilliseconds();

  const totalSecondsInDay = hours * 3600 + minutes * 60 + seconds + millis / 1000;
  const normalizedTime = ((((totalSecondsInDay - 6 * 3600) / 86400) % 1) + 1) % 1;

  const cycle = evaluateDayNightCycle(normalizedTime);
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const clockLabel = `${hh}:${mm}`;
  const clockWithSeconds = `${hh}:${mm}:${ss}`;

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const mon = months[istDate.getUTCMonth()];
  const year = istDate.getUTCFullYear();
  const dateLabel = `${day} ${mon} ${year}`;

  return {
    normalizedTime,
    hours,
    minutes,
    seconds,
    clockLabel,
    clockWithSeconds,
    dateLabel,
    timezoneLabel: 'IST',
    phase: cycle.phase,
  };
}

/**
 * Finds the nearest uncollected interactable within interaction radius.
 */
export function findNearestInteractable(
  px: number,
  py: number,
  pz: number,
  items: InteractableItem[],
  maxDist = 4.2
): { item: InteractableItem | null; distance: number } {
  let nearest: InteractableItem | null = null;
  let bestDist = maxDist;

  for (const item of items) {
    if (item.collected) continue;
    if (item.type === 'campfire' && item.lit) continue;
    const d = Math.hypot(px - item.x, py - item.y, pz - item.z);
    if (d <= bestDist) {
      bestDist = d;
      nearest = item;
    }
  }

  return { item: nearest, distance: bestDist };
}

/**
 * Computes the character's target horizontal movement speed based on gait (walk/run),
 * bending/crouching state, swimming state, and remaining stamina.
 */
export function computeTargetMoveSpeed(params: {
  gait: MovementGait;
  shiftHeld: boolean;
  isBending: boolean;
  isSwimming: boolean;
  stamina: number;
}): { speed: number; isSprinting: boolean } {
  const { gait, shiftHeld, isBending, isSwimming, stamina } = params;
  if (isSwimming) {
    return { speed: 4.8, isSprinting: false };
  }
  if (isBending) {
    // Bending / crouched stance moves quietly and carefully
    return { speed: 3.6, isSprinting: false };
  }
  const wantsRun = gait === 'run' || shiftHeld;
  const canSprint = wantsRun && stamina > 5;
  return {
    speed: canSprint ? 10.5 : 6.4,
    isSprinting: canSprint,
  };
}

/**
 * Clamps and normalizes 2D virtual joystick offset (dx, dy) within maxRadius.
 * Returns normalized x, y in [-1, 1] and magnitude in [0, 1].
 */
export function normalizeJoystickInput(
  dx: number,
  dy: number,
  maxRadius: number
): { x: number; y: number; magnitude: number } {
  if (maxRadius <= 0) {
    return { x: 0, y: 0, magnitude: 0 };
  }
  const dist = Math.hypot(dx, dy);
  if (dist < 0.0001) {
    return { x: 0, y: 0, magnitude: 0 };
  }
  const clampedDist = Math.min(dist, maxRadius);
  const scale = clampedDist / maxRadius;
  return {
    x: (dx / dist) * scale,
    y: (dy / dist) * scale,
    magnitude: scale,
  };
}

export interface CampfireSiteInfo {
  id: string;
  label: string;
  x: number;
  z: number;
  lit: boolean;
}

export interface MinimapCoord {
  percentX: number;
  percentY: number;
  normX: number;
  normY: number;
  radius: number;
  isInsideIsland: boolean;
}

/**
 * Maps world 3D position (wx, wz) to 2D percentage coordinates [0, 100]
 * suitable for rendering inside a circular minimap centered on the island (0, 0).
 * +X is East (right), -X is West (left), -Z is North (top), +Z is South (bottom).
 */
export function worldToMinimapCoords(
  wx: number,
  wz: number,
  mapRadiusWorld = 76
): MinimapCoord {
  const dist = Math.hypot(wx, wz);
  const normX = wx / mapRadiusWorld;
  const normY = wz / mapRadiusWorld;

  // Clamp radius for circular radar edge display so markers outside outer reef don't disappear
  const clampedDist = Math.min(dist, mapRadiusWorld * 0.94);
  const angle = Math.atan2(wz, wx);
  const clampedX = (Math.cos(angle) * clampedDist) / mapRadiusWorld;
  const clampedY = (Math.sin(angle) * clampedDist) / mapRadiusWorld;

  return {
    percentX: 50 + clampedX * 46,
    percentY: 50 + clampedY * 46,
    normX,
    normY,
    radius: dist,
    isInsideIsland: dist <= mapRadiusWorld,
  };
}

/**
 * Converts Three.js player yaw in radians to 2D minimap heading angle in degrees,
 * where 0 deg points North (up), 90 deg points East (right), 180 deg points South (down), 270 deg points West (left).
 */
export function playerYawToMinimapAngle(playerYaw: number): number {
  const deg = -playerYaw * (180 / Math.PI);
  return Object.is(deg, -0) ? 0 : deg;
}

export interface GeographicalMapPoint {
  percentX: number;
  percentY: number;
  elevationMeters: number;
  biome: BiomeZone;
  latLabel: string;
  lonLabel: string;
  isWithinBounds: boolean;
}

/**
 * Projects 3D world coordinates (wx, wz) onto a rectangular Geographical Topographic Map
 * with hypsometric elevation readout and cartographic latitude/longitude graticule labels.
 */
export function worldToGeographicalMapCoords(
  wx: number,
  wz: number,
  mapHalfExtentMeters = 80,
  centerWorldX = 0,
  centerWorldZ = 0
): GeographicalMapPoint {
  const half = Math.max(10, mapHalfExtentMeters);
  const normX = (wx - centerWorldX) / half;
  const normZ = (wz - centerWorldZ) / half;
  const clampedX = Math.max(-0.92, Math.min(0.92, normX));
  const clampedZ = Math.max(-0.92, Math.min(0.92, normZ));

  const percentX = 50 + clampedX * 50;
  const percentY = 50 + clampedZ * 50;
  const rawElev = groundHeightAt(wx, wz);
  const elevationMeters = Math.round(rawElev * 10) / 10;
  const biome = getBiomeZoneAt(wx, wz);

  // Base cartographic graticule around 12°14'N, 93°48'E (Andaman volcanic arc style)
  const latDeg = 12.2333 - wz / 111320;
  const lonDeg = 93.8 + wx / 108500;
  const latLabel = `${latDeg.toFixed(4)}°N`;
  const lonLabel = `${lonDeg.toFixed(4)}°E`;

  return {
    percentX,
    percentY,
    elevationMeters,
    biome,
    latLabel,
    lonLabel,
    isWithinBounds: Math.abs(wx - centerWorldX) <= half && Math.abs(wz - centerWorldZ) <= half,
  };
}

/**
 * Generates an accurate SVG closed path string of the expanded 20 km island coastline
 * from `getExpandedCoastlineRadius(angle)` for cartographic map rendering.
 */
export function generateIslandCoastlineSvgPath(
  samples = 64,
  viewBoxSize = 100,
  mapHalfExtentMeters = 11500
): string {
  const count = Math.max(12, samples);
  const center = viewBoxSize / 2;
  const halfSpan = viewBoxSize / 2;
  const parts: string[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const coastR = getExpandedCoastlineRadius(angle);
    const wx = Math.cos(angle) * coastR;
    const wz = Math.sin(angle) * coastR;
    const px = center + (wx / mapHalfExtentMeters) * halfSpan;
    const py = center + (wz / mapHalfExtentMeters) * halfSpan;
    parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Computes the real-time drifting position of the Sea Supply Crate as ocean waves carry it
 * from offshore surf onto the target beach shoreline sector.
 */
export function computeSupplyBoxDriftPosition(
  elapsedSec: number,
  shoreX: number,
  shoreZ: number,
  driftDurationSec = 14
): { x: number; y: number; z: number; isAshore: boolean; progress: number } {
  const progress = Math.max(0, Math.min(1, elapsedSec / Math.max(1, driftDurationSec)));
  // Smooth ease-out as waves push the crate onto the sandbar
  const ease = 1 - Math.pow(1 - progress, 2.2);
  // Starts 12m further out in the ocean waves along the same radial angle
  const angle = Math.atan2(shoreZ, shoreX);
  const startX = shoreX + Math.cos(angle) * 12.0;
  const startZ = shoreZ + Math.sin(angle) * 12.0;

  const x = startX + (shoreX - startX) * ease + Math.sin(elapsedSec * 1.4) * 0.25 * (1 - ease * 0.7);
  const z = startZ + (shoreZ - startZ) * ease + Math.cos(elapsedSec * 1.2) * 0.25 * (1 - ease * 0.7);
  const terrainY = groundHeightAt(x, z);
  const waveBob = Math.sin(elapsedSec * 2.4) * 0.12;
  const y = Math.max(terrainY, WATER_LEVEL - 0.05 + waveBob);

  return {
    x,
    y,
    z,
    isAshore: progress >= 0.92,
    progress,
  };
}

/**
 * Opens the Sea-Drifted Supply Box and grants the castaway's essential survival kit:
 * - Survival Knife (unlocks strong melee slash & wood carving)
 * - Coiled Hemp Rope (+3 Rope coils for lashing the Escape Boat)
 * - Caldera Island Map (unlocks full Minimap radar showing creatures, resources & boat shipyard)
 */
export function openSupplyCrate(inventory: Inventory): Inventory {
  return {
    ...inventory,
    hasKnife: true,
    hasRope: true,
    hasMap: true,
    rope: (inventory.rope ?? 0) + 3,
    coconuts: inventory.coconuts + 1,
  };
}

export interface BoatStageRequirement {
  nextStage: BoatBuildStage;
  title: string;
  woodNeeded: number;
  ropeNeeded: number;
  provisionsNeeded: number;
  requiresSupplyBoxTools: boolean;
}

export function getBoatStageRequirement(currentStage: BoatBuildStage): BoatStageRequirement | null {
  if (currentStage === 0) {
    return {
      nextStage: 1,
      title: 'Stage 1/3: Lay Log Hull & Keel',
      woodNeeded: 3,
      ropeNeeded: 1,
      provisionsNeeded: 0,
      requiresSupplyBoxTools: true,
    };
  }
  if (currentStage === 1) {
    return {
      nextStage: 2,
      title: 'Stage 2/3: Lash Outrigger & Deck Planks',
      woodNeeded: 3,
      ropeNeeded: 1,
      provisionsNeeded: 0,
      requiresSupplyBoxTools: true,
    };
  }
  if (currentStage === 2) {
    return {
      nextStage: 3,
      title: 'Stage 3/3: Raise Mast, Canvas Sail & Stock Voyage Rations',
      woodNeeded: 3,
      ropeNeeded: 1,
      provisionsNeeded: 2,
      requiresSupplyBoxTools: true,
    };
  }
  return null;
}

/**
 * Attempts to advance the Escape Boat construction by one stage at the Beach Shipyard.
 */
export function advanceBoatConstruction(
  currentStage: BoatBuildStage,
  inventory: Inventory
): {
  success: boolean;
  newStage: BoatBuildStage;
  inventory: Inventory;
  message: string;
  readyToSail: boolean;
} {
  if (currentStage >= 3) {
    return {
      success: true,
      newStage: 3,
      inventory,
      message: 'Escape Boat is seaworthy! Set sail for freedom!',
      readyToSail: true,
    };
  }

  const req = getBoatStageRequirement(currentStage)!;
  if (req.requiresSupplyBoxTools && (!inventory.hasKnife || !inventory.hasRope)) {
    return {
      success: false,
      newStage: currentStage,
      inventory,
      message: 'Find and open the Sea-Drifted Supply Box first to get the Survival Knife, Rope & Map!',
      readyToSail: false,
    };
  }

  const curRope = inventory.rope ?? 0;
  const totalProvisions = inventory.coconuts + inventory.food;

  if (inventory.wood < req.woodNeeded) {
    return {
      success: false,
      newStage: currentStage,
      inventory,
      message: `${req.title} requires ${req.woodNeeded} Wood (Have ${inventory.wood}/${req.woodNeeded} Wood).`,
      readyToSail: false,
    };
  }

  if (curRope < req.ropeNeeded) {
    return {
      success: false,
      newStage: currentStage,
      inventory,
      message: `${req.title} requires ${req.ropeNeeded} Rope (Have ${curRope}/${req.ropeNeeded} Rope — defeat creatures or search shore for more!).`,
      readyToSail: false,
    };
  }

  if (totalProvisions < req.provisionsNeeded) {
    return {
      success: false,
      newStage: currentStage,
      inventory,
      message: `${req.title} requires ${req.provisionsNeeded} Food/Coconuts for the sea voyage (Have ${totalProvisions}/${req.provisionsNeeded}).`,
      readyToSail: false,
    };
  }

  // Deduct required resources
  let nextCoconuts = inventory.coconuts;
  let nextFood = inventory.food;
  let remProv = req.provisionsNeeded;
  while (remProv > 0 && nextFood > 0) {
    nextFood -= 1;
    remProv -= 1;
  }
  while (remProv > 0 && nextCoconuts > 0) {
    nextCoconuts -= 1;
    remProv -= 1;
  }

  const nextInv: Inventory = {
    ...inventory,
    wood: inventory.wood - req.woodNeeded,
    rope: curRope - req.ropeNeeded,
    coconuts: nextCoconuts,
    food: nextFood,
  };

  const nextStage = req.nextStage;
  const stageMessages: Record<BoatBuildStage, string> = {
    0: '',
    1: 'Boat Hull & Keel lashed together! (Stage 1/3 Complete — Need 3 Wood & 1 Rope for Outrigger Deck)',
    2: 'Outrigger Stabilizer & Deck Planks built! (Stage 2/3 Complete — Need 3 Wood, 1 Rope & 2 Provisions for Mast & Sail)',
    3: 'Escape Boat Completed with Mast & Sail! Press [E] at the Boat to Sail Away & Escape the Island!',
  };

  return {
    success: true,
    newStage: nextStage,
    inventory: nextInv,
    message: stageMessages[nextStage],
    readyToSail: false,
  };
}

export interface CombatTarget {
  id: string;
  kind: 'boar' | 'crab';
  x: number;
  z: number;
  hp: number;
  maxHp: number;
}

/**
 * Resolves a player melee attack (Knife slash or bare-handed strike) against nearby hostile creatures.
 */
export function resolvePlayerMeleeAttack(params: {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  hasKnife: boolean;
  targets: CombatTarget[];
  reach?: number;
}): {
  hitTargetId: string | null;
  damageDealt: number;
  killed: boolean;
  updatedTargets: CombatTarget[];
} {
  const { playerX, playerZ, playerYaw, hasKnife, targets, reach = 3.6 } = params;
  const damage = hasKnife ? 40 : 15;
  const forwardX = -Math.sin(playerYaw);
  const forwardZ = -Math.cos(playerYaw);

  let bestTarget: CombatTarget | null = null;
  let bestScore = Infinity;

  for (const t of targets) {
    if (t.hp <= 0) continue;
    const dx = t.x - playerX;
    const dz = t.z - playerZ;
    const dist = Math.hypot(dx, dz);
    if (dist > reach) continue;

    // Allow wide 140-degree slash arc in front of player (or very close point-blank)
    if (dist > 0.001) {
      const dot = (dx / dist) * forwardX + (dz / dist) * forwardZ;
      if (dot < -0.25 && dist > 1.5) continue;
    }

    if (dist < bestScore) {
      bestScore = dist;
      bestTarget = t;
    }
  }

  if (!bestTarget) {
    return {
      hitTargetId: null,
      damageDealt: 0,
      killed: false,
      updatedTargets: targets,
    };
  }

  let killed = false;
  const updatedTargets = targets.map((t) => {
    if (t.id !== bestTarget!.id) return t;
    const nextHp = Math.max(0, t.hp - damage);
    if (nextHp <= 0) killed = true;
    return { ...t, hp: nextHp };
  });

  return {
    hitTargetId: bestTarget.id,
    damageDealt: damage,
    killed,
    updatedTargets,
  };
}

export const DEFAULT_BACKPACK_CAPACITY = 16;

export interface BackpackSlotItem {
  slotIndex: number;
  kind: 'coconut' | 'food' | 'wood' | 'rope' | 'empty';
  label: string;
  category: 'Drink' | 'Eat' | 'Material' | 'Rigging' | 'Empty';
}

export interface BackpackStorageState {
  usedSlots: number;
  maxSlots: number;
  freeSlots: number;
  fillPercent: number;
  isFull: boolean;
  slots: BackpackSlotItem[];
  tools: Array<{
    id: 'knife' | 'rope' | 'map';
    name: string;
    unlocked: boolean;
    description: string;
  }>;
}

/**
 * Computes the current backpack storage usage, 16-slot visual grid, and equipped survival tools.
 */
export function getBackpackStorageState(
  inventory: Inventory,
  maxCapacity = DEFAULT_BACKPACK_CAPACITY
): BackpackStorageState {
  const coconuts = Math.max(0, inventory.coconuts || 0);
  const food = Math.max(0, inventory.food || 0);
  const wood = Math.max(0, inventory.wood || 0);
  const rope = Math.max(0, inventory.rope || 0);

  const usedSlots = coconuts + food + wood + rope;
  const maxSlots = Math.max(1, maxCapacity);
  const freeSlots = Math.max(0, maxSlots - usedSlots);
  const fillPercent = Math.min(100, Math.round((usedSlots / maxSlots) * 100));
  const isFull = usedSlots >= maxSlots;

  const collectedList: Array<{
    kind: 'coconut' | 'food' | 'wood' | 'rope';
    label: string;
    category: 'Drink' | 'Eat' | 'Material' | 'Rigging';
  }> = [];

  for (let i = 0; i < coconuts; i++) {
    collectedList.push({
      kind: 'coconut',
      label: 'Fresh Coconut',
      category: 'Drink',
    });
  }
  for (let i = 0; i < food; i++) {
    collectedList.push({
      kind: 'food',
      label: 'Island Provision',
      category: 'Eat',
    });
  }
  for (let i = 0; i < wood; i++) {
    collectedList.push({
      kind: 'wood',
      label: 'Driftwood Bundle',
      category: 'Material',
    });
  }
  for (let i = 0; i < rope; i++) {
    collectedList.push({
      kind: 'rope',
      label: 'Hemp Rope Coil',
      category: 'Rigging',
    });
  }

  const totalSlotCount = Math.max(maxSlots, collectedList.length);
  const slots: BackpackSlotItem[] = [];
  for (let idx = 0; idx < totalSlotCount; idx++) {
    const item = collectedList[idx];
    if (item) {
      slots.push({
        slotIndex: idx,
        kind: item.kind,
        label: item.label,
        category: item.category,
      });
    } else {
      slots.push({
        slotIndex: idx,
        kind: 'empty',
        label: 'Empty Slot',
        category: 'Empty',
      });
    }
  }

  const tools = [
    {
      id: 'knife' as const,
      name: 'Survival Bowie Knife',
      unlocked: Boolean(inventory.hasKnife),
      description: '+35 Melee Slash Damage · Harvests Meat & Rope from Creatures',
    },
    {
      id: 'rope' as const,
      name: 'Mariner Lashing Rig',
      unlocked: Boolean(inventory.hasRope || rope > 0),
      description: 'Enables Outrigger & Mast Lashing at the Escape Boat Shipyard',
    },
    {
      id: 'map' as const,
      name: 'Castaway Island Chart',
      unlocked: Boolean(inventory.hasMap),
      description: 'Reveals Resource Nodes, Escape Boat Shipyard & Hostile Creatures',
    },
  ];

  return {
    usedSlots,
    maxSlots,
    freeSlots,
    fillPercent,
    isFull,
    slots,
    tools,
  };
}

/**
 * Checks whether the player's backpack has enough free capacity to store additional items.
 */
export function canStoreInBackpack(
  inventory: Inventory,
  amountToAdd = 1,
  maxCapacity = DEFAULT_BACKPACK_CAPACITY
): boolean {
  const state = getBackpackStorageState(inventory, maxCapacity);
  return state.usedSlots + amountToAdd <= state.maxSlots;
}

/**
 * Removes 1 unit of a collected cargo item from the backpack to free up a storage slot.
 */
export function dropBackpackItem(
  inventory: Inventory,
  kind: 'coconut' | 'food' | 'wood' | 'rope'
): { inventory: Inventory; dropped: boolean } {
  if (kind === 'coconut' && inventory.coconuts > 0) {
    return {
      inventory: { ...inventory, coconuts: inventory.coconuts - 1 },
      dropped: true,
    };
  }
  if (kind === 'food' && inventory.food > 0) {
    return {
      inventory: { ...inventory, food: inventory.food - 1 },
      dropped: true,
    };
  }
  if (kind === 'wood' && inventory.wood > 0) {
    return {
      inventory: { ...inventory, wood: inventory.wood - 1 },
      dropped: true,
    };
  }
  if (kind === 'rope' && (inventory.rope ?? 0) > 0) {
    return {
      inventory: { ...inventory, rope: (inventory.rope ?? 0) - 1 },
      dropped: true,
    };
  }
  return { inventory, dropped: false };
}

export interface CameraOrbitState {
  camYaw: number;
  camPitch: number;
  camDist: number;
  compassDeg: number;
}

/**
 * Converts a Three.js camera yaw angle (radians) into a 0..359 degree 360° compass angle.
 */
export function camYawToCompassDegrees(camYaw: number): number {
  const deg = ((-camYaw * 180) / Math.PI) % 360;
  return Math.round((deg + 360) % 360) % 360;
}

/**
 * Applies finger/touch or mouse drag deltas and pinch/wheel zoom to the 360-degree 3rd-person POV camera.
 * Horizontal yaw wraps seamlessly across 360° (-PI to +PI) for unrestricted rotation around the character.
 */
export function stepCameraOrbit(params: {
  camYaw: number;
  camPitch: number;
  camDist?: number;
  deltaX: number;
  deltaY: number;
  zoomDelta?: number;
  yawSensitivity?: number;
  pitchSensitivity?: number;
}): CameraOrbitState {
  const {
    camYaw,
    camPitch,
    camDist = 6.4,
    deltaX,
    deltaY,
    zoomDelta = 0,
    yawSensitivity = 0.0068,
    pitchSensitivity = 0.0052,
  } = params;

  const rawYaw = camYaw - deltaX * yawSensitivity;
  const wrappedYaw = wrapAngle(rawYaw);
  const nextPitch = Math.max(-0.12, Math.min(1.32, camPitch + deltaY * pitchSensitivity));
  const nextDist = Math.max(3.4, Math.min(11.5, camDist + zoomDelta));

  return {
    camYaw: wrappedYaw,
    camPitch: nextPitch,
    camDist: nextDist,
    compassDeg: camYawToCompassDegrees(wrappedYaw),
  };
}

// ============================================================================
// ANIMALS PHYSICS ENGINE — STAGE 1
// Real 3D velocity & gravity integration, terrain slope normal alignment
// (pitch & roll), shoreline/lava hazard avoidance, soft capsule collision,
// non-teleporting return/flee steering, and knockback hop arcs.
// ============================================================================

export type AnimalKind = 'crab' | 'lizard' | 'monkey' | 'boar';
export type AnimalBehaviorState = 'patrol' | 'chase' | 'attack' | 'flee' | 'return';

export interface AnimalPhysicsState {
  id: string;
  kind: AnimalKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  roll: number;
  homeX: number;
  homeZ: number;
  phase: number;
  speed: number;
  isGrounded: boolean;
  hostile: boolean;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  hitFlashTimer: number;
  fleeTimer: number;
  behavior: AnimalBehaviorState;
  gaitCycle: number;
}

export interface TerrainSlopeSample {
  groundY: number;
  nx: number;
  ny: number;
  nz: number;
  pitch: number;
  roll: number;
  steepness: number;
}

/**
 * Samples exact terrain elevation, unit surface normal (nx, ny, nz), and body-aligned
 * pitch & roll angles (radians) for an animal at (x, z) facing heading `yaw`.
 */
export function computeTerrainSlopeAt(
  x: number,
  z: number,
  yaw = 0,
  sampleEps = 0.55
): TerrainSlopeSample {
  const groundY = groundHeightAt(x, z);
  const hL = groundHeightAt(x - sampleEps, z);
  const hR = groundHeightAt(x + sampleEps, z);
  const hD = groundHeightAt(x, z - sampleEps);
  const hU = groundHeightAt(x, z + sampleEps);

  const rawNx = hL - hR;
  const rawNy = 2 * sampleEps;
  const rawNz = hD - hU;
  const invLen = 1 / (Math.hypot(rawNx, rawNy, rawNz) || 1);
  const nx = rawNx * invLen;
  const ny = rawNy * invLen;
  const nz = rawNz * invLen;

  // Animal local forward is (-sin(yaw), 0, -cos(yaw)); local right is (cos(yaw), 0, -sin(yaw))
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  // Slope gradient along forward and right axes: dY/dFwd = -(nx*fwdX + nz*fwdZ)/ny
  const dYdFwd = -(nx * fwdX + nz * fwdZ) / Math.max(0.25, ny);
  const dYdRight = -(nx * rightX + nz * rightZ) / Math.max(0.25, ny);

  // Positive pitch tilts nose up when walking uphill (in Three.js local +X axis is right, so rotation.x > 0 tilts -Z nose up)
  const pitch = Math.max(-0.52, Math.min(0.52, Math.atan(dYdFwd)));
  const roll = Math.max(-0.42, Math.min(0.42, -Math.atan(dYdRight)));
  const steepness = Math.acos(Math.max(-1, Math.min(1, ny)));

  return {
    groundY,
    nx,
    ny,
    nz,
    pitch,
    roll,
    steepness,
  };
}

/**
 * Checks whether world coordinates (x, z) are safe, dry/appropriate habitat for the given animal species:
 * - Strictly north of the southern ocean drop-off (`getSouthernCoastlineZ(x)`)
 * - Above water level (crabs tolerate wet sand near surf; terrestrial animals stay on dry land)
 * - Clear of molten volcanic lava channels and central caldera crater
 */
export function isSafeAnimalHabitatAt(
  x: number,
  z: number,
  kind: AnimalKind
): boolean {
  const southShoreZ = getSouthernCoastlineZ(x);
  const shoreMargin = kind === 'crab' ? 0.55 : 2.2;
  if (z >= southShoreZ - shoreMargin) {
    return false;
  }

  const y = groundHeightAt(x, z);
  const minElevation = kind === 'crab' ? WATER_LEVEL - 0.05 : WATER_LEVEL + 0.35;
  if (y < minElevation) {
    return false;
  }

  if (kind === 'crab' && y > 6.5) {
    return false;
  }

  // Keep animals out of the central volcano crater and diagonal lava streams
  if (Math.hypot(x, z) < 21.5) {
    return false;
  }
  if (isLavaHazardAt(x, z) || lavaChannelProximity(x, z) > 0.2) {
    return false;
  }

  // Keep terrestrial animals out of the sheer waterfall cliff drop and deep Stage 2 lakes/rivers
  if (kind !== 'crab' && freshwaterStreamInfo(x, z).isWaterfall) {
    return false;
  }
  const hydro = getStage2HydrologyAt(x, z);
  if (kind !== 'crab' && hydro.inWater && hydro.waterDepth > 0.38) {
    return false;
  }

  return true;
}

/**
 * Validates and, if necessary, nudges a proposed animal spawn/home coordinate (x, z)
 * so it is guaranteed to lie inside safe habitat (`isSafeAnimalHabitatAt`).
 */
export function resolveSafeAnimalSpawn(
  x: number,
  z: number,
  kind: AnimalKind
): { x: number; z: number; y: number } {
  let candX = x;
  let candZ = z;

  const southShoreZ = getSouthernCoastlineZ(candX);
  const minMargin = kind === 'crab' ? 1.8 : 4.0;
  if (candZ > southShoreZ - minMargin) {
    candZ = southShoreZ - minMargin;
  }

  if (isSafeAnimalHabitatAt(candX, candZ, kind)) {
    return { x: candX, z: candZ, y: groundHeightAt(candX, candZ) };
  }

  // Search spiral around candidate to find closest safe dry ground away from lava or deep water
  for (let step = 1; step <= 24; step++) {
    const rad = step * 1.5;
    for (let aIdx = 0; aIdx < 12; aIdx++) {
      const ang = (aIdx / 12) * Math.PI * 2;
      const tx = candX + Math.cos(ang) * rad;
      const tz = Math.min(
        getSouthernCoastlineZ(tx) - minMargin,
        candZ + Math.sin(ang) * rad
      );
      if (isSafeAnimalHabitatAt(tx, tz, kind)) {
        return { x: tx, z: tz, y: groundHeightAt(tx, tz) };
      }
    }
  }

  // Guaranteed safe fallback on the southern beach/jungle shelf
  const fallbackZ = kind === 'crab' ? 64.5 : 50.0;
  return { x: 8.0, z: fallbackZ, y: groundHeightAt(8.0, fallbackZ) };
}

/**
 * Creates a grounded, terrain-aligned `AnimalPhysicsState` at a validated habitat position.
 */
export function createAnimalPhysicsState(params: {
  id: string;
  kind: AnimalKind;
  homeX: number;
  homeZ: number;
  phase?: number;
  speed?: number;
  hostile?: boolean;
  hp?: number;
  maxHp?: number;
}): AnimalPhysicsState {
  const safeHome = resolveSafeAnimalSpawn(params.homeX, params.homeZ, params.kind);
  const initialYaw = wrapAngle(params.phase ?? 0);
  const slope = computeTerrainSlopeAt(safeHome.x, safeHome.z, initialYaw);
  const defaultHp =
    params.kind === 'boar' ? 80 : params.hostile ? 45 : 25;

  return {
    id: params.id,
    kind: params.kind,
    x: safeHome.x,
    y: slope.groundY,
    z: safeHome.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: initialYaw,
    pitch: slope.pitch,
    roll: slope.roll,
    homeX: safeHome.x,
    homeZ: safeHome.z,
    phase: params.phase ?? 0,
    speed:
      params.speed ??
      (params.kind === 'boar'
        ? 2.35
        : params.kind === 'lizard'
        ? 2.3
        : params.kind === 'monkey'
        ? 1.95
        : 1.7),
    isGrounded: true,
    hostile: Boolean(params.hostile),
    hp: params.hp ?? defaultHp,
    maxHp: params.maxHp ?? defaultHp,
    attackCooldown: 0,
    hitFlashTimer: 0,
    fleeTimer: 0,
    behavior: 'patrol',
    gaitCycle: 0,
  };
}

/**
 * Applies a realistic 3D knockback velocity and upward vertical hop impulse when an animal is struck,
 * ensuring the animal arcs through the air and lands back on the terrain under gravity.
 */
export function applyAnimalKnockback(
  state: AnimalPhysicsState,
  fromX: number,
  fromZ: number,
  horizontalImpulse = 6.6,
  verticalImpulse = 4.1
): AnimalPhysicsState {
  const dx = state.x - fromX;
  const dz = state.z - fromZ;
  const dist = Math.hypot(dx, dz);
  const dirX = dist > 0.001 ? dx / dist : -Math.sin(state.yaw);
  const dirZ = dist > 0.001 ? dz / dist : -Math.cos(state.yaw);

  return {
    ...state,
    vx: dirX * horizontalImpulse,
    vy: verticalImpulse,
    vz: dirZ * horizontalImpulse,
    isGrounded: false,
    hitFlashTimer: 0.28,
    fleeTimer: state.hostile ? state.fleeTimer : Math.max(state.fleeTimer, 3.2),
    behavior: state.hostile ? state.behavior : 'flee',
  };
}

export interface AnimalStepContext {
  dt: number;
  elapsed: number;
  playerX: number;
  playerY?: number;
  playerZ: number;
  playerMoving?: boolean;
  playerSprinting?: boolean;
  isNight?: boolean;
  gameState?: 'title' | 'playing' | 'paused' | 'gameover';
}

export interface AnimalStepResult {
  state: AnimalPhysicsState;
  dealtDamage: number;
  attackedPlayer: boolean;
  playerPushX: number;
  playerPushZ: number;
}

/**
 * Advances a single animal's 3D physics, steering behavior, hazard avoidance,
 * vertical gravity/hop kinematics, player collision separation, and terrain slope alignment.
 */
export function stepAnimalPhysics(
  state: AnimalPhysicsState,
  ctx: AnimalStepContext
): AnimalStepResult {
  const dt = Math.max(0, Math.min(0.1, ctx.dt));
  if (dt <= 0 || (state.hostile && state.hp <= 0)) {
    return {
      state,
      dealtDamage: 0,
      attackedPlayer: false,
      playerPushX: 0,
      playerPushZ: 0,
    };
  }

  const isPlaying = (ctx.gameState ?? 'playing') === 'playing';
  const isNight = Boolean(ctx.isNight);
  const attackCooldown = Math.max(0, state.attackCooldown - dt);
  const hitFlashTimer = Math.max(0, state.hitFlashTimer - dt);
  let fleeTimer = Math.max(0, state.fleeTimer - dt);

  const toPlayerX = ctx.playerX - state.x;
  const toPlayerZ = ctx.playerZ - state.z;
  const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);
  const toHomeX = state.homeX - state.x;
  const toHomeZ = state.homeZ - state.z;
  const distFromHome = Math.hypot(toHomeX, toHomeZ);

  // 1. Evaluate behavior state machine (no sudden teleportation when losing aggro)
  let behavior: AnimalBehaviorState = state.behavior;
  const aggroRange = isNight ? 13.0 : 9.2;
  const leashRange = 22.0;
  const attackRange = state.kind === 'boar' ? 1.85 : 1.65;

  if (isPlaying) {
    if (state.hostile) {
      if (distToPlayer <= attackRange && distFromHome < leashRange) {
        behavior = 'attack';
      } else if (distToPlayer < aggroRange && distFromHome < leashRange) {
        behavior = 'chase';
      } else if (
        distFromHome > 7.2 ||
        ((state.behavior === 'chase' || state.behavior === 'attack' || state.behavior === 'return') &&
          distFromHome > 2.2)
      ) {
        behavior = 'return';
      } else {
        behavior = 'patrol';
      }
    } else {
      const startleRadius = ctx.playerSprinting
        ? 6.4
        : ctx.playerMoving
        ? 4.0
        : 2.3;
      if (distToPlayer < startleRadius) {
        fleeTimer = Math.max(fleeTimer, 2.5);
        behavior = 'flee';
      } else if (fleeTimer > 0) {
        behavior = 'flee';
      } else if (
        distFromHome > 6.8 ||
        (state.behavior === 'return' && distFromHome > 1.8)
      ) {
        behavior = 'return';
      } else {
        behavior = 'patrol';
      }
    }
  } else {
    behavior = distFromHome > 7.0 ? 'return' : 'patrol';
  }

  // 2. Compute desired horizontal velocity (desVx, desVz) from active behavior
  let phase = state.phase;
  let desVx = 0;
  let desVz = 0;
  let dealtDamage = 0;
  let attackedPlayer = false;
  let vy = state.vy;
  let isGrounded = state.isGrounded;

  if (behavior === 'patrol') {
    phase += dt * state.speed;
    let targetX = state.homeX;
    let targetZ = state.homeZ;
    let speedMult = 1.0;

    if (state.kind === 'crab') {
      targetX = state.homeX + Math.sin(phase) * 2.4;
      targetZ = state.homeZ + Math.cos(phase * 0.5) * 0.55;
    } else if (state.kind === 'lizard') {
      // Lizards dart in quick bursts and pause to bask
      const dartBurst = Math.max(0, Math.sin(phase * 1.65));
      speedMult = 0.2 + 1.25 * dartBurst;
      targetX = state.homeX + Math.cos(phase * 0.65) * 2.8;
      targetZ = state.homeZ + Math.sin(phase * 0.65) * 2.8;
    } else if (state.kind === 'monkey') {
      targetX = state.homeX + Math.sin(phase * 0.72) * 2.4;
      targetZ = state.homeZ + Math.sin(phase * 1.44) * 1.85;
    } else {
      // Boar territory patrol loop
      targetX = state.homeX + Math.cos(phase * 0.52) * 4.4;
      targetZ = state.homeZ + Math.sin(phase * 0.52) * 3.8;
    }

    const dx = targetX - state.x;
    const dz = targetZ - state.z;
    const d = Math.hypot(dx, dz);
    const maxPatrolSpeed = state.speed * speedMult * 1.35;
    if (d > 0.04) {
      const clampedSpd = Math.min(maxPatrolSpeed, d * 2.6);
      desVx = (dx / d) * clampedSpd;
      desVz = (dz / d) * clampedSpd;
    }
  } else if (behavior === 'chase') {
    const chaseSpeed =
      (state.kind === 'boar' ? 4.45 : 3.25) * (isNight ? 1.15 : 1.0);
    if (distToPlayer > 0.05) {
      desVx = (toPlayerX / distToPlayer) * chaseSpeed;
      desVz = (toPlayerZ / distToPlayer) * chaseSpeed;
    }
    // Hostile boar bounding charge hop when closing in
    if (
      isGrounded &&
      state.kind === 'boar' &&
      distToPlayer > 2.2 &&
      distToPlayer < 5.0 &&
      Math.sin(ctx.elapsed * 8.0 + state.phase) > 0.92
    ) {
      vy = 2.65;
      isGrounded = false;
    }
  } else if (behavior === 'attack') {
    desVx = 0;
    desVz = 0;
    if (attackCooldown <= 0) {
      dealtDamage = state.kind === 'boar' ? 12 : 8;
      attackedPlayer = true;
      if (isGrounded) {
        vy = 2.15;
        isGrounded = false;
      }
    }
  } else if (behavior === 'flee') {
    const awayX = distToPlayer > 0.01 ? -toPlayerX / distToPlayer : Math.cos(state.phase);
    const awayZ = distToPlayer > 0.01 ? -toPlayerZ / distToPlayer : Math.sin(state.phase);
    // Blend with homeward pull if fleeing too far from home territory
    const homePull = Math.max(0, Math.min(0.65, (distFromHome - 11.0) / 10.0));
    const homeDirX = distFromHome > 0.01 ? toHomeX / distFromHome : 0;
    const homeDirZ = distFromHome > 0.01 ? toHomeZ / distFromHome : 0;
    let dirX = awayX * (1 - homePull) + homeDirX * homePull;
    let dirZ = awayZ * (1 - homePull) + homeDirZ * homePull;
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;

    const fleeSpeed =
      state.kind === 'lizard'
        ? 4.7
        : state.kind === 'monkey'
        ? 4.3
        : 3.35;
    desVx = dirX * fleeSpeed;
    desVz = dirZ * fleeSpeed;
  } else if (behavior === 'return') {
    const returnSpeed = state.speed * 1.35;
    if (distFromHome > 0.1) {
      const spd = Math.min(returnSpeed, distFromHome * 1.8);
      desVx = (toHomeX / distFromHome) * spd;
      desVz = (toHomeZ / distFromHome) * spd;
    }
  }

  // 3. Proactive Hazard Avoidance (Southern Ocean Drop-Off, Deep Water & Lava Channels)
  const lookAheadT = 0.48;
  const probeX = state.x + desVx * lookAheadT;
  const probeZ = state.z + desVz * lookAheadT;
  const southShoreZ = getSouthernCoastlineZ(probeX);
  const shoreBuffer = state.kind === 'crab' ? 0.9 : 2.6;
  const minSafeY = state.kind === 'crab' ? WATER_LEVEL - 0.04 : WATER_LEVEL + 0.35;

  if (probeZ > southShoreZ - shoreBuffer || groundHeightAt(probeX, probeZ) < minSafeY) {
    // Steer back northwards onto dry beach/land
    desVz = Math.min(desVz, -2.1);
  }

  const lavaProx = lavaChannelProximity(probeX, probeZ);
  const probeRadius = Math.hypot(probeX, probeZ);
  if (lavaProx > 0.14 || probeRadius < 22.5) {
    // Compute repulsion away from central caldera and nearest lava channel
    const eps = 1.2;
    const lpR = lavaChannelProximity(probeX + eps, probeZ);
    const lpL = lavaChannelProximity(probeX - eps, probeZ);
    const lpU = lavaChannelProximity(probeX, probeZ + eps);
    const lpD = lavaChannelProximity(probeX, probeZ - eps);
    let repX = lpL - lpR;
    let repZ = lpD - lpU;
    if (probeRadius < 23.0 && probeRadius > 0.01) {
      repX += probeX / probeRadius;
      repZ += probeZ / probeRadius;
    }
    const repLen = Math.hypot(repX, repZ);
    if (repLen > 0.001) {
      const avoidSpd = Math.max(2.6, Math.hypot(desVx, desVz));
      desVx = (repX / repLen) * avoidSpd;
      desVz = (repZ / repLen) * avoidSpd;
    }
  }

  // 4. Soft Capsule Collision Separation between Animal and Player
  let playerPushX = 0;
  let playerPushZ = 0;
  const minSeparation =
    state.kind === 'boar' ? 1.15 : state.kind === 'crab' ? 0.92 : 0.72;
  if (isPlaying && distToPlayer < minSeparation && distToPlayer > 0.0001) {
    const overlap = minSeparation - distToPlayer;
    const sepDirX = toPlayerX / distToPlayer; // points from animal to player
    const sepDirZ = toPlayerZ / distToPlayer;
    // Push animal away from player and report gentle counter-push for player
    desVx -= sepDirX * overlap * 6.5;
    desVz -= sepDirZ * overlap * 6.5;
    playerPushX = sepDirX * overlap * 0.45;
    playerPushZ = sepDirZ * overlap * 0.45;
  }

  // 5. Smooth horizontal velocity damping & vertical gravity integration
  const accelRate = isGrounded ? (hitFlashTimer > 0 ? 4.5 : 10.5) : 3.2;
  const velDamp = 1 - Math.exp(-accelRate * dt);
  let vx = state.vx + (desVx - state.vx) * velDamp;
  let vz = state.vz + (desVz - state.vz) * velDamp;

  const horizSpeed = Math.hypot(vx, vz);
  const nextGaitCycle = state.gaitCycle + horizSpeed * dt;

  // Agile bounding hops for monkeys when moving on the ground
  if (
    isGrounded &&
    state.kind === 'monkey' &&
    horizSpeed > 0.55 &&
    Math.sin(nextGaitCycle * 3.4) > 0.86
  ) {
    vy = 3.25;
    isGrounded = false;
  }

  if (!isGrounded) {
    vy -= 22.0 * dt;
  }

  let nx = state.x + vx * dt;
  let nz = state.z + vz * dt;
  let ny = state.y + vy * dt;

  // Hard clamp to southern coastline and world boundary so animals never fall into the ocean abyss
  const maxAllowedZ =
    getSouthernCoastlineZ(nx) - (state.kind === 'crab' ? 0.55 : 2.0);
  if (nz > maxAllowedZ) {
    nz = maxAllowedZ;
    if (vz > 0) vz = 0;
  }

  const radialDist = Math.hypot(nx, nz);
  if (radialDist > WORLD_BOUNDARY_RADIUS - 20) {
    const scaleBack = (WORLD_BOUNDARY_RADIUS - 20) / radialDist;
    nx *= scaleBack;
    nz *= scaleBack;
  }

  // 6. Velocity-aligned heading (yaw) & terrain surface normal alignment (pitch & roll)
  let targetYaw = state.yaw;
  if ((behavior === 'attack' || behavior === 'chase') && distToPlayer > 0.05) {
    targetYaw = Math.atan2(-toPlayerX, -toPlayerZ);
  } else if (horizSpeed > 0.12) {
    const moveYaw = Math.atan2(-vx, -vz);
    // Crabs scuttle sideways along the sand during patrol, facing perpendicular to their lateral motion
    targetYaw =
      state.kind === 'crab' && behavior === 'patrol'
        ? wrapAngle(moveYaw + Math.PI * 0.5)
        : moveYaw;
  }

  const yawDelta = wrapAngle(targetYaw - state.yaw);
  const yawDamp = 1 - Math.exp(-10.5 * dt);
  const nextYaw = wrapAngle(state.yaw + yawDelta * yawDamp);

  const slope = computeTerrainSlopeAt(nx, nz, nextYaw);
  if (ny <= slope.groundY) {
    ny = slope.groundY;
    vy = 0;
    isGrounded = true;
  } else {
    isGrounded = false;
  }

  const tiltDamp = 1 - Math.exp(-12.0 * dt);
  const nextPitch = state.pitch + (slope.pitch - state.pitch) * tiltDamp;
  const nextRoll = state.roll + (slope.roll - state.roll) * tiltDamp;

  return {
    state: {
      ...state,
      x: nx,
      y: ny,
      z: nz,
      vx,
      vy,
      vz,
      yaw: nextYaw,
      pitch: nextPitch,
      roll: nextRoll,
      phase,
      isGrounded,
      attackCooldown: attackedPlayer ? 1.65 : attackCooldown,
      hitFlashTimer,
      fleeTimer,
      behavior,
      gaitCycle: nextGaitCycle,
    },
    dealtDamage,
    attackedPlayer,
    playerPushX,
    playerPushZ,
  };
}

