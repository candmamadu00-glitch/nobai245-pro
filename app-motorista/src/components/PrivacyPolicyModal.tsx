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

interface PrivacyPolicyModalProps {
  visible: boolean;
  onClose: () => void;
}

export function PrivacyPolicyModal({ visible, onClose }: PrivacyPolicyModalProps) {
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
          <Text style={styles.headerTitle}>Políticas de Privacidade</Text>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.closeButton}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#111827" />
          </TouchableOpacity>
        </View>

        {/* Conteúdo */}
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Text style={styles.updateText}>Última atualização: Setembro de 2026</Text>

          <Text style={styles.sectionTitle}>1. Coleta de Dados Pessoais e Veiculares</Text>
          <Text style={styles.paragraph}>
            Para validar seu cadastro como motorista parceiro na Guiné-Bissau, o Nobai245 coleta: nome completo, telefone (+245), fotos de documentos oficiais (BI/Passaporte e Carta de Condução), além de dados e fotos do veículo (marca, modelo, cor e placa).
          </Text>

          <Text style={styles.sectionTitle}>2. GPS e Rastreamento em Segundo Plano</Text>
          <Text style={styles.paragraph}>
            O aplicativo do motorista coleta dados de localização precisa (GPS) constantemente para garantir o funcionamento do serviço. O rastreamento ocorre:
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Em primeiro plano:</Text> Para exibir o mapa de navegação e as solicitações de viagem próximas a você.
          </Text>
          <Text style={styles.bullet}>
            • <Text style={styles.bold}>Em segundo plano (Background):</Text> <Text style={styles.highlightText}>O aplicativo continua coletando sua localização mesmo quando está fechado, minimizado ou não está em uso na tela principal.</Text> Isso é obrigatório para: enviar novas corridas baseadas na sua posição real, calcular a distância e o valor exato da tarifa, e garantir a sua segurança e a do passageiro durante o trajeto.
          </Text>

          <Text style={styles.sectionTitle}>3. Repasses e Mobile Money</Text>
          <Text style={styles.paragraph}>
            Armazenamos seu número de telefone associado à sua carteira Orange Money ou MTN MoMo exclusivamente para automatizar o pagamento dos seus ganhos semanais/diários. Nenhuma senha ou PIN de transação é coletado ou armazenado pelo nosso sistema.
          </Text>

          <Text style={styles.sectionTitle}>4. Compartilhamento de Informações</Text>
          <Text style={styles.paragraph}>
            Quando você aceita uma corrida, compartilhamos com o passageiro solicitante: seu primeiro nome, sua foto de perfil, a placa e o modelo do seu veículo, e sua localização em tempo real até o fim da viagem. Isso garante a identificação e a segurança mútua da plataforma.
          </Text>

          <Text style={styles.sectionTitle}>5. Direitos e Exclusão de Conta</Text>
          <Text style={styles.paragraph}>
            Você tem total controle sobre seus dados. A qualquer momento, você pode solicitar a alteração de dados cadastrais ou a exclusão definitiva da sua conta e de todos os documentos enviados através da aba "Meu Perfil" no aplicativo.
          </Text>

          <TouchableOpacity 
            style={styles.actionButton} 
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonText}>Compreendi e Concordo</Text>
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
      android: { elevation: 2 },
    }),
  },
  headerTitle: { 
    fontSize: 18, 
    fontWeight: '800', 
    color: '#111827' 
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
    color: '#6B7280', 
    marginBottom: 20,
    fontWeight: '600'
  },
  sectionTitle: { 
    fontSize: 16, 
    fontWeight: '800', 
    color: '#111827', 
    marginTop: 18, 
    marginBottom: 8 
  },
  paragraph: { 
    fontSize: 14, 
    color: '#4B5563', 
    lineHeight: 22, 
    marginBottom: 12 
  },
  bullet: { 
    fontSize: 14, 
    color: '#4B5563', 
    lineHeight: 22, 
    marginLeft: 8, 
    marginBottom: 8 
  },
  bold: { 
    fontWeight: '800', 
    color: '#111827' 
  },
  highlightText: {
    color: '#059669', // Destaque verde para chamar a atenção dos revisores das lojas
    fontWeight: '600'
  },
  actionButton: {
    backgroundColor: '#059669', // Verde padrão do app motorista
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 32,
    elevation: 2,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  actionButtonText: { 
    color: '#FFFFFF', 
    fontWeight: 'bold', 
    fontSize: 16 
  },
});