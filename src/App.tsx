import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IslandSurvivalEngine,
  HudSnapshot,
} from './game/IslandEngine';
import {
  normalizeJoystickInput,
  worldToGeographicalMapCoords,
  generateIslandCoastlineSvgPath,
  playerYawToMinimapAngle,
  getISTTimeState,
  getBackpackStorageState,
  getBoatStageRequirement,
  DEFAULT_BACKPACK_CAPACITY,
  CampfireSiteInfo,
  MACRO_ISLAND_CENTER_X,
  MACRO_ISLAND_CENTER_Z,
} from './game/rules';
import { AERIAL_PRESETS, AerialPresetId } from './game/developerMode';

const INITIAL_IST = getISTTimeState();

const INITIAL_HUD: HudSnapshot = {
  state: 'title',
  vitals: {
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    hunger: 100,
    maxHunger: 100,
    thirst: 100,
    maxThirst: 100,
  },
  inventory: {
    coconuts: 1,
    wood: 0,
    food: 0,
    rope: 0,
    hasKnife: false,
    hasRope: false,
    hasMap: false,
  },
  biome: 'beach',
  dayPhase: INITIAL_IST.phase,
  clockLabel: INITIAL_IST.clockLabel,
  istClockWithSeconds: INITIAL_IST.clockWithSeconds,
  istDateLabel: INITIAL_IST.dateLabel,
  isRealTimeIST: true,
  timeOfDay: INITIAL_IST.normalizedTime,
  isSwimming: false,
  inLava: false,
  nearbyPrompt: null,
  statusToast: null,
  campfiresLit: 0,
  totalCampfires: 3,
  daysSurvived: 1,
  resourcesCollected: 0,
  victory: false,
  gait: 'walk',
  isBending: false,
  joystickX: 0,
  joystickY: 0,
  playerX: 0,
  playerZ: 66,
  playerYaw: 0,
  camYaw: 0,
  camCompassDeg: 0,
  volcanoX: 0,
  volcanoZ: 0,
  campfires: [
    { id: 'camp_beach', label: 'Beach Shelter Campfire', x: 3.8, z: 62.5, lit: false },
    { id: 'camp_jungle', label: 'Jungle Ridge Campfire', x: 0.0, z: 44.0, lit: false },
    { id: 'camp_volcano', label: 'Volcano Overlook Beacon', x: -2.0, z: 28.5, lit: false },
  ],
  boatStage: 0,
  supplyBoxOpened: false,
  supplyBoxPos: { x: -8.5, z: 62.5, isAshore: false },
  boatPos: { x: 6.2, z: 65.5 },
  creaturesDefeated: 0,
  nearbyCreature: null,
  questObjective:
    '1. Watch the Sea Supply Box drifting in from the ocean waves & open it on the SW Shore',
  devMode: {
    enabled: false,
    viewMode: 'third_person',
    activePresetId: null,
    altitude: 155,
    altitudeLabel: '155 m',
    targetCoords: '(0m, +38m)',
    compassHeading: 0,
    clearSkies: true,
  },
};

const MACRO_COASTLINE_SVG_PATH = generateIslandCoastlineSvgPath(72, 100, 11500);

/**
 * Rectangular Topographic Geographical Map displayed in the top-right corner (replaces the old circular compass map).
 * Displays hypsometric terrain relief, elevation contour lines (0m, 5m, 15m, 25m), freshwater stream & waterfall,
 * molten lava channels, cartographic graticule grid, ground elevation readout, scale bar, and live landmarks.
 */
const GeographicalMap = React.memo(function GeographicalMap({
  playerX,
  playerZ,
  playerYaw,
  camYaw,
  volcanoX,
  volcanoZ,
  campfires,
  supplyBoxOpened,
  supplyBoxX,
  supplyBoxZ,
  boatX,
  boatZ,
  boatStage,
  hasMap,
  onOpenAtlas,
}: {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  camYaw?: number;
  volcanoX: number;
  volcanoZ: number;
  campfires: CampfireSiteInfo[];
  supplyBoxOpened: boolean;
  supplyBoxX: number;
  supplyBoxZ: number;
  boatX: number;
  boatZ: number;
  boatStage: number;
  hasMap: boolean;
  onOpenAtlas: () => void;
}) {
  const playerDist = Math.hypot(playerX, playerZ);
  const isMacroIslandView = playerDist > 82;
  const mapCenterX = isMacroIslandView ? MACRO_ISLAND_CENTER_X : 0;
  const mapCenterZ = isMacroIslandView ? MACRO_ISLAND_CENTER_Z : 0;
  const mapHalfExtent = isMacroIslandView
    ? Math.min(11500, Math.max(300, playerDist * 1.35))
    : 80;

  const playerPt = worldToGeographicalMapCoords(playerX, playerZ, mapHalfExtent, mapCenterX, mapCenterZ);
  const volcanoPt = worldToGeographicalMapCoords(volcanoX, volcanoZ, mapHalfExtent, mapCenterX, mapCenterZ);
  const supplyPt = worldToGeographicalMapCoords(supplyBoxX, supplyBoxZ, mapHalfExtent, mapCenterX, mapCenterZ);
  const boatPt = worldToGeographicalMapCoords(boatX, boatZ, mapHalfExtent, mapCenterX, mapCenterZ);
  const playerDeg = playerYawToMinimapAngle(camYaw ?? playerYaw);

  const distToTarget = !supplyBoxOpened
    ? Math.round(Math.hypot(playerX - supplyBoxX, playerZ - supplyBoxZ))
    : Math.round(Math.hypot(playerX - boatX, playerZ - boatZ));

  const scaleBarLabel = isMacroIslandView
    ? `${(mapHalfExtent / 500).toFixed(1)} km`
    : '40 m';

  return (
    <div className="flex flex-col items-end">
      <div
        data-testid="geographical-map"
        role="region"
        aria-label="Island Geographical Map"
        onClick={onOpenAtlas}
        title="Click to open Full Geographical Island Atlas [G]"
        className="relative w-32 h-28 sm:w-40 sm:h-32 md:w-44 md:h-36 rounded-lg border-2 border-amber-600/85 shadow-2xl overflow-hidden shrink-0 select-none cursor-pointer group hover:border-amber-300 transition-colors"
        style={{
          background: 'linear-gradient(180deg, #0b2232 0%, #071824 100%)',
        }}
      >
        {/* Top Cartographic Header Strip (Replaces Compass Bezel) */}
        <div
          className="relative z-20 flex items-center justify-between px-1.5 py-0.5 border-b border-amber-700/60 text-[8px] sm:text-[9px] font-bold tracking-wider uppercase"
          style={{ backgroundColor: 'rgba(18, 26, 24, 0.92)' }}
        >
          <span className="text-amber-300 truncate">
            {isMacroIslandView ? '20km Geo Chart' : 'Geo Relief Map'}
          </span>
          <span
            data-testid="geographical-elevation-readout"
            className="font-mono-num text-emerald-300 whitespace-nowrap ml-1"
          >
            {playerPt.elevationMeters >= 0 ? `+${playerPt.elevationMeters}m` : `${playerPt.elevationMeters}m`}
          </span>
        </div>

        {/* Cartographic Topographic Relief SVG */}
        <div className="relative w-full h-[calc(100%-34px)] overflow-hidden">
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="geoOceanBathymetry" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#082f49" />
                <stop offset="55%" stopColor="#0c4a6e" />
                <stop offset="100%" stopColor="#072235" />
              </linearGradient>
              <radialGradient id="geoIslandHypsometric" cx="50%" cy="46%" r="50%">
                <stop offset="0%" stopColor="#451a03" stopOpacity="0.96" />
                <stop offset="22%" stopColor="#3f3f46" stopOpacity="0.95" />
                <stop offset="48%" stopColor="#14532d" stopOpacity="0.96" />
                <stop offset="76%" stopColor="#15803d" stopOpacity="0.95" />
                <stop offset="91%" stopColor="#d97706" stopOpacity="0.94" />
                <stop offset="100%" stopColor="#fde68a" stopOpacity="0.90" />
              </radialGradient>
            </defs>

            {/* Deep Ocean Bathymetry Base */}
            <rect x="0" y="0" width="100" height="100" fill="url(#geoOceanBathymetry)" />

            {/* Rectangular Cartographic Graticule Grid (Latitude / Longitude Parallels & Meridians) */}
            <line x1="25" y1="0" x2="25" y2="100" stroke="#38bdf8" strokeWidth="0.3" strokeOpacity="0.22" />
            <line x1="50" y1="0" x2="50" y2="100" stroke="#38bdf8" strokeWidth="0.35" strokeOpacity="0.28" strokeDasharray="1.5 1.5" />
            <line x1="75" y1="0" x2="75" y2="100" stroke="#38bdf8" strokeWidth="0.3" strokeOpacity="0.22" />
            <line x1="0" y1="25" x2="100" y2="25" stroke="#38bdf8" strokeWidth="0.3" strokeOpacity="0.22" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="#38bdf8" strokeWidth="0.35" strokeOpacity="0.28" strokeDasharray="1.5 1.5" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="#38bdf8" strokeWidth="0.3" strokeOpacity="0.22" />

            {/* Southern Reef Bathymetric Shelf (-2m) in front of the Beach */}
            <path
              d={
                isMacroIslandView
                  ? 'M3 48 C4 18 22 4 50 4 C78 4 96 18 97 48 C97 78 88 95 50 96 C12 95 3 78 3 48 Z'
                  : 'M0 0 L100 0 L100 95 Q75 97 50 94 Q25 97 0 95 Z'
              }
              fill="#0284c7"
              fillOpacity="0.22"
              stroke="#38bdf8"
              strokeWidth="0.5"
              strokeDasharray="2 1.5"
              strokeOpacity="0.55"
            />

            {/* Primary Island Landmass & Southern Beach Shoreline (0m Sea-Level Contour) */}
            {isMacroIslandView ? (
              <path
                d={MACRO_COASTLINE_SVG_PATH}
                fill="url(#geoIslandHypsometric)"
                stroke="#fde68a"
                strokeWidth="0.9"
              />
            ) : (
              <>
                {/* Continuous Back-Side Island Landmass (North of the Beach) */}
                <path
                  d="M0 0 L100 0 L100 92 Q82 94 66 92 Q56 90 50 90 Q44 90 34 92 Q16 94 0 92 Z"
                  fill="#15803d"
                  fillOpacity="0.95"
                />
                {/* Stage 2 Extended Golden Southern Beach Sand Belt */}
                <path
                  d="M0 76 Q25 80 50 79 Q75 80 100 76 L100 92 Q82 94 66 92 Q56 90 50 90 Q44 90 34 92 Q16 94 0 92 Z"
                  fill="#fde68a"
                  fillOpacity="0.93"
                  stroke="#f59e0b"
                  strokeWidth="0.6"
                />
              </>
            )}

            {/* Hypsometric Topographic Elevation Contour 1: +5m Lowland Jungle & Northern Grasslands */}
            <path
              d={
                isMacroIslandView
                  ? 'M14 48 C15 22 28 12 50 12 C72 12 85 22 86 48 C86 74 76 87 50 88 C24 87 14 74 14 48 Z'
                  : 'M0 0 L100 0 L100 82 Q75 84 50 81 Q25 84 0 82 Z'
              }
              fill="#166534"
              fillOpacity="0.62"
              stroke="#86efac"
              strokeWidth="0.45"
              strokeDasharray="2.5 1.2"
              strokeOpacity="0.65"
            />

            {/* Hypsometric Topographic Elevation Contour 2: +12m Mid-Jungle Canopy Ridge */}
            <path
              d="M50 22C64 22 76 33 77 48C78 63 65 74 50 75C35 74 22 63 23 48C24 33 36 22 50 22Z"
              fill="#14532d"
              fillOpacity="0.72"
              stroke="#bbf7d0"
              strokeWidth="0.45"
              strokeOpacity="0.65"
            />

            {/* Hypsometric Topographic Elevation Contour 3: +20m Basalt Volcanic Cone */}
            <ellipse
              cx="50"
              cy="49"
              rx="16.5"
              ry="15.5"
              fill="#27272a"
              stroke="#fbbf24"
              strokeWidth="0.55"
              strokeDasharray="1.8 1"
              strokeOpacity="0.75"
            />

            {/* Hypsometric Topographic Elevation Contour 4: +26m Caldera Summit Rim & Molten Crater */}
            <circle
              cx="50"
              cy="49"
              r="7.8"
              fill="#7c2d12"
              stroke="#f97316"
              strokeWidth="0.7"
            />
            <circle cx="50" cy="49" r="4.2" fill="#ef4444" />

            {/* 4 Geological Lava Channels Flowing Down Volcano Slopes */}
            <path
              d="M50 49 Q57 41 66 36"
              stroke="#ff4500"
              strokeWidth="1.15"
              strokeLinecap="round"
              fill="none"
              opacity="0.88"
            />
            <path
              d="M50 49 Q42 41 34 35"
              stroke="#ff4500"
              strokeWidth="1.15"
              strokeLinecap="round"
              fill="none"
              opacity="0.88"
            />
            <path
              d="M50 49 Q42 57 35 63"
              stroke="#ff4500"
              strokeWidth="1.15"
              strokeLinecap="round"
              fill="none"
              opacity="0.88"
            />
            <path
              d="M50 49 Q58 57 65 64"
              stroke="#ff4500"
              strokeWidth="1.15"
              strokeLinecap="round"
              fill="none"
              opacity="0.88"
            />

            {/* Stage 2 Hills & Mountains Contours */}
            <ellipse cx="14" cy="48" rx="11" ry="8" fill="#166534" stroke="#a3e635" strokeWidth="0.4" opacity="0.82" />
            <ellipse cx="86" cy="49" rx="11" ry="8" fill="#166534" stroke="#a3e635" strokeWidth="0.4" opacity="0.82" />
            <ellipse cx="22" cy="14" rx="13" ry="9" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="0.45" opacity="0.85" />
            <ellipse cx="78" cy="14" rx="13" ry="9" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="0.45" opacity="0.85" />

            {/* Hydrological Features: Southwest Waterfall Stream + Stage 2 Lakes & Rivers */}
            <path
              d="M42.2 69.5 Q41.5 74.2 42.8 78.8 Q41.6 84.4 39.8 90.5"
              stroke="#38bdf8"
              strokeWidth="1.4"
              strokeLinecap="round"
              fill="none"
              opacity="0.95"
            />
            <circle
              cx="42.2"
              cy="69.5"
              r="1.5"
              fill="#e0f2fe"
              stroke="#0284c7"
              strokeWidth="0.5"
            />
            {/* Stage 2 West Lagoon River & East Oasis River + Northern Foothill River */}
            <path
              d="M20 11 Q13 38 16 70 Q15 82 14 91"
              stroke="#38bdf8"
              strokeWidth="1.35"
              strokeLinecap="round"
              fill="none"
              opacity="0.94"
            />
            <path
              d="M82 10 Q88 38 85 71 Q86 82 87 91"
              stroke="#38bdf8"
              strokeWidth="1.35"
              strokeLinecap="round"
              fill="none"
              opacity="0.94"
            />
            <path
              d="M8 6 Q20 11 50 10 Q82 10 92 6"
              stroke="#38bdf8"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
              opacity="0.9"
            />
            {/* Stage 2 Freshwater Lakes (West Mirror Lake, East Oasis Lake, Emerald Lake, Twin Crag Tarn) */}
            <ellipse cx="16.2" cy="70.0" rx="6.8" ry="5.2" fill="#0ea5e9" stroke="#bae6fd" strokeWidth="0.5" opacity="0.95" />
            <ellipse cx="85.0" cy="71.2" rx="7.2" ry="5.5" fill="#0ea5e9" stroke="#bae6fd" strokeWidth="0.5" opacity="0.95" />
            <ellipse cx="20.0" cy="11.2" rx="8.2" ry="6.2" fill="#0284c7" stroke="#bae6fd" strokeWidth="0.5" opacity="0.95" />
            <ellipse cx="82.5" cy="10.0" rx="8.0" ry="6.0" fill="#0284c7" stroke="#bae6fd" strokeWidth="0.5" opacity="0.95" />

            {/* Overland Topographic Trails & Footbridge */}
            <path
              d="M52.3 88.5 Q51.5 82.0 50.0 76.5 Q49.2 71.0 48.8 66.8"
              stroke="#d97706"
              strokeWidth="0.85"
              strokeLinecap="round"
              strokeDasharray="1.2 0.9"
              fill="none"
              opacity="0.85"
            />
            <path
              d="M50.0 76.5 Q46.2 77.2 42.8 78.8"
              stroke="#d97706"
              strokeWidth="0.75"
              strokeLinecap="round"
              strokeDasharray="1 0.8"
              fill="none"
              opacity="0.8"
            />

            {/* Topographic Contour Elevation Labels (Instead of N/S/W/E Compass Labels) */}
            <text x="68" y="49" fill="#fde68a" fontSize="4.6" fontWeight="bold" opacity="0.85">
              20m
            </text>
            <text x="74" y="65" fill="#bbf7d0" fontSize="4.4" fontWeight="bold" opacity="0.8">
              5m
            </text>
            <text x="11" y="21" fill="#7dd3fc" fontSize="4.4" fontWeight="bold" opacity="0.75">
              -2m
            </text>
          </svg>

          {/* 1. Active Volcano Caldera Summit Marker */}
          <div
            data-testid="minimap-volcano-center"
            title="Active Volcano Caldera Summit (+28m)"
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
            style={{
              left: `${volcanoPt.percentX}%`,
              top: `${volcanoPt.percentY}%`,
            }}
          >
            <div className="w-3 h-3 rounded-full bg-gradient-to-tr from-red-600 via-orange-500 to-yellow-300 border border-amber-100 shadow-[0_0_6px_rgba(239,68,68,0.95)] flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-white" />
            </div>
          </div>

          {/* 2. Three Campfire Landmarks */}
          {campfires.map((camp) => {
            const coord = worldToGeographicalMapCoords(camp.x, camp.z, mapHalfExtent);
            return (
              <div
                key={camp.id}
                data-testid={`minimap-campfire-${camp.id}`}
                title={`${camp.label} (${camp.lit ? 'Lit Signal Beacon' : 'Campfire Site - Needs 3 Wood'})`}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
                style={{
                  left: `${coord.percentX}%`,
                  top: `${coord.percentY}%`,
                }}
              >
                {camp.lit ? (
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-3 h-3 rounded-full bg-orange-400 animate-ping opacity-75" />
                    <div className="w-3 h-3 rounded-full bg-amber-400 border border-white shadow-[0_0_6px_#f59e0b]" />
                  </div>
                ) : (
                  <div className="w-2.5 h-2.5 rotate-45 rounded-xs bg-amber-400 border border-stone-950 shadow-md flex items-center justify-center">
                    <div className="w-1 h-1 rounded-full bg-stone-950" />
                  </div>
                )}
              </div>
            );
          })}

          {/* 2b. Sea-Drifted Supply Box Marker */}
          {!supplyBoxOpened && (
            <div
              data-testid="minimap-supply-box"
              title="Sea-Drifted Supply Box (Contains Knife, Rope & Island Map)"
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
              style={{
                left: `${supplyPt.percentX}%`,
                top: `${supplyPt.percentY}%`,
              }}
            >
              <div className="relative flex items-center justify-center">
                <div className="absolute w-3.5 h-3.5 rounded-full bg-cyan-400 animate-ping opacity-80" />
                <div className="w-2.5 h-2.5 rounded-xs bg-cyan-300 border border-stone-950 shadow-[0_0_6px_#22d3ee]" />
              </div>
            </div>
          )}

          {/* 2c. Escape Boat Shipyard Marker */}
          <div
            data-testid="minimap-boat-site"
            title={`Escape Boat Shipyard (Stage ${boatStage}/3)`}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none ${
              hasMap ? 'opacity-100' : 'opacity-65'
            }`}
            style={{
              left: `${boatPt.percentX}%`,
              top: `${boatPt.percentY}%`,
            }}
          >
            <div className="w-3 h-3 rounded-full bg-emerald-400 border border-stone-950 shadow-[0_0_6px_#10b981] flex items-center justify-center text-[7px] font-black text-stone-950">
              B
            </div>
          </div>

          {/* 3. Castaway Location & Heading Marker */}
          <div
            data-testid="minimap-player"
            title={`Castaway Location (${Math.round(playerX)}m, ${Math.round(playerZ)}m)`}
            className="absolute z-20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none transition-transform duration-75 ease-out"
            style={{
              left: `${playerPt.percentX}%`,
              top: `${playerPt.percentY}%`,
            }}
          >
            <div className="relative flex items-center justify-center">
              <div className="absolute w-4 h-4 rounded-full bg-sky-400/40 animate-ping" />
              <div
                className="w-3.5 h-3.5 flex items-center justify-center transition-transform duration-75"
                style={{
                  transform: `rotate(${playerDeg}deg)`,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2L20 20L12 16L4 20L12 2Z"
                    fill="#38bdf8"
                    stroke="#082f49"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="11" r="2.2" fill="#ffffff" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Cartographic Scale Bar & Graticule Strip */}
        <div
          className="relative z-20 flex items-center justify-between px-1.5 py-0.5 border-t border-amber-700/60 text-[8px] font-mono-num text-stone-300"
          style={{ backgroundColor: 'rgba(14, 21, 20, 0.94)' }}
        >
          <span className="flex items-center gap-1">
            <span className="inline-block w-3.5 h-1 border-x border-b border-amber-300" />
            <span>{scaleBarLabel}</span>
          </span>
          <span className="text-amber-300 font-semibold group-hover:underline">
            Atlas [G]
          </span>
        </div>
      </div>

      {/* Distance to Supply Crate or Boat Shipyard */}
      <span className="text-[9px] font-semibold tracking-wider text-amber-200 mt-1 uppercase font-mono-num px-2 py-0.5 rounded bg-stone-950/90 border border-amber-900/60 shadow whitespace-nowrap">
        {!supplyBoxOpened ? `${distToTarget}m to Sea Box` : `${distToTarget}m to Boat`}
      </span>
    </div>
  );
}, (prev, next) => {
  if (Math.abs(prev.playerX - next.playerX) > 0.25) return false;
  if (Math.abs(prev.playerZ - next.playerZ) > 0.25) return false;
  if (Math.abs(prev.playerYaw - next.playerYaw) > 0.04) return false;
  if (prev.supplyBoxOpened !== next.supplyBoxOpened) return false;
  if (prev.boatStage !== next.boatStage) return false;
  if (prev.hasMap !== next.hasMap) return false;
  if (Math.abs(prev.supplyBoxX - next.supplyBoxX) > 0.3) return false;
  if (Math.abs(prev.supplyBoxZ - next.supplyBoxZ) > 0.3) return false;
  if (prev.campfires.length !== next.campfires.length) return false;
  for (let i = 0; i < prev.campfires.length; i++) {
    if (prev.campfires[i].lit !== next.campfires[i].lit) return false;
  }
  return true;
});

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<IslandSurvivalEngine | null>(null);
  const joystickBaseRef = useRef<HTMLDivElement | null>(null);
  const joystickKnobRef = useRef<HTMLDivElement | null>(null);
  const joystickRectRef = useRef<DOMRect | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [joystickActive, setJoystickActive] = useState<boolean>(false);

  const [backpackOpen, setBackpackOpen] = useState(false);
  const [geoAtlasOpen, setGeoAtlasOpen] = useState(false);
  const [atlasScaleMode, setAtlasScaleMode] = useState<'sanctuary' | 'macro20km'>('sanctuary');
  const backpackState = getBackpackStorageState(hud.inventory, DEFAULT_BACKPACK_CAPACITY);
  const nextBoatReq = getBoatStageRequirement(hud.boatStage);
  const playerGeoPoint = useMemo(
    () =>
      worldToGeographicalMapCoords(
        hud.playerX,
        hud.playerZ,
        atlasScaleMode === 'macro20km' ? 11500 : 80,
        atlasScaleMode === 'macro20km' ? MACRO_ISLAND_CENTER_X : 0,
        atlasScaleMode === 'macro20km' ? MACRO_ISLAND_CENTER_Z : 0
      ),
    [hud.playerX, hud.playerZ, atlasScaleMode]
  );

  const hpPct = Math.max(0, Math.min(100, Math.round(hud.vitals.hp)));
  const staminaPct = Math.max(0, Math.min(100, Math.round(hud.vitals.stamina)));
  const hungerPct = Math.max(0, Math.min(100, Math.round(hud.vitals.hunger)));
  const thirstPct = Math.max(0, Math.min(100, Math.round(hud.vitals.thirst ?? 100)));

  // Trailing ghost HP for rally bar visual feedback
  const [ghostHp, setGhostHp] = useState<number>(100);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGhostHp(hpPct);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [hpPct]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const autoStart = params.get('autostart') === '1';
    document.body.dataset.state = autoStart ? 'playing' : 'title';

    const engine = new IslandSurvivalEngine(container, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
    });
    engineRef.current = engine;

    if (autoStart) {
      engine.startGame();
    }

    const onKeyH = (e: KeyboardEvent) => {
      if (document.body.dataset.state !== 'playing') return;
      if (e.code === 'KeyH') {
        setDockCollapsed((prev) => !prev);
      } else if (e.code === 'KeyB' || e.code === 'KeyI') {
        if (document.pointerLockElement && document.exitPointerLock) {
          try {
            document.exitPointerLock();
          } catch {
            // ignore
          }
        }
        setBackpackOpen((prev) => !prev);
      } else if (e.code === 'KeyG') {
        if (document.pointerLockElement && document.exitPointerLock) {
          try {
            document.exitPointerLock();
          } catch {
            // ignore
          }
        }
        setGeoAtlasOpen((prev) => !prev);
      } else if (e.code === 'Escape') {
        setBackpackOpen(false);
        setGeoAtlasOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyH);

    return () => {
      window.removeEventListener('keydown', onKeyH);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleStart = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    engineRef.current?.startGame();
  };

  const handleToggleMute = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    const muted = engineRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
  };

  const handleTogglePause = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.togglePause();
  };

  const handleRestart = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.restartGame(false);
  };

  const handleReturnToTitle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.returnToTitle();
  };

  const handleInteractClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.triggerInteract();
  };

  const handleAttackClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.triggerAttack();
  };

  const handleConsumeItem = (
    type: 'coconut' | 'food',
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.currentTarget.blur();
    engineRef.current?.triggerConsumeProvision(type);
  };

  const handleToggleBackpack = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (document.pointerLockElement && document.exitPointerLock) {
      try {
        document.exitPointerLock();
      } catch {
        // ignore
      }
    }
    setBackpackOpen((prev) => !prev);
  };

  const handleDropBackpackItem = (
    kind: 'coconut' | 'food' | 'wood' | 'rope',
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.currentTarget.blur();
    engineRef.current?.dropBackpackItem(kind);
  };

  const handleSetTimePreset = (
    preset: number | 'IST',
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.currentTarget.blur();
    engineRef.current?.setTimeOfDayPreset(preset);
  };

  const handleSelectWalk = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.setGait('walk');
  };

  const handleSelectRun = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.setGait('run');
  };

  const handleToggleBend = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.toggleBend();
  };

  const handleFlipPov180 = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.flipCamera180();
  };

  const handleToggleAerialView = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    if (hud.devMode?.viewMode !== 'third_person') {
      engineRef.current?.setCameraViewMode('third_person');
    } else {
      engineRef.current?.setCameraViewMode('aerial_sanctuary');
    }
  };

  const handleReturnToThirdPerson = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    engineRef.current?.setCameraViewMode('third_person');
  };

  const handleSelectAerialPreset = (presetId: AerialPresetId, e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    engineRef.current?.selectAerialPreset(presetId);
  };

  const handleAdjustAerialAltitude = (deltaMeters: number, e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    if (!hud.devMode) return;
    engineRef.current?.setAerialAltitude(hud.devMode.altitude + deltaMeters);
  };

  const handleSetAerialAltitudeExact = (alt: number) => {
    engineRef.current?.setAerialAltitude(alt);
  };

  const handleRotateAerialHeading = (deg: number, e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    engineRef.current?.rotateAerialCamera((deg * Math.PI) / 180);
  };

  const handleTeleportToAerialFocus = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    engineRef.current?.teleportPlayerToAerialTarget();
  };

  const handleToggleClearSkies = (e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.currentTarget.blur();
    engineRef.current?.toggleDevClearSkies();
  };

  const handleTriggerJump = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    engineRef.current?.triggerJump();
  };

  // Virtual Joystick Pointer Handlers (zero-reflow & zero-re-render during pointermove)
  const applyKnobTransform = (xPx: number, yPx: number, animateReturn: boolean) => {
    const knob = joystickKnobRef.current;
    if (!knob) return;
    knob.style.transition = animateReturn ? 'transform 140ms ease-out' : 'none';
    knob.style.transform = `translate3d(${xPx.toFixed(1)}px, ${yPx.toFixed(1)}px, 0)`;
  };

  const updateJoystickFromPointer = (clientX: number, clientY: number) => {
    const rect =
      joystickRectRef.current ?? joystickBaseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width * 0.36;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const norm = normalizeJoystickInput(dx, dy, maxRadius);

    applyKnobTransform(norm.x * maxRadius, norm.y * maxRadius, false);
    engineRef.current?.setJoystickVector(norm.x, norm.y);
  };

  useEffect(() => {
    if (!joystickActive) return;

    const onWindowPointerMove = (e: PointerEvent) => {
      updateJoystickFromPointer(e.clientX, e.clientY);
    };
    const onWindowPointerUp = () => {
      joystickRectRef.current = null;
      setJoystickActive(false);
      applyKnobTransform(0, 0, true);
      engineRef.current?.setJoystickVector(0, 0);
    };

    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [joystickActive]);

  const handleJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (document.pointerLockElement && document.exitPointerLock) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore pointer lock exit errors
      }
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore InvalidStateError if pointer capture is unavailable; window listeners handle drag
    }
    joystickRectRef.current = e.currentTarget.getBoundingClientRect();
    setJoystickActive(true);
    updateJoystickFromPointer(e.clientX, e.clientY);
  };

  const handleJoystickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickActive) return;
    e.stopPropagation();
    updateJoystickFromPointer(e.clientX, e.clientY);
  };

  const handleJoystickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickActive) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore releasePointerCapture errors
    }
    joystickRectRef.current = null;
    setJoystickActive(false);
    applyKnobTransform(0, 0, true);
    engineRef.current?.setJoystickVector(0, 0);
  };

  const playerRadialDist = Math.hypot(hud.playerX, hud.playerZ);
  const biomeLabel =
    hud.biome === 'beach'
      ? playerRadialDist > 120
        ? 'Outer Island Coastline'
        : 'Castaway Shoreline'
      : hud.biome === 'jungle'
      ? playerRadialDist > 85
        ? 'Expanded Island Grasslands'
        : 'Emerald Canopy Jungle'
      : hud.biome === 'volcano'
      ? 'Basalt Volcano Slopes'
      : hud.biome === 'caldera'
      ? 'Molten Caldera Rim'
      : 'Coral Shallows';

  return (
    <main className="relative w-screen h-screen overflow-hidden select-none bg-[#091318]">
      {/* Isolated WebGL Canvas Mount Container (Supports 360° Finger Touch Drag & Pinch Zoom) */}
      <div
        ref={canvasMountRef}
        data-testid="island-canvas-container"
        className="fixed inset-0 w-full h-full touch-none select-none cursor-grab active:cursor-grabbing"
      />

      {/* Peripheral Critical HP / Lava Burn Vignette */}
      {hud.state === 'playing' && (hud.inLava || hpPct < 35) && (
        <div
          aria-hidden="true"
          className="fixed inset-0 pointer-events-none transition-opacity duration-200"
          style={{
            boxShadow: hud.inLava
              ? 'inset 0 0 110px 36px rgba(239, 68, 68, 0.68)'
              : 'inset 0 0 85px 24px rgba(220, 38, 38, 0.42)',
          }}
        />
      )}

      {/* =====================================================================
          STATE 1: DIEGETIC TITLE SCREEN OVERLAY
         ===================================================================== */}
      {hud.state === 'title' && (
        <section
          aria-label="Title Screen"
          className="fixed inset-0 z-20 flex flex-col justify-between p-8 md:p-14 pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, rgba(6, 15, 20, 0.84) 0%, rgba(6, 15, 20, 0.48) 46%, rgba(6, 15, 20, 0.05) 100%)',
          }}
        >
          {/* Left-Third Negative Space Compositional Title Lockup */}
          <div className="my-auto max-w-lg pointer-events-auto">
            {/* Custom Inline SVG Volcanic Island Crest Emblem & Title Lockup */}
            <div className="mb-5 flex items-center gap-3.5">
              <svg
                width="54"
                height="54"
                viewBox="0 0 64 64"
                fill="none"
                aria-hidden="true"
                className="shrink-0"
              >
                <circle
                  cx="32"
                  cy="32"
                  r="30"
                  fill="#102129"
                  stroke="#D97706"
                  strokeWidth="2.5"
                />
                {/* Volcano silhouette */}
                <path
                  d="M10 48L24 22L32 25L40 22L54 48H10Z"
                  fill="#292524"
                  stroke="#F59E0B"
                  strokeWidth="1.5"
                />
                {/* Molten lava flows */}
                <path
                  d="M27 23L32 25L37 23L35 34L31 39L29 32L27 23Z"
                  fill="#FF4500"
                />
                {/* Smoke puffs */}
                <circle cx="32" cy="14" r="4" fill="#FBBF24" fillOpacity="0.85" />
                <circle cx="38" cy="11" r="3" fill="#FDE68A" fillOpacity="0.65" />
                {/* Ocean wave base */}
                <path
                  d="M12 50C18 47 26 53 32 50C38 47 46 53 52 50"
                  stroke="#38BDF8"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
              <div>
                <p className="text-xs font-semibold tracking-widest uppercase text-amber-400">
                  WARRIOR FOR WORLD · PART 2: DENSE JUNGLE
                </p>
                <h1
                  className="font-display text-4xl md:text-5xl font-extrabold tracking-tight text-amber-50 hud-text-stroke"
                  style={{ textWrap: 'balance' }}
                >
                  CALDERA CASTAWAY
                </h1>
              </div>
            </div>

            <p className="text-base text-stone-200/90 leading-relaxed mb-7 max-w-md">
              Shipwrecked in tattered clothes on an active volcanic island. Explore
              the sandy shores, dense emerald jungle, and glowing caldera slopes—forage
              coconuts, driftwood, and wild fruit to ignite three rescue signal beacons.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                data-start="true"
                onClick={handleStart}
                className="px-7 py-3.5 rounded-lg font-display font-bold text-base tracking-wide text-stone-950 bg-amber-400 hover:bg-amber-300 active:translate-y-0.5 transition-all cursor-pointer shadow-lg whitespace-nowrap shrink-0"
              >
                Awaken on the Shore
              </button>
            </div>
          </div>

          {/* Flat, borderless inline control hint in bottom safe margin */}
          <div className="pointer-events-auto">
            <p className="text-xs md:text-sm text-stone-300/90 tracking-wide hud-text-stroke">
              Left Thumbstick / WASD Move · Right Action Buttons (Walk / Run / Bend / Jump) · E Collect / Light Fire · P Pause
            </p>
          </div>
        </section>
      )}

      {/* =====================================================================
          STATE 2: PLAYING HUD
          - Top-Left: Castaway Vitals
          - Top-Right: Island Clock, Beacons & Utility Icons
          - Bottom-Left: Virtual Analog Joystick
          - Bottom-Center: Compact Collapsible Inventory Dock
          - Extreme Bottom-Right: Individual Unboxed Walk, Run, Bend, and Jump Buttons
         ===================================================================== */}
      {hud.state === 'playing' && (
        <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-4 md:p-6">
          {/* =================================================================
              AERIAL BIRD'S-EYE VANTAGE DECK & DEVELOPER CONTROLLER
              - Floating Top-Center Bar
              - Prominent "Return to 3rd Person View [V]" Button
              - Quick Vantage Presets across Sanctuary, 20km Island, Lakes, Hills, Beach, Volcano
              - Real-time Altitude Slider & Zoom Controls
              - Pan, Orbit, Clear Skies & Drop Castaway Here
             ================================================================= */}
          {hud.devMode?.viewMode !== 'third_person' && (
            <div
              data-testid="aerial-vantage-deck"
              role="region"
              aria-label="Aerial Bird's-Eye Camera Controls"
              className="fixed top-2 sm:top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-[96vw] sm:max-w-2xl md:max-w-3xl w-full rounded-2xl p-2.5 sm:p-3 border-2 border-sky-400/80 shadow-2xl backdrop-blur-md text-stone-100 flex flex-col gap-2"
              style={{ backgroundColor: 'rgba(8, 22, 32, 0.95)' }}
            >
              {/* Row 1: Header with Live Mode, Altitude Readout, and Return to 3rd-Person Button */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-800/60 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
                  <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-sky-200">
                    Aerial View (Bird's-Eye)
                  </span>
                  <span
                    data-testid="aerial-altitude-badge"
                    className="px-2 py-0.5 rounded bg-sky-950/90 border border-sky-400/60 font-mono-num text-[11px] font-bold text-sky-300"
                  >
                    Alt: {hud.devMode?.altitudeLabel}
                  </span>
                  <span className="hidden sm:inline font-mono-num text-[11px] text-stone-300">
                    Pos: {hud.devMode?.targetCoords}
                  </span>
                </div>

                {/* Return to 3rd-Person View Button */}
                <button
                  type="button"
                  data-testid="return-to-third-person-button"
                  onClick={handleReturnToThirdPerson}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-stone-950 font-display font-extrabold text-xs sm:text-sm shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <span>↩ Return to 3rd Person [V]</span>
                </button>
              </div>

              {/* Row 2: Aerial Presets Across Sanctuary and Macro 20km Island */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 shrink-0 mr-1">
                  Presets:
                </span>
                {AERIAL_PRESETS.map((preset) => {
                  const active = hud.devMode?.activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`aerial-preset-${preset.id}`}
                      onClick={(e) => handleSelectAerialPreset(preset.id, e)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer shrink-0 border ${
                        active
                          ? 'bg-sky-400 text-stone-950 border-sky-200 shadow font-bold'
                          : 'bg-stone-900/80 text-stone-200 border-stone-700/80 hover:bg-sky-950 hover:border-sky-400/60'
                      }`}
                      title={preset.description}
                    >
                      {preset.shortLabel}
                    </button>
                  );
                })}
              </div>

              {/* Row 3: Altitude Slider, Zoom Buttons & Developer Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
                {/* Altitude Slider & Zoom Buttons */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-stone-300 shrink-0">
                    Altitude:
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleAdjustAerialAltitude(-50, e)}
                    className="w-6 h-6 rounded bg-stone-800 hover:bg-stone-700 border border-stone-600 flex items-center justify-center font-bold text-stone-200 cursor-pointer"
                    title="Zoom In (Decrease Altitude)"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min={30}
                    max={2200}
                    step={10}
                    value={hud.devMode?.altitude ?? 150}
                    onChange={(e) => handleSetAerialAltitudeExact(Number(e.target.value))}
                    className="w-24 sm:w-36 accent-sky-400 cursor-pointer"
                    aria-label="Aerial Camera Altitude"
                  />
                  <button
                    type="button"
                    onClick={(e) => handleAdjustAerialAltitude(50, e)}
                    className="w-6 h-6 rounded bg-stone-800 hover:bg-stone-700 border border-stone-600 flex items-center justify-center font-bold text-stone-200 cursor-pointer"
                    title="Zoom Out (Increase Altitude)"
                  >
                    +
                  </button>
                </div>

                {/* Orbit Buttons & Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => handleRotateAerialHeading(45, e)}
                    className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 border border-stone-600 text-[11px] text-stone-200 cursor-pointer"
                    title="Orbit 45° Left [Q]"
                  >
                    ↺ 45°
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRotateAerialHeading(-45, e)}
                    className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 border border-stone-600 text-[11px] text-stone-200 cursor-pointer"
                    title="Orbit 45° Right [E]"
                  >
                    ↻ 45°
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleClearSkies}
                    className={`px-2 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                      hud.devMode?.clearSkies
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                        : 'bg-stone-800 border-stone-600 text-stone-300'
                    }`}
                    title="Toggle clear skies fog reduction"
                  >
                    {hud.devMode?.clearSkies ? 'Clear Skies' : 'Natural Fog'}
                  </button>

                  <button
                    type="button"
                    data-testid="teleport-to-aerial-target-button"
                    onClick={handleTeleportToAerialFocus}
                    className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/60 text-amber-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                    title="Drop player at current aerial target and return to 3rd person"
                  >
                    📍 Drop Player Here
                  </button>
                </div>
              </div>

              {/* Flight Keyboard Navigation Hints */}
              <div className="hidden sm:flex items-center justify-between text-[10px] text-stone-400 border-t border-sky-900/60 pt-1">
                <span>
                  Controls: <strong className="text-stone-200">WASD / Drag</strong> Pan camera ·{' '}
                  <strong className="text-stone-200">Mousewheel / R / F</strong> Altitude ·{' '}
                  <strong className="text-stone-200">Q / E</strong> Rotate ·{' '}
                  <strong className="text-stone-200">Shift</strong> Fast flight
                </span>
                <span className="text-amber-300 font-semibold">
                  Press [V] anytime to return to 3rd-Person
                </span>
              </div>
            </div>
          )}

          {/* TOP ROW: Top-Left Castaway Vitals & Top-Right Island Clock + Circular Minimap */}
          <div className="flex flex-nowrap items-start justify-between gap-1.5 sm:gap-4 w-full">
            {/* Top-Left Cluster: World-Matched Castaway Vitality, Stamina & Nourishment */}
            <div
              className="pointer-events-auto rounded-lg px-2.5 py-1.5 sm:px-4 sm:py-3 border border-amber-900/50 shadow-xl shrink min-w-0"
              style={{ backgroundColor: 'rgba(18, 25, 23, 0.86)' }}
            >
              <div className="flex items-baseline justify-between gap-2 sm:gap-6 mb-1">
                <span className="text-[9px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-300/90 whitespace-nowrap">
                  HP · VITALITY
                </span>
                <span
                  data-testid="hud-hp-value"
                  className="font-mono-num text-lg sm:text-2xl font-bold text-amber-50 hud-text-stroke leading-none"
                >
                  {hpPct}
                </span>
              </div>

              {/* Health Bar with Delayed Ghost Damage Bar */}
              <div className="relative w-28 sm:w-48 md:w-56 h-2 sm:h-3 rounded bg-stone-900/95 overflow-hidden border border-stone-700/70 mb-1.5 sm:mb-2">
                <div
                  className="absolute inset-y-0 left-0 bg-amber-300/60 transition-all duration-300"
                  style={{ width: `${Math.max(hpPct, Math.round(ghostHp))}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 transition-all duration-100"
                  style={{
                    width: `${hpPct}%`,
                    backgroundColor:
                      hpPct > 50 ? '#10b981' : hpPct > 25 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>

              {/* Stamina, Eat (Hunger) & Drink (Thirst) Compact Bars */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <div>
                  <div className="flex justify-between text-[8px] sm:text-[10px] font-semibold uppercase tracking-wider text-sky-300/90 mb-0.5">
                    <span>STM</span>
                    <span className="font-mono-num">{staminaPct}</span>
                  </div>
                  <div className="w-full h-1 sm:h-1.5 rounded bg-stone-900 overflow-hidden">
                    <div
                      className="h-full bg-sky-400 transition-all duration-100"
                      style={{ width: `${staminaPct}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[8px] sm:text-[10px] font-semibold uppercase tracking-wider text-amber-300/90 mb-0.5">
                    <span>EAT</span>
                    <span className="font-mono-num">{hungerPct}</span>
                  </div>
                  <div className="w-full h-1 sm:h-1.5 rounded bg-stone-900 overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all duration-100"
                      style={{ width: `${hungerPct}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[8px] sm:text-[10px] font-semibold uppercase tracking-wider text-cyan-300/90 mb-0.5">
                    <span>DRK</span>
                    <span className="font-mono-num">{thirstPct}</span>
                  </div>
                  <div className="w-full h-1 sm:h-1.5 rounded bg-stone-900 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-100"
                      style={{ width: `${thirstPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Sea Supply Box Gear (Knife, Rope, Map) & Escape Boat Progress Strip */}
              <div className="flex flex-wrap items-center gap-1 mt-1.5 pt-1.5 border-t border-stone-700/60">
                <span
                  data-testid="gear-knife"
                  className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold uppercase tracking-wider border ${
                    hud.inventory.hasKnife
                      ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                      : 'bg-stone-900/80 border-stone-700/60 text-stone-500'
                  }`}
                >
                  {hud.inventory.hasKnife ? 'Knife ✓' : 'No Knife'}
                </span>
                <span
                  data-testid="gear-rope"
                  className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold uppercase tracking-wider border font-mono-num ${
                    (hud.inventory.rope ?? 0) > 0 || hud.inventory.hasRope
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                      : 'bg-stone-900/80 border-stone-700/60 text-stone-500'
                  }`}
                >
                  Rope:{hud.inventory.rope ?? 0}
                </span>
                <span
                  data-testid="gear-map"
                  className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold uppercase tracking-wider border ${
                    hud.inventory.hasMap
                      ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                      : 'bg-stone-900/80 border-stone-700/60 text-stone-500'
                  }`}
                >
                  {hud.inventory.hasMap ? 'Map ✓' : 'No Map'}
                </span>
                <span
                  data-testid="boat-stage-badge"
                  className="ml-auto px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 border border-amber-400/60 text-amber-300 font-mono-num"
                >
                  Boat {hud.boatStage}/3
                </span>
              </div>

              {/* Backpack Trigger Button with Live Storage Capacity Meter */}
              <button
                type="button"
                data-testid="backpack-button"
                aria-label="Open Backpack Inventory"
                aria-expanded={backpackOpen}
                onClick={handleToggleBackpack}
                className={`mt-1.5 w-full px-2 py-1 rounded-md border flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  backpackOpen
                    ? 'bg-amber-400 text-stone-950 border-amber-200 font-bold'
                    : backpackState.isFull
                    ? 'bg-rose-950/85 text-rose-100 border-rose-400/80 hover:bg-rose-900/80'
                    : 'bg-stone-900/90 text-amber-200 border-amber-500/50 hover:border-amber-300 hover:bg-stone-800/90'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[9px] sm:text-[11px] font-bold uppercase tracking-wider">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 6V4C9 2.9 9.9 2 11 2H13C14.1 2 15 2.9 15 4V6M5 10C5 7.79 6.79 6 9 6H15C17.21 6 19 7.79 19 10V19C19 20.1 18.1 21 17 21H7C5.9 21 5 20.1 5 19V10Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 13H16M12 11V15"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Backpack [B]</span>
                </span>
                <span
                  data-testid="backpack-capacity-badge"
                  className="font-mono-num text-[9px] sm:text-[11px] font-extrabold"
                >
                  {backpackState.usedSlots}/{backpackState.maxSlots} Slots
                </span>
              </button>
            </div>

            {/* Top-Right Cluster: Biome, Day/Night Sundial Readout, Signal Fires, Icon Controls & Circular Minimap */}
            <div className="flex flex-col sm:flex-row items-end sm:items-start gap-1.5 sm:gap-3 pointer-events-auto shrink-0">
              {/* Island Info Badge & Utility Action Buttons */}
              <div className="flex flex-col items-end gap-1 sm:gap-1.5 order-2 sm:order-1">
                <div
                  className="rounded-lg px-2 py-1 sm:px-3 sm:py-2 border border-amber-900/50 shadow-xl text-right"
                  style={{ backgroundColor: 'rgba(18, 25, 23, 0.86)' }}
                >
                  <div className="flex items-center justify-end gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-semibold text-amber-300 whitespace-nowrap">
                    <span>{biomeLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>D{hud.daysSurvived}</span>
                    <span aria-hidden="true" className="hidden md:inline">
                      ·
                    </span>
                    <span className="hidden md:inline text-stone-300 font-mono-num">
                      {hud.istDateLabel}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-end gap-1 sm:gap-1.5 mt-0.5 whitespace-nowrap">
                    <span className="text-[9px] sm:text-[11px] uppercase tracking-wider text-stone-300">
                      {hud.dayPhase}
                    </span>
                    <span
                      data-testid="hud-clock"
                      className="font-mono-num text-sm sm:text-xl font-bold text-white hud-text-stroke"
                    >
                      {hud.isRealTimeIST ? hud.istClockWithSeconds : hud.clockLabel}
                    </span>
                    <span
                      data-testid="hud-timezone"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-amber-300 font-mono-num"
                      title="Indian Standard Time (UTC+05:30)"
                    >
                      {hud.isRealTimeIST && (
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
                        />
                      )}
                      IST
                    </span>
                    <span aria-hidden="true" className="text-stone-500 hidden sm:inline">
                      ·
                    </span>
                    <span className="text-[10px] sm:text-xs font-semibold text-orange-300 font-mono-num hidden sm:inline">
                      Beacons {hud.campfiresLit}/{hud.totalCampfires}
                    </span>
                  </div>
                </div>

                {/* Utility Square SVG Icon Buttons: 360° POV [V], Mute [M], Pause [P], Restart [R] */}
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="pov-360-button"
                    aria-label="360 Degree POV Camera Orbit (Drag Screen with Fingers or Tap to Flip 180°)"
                    title="Swipe anywhere with fingers to rotate 360° POV, or tap to flip 180° [V]"
                    onClick={handleFlipPov180}
                    className="h-7 sm:h-10 px-2 sm:px-2.5 rounded-lg border border-amber-500/60 flex items-center gap-1 text-amber-200 hover:text-white hover:border-amber-300 transition-colors cursor-pointer shrink-0"
                    style={{ backgroundColor: 'rgba(18, 25, 23, 0.88)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <ellipse
                        cx="12"
                        cy="12"
                        rx="9"
                        ry="4.5"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M15 8L18 11L15 14"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      data-testid="pov-360-angle"
                      className="font-mono-num text-[9px] sm:text-[11px] font-bold"
                    >
                      360° · {hud.camCompassDeg ?? 0}°
                    </span>
                  </button>

                  {/* Aerial View / Developer Mode Toggle Button */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={
                      hud.devMode?.viewMode !== 'third_person'
                        ? 'Return to 3rd-Person Camera [V]'
                        : 'Switch to Aerial View [V]'
                    }
                    data-testid="toggle-aerial-view-button"
                    onClick={handleToggleAerialView}
                    className={`h-7 sm:h-10 px-2 sm:px-2.5 rounded-lg border flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                      hud.devMode?.viewMode !== 'third_person'
                        ? 'bg-sky-500 text-stone-950 border-sky-300 font-bold shadow-lg'
                        : hud.devMode?.enabled
                        ? 'bg-amber-400 text-stone-950 border-amber-300 font-bold'
                        : 'border-amber-900/50 text-stone-200 hover:text-amber-300 hover:border-amber-400/60'
                    }`}
                    style={
                      hud.devMode?.viewMode !== 'third_person' || hud.devMode?.enabled
                        ? undefined
                        : { backgroundColor: 'rgba(18, 25, 23, 0.88)' }
                    }
                    title="Toggle Aerial Overview [V]"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 2L2 7L12 12L22 7L12 2Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M2 17L12 22L22 17"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M2 12L12 17L22 12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-[9px] sm:text-[11px] font-bold uppercase tracking-tight">
                      {hud.devMode?.viewMode !== 'third_person' ? 'Aerial' : 'Aerial [V]'}
                    </span>
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                    onClick={handleToggleMute}
                    className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg border border-amber-900/50 flex items-center justify-center text-stone-200 hover:text-amber-300 hover:border-amber-400/60 transition-colors cursor-pointer shrink-0"
                    style={{ backgroundColor: 'rgba(18, 25, 23, 0.88)' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M11 5L6 9H2V15H6L11 19V5Z"
                        fill="#D6D3D1"
                        stroke="#1C1917"
                        strokeWidth="1.5"
                      />
                      {isMuted ? (
                        <path
                          d="M22 9L16 15M16 9L22 15"
                          stroke="#F87171"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      ) : (
                        <path
                          d="M15.5 8.5C16.8 9.8 16.8 14.2 15.5 15.5M19 6C21.5 8.8 21.5 15.2 19 18"
                          stroke="#FBBF24"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      )}
                    </svg>
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Pause Game"
                    onClick={handleTogglePause}
                    className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg border border-amber-900/50 flex items-center justify-center text-stone-200 hover:text-amber-300 hover:border-amber-400/60 transition-colors cursor-pointer shrink-0"
                    style={{ backgroundColor: 'rgba(18, 25, 23, 0.88)' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <rect
                        x="6"
                        y="5"
                        width="4"
                        height="14"
                        rx="1"
                        fill="#FDE68A"
                        stroke="#1C1917"
                        strokeWidth="1.5"
                      />
                      <rect
                        x="14"
                        y="5"
                        width="4"
                        height="14"
                        rx="1"
                        fill="#FDE68A"
                        stroke="#1C1917"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Restart Survival Run"
                    onClick={handleRestart}
                    className="w-7 h-7 sm:w-10 sm:h-10 rounded-lg border border-amber-900/50 flex items-center justify-center text-stone-200 hover:text-amber-300 hover:border-amber-400/60 transition-colors cursor-pointer shrink-0"
                    style={{ backgroundColor: 'rgba(18, 25, 23, 0.88)' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 12C3 7.03 7.03 3 12 3C15.3 3 18.2 4.8 19.7 7.5M21 4V8H17"
                        stroke="#FDE68A"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M21 12C21 16.97 16.97 21 12 21C8.7 21 5.8 19.2 4.3 16.5"
                        stroke="#D6D3D1"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Topographic Geographical Map in Extreme Top-Right Corner */}
              <div className="order-1 sm:order-2">
                <GeographicalMap
                  playerX={hud.playerX}
                  playerZ={hud.playerZ}
                  playerYaw={hud.playerYaw}
                  camYaw={hud.camYaw}
                  volcanoX={hud.volcanoX}
                  volcanoZ={hud.volcanoZ}
                  campfires={hud.campfires}
                  supplyBoxOpened={hud.supplyBoxOpened}
                  supplyBoxX={hud.supplyBoxPos.x}
                  supplyBoxZ={hud.supplyBoxPos.z}
                  boatX={hud.boatPos.x}
                  boatZ={hud.boatPos.z}
                  boatStage={hud.boatStage}
                  hasMap={!!hud.inventory.hasMap}
                  onOpenAtlas={() => setGeoAtlasOpen(true)}
                />
              </div>
            </div>
          </div>

          {/* =================================================================
              LEFT DOWN SIDE: STANDALONE VIRTUAL ANALOG JOYSTICK
             ================================================================= */}
          <div className="fixed bottom-5 left-4 sm:bottom-7 sm:left-7 z-20 pointer-events-auto flex flex-col items-center">
            <div
              ref={joystickBaseRef}
              role="slider"
              aria-label="Character Movement Joystick"
              aria-valuemin={-100}
              aria-valuemax={100}
              aria-valuenow={Math.round(hud.joystickY * -100)}
              data-testid="character-joystick"
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerUp}
              onPointerCancel={handleJoystickPointerUp}
              className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 border-amber-500/75 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
              style={{
                background:
                  'radial-gradient(circle, rgba(35, 44, 41, 0.90) 0%, rgba(11, 18, 20, 0.95) 100%)',
              }}
            >
              {/* Inner guide ring */}
              <div
                aria-hidden="true"
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border border-amber-400/25 pointer-events-none"
              />
              {/* Directional Movement Ticks */}
              <span
                aria-hidden="true"
                className="absolute top-1.5 text-[8px] font-bold text-amber-400/80"
              >
                ▲
              </span>
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 text-[8px] font-bold text-stone-400"
              >
                ▼
              </span>
              <span
                aria-hidden="true"
                className="absolute left-2 text-[8px] font-bold text-stone-400"
              >
                ◀
              </span>
              <span
                aria-hidden="true"
                className="absolute right-2 text-[8px] font-bold text-stone-400"
              >
                ▶
              </span>

              {/* Movable Thumbstick Knob */}
              <div
                ref={joystickKnobRef}
                data-testid="joystick-knob"
                className="absolute w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 border-amber-200 shadow-lg pointer-events-none flex items-center justify-center"
                style={{
                  backgroundColor: joystickActive ? '#fbbf24' : '#d97706',
                  transform: 'translate3d(0px, 0px, 0)',
                  transition: 'transform 140ms ease-out',
                }}
              >
                <div className="w-3 h-3 rounded-full bg-stone-950/60" />
              </div>
            </div>
          </div>

          {/* =================================================================
              EXTREME RIGHT DOWN SIDE: INDIVIDUAL UNBOXED ACTION BUTTONS
              (Attack/Slash, Walk, Run, Bend, Jump — no container box around them)
             ================================================================= */}
          <button
            type="button"
            data-testid="attack-button"
            aria-label="Attack Creature"
            onClick={handleAttackClick}
            className="fixed bottom-44 right-5 sm:bottom-48 sm:right-7 z-20 pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-rose-400/85 text-rose-100 hover:border-rose-200 hover:bg-rose-500/30 shadow-2xl flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer"
            style={{ backgroundColor: 'rgba(48, 16, 20, 0.92)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M14.5 17.5L3 6V3H6L17.5 14.5M13 19L19 13M16 16L20 20M19 21L21 19"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[9px] font-extrabold uppercase tracking-tight leading-none mt-0.5">
              {hud.inventory.hasKnife ? 'Slash' : 'Strike'}
            </span>
          </button>

          <button
            type="button"
            aria-label="Walk"
            aria-pressed={hud.gait === 'walk' && !hud.isBending}
            onClick={handleSelectWalk}
            className={`fixed bottom-24 right-24 sm:bottom-28 sm:right-28 z-20 pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 shadow-2xl flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer ${
              hud.gait === 'walk' && !hud.isBending
                ? 'bg-amber-400 text-stone-950 border-amber-200'
                : 'text-stone-100 border-amber-500/60 hover:border-amber-300'
            }`}
            style={
              hud.gait === 'walk' && !hud.isBending
                ? undefined
                : { backgroundColor: 'rgba(18, 25, 23, 0.90)' }
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="4.5" r="2.2" fill="currentColor" />
              <path
                d="M10 9.5L12 9L14 11.5L16.5 13.5M12 9L10.5 14.5L8 20M12 14.5L14.5 20"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[10px] font-extrabold uppercase tracking-tight leading-none mt-0.5">
              Walk
            </span>
          </button>

          <button
            type="button"
            aria-label="Run"
            aria-pressed={hud.gait === 'run' && !hud.isBending}
            onClick={handleSelectRun}
            className={`fixed bottom-24 right-5 sm:bottom-28 sm:right-7 z-20 pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 shadow-2xl flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer ${
              hud.gait === 'run' && !hud.isBending
                ? 'bg-amber-400 text-stone-950 border-amber-200'
                : 'text-stone-100 border-amber-500/60 hover:border-amber-300'
            }`}
            style={
              hud.gait === 'run' && !hud.isBending
                ? undefined
                : { backgroundColor: 'rgba(18, 25, 23, 0.90)' }
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="14.5" cy="4.5" r="2.2" fill="currentColor" />
              <path
                d="M8 10L12.5 8.5L15.5 11.5L19 10.5M12.5 8.5L10.5 14L6 18.5M11.5 14L15.5 16L17 20.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[10px] font-extrabold uppercase tracking-tight leading-none mt-0.5">
              Run
            </span>
          </button>

          <button
            type="button"
            aria-label="Bend"
            aria-pressed={hud.isBending}
            onClick={handleToggleBend}
            className={`fixed bottom-5 right-24 sm:bottom-7 sm:right-28 z-20 pointer-events-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 shadow-2xl flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer ${
              hud.isBending
                ? 'bg-emerald-400 text-stone-950 border-emerald-200'
                : 'text-stone-100 border-emerald-500/60 hover:border-emerald-300'
            }`}
            style={
              hud.isBending
                ? undefined
                : { backgroundColor: 'rgba(18, 25, 23, 0.90)' }
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="14" cy="7" r="2.2" fill="currentColor" />
              <path
                d="M9 12.5C10.5 10.5 13 10.5 14.5 12.5L17 16M10 12.5L8.5 16.5L12 19.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[10px] font-extrabold uppercase tracking-tight leading-none mt-0.5">
              Bend
            </span>
          </button>

          <button
            type="button"
            aria-label="Jump"
            onClick={handleTriggerJump}
            className="fixed bottom-5 right-5 sm:bottom-7 sm:right-7 z-20 pointer-events-auto w-16 h-16 sm:w-[70px] sm:h-[70px] rounded-full border-2 border-sky-400/80 text-sky-100 hover:border-sky-200 hover:bg-sky-500/30 shadow-2xl flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer"
            style={{ backgroundColor: 'rgba(14, 34, 46, 0.92)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 19V5M12 5L6 11M12 5L18 11"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[10px] font-extrabold uppercase tracking-tight leading-none mt-0.5">
              Jump
            </span>
          </button>

          {/* BOTTOM-CENTER GAZE ROUTING & COMPACT COLLAPSIBLE INVENTORY DOCK */}
          <div className="flex flex-col items-center pointer-events-none">
            {/* Contextual Interaction Prompt, Creature Target Bar & Toast */}
            <div className="flex flex-col items-center pointer-events-none mb-36 sm:mb-2 max-w-[230px] sm:max-w-none">
              {hud.inLava && (
                <div className="mb-1.5 px-3 py-1 rounded bg-red-950/90 border border-red-500 text-red-200 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-center">
                  Warning: Molten Lava Contact — Move to Cooler Ground!
                </div>
              )}

              {hud.nearbyCreature && (
                <div
                  data-testid="nearby-creature-bar"
                  className="mb-1.5 px-3 py-1 rounded-lg bg-rose-950/90 border border-rose-500/80 text-rose-100 text-[11px] sm:text-xs font-bold flex items-center gap-2 shadow-lg whitespace-nowrap"
                >
                  <span>{hud.nearbyCreature.label}</span>
                  <div className="w-16 sm:w-20 h-2 rounded bg-stone-900 overflow-hidden border border-rose-700">
                    <div
                      className="h-full bg-rose-500 transition-all duration-100"
                      style={{
                        width: `${Math.round(
                          (hud.nearbyCreature.hp / hud.nearbyCreature.maxHp) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="font-mono-num text-[10px] sm:text-[11px] text-rose-200">
                    {hud.nearbyCreature.hp} HP
                  </span>
                </div>
              )}

              {hud.isSwimming && !hud.inLava && (
                <div className="mb-1.5 px-3 py-1 rounded bg-sky-950/85 border border-sky-400/50 text-sky-200 text-[11px] sm:text-xs font-semibold text-center">
                  Swimming in Tropical Shallows · Space to Stroke Upward
                </div>
              )}

              {hud.nearbyPrompt && (
                <button
                  type="button"
                  data-testid="interact-prompt-button"
                  onClick={handleInteractClick}
                  className="pointer-events-auto mb-1.5 px-3.5 py-1.5 rounded-lg border border-amber-400/80 text-amber-100 font-semibold text-xs sm:text-sm shadow-lg hover:bg-amber-500/20 transition-colors cursor-pointer text-center"
                  style={{ backgroundColor: 'rgba(18, 25, 23, 0.92)' }}
                >
                  {hud.nearbyPrompt}
                </button>
              )}

              {hud.statusToast ? (
                <div
                  role="status"
                  className="px-3 py-1 rounded text-[11px] sm:text-xs font-medium text-amber-100 border border-stone-700/80 shadow text-center max-w-[220px] sm:max-w-md"
                  style={{ backgroundColor: 'rgba(12, 18, 20, 0.88)' }}
                >
                  {hud.statusToast}
                </div>
              ) : (
                <div
                  data-testid="quest-objective-banner"
                  className="hidden sm:block px-3.5 py-1 rounded text-[11px] font-medium text-amber-200/95 border border-amber-800/50 shadow text-center max-w-md"
                  style={{ backgroundColor: 'rgba(12, 18, 20, 0.84)' }}
                >
                  {hud.questObjective}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                setDockCollapsed((prev) => !prev);
              }}
              className="pointer-events-auto hidden md:block mb-1 px-3 py-1 rounded-t-md border border-b-0 border-amber-900/50 text-[11px] font-semibold text-stone-300 hover:text-amber-200 transition-colors cursor-pointer whitespace-nowrap"
              style={{ backgroundColor: 'rgba(18, 25, 23, 0.86)' }}
            >
              {dockCollapsed ? '▴ Show Pack [H]' : '▾ Hide Pack [H]'}
            </button>

            {!dockCollapsed && (
              <div
                className="pointer-events-auto hidden md:flex flex-wrap items-center justify-center gap-2 px-3 py-2 rounded-xl border border-amber-900/60 shadow-2xl max-w-[64vw]"
                style={{ backgroundColor: 'rgba(18, 25, 23, 0.92)' }}
              >
                <button
                  type="button"
                  onClick={(e) => handleConsumeItem('coconut', e)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-700/80 hover:border-cyan-400/70 transition-colors cursor-pointer text-left"
                  style={{ backgroundColor: 'rgba(28, 36, 33, 0.9)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="13"
                      r="8"
                      fill="#5D4037"
                      stroke="#1C1917"
                      strokeWidth="2"
                    />
                    <ellipse cx="12" cy="10" rx="5" ry="3" fill="#38BDF8" />
                  </svg>
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[11px] font-bold text-cyan-100 whitespace-nowrap">
                        Drink Coconut
                      </span>
                      <span className="text-[10px] font-mono-num text-cyan-400">
                        [1]
                      </span>
                    </div>
                    <p className="text-[10px] text-stone-300 whitespace-nowrap">
                      Stock:{' '}
                      <strong
                        data-testid="inventory-coconuts"
                        className="font-mono-num text-white"
                      >
                        {hud.inventory.coconuts}
                      </strong>
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={(e) => handleConsumeItem('food', e)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-700/80 hover:border-amber-400/70 transition-colors cursor-pointer text-left"
                  style={{ backgroundColor: 'rgba(28, 36, 33, 0.9)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 5C16 5 19 8.5 18 14C17 18.5 14.5 20 12 20C9.5 20 7 18.5 6 14C5 8.5 8 5 12 5Z"
                      fill="#FF8F00"
                      stroke="#1C1917"
                      strokeWidth="1.8"
                    />
                  </svg>
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[11px] font-bold text-amber-100 whitespace-nowrap">
                        Eat Food
                      </span>
                      <span className="text-[10px] font-mono-num text-amber-400">
                        [2]
                      </span>
                    </div>
                    <p className="text-[10px] text-stone-300 whitespace-nowrap">
                      Stock:{' '}
                      <strong
                        data-testid="inventory-food"
                        className="font-mono-num text-white"
                      >
                        {hud.inventory.food}
                      </strong>
                    </p>
                  </div>
                </button>

                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-700/80 text-left"
                  style={{ backgroundColor: 'rgba(28, 36, 33, 0.9)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect
                      x="3"
                      y="12"
                      width="18"
                      height="5"
                      rx="2"
                      fill="#8D6E63"
                      stroke="#1C1917"
                      strokeWidth="1.8"
                    />
                    <rect
                      x="5"
                      y="7"
                      width="14"
                      height="5"
                      rx="2"
                      fill="#A1887F"
                      stroke="#1C1917"
                      strokeWidth="1.8"
                    />
                  </svg>
                  <div>
                    <span className="text-[11px] font-bold text-amber-100 whitespace-nowrap block">
                      Wood
                    </span>
                    <p className="text-[10px] text-stone-300 whitespace-nowrap">
                      <strong
                        data-testid="inventory-wood"
                        className="font-mono-num text-white"
                      >
                        {hud.inventory.wood}
                      </strong>
                      /3
                    </p>
                  </div>
                </div>

                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-700/80 text-left"
                  style={{ backgroundColor: 'rgba(28, 36, 33, 0.9)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="7"
                      stroke="#C5A880"
                      strokeWidth="3"
                    />
                  </svg>
                  <div>
                    <span className="text-[11px] font-bold text-amber-100 whitespace-nowrap block">
                      Rope
                    </span>
                    <p className="text-[10px] text-stone-300 whitespace-nowrap">
                      <strong
                        data-testid="inventory-rope"
                        className="font-mono-num text-white"
                      >
                        {hud.inventory.rope ?? 0}
                      </strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="dock-backpack-button"
                  onClick={handleToggleBackpack}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg font-semibold text-xs border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    backpackOpen
                      ? 'bg-amber-400 text-stone-950 border-amber-200'
                      : 'text-amber-200 border-amber-400/70 hover:bg-amber-500/20'
                  }`}
                  style={
                    backpackOpen
                      ? undefined
                      : { backgroundColor: 'rgba(28, 36, 33, 0.95)' }
                  }
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 6V4C9 2.9 9.9 2 11 2H13C14.1 2 15 2.9 15 4V6M5 10C5 7.79 6.79 6 9 6H15C17.21 6 19 7.79 19 10V19C19 20.1 18.1 21 17 21H7C5.9 21 5 20.1 5 19V10Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>
                    Backpack ({backpackState.usedSlots}/{backpackState.maxSlots}) [B]
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleInteractClick}
                  className="px-3 py-2 rounded-lg font-semibold text-xs text-stone-950 bg-amber-400 hover:bg-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Interact / Build Boat [E]
                </button>

                {/* Real-Time IST Sync & Day/Night Cycle Lighting Presets */}
                <div
                  className="hidden xl:flex items-center gap-1 p-1 rounded-lg border border-stone-700/80"
                  style={{ backgroundColor: 'rgba(12, 18, 20, 0.9)' }}
                >
                  <button
                    type="button"
                    onClick={(e) => handleSetTimePreset('IST', e)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 ${
                      hud.isRealTimeIST
                        ? 'bg-emerald-400 text-stone-950'
                        : 'text-emerald-300 hover:text-white'
                    }`}
                  >
                    <span>Live IST</span>
                  </button>
                  {(
                    [
                      { label: 'Dawn', val: 0.02 },
                      { label: 'Noon', val: 0.25 },
                      { label: 'Dusk', val: 0.48 },
                      { label: 'Night', val: 0.75 },
                    ] as const
                  ).map((preset) => {
                    const active = !hud.isRealTimeIST && hud.dayPhase === preset.label;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={(e) => handleSetTimePreset(preset.val, e)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-amber-400 text-stone-950'
                            : 'text-stone-300 hover:text-white'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          CASTAWAY BACKPACK & STORAGE CAPACITY MODAL ([B] / Backpack Button)
         ===================================================================== */}
      {hud.state === 'playing' && backpackOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Castaway Survival Backpack"
          data-testid="backpack-modal"
          className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-6 pointer-events-auto"
          style={{ backgroundColor: 'rgba(6, 13, 17, 0.78)' }}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl p-4 sm:p-6 border-2 border-amber-600/70 shadow-2xl text-stone-100"
            style={{ backgroundColor: 'rgba(18, 25, 23, 0.97)' }}
          >
            {/* Rucksack Top Flap Header & Capacity Meter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-amber-900/60">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/60 flex items-center justify-center text-amber-300 shrink-0">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 6V4C9 2.9 9.9 2 11 2H13C14.1 2 15 2.9 15 4V6M5 10C5 7.79 6.79 6 9 6H15C17.21 6 19 7.79 19 10V19C19 20.1 18.1 21 17 21H7C5.9 21 5 20.1 5 19V10Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 12H16M9 16H15"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                    Canvas Rucksack & Salvage Pouch
                  </p>
                  <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
                    Castaway Backpack
                  </h2>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3">
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-xs font-bold">
                    <span className="text-stone-300 uppercase tracking-wider text-[10px]">
                      Storage Capacity
                    </span>
                    <span
                      data-testid="backpack-modal-capacity"
                      className={`font-mono-num text-sm ${
                        backpackState.isFull
                          ? 'text-rose-400'
                          : backpackState.fillPercent >= 75
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                      }`}
                    >
                      {backpackState.usedSlots} / {backpackState.maxSlots} Slots
                    </span>
                  </div>
                  <div className="w-36 sm:w-44 h-2.5 rounded-full bg-stone-900 border border-stone-700 overflow-hidden mt-1">
                    <div
                      className={`h-full transition-all duration-150 ${
                        backpackState.isFull
                          ? 'bg-rose-500'
                          : backpackState.fillPercent >= 75
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${backpackState.fillPercent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-stone-400 mt-0.5 font-mono-num">
                    {backpackState.freeSlots} Free Slots Remaining ({backpackState.fillPercent}% Full)
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="close-backpack-button"
                  aria-label="Close Backpack"
                  onClick={handleToggleBackpack}
                  className="px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-600 text-xs font-bold text-stone-200 cursor-pointer shrink-0"
                >
                  Close [B]
                </button>
              </div>
            </div>

            {/* SECTION 1: EQUIPPED SURVIVAL TOOLS (FROM SEA SUPPLY BOX) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  1. Essential Survival Tools (Sea Supply Box Pouch)
                </h3>
                <span className="text-[11px] text-stone-400">
                  Zero Cargo Slot Weight
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {backpackState.tools.map((tool) => (
                  <div
                    key={tool.id}
                    data-testid={`backpack-tool-${tool.id}`}
                    className={`p-2.5 rounded-xl border flex flex-col justify-between ${
                      tool.unlocked
                        ? 'bg-emerald-950/35 border-emerald-500/60'
                        : 'bg-stone-900/70 border-stone-800 opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-white">
                        {tool.name}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider ${
                          tool.unlocked
                            ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/50'
                            : 'bg-stone-800 text-stone-400 border border-stone-700'
                        }`}
                      >
                        {tool.unlocked ? 'Equipped' : 'In Sea Box'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-300 leading-snug">
                      {tool.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* SECTION 2: COLLECTED ITEMS SUMMARY & QUICK ACTIONS */}
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">
                2. Collected Supplies & Actions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Coconuts (Drink) */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-cyan-200">
                        Fresh Coconuts (Drink)
                      </span>
                      <span
                        data-testid="backpack-count-coconut"
                        className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 font-mono-num text-xs font-bold text-cyan-200"
                      >
                        ×{hud.inventory.coconuts}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      Restores +42 Drink, +25 Eat & +18 HP
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={hud.inventory.coconuts <= 0}
                      onClick={(e) => handleConsumeItem('coconut', e)}
                      className="px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-stone-950 font-bold text-xs cursor-pointer"
                    >
                      Drink
                    </button>
                    <button
                      type="button"
                      disabled={hud.inventory.coconuts <= 0}
                      onClick={(e) => handleDropBackpackItem('coconut', e)}
                      className="px-2 py-1.5 rounded-lg bg-stone-800 hover:bg-rose-950/80 border border-stone-700 hover:border-rose-500/60 disabled:opacity-40 text-stone-300 text-xs cursor-pointer"
                    >
                      Drop
                    </button>
                  </div>
                </div>

                {/* Island Provisions (Eat) */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-amber-200">
                        Cooked Meat & Fruit (Eat)
                      </span>
                      <span
                        data-testid="backpack-count-food"
                        className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 font-mono-num text-xs font-bold text-amber-200"
                      >
                        ×{hud.inventory.food}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      Restores +40 Eat, +14 Drink & +30 HP
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={hud.inventory.food <= 0}
                      onClick={(e) => handleConsumeItem('food', e)}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-stone-950 font-bold text-xs cursor-pointer"
                    >
                      Eat
                    </button>
                    <button
                      type="button"
                      disabled={hud.inventory.food <= 0}
                      onClick={(e) => handleDropBackpackItem('food', e)}
                      className="px-2 py-1.5 rounded-lg bg-stone-800 hover:bg-rose-950/80 border border-stone-700 hover:border-rose-500/60 disabled:opacity-40 text-stone-300 text-xs cursor-pointer"
                    >
                      Drop
                    </button>
                  </div>
                </div>

                {/* Driftwood Bundles */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-orange-200">
                        Driftwood Bundles
                      </span>
                      <span
                        data-testid="backpack-count-wood"
                        className="px-1.5 py-0.5 rounded bg-orange-500/20 border border-orange-400/50 font-mono-num text-xs font-bold text-orange-200"
                      >
                        ×{hud.inventory.wood}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      Used to build Escape Boat Hull & light Campfires
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={hud.inventory.wood <= 0}
                    onClick={(e) => handleDropBackpackItem('wood', e)}
                    className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-rose-950/80 border border-stone-700 hover:border-rose-500/60 disabled:opacity-40 text-stone-300 text-xs cursor-pointer shrink-0"
                  >
                    Drop 1
                  </button>
                </div>

                {/* Hemp Rope Coils */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-yellow-200">
                        Hemp Rope Coils
                      </span>
                      <span
                        data-testid="backpack-count-rope"
                        className="px-1.5 py-0.5 rounded bg-yellow-500/20 border border-yellow-400/50 font-mono-num text-xs font-bold text-yellow-200"
                      >
                        ×{hud.inventory.rope ?? 0}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      Lashes Escape Boat Outriggers, Deck & Sail Mast
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={(hud.inventory.rope ?? 0) <= 0}
                    onClick={(e) => handleDropBackpackItem('rope', e)}
                    className="px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-rose-950/80 border border-stone-700 hover:border-rose-500/60 disabled:opacity-40 text-stone-300 text-xs cursor-pointer shrink-0"
                  >
                    Drop 1
                  </button>
                </div>
              </div>
            </div>

            {/* SECTION 3: 16-SLOT VISUAL RUCKSACK COMPARTMENT GRID */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  3. Rucksack Compartment Slots ({backpackState.usedSlots}/{backpackState.maxSlots} Occupied)
                </h3>
                <span className="text-[11px] text-stone-400">
                  1 Item per Compartment
                </span>
              </div>
              <div
                data-testid="backpack-slot-grid"
                className="grid grid-cols-4 sm:grid-cols-8 gap-2"
              >
                {backpackState.slots.slice(0, backpackState.maxSlots).map((slot) => {
                  const occupied = slot.kind !== 'empty';
                  return (
                    <div
                      key={slot.slotIndex}
                      data-testid={`backpack-slot-${slot.slotIndex}`}
                      className={`h-16 rounded-lg border p-1.5 flex flex-col items-center justify-between text-center ${
                        occupied
                          ? 'bg-stone-800/95 border-amber-500/60 shadow-inner'
                          : 'bg-stone-950/60 border-stone-800/80 text-stone-600'
                      }`}
                    >
                      <span className="w-full text-left font-mono-num text-[9px] text-stone-400 leading-none">
                        #{slot.slotIndex + 1}
                      </span>

                      {slot.kind === 'coconut' && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="13" r="8" fill="#5D4037" stroke="#1C1917" strokeWidth="2" />
                          <ellipse cx="12" cy="10" rx="5" ry="3" fill="#38BDF8" />
                        </svg>
                      )}
                      {slot.kind === 'food' && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M12 5C16 5 19 8.5 18 14C17 18.5 14.5 20 12 20C9.5 20 7 18.5 6 14C5 8.5 8 5 12 5Z"
                            fill="#FF8F00"
                            stroke="#1C1917"
                            strokeWidth="1.8"
                          />
                        </svg>
                      )}
                      {slot.kind === 'wood' && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="12" width="18" height="5" rx="2" fill="#8D6E63" stroke="#1C1917" strokeWidth="1.8" />
                          <rect x="5" y="7" width="14" height="5" rx="2" fill="#A1887F" stroke="#1C1917" strokeWidth="1.8" />
                        </svg>
                      )}
                      {slot.kind === 'rope' && (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="7" stroke="#C5A880" strokeWidth="3" />
                        </svg>
                      )}
                      {slot.kind === 'empty' && (
                        <span className="text-[10px] font-mono-num text-stone-600">—</span>
                      )}

                      <span
                        className={`text-[9px] font-bold truncate w-full leading-none ${
                          occupied ? 'text-amber-100' : 'text-stone-600'
                        }`}
                      >
                        {occupied ? slot.category : 'Empty'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* FOOTER: ESCAPE BOAT CONSTRUCTION CHECKLIST */}
            <div className="mt-4 pt-3 border-t border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                  Escape Boat Shipyard Progress (Stage {hud.boatStage}/3)
                </span>
                <span className="text-stone-200 font-semibold">
                  {nextBoatReq ? nextBoatReq.title : 'Outrigger Escape Boat Ready to Sail'}
                </span>
              </div>
              {nextBoatReq && hud.boatStage < 3 ? (
                <div className="flex flex-wrap items-center gap-2 font-mono-num text-[11px]">
                  <span
                    className={`px-2 py-1 rounded border ${
                      hud.inventory.wood >= nextBoatReq.woodNeeded
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                        : 'bg-stone-900 border-stone-700 text-stone-300'
                    }`}
                  >
                    Wood: {hud.inventory.wood}/{nextBoatReq.woodNeeded}
                  </span>
                  <span
                    className={`px-2 py-1 rounded border ${
                      (hud.inventory.rope ?? 0) >= nextBoatReq.ropeNeeded
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                        : 'bg-stone-900 border-stone-700 text-stone-300'
                    }`}
                  >
                    Rope: {hud.inventory.rope ?? 0}/{nextBoatReq.ropeNeeded}
                  </span>
                  {nextBoatReq.provisionsNeeded > 0 && (
                    <span
                      className={`px-2 py-1 rounded border ${
                        hud.inventory.food + hud.inventory.coconuts >= nextBoatReq.provisionsNeeded
                          ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                          : 'bg-stone-900 border-stone-700 text-stone-300'
                      }`}
                    >
                      Provisions: {hud.inventory.food + hud.inventory.coconuts}/{nextBoatReq.provisionsNeeded}
                    </span>
                  )}
                </div>
              ) : (
                <span className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-400 text-emerald-200 font-bold">
                  Boat Complete! Press [E] at the South-East Beach Shipyard to Sail!
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          GEOGRAPHICAL ISLAND ATLAS MODAL ([G] / Clicking Top-Right Geographical Map)
         ===================================================================== */}
      {hud.state === 'playing' && geoAtlasOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Island Geographical Atlas"
          data-testid="geographical-atlas-modal"
          className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-6 pointer-events-auto"
          style={{ backgroundColor: 'rgba(5, 12, 16, 0.82)' }}
        >
          <div
            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6 border-2 border-amber-600/80 shadow-2xl text-stone-100"
            style={{ backgroundColor: 'rgba(14, 22, 21, 0.97)' }}
          >
            {/* Header & Scale Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-amber-900/60">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                  Hydrographic & Hypsometric Relief Survey · {playerGeoPoint.latLabel}, {playerGeoPoint.lonLabel}
                </p>
                <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
                  Caldera Island Geographical Map
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg p-0.5 bg-stone-900 border border-stone-700">
                  <button
                    type="button"
                    data-testid="atlas-mode-sanctuary"
                    onClick={() => setAtlasScaleMode('sanctuary')}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      atlasScaleMode === 'sanctuary'
                        ? 'bg-amber-400 text-stone-950'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    Sanctuary Relief (160m)
                  </button>
                  <button
                    type="button"
                    data-testid="atlas-mode-macro20km"
                    onClick={() => setAtlasScaleMode('macro20km')}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      atlasScaleMode === 'macro20km'
                        ? 'bg-amber-400 text-stone-950'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    20 km Island Geography
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="close-geographical-atlas-button"
                  aria-label="Close Geographical Atlas"
                  onClick={() => setGeoAtlasOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-600 text-xs font-bold text-stone-200 cursor-pointer"
                >
                  Close [G]
                </button>
              </div>
            </div>

            {/* Main Geographical Chart & Hypsometric Sidebar */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-4">
              {/* Left 7 Columns: Large Rectangular Cartographic Map */}
              <div className="md:col-span-7 flex flex-col">
                <div
                  className="relative w-full aspect-square max-h-[380px] rounded-xl border-2 border-amber-500/70 overflow-hidden shadow-inner"
                  style={{
                    background: 'linear-gradient(180deg, #072235 0%, #051622 100%)',
                  }}
                >
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {/* Graticule Parallels & Meridians */}
                    {[20, 40, 60, 80].map((pos) => (
                      <React.Fragment key={pos}>
                        <line
                          x1={pos}
                          y1="0"
                          x2={pos}
                          y2="100"
                          stroke="#38bdf8"
                          strokeWidth="0.25"
                          strokeOpacity="0.25"
                          strokeDasharray="1.5 1.5"
                        />
                        <line
                          x1="0"
                          y1={pos}
                          x2="100"
                          y2={pos}
                          stroke="#38bdf8"
                          strokeWidth="0.25"
                          strokeOpacity="0.25"
                          strokeDasharray="1.5 1.5"
                        />
                      </React.Fragment>
                    ))}

                    {/* Outer Bathymetric Reef Contour (-5m) in front of the Beach */}
                    <path
                      d={
                        atlasScaleMode === 'macro20km'
                          ? 'M3 48 C4 18 22 4 50 4 C78 4 96 18 97 48 C97 78 88 95 50 96 C12 95 3 78 3 48 Z'
                          : 'M0 0 L100 0 L100 95 Q75 97 50 94 Q25 97 0 95 Z'
                      }
                      fill="#0284c7"
                      fillOpacity="0.2"
                      stroke="#38bdf8"
                      strokeWidth="0.45"
                      strokeDasharray="2 1.5"
                    />

                    {/* Primary Coastline & Landmass */}
                    {atlasScaleMode === 'macro20km' ? (
                      <path
                        d={MACRO_COASTLINE_SVG_PATH}
                        fill="#15803d"
                        fillOpacity="0.88"
                        stroke="#fde68a"
                        strokeWidth="0.8"
                      />
                    ) : (
                      <>
                        {/* Continuous Back-Side Island Landmass */}
                        <path
                          d="M0 0 L100 0 L100 92 Q82 94 66 92 Q56 90 50 90 Q44 90 34 92 Q16 94 0 92 Z"
                          fill="#15803d"
                          fillOpacity="0.92"
                        />
                        {/* Stage 2 Extended Golden Southern Beach Sand Belt */}
                        <path
                          d="M0 76 Q25 80 50 79 Q75 80 100 76 L100 92 Q82 94 66 92 Q56 90 50 90 Q44 90 34 92 Q16 94 0 92 Z"
                          fill="#fde68a"
                          fillOpacity="0.92"
                          stroke="#f59e0b"
                          strokeWidth="0.6"
                        />
                      </>
                    )}

                    {/* +5m Lowland Forest / Grassland Contour */}
                    <path
                      d={
                        atlasScaleMode === 'macro20km'
                          ? 'M14 48 C15 22 28 12 50 12 C72 12 85 22 86 48 C86 74 76 87 50 88 C24 87 14 74 14 48 Z'
                          : 'M0 0 L100 0 L100 78 Q75 80 50 78 Q25 80 0 78 Z'
                      }
                      fill="#166534"
                      fillOpacity="0.88"
                      stroke="#86efac"
                      strokeWidth="0.4"
                      strokeDasharray="2.2 1"
                    />

                    {/* +12m Upland Canopy Contour */}
                    <path
                      d="M50 22C64 22 76 33 77 48C78 63 65 74 50 75C35 74 22 63 23 48C24 33 36 22 50 22Z"
                      fill="#14532d"
                      fillOpacity="0.92"
                      stroke="#bbf7d0"
                      strokeWidth="0.4"
                    />

                    {/* Stage 2 Hills & Mountain Ranges Across the Map */}
                    {atlasScaleMode === 'macro20km' ? (
                      <>
                        {/* Western Cordillera & Eastern Sierra Mountain Ranges + Northern Alpine Crest */}
                        <ellipse cx="28" cy="48" rx="9" ry="18" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="0.45" opacity="0.88" />
                        <ellipse cx="72" cy="46" rx="9" ry="18" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="0.45" opacity="0.88" />
                        <ellipse cx="50" cy="24" rx="18" ry="8" fill="#52525b" stroke="#f4f4f5" strokeWidth="0.5" opacity="0.9" />
                        {/* Macro Rivers & Great Lakes */}
                        <path
                          d="M52 20 Q36 38 33 62 Q40 76 46 88"
                          stroke="#38bdf8"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <path
                          d="M52 20 Q64 42 66 64 Q58 76 54 88"
                          stroke="#38bdf8"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <ellipse cx="52" cy="28" rx="6.5" ry="4.5" fill="#0284c7" stroke="#bae6fd" strokeWidth="0.45" />
                        <ellipse cx="33" cy="58" rx="5.0" ry="3.6" fill="#0ea5e9" stroke="#bae6fd" strokeWidth="0.45" />
                        <ellipse cx="66" cy="62" rx="4.8" ry="3.5" fill="#0ea5e9" stroke="#bae6fd" strokeWidth="0.45" />
                      </>
                    ) : (
                      <>
                        {/* Sanctuary Hills & Mountain Foothills */}
                        <ellipse cx="14" cy="48" rx="10" ry="7" fill="#15803d" stroke="#a3e635" strokeWidth="0.4" opacity="0.85" />
                        <ellipse cx="86" cy="49" rx="10" ry="7" fill="#15803d" stroke="#a3e635" strokeWidth="0.4" opacity="0.85" />
                        <ellipse cx="22" cy="14" rx="12" ry="8" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="0.45" opacity="0.88" />
                        <ellipse cx="78" cy="14" rx="12" ry="8" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="0.45" opacity="0.88" />
                        {/* Stage 2 Rivers & Lakes */}
                        <path
                          d="M20 11 Q13 38 16 70 Q15 82 14 91"
                          stroke="#38bdf8"
                          strokeWidth="1.35"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <path
                          d="M82 10 Q88 38 85 71 Q86 82 87 91"
                          stroke="#38bdf8"
                          strokeWidth="1.35"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <path
                          d="M8 6 Q20 11 50 10 Q82 10 92 6"
                          stroke="#38bdf8"
                          strokeWidth="1.15"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <ellipse cx="16.2" cy="70.0" rx="6.8" ry="5.2" fill="#0ea5e9" stroke="#bae6fd" strokeWidth="0.5" />
                        <ellipse cx="85.0" cy="71.2" rx="7.2" ry="5.5" fill="#0ea5e9" stroke="#bae6fd" strokeWidth="0.5" />
                        <ellipse cx="20.0" cy="11.2" rx="8.2" ry="6.2" fill="#0284c7" stroke="#bae6fd" strokeWidth="0.5" />
                        <ellipse cx="82.5" cy="10.0" rx="8.0" ry="6.0" fill="#0284c7" stroke="#bae6fd" strokeWidth="0.5" />
                      </>
                    )}

                    {/* +20m Basalt Volcanic Cone */}
                    <ellipse
                      cx="50"
                      cy="49"
                      rx="16.5"
                      ry="15.5"
                      fill="#27272a"
                      stroke="#fbbf24"
                      strokeWidth="0.5"
                      strokeDasharray="1.8 1"
                    />

                    {/* +26m Caldera Summit Crater */}
                    <circle cx="50" cy="49" r="7.8" fill="#7c2d12" stroke="#f97316" strokeWidth="0.6" />
                    <circle cx="50" cy="49" r="4.2" fill="#ef4444" />

                    {/* Lava Channels */}
                    <path d="M50 49 Q57 41 66 36" stroke="#ff4500" strokeWidth="1.1" strokeLinecap="round" fill="none" />
                    <path d="M50 49 Q42 41 34 35" stroke="#ff4500" strokeWidth="1.1" strokeLinecap="round" fill="none" />
                    <path d="M50 49 Q42 57 35 63" stroke="#ff4500" strokeWidth="1.1" strokeLinecap="round" fill="none" />
                    <path d="M50 49 Q58 57 65 64" stroke="#ff4500" strokeWidth="1.1" strokeLinecap="round" fill="none" />

                    {/* Freshwater River & Waterfall */}
                    <path
                      d="M42.2 69.5 Q41.5 74.2 42.8 78.8 Q41.6 84.4 39.8 90.5"
                      stroke="#38bdf8"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <circle cx="42.2" cy="69.5" r="1.6" fill="#e0f2fe" stroke="#0284c7" strokeWidth="0.45" />

                    {/* Overland Trails */}
                    <path
                      d="M52.3 88.5 Q51.5 82.0 50.0 76.5 Q49.2 71.0 48.8 66.8"
                      stroke="#f59e0b"
                      strokeWidth="0.8"
                      strokeDasharray="1.2 0.9"
                      fill="none"
                    />

                    {/* Geographic Labels on Map */}
                    <text x="50" y="42" textAnchor="middle" fill="#fde68a" fontSize="3.4" fontWeight="bold">
                      MT. CALDERA (+28m)
                    </text>
                    <text x="16" y="71" textAnchor="middle" fill="#e0f2fe" fontSize="2.7" fontWeight="bold">
                      WEST LAKE
                    </text>
                    <text x="85" y="72" textAnchor="middle" fill="#e0f2fe" fontSize="2.7" fontWeight="bold">
                      EAST LAKE
                    </text>
                    <text x="50" y="95" textAnchor="middle" fill="#fde68a" fontSize="3.1" fontWeight="bold">
                      EXTENDED BEACH (0m)
                    </text>
                  </svg>

                  {/* Live Castaway Marker on Atlas */}
                  <div
                    className="absolute z-20 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
                    style={{
                      left: `${playerGeoPoint.percentX}%`,
                      top: `${playerGeoPoint.percentY}%`,
                    }}
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_8px_#38bdf8]" />
                    <span className="mt-0.5 px-1 py-0.2 rounded bg-stone-950/90 text-[8px] font-bold text-sky-200 whitespace-nowrap border border-sky-500/50">
                      YOU ({playerGeoPoint.elevationMeters}m)
                    </span>
                  </div>
                </div>

                {/* Bottom Cartographic Scale & Projection Bar */}
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono-num text-stone-300 px-1">
                  <span>
                    Scale:{' '}
                    <strong className="text-amber-300">
                      {atlasScaleMode === 'macro20km' ? '1 : 200,000 (20 km Diameter)' : '1 : 1,600 (160 m Sanctuary)'}
                    </strong>
                  </span>
                  <span>Contour Interval: 5m Hypsometric</span>
                </div>
              </div>

              {/* Right 5 Columns: Live Telemetry, Elevation Legend & Landmarks */}
              <div className="md:col-span-5 flex flex-col justify-between gap-3">
                {/* Live Castaway Geographic Telemetry */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-2">
                    1. Live Survey Telemetry
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-stone-950/80 border border-stone-800">
                      <span className="text-[10px] text-stone-400 block">Coordinates</span>
                      <span className="font-mono-num font-bold text-amber-200">
                        {Math.round(hud.playerX)}m E, {Math.round(hud.playerZ)}m S
                      </span>
                    </div>
                    <div className="p-2 rounded bg-stone-950/80 border border-stone-800">
                      <span className="text-[10px] text-stone-400 block">Elevation ASL</span>
                      <span className="font-mono-num font-bold text-emerald-300">
                        {playerGeoPoint.elevationMeters >= 0
                          ? `+${playerGeoPoint.elevationMeters} m`
                          : `${playerGeoPoint.elevationMeters} m`}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-stone-950/80 border border-stone-800">
                      <span className="text-[10px] text-stone-400 block">Graticule</span>
                      <span className="font-mono-num font-bold text-sky-200 text-[11px]">
                        {playerGeoPoint.latLabel}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-stone-950/80 border border-stone-800">
                      <span className="text-[10px] text-stone-400 block">Landform Zone</span>
                      <span className="font-bold text-stone-100 capitalize">
                        {playerGeoPoint.biome}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Hypsometric Elevation Legend */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-2">
                    2. Hypsometric Elevation Legend
                  </h3>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-xs bg-red-500 border border-orange-300 inline-block" />
                        <span>Caldera Summit & Lava Crater</span>
                      </span>
                      <span className="font-mono-num text-stone-400">22m – 28m</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-xs bg-zinc-700 border border-amber-400/60 inline-block" />
                        <span>Basalt Volcanic Slopes</span>
                      </span>
                      <span className="font-mono-num text-stone-400">9m – 22m</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-xs bg-emerald-800 border border-emerald-400/60 inline-block" />
                        <span>Emerald Jungle & 20km Grasslands</span>
                      </span>
                      <span className="font-mono-num text-stone-400">2.5m – 9m</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-xs bg-amber-500 border border-amber-200 inline-block" />
                        <span>Coastal Sandbar & Cove Beach</span>
                      </span>
                      <span className="font-mono-num text-stone-400">0m – 2.5m</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-xs bg-sky-500 border border-sky-200 inline-block" />
                        <span>Freshwater Stream & Coral Shelf</span>
                      </span>
                      <span className="font-mono-num text-stone-400">&lt; 0m – 10m</span>
                    </div>
                  </div>
                </div>

                {/* Key Geographical Landmarks */}
                <div className="p-3 rounded-xl bg-stone-900/90 border border-stone-700/80">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-1.5">
                    3. Surveyed Island Landmarks
                  </h3>
                  <ul className="space-y-1 text-[11px] text-stone-300 font-mono-num">
                    <li className="flex justify-between">
                      <span>▲ Mt. Caldera Crater</span>
                      <span className="text-amber-300">(0m, 0m) · +28m</span>
                    </li>
                    <li className="flex justify-between">
                      <span>≈ Waterfall Plunge Pool</span>
                      <span className="text-sky-300">(-13m, 34m) · +10m</span>
                    </li>
                    <li className="flex justify-between">
                      <span>◆ Jungle Ridge Beacon</span>
                      <span className="text-emerald-300">(0m, 44m) · +6m</span>
                    </li>
                    <li className="flex justify-between">
                      <span>⚓ Escape Boat Shipyard</span>
                      <span className="text-amber-200">(6m, 66m) · +1m</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 3: PAUSE MODAL
         ===================================================================== */}
      {hud.state === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expedition Paused"
          className="fixed inset-0 z-30 flex items-center justify-center p-6"
          style={{ backgroundColor: 'rgba(6, 13, 17, 0.78)' }}
        >
          <div
            className="w-full max-w-md rounded-xl p-7 border border-amber-700/60 shadow-2xl text-center"
            style={{ backgroundColor: 'rgba(18, 25, 23, 0.96)' }}
          >
            <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-1">
              Caldera Castaway
            </p>
            <h2 className="font-display text-3xl font-extrabold text-white mb-5">
              Expedition Paused
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-6 text-center">
              <div className="p-3 rounded-lg bg-stone-900/90 border border-stone-800">
                <p className="text-[11px] uppercase text-stone-400">Vitality</p>
                <p className="font-mono-num text-xl font-bold text-emerald-400 mt-0.5">
                  {hpPct}%
                </p>
              </div>
              <div className="p-3 rounded-lg bg-stone-900/90 border border-stone-800">
                <p className="text-[11px] uppercase text-stone-400">Resources</p>
                <p className="font-mono-num text-xl font-bold text-amber-300 mt-0.5">
                  {hud.resourcesCollected}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-stone-900/90 border border-stone-800">
                <p className="text-[11px] uppercase text-stone-400">Beacons</p>
                <p className="font-mono-num text-xl font-bold text-orange-400 mt-0.5">
                  {hud.campfiresLit}/{hud.totalCampfires}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleTogglePause}
                className="w-full py-3 rounded-lg font-display font-bold text-sm text-stone-950 bg-amber-400 hover:bg-amber-300 transition-colors cursor-pointer"
              >
                Resume Survival
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="w-full py-2.5 rounded-lg font-semibold text-sm text-stone-200 bg-stone-800 hover:bg-stone-700 transition-colors cursor-pointer"
              >
                Restart on Beach
              </button>
              <button
                type="button"
                onClick={handleReturnToTitle}
                className="w-full py-2.5 rounded-lg font-semibold text-sm text-stone-400 hover:text-stone-200 transition-colors cursor-pointer"
              >
                Return to Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 4: VICTORY / GAME OVER MODAL
         ===================================================================== */}
      {hud.state === 'gameover' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={hud.victory ? 'Rescue Signal Sighted' : 'Castaway Perished'}
          className="fixed inset-0 z-30 flex items-center justify-center p-6"
          style={{ backgroundColor: 'rgba(6, 13, 17, 0.82)' }}
        >
          <div
            className="w-full max-w-md rounded-xl p-7 border border-amber-700/60 shadow-2xl text-center"
            style={{ backgroundColor: 'rgba(18, 25, 23, 0.96)' }}
          >
            <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-1">
              {hud.victory ? 'Voyage to Freedom Achieved' : 'Island Survival Defeat'}
            </p>
            <h2 className="font-display text-3xl font-extrabold text-white mb-2">
              {hud.victory ? 'Sailed to Freedom!' : 'Overcome by the Island'}
            </h2>
            <p className="text-sm text-stone-300 mb-6">
              {hud.victory
                ? 'You recovered the Sea-Drifted Supply Box, fought off wild creatures, built your Outrigger Escape Boat, and sailed beyond the reef!'
                : 'Wild creatures, dehydration, hunger, or molten lava claimed your strength.'}
            </p>

            <div className="grid grid-cols-3 gap-3 mb-6 text-center">
              <div className="p-3 rounded-lg bg-stone-900/90 border border-stone-800">
                <p className="text-[11px] uppercase text-stone-400">Days Survived</p>
                <p className="font-mono-num text-xl font-bold text-amber-300 mt-0.5">
                  {hud.daysSurvived}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-stone-900/90 border border-stone-800">
                <p className="text-[11px] uppercase text-stone-400">Boat Built</p>
                <p className="font-mono-num text-xl font-bold text-emerald-400 mt-0.5">
                  {hud.boatStage}/3
                </p>
              </div>
              <div className="p-3 rounded-lg bg-stone-900/90 border border-stone-800">
                <p className="text-[11px] uppercase text-stone-400">Creatures</p>
                <p className="font-mono-num text-xl font-bold text-rose-400 mt-0.5">
                  {hud.creaturesDefeated}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-start="true"
              onClick={handleRestart}
              className="w-full py-3 rounded-lg font-display font-bold text-sm text-stone-950 bg-amber-400 hover:bg-amber-300 transition-colors cursor-pointer"
            >
              {hud.victory ? 'Play Another Expedition' : 'Try Again on the Shore'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
