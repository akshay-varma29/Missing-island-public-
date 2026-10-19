import * as THREE from 'three';
import {
  groundHeightAt,
  lavaChannelProximity,
  getStage2HydrologyAt,
  createAnimalPhysicsState,
  stepAnimalPhysics,
  evaluateDayNightCycle,
  computeSupplyBoxDriftPosition,
  InteractableItem,
  BoatBuildStage,
} from './rules';
import {
  buildBeachCrab,
  buildJungleLizard,
  buildJungleMonkey,
  buildWildBoar,
  buildBird,
  buildInteractableMesh,
  CastawayRig,
  WildlifeActor,
  BirdActor,
} from './worldBuilders';

const _dummyObj = new THREE.Object3D();

export type InteractablePlacementType =
  | 'coconut'
  | 'wood'
  | 'food'
  | 'rope'
  | 'campfire'
  | 'supply_box'
  | 'boat_site';

/**
 * Manages ground wildlife (crabs, lizards, monkeys, wild boars), soaring birds,
 * collectible survival resources, campfires, sea-drifted supply box, escape boat shipyard,
 * and castaway character articulation.
 */
export class ActorsAndPickupsSystem {
  public wildlifeActors: WildlifeActor[] = [];
  public birdActors: BirdActor[] = [];
  public interactables: InteractableItem[] = [];
  public interactableMeshes = new Map<string, THREE.Group>();

  private pickupPrototypeCache = new Map<InteractablePlacementType, THREE.Group>();

  constructor(
    private scene: THREE.Scene,
    private supplyBoxShorePos: { x: number; z: number },
    private boatSitePos: { x: number; z: number }
  ) {
    this.populateWildlifeAndBirds();
    this.populateInteractableResources();
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
    const guaranteedPlacements: Array<{
      id: string;
      type: InteractablePlacementType;
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
      {
        id: 'camp_beach',
        type: 'campfire',
        label: 'Beach Shelter Campfire (Requires 3 Wood)',
        x: 3.8,
        z: 62.5,
      },
      {
        id: 'camp_jungle',
        type: 'campfire',
        label: 'Jungle Ridge Campfire (Requires 3 Wood)',
        x: 0.0,
        z: 44.0,
      },
      {
        id: 'camp_volcano',
        type: 'campfire',
        label: 'Volcano Overlook Beacon (Requires 3 Wood)',
        x: -2.0,
        z: 28.5,
      },
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
    type: InteractablePlacementType,
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

    let mesh: THREE.Group;
    if (type === 'coconut' || type === 'wood' || type === 'food' || type === 'rope') {
      let proto = this.pickupPrototypeCache.get(type);
      if (!proto) {
        proto = buildInteractableMesh(type);
        this.pickupPrototypeCache.set(type, proto);
      }
      mesh = proto.clone(true);
    } else {
      mesh = buildInteractableMesh(type);
    }

    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.interactableMeshes.set(id, mesh);
  }

  public syncBoatShipyardMesh(boatMesh: THREE.Group, stage: BoatBuildStage): void {
    const s1 = boatMesh.getObjectByName('boat_stage_1');
    const s2 = boatMesh.getObjectByName('boat_stage_2');
    const s3 = boatMesh.getObjectByName('boat_stage_3');
    if (s1) s1.visible = stage >= 1;
    if (s2) s2.visible = stage >= 2;
    if (s3) s3.visible = stage >= 3;
  }

  public resetAll(): void {
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
  }

  public updateWildlifeAndBirds(params: {
    elapsed: number;
    dt: number;
    timeOfDay: number;
    gameState: 'title' | 'playing' | 'paused' | 'gameover';
    playerPos: THREE.Vector3;
    playerVel: THREE.Vector3;
    cullFocusX: number;
    cullFocusZ: number;
    isAerial: boolean;
    onPlayerAttacked: (damage: number, kind: string) => void;
  }): void {
    const {
      elapsed,
      dt,
      timeOfDay,
      gameState,
      playerPos,
      playerVel,
      cullFocusX,
      cullFocusZ,
      isAerial,
      onPlayerAttacked,
    } = params;

    const refX = playerPos.x;
    const refZ = playerPos.z;
    const wildlifeCullDistSq = isAerial ? 260 * 260 : 68 * 68;
    const pickupCullDistSq = isAerial ? 260 * 260 : 72 * 72;
    const pickupSpinDistSq = 48 * 48;

    const isNight = evaluateDayNightCycle(timeOfDay).phase === 'Night';
    const playerHorizSpeed = Math.hypot(playerVel.x, playerVel.z);
    const playerMoving = playerHorizSpeed > 0.35;
    const playerSprinting = playerHorizSpeed > 7.2;

    for (const actor of this.wildlifeActors) {
      if (actor.hostile && (actor.hp ?? 1) <= 0) {
        if (actor.group.visible) actor.group.visible = false;
        continue;
      }

      const dxHome = actor.physics.homeX - cullFocusX;
      const dzHome = actor.physics.homeZ - cullFocusZ;
      if (dxHome * dxHome + dzHome * dzHome > wildlifeCullDistSq) {
        if (actor.group.visible) actor.group.visible = false;
        continue;
      }
      if (!actor.group.visible) actor.group.visible = true;

      const stepRes = stepAnimalPhysics(actor.physics, {
        dt,
        elapsed,
        playerX: refX,
        playerY: playerPos.y,
        playerZ: refZ,
        playerMoving,
        playerSprinting,
        isNight,
        gameState,
      });

      const p = stepRes.state;
      actor.physics = p;
      actor.hp = p.hp;
      actor.attackCooldown = p.attackCooldown;
      actor.hitFlashTimer = p.hitFlashTimer;

      // Apply soft capsule collision separation if player overlaps creature
      if (stepRes.playerPushX !== 0 || stepRes.playerPushZ !== 0) {
        playerPos.x += stepRes.playerPushX;
        playerPos.z += stepRes.playerPushZ;
      }

      if (stepRes.attackedPlayer && stepRes.dealtDamage > 0) {
        onPlayerAttacked(stepRes.dealtDamage, actor.kind);
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

      // Squash-and-stretch impact reaction when struck
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

    // Birds soaring with aerodynamic banking roll and climb/glide pitch (distance-culled when far away)
    const birdsVisible = cullFocusX * cullFocusX + cullFocusZ * cullFocusZ < 320 * 320;
    for (const bird of this.birdActors) {
      if (!birdsVisible) {
        if (bird.group.visible) bird.group.visible = false;
        continue;
      }
      if (!bird.group.visible) bird.group.visible = true;

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
      const dx = item.x - cullFocusX;
      const dz = item.z - cullFocusZ;
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
}

/**
 * Animates the Castaway character rig across walking, running, crouching/bending,
 * swimming, and survival knife melee slash states.
 */
export function animateCastawayRig(params: {
  castaway: CastawayRig;
  dt: number;
  elapsedSimTime: number;
  walkCycleDist: number;
  isMoving: boolean;
  isSprinting: boolean;
  isSwimming: boolean;
  isBending: boolean;
  attackAnimTimer: number;
}): number {
  const {
    castaway,
    dt,
    elapsedSimTime,
    walkCycleDist,
    isMoving,
    isSprinting,
    isSwimming,
    isBending,
  } = params;
  let { attackAnimTimer } = params;

  const scaleDamp = 1 - Math.exp(-10 * dt);
  castaway.bodyGroup.scale.lerp(_dummyObj.scale.set(1, 1, 1), scaleDamp);

  if (isSwimming) {
    castaway.bodyGroup.rotation.x = THREE.MathUtils.lerp(
      castaway.bodyGroup.rotation.x,
      -0.65,
      scaleDamp
    );
    castaway.bodyGroup.position.y = THREE.MathUtils.lerp(
      castaway.bodyGroup.position.y,
      0,
      scaleDamp
    );
    const swimPhase = elapsedSimTime * 5.5;
    castaway.leftArm.rotation.x = Math.sin(swimPhase) * 1.1 - 0.8;
    castaway.rightArm.rotation.x = Math.cos(swimPhase) * 1.1 - 0.8;
    castaway.leftLeg.rotation.x = Math.sin(swimPhase * 1.3) * 0.45;
    castaway.rightLeg.rotation.x = -Math.sin(swimPhase * 1.3) * 0.45;
    return attackAnimTimer;
  }

  const baseLean = isBending
    ? -0.58
    : isMoving
    ? isSprinting
      ? -0.2
      : -0.08
    : 0;
  castaway.bodyGroup.rotation.x = THREE.MathUtils.lerp(
    castaway.bodyGroup.rotation.x,
    baseLean,
    scaleDamp
  );

  const bendOffsetY = isBending ? -0.26 : 0;

  if (isMoving) {
    const strideFreq = isBending ? 1.15 : isSprinting ? 1.85 : 1.45;
    const phase = walkCycleDist * strideFreq;
    const swingAmp = isBending ? 0.38 : isSprinting ? 0.85 : 0.58;
    castaway.leftLeg.rotation.x = Math.sin(phase) * swingAmp + (isBending ? 0.35 : 0);
    castaway.rightLeg.rotation.x = -Math.sin(phase) * swingAmp + (isBending ? 0.35 : 0);
    castaway.leftArm.rotation.x =
      -Math.sin(phase) * swingAmp * 0.85 + (isBending ? -0.55 : 0);
    castaway.rightArm.rotation.x =
      Math.sin(phase) * swingAmp * 0.85 + (isBending ? -0.55 : 0);
    castaway.bodyGroup.position.y =
      bendOffsetY + Math.abs(Math.cos(phase)) * (isBending ? 0.04 : 0.08);
  } else {
    const breath = Math.sin(elapsedSimTime * 2.2) * 0.04;
    const legBendTarget = isBending ? 0.38 : 0;
    const armReachTarget = isBending ? -0.68 : breath;

    castaway.leftLeg.rotation.x = THREE.MathUtils.lerp(
      castaway.leftLeg.rotation.x,
      legBendTarget,
      scaleDamp
    );
    castaway.rightLeg.rotation.x = THREE.MathUtils.lerp(
      castaway.rightLeg.rotation.x,
      legBendTarget,
      scaleDamp
    );
    castaway.leftArm.rotation.x = THREE.MathUtils.lerp(
      castaway.leftArm.rotation.x,
      armReachTarget,
      scaleDamp
    );
    castaway.rightArm.rotation.x = THREE.MathUtils.lerp(
      castaway.rightArm.rotation.x,
      isBending ? -0.68 : -breath,
      scaleDamp
    );
    castaway.bodyGroup.position.y = THREE.MathUtils.lerp(
      castaway.bodyGroup.position.y,
      bendOffsetY,
      scaleDamp
    );
  }

  if (attackAnimTimer > 0) {
    attackAnimTimer = Math.max(0, attackAnimTimer - dt);
    const t = 1 - attackAnimTimer / 0.34;
    const slashArc = Math.sin(t * Math.PI);
    castaway.rightArm.rotation.x = -1.45 * slashArc;
    castaway.rightArm.rotation.z = -0.45 * Math.cos(t * Math.PI);
  } else {
    castaway.rightArm.rotation.z = 0;
  }

  return attackAnimTimer;
}
