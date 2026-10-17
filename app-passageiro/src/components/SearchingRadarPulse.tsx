import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SearchingRadarPulseProps {
  statusText?: string;
}

export function SearchingRadarPulse({ statusText = "Procurando motoristas próximos..." }: SearchingRadarPulseProps) {
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createAnimation = (animValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animValue, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const anim1 = createAnimation(pulse1, 0);
    const anim2 = createAnimation(pulse2, 1000);

    anim1.start();
    anim2.start();

    return () => {
      anim1.stop();
      anim2.stop();
    };
  }, []);

  const getAnimatedStyle = (animValue: Animated.Value) => ({
    transform: [
      {
        scale: animValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0.6, 2.8],
        }),
      },
    ],
    opacity: animValue.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 0.3, 0],
    }),
  });

  return (
    <View style={styles.container} pointerEvents="none">
      {/* ONDA 1 DO RADAR */}
      <Animated.View style={[styles.pulseCircle, getAnimatedStyle(pulse1)]} />
      
      {/* ONDA 2 DO RADAR */}
      <Animated.View style={[styles.pulseCircle, getAnimatedStyle(pulse2)]} />

      {/* ÍCONE CENTRAL DE BUSCA */}
      <View style={styles.centerPin}>
        <Ionicons name="location" size={24} color="#0F172A" />
      </View>

      {/* PILL DE STATUS FLUTUANTE */}
      <View style={styles.statusBadge}>
        <View style={styles.radarDot} />
        <Text style={styles.statusText}>{statusText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  pulseCircle: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(234, 179, 8, 0.35)', // Cor Amarelo Ouro Nô Bai
    borderWidth: 1.5,
    borderColor: '#EAB308',
  },
  centerPin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EAB308',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  statusBadge: {
    position: 'absolute',
    top: '38%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
  },
  radarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  statusText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
});