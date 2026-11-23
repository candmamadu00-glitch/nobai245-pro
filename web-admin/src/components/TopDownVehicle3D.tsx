import React from 'react';

interface TopDownVehicle3DProps {
  vehicleType?: string;
  vehicleColor?: string;
  isRiding?: boolean;
  isEmergency?: boolean;
  size?: number;
}

function resolveVehicleStyle(vehicleType?: string, vehicleColor?: string, isEmergency?: boolean) {
  if (isEmergency) {
    return {
      bodyPrimary: '#EF4444',
      bodySecondary: '#991B1B',
      roof: '#FCA5A5',
      trim: '#450A0A',
      isTaxi: false,
      isMoto: false,
      isVan: false,
    };
  }

  const type = String(vehicleType || 'PARTICULAR').toUpperCase();
  const color = String(vehicleColor || '').toLowerCase();

  if (type.includes('TAXI')) {
    return {
      bodyPrimary: '#FACC15',
      bodySecondary: '#CA8A04',
      roof: '#FEF08A',
      trim: '#0F172A',
      isTaxi: true,
      isMoto: false,
      isVan: false,
    };
  }

  if (type.includes('MOTO')) {
    return {
      bodyPrimary: '#EAB308',
      bodySecondary: '#A16207',
      roof: '#F8FAFC',
      trim: '#0F172A',
      isTaxi: false,
      isMoto: true,
      isVan: false,
    };
  }

  if (type.includes('EXEC') || type.includes('COMFORT') || color.includes('pret') || color.includes('black')) {
    return {
      bodyPrimary: '#1E293B',
      bodySecondary: '#090D16',
      roof: '#334155',
      trim: '#020617',
      isTaxi: false,
      isMoto: false,
      isVan: false,
    };
  }

  const isVan = type.includes('VAN') || type.includes('XL');

  if (color.includes('azul') || color.includes('blue')) {
    return { bodyPrimary: '#2563EB', bodySecondary: '#1D4ED8', roof: '#3B82F6', trim: '#0F172A', isTaxi: false, isMoto: false, isVan };
  }
  if (color.includes('prata') || color.includes('cinz') || color.includes('silver') || color.includes('gray')) {
    return { bodyPrimary: '#CBD5E1', bodySecondary: '#94A3B8', roof: '#E2E8F0', trim: '#1E293B', isTaxi: false, isMoto: false, isVan };
  }
  if (color.includes('vermelh') || color.includes('red')) {
    return { bodyPrimary: '#DC2626', bodySecondary: '#991B1B', roof: '#EF4444', trim: '#0F172A', isTaxi: false, isMoto: false, isVan };
  }
  if (color.includes('verde') || color.includes('green')) {
    return { bodyPrimary: '#16A34A', bodySecondary: '#15803D', roof: '#22C55E', trim: '#0F172A', isTaxi: false, isMoto: false, isVan };
  }

  return {
    bodyPrimary: '#F8FAFC',
    bodySecondary: '#CBD5E1',
    roof: '#FFFFFF',
    trim: '#0F172A',
    isTaxi: false,
    isMoto: false,
    isVan,
  };
}

export function TopDownVehicle3D({
  vehicleType,
  vehicleColor,
  isRiding = false,
  isEmergency = false,
  size = 54,
}: TopDownVehicle3DProps) {
  const v = resolveVehicleStyle(vehicleType, vehicleColor, isEmergency);
  const uid = React.useId().replace(/:/g, '');

  const haloBg = isEmergency
    ? 'rgba(239, 68, 68, 0.34)'
    : isRiding
    ? 'rgba(59, 130, 246, 0.24)'
    : 'rgba(16, 185, 129, 0.22)';
  const haloBorder = isEmergency ? '#EF4444' : isRiding ? '#3B82F6' : '#10B981';

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>{`
        @keyframes nobaiSosWave {
          0% { transform: scale(0.85); opacity: 0.95; }
          70% { transform: scale(1.65); opacity: 0.15; }
          100% { transform: scale(1.85); opacity: 0; }
        }
      `}</style>

      {isEmergency && (
        <div
          style={{
            position: 'absolute',
            width: size * 0.92,
            height: size * 0.92,
            borderRadius: '50%',
            border: '3px solid #EF4444',
            backgroundColor: 'rgba(239, 68, 68, 0.25)',
            animation: 'nobaiSosWave 1.15s infinite ease-out',
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          width: size * 0.84,
          height: size * 0.84,
          borderRadius: '50%',
          backgroundColor: haloBg,
          border: `1.8px solid ${haloBorder}`,
          boxShadow: isEmergency ? '0 0 18px rgba(239,68,68,0.85)' : '0 2px 8px rgba(15,23,42,0.2)',
        }}
      />

      {v.isMoto ? (
        <svg width={size * 0.76} height={size * 0.76} viewBox="0 0 64 64" fill="none">
          <ellipse cx="32" cy="35" rx="10" ry="22" fill="rgba(15,23,42,0.38)" />
          <rect x="29" y="7" width="6" height="13" rx="3" fill="#0F172A" />
          <rect x="28" y="44" width="8" height="13" rx="3" fill="#0F172A" />
          <path d="M23 22C23 16 41 16 41 22L38 45C38 49 26 49 26 45L23 22Z" fill={v.bodyPrimary} stroke="#0F172A" strokeWidth="2.2" />
          <rect x="19" y="21" width="26" height="4" rx="2" fill="#0F172A" />
          <circle cx="32" cy="31" r="6.5" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2" />
          <path d="M27 29C29 27 35 27 37 29" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="10" r="2.5" fill="#FEF08A" />
        </svg>
      ) : (
        <svg width={size * 0.82} height={size * 0.82} viewBox="0 0 64 64" fill="none">
          <defs>
            <linearGradient id={`body-${uid}`} x1="16" y1="8" x2="48" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={v.bodyPrimary} />
              <stop offset="100%" stopColor={v.bodySecondary} />
            </linearGradient>
            <linearGradient id={`glass-${uid}`} x1="20" y1="15" x2="44" y2="25" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0F172A" />
              <stop offset="50%" stopColor="#1E293B" />
              <stop offset="100%" stopColor="#020617" />
            </linearGradient>
          </defs>

          {/* Sombra 3D projetada no asfalto */}
          <ellipse cx="33" cy="35" rx="17" ry="26" fill="rgba(2, 6, 23, 0.42)" />

          {/* Pneus */}
          <rect x="13" y="14" width="4.5" height="9.5" rx="2" fill="#090D16" />
          <rect x="46.5" y="14" width="4.5" height="9.5" rx="2" fill="#090D16" />
          <rect x="13" y="41" width="4.5" height="9.5" rx="2" fill="#090D16" />
          <rect x="46.5" y="41" width="4.5" height="9.5" rx="2" fill="#090D16" />

          {/* Retrovisores laterais 3D */}
          <path d="M16.5 21L12.5 22.5L13.5 25L17 24Z" fill={v.bodyPrimary} stroke={v.trim} strokeWidth="1.2" />
          <path d="M47.5 21L51.5 22.5L50.5 25L47 24Z" fill={v.bodyPrimary} stroke={v.trim} strokeWidth="1.2" />

          {/* Carroceria esculpida */}
          <rect
            x="16.5"
            y={v.isVan ? '5.5' : '7.5'}
            width="31"
            height={v.isVan ? '53' : '49'}
            rx="11.5"
            fill={`url(#body-${uid})`}
            stroke={v.trim}
            strokeWidth="2.2"
          />

          {/* Vincos 3D do capô */}
          <path d="M23 10.5L24.5 16" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M41 10.5L39.5 16" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" strokeLinecap="round" />

          {/* Para-brisa dianteiro panorâmico */}
          <path d="M20.5 17.5C21.5 14 42.5 14 43.5 17.5L41.2 24.5H22.8L20.5 17.5Z" fill={`url(#glass-${uid})`} />
          <path d="M23.5 17.5C27 16.3 37 16.3 40.5 17.5" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeLinecap="round" />

          {/* Vidros laterais */}
          <path d="M19 25.5L21.5 26.5V41L19 42Z" fill="#0F172A" />
          <path d="M45 25.5L42.5 26.5V41L45 42Z" fill="#0F172A" />

          {/* Vidro traseiro */}
          <path d="M22.8 43H41.2L42.5 49.2C41.5 51.4 22.5 51.4 21.5 49.2L22.8 43Z" fill={`url(#glass-${uid})`} />

          {/* Teto 3D com borda iluminada */}
          <rect
            x="22"
            y="25"
            width="20"
            height={v.isVan ? '19.5' : '17.5'}
            rx="4.5"
            fill={v.roof}
            stroke="rgba(15,23,42,0.28)"
            strokeWidth="1"
          />

          {/* Luminoso de Táxi Oficial ou Giroflex SOS */}
          {isEmergency ? (
            <>
              <rect x="24" y="30.5" width="8" height="4.5" rx="1.5" fill="#EF4444" stroke="#FFFFFF" strokeWidth="0.9" />
              <rect x="32" y="30.5" width="8" height="4.5" rx="1.5" fill="#2563EB" stroke="#FFFFFF" strokeWidth="0.9" />
            </>
          ) : (
            v.isTaxi && (
              <>
                <rect x="25" y="31" width="14" height="5" rx="2" fill="#0F172A" />
                <rect x="27" y="32" width="10" height="3" rx="1" fill="#FACC15" />
              </>
            )
          )}

          {/* Faróis dianteiros LED e lanternas traseiras */}
          <rect x="19.5" y="8.8" width="6.5" height="2.6" rx="1.3" fill="#FEF9C3" />
          <rect x="38" y="8.8" width="6.5" height="2.6" rx="1.3" fill="#FEF9C3" />
          <rect x="19.5" y="53.5" width="6.5" height="2.2" rx="1.1" fill="#EF4444" />
          <rect x="38" y="53.5" width="6.5" height="2.2" rx="1.1" fill="#EF4444" />
        </svg>
      )}
    </div>
  );
}
