import * as THREE from 'three';
import { getProfileSpec } from '../engine/profiles';
import type { ProfileId } from '../engine/types';

// Scale: 1 Three.js world unit = 1000 mm (1 meter)
export const MM_TO_WORLD = 0.001;

/**
 * Create a realistic European T-slot aluminum extrusion cross-section shape (in meters).
 * Features chamfered outer corners, T-slot grooves along each face, and a central bore hole.
 */
export function createTSlotCrossSection(profileId: ProfileId): THREE.Shape {
  const spec = getProfileSpec(profileId);
  const w = spec.widthMm * MM_TO_WORLD;
  const h = spec.heightMm * MM_TO_WORLD;
  const hw = w / 2;
  const hh = h / 2;
  const chamfer = Math.min(w, h) * 0.06;
  const sw = spec.slotWidthMm * MM_TO_WORLD * 0.5; // half slot opening
  const sd = Math.min(w, h) * 0.16; // slot depth

  const shape = new THREE.Shape();

  // Trace perimeter counter-clockwise with T-slot notches on all 4 sides
  // Bottom edge (-hh): left -> right
  shape.moveTo(-hw + chamfer, -hh);
  shape.lineTo(-sw, -hh);
  shape.lineTo(-sw, -hh + sd);
  shape.lineTo(sw, -hh + sd);
  shape.lineTo(sw, -hh);
  shape.lineTo(hw - chamfer, -hh);
  shape.lineTo(hw, -hh + chamfer);

  // Right edge (+hw): bottom -> top
  if (spec.heightMm >= spec.widthMm * 1.8) {
    // Double-slot tall profile (e.g., 2040, 4080)
    const c1 = -hh * 0.5;
    const c2 = hh * 0.5;
    shape.lineTo(hw, c1 - sw);
    shape.lineTo(hw - sd, c1 - sw);
    shape.lineTo(hw - sd, c1 + sw);
    shape.lineTo(hw, c1 + sw);
    shape.lineTo(hw, c2 - sw);
    shape.lineTo(hw - sd, c2 - sw);
    shape.lineTo(hw - sd, c2 + sw);
    shape.lineTo(hw, c2 + sw);
  } else {
    shape.lineTo(hw, -sw);
    shape.lineTo(hw - sd, -sw);
    shape.lineTo(hw - sd, sw);
    shape.lineTo(hw, sw);
  }
  shape.lineTo(hw, hh - chamfer);
  shape.lineTo(hw - chamfer, hh);

  // Top edge (+hh): right -> left
  shape.lineTo(sw, hh);
  shape.lineTo(sw, hh - sd);
  shape.lineTo(-sw, hh - sd);
  shape.lineTo(-sw, hh);
  shape.lineTo(-hw + chamfer, hh);
  shape.lineTo(-hw, hh - chamfer);

  // Left edge (-hw): top -> bottom
  if (spec.heightMm >= spec.widthMm * 1.8) {
    const c1 = hh * 0.5;
    const c2 = -hh * 0.5;
    shape.lineTo(-hw, c1 + sw);
    shape.lineTo(-hw + sd, c1 + sw);
    shape.lineTo(-hw + sd, c1 - sw);
    shape.lineTo(-hw, c1 - sw);
    shape.lineTo(-hw, c2 + sw);
    shape.lineTo(-hw + sd, c2 + sw);
    shape.lineTo(-hw + sd, c2 - sw);
    shape.lineTo(-hw, c2 - sw);
  } else {
    shape.lineTo(-hw, sw);
    shape.lineTo(-hw + sd, sw);
    shape.lineTo(-hw + sd, -sw);
    shape.lineTo(-hw, -sw);
  }
  shape.lineTo(-hw, -hh + chamfer);
  shape.closePath();

  // Central bore hole(s)
  const boreR = Math.min(w, h) * 0.14;
  if (spec.heightMm >= spec.widthMm * 1.8) {
    for (const cy of [-hh * 0.5, hh * 0.5]) {
      const hole = new THREE.Path();
      hole.absarc(0, cy, boreR, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  } else {
    const hole = new THREE.Path();
    hole.absarc(0, 0, boreR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  return shape;
}

/**
 * Create unit-length extruded T-slot geometry centered along local +Y (from -0.5 to +0.5).
 * Scaling mesh.scale.set(1, lengthMeters, 1) preserves exact cross-section dimensions.
 */
export function createUnitProfileGeometry(profileId: ProfileId): THREE.BufferGeometry {
  const shape = createTSlotCrossSection(profileId);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 8,
  });
  // Extrude goes along +Z (0..1). Rotate so beam runs along +Y (-0.5..+0.5)
  geo.translate(0, 0, -0.5);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create cast-aluminum L-corner gusset bracket geometry sized for a 2020 inner 90° pocket.
 * Scales proportionally to intersecting profile widths with zero interpenetration.
 */
export function createCornerBracketGeometry(): THREE.BufferGeometry {
  const s = 0.022; // 22 mm gusset leg seated cleanly in inner corner
  const thickness = 0.017; // 17 mm fits flush inside a 20 mm profile face
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(s, 0);
  shape.lineTo(s, 0.005);
  shape.lineTo(0.005, s);
  shape.lineTo(0, s);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.0008,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create external 6mm flat 5-hole L/triangular anodized gusset plate geometry (外置三角连接板).
 * Sits flush on the OUTER side face of a 90° corner — zero clipping through extrusions.
 */
export function createExternalGussetPlateGeometry(): THREE.BufferGeometry {
  const leg = 0.064; // 64 mm external gusset span along both legs
  const band = 0.020; // 20 mm arm width matching 2020/2040 faces
  const thickness = 0.005; // 5 mm machined aluminum plate

  const shape = new THREE.Shape();
  shape.moveTo(-band * 0.48, -band * 0.48);
  shape.lineTo(leg, -band * 0.48);
  shape.lineTo(leg, band * 0.48);
  shape.lineTo(band * 0.48, leg);
  shape.lineTo(-band * 0.48, leg);
  shape.closePath();

  // 5 countersunk bolt holes for authentic industrial 5-hole gusset plate look
  const holeR = 0.0028;
  const holeCenters: [number, number][] = [
    [0, 0],
    [leg * 0.44, 0],
    [leg * 0.78, 0],
    [0, leg * 0.44],
    [0, leg * 0.78],
  ];
  for (const [hx, hy] of holeCenters) {
    const hole = new THREE.Path();
    hole.absarc(hx, hy, holeR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0008,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create brushed anodized aluminum procedural bump/roughness CanvasTexture.
 */
export function createBrushedAluminumTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    // Fine longitudinal brushed extrusion lines
    for (let i = 0; i < 650; i++) {
      const x = (i * 47) % 256;
      const shade = 110 + ((i * 29) % 45);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, 0, 1 + (i % 2), 256);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

/**
 * Create a soft radial contact shadow disc texture for grounded feet.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
    grad.addColorStop(0.5, 'rgba(15, 23, 42, 0.16)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Map FEA stress utilization [0 .. 1.0+] to a high-contrast engineering heatmap color.
 * 0.00 -> Cobalt Blue (#2563EB)
 * 0.25 -> Cyan/Teal   (#0EA5E9)
 * 0.50 -> Emerald     (#10B981)
 * 0.75 -> Amber       (#F59E0B)
 * 1.00 -> Crimson Red (#DC2626)
 */
export function stressUtilizationToColor(utilization: number, target = new THREE.Color()): THREE.Color {
  const t = Math.max(0, Math.min(1, utilization / 0.85)); // saturate red near 85% yield (SF ~ 1.18)
  const stops = [
    new THREE.Color('#2563EB'),
    new THREE.Color('#0EA5E9'),
    new THREE.Color('#10B981'),
    new THREE.Color('#F59E0B'),
    new THREE.Color('#DC2626'),
  ];
  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  return target.copy(stops[idx]).lerp(stops[idx + 1], frac);
}

/**
 * Map axial force to tension (warm red-orange) vs compression (cool cobalt blue) color.
 */
export function axialForceToColor(axialN: number, maxAbsN: number, target = new THREE.Color()): THREE.Color {
  const norm = maxAbsN > 1 ? Math.max(-1, Math.min(1, axialN / maxAbsN)) : 0;
  const neutral = new THREE.Color('#94A3B8');
  if (norm >= 0) {
    return target.copy(neutral).lerp(new THREE.Color('#EA580C'), norm); // Tension
  }
  return target.copy(neutral).lerp(new THREE.Color('#1D4ED8'), -norm); // Compression
}
