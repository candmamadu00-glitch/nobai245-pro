import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

function ErrorFallbackView({ onRestart }: { onRestart: () => void }) {
  const insets = useSafeAreaInsets();

  const dynamicTopPadding = Math.max((insets?.top || 0) + 16, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 20, Platform.OS === 'android' ? 32 : 20);

  return (
    <View style={[styles.container, { paddingTop: dynamicTopPadding, paddingBottom: dynamicBottomPadding }]}>
      <StatusBar barStyle="light-content" backgroundColor="#111827" translucent />
      
      <View style={styles.contentBox}>
        <Text style={styles.title}>Ops, algo inesperado ocorreu!</Text>
        <Text style={styles.subtitle}>
          Sua sessão está segura. O sistema registrou a falha e você pode tentar reconectar a tela agora.
        </Text>
        
        <TouchableOpacity style={styles.button} onPress={onRestart} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Recarregar Interface</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('❌ [UNCAUGHT ERROR]:', error, errorInfo);
  }

  private handleRestart = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Suprime erro caso o dispositivo não suporte Haptics
    }
    this.setState({ hasError: false });
  };

  public render() {
    if (this.state.hasError) {
      return <ErrorFallbackView onRestart={this.handleRestart} />;
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#111827',
  },
  contentBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#059669',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});