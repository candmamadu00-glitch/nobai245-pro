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
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('privacy_policy_title', 'Políticas de Privacidade')}</Text>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.closeButton}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* Conteúdo */}
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Text style={styles.updateText}>{t('last_updated_date', 'Última atualização: Setembro de 2026')}</Text>

          <Text style={styles.sectionTitle}>{t('privacy_sec1_title', '1. Coleta de Dados Pessoais')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec1_desc', 'O aplicativo Nobai245 coleta informações fornecidas diretamente por você durante o cadastro e uso dos serviços na Guiné-Bissau, incluindo nome completo, número de telefone/WhatsApp, endereço de e-mail e dados de transação.')}
          </Text>

          <Text style={styles.sectionTitle}>{t('privacy_sec2_title', '2. Uso do GPS e Geolocalização em Segundo Plano')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec2_desc', 'Para garantir o cálculo preciso das tarifas, estimativa de tempo de chegada e segurança durante o percurso, o Nobai245 coleta dados de localização precisa (latitude e longitude):')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>{t('foreground_label', 'Em primeiro plano:')}</Text>{' '}
            {t('foreground_desc', 'Enquanto o aplicativo está aberto em sua tela para selecionar pontos de partida e destino.')}
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>{t('background_label', 'Em segundo plano:')}</Text>{' '}
            {t('background_desc', 'Durante uma corrida ativa, mesmo quando o aplicativo estiver minimizado ou com a tela bloqueada. Isso permite o rastreamento do trajeto em tempo real e possibilita que seus contatos de emergência acompanhem sua viagem.')}
          </Text>

          <Text style={styles.sectionTitle}>{t('privacy_sec3_title', '3. Pagamentos e Mobile Money')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec3_desc', 'Para o processamento de corridas e recargas na carteira digital via Orange Money e MTN MoMo, solicitamos e armazenamos com segurança o número da conta/telefone associado ao pagamento. Não armazenamos senhas de acesso às suas carteiras móveis.')}
          </Text>

          <Text style={styles.sectionTitle}>{t('privacy_sec4_title', '4. Compartilhamento e Segurança de Dados')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec4_desc', 'Seus dados são compartilhados estritamente com os motoristas parceiros designados para a sua corrida (apenas nome e localização de embarque/desembarque) e com seus contatos de emergência previamente cadastrados ao acionar a função de alerta. O Nobai245 adota criptografia ponta a ponta e padrões rígidos de armazenamento seguro de dados.')}
          </Text>

          <Text style={styles.sectionTitle}>{t('privacy_sec5_title', '5. Direitos do Usuário e Exclusão de Conta')}</Text>
          <Text style={styles.paragraph}>
            {t('privacy_sec5_desc', 'Você tem o direito de consultar, alterar ou solicitar a exclusão definitiva dos seus dados e do seu histórico a qualquer momento diretamente pela aba "Meu Perfil" do aplicativo.')}
          </Text>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={onClose}
            activeOpacity={0.8}
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
      android: { elevation: 2 },
    }),
  },
  headerTitle: { 
    fontSize: 18, 
    fontWeight: '700', 
    color: '#0F172A' 
  },
  closeButton: { 
    padding: 4 
  },
  content: { 
    flex: 1, 
    paddingHorizontal: 20, 
    paddingTop: 20 
  },
  updateText: { 
    fontSize: 13, 
    color: '#64748B', 
    marginBottom: 20,
    fontWeight: '500'
  },
  sectionTitle: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#0F172A', 
    marginTop: 16, 
    marginBottom: 8 
  },
  paragraph: { 
    fontSize: 14, 
    color: '#334155', 
    lineHeight: 24, 
    marginBottom: 12 
  },
  bullet: { 
    fontSize: 14, 
    color: '#334155', 
    lineHeight: 22, 
    marginLeft: 8, 
    marginBottom: 8 
  },
  bold: { 
    fontWeight: '700', 
    color: '#0F172A' 
  },
  actionButton: {
    backgroundColor: '#EAB308',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 32,
  },
  actionButtonText: { 
    color: '#0F172A', 
    fontWeight: '700', 
    fontSize: 16 
  },
});