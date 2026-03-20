import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ThemeSwitcher from '../ThemeSwitcher.vue';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

// Mocking useTheme from vuetify
const mockTheme = {
  global: {
    name: {
      value: 'light'
    }
  }
};

vi.mock('vuetify', async () => {
  const actual = await vi.importActual('vuetify');
  return {
    ...actual as any,
    useTheme: () => mockTheme
  };
});

describe('ThemeSwitcher.vue', () => {
  const vuetify = createVuetify({ components, directives });

  beforeEach(() => {
    mockTheme.global.name.value = 'light';
    localStorage.clear();
  });

  it('renders correctly and shows the current theme icon', () => {
    const wrapper = mount(ThemeSwitcher, {
      global: {
        plugins: [vuetify]
      }
    });
    
    // Check if the button exists (it's the activator for v-menu)
    expect(wrapper.find('button').exists()).toBe(true);
  });

  it('sets the theme and saves it to localStorage when clicked', async () => {
    const wrapper = mount(ThemeSwitcher, {
      global: {
        plugins: [vuetify]
      }
    });

    // Directly call the method since v-menu/v-list might be hard to trigger in a shallow mount or without full DOM
    // Component's script is exposed to the wrapper.vm
    (wrapper.vm as any).setTheme('dark');

    expect(mockTheme.global.name.value).toBe('dark');
    expect(localStorage.getItem('user-theme')).toBe('dark');
  });

  it('restores the theme from localStorage on mount', () => {
    localStorage.setItem('user-theme', 'cyberpunk');
    
    mount(ThemeSwitcher, {
      global: {
        plugins: [vuetify]
      }
    });

    expect(mockTheme.global.name.value).toBe('cyberpunk');
  });
});
