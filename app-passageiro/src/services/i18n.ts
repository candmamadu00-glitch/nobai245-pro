import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_KEY = '@bai245:selected_language';

export const resources = {
  pt: {
    translation: {
      where_to: "Para onde vamos?",
      select_destination: "Informe seu destino",
      pickup_location: "Local de partida",
      confirm_ride: "Confirmar Corrida",
      searching_driver: "Procurando motorista próximo...",
      driver_on_way: "Motorista a caminho",
      chat_with_driver: "Conversar com motorista",
      call_driver: "Ligar para motorista",
      cancel_ride: "Cancelar Corrida",
      emergency_sos: "SOS / Emergência",
      type_message: "Digite uma mensagem...",
      hold_to_record: "Segure para gravar áudio",
      select_language: "Idioma",

      greeting: "Olá",
      passenger: "Passageiro",
      enter_destination_placeholder: "Digite seu destino...",
      next_btn: "Avançar",
      where_do_you_want_to_go: "Aonde você quer ir?",
      getting_location: "Obtendo localização exata...",
      try_again: "Tentar Novamente",
      save_home: "Salvar Casa",
      save_work: "Salvar Trabalho",
      reference_point: "Ponto de Referência (Opcional)",
      reference_placeholder: "Ex: Próximo à farmácia, casa azul...",
      back_btn: "Voltar",
      continue_btn: "Continuar",
      calculating: "Calculando...",

      service_type: "Tipo de Serviço",
      ride_service: "Viagem",
      delivery_service: "Entrega",
      rental_service: "Aluguel",
      select_coverage_region: "Selecione a Região de Cobertura",
      on_request: "Sob Consulta",
      vehicle_options: "Opções de Veículo",
      standard_vehicle: "Veículo Padrão",
      color_not_specified: "Cor não informada",
      no_license_plate: "SEM PLACA",

      searching_drivers_title: "Buscando motoristas...",
      locating_nearest_vehicle: "Localizando o veículo mais próximo de você.",
      cancel_search_btn: "Cancelar Busca",
      boarding_pin_title: "PIN DE EMBARQUE",
      tell_pin_to_driver_msg: "Fale este código ao motorista para iniciar a corrida",
      arriving_in: "Chegando em",
      destination_in: "Destino em", 
      ride_in_progress: "Viagem em andamento",
      driver_arrived: "O motorista chegou!",
      chat_with: "Chat com", 
      type_something: "Escreva algo...",

      payment_method: "Forma de Pagamento",
      cash: "Dinheiro",
      request_now_btn: "Pedir Agora",
      confirm_payment_msg: "Confirme o pagamento para solicitar sua viagem",
      total_amount: "Valor Total:",
      mobile_money_account: "Número da Conta Mobile Money",
      enter_4_digit_pin: "Digite seu PIN de 4 dígitos",
      confirm_pin_btn: "Confirmar PIN",

      my_profile: "Meu Perfil",
      my_rides: "Minhas Corridas",
      emergency_contacts: "Contatos de Emergência",
      help_center: "Central de Ajuda",
      logout: "Sair da Conta",

      warning_title: "Aviso ⚠️",
      error_title: "Erro",
      ride_accepted_title: "Corrida Aceita! 🚗",
      ride_accepted_msg: "aceitou sua viagem e está a caminho.",
      driver_arrived_title: "Motorista no Local! 📍",
      driver_arrived_alert_msg: "Seu motorista chegou ao ponto de partida e está te aguardando.",
      driver_cancelled_msg: "O motorista cancelou a corrida. Por favor, solicite um novo veículo.",
      cancelled_title: "Cancelado",
      ride_cancelled_msg: "Sua corrida foi cancelada.",
      cancellation_fee: "Taxa de cancelamento:",
      search_ended_title: "Busca Encerrada",
      no_drivers_found_msg: "Não encontramos motoristas disponíveis na sua região. Tente novamente.",
      select_origin_destination_msg: "Selecione a origem e o destino antes de solicitar.",
      invalid_pin_msg: "Por favor, digite o PIN correto de 4 dígitos.",
      server_error_msg: "Ocorreu um problema ao comunicar com os servidores.",
      no_response_title: "Sem resposta",
      no_driver_accepted_msg: "Nenhum motorista aceitou no momento. Tente novamente."
    }
  },
  cri: { 
    translation: {
      where_to: "Pa nunde ku no sta bai?",
      select_destination: "Skodje bu destino",
      pickup_location: "Ponto di partida",
      confirm_ride: "Confirma Viatji",
      searching_driver: "N sta djubi motorista ku sta pertu...",
      driver_on_way: "Motorista sta na kaminhu",
      chat_with_driver: "Fala ku motorista",
      call_driver: "Lama motorista",
      cancel_ride: "Kansela Viatji",
      emergency_sos: "SOS / Emergência",
      type_message: "Scribe un mensajen...",
      hold_to_record: "Perta pa grava áudio",
      select_language: "Língua",
      
      greeting: "Olá",
      passenger: "Pasajeru",
      enter_destination_placeholder: "Pui bu destino...",
      next_btn: "Avança",
      where_do_you_want_to_go: "Pa nunde ku bu misti bai?",
      getting_location: "Djubi undi ku bu sta...",
      try_again: "Tenta mas un bias",
      save_home: "Guarda kaza",
      save_work: "Guarda tarbadju",
      reference_point: "Ponto di referência (Opcional)",
      reference_placeholder: "Ex: Pertu di farmácia...",
      back_btn: "Bulta",
      continue_btn: "Continua",
      calculating: "Na calcula...",
      
      service_type: "Tipo di Sirbisu",
      ride_service: "Viatji",
      delivery_service: "Entrega",
      rental_service: "Aluger",
      select_coverage_region: "Skodje zona",
      on_request: "Preçu sob consulta",
      vehicle_options: "Opçon di Karru",
      standard_vehicle: "Karru Padrão",
      color_not_specified: "Kor ka staba",
      no_license_plate: "KA TENE MATRÍCULA",

      searching_drivers_title: "Na djubi motorista...",
      locating_nearest_vehicle: "Na djubi karru mas pertu.",
      cancel_search_btn: "Kansela Busca",
      boarding_pin_title: "PIN DI ENTRADA",
      tell_pin_to_driver_msg: "Fala motorista es código pa kumesa viatji",
      arriving_in: "Na tchega na",
      destination_in: "Destino na", 
      ride_in_progress: "Viatji na andamento",
      driver_arrived: "Motorista tchega dja!",
      chat_with: "Fala ku", 
      type_something: "Scribe un kusa...",
      
      payment_method: "Forma di Pagamento",
      cash: "Dinhero",
      request_now_btn: "Pidi gosi",
      confirm_payment_msg: "Confirma pagamento pa pidi viatji",
      total_amount: "Valor Total:",
      mobile_money_account: "Número di Conta Mobile Money",
      enter_4_digit_pin: "Pui bu PIN di 4 dígito",
      confirm_pin_btn: "Confirma PIN",
      
      my_profile: "Nha Perfil",
      my_rides: "Nha Viatjis",
      emergency_contacts: "Contatos di Emergência",
      help_center: "Centro di Ajuda",
      logout: "Sai di Conta",
      
      warning_title: "Aviso ⚠️",
      error_title: "Erro",
      ride_accepted_title: "Viatji Aceitadu! 🚗",
      ride_accepted_msg: "aceita bu viatji e sta na kaminhu.",
      driver_arrived_title: "Motorista dja tchega! 📍",
      driver_arrived_alert_msg: "Bu motorista dja tchega e sta sperau.",
      driver_cancelled_msg: "Motorista kansela viatji. Pidi utru karru.",
      cancelled_title: "Kanseladu",
      ride_cancelled_msg: "Bu viatji kanseladu.",
      cancellation_fee: "Taxa di kanselamento:",
      search_ended_title: "Busca Kaba",
      no_drivers_found_msg: "No ka atcha motorista na bu zona. Tenta mas un bias.",
      select_origin_destination_msg: "Skodje undi ku bu sta e undi ku bu misti bai.",
      invalid_pin_msg: "Por favor, pui PIN certu di 4 dígito.",
      server_error_msg: "Tene un problema ku servidor.",
      no_response_title: "Ka tene resposta",
      no_driver_accepted_msg: "Nen un motorista ka aceita. Tenta mas un bias."
    }
  },
  fr: { translation: { /* mantido */ } },
  en: { translation: { /* mantido */ } },
  es: { translation: { /* mantido */ } },
  ru: { translation: { /* mantido */ } },
  zh: { translation: { /* mantido */ } },
  de: { translation: { /* mantido */ } }
};

// Inicialização síncrona com fallback rápido
i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'pt', // idioma inicial até o AsyncStorage carregar
    fallbackLng: 'pt',
    interpolation: {
      escapeValue: false,
    },
  });

// Carrega o idioma salvo assincronamente após a inicialização
export const loadSavedLanguage = async () => {
  try {
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
    const deviceLanguage = Localization.getLocales()[0]?.languageCode || 'pt';
    const langToUse = savedLanguage || deviceLanguage;
    
    if (langToUse !== i18n.language) {
      await i18n.changeLanguage(langToUse);
    }
  } catch (error) {
    console.warn('Erro ao carregar idioma salvo:', error);
  }
};

// Executa o carregamento no boot da aplicação
loadSavedLanguage();

export const changeLanguage = async (languageCode: string) => {
  await AsyncStorage.setItem(LANGUAGE_KEY, languageCode);
  await i18n.changeLanguage(languageCode);
};

export default i18n;