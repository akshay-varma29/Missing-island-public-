import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groundHeightAt,
  isLavaHazardAt,
  getBiomeZoneAt,
  isSwimmingAt,
  stepPlayerVitals,
  collectResource,
  consumeProvision,
  evaluateDayNightCycle,
  findNearestInteractable,
  computeTargetMoveSpeed,
  normalizeJoystickInput,
  worldToMinimapCoords,
  playerYawToMinimapAngle,
  getISTTimeState,
  openSupplyCrate,
  computeSupplyBoxDriftPosition,
  advanceBoatConstruction,
  resolvePlayerMeleeAttack,
  getBackpackStorageState,
  canStoreInBackpack,
  dropBackpackItem,
  stepCameraOrbit,
  camYawToCompassDegrees,
  freshwaterStreamX,
  freshwaterStreamInfo,
  jungleTrailProximity,
  drinkFreshwater,
  EXPANDED_ISLAND_RADIUS,
  EXPANDED_ISLAND_DIAMETER,
  WORLD_BOUNDARY_RADIUS,
  getExpandedCoastlineRadius,
  grassColorVariationAt,
  worldToGeographicalMapCoords,
  generateIslandCoastlineSvgPath,
  MACRO_ISLAND_CENTER_X,
  MACRO_ISLAND_CENTER_Z,
  getSouthernCoastlineZ,
  computeTerrainSlopeAt,
  isSafeAnimalHabitatAt,
  resolveSafeAnimalSpawn,
  createAnimalPhysicsState,
  applyAnimalKnockback,
  stepAnimalPhysics,
  EXTENDED_BEACH_BELT_WIDTH,
  STAGE2_HILLS_AND_MOUNTAINS,
  STAGE2_LAKES,
  STAGE2_RIVERS,
  getStage2HillMountainElevationAt,
  getStage2HydrologyAt,
} from './rules.ts';


test('terrain height profile rises from ocean to beach, jungle, central volcano peak, and 10km expanded grasslands', () => {
  const coveOceanH = groundHeightAt(0, 115);
  const outerOceanH = groundHeightAt(0, 10450);
  const beachH = groundHeightAt(0, 68);
  const jungleH = groundHeightAt(0, 42);
  const volcanoRimH = groundHeightAt(0, 14);
  const expandedGrassH = groundHeightAt(1500, -1500);

  assert.ok(coveOceanH < -1.0, `Expected Southern Castaway Cove surf < -1.0m, got ${coveOceanH}`);
  assert.ok(outerOceanH < -1.0, `Expected outer deep ocean < -1.0m beyond 10km radius, got ${outerOceanH}`);
  assert.ok(beachH >= 0.0 && beachH < 3.0, `Expected gentle beach height in [0, 3], got ${beachH}`);
  assert.ok(jungleH > beachH, `Expected jungle height (${jungleH}) > beach height (${beachH})`);
  assert.ok(volcanoRimH > 18.0, `Expected volcano rim height > 18m, got ${volcanoRimH}`);
  assert.ok(expandedGrassH > 2.5 && expandedGrassH < 18.0, `Expected walkable expanded grassland elevation, got ${expandedGrassH}`);
});

test('biome classification and swimming threshold work accurately across core sanctuary and 10km expanded island', () => {
  assert.equal(getBiomeZoneAt(0, 0), 'caldera');
  assert.equal(getBiomeZoneAt(0, 22), 'volcano');
  assert.equal(getBiomeZoneAt(0, 46), 'jungle');
  assert.equal(getBiomeZoneAt(0, 68), 'beach');
  assert.equal(getBiomeZoneAt(0, 115), 'ocean');
  assert.equal(getBiomeZoneAt(2000, 0), 'jungle');
  assert.equal(getBiomeZoneAt(0, 10450), 'ocean');

  assert.equal(isSwimmingAt(0, 68), false);
  assert.equal(isSwimmingAt(0, 115), true);
  assert.equal(isSwimmingAt(2000, 0), false);
  assert.equal(isSwimmingAt(0, 10450), true);
});

test('lava hazard detects central caldera and diagonal lava channels while keeping southern spawn safe', () => {
  // Center caldera is molten lava
  assert.equal(isLavaHazardAt(0, 0), true);
  // Southern beach spawn at (0, 66) is completely safe
  assert.equal(isLavaHazardAt(0, 66), false);
  // Direct southern path up the jungle (0, 40) is safe
  assert.equal(isLavaHazardAt(0, 40), false);
});

test('player vitals step applies lava damage and sprint stamina drain', () => {
  const initial = { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, hunger: 100, maxHunger: 100 };
  const afterLava = stepPlayerVitals(initial, {
    dt: 1.0,
    inLava: true,
    isSprinting: true,
    isMoving: true,
    nearLitCampfire: false,
  });

  assert.equal(afterLava.tookLavaDamage, true);
  assert.ok(afterLava.vitals.hp < 75, `Expected HP to drop below 75 after 1s in lava, got ${afterLava.vitals.hp}`);
  assert.ok(afterLava.vitals.stamina < 85, `Expected stamina to drain when sprinting`);
  assert.equal(afterLava.isDead, false);

  const lethalLava = stepPlayerVitals(initial, {
    dt: 4.0,
    inLava: true,
    isSprinting: false,
    isMoving: false,
    nearLitCampfire: false,
  });
  assert.equal(lethalLava.vitals.hp, 0);
  assert.equal(lethalLava.isDead, true);
});

test('resource collection and provision consumption update inventory and restore vitals', () => {
  let inv = { coconuts: 0, wood: 0, food: 0 };
  inv = collectResource(inv, 'coconut');
  inv = collectResource(inv, 'wood');
  inv = collectResource(inv, 'food');

  assert.deepEqual(inv, { coconuts: 1, wood: 1, food: 1 });

  const damagedVitals = { hp: 60, maxHp: 100, stamina: 50, maxStamina: 100, hunger: 50, maxHunger: 100 };
  const res = consumeProvision(inv, damagedVitals, 'coconut');
  assert.equal(res.consumed, 'coconut');
  assert.equal(res.inventory.coconuts, 0);
  assert.equal(res.vitals.hp, 78);
  assert.equal(res.vitals.hunger, 75);
});

test('day/night cycle evaluates solar elevation and phases cleanly', () => {
  const dawn = evaluateDayNightCycle(0.0);
  const noon = evaluateDayNightCycle(0.25);
  const dusk = evaluateDayNightCycle(0.5);
  const midnight = evaluateDayNightCycle(0.75);

  assert.equal(dawn.phase, 'Dawn');
  assert.equal(noon.phase, 'Noon');
  assert.equal(dusk.phase, 'Dusk');
  assert.equal(midnight.phase, 'Night');
  assert.ok(noon.sunElevation > 0.99);
  assert.ok(midnight.sunElevation < -0.99);
  assert.equal(noon.clockLabel, '12:00');
});

test('findNearestInteractable locates closest uncollected resource within reach', () => {
  const items = [
    { id: 'c1', type: 'coconut' as const, label: 'Coconut', x: 2, y: 1, z: 66, collected: false },
    { id: 'w1', type: 'wood' as const, label: 'Driftwood', x: 10, y: 1, z: 66, collected: false },
  ];
  const found = findNearestInteractable(1.2, 1, 66, items, 4.0);
  assert.equal(found.item?.id, 'c1');
});

test('computeTargetMoveSpeed handles walk, run, bend, and swim stances accurately', () => {
  const walkSpeed = computeTargetMoveSpeed({
    gait: 'walk',
    shiftHeld: false,
    isBending: false,
    isSwimming: false,
    stamina: 100,
  });
  assert.equal(walkSpeed.speed, 6.4);
  assert.equal(walkSpeed.isSprinting, false);

  const runSpeed = computeTargetMoveSpeed({
    gait: 'run',
    shiftHeld: false,
    isBending: false,
    isSwimming: false,
    stamina: 80,
  });
  assert.equal(runSpeed.speed, 10.5);
  assert.equal(runSpeed.isSprinting, true);

  const bendSpeed = computeTargetMoveSpeed({
    gait: 'run',
    shiftHeld: true,
    isBending: true,
    isSwimming: false,
    stamina: 100,
  });
  assert.equal(bendSpeed.speed, 3.6);
  assert.equal(bendSpeed.isSprinting, false);
});

test('normalizeJoystickInput clamps radial vectors to unit circle', () => {
  const zero = normalizeJoystickInput(0, 0, 50);
  assert.equal(zero.magnitude, 0);

  const halfRight = normalizeJoystickInput(25, 0, 50);
  assert.ok(Math.abs(halfRight.x - 0.5) < 1e-6);
  assert.ok(Math.abs(halfRight.magnitude - 0.5) < 1e-6);

  const clamped = normalizeJoystickInput(0, -120, 40);
  assert.ok(Math.abs(clamped.y - -1.0) < 1e-6);
  assert.ok(Math.abs(clamped.magnitude - 1.0) < 1e-6);
});

test('worldToMinimapCoords correctly projects island locations onto circular map', () => {
  // Center volcano
  const center = worldToMinimapCoords(0, 0, 76);
  assert.equal(center.percentX, 50);
  assert.equal(center.percentY, 50);
  assert.equal(center.isInsideIsland, true);

  // South beach shoreline where player spawns
  const beach = worldToMinimapCoords(0, 66, 76);
  assert.equal(beach.percentX, 50);
  assert.ok(beach.percentY > 80 && beach.percentY < 95);
  assert.equal(beach.isInsideIsland, true);

  // Campfire locations
  const beachCamp = worldToMinimapCoords(3.8, 62.5, 76);
  const jungleCamp = worldToMinimapCoords(0.0, 44.0, 76);
  const volcanoCamp = worldToMinimapCoords(-2.0, 28.5, 76);

  assert.ok(beachCamp.percentY > jungleCamp.percentY);
  assert.ok(jungleCamp.percentY > volcanoCamp.percentY);
  assert.ok(volcanoCamp.percentY > center.percentY);

  // Far outer ocean clamps within minimap radius
  const farOcean = worldToMinimapCoords(0, 180, 76);
  assert.equal(farOcean.isInsideIsland, false);
  assert.ok(farOcean.percentY <= 100);
});

test('playerYawToMinimapAngle converts Three.js yaw to compass degrees', () => {
  // Facing North (-Z)
  assert.equal(playerYawToMinimapAngle(0), 0);

  // Facing East (+X, playerYaw is -PI/2 in Three.js)
  assert.equal(Math.round(playerYawToMinimapAngle(-Math.PI / 2)), 90);

  // Facing West (-X, playerYaw is PI/2 in Three.js)
  assert.equal(Math.round(playerYawToMinimapAngle(Math.PI / 2)), -90);

  // Facing South (+Z, playerYaw is PI)
  assert.equal(Math.round(Math.abs(playerYawToMinimapAngle(Math.PI))), 180);
});

test('getISTTimeState converts UTC timestamps into Indian Standard Time (UTC+05:30) and solar timeline', () => {
  // 06:30:00 UTC -> 12:00:00 IST (Noon, normalizedTime = 0.25)
  const noonIST = getISTTimeState(Date.UTC(2026, 9, 18, 6, 30, 0));
  assert.equal(noonIST.clockLabel, '12:00');
  assert.equal(noonIST.clockWithSeconds, '12:00:00');
  assert.equal(noonIST.timezoneLabel, 'IST');
  assert.equal(noonIST.phase, 'Noon');
  assert.ok(Math.abs(noonIST.normalizedTime - 0.25) < 0.0001);

  // 00:30:00 UTC -> 06:00:00 IST (Dawn, normalizedTime = 0.0)
  const dawnIST = getISTTimeState(Date.UTC(2026, 9, 18, 0, 30, 0));
  assert.equal(dawnIST.clockLabel, '06:00');
  assert.equal(dawnIST.phase, 'Dawn');
  assert.ok(Math.abs(dawnIST.normalizedTime - 0.0) < 0.0001);

  // 12:30:00 UTC -> 18:00:00 IST (Dusk, normalizedTime = 0.5)
  const duskIST = getISTTimeState(Date.UTC(2026, 9, 18, 12, 30, 0));
  assert.equal(duskIST.clockLabel, '18:00');
  assert.equal(duskIST.phase, 'Dusk');
  assert.ok(Math.abs(duskIST.normalizedTime - 0.5) < 0.0001);

  // 18:30:00 UTC -> 00:00:00 IST next day (Night, normalizedTime = 0.75)
  const midnightIST = getISTTimeState(Date.UTC(2026, 9, 18, 18, 30, 0));
  assert.equal(midnightIST.clockLabel, '00:00');
  assert.equal(midnightIST.dateLabel, '19 Oct 2026');
  assert.equal(midnightIST.phase, 'Night');
  assert.ok(Math.abs(midnightIST.normalizedTime - 0.75) < 0.0001);
});

test('Sea-drifted supply crate drifts ashore and grants Knife, Rope, and Island Map', () => {
  const offshore = computeSupplyBoxDriftPosition(0, -18, 63, 14);
  const ashore = computeSupplyBoxDriftPosition(15, -18, 63, 14);
  assert.equal(offshore.isAshore, false);
  assert.equal(ashore.isAshore, true);
  assert.ok(Math.hypot(offshore.x, offshore.z) > Math.hypot(ashore.x, ashore.z));

  const initialInv = { coconuts: 1, wood: 0, food: 0, rope: 0, hasKnife: false, hasRope: false, hasMap: false };
  const afterCrate = openSupplyCrate(initialInv);
  assert.equal(afterCrate.hasKnife, true);
  assert.equal(afterCrate.hasRope, true);
  assert.equal(afterCrate.hasMap, true);
  assert.equal(afterCrate.rope, 3);
  assert.equal(afterCrate.coconuts, 2);
});

test('Escape Boat construction progresses through 3 stages and launches when complete', () => {
  const noToolsInv = { coconuts: 3, wood: 10, food: 3, rope: 0, hasKnife: false, hasRope: false, hasMap: false };
  const blocked = advanceBoatConstruction(0, noToolsInv);
  assert.equal(blocked.success, false);
  assert.equal(blocked.newStage, 0);

  const equippedInv = openSupplyCrate({ coconuts: 2, wood: 9, food: 2, rope: 0 });
  const stage1 = advanceBoatConstruction(0, equippedInv);
  assert.equal(stage1.success, true);
  assert.equal(stage1.newStage, 1);
  assert.equal(stage1.inventory.wood, 6);
  assert.equal(stage1.inventory.rope, 2);

  const stage2 = advanceBoatConstruction(1, stage1.inventory);
  assert.equal(stage2.success, true);
  assert.equal(stage2.newStage, 2);
  assert.equal(stage2.inventory.wood, 3);
  assert.equal(stage2.inventory.rope, 1);

  const stage3 = advanceBoatConstruction(2, stage2.inventory);
  assert.equal(stage3.success, true);
  assert.equal(stage3.newStage, 3);
  assert.equal(stage3.inventory.wood, 0);
  assert.equal(stage3.inventory.rope, 0);

  const launch = advanceBoatConstruction(3, stage3.inventory);
  assert.equal(launch.readyToSail, true);
});

test('resolvePlayerMeleeAttack deals enhanced knife damage and defeats hostile creatures', () => {
  const targets = [{ id: 'boar_0', kind: 'boar' as const, x: 0, z: 58, hp: 50, maxHp: 50 }];
  // Player at (0, 60) facing North (yaw = 0 -> -Z)
  const hit1 = resolvePlayerMeleeAttack({
    playerX: 0,
    playerZ: 60,
    playerYaw: 0,
    hasKnife: true,
    targets,
  });
  assert.equal(hit1.hitTargetId, 'boar_0');
  assert.equal(hit1.damageDealt, 40);
  assert.equal(hit1.killed, false);
  assert.equal(hit1.updatedTargets[0].hp, 10);

  const hit2 = resolvePlayerMeleeAttack({
    playerX: 0,
    playerZ: 60,
    playerYaw: 0,
    hasKnife: true,
    targets: hit1.updatedTargets,
  });
  assert.equal(hit2.killed, true);
  assert.equal(hit2.updatedTargets[0].hp, 0);
});

test('getBackpackStorageState calculates slot capacity, tool pouches, and dropBackpackItem frees slots', () => {
  const inv = {
    coconuts: 2,
    wood: 3,
    food: 1,
    rope: 2,
    hasKnife: true,
    hasRope: true,
    hasMap: false,
  };
  const state = getBackpackStorageState(inv, 16);
  assert.equal(state.usedSlots, 8);
  assert.equal(state.maxSlots, 16);
  assert.equal(state.freeSlots, 8);
  assert.equal(state.fillPercent, 50);
  assert.equal(state.isFull, false);
  assert.equal(state.slots.length, 16);
  assert.equal(state.slots[0].kind, 'coconut');
  assert.equal(state.slots[7].kind, 'rope');
  assert.equal(state.slots[8].kind, 'empty');
  assert.equal(state.tools.find((t) => t.id === 'knife')?.unlocked, true);
  assert.equal(state.tools.find((t) => t.id === 'map')?.unlocked, false);

  assert.equal(canStoreInBackpack(inv, 8, 16), true);
  assert.equal(canStoreInBackpack(inv, 9, 16), false);

  const dropped = dropBackpackItem(inv, 'wood');
  assert.equal(dropped.dropped, true);
  assert.equal(dropped.inventory.wood, 2);
});

test('stepCameraOrbit supports continuous 360-degree horizontal rotation and pitch/zoom clamping', () => {
  assert.equal(camYawToCompassDegrees(0), 0);
  assert.equal(camYawToCompassDegrees(-Math.PI / 2), 90);
  assert.equal(camYawToCompassDegrees(Math.PI), 180);

  // Full 360-degree swipe wraps cleanly inside [-PI, PI]
  const fullSpin = stepCameraOrbit({
    camYaw: 0,
    camPitch: 0.28,
    camDist: 6.4,
    deltaX: (Math.PI * 2) / 0.0068,
    deltaY: 0,
  });
  assert.ok(Math.abs(fullSpin.camYaw) < 0.01);
  assert.equal(fullSpin.compassDeg, 0);

  // Pitch clamps safely between horizon (-0.12) and overhead (1.32), zoom clamps [3.4, 11.5]
  const extreme = stepCameraOrbit({
    camYaw: 0,
    camPitch: 0.28,
    camDist: 6.4,
    deltaX: 120,
    deltaY: 9999,
    zoomDelta: -10,
  });
  assert.equal(extreme.camPitch, 1.32);
  assert.equal(extreme.camDist, 3.4);
});

test('freshwater stream path and waterfall classification in southwest jungle', () => {
  const streamXAt44 = freshwaterStreamX(44);
  assert.ok(streamXAt44 < -10 && streamXAt44 > -16, `Expected stream x between -10 and -16, got ${streamXAt44}`);

  // Waterfall at ridge z=34
  const waterfallInfo = freshwaterStreamInfo(streamXAt44, 34);
  assert.equal(waterfallInfo.isWaterfall, true);
  assert.ok(waterfallInfo.waterSurfaceY > 8.0, `Expected elevated waterfall surface, got ${waterfallInfo.waterSurfaceY}`);

  // Flowing stream bed at z=48
  const streamXAt48 = freshwaterStreamX(48);
  const streamInfo = freshwaterStreamInfo(streamXAt48, 48);
  assert.equal(streamInfo.inStream, true);
  assert.equal(streamInfo.isWaterfall, false);
  assert.ok(streamInfo.streamBedDepth > 0.35, `Expected carved stream bed depth > 0.35, got ${streamInfo.streamBedDepth}`);

  // Far away from stream
  const farInfo = freshwaterStreamInfo(0, 48);
  assert.equal(farInfo.inStream, false);
  assert.equal(farInfo.nearStream, false);
});

test('jungle trail proximity detects main path and clearings', () => {
  // On main trail at Jungle Ridge Campfire (0, 44)
  const atCampfire = jungleTrailProximity(0, 44);
  assert.ok(atCampfire > 0.8, `Expected high trail proximity at campfire (0, 44), got ${atCampfire}`);

  // On beach connection trail (3.8, 62.5)
  const atBeachCamp = jungleTrailProximity(3.8, 62.5);
  assert.ok(atBeachCamp > 0.8, `Expected high trail proximity at beach campfire (3.8, 62.5), got ${atBeachCamp}`);

  // Far deep off-trail in the wilderness
  const offTrail = jungleTrailProximity(30, 44);
  assert.equal(offTrail, 0);
});

test('drinkFreshwater replenishes player thirst and hydration', () => {
  const thirstyVitals = {
    hp: 80,
    maxHp: 100,
    stamina: 60,
    maxStamina: 100,
    hunger: 70,
    maxHunger: 100,
    thirst: 20,
    maxThirst: 100,
  };
  const res = drinkFreshwater(thirstyVitals);
  assert.equal(res.vitals.thirst, 55);
  assert.equal(res.restoredThirst, 35);
  assert.ok(res.vitals.hp > 80);
});

test('expanded 10 km radius (20 km diameter) island landmass, natural coastline, and walkable transition from beach', () => {
  assert.equal(EXPANDED_ISLAND_RADIUS, 10000);
  assert.equal(EXPANDED_ISLAND_DIAMETER, 20000);
  assert.ok(WORLD_BOUNDARY_RADIUS >= 10500);

  // Starting beach at (0, 66) is preserved at gentle dry sand height
  const startBeachH = groundHeightAt(0, 66);
  assert.ok(startBeachH > 0.8 && startBeachH < 2.2, `Expected starting beach height ~1.2m, got ${startBeachH}`);

  // Walking East, West, or North from the starting beach transitions smoothly onto dry walkable expanded grassland
  for (const dist of [70, 90, 150, 500, 2500, 6000, 8500]) {
    const eastH = groundHeightAt(dist, 55);
    const westH = groundHeightAt(-dist, 55);
    const northH = groundHeightAt(0, -dist);
    assert.ok(eastH > 1.5, `Expected dry land walking East at x=${dist}, got y=${eastH}`);
    assert.ok(westH > 1.5, `Expected dry land walking West at x=${-dist}, got y=${westH}`);
    assert.ok(northH > 1.5, `Expected dry land walking North at z=${-dist}, got y=${northH}`);
  }

  // Natural coastline outline stays around ~10 km radius across all compass angles relative to macro island center
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const coastR = getExpandedCoastlineRadius(angle);
    assert.ok(
      coastR > 8800 && coastR < 14000,
      `Expected natural coastline radius ~10km at angle ${angle.toFixed(2)}, got ${coastR}`
    );
    // Inside coastline is dry land (on the island back side); outside coastline is ocean
    const insideX = MACRO_ISLAND_CENTER_X + Math.cos(angle) * (coastR - 260);
    const insideZ = MACRO_ISLAND_CENTER_Z + Math.sin(angle) * (coastR - 260);
    const outsideX = MACRO_ISLAND_CENTER_X + Math.cos(angle) * (coastR + 260);
    const outsideZ = MACRO_ISLAND_CENTER_Z + Math.sin(angle) * (coastR + 260);
    if (insideZ < getSouthernCoastlineZ(insideX)) {
      assert.ok(groundHeightAt(insideX, insideZ) > 0.1, `Expected dry land inside coastline at angle ${angle.toFixed(2)}, got ${groundHeightAt(insideX, insideZ)}`);
    }
    assert.ok(groundHeightAt(outsideX, outsideZ) < -0.2, `Expected ocean outside coastline at angle ${angle.toFixed(2)}, got ${groundHeightAt(outsideX, outsideZ)}`);
  }

  // In front of the beach (South, z >= getSouthernCoastlineZ(x)), strictly open ocean with ZERO land!
  for (const testZ of [75, 120, 300, 1200, 5000]) {
    assert.ok(groundHeightAt(0, testZ) < -0.25, `Expected ocean in front of beach at z=${testZ}, got ${groundHeightAt(0, testZ)}`);
    assert.equal(getBiomeZoneAt(0, testZ), 'ocean');
  }

  // Grass color variation returns bounded [0, 1] values with spatial variation
  const g1 = grassColorVariationAt(200, 200);
  const g2 = grassColorVariationAt(850, -420);
  assert.ok(g1.lushness >= 0 && g1.lushness <= 1);
  assert.ok(g1.sunWarmth >= 0 && g1.sunWarmth <= 1);
  assert.ok(g1.microTone >= 0 && g1.microTone <= 1);
  assert.notEqual(g1.lushness, g2.lushness);
});

test('worldToGeographicalMapCoords and generateIslandCoastlineSvgPath compute topographic coordinates and coastline geometry', () => {
  const calderaPt = worldToGeographicalMapCoords(0, 0, 80);
  assert.equal(calderaPt.percentX, 50);
  assert.equal(calderaPt.percentY, 50);
  assert.equal(calderaPt.biome, 'caldera');
  assert.ok(calderaPt.elevationMeters > 15);
  assert.equal(calderaPt.isWithinBounds, true);
  assert.ok(calderaPt.latLabel.endsWith('°N'));
  assert.ok(calderaPt.lonLabel.endsWith('°E'));

  const beachPt = worldToGeographicalMapCoords(0, 66, 80);
  assert.equal(beachPt.percentX, 50);
  assert.ok(beachPt.percentY > 85 && beachPt.percentY < 96);
  assert.equal(beachPt.biome, 'beach');
  assert.ok(beachPt.elevationMeters >= 0.5 && beachPt.elevationMeters < 3.0);

  const svgPath = generateIslandCoastlineSvgPath(48, 100, 11500);
  assert.ok(svgPath.startsWith('M'));
  assert.ok(svgPath.endsWith('Z'));
  assert.equal(svgPath.split('L').length, 48);
});

test('Animals Physics Stage 1: habitat validation, terrain slope alignment, 3D knockback gravity arc, and non-teleporting chase/return/flee', () => {
  // 1. Safe habitat validation rejects open ocean south of beach and central volcano caldera
  assert.equal(isSafeAnimalHabitatAt(0, 82, 'crab'), false);
  assert.equal(isSafeAnimalHabitatAt(0, 75, 'boar'), false);
  assert.equal(isSafeAnimalHabitatAt(0, 0, 'monkey'), false);
  assert.equal(isSafeAnimalHabitatAt(5.0, 64.5, 'crab'), true);
  assert.equal(isSafeAnimalHabitatAt(-11.5, 54.0, 'boar'), true);

  // resolveSafeAnimalSpawn nudges ocean or lava coordinates back onto safe dry habitat
  const nudgedCrab = resolveSafeAnimalSpawn(0, 85, 'crab');
  assert.ok(nudgedCrab.z < getSouthernCoastlineZ(nudgedCrab.x));
  assert.equal(isSafeAnimalHabitatAt(nudgedCrab.x, nudgedCrab.z, 'crab'), true);

  // 2. Terrain slope alignment computes bounded unit normal, pitch, and roll
  const slope = computeTerrainSlopeAt(0, 32, 0);
  const normLen = Math.hypot(slope.nx, slope.ny, slope.nz);
  assert.ok(Math.abs(normLen - 1.0) < 0.001);
  // Facing North (yaw=0) at (0, 32) looks uphill toward volcano at (0, 0), so pitch > 0
  assert.ok(slope.pitch > 0.02 && slope.pitch <= 0.52);

  // 3. Hostile boar chases player smoothly, strikes in melee range, and returns without teleporting
  let boar = createAnimalPhysicsState({
    id: 'boar_test',
    kind: 'boar',
    homeX: -11.5,
    homeZ: 54.0,
    hostile: true,
    hp: 80,
    maxHp: 80,
  });

  // Step with player within aggro range (-11.5, 58.0 -> 4m away)
  let sawChase = false;
  let sawAttack = false;
  for (let i = 0; i < 15; i++) {
    const res = stepAnimalPhysics(boar, {
      dt: 0.05,
      elapsed: i * 0.05,
      playerX: -11.5,
      playerZ: 58.0,
      gameState: 'playing',
    });
    boar = res.state;
    if (boar.behavior === 'chase') sawChase = true;
    if (boar.behavior === 'attack' || res.attackedPlayer) sawAttack = true;
  }
  assert.equal(sawChase, true, 'Expected boar to enter chase state when closing distance');
  assert.equal(sawAttack, true, 'Expected boar to reach melee attack state after closing distance');
  assert.ok(boar.z > 55.5, 'Expected boar to move south toward player during chase');

  // When player moves far away (e.g. (0, 66)), boar transitions to return (never teleports!)
  const beforeDisengageZ = boar.z;
  const disengageRes = stepAnimalPhysics(boar, {
    dt: 0.05,
    elapsed: 1.0,
    playerX: 50,
    playerZ: 66,
    gameState: 'playing',
  });
  boar = disengageRes.state;
  assert.ok(
    Math.abs(boar.z - beforeDisengageZ) < 0.5,
    'Boar must not teleport instantaneously when player leaves aggro range'
  );

  // 4. 3D Knockback + vertical hop impulse arcs through air and lands back on ground under gravity
  let knockedBoar = applyAnimalKnockback(boar, -11.5, 58.5, 6.8, 4.1);
  assert.equal(knockedBoar.isGrounded, false);
  assert.ok(knockedBoar.vy > 3.5);
  assert.ok(knockedBoar.vz < -4.0);

  let peakY = knockedBoar.y;
  for (let step = 0; step < 30; step++) {
    const stepRes = stepAnimalPhysics(knockedBoar, {
      dt: 0.033,
      elapsed: 2.0 + step * 0.033,
      playerX: -11.5,
      playerZ: 58.5,
      gameState: 'playing',
    });
    knockedBoar = stepRes.state;
    if (knockedBoar.y > peakY) peakY = knockedBoar.y;
  }
  assert.ok(peakY > groundHeightAt(knockedBoar.x, knockedBoar.z) + 0.15, 'Expected upward knockback arc');
  assert.equal(knockedBoar.isGrounded, true, 'Expected knocked-back animal to land back on terrain');
  assert.ok(
    Math.abs(knockedBoar.y - groundHeightAt(knockedBoar.x, knockedBoar.z)) < 0.02,
    'Expected landed animal y to match exact groundHeightAt without floating'
  );

  // 5. Passive wildlife flees when player sprints nearby
  let lizard = createAnimalPhysicsState({
    id: 'lizard_test',
    kind: 'lizard',
    homeX: 12.0,
    homeZ: 50.0,
    hostile: false,
  });
  const fleeStep = stepAnimalPhysics(lizard, {
    dt: 0.05,
    elapsed: 1.0,
    playerX: 12.0,
    playerZ: 53.5,
    playerMoving: true,
    playerSprinting: true,
    gameState: 'playing',
  });
  lizard = fleeStep.state;
  assert.equal(lizard.behavior, 'flee');
  assert.ok(lizard.vz < 0, 'Expected startled lizard to flee northward away from sprinting player');
});

test('Stage 2 World Geography: extended beach belt, hills and mountains across the map, and freshwater lakes and rivers', () => {
  // 1. Extended Southern Beach Belt: broader 26m beach width along East & West coastal wings
  assert.ok(EXTENDED_BEACH_BELT_WIDTH >= 24);
  const westExtendedBeachH = groundHeightAt(-45, 62);
  const eastExtendedBeachH = groundHeightAt(45, 62);
  assert.ok(westExtendedBeachH > 0.3 && westExtendedBeachH < 2.35, `Expected extended West beach sand elevation, got ${westExtendedBeachH}`);
  assert.ok(eastExtendedBeachH > 0.3 && eastExtendedBeachH < 2.35, `Expected extended East beach sand elevation, got ${eastExtendedBeachH}`);
  assert.equal(getBiomeZoneAt(-45, 62), 'beach');
  assert.equal(getBiomeZoneAt(45, 62), 'beach');

  // 2. Hills and Mountains across the map (both near-sanctuary foothills and macro island ranges)
  assert.ok(STAGE2_HILLS_AND_MOUNTAINS.length >= 12);
  const hills = STAGE2_HILLS_AND_MOUNTAINS.filter((p) => p.kind === 'hill');
  const mountains = STAGE2_HILLS_AND_MOUNTAINS.filter((p) => p.kind === 'mountain');
  assert.ok(hills.length >= 5, 'Expected multiple Stage 2 hills across the map');
  assert.ok(mountains.length >= 7, 'Expected multiple Stage 2 mountains across the map');

  for (const peak of STAGE2_HILLS_AND_MOUNTAINS) {
    const gainAtCenter = getStage2HillMountainElevationAt(peak.x, peak.z);
    const groundAtCenter = groundHeightAt(peak.x, peak.z);
    assert.ok(
      gainAtCenter > peak.heightGain * 0.85,
      `Expected peak ${peak.name} to contribute significant elevation gain, got ${gainAtCenter}`
    );
    if (peak.kind === 'mountain') {
      assert.ok(
        groundAtCenter > 45.0,
        `Expected mountain ${peak.name} summit > 45m ASL, got ${groundAtCenter}`
      );
    } else {
      assert.ok(
        groundAtCenter > 16.0,
        `Expected hill ${peak.name} summit > 16m ASL, got ${groundAtCenter}`
      );
    }
  }

  // 3. Freshwater Lakes across the map carve depressed basins below their water surface and support drinking
  assert.ok(STAGE2_LAKES.length >= 8);
  for (const lake of STAGE2_LAKES) {
    const hydro = getStage2HydrologyAt(lake.x, lake.z);
    assert.equal(hydro.inLake, true, `Expected ${lake.name} center to be inside lake`);
    assert.equal(hydro.inWater, true);
    assert.equal(hydro.waterSurfaceY, lake.waterLevel);
    assert.ok(hydro.waterDepth > 1.2, `Expected ${lake.name} depth > 1.2m, got ${hydro.waterDepth}`);

    const bedY = groundHeightAt(lake.x, lake.z);
    assert.ok(
      bedY < lake.waterLevel - 0.8,
      `Expected carved lake bed (${bedY}) below lake water surface (${lake.waterLevel}) for ${lake.name}`
    );

    const streamCheck = freshwaterStreamInfo(lake.x, lake.z);
    assert.equal(streamCheck.nearStream, true, `Expected player to be able to drink fresh water at ${lake.name}`);
  }

  // 4. Flowing Rivers across the map connect highland lakes down toward the coast
  assert.ok(STAGE2_RIVERS.length >= 5);
  for (const river of STAGE2_RIVERS) {
    const p0 = river.waypoints[0];
    const hydroAtStart = getStage2HydrologyAt(p0.x, p0.z);
    assert.equal(hydroAtStart.inWater, true, `Expected river waypoint (${p0.x}, ${p0.z}) of ${river.name} to be in water`);
  }
});



