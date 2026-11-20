import test from 'node:test';
import assert from 'node:assert/strict';
import { solveFrameFea } from './feaSolver';
import { ALUMINUM_6063_T5, getProfileSpec } from './profiles';
import { buildCantileverPreset, buildWorkbenchPreset } from './presets';
import { runFrameOptimization } from './optimizer';
import { optimizeCuttingStock } from './cuttingStock';
import { runConstrainedAutoDesign } from './autoDesigner';
import { analyzeMemberConnection, summarizeFrameDiagonalHardware } from './braceConnection';
import { canAutoMergeNode, deleteNodeWithAutoMerge } from './frameEditing';
import { computeTrimmedMemberEndpoints, segmentsInteriorCollide3D } from './memberGeometry';
import { computeSwaySummary } from './swayAnalysis';
import type { FrameModel } from './types';

test('3D FEA solver matches analytical Euler-Bernoulli cantilever beam deflection & stress', () => {
  // Single horizontal 4040 cantilever beam: L = 1000 mm, P = 500 N downward at free tip
  const L = 1000;
  const P = 500;
  const spec = getProfileSpec('4040');
  const E = ALUMINUM_6063_T5.youngsModulusMPa;

  const model: FrameModel = {
    id: 'test-cantilever',
    name: 'Test Cantilever',
    description: 'Analytical verification',
    nodes: [
      { id: 'A', position: { x: 0, y: 0, z: 0 }, support: 'fixed', load: { fx: 0, fy: 0, fz: 0 } },
      { id: 'B', position: { x: L, y: 0, z: 0 }, support: 'free', load: { fx: 0, fy: -P, fz: 0 } },
    ],
    members: [{ id: 'M1', startNodeId: 'A', endNodeId: 'B', profileId: '4040' }],
  };

  const res = solveFrameFea(model, { includeGravity: false, loadMultiplier: 1 });
  assert.equal(res.isStable, true);

  // Analytical tip deflection: delta = P * L^3 / (3 * E * Ix)
  const expectedDelta = (P * L * L * L) / (3 * E * spec.ixMm4);
  const actualDelta = Math.abs(res.nodeDisplacements['B'].dy);
  assert.ok(
    Math.abs(actualDelta - expectedDelta) / expectedDelta < 0.005,
    `Expected deflection ${expectedDelta.toFixed(4)} mm, got ${actualDelta.toFixed(4)} mm`,
  );

  // Analytical max bending stress at fixed root: sigma = (P * L) / Wx
  const expectedSigma = (P * L) / spec.wxMm3;
  const actualBendingSigma = res.memberResults['M1'].bendingStressMPa;
  assert.ok(
    Math.abs(actualBendingSigma - expectedSigma) / expectedSigma < 0.005,
    `Expected stress ${expectedSigma.toFixed(3)} MPa, got ${actualBendingSigma.toFixed(3)} MPa`,
  );

  // Vertical reaction must balance applied load P = 500 N
  assert.ok(
    Math.abs(res.reactionForceSumY - P) < 0.5,
    `Expected reaction ${P} N, got ${res.reactionForceSumY.toFixed(3)} N`,
  );
});

test('3D FEA detects unsupported unstable mechanism cleanly without NaN', () => {
  const unstable: FrameModel = {
    id: 'unstable',
    name: 'Floating Bar',
    description: 'No supports',
    nodes: [
      { id: 'A', position: { x: 0, y: 500, z: 0 }, support: 'free', load: { fx: 0, fy: -100, fz: 0 } },
      { id: 'B', position: { x: 500, y: 500, z: 0 }, support: 'free', load: { fx: 0, fy: 0, fz: 0 } },
    ],
    members: [{ id: 'M1', startNodeId: 'A', endNodeId: 'B', profileId: '3030' }],
  };

  const res = solveFrameFea(unstable);
  assert.equal(res.isStable, false);
  assert.equal(res.status, 'unstable');
  assert.ok(Number.isFinite(res.maxDisplacementMm));
});

test('Workbench preset solves stably and vertical reactions balance applied loads + gravity', () => {
  const wb = buildWorkbenchPreset(1200, 600, 750, '4040');
  const res = solveFrameFea(wb, { includeGravity: true, loadMultiplier: 1 });
  assert.equal(res.isStable, true);
  assert.ok(res.maxDisplacementMm > 0 && res.maxDisplacementMm < 10);
  assert.ok(res.minSafetyFactor > 2.0);

  // Sum of downward applied nodal loads + gravity
  const externalDownY = wb.nodes.reduce((sum, n) => sum + Math.max(0, -n.load.fy), 0);
  const gravityN = res.totalMassKg * ALUMINUM_6063_T5.gravityMps2;
  const expectedReaction = externalDownY + gravityN;
  assert.ok(
    Math.abs(res.reactionForceSumY - expectedReaction) < 2.0,
    `Reaction ${res.reactionForceSumY.toFixed(1)} vs expected ${expectedReaction.toFixed(1)}`,
  );
});

test('Diagonal bracing & combined optimization dramatically reduce deflection on cantilever stand', () => {
  const cantilever = buildCantileverPreset(900, 500, 800, '3030');
  const report = runFrameOptimization(cantilever, {
    strategy: 'combined',
    targetSafetyFactor: 2.5,
    maxDeflectionMm: 1.2,
    maxNewBraces: 4,
    allowProfiles: ['2020', '2040', '3030', '4040', '4080'],
    includeGravity: true,
    loadMultiplier: 1.0,
  });

  assert.equal(report.afterFea.isStable, true);
  assert.ok(report.addedBraceCount >= 1, 'Should add at least one diagonal brace');
  assert.ok(
    report.afterFea.maxDisplacementMm < report.beforeFea.maxDisplacementMm,
    `Deflection should drop: before ${report.beforeFea.maxDisplacementMm.toFixed(2)} -> after ${report.afterFea.maxDisplacementMm.toFixed(2)}`,
  );
  assert.ok(report.afterFea.minSafetyFactor >= 2.5);
  assert.ok(report.history.length >= 2);
});

test('1D FFD cutting stock bin-packer packs all cuts within 3000mm stock bars with kerf', () => {
  const wb = buildWorkbenchPreset(1200, 600, 750, '4040');
  const bom = optimizeCuttingStock(wb, { stockLengthMm: 3000, kerfMm: 3 });

  assert.ok(bom.profileRows.length >= 1);
  assert.ok(bom.stockPlans.length >= 1);
  assert.ok(bom.overallUtilizationPct > 50 && bom.overallUtilizationPct <= 100);

  let packedCount = 0;
  for (const plan of bom.stockPlans) {
    assert.ok(
      plan.usedMm + plan.kerfMm <= plan.stockLengthMm,
      `Bar ${plan.barIndex} exceeded stock length`,
    );
    assert.equal(plan.usedMm + plan.kerfMm + plan.wasteMm, plan.stockLengthMm);
    packedCount += plan.cuts.length;
  }
  assert.equal(packedCount, wb.members.length);
});

test('Deleting an intermediate degree-2 node automatically merges the two connected extrusions', () => {
  const chain: FrameModel = {
    id: 'chain',
    name: '3-Node Beam',
    description: 'Auto-merge test',
    nodes: [
      { id: 'A', position: { x: 0, y: 0, z: 0 }, support: 'fixed', load: { fx: 0, fy: 0, fz: 0 } },
      { id: 'B', position: { x: 500, y: 0, z: 0 }, support: 'free', load: { fx: 0, fy: -100, fz: 0 } },
      { id: 'C', position: { x: 1200, y: 0, z: 0 }, support: 'fixed', load: { fx: 0, fy: 0, fz: 0 } },
    ],
    members: [
      { id: 'M1', startNodeId: 'A', endNodeId: 'B', profileId: '3030', label: '左段' },
      { id: 'M2', startNodeId: 'B', endNodeId: 'C', profileId: '4040', label: '右段' },
    ],
  };

  const check = canAutoMergeNode(chain, 'B');
  assert.equal(check.canMerge, true);
  assert.equal(check.mergedLengthMm, 1200);

  const res = deleteNodeWithAutoMerge(chain, 'B');
  assert.equal(res.merged, true);
  assert.equal(res.model.nodes.length, 2);
  assert.equal(res.model.members.length, 1);
  assert.equal(res.model.members[0].startNodeId, 'A');
  assert.equal(res.model.members[0].endNodeId, 'C');
  // Preserves stronger profile (4040 over 3030)
  assert.equal(res.model.members[0].profileId, '4040');
});

test('Pinned joints sway severely under lateral push and diagonal bracing stops the sway', () => {
  const wb = buildWorkbenchPreset(1200, 600, 750, '4040');
  const rigidFea = solveFrameFea(wb, { jointType: 'rigid', lateralPushN: 200 });
  const semiFea = solveFrameFea(wb, { jointType: 'semi-rigid', lateralPushN: 200 });
  const pinnedFea = solveFrameFea(wb, { jointType: 'pinned', lateralPushN: 200 });

  assert.equal(rigidFea.isStable, true);
  assert.equal(semiFea.isStable, true);
  assert.equal(pinnedFea.isStable, true);
  assert.ok(
    pinnedFea.maxLateralSwayMm > semiFea.maxLateralSwayMm &&
      semiFea.maxLateralSwayMm > rigidFea.maxLateralSwayMm,
    `Expected pinned (${pinnedFea.maxLateralSwayMm.toFixed(2)}) > semi (${semiFea.maxLateralSwayMm.toFixed(2)}) > rigid (${rigidFea.maxLateralSwayMm.toFixed(2)})`,
  );

  // Adding diagonal braces under pinned joints eliminates lateral wobble by > 85%
  const braced = runFrameOptimization(wb, {
    strategy: 'bracing',
    targetSafetyFactor: 2.5,
    maxDeflectionMm: 2.0,
    maxNewBraces: 4,
    allowProfiles: ['2020', '3030', '4040'],
    includeGravity: true,
    loadMultiplier: 1.0,
    jointType: 'pinned',
    lateralPushN: 200,
  });

  assert.ok(braced.addedBraceCount >= 1);
  assert.ok(
    braced.afterFea.maxLateralSwayMm < pinnedFea.maxLateralSwayMm * 0.15,
    `Expected >85% sway reduction: before ${pinnedFea.maxLateralSwayMm.toFixed(2)} -> after ${braced.afterFea.maxLateralSwayMm.toFixed(2)}`,
  );
});

test('All 5 aluminum joint crafts produce monotonic sway ordering and accurate tangential shear forces', () => {
  const wb2020 = buildWorkbenchPreset(1200, 600, 750, '2020');
  const pinned = solveFrameFea(wb2020, { jointType: 'pinned', lateralPushN: 150 });
  const builtin = solveFrameFea(wb2020, { jointType: 'builtin', lateralPushN: 150 });
  const lBracket = solveFrameFea(wb2020, { jointType: 'semi-rigid', lateralPushN: 150 });
  const gusset = solveFrameFea(wb2020, { jointType: 'gusset-plate', lateralPushN: 150 });
  const rigid = solveFrameFea(wb2020, { jointType: 'rigid', lateralPushN: 150 });

  assert.ok(pinned.maxLateralSwayMm > builtin.maxLateralSwayMm);
  assert.ok(builtin.maxLateralSwayMm > lBracket.maxLateralSwayMm);
  assert.ok(lBracket.maxLateralSwayMm > gusset.maxLateralSwayMm);
  assert.ok(gusset.maxLateralSwayMm > rigid.maxLateralSwayMm);
  assert.ok(lBracket.maxShearForceN > 50, 'Should report positive tangential joint shear force');
  assert.equal(builtin.jointShearCapacityN, 450);
  assert.equal(gusset.jointShearCapacityN, 2200);
});

test('Static sway summary computes accurate tilt angle, drift ratio, and ±sway elevation envelope', () => {
  const wb2020 = buildWorkbenchPreset(1200, 600, 750, '2020');
  const fea = solveFrameFea(wb2020, { jointType: 'semi-rigid', lateralPushN: 200 });
  const sway = computeSwaySummary(wb2020, fea);

  assert.equal(sway.isStable, true);
  assert.ok(sway.maxSwayMm > 5, `Expected noticeable sway > 5mm, got ${sway.maxSwayMm.toFixed(2)}`);
  assert.equal(sway.severity, 'severe');
  assert.ok(sway.maxSwayNodeId !== null);
  assert.ok(sway.tiltAngleDeg > 0.3);
  assert.ok(sway.driftDenominator !== null && sway.driftDenominator > 0);
  assert.equal(sway.elevation.members.length, wb2020.members.length);
  assert.ok(sway.elevation.members.some((m) => m.isColumn));
  assert.ok(sway.elevation.peakNodeBase && sway.elevation.peakNodePlus && sway.elevation.peakNodeMinus);
});

test('Constrained auto-designer preserves locked extrusions and generates 3 balanced schemes (material/stability/brackets)', () => {
  const wb = buildWorkbenchPreset(1200, 600, 750, '2020');
  // Lock 2 top beams in place with fixed 2020 profile
  wb.members[12].locked = true;
  wb.members[13].locked = true;
  const lockedIds = [wb.members[12].id, wb.members[13].id];

  const result = runConstrainedAutoDesign(wb, {
    weights: { material: 3, stability: 4, brackets: 3 },
    targetSafetyFactor: 2.5,
    maxSwayMm: 2.0,
    maxDeflectionMm: 1.5,
    allowProfiles: ['2020', '2040', '3030', '4040', '4080'],
    includeGravity: true,
    loadMultiplier: 1.0,
    jointType: 'semi-rigid',
    lateralPushN: 150,
  });

  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.lockedMemberIds, lockedIds);

  for (const cand of result.candidates) {
    assert.equal(cand.fea.isStable, true);
    assert.ok(cand.bracketCount > 0);
    assert.ok(cand.totalCostCNY > 0);
    assert.ok(cand.score >= 1 && cand.score <= 100);
    // Verify locked extrusions stayed 100% unchanged
    for (const lid of lockedIds) {
      const orig = wb.members.find((m) => m.id === lid)!;
      const after = cand.model.members.find((m) => m.id === lid)!;
      assert.ok(after, `Locked member ${lid} must remain present`);
      assert.equal(after.profileId, orig.profileId);
      assert.equal(after.startNodeId, orig.startNodeId);
      assert.equal(after.endNodeId, orig.endNodeId);
      assert.equal(after.locked, true);
    }
  }

  const eco = result.candidates.find((c) => c.id === 'eco-brackets')!;
  const rigid = result.candidates.find((c) => c.id === 'ultra-rigid')!;
  assert.ok(
    eco.bracketCount <= rigid.bracketCount,
    `Eco scheme (${eco.bracketCount} brackets) should not use more brackets than rigid scheme (${rigid.bracketCount})`,
  );
  assert.ok(
    rigid.maxSwayMm < result.beforeFea.maxLateralSwayMm,
    `Rigid scheme sway (${rigid.maxSwayMm.toFixed(2)}mm) should be much lower than initial (${result.beforeFea.maxLateralSwayMm.toFixed(2)}mm)`,
  );
});

test('Auto-designer completes grounded columns and tie rails around floating locked extrusions', () => {
  const floating: FrameModel = {
    id: 'floating-top',
    name: 'Locked Floating Rail',
    description: 'User fixed 2 top rails at y=750mm',
    nodes: [
      { id: 'T1', position: { x: -500, y: 750, z: -250 }, support: 'free', load: { fx: 0, fy: -150, fz: 0 } },
      { id: 'T2', position: { x: 500, y: 750, z: -250 }, support: 'free', load: { fx: 0, fy: -150, fz: 0 } },
      { id: 'T3', position: { x: 500, y: 750, z: 250 }, support: 'free', load: { fx: 0, fy: -150, fz: 0 } },
      { id: 'T4', position: { x: -500, y: 750, z: 250 }, support: 'free', load: { fx: 0, fy: -150, fz: 0 } },
    ],
    members: [
      { id: 'LOCKED_BACK', startNodeId: 'T1', endNodeId: 'T2', profileId: '3030', locked: true, label: '固定后横梁' },
      { id: 'LOCKED_FRONT', startNodeId: 'T4', endNodeId: 'T3', profileId: '3030', locked: true, label: '固定前横梁' },
    ],
  };

  const result = runConstrainedAutoDesign(floating, {
    weights: { material: 3, stability: 4, brackets: 3 },
    targetSafetyFactor: 2.5,
    maxSwayMm: 2.0,
    maxDeflectionMm: 2.0,
    allowProfiles: ['2020', '2040', '3030', '4040'],
    includeGravity: true,
    loadMultiplier: 1.0,
    jointType: 'semi-rigid',
    lateralPushN: 150,
  });

  const best = result.candidates[0];
  assert.equal(best.fea.isStable, true, 'Auto-completed frame must be stably grounded');
  assert.ok(best.model.nodes.some((n) => n.support === 'fixed' && n.position.y === 0));
  assert.ok(best.model.members.length >= 10, 'Should auto-generate columns, lower rails & braces');
  // Both locked 3030 top rails remain untouched
  assert.equal(best.model.members.find((m) => m.id === 'LOCKED_BACK')?.profileId, '3030');
  assert.equal(best.model.members.find((m) => m.id === 'LOCKED_FRONT')?.profileId, '3030');
});

test('Diagonal connection analyzer distinguishes 45° miter knee braces from arbitrary-angle swivel-hinge diagonals & itemizes BOM hardware', () => {
  const wb = buildWorkbenchPreset(1200, 600, 750);
  const res = runConstrainedAutoDesign(wb, {
    weights: { material: 3, stability: 4, brackets: 3 },
    targetSafetyFactor: 2.5,
    maxSwayMm: 2.0,
    maxDeflectionMm: 2.0,
    allowProfiles: ['2020', '2040', '3030', '4040'],
    includeGravity: true,
    loadMultiplier: 1.0,
    jointType: 'semi-rigid',
    lateralPushN: 150,
  });

  const eco = res.candidates.find((c) => c.id === 'eco-brackets')!;
  const balanced = res.candidates.find((c) => c.id === 'balanced')!;
  const rigid = res.candidates.find((c) => c.id === 'ultra-rigid')!;

  // 1. Eco scheme has ZERO diagonal extrusions and uses external 5-hole gusset plates
  const ecoDiag = summarizeFrameDiagonalHardware(eco.model);
  assert.equal(ecoDiag.guides.length, 0, 'Eco no-miter scheme should have 0 diagonal extrusions');
  assert.equal(eco.recommendedJointType, 'gusset-plate');
  const ecoBom = optimizeCuttingStock(eco.model, { jointType: eco.recommendedJointType });
  assert.ok(ecoBom.hardwareRows.some((r) => r.id === 'HW-GUSSET'));

  // 2. Balanced scheme creates genuine 45° × 45° short knee braces + 45° bevel blocks
  const balDiag = summarizeFrameDiagonalHardware(balanced.model);
  assert.ok(balDiag.miter45MemberCount >= 2, 'Balanced scheme should add at least 2 standard 45° knee braces');
  for (const g of balDiag.guides) {
    assert.equal(g.craft, 'miter-45');
    assert.ok(Math.abs(g.angleStartDeg - 45) <= 2, `Start miter angle should be ~45°, got ${g.angleStartDeg}`);
    assert.ok(Math.abs(g.angleEndDeg - 45) <= 2, `End miter angle should be ~45°, got ${g.angleEndDeg}`);
  }
  const balBom = optimizeCuttingStock(balanced.model, { jointType: balanced.recommendedJointType });
  assert.ok(balBom.hardwareRows.some((r) => r.id === 'HW-MITER45' && r.quantity === balDiag.miter45BracketCount));

  // 3. Rigid full-bay scheme uses arbitrary-angle braces paired with swivel hinges (90° straight cut)
  const rigidDiag = summarizeFrameDiagonalHardware(rigid.model);
  assert.ok(rigidDiag.swivelHingeMemberCount >= 1, 'Rigid full-bay scheme should include swivel-hinge diagonals');
  const rigidBom = optimizeCuttingStock(rigid.model, { jointType: rigid.recommendedJointType });
  assert.ok(rigidBom.hardwareRows.some((r) => r.id === 'HW-SWIVEL' && r.quantity === rigidDiag.swivelHingeCount));
  const sampleSwivel = rigid.model.members.find((m) => m.isBrace)!;
  const gSwivel = analyzeMemberConnection(rigid.model, sampleSwivel);
  assert.equal(gSwivel.craft, 'swivel-hinge');
  assert.ok(gSwivel.cutSpec.includes('90°平切'));
});

test('Butt-joint trimming prevents corner clipping & all 3 auto-design schemes have zero interior 3D collisions', () => {
  const wb = buildWorkbenchPreset(1200, 600, 750);

  // Horizontal X-rail meeting 2020 vertical column must pull back by 10mm (column half-width)
  const topFrontLeft = wb.members.find((m) => m.label === '上前主梁-左')!;
  const trimX = computeTrimmedMemberEndpoints(wb, topFrontLeft)!;
  assert.ok(trimX.startTrimMm >= 9.9, `X-rail must trim back at column face, got ${trimX.startTrimMm}`);
  assert.equal(trimX.capStart, false, 'Interior column joint must not render buried end-cap');

  // Transverse Z-crossbar meeting X-rail must pull back by X-rail half-width (10mm)
  const wbNodeMap = new Map(wb.nodes.map((n) => [n.id, n]));
  const midCross = wb.members.find((m) => {
    const a = wbNodeMap.get(m.startNodeId)!.position;
    const b = wbNodeMap.get(m.endNodeId)!.position;
    return Math.abs(a.x) < 10 && Math.abs(b.x) < 10 && Math.abs(b.z - a.z) > 200;
  })!;
  const trimZ = computeTrimmedMemberEndpoints(wb, midCross)!;
  assert.ok(trimZ.startTrimMm >= 9.9 && trimZ.endTrimMm >= 9.9, 'Z-crossbar must trim back at both X-rails');

  // Run auto-design and verify ZERO interior 3D member-member collisions across ALL 3 schemes
  const res = runConstrainedAutoDesign(wb, {
    weights: { material: 3, stability: 4, brackets: 3 },
    targetSafetyFactor: 2.5,
    maxSwayMm: 2.0,
    maxDeflectionMm: 2.0,
    allowProfiles: ['2020', '2040', '3030', '4040'],
    includeGravity: true,
    loadMultiplier: 1.0,
    jointType: 'semi-rigid',
    lateralPushN: 150,
  });

  for (const cand of res.candidates) {
    const nMap = new Map(cand.model.nodes.map((n) => [n.id, n]));
    const mems = cand.model.members;
    for (let i = 0; i < mems.length; i++) {
      for (let j = i + 1; j < mems.length; j++) {
        const a1 = nMap.get(mems[i].startNodeId)!.position;
        const a2 = nMap.get(mems[i].endNodeId)!.position;
        const b1 = nMap.get(mems[j].startNodeId)!.position;
        const b2 = nMap.get(mems[j].endNodeId)!.position;
        assert.equal(
          segmentsInteriorCollide3D(a1, a2, b1, b2, 22),
          false,
          `Scheme ${cand.id} has interior collision between ${mems[i].id} and ${mems[j].id}`,
        );
      }
    }
  }

  // Verify non-angled eco scheme keeps columns at least as wide as supported horizontal beams
  const eco = res.candidates.find((c) => c.id === 'eco-brackets')!;
  const ecoNodeMap = new Map(eco.model.nodes.map((n) => [n.id, n]));
  for (const m of eco.model.members) {
    const p1 = ecoNodeMap.get(m.startNodeId)!.position;
    const p2 = ecoNodeMap.get(m.endNodeId)!.position;
    const isHoriz = Math.abs(p2.y - p1.y) < 20;
    if (!isHoriz) continue;
    const beamW = getProfileSpec(m.profileId).widthMm;
    for (const endId of [m.startNodeId, m.endNodeId]) {
      for (const col of eco.model.members) {
        if (col.id === m.id) continue;
        if (col.startNodeId !== endId && col.endNodeId !== endId) continue;
        const c1 = ecoNodeMap.get(col.startNodeId)!.position;
        const c2 = ecoNodeMap.get(col.endNodeId)!.position;
        const isVert = Math.abs(c2.y - c1.y) > Math.max(Math.abs(c2.x - c1.x), Math.abs(c2.z - c1.z));
        if (!isVert) continue;
        assert.ok(
          getProfileSpec(col.profileId).widthMm >= beamW,
          `Column ${col.id} (${col.profileId}) must be >= beam ${m.id} (${m.profileId}) width`,
        );
      }
    }
  }
});




