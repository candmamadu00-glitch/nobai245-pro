import React from 'react';
import { 
  Modal, 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Platform 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface PrivacyPolicyModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PrivacyPolicyModal({ visible, onClose }: PrivacyPolicyModalProps) {
  const { t } = useTranslation();

  return (
    <Modal 
      visible={visible} 
      animationType="slide" 
      transparent={false} 
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Cabeçalho */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="shield-checkmark-sharp" size={22} color="#059669" style={{ marginRight: 8 }} />
            <Text style={styles.headerTitle}>{t('driver_privacy_title', 'Termos de Privacidade do Motorista')}</Text>
          </View>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.closeButton}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#111827" />
          </TouchableOpacity>
        </View>

        {/* Conteúdo Profissional para Motoristas */}
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={styles.updateBadge}>
            <Ionicons name="document-text-outline" size={14} color="#059669" />
            <Text style={styles.updateText}>{t('driver_privacy_date', 'Última atualização: Setembro de 2026 • Padrão Motorista Parceiro')}</Text>
          </View>

          <Text style={styles.introParagraph}>
            {t('driver_privacy_intro', 'Como motorista parceiro Nobai245 na Guiné-Bissau, a proteção dos seus dados de verificação e a segurança operacional do seu veículo são prioridades legais da nossa plataforma.')}
          </Text>

          {/* Seção 1 */}
          <Text style={styles.sectionTitle}>{t('driver_sec1_title', '1. Coleta de Dados Pessoais, Documentos e Veículo')}</Text>
          <Text style={styles.paragraph}>
            {t('driver_sec1_desc', 'Para homologação do seu perfil profissional de transporte, o Nobai245 coleta e valida:')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Documentos Oficiais:</Text> Foto da Carta de Condução (Habilitação), BI/Passaporte e Selfie de Identificação.
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Dados do Veículo:</Text> Placa, marca, modelo, cor, foto do veículo e categoria de transporte.
          </Text>

          {/* Seção 2 */}
          <Text style={styles.sectionTitle}>{t('driver_sec2_title', '2. GPS Contínuo e Rastreamento em Segundo Plano')}</Text>
          <Text style={styles.paragraph}>
            {t('driver_sec2_desc', 'O aplicativo do motorista exige a coleta contínua da sua localização GPS precisa:')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Em Primeiro Plano:</Text> Para exibir solicitações de chamadas e rota de navegação em tempo real.
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Em Segundo Plano (Background):</Text> <Text style={styles.highlightText}>O aplicativo coleta seu GPS mesmo quando minimizado, fechado ou com a tela bloqueada enquanto seu status for "ONLINE".</Text> Isso é indispensável para: enviar chamadas de passageiros próximos da sua posição real, calcular a distância e valores de tarifas com precisão, e alimentar o sistema de segurança central e botão SOS.
          </Text>

          {/* Seção 3 */}
          <Text style={styles.sectionTitle}>{t('driver_sec3_title', '3. Carteira Digital e Repasses Mobile Money')}</Text>
          <Text style={styles.paragraph}>
            {t('driver_sec3_desc', 'Os dados da sua conta Orange Money e Telecel (antigo MTN MoMo) são armazenados de forma estritamente criptografada para processar o crédito automático das suas corridas e a cobrança da taxa da plataforma. O Nobai245 jamais solicitará suas senhas de acesso bancário ou PINs de carteira.')}
          </Text>

          {/* Seção 4 */}
          <Text style={styles.sectionTitle}>{t('driver_sec4_title', '4. Compartilhamento de Informações com Passageiros')}</Text>
          <Text style={styles.paragraph}>
            {t('driver_sec4_desc', 'Ao aceitar uma solicitação de viagem, são compartilhados com o passageiro apenas: seu primeiro nome, sua foto de perfil, a placa e modelo do veículo, e a sua posição no mapa até o término do trajeto.')}
          </Text>

          {/* Seção 5 */}
          <Text style={styles.sectionTitle}>{t('driver_sec5_title', '5. Segurança da Informação e Auditoria')}</Text>
          <Text style={styles.paragraph}>
            {t('driver_sec5_desc', 'Seus dados e documentos digitais são mantidos em servidores de alta segurança com criptografia de ponta a ponta, sendo acessados exclusivamente pela equipe de suporte para auditoria ou cumprimento de requisições judiciais legais.')}
          </Text>

          {/* Seção 6 */}
          <Text style={styles.sectionTitle}>{t('driver_sec6_title', '6. Direitos do Motorista e Exclusão da Conta')}</Text>
          <Text style={styles.paragraph}>
            {t('driver_sec6_desc', 'Você pode atualizar seus dados cadastrais ou solicitar o encerramento do vínculo e exclusão total dos seus documentos a qualquer momento na aba "Perfil" > "Excluir Conta".')}
          </Text>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.actionButtonText}>{t('driver_agree_btn', 'Compreendi e Concordo')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8FAFC' 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
      android: { elevation: 3 },
    }),
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: { 
    fontSize: 16, 
    fontWeight: '800', 
    color: '#111827',
    flex: 1,
  },
  closeButton: { 
    padding: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
  },
  content: { 
    flex: 1, 
    paddingHorizontal: 20, 
    paddingTop: 16 
  },
  updateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 16,
    gap: 6,
  },
  updateText: { 
    fontSize: 12, 
    color: '#047857', 
    fontWeight: '700'
  },
  introParagraph: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  sectionTitle: { 
    fontSize: 15, 
    fontWeight: '800', 
    color: '#111827', 
    marginTop: 18, 
    marginBottom: 8 
  },
  paragraph: { 
    fontSize: 14, 
    color: '#4B5563', 
    lineHeight: 22, 
    marginBottom: 10 
  },
  bullet: { 
    fontSize: 13, 
    color: '#4B5563', 
    lineHeight: 20, 
    marginLeft: 8, 
    marginBottom: 8 
  },
  bold: { 
    fontWeight: '800', 
    color: '#111827' 
  },
  highlightText: {
    color: '#059669',
    fontWeight: '700'
  },
  actionButton: {
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 28,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonText: { 
    color: '#FFFFFF', 
    fontWeight: '900', 
    fontSize: 15,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});