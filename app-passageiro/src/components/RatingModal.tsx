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
  onSubmit: (stars: number, tags: string[], comment: string) => Promise<void> | void;
}

const TAGS_PARA_MOTORISTA = ['VEICULO_LIMPO', 'BOM_MOTORISTA', 'PONTUAL', 'DIRECAO_SEGURA', 'RESPEITOSO'];
const TAGS_PARA_PASSAGEIRO = ['PONTUAL', 'RESPEITOSO', 'LOCAL_FACIL', 'ORGANIZADO'];

const STAR_LABELS: Record<number, string> = {
  1: 'Muito insatisfeito',
  2: 'Pode melhorar',
  3: 'Viagem regular',
  4: 'Muito bom!',
  5: 'Excelente!',
};

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
                  <Ionicons name="close" size={20} color="#475569" />
                </TouchableOpacity>
              )}

              <View style={styles.trophyBadge}>
                <Ionicons name="star" size={24} color="#EAB308" />
              </View>

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
                      size={38} 
                      color={star <= stars ? '#EAB308' : '#CBD5E1'} 
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.starLabelPill}>
                <Text style={styles.starLabelText}>{STAR_LABELS[stars] || 'Excelente!'}</Text>
              </View>

              <Text style={styles.tagTitle}>O que mais se destacou?</Text>
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
                        {tag.replace(/_/g, ' ')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={styles.input}
                placeholder={t('write_comment_optional', 'Escreva um comentário (opcional)...')}
                placeholderTextColor="#94A3B8"
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={3}
                editable={!isSubmitting}
              />

              <TouchableOpacity 
                style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]} 
                onPress={handleSubmit} 
                activeOpacity={0.85}
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
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.78)' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  container: {
    backgroundColor: '#FFF',
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 16,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trophyBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FDE047',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 21, fontWeight: '900', color: '#0F172A', marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 13.5, color: '#64748B', marginBottom: 14, textAlign: 'center', fontWeight: '500' },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 8 },
  starLabelPill: { backgroundColor: '#FEF9C3', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginBottom: 16 },
  starLabelText: { fontSize: 12, fontWeight: '800', color: '#854D0E' },
  tagTitle: { fontSize: 12.5, fontWeight: '700', color: '#475569', alignSelf: 'flex-start', marginBottom: 8 },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16, width: '100%' },
  tagItem: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  tagItemActive: { backgroundColor: '#FEF08A', borderColor: '#EAB308' },
  tagText: { fontSize: 12, color: '#475569', fontWeight: '700', textTransform: 'capitalize' },
  tagTextActive: { color: '#713F12' },
  input: { width: '100%', backgroundColor: '#F8FAFC', borderRadius: 16, padding: 14, textAlignVertical: 'top', marginBottom: 20, color: '#0F172A', borderWidth: 1, borderColor: '#E2E8F0', minHeight: 74, fontSize: 13.5 },
  submitButton: {
    width: '100%',
    backgroundColor: '#EAB308',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    minHeight: 54,
    justifyContent: 'center',
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: { backgroundColor: '#FDE047', opacity: 0.7 },
  submitButtonText: { color: '#0F172A', fontWeight: '900', fontSize: 16 },
});
