import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import ptBR from "./locales/pt-BR.json";
import id from "./locales/id.json";
const resources = {
  en: {
    translation: en,
  },
  ru: {
    translation: ru,
  },
  zh: {
    translation: zh,
  },
  ja: {
    translation: ja,
  },
  "pt-BR": {
    translation: ptBR,
  },
  id: {
    translation: id,
  },
};

function resolveInitialLanguage(): string {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    return window.localStorage.getItem("language") || "en";
  } catch {
    return "en";
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
