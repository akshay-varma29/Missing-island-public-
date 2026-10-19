/**
 * Developer Mode & Aerial Camera Controller for Caldera Castaway.
 * 
 * Provides:
 * - Dedicated Aerial Bird's-Eye View across the Sanctuary and the expanded 20km Island.
 * - Seamless switching between 3rd-Person player camera and Aerial overview.
 * - Cinematic smooth transitions between ground 3rd-person and aerial vantage points.
 * - Multi-scale viewing presets (Sanctuary, Whole Island 20km, Volcano, Lakes, Extended Beach).
 * - Pan, zoom/altitude, orbit, and pitch controls for aerial exploration.
 * - Dynamic fog density adaptation so high-altitude satellite views remain crystal clear.
 */

export type CameraViewMode =
  | 'third_person'
  | 'aerial_sanctuary'
  | 'aerial_island_20km'
  | 'aerial_free_drone';

export type AerialPresetId =
  | 'sanctuary'
  | 'island_20km'
  | 'volcano'
  | 'west_lake'
  | 'east_lake'
  | 'extended_beach'
  | 'north_peaks';

export interface AerialPreset {
  id: AerialPresetId;
  label: string;
  shortLabel: string;
  description: string;
  targetX: number;
  targetZ: number;
  altitude: number; // meters above ground
  pitchDeg: number; // angle pointing downward (e.g. 70° = high angle down, 88° = top-down)
  yawDeg: number;   // compass orientation (0° = looking North)
}

export interface CameraTransform {
  posX: number;
  posY: number;
  posZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

export interface DeveloperModeState {
  enabled: boolean;
  viewMode: CameraViewMode;
  targetX: number;
  targetZ: number;
  targetGroundY: number;
  altitude: number;
  yawRad: number;
  pitchRad: number;
  transitionProgress: number; // 0 = 3rd person, 1 = full aerial
  targetPresetId: AerialPresetId | null;
  droneSpeed: number; // pan speed in m/s
  clearSkies: boolean; // whether developer fog reduction is active
}

export const MIN_AERIAL_ALTITUDE = 25;
export const MAX_AERIAL_ALTITUDE = 2800;
export const DEFAULT_GROUND_FOG_DENSITY = 0.00045;

export const AERIAL_PRESETS: readonly AerialPreset[] = [
  {
    id: 'sanctuary',
    label: 'Sanctuary Overview',
    shortLabel: 'Sanctuary',
    description: 'Bird\'s-eye view of central sanctuary, beach, lakes, rivers, and jungle foothills',
    targetX: 0,
    targetZ: 38,
    altitude: 155,
    pitchDeg: 72,
    yawDeg: 0,
  },
  {
    id: 'island_20km',
    label: 'Whole 20km Island',
    shortLabel: '20km Island',
    description: 'High-altitude satellite view showing full 20km island, mountains, caldera, and outer ocean',
    targetX: 0,
    targetZ: 0,
    altitude: 1350,
    pitchDeg: 86,
    yawDeg: 0,
  },
  {
    id: 'volcano',
    label: 'Volcano Caldera',
    shortLabel: 'Caldera',
    description: 'Top-down aerial view looking directly into Mt. Caldera smoking crater',
    targetX: 0,
    targetZ: 0,
    altitude: 110,
    pitchDeg: 88,
    yawDeg: 0,
  },
  {
    id: 'west_lake',
    label: 'West Mirror Lake & River',
    shortLabel: 'West Lake',
    description: 'Aerial overview of West Mirror Lake, river canyon, and western emerald hills',
    targetX: -54,
    targetZ: 32,
    altitude: 90,
    pitchDeg: 68,
    yawDeg: 40,
  },
  {
    id: 'east_lake',
    label: 'East Oasis Lake & Valley',
    shortLabel: 'East Lake',
    description: 'Aerial overview of East Oasis Lake, mountain runoff river, and eastern ridges',
    targetX: 54,
    targetZ: 32,
    altitude: 90,
    pitchDeg: 68,
    yawDeg: -40,
  },
  {
    id: 'extended_beach',
    label: 'Extended South Beach',
    shortLabel: 'Beach',
    description: 'Aerial view of southern extended sandy coves, surf, shipwreck, and shipyard',
    targetX: 0,
    targetZ: 70,
    altitude: 80,
    pitchDeg: 64,
    yawDeg: 0,
  },
  {
    id: 'north_peaks',
    label: 'North Alpine Massif',
    shortLabel: 'Alpine Peaks',
    description: 'High vantage looking at the northern alpine mountain crest and tarns',
    targetX: -24,
    targetZ: -36,
    altitude: 120,
    pitchDeg: 66,
    yawDeg: 180,
  },
];

export function getAerialPreset(id: AerialPresetId): AerialPreset {
  const match = AERIAL_PRESETS.find((p) => p.id === id);
  return match ?? AERIAL_PRESETS[0];
}

export function createInitialDeveloperModeState(): DeveloperModeState {
  const p = AERIAL_PRESETS[0];
  return {
    enabled: false,
    viewMode: 'third_person',
    targetX: p.targetX,
    targetZ: p.targetZ,
    targetGroundY: 2.0,
    altitude: p.altitude,
    yawRad: (p.yawDeg * Math.PI) / 180,
    pitchRad: (p.pitchDeg * Math.PI) / 180,
    transitionProgress: 0,
    targetPresetId: null,
    droneSpeed: 45,
    clearSkies: true,
  };
}

/**
 * Computes exact 3D camera position and lookAt vector for an aerial bird's-eye perspective.
 */
export function computeAerialCameraPosition(params: {
  targetX: number;
  targetZ: number;
  targetGroundY?: number;
  altitude: number;
  yawRad: number;
  pitchRad: number;
}): CameraTransform {
  const groundY = params.targetGroundY ?? 0;
  const clampedAlt = Math.max(MIN_AERIAL_ALTITUDE, Math.min(MAX_AERIAL_ALTITUDE, params.altitude));
  const clampedPitch = Math.max(0.25, Math.min(1.54, params.pitchRad)); // 14° to ~88° downward angle

  // Setback distance along the ground based on altitude and tilt angle
  const horizDist = clampedAlt / Math.tan(clampedPitch);

  const camX = params.targetX + Math.sin(params.yawRad) * horizDist;
  const camZ = params.targetZ + Math.cos(params.yawRad) * horizDist;
  const camY = groundY + clampedAlt;

  return {
    posX: camX,
    posY: camY,
    posZ: camZ,
    lookX: params.targetX,
    lookY: groundY,
    lookZ: params.targetZ,
  };
}

/**
 * Linearly interpolates two camera transforms (position + lookAt target)
 * for smooth cinematic camera transitions between 3rd person and aerial modes.
 */
export function lerpCameraTransform(
  from: CameraTransform,
  to: CameraTransform,
  t: number
): CameraTransform {
  const clampedT = Math.max(0, Math.min(1, t));
  // Smooth cubic ease-in-out easing
  const smoothT = clampedT * clampedT * (3 - 2 * clampedT);

  return {
    posX: from.posX + (to.posX - from.posX) * smoothT,
    posY: from.posY + (to.posY - from.posY) * smoothT,
    posZ: from.posZ + (to.posZ - from.posZ) * smoothT,
    lookX: from.lookX + (to.lookX - from.lookX) * smoothT,
    lookY: from.lookY + (to.lookY - from.lookY) * smoothT,
    lookZ: from.lookZ + (to.lookZ - from.lookZ) * smoothT,
  };
}

/**
 * Steps aerial camera horizontal pan based on forward/right input relative to aerial yaw orientation.
 */
export function stepAerialPan(
  current: { targetX: number; targetZ: number; yawRad: number },
  input: { forward: number; right: number },
  speed: number,
  dt: number
): { targetX: number; targetZ: number } {
  if (input.forward === 0 && input.right === 0) {
    return { targetX: current.targetX, targetZ: current.targetZ };
  }

  // Camera-relative forward & right on XZ plane
  const fwdX = -Math.sin(current.yawRad);
  const fwdZ = -Math.cos(current.yawRad);
  const rgtX = Math.cos(current.yawRad);
  const rgtZ = -Math.sin(current.yawRad);

  const moveDist = speed * dt;
  const dx = (fwdX * input.forward + rgtX * input.right) * moveDist;
  const dz = (fwdZ * input.forward + rgtZ * input.right) * moveDist;

  // Clamp within the 20km island exploration boundary
  const nextX = Math.max(-10500, Math.min(10500, current.targetX + dx));
  const nextZ = Math.max(-10500, Math.min(10500, current.targetZ + dz));

  return { targetX: nextX, targetZ: nextZ };
}

/**
 * Adjusts fog density so that high-altitude aerial views are completely crisp and unclouded,
 * while ground-level 3rd-person retains the lush tropical atmospheric fog.
 */
export function computeOptimalFogDensity(
  altitude: number,
  clearSkies = true
): number {
  if (!clearSkies) return DEFAULT_GROUND_FOG_DENSITY;

  if (altitude <= 50) {
    return DEFAULT_GROUND_FOG_DENSITY;
  }
  if (altitude >= 800) {
    return 0.000025; // Crystal-clear satellite view
  }

  // Smooth quadratic attenuation between 50m and 800m
  const t = (altitude - 50) / (800 - 50);
  const factor = (1 - t) * (1 - t);
  return 0.000025 + (DEFAULT_GROUND_FOG_DENSITY - 0.000025) * factor;
}

/**
 * Clamps aerial zoom / altitude within supported limits.
 */
export function clampAerialAltitude(alt: number): number {
  return Math.max(MIN_AERIAL_ALTITUDE, Math.min(MAX_AERIAL_ALTITUDE, alt));
}

/**
 * Formats a clean human-readable readout of the current aerial position.
 */
export function formatAerialReadout(state: {
  targetX: number;
  targetZ: number;
  altitude: number;
  yawRad: number;
}): {
  coordinates: string;
  altitudeLabel: string;
  compassHeading: number;
} {
  const x = Math.round(state.targetX);
  const z = Math.round(state.targetZ);
  const alt = Math.round(state.altitude);

  const altitudeLabel = alt >= 1000 ? `${(alt / 1000).toFixed(2)} km` : `${alt} m`;
  let deg = Math.round((-state.yawRad * 180) / Math.PI) % 360;
  if (deg < 0) deg += 360;
  if (deg === 0 || Object.is(deg, -0)) deg = 0;

  return {
    coordinates: `(${x > 0 ? '+' : ''}${x}m, ${z > 0 ? '+' : ''}${z}m)`,
    altitudeLabel,
    compassHeading: deg,
  };
}
