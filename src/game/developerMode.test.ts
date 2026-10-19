import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AERIAL_PRESETS,
  getAerialPreset,
  createInitialDeveloperModeState,
  computeAerialCameraPosition,
  lerpCameraTransform,
  stepAerialPan,
  computeOptimalFogDensity,
  clampAerialAltitude,
  formatAerialReadout,
  MIN_AERIAL_ALTITUDE,
  MAX_AERIAL_ALTITUDE,
  DEFAULT_GROUND_FOG_DENSITY,
} from './developerMode.ts';

test('AERIAL_PRESETS contains essential vantage points across the island', () => {
  assert.ok(AERIAL_PRESETS.length >= 6, 'Should have at least 6 presets');
  const sanctuary = getAerialPreset('sanctuary');
  assert.equal(sanctuary.id, 'sanctuary');
  assert.equal(sanctuary.targetX, 0);
  assert.equal(sanctuary.targetZ, 38);
  assert.ok(sanctuary.altitude >= 100);

  const macroIsland = getAerialPreset('island_20km');
  assert.equal(macroIsland.id, 'island_20km');
  assert.ok(macroIsland.altitude >= 1000);

  const westLake = getAerialPreset('west_lake');
  assert.equal(westLake.targetX, -54);

  const eastLake = getAerialPreset('east_lake');
  assert.equal(eastLake.targetX, 54);

  const beach = getAerialPreset('extended_beach');
  assert.equal(beach.targetX, 0);
  assert.ok(beach.targetZ >= 66);
});

test('createInitialDeveloperModeState starts disabled in third_person mode', () => {
  const initial = createInitialDeveloperModeState();
  assert.equal(initial.enabled, false);
  assert.equal(initial.viewMode, 'third_person');
  assert.equal(initial.transitionProgress, 0);
  assert.ok(initial.altitude > 50);
});

test('computeAerialCameraPosition computes elevated camera looking at target', () => {
  const cam = computeAerialCameraPosition({
    targetX: 0,
    targetZ: 40,
    targetGroundY: 3.5,
    altitude: 150,
    yawRad: 0,
    pitchRad: Math.PI / 4, // 45 degrees
  });

  // At 45 degrees, horiz setback = altitude / tan(45°) = 150
  assert.equal(cam.lookX, 0);
  assert.equal(cam.lookY, 3.5);
  assert.equal(cam.lookZ, 40);
  assert.equal(cam.posY, 153.5);
  // With yaw = 0, setback is along +Z: 40 + 150 = 190
  assert.ok(Math.abs(cam.posZ - 190) < 0.1);
  assert.ok(Math.abs(cam.posX - 0) < 0.1);
});

test('computeAerialCameraPosition clamps extreme pitch and altitude safely', () => {
  const tooLow = computeAerialCameraPosition({
    targetX: 10,
    targetZ: 10,
    altitude: 5, // Below MIN_AERIAL_ALTITUDE
    yawRad: 0,
    pitchRad: 0.01,
  });
  assert.equal(tooLow.posY, MIN_AERIAL_ALTITUDE);

  const tooHigh = computeAerialCameraPosition({
    targetX: 10,
    targetZ: 10,
    altitude: 5000, // Above MAX_AERIAL_ALTITUDE
    yawRad: 0,
    pitchRad: 1.5,
  });
  assert.equal(tooHigh.posY, MAX_AERIAL_ALTITUDE);
});

test('lerpCameraTransform smoothly interpolates between two viewpoints', () => {
  const from = { posX: 0, posY: 2, posZ: 70, lookX: 0, lookY: 2, lookZ: 66 };
  const to = { posX: 0, posY: 160, posZ: 70, lookX: 0, lookY: 2, lookZ: 30 };

  const start = lerpCameraTransform(from, to, 0);
  assert.equal(start.posY, 2);
  assert.equal(start.lookZ, 66);

  const end = lerpCameraTransform(from, to, 1);
  assert.equal(end.posY, 160);
  assert.equal(end.lookZ, 30);

  const mid = lerpCameraTransform(from, to, 0.5);
  // Cubic smoothstep at 0.5 is 0.5
  assert.equal(mid.posY, 81);
});

test('stepAerialPan moves target coords in camera view direction', () => {
  const current = { targetX: 0, targetZ: 0, yawRad: 0 }; // Facing North (-Z)
  const forwardPan = stepAerialPan(current, { forward: 1, right: 0 }, 50, 0.1);
  assert.equal(forwardPan.targetX, 0);
  assert.ok(forwardPan.targetZ < 0, 'Moving forward facing North should decrease Z');

  const rightPan = stepAerialPan(current, { forward: 0, right: 1 }, 50, 0.1);
  assert.ok(rightPan.targetX > 0, 'Moving right should increase X');
  assert.equal(rightPan.targetZ, 0);
});

test('computeOptimalFogDensity attenuates fog at high altitude for crystal-clear aerial vistas', () => {
  const groundFog = computeOptimalFogDensity(20, true);
  assert.equal(groundFog, DEFAULT_GROUND_FOG_DENSITY);

  const highFog = computeOptimalFogDensity(1200, true);
  assert.ok(highFog < groundFog * 0.1, 'High altitude fog should be drastically reduced');

  const normalIfClearSkiesDisabled = computeOptimalFogDensity(1200, false);
  assert.equal(normalIfClearSkiesDisabled, DEFAULT_GROUND_FOG_DENSITY);
});

test('clampAerialAltitude bounds altitude between min and max limits', () => {
  assert.equal(clampAerialAltitude(10), MIN_AERIAL_ALTITUDE);
  assert.equal(clampAerialAltitude(500), 500);
  assert.equal(clampAerialAltitude(9999), MAX_AERIAL_ALTITUDE);
});

test('formatAerialReadout formats coordinates, altitude label, and compass degrees', () => {
  const readout = formatAerialReadout({
    targetX: -54,
    targetZ: 32,
    altitude: 155,
    yawRad: 0,
  });
  assert.equal(readout.coordinates, '(-54m, +32m)');
  assert.equal(readout.altitudeLabel, '155 m');
  assert.equal(readout.compassHeading, 0);

  const kmReadout = formatAerialReadout({
    targetX: 120,
    targetZ: -450,
    altitude: 1400,
    yawRad: Math.PI / 2,
  });
  assert.equal(kmReadout.altitudeLabel, '1.40 km');
});
