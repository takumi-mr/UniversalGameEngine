import 'vuetify/styles';
import { createVuetify, type ThemeDefinition } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import '@mdi/font/css/materialdesignicons.css';

const cyberpunkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0a0a12',
    surface: '#151522',
    primary: '#f000ff',
    'primary-darken-1': '#7c0082',
    secondary: '#00f0ff',
    'secondary-darken-1': '#007b82',
    error: '#ff003c',
    info: '#2196F3',
    success: '#00ff9f',
    warning: '#ffb100',
  },
};

const forestTheme: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f1f8e9',
    surface: '#ffffff',
    primary: '#2e7d32',
    'primary-darken-1': '#1b5e20',
    secondary: '#8d6e63',
    'secondary-darken-1': '#4e342e',
    error: '#c62828',
    info: '#0277bd',
    success: '#2e7d32',
    warning: '#fbc02d',
  },
};

export default createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
    },
  },
  theme: {
    defaultTheme: 'dark',
    themes: {
      cyberpunk: cyberpunkTheme,
      forest: forestTheme,
    },
  },
});
