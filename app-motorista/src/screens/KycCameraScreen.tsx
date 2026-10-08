import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { api } from '../services/api';

interface KycCameraProps {
  documentType: 'CNH' | 'VEHICLE_DOC';
  onSuccess: (imageUrl: string) => void;
  onCancel: () => void;
}

export function KycCameraScreen({ documentType, onSuccess, onCancel }: KycCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<any>(null);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Precisamos de acesso à câmera para validar seus documentos no cadastro.</Text>
        <TouchableOpacity style={styles.actionButton} onPress={requestPermission}>
          <Text style={styles.actionButtonText}>Conceder Permissão</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleTakePicture = async () => {
    if (cameraRef.current) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
        skipProcessing: false,
      });
      setPhotoUri(photo.uri);
    }
  };

  const handleRetake = async () => {
    await Haptics.selectionAsync();
    setPhotoUri(null);
  };

  const handleConfirmPhoto = async () => {
    if (!photoUri) return;

    try {
      setUploading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      const formData = new FormData();
      const filename = photoUri.split('/').pop() || 'document.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      formData.append('file', {
        uri: photoUri,
        name: filename,
        type,
      } as any);

      formData.append('documentType', documentType);

      const response = await api.post('/drivers/kyc-document', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 45000,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess(response.data.fileUrl);
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erro no envio', 'Não foi possível enviar o documento. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      {photoUri ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: photoUri }} style={styles.previewImage} />
          {uploading ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#059669" />
              <Text style={styles.uploadingText}>Verificando e enviando documento...</Text>
            </View>
          ) : (
            <View style={styles.previewActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleRetake}>
                <Text style={styles.secondaryButtonText}>Tirar Novamente</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={handleConfirmPhoto}>
                <Text style={styles.actionButtonText}>Usar Esta Foto</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        <CameraView style={styles.camera} facing="back" ref={cameraRef}>
          <View style={styles.overlay}>
            <View style={styles.maskTop} />
            <View style={styles.maskMiddle}>
              <View style={styles.maskLeft} />
              <View style={styles.cropWindow}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
              <View style={styles.maskRight} />
            </View>
            <View style={styles.maskBottom}>
              <Text style={styles.instructionText}>
                {documentType === 'CNH' ? 'Posicione a CNH (Frente) dentro do quadro' : 'Posicione o Documento do Veículo dentro do quadro'}
              </Text>
              <View style={styles.controlsRow}>
                <TouchableOpacity style={styles.cancelTextButton} onPress={onCancel}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shutterButton} onPress={handleTakePicture}>
                  <View style={styles.shutterInner} />
                </TouchableOpacity>
                <View style={{ width: 60 }} />
              </View>
            </View>
          </View>
        </CameraView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#111827' },
  permissionText: { color: '#FFFFFF', textAlign: 'center', fontSize: 16, marginBottom: 20 },
  camera: { flex: 1 },
  overlay: { flex: 1 },
  maskTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  maskMiddle: { height: 240, flexDirection: 'row' },
  maskLeft: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  cropWindow: { width: 320, height: 240, borderWidth: 1, borderColor: '#059669', position: 'relative' },
  maskRight: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  maskBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 24 },
  corner: { position: 'absolute', width: 20, height: 20, borderColor: '#059669' },
  topLeft: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4 },
  topRight: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4 },
  bottomLeft: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4 },
  bottomRight: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4 },
  instructionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 30 },
  shutterButton: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#059669' },
  cancelTextButton: { width: 60 },
  cancelText: { color: '#FFFFFF', fontSize: 16 },
  previewContainer: { flex: 1, justifyContent: 'space-between' },
  previewImage: { flex: 1, resizeMode: 'contain' },
  previewActions: { flexDirection: 'row', padding: 20, backgroundColor: '#111827', gap: 12 },
  actionButton: { flex: 1, backgroundColor: '#059669', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  actionButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  secondaryButton: { flex: 1, backgroundColor: '#374151', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  uploadingText: { color: '#FFFFFF', marginTop: 12, fontSize: 15 }
});