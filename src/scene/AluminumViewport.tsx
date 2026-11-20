import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { analyzeMemberConnection } from '../engine/braceConnection';
import {
  computeTrimmedMemberEndpoints,
  getMemberHalfExtentAlongDir,
} from '../engine/memberGeometry';
import { getProfileSpec, PROFILE_ORDER } from '../engine/profiles';
import type {
  CadTool,
  CameraPreset,
  ColorMode,
  FeaResult,
  FinishType,
  FrameModel,
  JointType,
  ProfileId,
  Vec3,
} from '../engine/types';
import {
  axialForceToColor,
  createBrushedAluminumTexture,
  createContactShadowTexture,
  createCornerBracketGeometry,
  createExternalGussetPlateGeometry,
  createUnitProfileGeometry,
  MM_TO_WORLD,
  stressUtilizationToColor,
} from './extrusionGeometry';

export interface AluminumViewportProps {
  model: FrameModel;
  fea: FeaResult;
  colorMode: ColorMode;
  finish: FinishType;
  deformScale: number;
  jointType: JointType;
  lateralPushN: number;
  showSwayEnvelope: boolean;
  cadTool: CadTool;
  workplaneY: number;
  selectedMemberId: string | null;
  selectedNodeId: string | null;
  drawStartNodeId: string | null;
  cameraPresetTrigger: { preset: CameraPreset; seq: number };
  onSelectMember: (memberId: string | null) => void;
  onSelectNode: (nodeId: string | null) => void;
  onClickNodeForTool: (nodeId: string) => void;
  onClickWorkplane: (posMm: Vec3) => void;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();

/** Procedural high-DPI static 3D callout sprite (zero external assets, SRGBColorSpace) */
function createSwayCalloutSprite(
  title: string,
  subtitle: string,
  accentHex: string,
  maxAnisotropy: number,
): { sprite: THREE.Sprite; texture: THREE.CanvasTexture; material: THREE.SpriteMaterial } {
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Clean technical callout card with crisp border and bottom pointer triangle
  const x = 10;
  const y = 10;
  const w = 400;
  const h = 92;
  const r = 12;

  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + w / 2 + 12, y + h);
  ctx.lineTo(x + w / 2, y + h + 16);
  ctx.lineTo(x + w / 2 - 12, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Accent header text (e.g. "晃动 ±18.2 mm")
  ctx.fillStyle = accentHex;
  ctx.font = '700 32px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, canvas.width / 2, y + 34);

  // Secondary engineering spec text (e.g. "倾角 1.39° · 侧移比 H/41")
  ctx.fillStyle = '#475569';
  ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, sans-serif';
  ctx.fillText(subtitle, canvas.width / 2, y + 70);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.46, 0.14, 1);
  sprite.renderOrder = 20;
  return { sprite, texture, material };
}

export function AluminumViewport(props: AluminumViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  // Store latest props & callbacks in ref so Three.js scene mounts ONCE and never resets camera
  const propsRef = useRef(props);
  propsRef.current = props;

  const sceneApiRef = useRef<{
    rebuildFrame: () => void;
    setCameraPreset: (preset: CameraPreset) => void;
    requestRender: () => void;
  } | null>(null);

  // 1. Mount Three.js WebGLRenderer, studio environment, lighting, controls ONCE
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Software WebGL detection via GPU renderer string (never UA)
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param) ?? '');
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('data-testid', 'aluminum-3d-canvas');
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

    // Scene setup: crisp architectural studio drafting background
    const scene = new THREE.Scene();
    const bgColor = new THREE.Color('#EEF2F6');
    scene.background = bgColor;
    scene.fog = new THREE.Fog('#EEF2F6', 4.5, 11.5);

    // Mandatory RoomEnvironment reflections for realistic brushed aluminum PBR
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    // Camera & OrbitControls
    const width = container.clientWidth || 1280;
    const height = container.clientHeight || 720;
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.02, 40);
    camera.position.set(1.65, 1.25, 1.85);
    renderer.setSize(width, height);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.42, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 0.45;
    controls.maxDistance = 8.0;
    controls.update();

    // Warm/cool 3-point engineering studio lighting rig
    const hemiLight = new THREE.HemisphereLight('#F0F6FF', '#C8D3E0', 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#FFF7EB', 1.65);
    keyLight.position.set(2.8, 4.2, 2.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    const d = 1.6;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.015;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#CBE0FF', 0.75);
    rimLight.position.set(-2.6, 2.0, -2.4);
    scene.add(rimLight);

    // Ground drafting studio floor (offset slightly below y=0 to avoid coplanar Z-fighting)
    const floorGeo = new THREE.PlaneGeometry(18, 18);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#E6ECF2',
      roughness: 0.88,
      metalness: 0.02,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.022;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Engineering metric drafting grid (100 mm minor divisions, 500 mm major)
    const mainGrid = new THREE.GridHelper(3.2, 32, '#94A3B8', '#CBD5E1');
    mainGrid.position.y = -0.02;
    scene.add(mainGrid);

    // Active workplane highlight grid for CAD node/beam drafting
    const workplaneGrid = new THREE.GridHelper(2.0, 20, '#3B82F6', '#93C5FD');
    workplaneGrid.visible = false;
    scene.add(workplaneGrid);

    // Hover snap ring + live draw preview line
    const snapRingGeo = new THREE.RingGeometry(0.016, 0.026, 24);
    snapRingGeo.rotateX(-Math.PI / 2);
    const snapRingMat = new THREE.MeshBasicMaterial({
      color: '#2563EB',
      side: THREE.DoubleSide,
    });
    const snapRing = new THREE.Mesh(snapRingGeo, snapRingMat);
    snapRing.visible = false;
    scene.add(snapRing);

    const previewLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const previewLineMat = new THREE.LineBasicMaterial({
      color: '#1D4ED8',
    });
    const previewLine = new THREE.Line(previewLineGeo, previewLineMat);
    previewLine.visible = false;
    scene.add(previewLine);

    // Shared procedural geometries & textures (allocated ONCE)
    const brushedTex = createBrushedAluminumTexture(renderer.capabilities.getMaxAnisotropy());
    const shadowTex = createContactShadowTexture();
    const profileGeos = new Map<ProfileId, THREE.BufferGeometry>();
    for (const pid of PROFILE_ORDER) {
      profileGeos.set(pid, createUnitProfileGeometry(pid));
    }
    const bracketGeo = createCornerBracketGeometry();
    const gussetPlateGeo = createExternalGussetPlateGeometry();
    const nodeGeo = new THREE.SphereGeometry(0.016, 16, 12);
    const footPadGeo = new THREE.CylinderGeometry(0.026, 0.03, 0.01, 20);
    const footStemGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.014, 12);
    const footNutGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.005, 6);
    const shadowPlaneGeo = new THREE.PlaneGeometry(0.14, 0.14);
    shadowPlaneGeo.rotateX(-Math.PI / 2);
    const arrowShaftGeo = new THREE.CylinderGeometry(0.005, 0.005, 1, 10);
    const arrowConeGeo = new THREE.ConeGeometry(0.014, 0.042, 12);
    const supportConeGeo = new THREE.ConeGeometry(0.028, 0.026, 4);

    // Shared materials
    const bracketMat = new THREE.MeshStandardMaterial({
      color: '#CBD5E1',
      metalness: 0.72,
      roughness: 0.38,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: '#1E293B',
      roughness: 0.85,
      metalness: 0.05,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: '#94A3B8',
      metalness: 0.88,
      roughness: 0.22,
    });
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    });
    const endCapMat = new THREE.MeshStandardMaterial({
      color: '#1E293B',
      roughness: 0.72,
      metalness: 0.08,
    });
    const lockCollarMat = new THREE.MeshStandardMaterial({
      color: '#D97706',
      roughness: 0.32,
      metalness: 0.65,
      emissive: '#B45309',
      emissiveIntensity: 0.2,
    });
    // Real diagonal extrusion hardware: 45° bevel gusset block & arbitrary-angle swivel hinge
    const miterBlockGeo = new THREE.BoxGeometry(0.026, 0.022, 0.026);
    const hingeBodyGeo = new THREE.BoxGeometry(0.024, 0.028, 0.024);
    const hingePinGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.032, 12);
    const miterBlockMat = new THREE.MeshStandardMaterial({
      color: '#0F766E',
      roughness: 0.34,
      metalness: 0.68,
    });
    const hingeMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.32,
      metalness: 0.78,
    });
    const forceMat = new THREE.MeshStandardMaterial({
      color: '#DC2626',
      roughness: 0.35,
      metalness: 0.15,
    });
    const fixedSupportMat = new THREE.MeshStandardMaterial({
      color: '#1D4ED8',
      roughness: 0.38,
      metalness: 0.35,
    });
    const pinnedSupportMat = new THREE.MeshStandardMaterial({
      color: '#0D9488',
      roughness: 0.4,
      metalness: 0.3,
    });
    const ghostLineMat = new THREE.LineBasicMaterial({
      color: '#64748B',
      transparent: true,
      opacity: 0.38,
    });

    // Dynamic frame group container
    const frameGroup = new THREE.Group();
    scene.add(frameGroup);
    let interactiveTargets: THREE.Object3D[] = [];
    let dynamicDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    // Smooth camera preset transition state
    let camTransition: {
      active: boolean;
      targetPos: THREE.Vector3;
      targetLook: THREE.Vector3;
    } = {
      active: false,
      targetPos: new THREE.Vector3(),
      targetLook: new THREE.Vector3(),
    };

    // Coalesced on-demand render loop with software-WebGL afterDraw pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        frameId = window.setTimeout(cb, 50);
        return;
      }
      gl.flush();
      let polls = 0;
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        polls++;
        const status = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED && polls < 16) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 65);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    let lastFrameTime = performance.now();

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
        lastFrameTime = now;

        // Advance smooth camera preset transition
        let keepMoving = false;
        if (camTransition.active) {
          if (isSoftwareGl) {
            camera.position.copy(camTransition.targetPos);
            controls.target.copy(camTransition.targetLook);
            camTransition.active = false;
          } else {
            const alpha = 1 - Math.exp(-8 * dt);
            camera.position.lerp(camTransition.targetPos, alpha);
            controls.target.lerp(camTransition.targetLook, alpha);
            if (
              camera.position.distanceTo(camTransition.targetPos) < 0.004 &&
              controls.target.distanceTo(camTransition.targetLook) < 0.004
            ) {
              camera.position.copy(camTransition.targetPos);
              controls.target.copy(camTransition.targetLook);
              camTransition.active = false;
            } else {
              keepMoving = true;
            }
          }
        }

        const damped = controls.update();
        if (damped && !isSoftwareGl) keepMoving = true;

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (keepMoving || renderDirty) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    controls.addEventListener('start', () => {
      camTransition.active = false;
    });
    controls.addEventListener('change', () => {
      requestRender();
    });

    // Helper: clear previous frame meshes & dispose per-build materials/geometries
    const clearFrameGroup = () => {
      while (frameGroup.children.length > 0) {
        frameGroup.remove(frameGroup.children[0]);
      }
      for (const item of dynamicDisposables) {
        item.dispose();
      }
      dynamicDisposables = [];
      interactiveTargets = [];
    };

    // Rebuild 3D aluminum extrusion assembly from model + FEA
    const rebuildFrame = () => {
      clearFrameGroup();
      const {
        model,
        fea,
        colorMode,
        finish,
        deformScale,
        jointType,
        lateralPushN,
        showSwayEnvelope,
        cadTool,
        workplaneY,
        selectedMemberId,
        selectedNodeId,
        drawStartNodeId,
      } = propsRef.current;

      // Update workplane helper visibility in drawing modes
      const showWorkplane = cadTool === 'add-node' || cadTool === 'draw-beam';
      workplaneGrid.visible = showWorkplane;
      workplaneGrid.position.y = workplaneY * MM_TO_WORLD;

      const nodeMap = new Map(model.nodes.map((n) => [n.id, n]));

      // Find max axial force for axial color normalization
      let maxAbsAxial = 1;
      for (const mr of Object.values(fea.memberResults)) {
        maxAbsAxial = Math.max(maxAbsAxial, Math.abs(mr.axialForceN));
      }

      const showDeformed = deformScale > 0.01 && fea.isStable;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const n of model.nodes) {
        minX = Math.min(minX, n.position.x); maxX = Math.max(maxX, n.position.x);
        minY = Math.min(minY, n.position.y); maxY = Math.max(maxY, n.position.y);
        minZ = Math.min(minZ, n.position.z); maxZ = Math.max(maxZ, n.position.z);
      }
      const modelSpanMm = Number.isFinite(minX)
        ? Math.max(450, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ))
        : 1000;
      const maxVisualDispMm = Math.min(280, modelSpanMm * 0.22);
      const effectiveDeformScale =
        showDeformed && fea.maxDisplacementMm > 1e-4
          ? Math.min(deformScale, maxVisualDispMm / fea.maxDisplacementMm)
          : deformScale;

      // Build members (extruded T-slot aluminum + end-caps + deformed visualization)
      for (const m of model.members) {
        const n1 = nodeMap.get(m.startNodeId);
        const n2 = nodeMap.get(m.endNodeId);
        if (!n1 || !n2) continue;

        const mRes = fea.memberResults[m.id];
        const isSelected = selectedMemberId === m.id;
        const spec = getProfileSpec(m.profileId);

        // Determine material color based on active visualization mode
        let baseHex = finish === 'silver' ? '#D4DCE6' : '#2C333F';
        let metalness = finish === 'silver' ? 0.78 : 0.48;
        let roughness = finish === 'silver' ? 0.28 : 0.42;

        if (colorMode === 'stress' && mRes && fea.isStable) {
          stressUtilizationToColor(mRes.utilization, _color);
          baseHex = '#' + _color.getHexString();
          metalness = 0.22;
          roughness = 0.44;
        } else if (colorMode === 'axial' && mRes && fea.isStable) {
          axialForceToColor(mRes.axialForceN, maxAbsAxial, _color);
          baseHex = '#' + _color.getHexString();
          metalness = 0.24;
          roughness = 0.42;
        }

        const beamMat = new THREE.MeshStandardMaterial({
          color: baseHex,
          metalness,
          roughness,
          bumpMap: brushedTex,
          bumpScale: 0.0008,
          emissive: isSelected ? '#1D4ED8' : m.isBrace && colorMode === 'material' ? '#0F172A' : '#000000',
          emissiveIntensity: isSelected ? 0.35 : m.isBrace && colorMode === 'material' ? 0.06 : 0,
        });
        dynamicDisposables.push(beamMat);

        // Compute right-handed beam orientation so strong axis (heightMm) stands vertically on horizontal beams
        const computeBeamQuat = (dirUnit: THREE.Vector3, outQuat: THREE.Quaternion) => {
          const basisMat = new THREE.Matrix4();
          if (Math.abs(dirUnit.y) > 0.98) {
            const xAxis = new THREE.Vector3(1, 0, 0);
            const zAxis = new THREE.Vector3().crossVectors(xAxis, dirUnit).normalize();
            basisMat.makeBasis(xAxis, dirUnit, zAxis);
          } else {
            const worldUp = new THREE.Vector3(0, 1, 0);
            const xAxis = new THREE.Vector3().crossVectors(dirUnit, worldUp).normalize();
            const zAxis = new THREE.Vector3().crossVectors(xAxis, dirUnit).normalize();
            basisMat.makeBasis(xAxis, dirUnit, zAxis);
          }
          outQuat.setFromRotationMatrix(basisMat);
          return outQuat;
        };

        const trimGeom = computeTrimmedMemberEndpoints(model, m);

        if (showDeformed && mRes && mRes.basePoints.length >= 2) {
          // 1. Render subtle undeformed wireframe reference (skipped if static sway envelope draws dashed reference)
          if (!showSwayEnvelope || fea.maxLateralSwayMm <= 0.05) {
            const ghostPts = [
              new THREE.Vector3(
                n1.position.x * MM_TO_WORLD,
                n1.position.y * MM_TO_WORLD,
                n1.position.z * MM_TO_WORLD,
              ),
              new THREE.Vector3(
                n2.position.x * MM_TO_WORLD,
                n2.position.y * MM_TO_WORLD,
                n2.position.z * MM_TO_WORLD,
              ),
            ];
            const ghostGeo = new THREE.BufferGeometry().setFromPoints(ghostPts);
            dynamicDisposables.push(ghostGeo);
            frameGroup.add(new THREE.Line(ghostGeo, ghostLineMat));
          }

          // 2. Render deformed Hermite curve with butt-joint end pullbacks so beams never clip through columns
          const curvePts = mRes.basePoints.map((bp, idx) => {
            const dp = mRes.curvePoints[idx] ?? { x: 0, y: 0, z: 0 };
            return new THREE.Vector3(
              (bp.x + dp.x * effectiveDeformScale) * MM_TO_WORLD,
              (bp.y + dp.y * effectiveDeformScale) * MM_TO_WORLD,
              (bp.z + dp.z * effectiveDeformScale) * MM_TO_WORLD,
            );
          });
          if (trimGeom && curvePts.length >= 2) {
            const startDir = new THREE.Vector3().subVectors(curvePts[1], curvePts[0]);
            const sLen = startDir.length();
            if (sLen > 1e-4 && trimGeom.startTrimMm > 0) {
              const pull = Math.min(sLen * 0.82, trimGeom.startTrimMm * MM_TO_WORLD);
              curvePts[0].addScaledVector(startDir.divideScalar(sLen), pull);
            }
            const last = curvePts.length - 1;
            const endDir = new THREE.Vector3().subVectors(curvePts[last - 1], curvePts[last]);
            const eLen = endDir.length();
            if (eLen > 1e-4 && trimGeom.endTrimMm > 0) {
              const pull = Math.min(eLen * 0.82, trimGeom.endTrimMm * MM_TO_WORLD);
              curvePts[last].addScaledVector(endDir.divideScalar(eLen), pull);
            }
          }

          const profileGeo = profileGeos.get(m.profileId)!;
          for (let s = 0; s < curvePts.length - 1; s++) {
            const a = curvePts[s];
            const b = curvePts[s + 1];
            _dir.subVectors(b, a);
            const segLen = _dir.length();
            if (segLen < 1e-5) continue;
            _mid.addVectors(a, b).multiplyScalar(0.5);
            computeBeamQuat(_dir.clone().normalize(), _quat);

            const segMesh = new THREE.Mesh(profileGeo, beamMat);
            segMesh.position.copy(_mid);
            segMesh.quaternion.copy(_quat);
            // Slight interior seam seal only between internal curve segments (not past trimmed ends)
            const seamScale = s > 0 && s < curvePts.length - 2 ? 1.03 : 1.01;
            segMesh.scale.set(1, segLen * seamScale, 1);
            segMesh.castShadow = !isSoftwareGl;
            segMesh.receiveShadow = true;
            segMesh.userData = { kind: 'member', id: m.id };
            frameGroup.add(segMesh);
            interactiveTargets.push(segMesh);
          }
        } else {
          // Undeformed crisp extruded T-slot aluminum beam with exact butt-joint pullback (zero clipping)
          const sp = trimGeom ? trimGeom.startPos : n1.position;
          const ep = trimGeom ? trimGeom.endPos : n2.position;
          _p1.set(sp.x * MM_TO_WORLD, sp.y * MM_TO_WORLD, sp.z * MM_TO_WORLD);
          _p2.set(ep.x * MM_TO_WORLD, ep.y * MM_TO_WORLD, ep.z * MM_TO_WORLD);
          _dir.subVectors(_p2, _p1);
          const len = _dir.length();
          if (len < 1e-4) continue;
          _mid.addVectors(_p1, _p2).multiplyScalar(0.5);
          computeBeamQuat(_dir.clone().normalize(), _quat);

          const beamMesh = new THREE.Mesh(profileGeos.get(m.profileId)!, beamMat);
          beamMesh.position.copy(_mid);
          beamMesh.quaternion.copy(_quat);
          beamMesh.scale.set(1, len, 1);
          beamMesh.castShadow = !isSoftwareGl;
          beamMesh.receiveShadow = true;
          beamMesh.userData = { kind: 'member', id: m.id };
          frameGroup.add(beamMesh);
          interactiveTargets.push(beamMesh);

          // Render dark nylon end-cap ONLY on genuine open free ends (never buried inside joints)
          if (trimGeom && (trimGeom.capStart || trimGeom.capEnd)) {
            const capGeo = new THREE.BoxGeometry(
              spec.widthMm * MM_TO_WORLD * 1.005,
              0.0025,
              spec.heightMm * MM_TO_WORLD * 1.005,
            );
            dynamicDisposables.push(capGeo);
            if (trimGeom.capStart) {
              const cap1 = new THREE.Mesh(capGeo, endCapMat);
              cap1.position.copy(_p1);
              cap1.quaternion.copy(_quat);
              frameGroup.add(cap1);
            }
            if (trimGeom.capEnd) {
              const cap2 = new THREE.Mesh(capGeo, endCapMat);
              cap2.position.copy(_p2);
              cap2.quaternion.copy(_quat);
              frameGroup.add(cap2);
            }
          }
        }

        // Visual mechanical lock clamp band at midpoint for user-pinned extrusions (member.locked === true)
        if (m.locked) {
          let collarPos: THREE.Vector3;
          let collarDir: THREE.Vector3;
          if (showDeformed && mRes && mRes.basePoints.length >= 2) {
            const midIdx = Math.floor(mRes.basePoints.length / 2);
            const bp = mRes.basePoints[midIdx];
            const dp = mRes.curvePoints[midIdx] ?? { x: 0, y: 0, z: 0 };
            collarPos = new THREE.Vector3(
              (bp.x + dp.x * effectiveDeformScale) * MM_TO_WORLD,
              (bp.y + dp.y * effectiveDeformScale) * MM_TO_WORLD,
              (bp.z + dp.z * effectiveDeformScale) * MM_TO_WORLD,
            );
            const prevIdx = Math.max(0, midIdx - 1);
            const nextIdx = Math.min(mRes.basePoints.length - 1, midIdx + 1);
            const bA = mRes.basePoints[prevIdx];
            const dA = mRes.curvePoints[prevIdx] ?? { x: 0, y: 0, z: 0 };
            const bB = mRes.basePoints[nextIdx];
            const dB = mRes.curvePoints[nextIdx] ?? { x: 0, y: 0, z: 0 };
            collarDir = new THREE.Vector3(
              (bB.x + dB.x * effectiveDeformScale) - (bA.x + dA.x * effectiveDeformScale),
              (bB.y + dB.y * effectiveDeformScale) - (bA.y + dA.y * effectiveDeformScale),
              (bB.z + dB.z * effectiveDeformScale) - (bA.z + dA.z * effectiveDeformScale),
            ).normalize();
          } else {
            collarPos = new THREE.Vector3(
              ((n1.position.x + n2.position.x) * 0.5) * MM_TO_WORLD,
              ((n1.position.y + n2.position.y) * 0.5) * MM_TO_WORLD,
              ((n1.position.z + n2.position.z) * 0.5) * MM_TO_WORLD,
            );
            collarDir = new THREE.Vector3(
              n2.position.x - n1.position.x,
              n2.position.y - n1.position.y,
              n2.position.z - n1.position.z,
            ).normalize();
          }
          if (collarDir.lengthSq() > 1e-6) {
            const collarGeo = new THREE.BoxGeometry(
              spec.widthMm * MM_TO_WORLD * 1.38,
              0.036,
              spec.heightMm * MM_TO_WORLD * 1.38,
            );
            dynamicDisposables.push(collarGeo);
            const collarMesh = new THREE.Mesh(collarGeo, lockCollarMat);
            collarMesh.position.copy(collarPos);
            collarMesh.quaternion.setFromUnitVectors(_up, collarDir);
            collarMesh.userData = { kind: 'member', id: m.id };
            frameGroup.add(collarMesh);
            interactiveTargets.push(collarMesh);
          }
        }
      }

      // Static 3D Sway Envelope Visualization (100% static: no distracting animation)
      // Renders dashed undeformed frame + symmetric (-Δ) sway ghost + column sweep ribbons + peak 3D dimension callout
      if (showSwayEnvelope && showDeformed && fea.isStable && fea.maxLateralSwayMm > 0.05) {
        const swayAccentHex =
          fea.maxLateralSwayMm > 5
            ? '#DC2626'
            : fea.maxLateralSwayMm > 2
              ? '#D97706'
              : '#059669';

        const refDashMat = new THREE.LineDashedMaterial({
          color: '#64748B',
          dashSize: 0.022,
          gapSize: 0.014,
          transparent: true,
          opacity: 0.65,
        });
        const mirrorDashMat = new THREE.LineDashedMaterial({
          color: '#D97706',
          dashSize: 0.028,
          gapSize: 0.016,
          transparent: true,
          opacity: 0.72,
        });
        const ribbonMat = new THREE.MeshBasicMaterial({
          color: swayAccentHex,
          transparent: true,
          opacity: 0.14,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const dimLineMat = new THREE.LineBasicMaterial({ color: swayAccentHex });
        const stemLineMat = new THREE.LineBasicMaterial({
          color: '#D97706',
          transparent: true,
          opacity: 0.75,
        });
        dynamicDisposables.push(refDashMat, mirrorDashMat, ribbonMat, dimLineMat, stemLineMat);

        for (const m of model.members) {
          const n1 = nodeMap.get(m.startNodeId);
          const n2 = nodeMap.get(m.endNodeId);
          const mRes = fea.memberResults[m.id];
          if (!n1 || !n2 || !mRes || mRes.basePoints.length < 2) continue;

          // 1. Dashed undeformed reference centerline
          const baseLinePts = [
            new THREE.Vector3(
              n1.position.x * MM_TO_WORLD,
              n1.position.y * MM_TO_WORLD,
              n1.position.z * MM_TO_WORLD,
            ),
            new THREE.Vector3(
              n2.position.x * MM_TO_WORLD,
              n2.position.y * MM_TO_WORLD,
              n2.position.z * MM_TO_WORLD,
            ),
          ];
          const refGeo = new THREE.BufferGeometry().setFromPoints(baseLinePts);
          dynamicDisposables.push(refGeo);
          const refLine = new THREE.Line(refGeo, refDashMat);
          refLine.computeLineDistances();
          frameGroup.add(refLine);

          // 2. Symmetric reverse (-ΔX / -ΔZ) sway dashed envelope
          const plusPts: THREE.Vector3[] = [];
          const minusPts: THREE.Vector3[] = [];
          for (let i = 0; i < mRes.basePoints.length; i++) {
            const bp = mRes.basePoints[i];
            const dp = mRes.curvePoints[i] ?? { x: 0, y: 0, z: 0 };
            plusPts.push(
              new THREE.Vector3(
                (bp.x + dp.x * effectiveDeformScale) * MM_TO_WORLD,
                (bp.y + dp.y * effectiveDeformScale) * MM_TO_WORLD,
                (bp.z + dp.z * effectiveDeformScale) * MM_TO_WORLD,
              ),
            );
            minusPts.push(
              new THREE.Vector3(
                (bp.x - dp.x * effectiveDeformScale) * MM_TO_WORLD,
                (bp.y + dp.y * effectiveDeformScale) * MM_TO_WORLD,
                (bp.z - dp.z * effectiveDeformScale) * MM_TO_WORLD,
              ),
            );
          }

          const mirrorGeo = new THREE.BufferGeometry().setFromPoints(minusPts);
          dynamicDisposables.push(mirrorGeo);
          const mirrorLine = new THREE.Line(mirrorGeo, mirrorDashMat);
          mirrorLine.computeLineDistances();
          frameGroup.add(mirrorLine);

          // 3. Translucent static sway sweep fan on vertical columns
          const absDx = Math.abs(n2.position.x - n1.position.x);
          const absDy = Math.abs(n2.position.y - n1.position.y);
          const absDz = Math.abs(n2.position.z - n1.position.z);
          if (absDy > absDx && absDy > absDz) {
            const segCount = plusPts.length - 1;
            const positions = new Float32Array(segCount * 6 * 3);
            let ptr = 0;
            for (let s = 0; s < segCount; s++) {
              const p0 = plusPts[s];
              const p1 = plusPts[s + 1];
              const m0 = minusPts[s];
              const m1 = minusPts[s + 1];
              // Triangle 1: p0, m0, p1
              positions[ptr++] = p0.x; positions[ptr++] = p0.y; positions[ptr++] = p0.z;
              positions[ptr++] = m0.x; positions[ptr++] = m0.y; positions[ptr++] = m0.z;
              positions[ptr++] = p1.x; positions[ptr++] = p1.y; positions[ptr++] = p1.z;
              // Triangle 2: m0, m1, p1
              positions[ptr++] = m0.x; positions[ptr++] = m0.y; positions[ptr++] = m0.z;
              positions[ptr++] = m1.x; positions[ptr++] = m1.y; positions[ptr++] = m1.z;
              positions[ptr++] = p1.x; positions[ptr++] = p1.y; positions[ptr++] = p1.z;
            }
            const ribbonGeo = new THREE.BufferGeometry();
            ribbonGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            dynamicDisposables.push(ribbonGeo);
            frameGroup.add(new THREE.Mesh(ribbonGeo, ribbonMat));
          }
        }

        // 4. Peak sway node 3D dimension span + procedural floating callout sprite + corner drift stems
        let peakNode: FrameModel['nodes'][number] | null = null;
        let peakSwayMm = 0;
        let peakDisp = { dx: 0, dy: 0, dz: 0 };
        for (const n of model.nodes) {
          const d = fea.nodeDisplacements[n.id];
          if (!d) continue;
          const hMm = Math.hypot(d.dx, d.dz);
          if (hMm > peakSwayMm) {
            peakSwayMm = hMm;
            peakNode = n;
            peakDisp = d;
          }
        }

        // Subtle horizontal offset stems on other significantly swaying top nodes
        for (const n of model.nodes) {
          const d = fea.nodeDisplacements[n.id];
          if (!d) continue;
          const hMm = Math.hypot(d.dx, d.dz);
          if (hMm < peakSwayMm * 0.35 || hMm < 0.05) continue;
          const restPt = new THREE.Vector3(
            n.position.x * MM_TO_WORLD,
            n.position.y * MM_TO_WORLD,
            n.position.z * MM_TO_WORLD,
          );
          const plusPt = new THREE.Vector3(
            (n.position.x + d.dx * effectiveDeformScale) * MM_TO_WORLD,
            (n.position.y + d.dy * effectiveDeformScale) * MM_TO_WORLD,
            (n.position.z + d.dz * effectiveDeformScale) * MM_TO_WORLD,
          );
          const stemGeo = new THREE.BufferGeometry().setFromPoints([restPt, plusPt]);
          dynamicDisposables.push(stemGeo);
          frameGroup.add(new THREE.Line(stemGeo, stemLineMat));
        }

        if (peakNode && peakSwayMm > 0.05) {
          const liftY = 0.045;
          const pBase = new THREE.Vector3(
            peakNode.position.x * MM_TO_WORLD,
            peakNode.position.y * MM_TO_WORLD + liftY,
            peakNode.position.z * MM_TO_WORLD,
          );
          const pPlus = new THREE.Vector3(
            (peakNode.position.x + peakDisp.dx * effectiveDeformScale) * MM_TO_WORLD,
            (peakNode.position.y + peakDisp.dy * effectiveDeformScale) * MM_TO_WORLD + liftY,
            (peakNode.position.z + peakDisp.dz * effectiveDeformScale) * MM_TO_WORLD,
          );
          const pMinus = new THREE.Vector3(
            (peakNode.position.x - peakDisp.dx * effectiveDeformScale) * MM_TO_WORLD,
            (peakNode.position.y + peakDisp.dy * effectiveDeformScale) * MM_TO_WORLD + liftY,
            (peakNode.position.z - peakDisp.dz * effectiveDeformScale) * MM_TO_WORLD,
          );

          // Main ±span dimension line + vertical tick caps at -Δ, 0, +Δ
          const tickH = 0.022;
          const dimSegPts = [
            pMinus, pPlus,
            pMinus.clone().add(new THREE.Vector3(0, -tickH, 0)),
            pMinus.clone().add(new THREE.Vector3(0, tickH, 0)),
            pBase.clone().add(new THREE.Vector3(0, -tickH * 0.7, 0)),
            pBase.clone().add(new THREE.Vector3(0, tickH * 0.7, 0)),
            pPlus.clone().add(new THREE.Vector3(0, -tickH, 0)),
            pPlus.clone().add(new THREE.Vector3(0, tickH, 0)),
          ];
          const dimGeo = new THREE.BufferGeometry().setFromPoints(dimSegPts);
          dynamicDisposables.push(dimGeo);
          frameGroup.add(new THREE.LineSegments(dimGeo, dimLineMat));

          // Procedural high-DPI 3D callout sprite placed cleanly above frame top (with CAD leader if peak node is lower)
          const heightMm = Math.max(100, peakNode.position.y - (Number.isFinite(minY) ? minY : 0));
          const tiltDeg = (Math.atan2(peakSwayMm, heightMm) * 180) / Math.PI;
          const driftDenom = Math.max(1, Math.round(heightMm / peakSwayMm));
          const { sprite, texture, material } = createSwayCalloutSprite(
            `晃动 ±${peakSwayMm.toFixed(1)} mm`,
            `倾角 ${tiltDeg.toFixed(2)}° · 侧移比 H/${driftDenom}`,
            swayAccentHex,
            renderer.capabilities.getMaxAnisotropy(),
          );
          const roofWorldY = (Number.isFinite(maxY) ? maxY : peakNode.position.y) * MM_TO_WORLD;
          const spriteY = Math.max(pBase.y + 0.115, roofWorldY + 0.15);
          if (spriteY - pBase.y > 0.16) {
            const leaderGeo = new THREE.BufferGeometry().setFromPoints([
              pBase,
              new THREE.Vector3(pBase.x, spriteY - 0.06, pBase.z),
            ]);
            dynamicDisposables.push(leaderGeo);
            const leaderLine = new THREE.Line(leaderGeo, refDashMat);
            leaderLine.computeLineDistances();
            frameGroup.add(leaderLine);
          }
          sprite.position.set(pBase.x, spriteY, pBase.z);
          frameGroup.add(sprite);
          dynamicDisposables.push(texture, material);
        }
      }

      // Build flush, zero-clipping corner hardware matching selected joint craft:
      //  - semi-rigid: cast-aluminum L-bracket nestled snugly in inner 90° pocket
      //  - gusset-plate / rigid: flat 5-hole anodized triangular plate seated FLUSH on outer side face
      if (jointType !== 'pinned' && jointType !== 'builtin') {
        type IncidentArm = {
          dir: THREE.Vector3;
          member: FrameModel['members'][number];
          n1: FrameModel['nodes'][number];
          n2: FrameModel['nodes'][number];
        };
        const adj = new Map<string, IncidentArm[]>();
        for (const m of model.members) {
          if (m.isBrace) continue;
          const n1 = nodeMap.get(m.startNodeId);
          const n2 = nodeMap.get(m.endNodeId);
          if (!n1 || !n2) continue;
          const v = new THREE.Vector3(
            n2.position.x - n1.position.x,
            n2.position.y - n1.position.y,
            n2.position.z - n1.position.z,
          ).normalize();
          const list1 = adj.get(n1.id) ?? [];
          list1.push({ dir: v, member: m, n1, n2 });
          adj.set(n1.id, list1);
          const list2 = adj.get(n2.id) ?? [];
          list2.push({ dir: v.clone().negate(), member: m, n1, n2 });
          adj.set(n2.id, list2);
        }

        // Frame centroid to orient external 5-hole gusset plates cleanly on outward-facing faces
        const frameCenter = new THREE.Vector3(
          (Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) * 0.5 : 0) * MM_TO_WORLD,
          (Number.isFinite(minY) && Number.isFinite(maxY) ? (minY + maxY) * 0.5 : 350) * MM_TO_WORLD,
          (Number.isFinite(minZ) && Number.isFinite(maxZ) ? (minZ + maxZ) * 0.5 : 0) * MM_TO_WORLD,
        );

        const isExternalPlate = jointType === 'gusset-plate' || jointType === 'rigid';
        const hardwareMat = isExternalPlate
          ? new THREE.MeshStandardMaterial({
              color: jointType === 'gusset-plate' ? '#1E293B' : '#0F172A',
              metalness: 0.62,
              roughness: 0.36,
            })
          : bracketMat;
        if (isExternalPlate) dynamicDisposables.push(hardwareMat);

        for (const [nodeId, arms] of adj.entries()) {
          const n = nodeMap.get(nodeId);
          if (!n || arms.length < 2) continue;
          // Skip deformed placement for internal L-brackets to keep heatmap clean; always show flush external plates on mild deformation
          if (showDeformed && !isExternalPlate) continue;

          const disp = showDeformed ? fea.nodeDisplacements[n.id] : null;
          const nodeWorld = new THREE.Vector3(
            (n.position.x + (disp ? disp.dx * effectiveDeformScale : 0)) * MM_TO_WORLD,
            (n.position.y + (disp ? disp.dy * effectiveDeformScale : 0)) * MM_TO_WORLD,
            (n.position.z + (disp ? disp.dz * effectiveDeformScale : 0)) * MM_TO_WORLD,
          );

          let placed = 0;
          for (let i = 0; i < arms.length && placed < 2; i++) {
            for (let j = i + 1; j < arms.length && placed < 2; j++) {
              const armA = arms[i];
              const armB = arms[j];
              const dotVal = Math.abs(armA.dir.dot(armB.dir));
              if (dotVal > 0.15) continue; // Only 90° orthogonal pairs

              let xAxis = armA.dir.clone().normalize();
              let yAxis = armB.dir.clone().normalize();
              let zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

              if (isExternalPlate) {
                // Mount 5-hole flat gusset plate flush on the OUTER side face of the corner (zero clipping)
                const outward = nodeWorld.clone().sub(frameCenter);
                if (outward.dot(zAxis) < 0) {
                  // Swap xAxis & yAxis so xAxis × yAxis points outward (+zAxis) while preserving right-handedness
                  const tmp = xAxis;
                  xAxis = yAxis;
                  yAxis = tmp;
                  zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
                }

                const zDirVec = { x: zAxis.x, y: zAxis.y, z: zAxis.z };
                const halfDepthA = getMemberHalfExtentAlongDir(armA.member, armA.n1, armA.n2, zDirVec);
                const halfDepthB = getMemberHalfExtentAlongDir(armB.member, armB.n1, armB.n2, zDirVec);
                const flushOffsetWorld = Math.max(halfDepthA, halfDepthB) * MM_TO_WORLD + 0.0029;

                const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
                const plate = new THREE.Mesh(gussetPlateGeo, hardwareMat);
                plate.position.copy(nodeWorld).addScaledVector(zAxis, flushOffsetWorld);
                plate.quaternion.setFromRotationMatrix(basis);
                frameGroup.add(plate);
              } else {
                // Cast-aluminum L-bracket seated snugly in the inner 90° pocket without piercing either beam
                const xDirVec = { x: xAxis.x, y: xAxis.y, z: xAxis.z };
                const yDirVec = { x: yAxis.x, y: yAxis.y, z: yAxis.z };
                const halfAlongX = getMemberHalfExtentAlongDir(armB.member, armB.n1, armB.n2, xDirVec);
                const halfAlongY = getMemberHalfExtentAlongDir(armA.member, armA.n1, armA.n2, yDirVec);
                const minW = Math.min(
                  getProfileSpec(armA.member.profileId).widthMm,
                  getProfileSpec(armB.member.profileId).widthMm,
                );
                const brScale = Math.max(0.88, Math.min(1.5, minW / 20));

                const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
                const bracket = new THREE.Mesh(bracketGeo, hardwareMat);
                bracket.position
                  .copy(nodeWorld)
                  .addScaledVector(xAxis, halfAlongX * MM_TO_WORLD + 0.0005)
                  .addScaledVector(yAxis, halfAlongY * MM_TO_WORLD + 0.0005);
                bracket.quaternion.setFromRotationMatrix(basis);
                bracket.scale.setScalar(brScale);
                frameGroup.add(bracket);
              }
              placed++;
            }
          }
        }
      }

      // Render real-world diagonal/triangular extrusion hardware right at the trimmed ends of every angled extrusion
      // (45° mitered bevel blocks for 45° knee braces; clevis swivel hinges + pivot pins for non-45° diagonals)
      for (const m of model.members) {
        const guide = analyzeMemberConnection(model, m);
        if (!guide.isDiagonal) continue;
        const n1 = nodeMap.get(m.startNodeId);
        const n2 = nodeMap.get(m.endNodeId);
        if (!n1 || !n2) continue;

        const trim = computeTrimmedMemberEndpoints(model, m);
        const d1 = showDeformed ? fea.nodeDisplacements[n1.id] : null;
        const d2 = showDeformed ? fea.nodeDisplacements[n2.id] : null;
        const baseStart = trim ? trim.startPos : n1.position;
        const baseEnd = trim ? trim.endPos : n2.position;
        const p1 = new THREE.Vector3(
          (baseStart.x + (d1 ? d1.dx * effectiveDeformScale : 0)) * MM_TO_WORLD,
          (baseStart.y + (d1 ? d1.dy * effectiveDeformScale : 0)) * MM_TO_WORLD,
          (baseStart.z + (d1 ? d1.dz * effectiveDeformScale : 0)) * MM_TO_WORLD,
        );
        const p2 = new THREE.Vector3(
          (baseEnd.x + (d2 ? d2.dx * effectiveDeformScale : 0)) * MM_TO_WORLD,
          (baseEnd.y + (d2 ? d2.dy * effectiveDeformScale : 0)) * MM_TO_WORLD,
          (baseEnd.z + (d2 ? d2.dz * effectiveDeformScale : 0)) * MM_TO_WORLD,
        );
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const segLen = dir.length();
        if (segLen < 0.04) continue;
        dir.normalize();

        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const spec = getProfileSpec(m.profileId);
        const profileScale = Math.max(0.82, Math.min(1.4, spec.widthMm / 24));
        const endInset = Math.min(segLen * 0.14, 0.012 * profileScale);

        for (const isStart of [true, false]) {
          const anchor = isStart
            ? p1.clone().addScaledVector(dir, endInset)
            : p2.clone().addScaledVector(dir, -endInset);

          if (guide.craft === 'miter-45') {
            // 45°/135° beveled corner clamp block seated flush at trimmed 45° end
            const block = new THREE.Mesh(miterBlockGeo, miterBlockMat);
            block.position.copy(anchor);
            block.quaternion.copy(quat);
            block.scale.setScalar(profileScale);
            frameGroup.add(block);
          } else {
            // Arbitrary-angle swivel hinge clevis + brushed steel horizontal pivot pin bridging trimmed end to T-slot
            const hingeGrp = new THREE.Group();
            hingeGrp.position.copy(anchor);
            hingeGrp.quaternion.copy(quat);
            hingeGrp.scale.setScalar(profileScale);

            const body = new THREE.Mesh(hingeBodyGeo, hingeMat);
            const pin = new THREE.Mesh(hingePinGeo, steelMat);
            pin.rotation.z = Math.PI / 2;
            hingeGrp.add(body, pin);
            frameGroup.add(hingeGrp);
          }
        }
      }

      // Find highest free elevation for lateral "推一下" test arrows
      let maxFreeY = -Infinity;
      if (Math.abs(lateralPushN) > 0.1) {
        for (const n of model.nodes) {
          if (n.support === 'free') maxFreeY = Math.max(maxFreeY, n.position.y);
        }
      }

      // Count node degree so intermediate degree-2 splice nodes stay subtly discoverable for one-click delete+merge
      const nodeDegree = new Map<string, number>();
      for (const m of model.members) {
        nodeDegree.set(m.startNodeId, (nodeDegree.get(m.startNodeId) ?? 0) + 1);
        nodeDegree.set(m.endNodeId, (nodeDegree.get(m.endNodeId) ?? 0) + 1);
      }

      // Build nodes, leveling feet, support anchors, contact shadows, and 3D force arrows
      for (const n of model.nodes) {
        const disp = showDeformed ? fea.nodeDisplacements[n.id] : null;
        const wx = (n.position.x + (disp ? disp.dx * effectiveDeformScale : 0)) * MM_TO_WORLD;
        const wy = (n.position.y + (disp ? disp.dy * effectiveDeformScale : 0)) * MM_TO_WORLD;
        const wz = (n.position.z + (disp ? disp.dz * effectiveDeformScale : 0)) * MM_TO_WORLD;

        const isSelNode = selectedNodeId === n.id;
        const isDrawStart = drawStartNodeId === n.id;
        const isSpliceNode = (nodeDegree.get(n.id) ?? 0) === 2 && n.support === 'free';
        const isNodeMode = cadTool !== 'select-member';
        const showNodeHandle =
          isNodeMode ||
          isSelNode ||
          isDrawStart ||
          n.support !== 'free' ||
          jointType === 'pinned';

        // Interactive node sphere (prominent in select-node / draw / load / support modes; unobtrusive in select-member mode)
        const nodeMat = new THREE.MeshStandardMaterial({
          color: isDrawStart
            ? '#059669'
            : isSelNode
              ? '#1D4ED8'
              : jointType === 'pinned' && n.support === 'free'
                ? '#0D9488'
                : isSpliceNode && isNodeMode
                  ? '#2563EB'
                  : n.support === 'fixed'
                    ? '#2563EB'
                    : n.support === 'pinned'
                      ? '#0D9488'
                      : '#475569',
          roughness: 0.35,
          metalness: 0.25,
          transparent: !showNodeHandle,
          opacity: showNodeHandle ? 0.96 : 0.01,
        });
        dynamicDisposables.push(nodeMat);

        const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
        nodeMesh.position.set(wx, wy, wz);
        nodeMesh.scale.setScalar(
          isSelNode || isDrawStart
            ? 1.55
            : cadTool === 'select-node'
              ? isSpliceNode
                ? 1.45
                : 1.32
              : isNodeMode
                ? 1.25
                : jointType === 'pinned'
                  ? 1.1
                  : 0.85,
        );
        nodeMesh.userData = { kind: 'node', id: n.id };
        frameGroup.add(nodeMesh);
        interactiveTargets.push(nodeMesh);

        // Grounded 3-part adjustable leveling foot + soft contact shadow disc
        if (n.support !== 'free') {
          if (n.position.y <= 15) {
            const footGroup = new THREE.Group();
            footGroup.position.set(n.position.x * MM_TO_WORLD, 0, n.position.z * MM_TO_WORLD);

            const pad = new THREE.Mesh(footPadGeo, rubberMat);
            pad.position.y = -0.016;
            footGroup.add(pad);

            const stem = new THREE.Mesh(footStemGeo, steelMat);
            stem.position.y = -0.006;
            footGroup.add(stem);

            const nut = new THREE.Mesh(footNutGeo, steelMat);
            nut.position.y = -0.008;
            footGroup.add(nut);

            const contact = new THREE.Mesh(shadowPlaneGeo, shadowMat);
            contact.position.y = -0.019;
            footGroup.add(contact);

            frameGroup.add(footGroup);
          } else {
            // Elevated wall/bracket anchor pyramid
            const anchor = new THREE.Mesh(
              supportConeGeo,
              n.support === 'fixed' ? fixedSupportMat : pinnedSupportMat,
            );
            anchor.position.set(wx, wy - 0.018, wz);
            frameGroup.add(anchor);
          }
        }

        // 3D Force vector arrows (bold red engineering arrows pointing INTO the loaded node)
        const fMag = Math.hypot(n.load.fx, n.load.fy, n.load.fz);
        if (fMag > 1) {
          const arrowLen = Math.min(0.28, Math.max(0.11, (fMag / 1200) * 0.22));
          const fDir = new THREE.Vector3(n.load.fx, n.load.fy, n.load.fz).normalize();
          const tipPos = new THREE.Vector3(wx, wy, wz).addScaledVector(fDir, -0.028);
          const startPos = tipPos.clone().addScaledVector(fDir, -arrowLen);

          const shaftLen = Math.max(0.04, arrowLen - 0.042);
          const shaftMid = startPos.clone().addScaledVector(fDir, shaftLen * 0.5);
          const conePos = tipPos.clone().addScaledVector(fDir, -0.021);
          const fQuat = new THREE.Quaternion().setFromUnitVectors(_up, fDir);

          const shaft = new THREE.Mesh(arrowShaftGeo, forceMat);
          shaft.position.copy(shaftMid);
          shaft.quaternion.copy(fQuat);
          shaft.scale.set(1, shaftLen, 1);
          frameGroup.add(shaft);

          const cone = new THREE.Mesh(arrowConeGeo, forceMat);
          cone.position.copy(conePos);
          cone.quaternion.copy(fQuat);
          frameGroup.add(cone);
        }

        // Optional horizontal "推一下" lateral push test arrows on top nodes (+X)
        if (
          Math.abs(lateralPushN) > 0.1 &&
          n.support === 'free' &&
          Math.abs(n.position.y - maxFreeY) <= 50
        ) {
          const pushDir = new THREE.Vector3(lateralPushN >= 0 ? 1 : -1, 0, 0);
          const pushLen = Math.min(0.26, Math.max(0.14, (Math.abs(lateralPushN) / 300) * 0.24));
          const tipPos = new THREE.Vector3(wx, wy, wz).addScaledVector(pushDir, -0.032);
          const startPos = tipPos.clone().addScaledVector(pushDir, -pushLen);
          const shaftLen = Math.max(0.05, pushLen - 0.042);
          const shaftMid = startPos.clone().addScaledVector(pushDir, shaftLen * 0.5);
          const conePos = tipPos.clone().addScaledVector(pushDir, -0.021);
          const pQuat = new THREE.Quaternion().setFromUnitVectors(_up, pushDir);

          const pushMat = new THREE.MeshStandardMaterial({
            color: '#EA580C',
            roughness: 0.35,
            metalness: 0.15,
          });
          dynamicDisposables.push(pushMat);

          const shaft = new THREE.Mesh(arrowShaftGeo, pushMat);
          shaft.position.copy(shaftMid);
          shaft.quaternion.copy(pQuat);
          shaft.scale.set(1, shaftLen, 1);
          frameGroup.add(shaft);

          const cone = new THREE.Mesh(arrowConeGeo, pushMat);
          cone.position.copy(conePos);
          cone.quaternion.copy(pQuat);
          frameGroup.add(cone);
        }
      }

      requestRender();
    };

    // Camera preset transitions framed cleanly around current model bounding box
    const computeCameraPreset = (preset: CameraPreset) => {
      const box = new THREE.Box3();
      const { model } = propsRef.current;
      for (const n of model.nodes) {
        box.expandByPoint(
          new THREE.Vector3(
            n.position.x * MM_TO_WORLD,
            n.position.y * MM_TO_WORLD,
            n.position.z * MM_TO_WORLD,
          ),
        );
      }
      const center = new THREE.Vector3(0, 0.36, 0);
      const size = new THREE.Vector3(1.2, 0.8, 0.8);
      if (!box.isEmpty()) {
        box.getCenter(center);
        box.getSize(size);
      }
      // Frame cleanly in center of unobstructed CAD canvas
      const dist = Math.max(1.5, Math.max(size.x, size.y, size.z) * 2.05);

      const pos = new THREE.Vector3();
      switch (preset) {
        case 'front':
          pos.set(center.x, center.y + 0.08, center.z + dist);
          break;
        case 'top':
          pos.set(center.x, center.y + dist * 1.18, center.z + 0.05);
          break;
        case 'side':
          pos.set(center.x + dist, center.y + 0.08, center.z);
          break;
        case 'iso':
        default:
          pos.set(center.x + dist * 0.72, center.y + dist * 0.56, center.z + dist * 0.78);
          break;
      }

      return { pos, center };
    };

    const setCameraPreset = (preset: CameraPreset, immediate = false) => {
      const { pos, center } = computeCameraPreset(preset);
      if (immediate || isSoftwareGl) {
        camTransition.active = false;
        camera.position.copy(pos);
        controls.target.copy(center);
        controls.update();
      } else {
        camTransition = {
          active: true,
          targetPos: pos,
          targetLook: center,
        };
      }
      requestRender();
    };

    // Pointer interaction (throttled hover snap + click raycasting)
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownXY = { x: 0, y: 0 };
    let lastHoverTs = 0;

    const getWorkplanePoint = (clientX: number, clientY: number): Vec3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const planeY = propsRef.current.workplaneY * MM_TO_WORLD;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      // Snap to 100 mm metric grid
      const snapMm = 100;
      const xMm = Math.round((hit.x / MM_TO_WORLD) / snapMm) * snapMm;
      const zMm = Math.round((hit.z / MM_TO_WORLD) / snapMm) * snapMm;
      if (Math.abs(xMm) > 1500 || Math.abs(zMm) > 1500) return null;
      return { x: xMm, y: propsRef.current.workplaneY, z: zMm };
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownXY = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTs < 45) return;
      lastHoverTs = now;

      const { cadTool, drawStartNodeId, model } = propsRef.current;
      if (cadTool === 'add-node' || cadTool === 'draw-beam') {
        renderer.domElement.style.cursor = 'crosshair';
        const pt = getWorkplanePoint(e.clientX, e.clientY);
        if (pt) {
          snapRing.position.set(pt.x * MM_TO_WORLD, pt.y * MM_TO_WORLD + 0.002, pt.z * MM_TO_WORLD);
          snapRing.visible = true;

          if (cadTool === 'draw-beam' && drawStartNodeId) {
            const startN = model.nodes.find((n) => n.id === drawStartNodeId);
            if (startN) {
              const posAttr = previewLine.geometry.attributes.position as THREE.BufferAttribute;
              posAttr.setXYZ(
                0,
                startN.position.x * MM_TO_WORLD,
                startN.position.y * MM_TO_WORLD,
                startN.position.z * MM_TO_WORLD,
              );
              posAttr.setXYZ(1, pt.x * MM_TO_WORLD, pt.y * MM_TO_WORLD, pt.z * MM_TO_WORLD);
              posAttr.needsUpdate = true;
              previewLine.visible = true;
            }
          } else {
            previewLine.visible = false;
          }
          requestRender();
        }
      } else {
        if (snapRing.visible || previewLine.visible) {
          snapRing.visible = false;
          previewLine.visible = false;
          requestRender();
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hoverHits = raycaster.intersectObjects(interactiveTargets, false);
        const wantsNode = cadTool === 'select-node' || cadTool === 'add-load' || cadTool === 'toggle-support';
        const matchingHover = hoverHits.some((h) =>
          wantsNode ? h.object.userData.kind === 'node' : h.object.userData.kind === 'member',
        );
        renderer.domElement.style.cursor = matchingHover ? 'pointer' : 'grab';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      // Ignore orbit drag releases
      if (Math.hypot(e.clientX - pointerDownXY.x, e.clientY - pointerDownXY.y) > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      const hits = raycaster.intersectObjects(interactiveTargets, false);
      const { cadTool, onClickNodeForTool, onSelectMember, onSelectNode, onClickWorkplane } =
        propsRef.current;

      const nodeHit = hits.find((h) => h.object.userData.kind === 'node');
      const memberHit = hits.find((h) => h.object.userData.kind === 'member');

      if (cadTool === 'draw-beam' || cadTool === 'add-load' || cadTool === 'toggle-support') {
        if (nodeHit) {
          onClickNodeForTool(nodeHit.object.userData.id);
          return;
        }
        if (cadTool === 'draw-beam') {
          const pt = getWorkplanePoint(e.clientX, e.clientY);
          if (pt) onClickWorkplane(pt);
        }
        return;
      }

      if (cadTool === 'add-node') {
        const pt = getWorkplanePoint(e.clientX, e.clientY);
        if (pt) onClickWorkplane(pt);
        return;
      }

      // Dedicated Node Selection Mode (never accidentally selects beams)
      if (cadTool === 'select-node') {
        if (nodeHit) {
          onSelectNode(nodeHit.object.userData.id);
        } else {
          onSelectNode(null);
        }
        return;
      }

      // Dedicated Member Selection Mode (never accidentally selects nodes)
      if (memberHit) {
        onSelectMember(memberHit.object.userData.id);
      } else {
        onSelectMember(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ResizeObserver: avoid redundant setSize (which blanks WebGL buffer) and immediately re-render on real resize
    let lastW = width;
    let lastH = height;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(100, Math.round(entry.contentRect.width));
      const h = Math.max(100, Math.round(entry.contentRect.height));
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
      requestRender();
    });
    resizeObserver.observe(container);

    sceneApiRef.current = {
      rebuildFrame,
      setCameraPreset: (p) => setCameraPreset(p, false),
      requestRender,
    };

    // Initial build, immediate camera framing, and guaranteed synchronous first-paint draw
    rebuildFrame();
    setCameraPreset('iso', true);
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    renderer.render(scene, camera);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      clearFrameGroup();
      for (const geo of profileGeos.values()) geo.dispose();
      bracketGeo.dispose();
      gussetPlateGeo.dispose();
      nodeGeo.dispose();
      footPadGeo.dispose();
      footStemGeo.dispose();
      footNutGeo.dispose();
      shadowPlaneGeo.dispose();
      arrowShaftGeo.dispose();
      arrowConeGeo.dispose();
      supportConeGeo.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      snapRingGeo.dispose();
      snapRingMat.dispose();
      previewLineGeo.dispose();
      previewLineMat.dispose();
      bracketMat.dispose();
      rubberMat.dispose();
      steelMat.dispose();
      shadowMat.dispose();
      endCapMat.dispose();
      lockCollarMat.dispose();
      miterBlockGeo.dispose();
      hingeBodyGeo.dispose();
      hingePinGeo.dispose();
      miterBlockMat.dispose();
      hingeMat.dispose();
      forceMat.dispose();
      fixedSupportMat.dispose();
      pinnedSupportMat.dispose();
      ghostLineMat.dispose();
      brushedTex.dispose();
      shadowTex.dispose();
      envRT.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // 2. Sync scene geometry & stress colors whenever state changes (no WebGL teardown)
  useEffect(() => {
    sceneApiRef.current?.rebuildFrame();
  }, [
    props.model,
    props.fea,
    props.colorMode,
    props.finish,
    props.deformScale,
    props.jointType,
    props.lateralPushN,
    props.showSwayEnvelope,
    props.cadTool,
    props.workplaneY,
    props.selectedMemberId,
    props.selectedNodeId,
    props.drawStartNodeId,
  ]);

  // 3. Trigger smooth camera preset transitions
  useEffect(() => {
    if (props.cameraPresetTrigger.seq > 0) {
      sceneApiRef.current?.setCameraPreset(props.cameraPresetTrigger.preset);
    }
  }, [props.cameraPresetTrigger.preset, props.cameraPresetTrigger.seq]);

  if (webglUnavailable) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#EEF2F6] text-slate-600 p-8">
        <div className="max-w-md text-center space-y-2">
          <p className="text-base font-semibold text-slate-900">当前浏览器环境未启用 WebGL 渲染</p>
          <p className="text-sm text-slate-600">
            有限元计算与物料清单仍可正常运行，请切换至支持 WebGL 的浏览器以查看 3D 铝型材视图。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative outline-none select-none"
      aria-label="3D 铝型材结构视口"
    />
  );
}
