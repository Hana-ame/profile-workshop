import { PROFILE_ORDER } from './profiles';
import type { FrameMember, FrameModel } from './types';

export interface DeleteNodeResult {
  model: FrameModel;
  merged: boolean;
  mergedMember?: FrameMember;
  removedMemberCount: number;
  message: string;
}

/**
 * Find all members connected to a given node.
 */
export function getNodeIncidentMembers(model: FrameModel, nodeId: string): FrameMember[] {
  return model.members.filter((m) => m.startNodeId === nodeId || m.endNodeId === nodeId);
}

/**
 * Check whether deleting a node will automatically merge two incident beams into one continuous beam.
 */
export function canAutoMergeNode(model: FrameModel, nodeId: string): {
  canMerge: boolean;
  memberA?: FrameMember;
  memberB?: FrameMember;
  neighborAId?: string;
  neighborBId?: string;
  mergedLengthMm?: number;
} {
  const incident = getNodeIncidentMembers(model, nodeId);
  if (incident.length !== 2) return { canMerge: false };

  const [mA, mB] = incident;
  const neighborAId = mA.startNodeId === nodeId ? mA.endNodeId : mA.startNodeId;
  const neighborBId = mB.startNodeId === nodeId ? mB.endNodeId : mB.startNodeId;

  if (neighborAId === neighborBId) return { canMerge: false };

  // Prevent creating a duplicate edge if A and B are already directly connected
  const alreadyConnected = model.members.some(
    (m) =>
      (m.startNodeId === neighborAId && m.endNodeId === neighborBId) ||
      (m.startNodeId === neighborBId && m.endNodeId === neighborAId),
  );
  if (alreadyConnected) return { canMerge: false };

  const nA = model.nodes.find((n) => n.id === neighborAId);
  const nB = model.nodes.find((n) => n.id === neighborBId);
  const mergedLengthMm =
    nA && nB
      ? Math.round(
          Math.hypot(
            nB.position.x - nA.position.x,
            nB.position.y - nA.position.y,
            nB.position.z - nA.position.z,
          ),
        )
      : undefined;

  return {
    canMerge: true,
    memberA: mA,
    memberB: mB,
    neighborAId,
    neighborBId,
    mergedLengthMm,
  };
}

/**
 * Delete a node from the aluminum frame.
 * If the node connects exactly 2 members (A—N and N—B) without an existing direct A—B edge,
 * automatically merges the two members into a single continuous member A—B using the stronger profile.
 */
export function deleteNodeWithAutoMerge(model: FrameModel, nodeId: string): DeleteNodeResult {
  const targetNode = model.nodes.find((n) => n.id === nodeId);
  if (!targetNode) {
    return {
      model,
      merged: false,
      removedMemberCount: 0,
      message: '未找到指定节点',
    };
  }

  const mergeInfo = canAutoMergeNode(model, nodeId);
  const remainingNodes = model.nodes.filter((n) => n.id !== nodeId);

  if (mergeInfo.canMerge && mergeInfo.memberA && mergeInfo.memberB && mergeInfo.neighborAId && mergeInfo.neighborBId) {
    const rankA = PROFILE_ORDER.indexOf(mergeInfo.memberA.profileId);
    const rankB = PROFILE_ORDER.indexOf(mergeInfo.memberB.profileId);
    const mergedProfile = rankA >= rankB ? mergeInfo.memberA.profileId : mergeInfo.memberB.profileId;

    const mergedMember: FrameMember = {
      id: `M_MRG_${mergeInfo.neighborAId}_${mergeInfo.neighborBId}`,
      startNodeId: mergeInfo.neighborAId,
      endNodeId: mergeInfo.neighborBId,
      profileId: mergedProfile,
      isBrace: Boolean(mergeInfo.memberA.isBrace && mergeInfo.memberB.isBrace),
      label: `合并连续梁 (${mergeInfo.neighborAId}-${mergeInfo.neighborBId})`,
    };

    const remainingMembers = model.members.filter(
      (m) => m.id !== mergeInfo.memberA!.id && m.id !== mergeInfo.memberB!.id,
    );
    remainingMembers.push(mergedMember);

    return {
      model: {
        ...model,
        nodes: remainingNodes,
        members: remainingMembers,
      },
      merged: true,
      mergedMember,
      removedMemberCount: 2,
      message: `已删除节点 ${nodeId}，相邻两根型材已自动合并为 1 根 ${mergedProfile} 连续型材 (${mergeInfo.mergedLengthMm ?? 0} mm)`,
    };
  }

  const incidentIds = new Set(getNodeIncidentMembers(model, nodeId).map((m) => m.id));
  const remainingMembers = model.members.filter((m) => !incidentIds.has(m.id));

  return {
    model: {
      ...model,
      nodes: remainingNodes,
      members: remainingMembers,
    },
    merged: false,
    removedMemberCount: incidentIds.size,
    message: `已删除节点 ${nodeId} 及关联的 ${incidentIds.size} 根型材`,
  };
}
