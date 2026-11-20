import type { ProfileId, ProfileSpec } from './types';

// 6063-T5 Architectural / Industrial Extruded Aluminum Alloy
export const ALUMINUM_6063_T5 = {
  grade: '6063-T5',
  youngsModulusMPa: 69000,   // 69 GPa = 69,000 N/mm^2
  shearModulusMPa: 26000,    // 26 GPa = 26,000 N/mm^2
  yieldStrengthMPa: 145,     // Minimum yield strength Rp0.2 (MPa)
  ultimateStrengthMPa: 185,  // Ultimate tensile strength Rm (MPa)
  densityKgPerM3: 2700,
  gravityMps2: 9.81,
} as const;

// Standard European T-slot extrusion series (国标/欧标铝型材参数)
export const PROFILE_CATALOG: Record<ProfileId, ProfileSpec> = {
  '2020': {
    id: '2020',
    name: '2020 欧标轻型',
    widthMm: 20,
    heightMm: 20,
    slotWidthMm: 6,
    areaMm2: 162,
    ixMm4: 6900,
    iyMm4: 6900,
    wxMm3: 690,
    wyMm3: 690,
    jMm4: 2400,
    massPerMeterKg: 0.44,
    pricePerMeterCNY: 12,
  },
  '2040': {
    id: '2040',
    name: '2040 欧标双槽',
    widthMm: 20,
    heightMm: 40,
    slotWidthMm: 6,
    areaMm2: 304,
    ixMm4: 47800,
    iyMm4: 13200,
    wxMm3: 2390,
    wyMm3: 1320,
    jMm4: 6800,
    massPerMeterKg: 0.82,
    pricePerMeterCNY: 22,
  },
  '3030': {
    id: '3030',
    name: '3030 欧标通用',
    widthMm: 30,
    heightMm: 30,
    slotWidthMm: 8,
    areaMm2: 315,
    ixMm4: 28500,
    iyMm4: 28500,
    wxMm3: 1900,
    wyMm3: 1900,
    jMm4: 9200,
    massPerMeterKg: 0.85,
    pricePerMeterCNY: 24,
  },
  '4040': {
    id: '4040',
    name: '4040 欧标重载',
    widthMm: 40,
    heightMm: 40,
    slotWidthMm: 8,
    areaMm2: 560,
    ixMm4: 89800,
    iyMm4: 89800,
    wxMm3: 4490,
    wyMm3: 4490,
    jMm4: 29000,
    massPerMeterKg: 1.51,
    pricePerMeterCNY: 38,
  },
  '4080': {
    id: '4080',
    name: '4080 欧标超重载',
    widthMm: 40,
    heightMm: 80,
    slotWidthMm: 8,
    areaMm2: 1040,
    ixMm4: 635000,
    iyMm4: 175000,
    wxMm3: 15875,
    wyMm3: 8750,
    jMm4: 72000,
    massPerMeterKg: 2.81,
    pricePerMeterCNY: 68,
  },
};

export const PROFILE_ORDER: ProfileId[] = ['2020', '2040', '3030', '4040', '4080'];

export function getProfileSpec(id: ProfileId): ProfileSpec {
  return PROFILE_CATALOG[id] ?? PROFILE_CATALOG['4040'];
}
