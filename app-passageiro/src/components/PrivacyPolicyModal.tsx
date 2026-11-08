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
            <Ionicons name="shield-checkmark" size={22} color="#EAB308" style={{ marginRight: 8 }} />
            <Text style={styles.headerTitle}>{t('privacy_policy_title', 'Política de Privacidade e Proteção de Dados')}</Text>
          </View>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.closeButton}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* Conteúdo Institucional Enterprise */}
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={styles.updateBadge}>
            <Ionicons name="time-outline" size={14} color="#64748B" />
            <Text style={styles.updateText}>{t('last_updated_date', 'Última atualização: Setembro de 2026 • Versão 2.4 Enterprise')}</Text>
          </View>

          <Text style={styles.introParagraph}>
            {t('privacy_intro', 'A plataforma Nobai245 é comprometida com a transparência, segurança e privacidade dos seus dados pessoais no cumprimento das diretrizes internacionais de proteção de dados (LGPD/GDPR adaptadas à República da Guiné-Bissau).')}
          </Text>

          {/* Seção 1 */}
          <Text style={styles.sectionTitle}>{t('privacy_sec1_title', '1. Coleta e Tratamento de Dados Pessoais')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec1_desc', 'Coletamos estritamente as informações necessárias para prestar o serviço de transporte urbano com máxima eficiência e segurança na Guiné-Bissau, incluindo:')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>{t('privacy_data_identity', 'Dados de Identificação:')}</Text> Nome completo, número de telefone verificado (+245) e endereço de e-mail.
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>{t('privacy_data_trip', 'Dados de Viagem:')}</Text> Histórico de trajetos, endereços de embarque e desembarque, avaliações e relatórios de suporte.
          </Text>

          {/* Seção 2 */}
          <Text style={styles.sectionTitle}>{t('privacy_sec2_title', '2. Geolocalização em Primeiro e Segundo Plano')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec2_desc', 'Para operacionalizar a busca de motoristas próximos, cálculo tarifário transparente e segurança patrimonial, o Nobai245 coleta coordenadas exatas de GPS (latitude e longitude):')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>{t('foreground_label', 'Em Primeiro Plano (App Aberto):')}</Text>{' '}
            {t('foreground_desc', 'Usado para permitir a seleção precisa no mapa do seu ponto de embarque e acompanhamento da aproximação do veículo.')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>{t('background_label', 'Em Segundo Plano (Background):')}</Text>{' '}
            {t('background_desc', 'Utilizado exclusivamente durante uma corrida em andamento. Mesmo que você minimize o aplicativo ou bloqueie a tela do celular, o GPS continua ativo para assegurar o cálculo preciso da tarifa e permitir que o botão de emergência (SOS) transmita seu trajeto em tempo real para a central e contatos de segurança.')}
          </Text>

          {/* Seção 3 */}
          <Text style={styles.sectionTitle}>{t('privacy_sec3_title', '3. Transações Financeiras e Mobile Money')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec3_desc', 'Os pagamentos e recargas na carteira digital integrados ao Orange Money e MTN MoMo utilizam protocolos seguros de criptografia. Armazenamos apenas a referência da transação e o número de telefone de cobrança autorizada. O Nobai245 NUNCA solicita ou armazena PINs ou senhas secretas das suas contas bancárias ou carteiras móveis.')}
          </Text>

          {/* Seção 4 */}
          <Text style={styles.sectionTitle}>{t('privacy_sec4_title', '4. Compartilhamento Restrito de Informações')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec4_desc', 'Seus dados de perfil não são vendidos nem comercializados com terceiros. O compartilhamento ocorre única e exclusivamente em:')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Motorista Designado:</Text> Apenas seu primeiro nome, foto e pontos de embarque/desembarque para realização da viagem.
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Alerta SOS de Emergência:</Text> Envio automático da sua localização em tempo real para a central de monitoramento e contatos de confiança cadastrados.
          </Text>

          {/* Seção 5 */}
          <Text style={styles.sectionTitle}>{t('privacy_sec5_title', '5. Segurança da Informação e Criptografia')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec5_desc', 'Todas as comunicações entre o aplicativo e os nossos servidores utilizam protocolos criptografados SSL/TLS (HTTPS) e tokens bancários de autenticação JWT com expiração automática, impedindo interceptações não autorizadas.')}
          </Text>

          {/* Seção 6 */}
          <Text style={styles.sectionTitle}>{t('privacy_sec6_title', '6. Seus Direitos e Exclusão Definitiva da Conta')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec6_desc', 'Você possui total autonomia sobre seus dados. A qualquer momento, é possível consultar, editar ou solicitar a eliminação completa do seu cadastro e histórico de viagens diretamente no aplicativo em "Meu Perfil" > "Excluir Minha Conta".')}
          </Text>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.actionButtonText}>{t('understand_and_agree_btn', 'Entendi e Concordo')}</Text>
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
    borderBottomColor: '#E2E8F0',
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
    color: '#0F172A',
    flex: 1,
  },
  closeButton: { 
    padding: 6,
    backgroundColor: '#F1F5F9',
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
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 16,
    gap: 6,
  },
  updateText: { 
    fontSize: 12, 
    color: '#475569', 
    fontWeight: '600'
  },
  introParagraph: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  sectionTitle: { 
    fontSize: 15, 
    fontWeight: '800', 
    color: '#0F172A', 
    marginTop: 18, 
    marginBottom: 8 
  },
  paragraph: { 
    fontSize: 14, 
    color: '#334155', 
    lineHeight: 22, 
    marginBottom: 10 
  },
  bullet: { 
    fontSize: 13, 
    color: '#334155', 
    lineHeight: 20, 
    marginLeft: 8, 
    marginBottom: 8 
  },
  bold: { 
    fontWeight: '800', 
    color: '#0F172A' 
  },
  actionButton: {
    backgroundColor: '#EAB308',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 28,
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonText: { 
    color: '#0F172A', 
    fontWeight: '900', 
    fontSize: 15,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});