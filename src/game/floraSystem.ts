import * as THREE from 'three';
import {
  groundHeightAt,
  lavaChannelProximity,
  jungleTrailProximity,
  freshwaterStreamInfo,
  freshwaterStreamX,
  getStage2HydrologyAt,
} from './rules';
import {
  bakeGroupByMaterial,
  sculptOrganicGeometry,
  buildCoconutPalmTree,
  buildJungleTree,
  buildGrandCanopyTree,
  buildFallenLog,
  createMasterFernGeometry,
  createMasterBushGeometry,
  createMasterFallenLogGeometry,
  createMasterUnderstoryPalmGeometry,
  createMasterRockGeometry,
  buildVolumetricGodRays,
  buildBioluminescentMushroomCluster,
  getSharedEnvironmentMaterials,
} from './worldBuilders';

const _dummyObj = new THREE.Object3D();

/**
 * Builds and manages all static island flora, trees, boulders, shipwreck timber,
 * instanced jungle undergrowth, volumetric god rays, and bioluminescent mushrooms.
 */
export class FloraSystem {
  public godRaysGroup: THREE.Group | null = null;

  constructor(private scene: THREE.Scene, private isHeadless: boolean) {
    this.populateFloraAndBeachProps();
  }

  private populateFloraAndBeachProps(): void {
    const staticIslandGroup = new THREE.Group();
    const {
      bumpTex,
      wetBasaltMat,
      mossyRockMat,
      riverRockMat,
      rockMat,
      shellMat,
      timberMat,
      sailMat,
    } = getSharedEnvironmentMaterials();

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
      if (Math.hypot(x - -11, z - 40) < 5.8) continue; // Waterfall grotto clearing
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

    // 4. Stepped Basalt Cliff Ledges framing the Waterfall at (-12.5, 34) down to plunge pool (-11, 40)
    const cliffLedges = [
      { x: -14.2, y: 10.8, z: 33.0, sx: 3.2, sy: 3.8, sz: 2.8, r: 0.2 },
      { x: -10.2, y: 10.5, z: 33.2, sx: 3.2, sy: 3.6, sz: 2.6, r: -0.25 },
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
    bridgeLog.rotation.y = 0.08;
    staticIslandGroup.add(bridgeLog);

    // River Stepping Stones across the stream at z=44.5 and z=50.8
    for (const sz of [44.5, 50.8]) {
      const sxCenter = freshwaterStreamX(sz);
      for (const offset of [-0.65, 0.65]) {
        const sx = sxCenter + offset;
        const stoneGeo = sculptOrganicGeometry(
          new THREE.DodecahedronGeometry(0.38, 1),
          0.15,
          3.2,
          sx + sz
        );
        stoneGeo.scale(1.2, 0.5, 1.1);
        const stone = new THREE.Mesh(stoneGeo, riverRockMat);
        const sy = groundHeightAt(sx, sz) + 0.14;
        stone.position.set(sx, sy, sz);
        staticIslandGroup.add(stone);
      }
    }

    // 5. Sculpted Coastal Basalt Boulders, Conch Shells & Shipwreck Debris on the Southern Beach
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
    const keel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 0.34), timberMat);
    keel.position.set(0, 0.18, 0);
    wreckGroup.add(keel);

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

    const tornSailGeo = sculptOrganicGeometry(
      new THREE.PlaneGeometry(2.4, 1.8, 8, 8),
      0.12,
      2.5,
      4.2
    );
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

    // 6. Bioluminescent mushroom clusters along fallen logs and damp riverbanks (merged into staticIslandGroup)
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
      staticIslandGroup.add(shroom);
    });

    // Merge all static hero trees, rocks, shells, shipwreck, and mushrooms by shared material into minimal draw calls
    const bakedStaticEnvironment = bakeGroupByMaterial(staticIslandGroup, true, true);
    this.scene.add(bakedStaticEnvironment);

    // =========================================================================
    // 7. INSTANCED MESHES FOR DENSE JUNGLE UNDERGROWTH (5 GPU Draw Calls)
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
      if (Math.hypot(x - 0, z - 44) < 3.2) continue;
      if (jungleTrailProximity(x, z) > 0.8) continue;

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
      if (Math.hypot(x - -11, z - 40) < 4.8) continue;

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
      new THREE.Color(0x343a32),
    ];

    let rockIdx = 0;
    for (let zi = 34; zi <= 66; zi += 0.72) {
      const streamX = freshwaterStreamX(zi);
      const side = Math.floor(zi * 2) % 2 === 0 ? 1 : -1;
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

    // 8. Volumetric God Rays (baked into 1 single draw call)
    this.godRaysGroup = buildVolumetricGodRays();
    this.scene.add(this.godRaysGroup);
  }
}
