export const theme = {
  colors: {
    // Cores Principais inspiradas na logo e no design bancário
    primaryDark: '#0F2537',      // Azul Marinho Fechado (Header Topo)
    primaryBlue: '#1D4ED8',      // Azul Royal (Destaque de Rota/GPS)
    accentYellow: '#FFCC00',     // Amarelo Ouro (Botões de Acesso / Destaque)
    accentOrange: '#FF6600',     // Laranja Nobai (Ações de Impacto)
    emeraldGreen: '#059669',     // Verde Sucesso / Ganhos
    dangerRed: '#DC2626',        // Vermelho Alerta / SOS
    
    // Neutros
    background: '#F1F5F9',       // Fundo suave de tela
    surfaceWhite: '#FFFFFF',     // Cards e Folha Branca
    textPrimary: '#0F172A',      // Texto escuro
    textSecondary: '#64748B',    // Texto cinza
    textLight: '#94A3B8',        // Texto desabilitado
    border: '#E2E8F0',           // Divisores finos
  },

  borderRadius: {
    sm: 8,
    md: 14,
    lg: 20,
    xl: 28, // Cantos da folha de conteúdo estilo App Banco
    pill: 50,
  },

  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
    floating: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 10,
    }
  }
};