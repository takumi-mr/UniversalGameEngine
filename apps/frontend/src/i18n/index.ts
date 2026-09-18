import { createI18n } from "vue-i18n";
import en from "@/i18n/locales/en.json";
import ja from "@/i18n/locales/ja.json";

type MessageSchema = typeof en;

const i18n = createI18n<[MessageSchema], "en" | "ja">({
  legacy: false, // Use Composition API
  locale: navigator.language.startsWith("ja") ? "ja" : "en",
  fallbackLocale: "en",
  messages: {
    en,
    ja,
  },
});

export default i18n;
