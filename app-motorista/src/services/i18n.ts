import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Dicionário de traduções
const resources = {
  pt: {
    translation: {
      profileTitle: 'Meu Perfil',
      logout: 'Sair do Aplicativo',
      deleteAccount: 'Excluir Minha Conta',
      // Adicione mais chaves aqui com o tempo...
    },
  },
  en: {
    translation: {
      profileTitle: 'My Profile',
      logout: 'Logout',
      deleteAccount: 'Delete My Account',
    },
  },
  gnb: {
    translation: {
      profileTitle: 'Nha Perfil', // Exemplo em Crioulo de Guiné-Bissau
      logout: 'Sai di Aplicativu',
      deleteAccount: 'Apaga Nha Conta',
    },
  },
  fr: {
    translation: {
      profileTitle: 'Mon Profil',
      logout: 'Se Déconnecter',
      deleteAccount: 'Supprimer Mon Compte',
    },
  },
  es: {
    translation: {
      profileTitle: 'Mi Perfil',
      logout: 'Cerrar Sesión',
      deleteAccount: 'Eliminar Mi Cuenta',
    },
  },
  ru: {
    translation: {
      profileTitle: 'Мой профиль',
      logout: 'Выйти из приложения',
      deleteAccount: 'Удалить мой аккаунт',
    },
  },
  de: {
    translation: {
      profileTitle: 'Mein Profil',
      logout: 'Abmelden',
      deleteAccount: 'Mein Konto löschen',
    },
  },
};

i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v4', // Necessário para evitar erros no React Native
    resources,
    lng: 'pt', // Idioma padrão inicial
    fallbackLng: 'en', // Se faltar tradução, usa inglês
    interpolation: {
      escapeValue: false, // React já protege contra XSS
    },
  });

export default i18n;