import { solveFrameFea } from './feaSolver';
import { segmentsInteriorCollide3D } from './memberGeometry';
import { cloneFrameModel } from './presets';
import { getProfileSpec, PROFILE_ORDER } from './profiles';
import type {
  FeaResult,
  FrameModel,
  OptimizationConstraints,
  OptimizationReport,
  OptimizationStep,
  ProfileId,
} from './types';

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Discover structurally meaningful candidate diagonal braces across coplanar nodes
 * (vertical facade planes or cantilever knee-braces) that are not already connected.
 */
function findCandidateBraces(model: FrameModel): { startId: string; endId: string; lengthMm: number }[] {
  const existing = new Set<string>();
  const adjacency = new Map<string, Set<string>>();

  for (const n of model.nodes) adjacency.set(n.id, new Set());
  for (const m of model.members) {
    existing.add(pairKey(m.startNodeId, m.endNodeId));
    adjacency.get(m.startNodeId)?.add(m.endNodeId);
    adjacency.get(m.endNodeId)?.add(m.startNodeId);
  }

  const candidates: { startId: string; endId: string; lengthMm: number }[] = [];
  const seen = new Set<string>();
  const nodes = model.nodes;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const key = pairKey(a.id, b.id);
      if (existing.has(key) || seen.has(key)) continue;

      const dx = Math.abs(a.position.x - b.position.x);
      const dy = Math.abs(a.position.y - b.position.y);
      const dz = Math.abs(a.position.z - b.position.z);
      const dist = Math.hypot(dx, dy, dz);

      // Must be diagonal (at least 2 non-zero axes), coplanar along one axis (to stay on frame faces),
      // and reasonable brace length (180 mm to 1800 mm)
      const nonZeroAxes = (dx > 20 ? 1 : 0) + (dy > 20 ? 1 : 0) + (dz > 20 ? 1 : 0);
      if (nonZeroAxes !== 2) continue;
      if (dy < 40) continue; // Focus on vertical stability / cantilever knee braces
      if (dist < 180 || dist > 1800) continue;

      const touchesSupport = a.support !== 'free' || b.support !== 'free';

      // Require nodes to share a corner/bay OR connect a base support diagonally across the same vertical facade
      const neighA = adjacency.get(a.id);
      const neighB = adjacency.get(b.id);
      if (!neighA || !neighB) continue;

      let validBay = touchesSupport;
      if (!validBay) {
        for (const n of neighA) {
          if (neighB.has(n)) {
            validBay = true;
            break;
          }
        }
      }
      // Or connected via 3-edge bay
      if (!validBay) {
        outer: for (const na of neighA) {
          const adjNa = adjacency.get(na);
          if (!adjNa) continue;
          for (const nb of neighB) {
            if (adjNa.has(nb)) {
              validBay = true;
              break outer;
            }
          }
        }
      }

      if (!validBay) continue;

      // Reject any candidate brace that crosses/passes through an existing member's interior (no 穿模)
      const nMapCheck = new Map(nodes.map((n) => [n.id, n]));
      let collides = false;
      for (const existingMem of model.members) {
        const m1 = nMapCheck.get(existingMem.startNodeId);
        const m2 = nMapCheck.get(existingMem.endNodeId);
        if (!m1 || !m2) continue;
        if (segmentsInteriorCollide3D(a.position, b.position, m1.position, m2.position, 28)) {
          collides = true;
          break;
        }
      }
      if (collides) continue;

      seen.add(key);
      candidates.push({ startId: a.id, endId: b.id, lengthMm: dist });
    }
  }

  // Prioritize braces anchored to fixed/pinned base supports first so sway paths reach ground directly
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  candidates.sort((c1, c2) => {
    const s1 = (nodeMap.get(c1.startId)?.support !== 'free' || nodeMap.get(c1.endId)?.support !== 'free') ? 0 : 1;
    const s2 = (nodeMap.get(c2.startId)?.support !== 'free' || nodeMap.get(c2.endId)?.support !== 'free') ? 0 : 1;
    if (s1 !== s2) return s1 - s2;
    return c1.lengthMm - c2.lengthMm;
  });

  return candidates;
}

function meetsConstraints(fea: FeaResult, constraints: OptimizationConstraints): boolean {
  return (
    fea.isStable &&
    fea.minSafetyFactor >= constraints.targetSafetyFactor &&
    fea.maxDisplacementMm <= constraints.maxDeflectionMm
  );
}

/**
 * Run structural optimization:
 *  - 'sizing': Discrete profile sizing (upgrade overloaded/high-strain members, downgrade over-designed members)
 *  - 'bracing': Topological diagonal bracing optimization (greedy compliance-per-mass gain)
 *  - 'combined': Topology bracing first to eliminate bending sway, followed by discrete section sizing
 */
export function runFrameOptimization(
  inputModel: FrameModel,
  constraints: OptimizationConstraints,
): OptimizationReport {
  const beforeModel = cloneFrameModel(inputModel);
  const workingModel = cloneFrameModel(inputModel);
  const feaOpts = {
    includeGravity: constraints.includeGravity,
    loadMultiplier: constraints.loadMultiplier,
    jointType: constraints.jointType ?? 'rigid',
    lateralPushN: constraints.lateralPushN ?? 0,
    curveSubdivisions: 4,
  };

  const allowedProfiles = PROFILE_ORDER.filter((p) => constraints.allowProfiles.includes(p));
  const profileRankList: ProfileId[] = allowedProfiles.length > 0 ? allowedProfiles : PROFILE_ORDER;

  const beforeFea = solveFrameFea(beforeModel, feaOpts);
  let currentFea = beforeFea;
  const history: OptimizationStep[] = [
    {
      iteration: 0,
      action: '初始方案评估',
      massKg: currentFea.totalMassKg,
      costCNY: currentFea.totalCostCNY,
      maxDisplacementMm: currentFea.maxDisplacementMm,
      minSafetyFactor: currentFea.minSafetyFactor,
      maxStressMPa: currentFea.maxStressMPa,
    },
  ];

  let iteration = 0;
  let addedBraceCount = 0;
  const originalProfiles = new Map<string, ProfileId>(
    beforeModel.members.map((m) => [m.id, m.profileId]),
  );

  // PHASE 1: Topological Diagonal Bracing Search ('bracing' or 'combined')
  if (constraints.strategy === 'bracing' || constraints.strategy === 'combined') {
    const braceProfile: ProfileId = profileRankList.includes('2020')
      ? '2020'
      : profileRankList[0];

    for (let bStep = 0; bStep < constraints.maxNewBraces; bStep++) {
      const candidates = findCandidateBraces(workingModel);
      if (candidates.length === 0) break;

      let bestCandidate: { startId: string; endId: string; lengthMm: number } | null = null;
      let bestFea: FeaResult | null = null;
      let bestScore = 0;

      const baseCompliance = Math.max(1e-6, currentFea.totalComplianceNmm);
      const baseDeflection = Math.max(1e-6, currentFea.maxDisplacementMm);
      const baseSway = Math.max(1e-6, currentFea.maxLateralSwayMm);
      const hasLateralPush = Math.abs(feaOpts.lateralPushN) > 1;

      // Evaluate top candidates (cap at 52 for < 100ms runtime)
      const evalList = candidates.slice(0, 52);
      for (const cand of evalList) {
        const testId = `OPT_B_${bStep + 1}`;
        workingModel.members.push({
          id: testId,
          startNodeId: cand.startId,
          endNodeId: cand.endId,
          profileId: braceProfile,
          isBrace: true,
          label: `优化斜撑 #${bStep + 1}`,
        });

        const testFea = solveFrameFea(workingModel, feaOpts);
        workingModel.members.pop();

        if (!testFea.isStable) continue;

        const complianceDrop = (baseCompliance - testFea.totalComplianceNmm) / baseCompliance;
        const deflectionDrop = (baseDeflection - testFea.maxDisplacementMm) / baseDeflection;
        const swayDrop = (baseSway - testFea.maxLateralSwayMm) / baseSway;
        const addedMass = (cand.lengthMm / 1000) * getProfileSpec(braceProfile).massPerMeterKg;

        // Weighted efficiency score: stiffness, deflection & anti-sway reduction per kg added
        const benefit = hasLateralPush
          ? 0.35 * complianceDrop + 0.25 * deflectionDrop + 0.4 * swayDrop
          : 0.5 * complianceDrop + 0.5 * deflectionDrop;
        const score = benefit / Math.max(0.15, addedMass);
        if (score > bestScore && (deflectionDrop > 0.04 || complianceDrop > 0.04 || swayDrop > 0.08)) {
          bestScore = score;
          bestCandidate = cand;
          bestFea = testFea;
        }
      }

      if (!bestCandidate || !bestFea) break;

      addedBraceCount++;
      iteration++;
      workingModel.members.push({
        id: `OPT_B_${addedBraceCount}`,
        startNodeId: bestCandidate.startId,
        endNodeId: bestCandidate.endId,
        profileId: braceProfile,
        isBrace: true,
        label: `拓扑斜撑 #${addedBraceCount}`,
      });
      currentFea = bestFea;

      history.push({
        iteration,
        action: `新增 ${braceProfile} 斜撑 (${bestCandidate.startId}-${bestCandidate.endId})`,
        massKg: currentFea.totalMassKg,
        costCNY: currentFea.totalCostCNY,
        maxDisplacementMm: currentFea.maxDisplacementMm,
        minSafetyFactor: currentFea.minSafetyFactor,
        maxStressMPa: currentFea.maxStressMPa,
      });

      // Stop adding braces early once deflection & sway are already very tight
      if (
        constraints.strategy === 'combined' &&
        currentFea.maxDisplacementMm <= constraints.maxDeflectionMm * 0.55 &&
        addedBraceCount >= 2
      ) {
        break;
      }
      if (
        constraints.strategy === 'bracing' &&
        hasLateralPush &&
        currentFea.maxLateralSwayMm <= 1.2 &&
        addedBraceCount >= 2
      ) {
        break;
      }
    }
  }

  // PHASE 2: Discrete Section Sizing Optimization ('sizing' or 'combined')
  if (constraints.strategy === 'sizing' || constraints.strategy === 'combined') {
    // 2A. Upgrade loop if constraints are currently violated
    let safetyGuard = 0;
    while (!meetsConstraints(currentFea, constraints) && safetyGuard < 24) {
      safetyGuard++;
      // Rank members by strain energy & stress utilization
      const ranked = [...workingModel.members]
        .filter((m) => !m.locked)
        .map((m) => {
          const r = currentFea.memberResults[m.id];
          const pIdx = profileRankList.indexOf(m.profileId);
          return {
            member: m,
            pIdx,
            score: r ? r.strainEnergyNmm + r.utilization * 5000 : 0,
          };
        })
        .filter((x) => x.pIdx >= 0 && x.pIdx < profileRankList.length - 1)
        .sort((a, b) => b.score - a.score);

      if (ranked.length === 0) break;

      const target = ranked[0];
      const nextProfile = profileRankList[target.pIdx + 1];
      target.member.profileId = nextProfile;
      currentFea = solveFrameFea(workingModel, feaOpts);
      iteration++;
      history.push({
        iteration,
        action: `升级 ${target.member.label ?? target.member.id} -> ${nextProfile}`,
        massKg: currentFea.totalMassKg,
        costCNY: currentFea.totalCostCNY,
        maxDisplacementMm: currentFea.maxDisplacementMm,
        minSafetyFactor: currentFea.minSafetyFactor,
        maxStressMPa: currentFea.maxStressMPa,
      });
    }

    // 2B. Greedy lightweighting pass: downgrade low-utilization members while strictly preserving constraints
    let improved = true;
    let passCount = 0;
    while (improved && passCount < 4) {
      improved = false;
      passCount++;

      // Sort from lowest stress utilization & largest current mass first
      const downgradeCandidates = [...workingModel.members]
        .filter((m) => !m.locked)
        .map((m) => {
          const r = currentFea.memberResults[m.id];
          const pIdx = profileRankList.indexOf(m.profileId);
          return {
            member: m,
            pIdx,
            util: r ? r.utilization : 1,
            mass: r ? r.massKg : 0,
          };
        })
        .filter((x) => x.pIdx > 0)
        .sort((a, b) => a.util - b.util || b.mass - a.mass);

      for (const cand of downgradeCandidates) {
        const oldProfile = cand.member.profileId;
        const lowerProfile = profileRankList[cand.pIdx - 1];
        // Ensure the lower profile is genuinely lighter
        if (
          getProfileSpec(lowerProfile).massPerMeterKg >=
          getProfileSpec(oldProfile).massPerMeterKg
        ) {
          continue;
        }

        cand.member.profileId = lowerProfile;
        const testFea = solveFrameFea(workingModel, feaOpts);

        if (meetsConstraints(testFea, constraints)) {
          currentFea = testFea;
          improved = true;
          iteration++;
          history.push({
            iteration,
            action: `减重降级 ${cand.member.label ?? cand.member.id} -> ${lowerProfile}`,
            massKg: currentFea.totalMassKg,
            costCNY: currentFea.totalCostCNY,
            maxDisplacementMm: currentFea.maxDisplacementMm,
            minSafetyFactor: currentFea.minSafetyFactor,
            maxStressMPa: currentFea.maxStressMPa,
          });
        } else {
          // Revert candidate
          cand.member.profileId = oldProfile;
        }
      }
    }
  }

  // Final full-resolution FEA solve for rendering
  const finalFea = solveFrameFea(workingModel, {
    includeGravity: constraints.includeGravity,
    loadMultiplier: constraints.loadMultiplier,
    jointType: constraints.jointType ?? 'rigid',
    lateralPushN: constraints.lateralPushN ?? 0,
    curveSubdivisions: 6,
  });

  let resizedMemberCount = 0;
  for (const m of workingModel.members) {
    const orig = originalProfiles.get(m.id);
    if (orig && orig !== m.profileId) resizedMemberCount++;
  }

  const pct = (after: number, before: number) =>
    before > 1e-6 ? ((after - before) / before) * 100 : 0;

  const massDeltaPct = pct(finalFea.totalMassKg, beforeFea.totalMassKg);
  const costDeltaPct = pct(finalFea.totalCostCNY, beforeFea.totalCostCNY);
  const deflectionDeltaPct = pct(finalFea.maxDisplacementMm, beforeFea.maxDisplacementMm);
  const stressDeltaPct = pct(finalFea.maxStressMPa, beforeFea.maxStressMPa);

  const summaryParts: string[] = [];
  if (addedBraceCount > 0) summaryParts.push(`新增 ${addedBraceCount} 根拓扑斜撑`);
  if (resizedMemberCount > 0) summaryParts.push(`调整 ${resizedMemberCount} 根型材截面`);
  if (summaryParts.length === 0) {
    summaryParts.push('当前结构在给定约束下已接近最优配置');
  } else {
    const massTxt =
      massDeltaPct <= 0
        ? `总重降低 ${Math.abs(massDeltaPct).toFixed(1)}%`
        : `总重微增 ${massDeltaPct.toFixed(1)}%`;
    const deflTxt =
      deflectionDeltaPct <= 0
        ? `最大位移降低 ${Math.abs(deflectionDeltaPct).toFixed(1)}%`
        : `最大位移变化 +${deflectionDeltaPct.toFixed(1)}%`;
    summaryParts.push(`${massTxt}，${deflTxt}`);
  }

  return {
    strategy: constraints.strategy,
    beforeModel,
    afterModel: workingModel,
    beforeFea,
    afterFea: finalFea,
    history,
    massDeltaPct,
    costDeltaPct,
    deflectionDeltaPct,
    stressDeltaPct,
    addedBraceCount,
    resizedMemberCount,
    summary: summaryParts.join('，'),
  };
}
