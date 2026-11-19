import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  createContext,
  useContext,
  useState,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { createRoot } from 'react-dom/client';

let mapboxAccessToken =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg';

let mapboxLoadPromise: Promise<any> | null = null;

function loadMapboxGL(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if ((window as any).mapboxgl) return Promise.resolve((window as any).mapboxgl);
  if (mapboxLoadPromise) return mapboxLoadPromise;

  mapboxLoadPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('mapbox-gl-css')) {
      const link = document.createElement('link');
      link.id = 'mapbox-gl-css';
      link.rel = 'stylesheet';
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js';
    script.async = true;
    script.onload = () => {
      const mbgl = (window as any).mapboxgl;
      if (mbgl && mapboxAccessToken) {
        mbgl.accessToken = mapboxAccessToken;
      }
      resolve(mbgl);
    };
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });

  return mapboxLoadPromise;
}

const MapContext = createContext<{ map: any; isLoaded: boolean }>({
  map: null,
  isLoaded: false,
});

const StyleURL = {
  Street: 'mapbox://styles/mapbox/streets-v12',
  Dark: 'mapbox://styles/mapbox/dark-v11',
  Light: 'mapbox://styles/mapbox/light-v11',
  Outdoors: 'mapbox://styles/mapbox/outdoors-v12',
  Satellite: 'mapbox://styles/mapbox/satellite-v9',
  SatelliteStreet: 'mapbox://styles/mapbox/satellite-streets-v12',
};

const offlineManager = {
  getPacks: async () => [],
  createPack: async () => {},
  deletePack: async () => {},
};

const MapView = ({
  style,
  styleURL = StyleURL.Street,
  onCameraChanged,
  onMapIdle,
  children,
}: any) => {
  const containerRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const [mapState, setMapState] = useState<{ map: any; isLoaded: boolean }>({
    map: null,
    isLoaded: false,
  });

  const onCameraChangedRef = useRef(onCameraChanged);
  onCameraChangedRef.current = onCameraChanged;
  const onMapIdleRef = useRef(onMapIdle);
  onMapIdleRef.current = onMapIdle;

  useEffect(() => {
    let active = true;
    let map: any = null;

    loadMapboxGL()
      .then((mapboxgl) => {
        if (!active || !mapboxgl || !containerRef.current) return;
        if (mapboxAccessToken) mapboxgl.accessToken = mapboxAccessToken;

        map = new mapboxgl.Map({
          container: containerRef.current,
          style: styleURL || StyleURL.Street,
          center: [-15.58, 11.86],
          zoom: 14,
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        map.on('load', () => {
          if (active) {
            setMapState({ map, isLoaded: true });
          }
        });

        map.on('movestart', (e: any) => {
          if (onCameraChangedRef.current) {
            onCameraChangedRef.current({
              gestures: { isGestureActive: Boolean(e?.originalEvent) },
            });
          }
        });

        map.on('moveend', () => {
          if (onMapIdleRef.current && map) {
            const center = map.getCenter();
            onMapIdleRef.current({
              geometry: {
                type: 'Point',
                coordinates: [center.lng, center.lat],
              },
            });
          }
        });
      })
      .catch((err) => console.warn('[MapboxWeb] Falha ao carregar GL JS:', err));

    return () => {
      active = false;
      if (map) {
        try {
          map.remove();
        } catch (_) {}
      }
    };
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current && styleURL) {
      try {
        mapInstanceRef.current.setStyle(styleURL);
      } catch (_) {}
    }
  }, [styleURL]);

  return (
    <MapContext.Provider value={mapState}>
      <View style={[styles.container, style]}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', position: 'relative' }}
        />
        {children}
      </View>
    </MapContext.Provider>
  );
};

const Camera = forwardRef(({ zoomLevel = 14, centerCoordinate, animationDuration = 800 }: any, ref) => {
  const { map } = useContext(MapContext);
  const initializedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    setCamera: (opts: any) => {
      if (!map || !opts) return;
      const next: any = {};
      if (Array.isArray(opts.centerCoordinate) && opts.centerCoordinate.length >= 2) {
        next.center = [Number(opts.centerCoordinate[0]), Number(opts.centerCoordinate[1])];
      }
      if (typeof opts.zoomLevel === 'number') {
        next.zoom = opts.zoomLevel;
      }
      if (typeof opts.animationDuration === 'number') {
        next.duration = opts.animationDuration;
      }
      try {
        map.flyTo(next);
      } catch (_) {}
    },
    fitBounds: (ne: number[], sw: number[], padding: any = 60, duration = 800) => {
      if (!map || !Array.isArray(ne) || !Array.isArray(sw)) return;
      const pad = Array.isArray(padding)
        ? { top: padding[0] || 60, right: padding[1] || 40, bottom: padding[2] || 260, left: padding[3] || 40 }
        : Number(padding || 60);
      try {
        map.fitBounds(
          [
            [Number(sw[0]), Number(sw[1])],
            [Number(ne[0]), Number(ne[1])],
          ],
          { padding: pad, duration, maxZoom: 16 }
        );
      } catch (_) {}
    },
  }));

  useEffect(() => {
    if (!map || !Array.isArray(centerCoordinate) || centerCoordinate.length < 2) return;
    const [lng, lat] = centerCoordinate.map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      map.jumpTo({ center: [lng, lat], zoom: zoomLevel });
    } else {
      map.easeTo({ center: [lng, lat], zoom: zoomLevel, duration: animationDuration });
    }
  }, [map, centerCoordinate?.[0], centerCoordinate?.[1], zoomLevel]);

  return null;
});

const ShapeSource = ({ id, shape, children }: any) => {
  const { map, isLoaded } = useContext(MapContext);
  const sourceId = id || 'routeSource';

  useEffect(() => {
    if (!map || !isLoaded || !shape) return;

    const applySource = () => {
      try {
        const existing = map.getSource(sourceId);
        if (existing) {
          existing.setData(shape);
        } else {
          map.addSource(sourceId, { type: 'geojson', data: shape });
        }
      } catch (_) {}
    };

    applySource();
    map.on('style.load', applySource);
    return () => {
      map.off('style.load', applySource);
      try {
        if (map.getSource(sourceId)) {
          map.getStyle()?.layers?.forEach((l: any) => {
            if (l.source === sourceId && map.getLayer(l.id)) {
              map.removeLayer(l.id);
            }
          });
          map.removeSource(sourceId);
        }
      } catch (_) {}
    };
  }, [map, isLoaded, sourceId, shape]);

  return (
    <>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { sourceId })
          : child
      )}
    </>
  );
};

const LineLayer = ({ id, sourceId = 'routeSource', style }: any) => {
  const { map, isLoaded } = useContext(MapContext);
  const layerId = id || 'routeLine';

  useEffect(() => {
    if (!map || !isLoaded) return;

    const applyLayer = () => {
      try {
        if (!map.getSource(sourceId)) return;
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
              'line-cap': style?.lineCap || 'round',
              'line-join': style?.lineJoin || 'round',
            },
            paint: {
              'line-color': style?.lineColor || '#EAB308',
              'line-width': style?.lineWidth || 5,
            },
          });
        }
      } catch (_) {}
    };

    applyLayer();
    map.on('style.load', applyLayer);
    return () => {
      map.off('style.load', applyLayer);
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      } catch (_) {}
    };
  }, [map, isLoaded, layerId, sourceId, style?.lineColor, style?.lineWidth]);

  return null;
};

const PointAnnotation = ({ coordinate, anchor, children }: any) => {
  const { map, isLoaded } = useContext(MapContext);
  const markerRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!map || !isLoaded || !Array.isArray(coordinate) || coordinate.length < 2) return;
    const mbgl = (window as any).mapboxgl;
    if (!mbgl) return;

    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.pointerEvents = 'auto';
    elRef.current = el;

    const root = createRoot(el);
    rootRef.current = root;
    root.render(children);

    const anchorMode = anchor && anchor.y >= 0.75 ? 'bottom' : 'center';
    const marker = new mbgl.Marker({ element: el, anchor: anchorMode })
      .setLngLat([Number(coordinate[0]), Number(coordinate[1])])
      .addTo(map);
    markerRef.current = marker;

    return () => {
      try {
        marker.remove();
      } catch (_) {}
      setTimeout(() => {
        try {
          root.unmount();
        } catch (_) {}
      }, 0);
      markerRef.current = null;
      rootRef.current = null;
    };
  }, [map, isLoaded]);

  useEffect(() => {
    if (markerRef.current && Array.isArray(coordinate) && coordinate.length >= 2) {
      const lng = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        markerRef.current.setLngLat([lng, lat]);
      }
    }
  }, [coordinate?.[0], coordinate?.[1]]);

  useEffect(() => {
    if (rootRef.current) {
      rootRef.current.render(children);
    }
  }, [children]);

  return null;
};

const Mapbox = {
  setAccessToken: (token: string) => {
    mapboxAccessToken = token;
    if (typeof window !== 'undefined' && (window as any).mapboxgl) {
      (window as any).mapboxgl.accessToken = token;
    }
  },
  StyleURL,
  offlineManager,
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  PointAnnotation,
};

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
});

export default Mapbox;
export { StyleURL, offlineManager, MapView, Camera, ShapeSource, LineLayer, PointAnnotation };
