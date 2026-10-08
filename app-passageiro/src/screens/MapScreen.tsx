import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import Mapbox from '@rnmapbox/maps';

const MAPBOX_ACCESS_TOKEN = 'SEU_MAPBOX_ACCESS_TOKEN';
Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);

export function MapScreen() {
  const [routeCoordinates, setRouteCoordinates] = useState<number[][]>([]);

  async function fetchRoute(origin: [number, number], destination: [number, number]) {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[MAPBOX] Erro na resposta HTTP: ${response.status}`);
        return;
      }

      const text = await response.text();
      if (!text || text.trim().length === 0) {
        console.warn('[MAPBOX] Resposta vazia recebida');
        return;
      }

      const data = JSON.parse(text);
      if (data.routes && data.routes.length > 0) {
        setRouteCoordinates(data.routes[0].geometry.coordinates);
      }
    } catch (error) {
      console.error('[MAPBOX] Erro ao buscar rota:', error);
    }
  }

  return (
    <View style={styles.container}>
      <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL.Street}>
        <Mapbox.Camera zoomLevel={14} centerCoordinate={[-15.58, 11.86]} />

        {routeCoordinates.length > 0 && (
          <Mapbox.ShapeSource
            id="routeSource"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: routeCoordinates,
              },
            }}
          >
            <Mapbox.LineLayer
              id="routeLayer"
              style={{
                lineColor: '#007AFF',
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});