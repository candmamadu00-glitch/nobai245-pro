export type NormalizedVehicleCategory = 'MOTO' | 'MOTO_CARRO' | 'TAXI' | 'TOCA_TOCA' | 'PARTICULAR';
export type VehicleColorKey = 'white' | 'black' | 'gray' | 'blue' | 'red' | 'yellow' | 'green' | 'orange' | 'brown';

export interface VehicleColorOption {
  key: VehicleColorKey;
  label: string;
  hex: string;
  borderHex?: string;
}

export const VEHICLE_COLOR_OPTIONS: VehicleColorOption[] = [
  { key: 'white', label: 'Branco', hex: '#FFFFFF', borderHex: '#CBD5E1' },
  { key: 'black', label: 'Preto', hex: '#1E293B' },
  { key: 'gray', label: 'Prata', hex: '#94A3B8' },
  { key: 'blue', label: 'Azul', hex: '#2563EB' },
  { key: 'red', label: 'Vermelho', hex: '#DC2626' },
  { key: 'yellow', label: 'Amarelo', hex: '#EAB308' },
  { key: 'green', label: 'Verde', hex: '#16A34A' },
  { key: 'orange', label: 'Laranja', hex: '#EA580C' },
  { key: 'brown', label: 'Castanho', hex: '#78350F' },
];

const CAR_ASSETS_BY_COLOR: Record<VehicleColorKey, any> = {
  black: require('../../assets/images/vehicles/car_black.png'),
  blue: require('../../assets/images/vehicles/car_blue.png'),
  brown: require('../../assets/images/vehicles/car_brown.png'),
  gray: require('../../assets/images/vehicles/car_gray.png'),
  green: require('../../assets/images/vehicles/car_green.png'),
  orange: require('../../assets/images/vehicles/car_orange.png'),
  red: require('../../assets/images/vehicles/car_red.png'),
  white: require('../../assets/images/vehicles/car_white.png'),
  yellow: require('../../assets/images/vehicles/car_yellow.png'),
};

const SPECIAL_VEHICLE_ASSETS = {
  MOTO: require('../../assets/images/vehicles/moto.png'),
  MOTO_CARRO: require('../../assets/images/vehicles/motocarro.png'),
  TOCA_TOCA: require('../../assets/images/vehicles/toca_toca.jpg'),
};

export function normalizeVehicleCategory(type?: string): NormalizedVehicleCategory {
  if (!type) return 'PARTICULAR';
  const clean = String(type)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[-_\s]+/g, '')
    .trim();

  if (clean.includes('MOTOCARRO') || clean.includes('TRICICLO') || clean.includes('KEKE')) {
    return 'MOTO_CARRO';
  }
  if (clean.includes('MOTO')) {
    return 'MOTO';
  }
  if (clean.includes('TOCA') || clean.includes('VAN') || clean.includes('MINIBUS')) {
    return 'TOCA_TOCA';
  }
  if (clean.includes('TAXI')) {
    return 'TAXI';
  }
  return 'PARTICULAR';
}

export function resolveVehicleColorKey(colorName?: string): VehicleColorKey | null {
  if (!colorName) return null;
  const clean = String(colorName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (!clean) return null;

  if (clean.includes('PRETO') || clean.includes('BLACK') || clean.includes('ESCURO') || clean.includes('NEGRO')) {
    return 'black';
  }
  if (clean.includes('AZUL') || clean.includes('BLUE') || clean.includes('MARINHO') || clean.includes('CELESTE')) {
    return 'blue';
  }
  if (clean.includes('VERMELHO') || clean.includes('RED') || clean.includes('VINHO') || clean.includes('ENCARNADO') || clean.includes('BORDO')) {
    return 'red';
  }
  if (clean.includes('LARANJA') || clean.includes('ORANGE')) {
    return 'orange';
  }
  if (clean.includes('VERDE') || clean.includes('GREEN')) {
    return 'green';
  }
  if (
    clean.includes('CINZA') ||
    clean.includes('CINZENTO') ||
    clean.includes('PRATA') ||
    clean.includes('SILVER') ||
    clean.includes('GRAY') ||
    clean.includes('GREY') ||
    clean.includes('GRAFITE') ||
    clean.includes('CHUMBO')
  ) {
    return 'gray';
  }
  if (clean.includes('CASTANHO') || clean.includes('MARROM') || clean.includes('BROWN') || clean.includes('BEGE') || clean.includes('CHOCOLATE')) {
    return 'brown';
  }
  if (clean.includes('AMARELO') || clean.includes('YELLOW') || clean.includes('OURO') || clean.includes('DOURADO')) {
    return 'yellow';
  }
  if (clean.includes('BRANCO') || clean.includes('WHITE') || clean.includes('PEROLA')) {
    return 'white';
  }

  return null;
}

export function getDefaultColorForCategory(type?: string): string {
  const category = normalizeVehicleCategory(type);
  switch (category) {
    case 'TAXI':
      return 'Amarelo';
    case 'MOTO':
      return 'Preto';
    case 'MOTO_CARRO':
      return 'Amarelo';
    case 'TOCA_TOCA':
      return 'Branco';
    case 'PARTICULAR':
    default:
      return 'Branco';
  }
}

export function getVehicleCategoryLabel(type?: string): string {
  const category = normalizeVehicleCategory(type);
  switch (category) {
    case 'MOTO':
      return 'Moto';
    case 'MOTO_CARRO':
      return 'Moto-Carro';
    case 'TOCA_TOCA':
      return 'Toca-Toca';
    case 'TAXI':
      return 'Táxi';
    case 'PARTICULAR':
    default:
      return 'Particular';
  }
}

export function getVehicleColorHex(colorName?: string): string {
  const key = resolveVehicleColorKey(colorName);
  if (!key) return '#E2E8F0';
  return VEHICLE_COLOR_OPTIONS.find((c) => c.key === key)?.hex || '#E2E8F0';
}

export function getVehicle3DIconAsset(vehicleType?: string, vehicleColor?: string) {
  const category = normalizeVehicleCategory(vehicleType);

  if (category === 'MOTO') {
    return SPECIAL_VEHICLE_ASSETS.MOTO;
  }
  if (category === 'MOTO_CARRO') {
    return SPECIAL_VEHICLE_ASSETS.MOTO_CARRO;
  }
  if (category === 'TOCA_TOCA') {
    return SPECIAL_VEHICLE_ASSETS.TOCA_TOCA;
  }

  const matchedColorKey = resolveVehicleColorKey(vehicleColor);
  if (matchedColorKey) {
    return CAR_ASSETS_BY_COLOR[matchedColorKey];
  }

  return category === 'TAXI' ? CAR_ASSETS_BY_COLOR.yellow : CAR_ASSETS_BY_COLOR.white;
}
