import React, { useState, memo, useCallback } from 'react';
import { 
  Modal, View, Text, TouchableOpacity, TextInput, 
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface RatingModalProps {
  visible: boolean;
  targetName: string;
  isDriverEvaluating?: boolean;
  onClose?: () => void;
  // Alterado para permitir que o modal aguarde o processamento externo
  onSubmit: (stars: number, tags: string[], comment: string) => Promise<void> | void;
}

const TAGS_PARA_MOTORISTA = ['VEICULO_LIMPO', 'BOM_MOTORISTA', 'PONTUAL', 'DIRECAO_SEGURA', 'RESPEITOSO'];
const TAGS_PARA_PASSAGEIRO = ['PONTUAL', 'RESPEITOSO', 'LOCAL_FACIL', 'ORGANIZADO'];

export const RatingModal = memo(function RatingModal({ 
  visible, 
  targetName, 
  isDriverEvaluating = false,
  onClose,
  onSubmit 
}: RatingModalProps) {
  const { t } = useTranslation();
  const [stars, setStars] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableTags = isDriverEvaluating ? TAGS_PARA_PASSAGEIRO : TAGS_PARA_MOTORISTA;

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    
    Keyboard.dismiss();
    setIsSubmitting(true);
    
    try {
      await onSubmit(stars, selectedTags, comment);
      // Limpa os estados apenas se for bem-sucedido
      setStars(5);
      setSelectedTags([]);
      setComment('');
    } catch (error) {
      console.warn('Erro ao submeter avaliação', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={isSubmitting ? undefined : onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, width: '100%' }}>
          <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
            <View style={styles.container}>
              {onClose && !isSubmitting && (
                <TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={isSubmitting}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              )}

              <Text style={styles.title}>{t('how_was_the_ride', 'Como foi a viagem?')}</Text>
              <Text style={styles.subtitle}>
                {t('rate_experience_with', 'Avalie sua experiência com')} {targetName}
              </Text>

              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity 
                    key={star} 
                    onPress={() => setStars(star)} 
                    activeOpacity={0.6} 
                    style={{ padding: 4 }}
                    disabled={isSubmitting}
                  >
                    <Ionicons 
                      name={star <= stars ? 'star' : 'star-outline'} 
                      size={36} 
                      color={star <= stars ? '#EAB308' : '#CBD5E1'} 
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.tagTitle}>Destaques da viagem:</Text>
              <View style={styles.tagsContainer}>
                {availableTags.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.tagItem, active && styles.tagItemActive, isSubmitting && { opacity: 0.5 }]}
                      onPress={() => toggleTag(tag)}
                      activeOpacity={0.7}
                      disabled={isSubmitting}
                    >
                      <Text style={[styles.tagText, active && styles.tagTextActive]}>
                        {/* 🛡️ CORRIGIDO: Regex para remover todos os underlines, não apenas o primeiro */}
                        {tag.replace(/_/g, ' ')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={styles.input}
                placeholder={t('write_comment_optional', 'Escreva um comentário (opcional)...')}
                placeholderTextColor="#9CA3AF"
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={3}
                editable={!isSubmitting}
              />

              <TouchableOpacity 
                style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]} 
                onPress={handleSubmit} 
                activeOpacity={0.8}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitButtonText}>{t('submit_rating_btn', 'Enviar Avaliação')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.75)' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  container: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, alignItems: 'center', position: 'relative' },
  closeButton: { position: 'absolute', top: 16, right: 16, zIndex: 10, padding: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 6, textAlign: 'center', marginTop: 8 },
  subtitle: { fontSize: 14, color: '#64748B', marginBottom: 16, textAlign: 'center' },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 16 },
  tagTitle: { fontSize: 13, fontWeight: '600', color: '#64748B', alignSelf: 'flex-start', marginBottom: 8 },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16, width: '100%' },
  tagItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  tagItemActive: { backgroundColor: '#FEF08A', borderColor: '#EAB308' },
  tagText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  tagTextActive: { color: '#713F12' },
  input: { width: '100%', backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, textAlignVertical: 'top', marginBottom: 20, color: '#0F172A', borderWidth: 1, borderColor: '#E2E8F0', minHeight: 70 },
  submitButton: { width: '100%', backgroundColor: '#EAB308', paddingVertical: 16, borderRadius: 12, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  submitButtonDisabled: { backgroundColor: '#FDE047', opacity: 0.7 },
  submitButtonText: { color: '#0F172A', fontWeight: '800', fontSize: 16 },
});