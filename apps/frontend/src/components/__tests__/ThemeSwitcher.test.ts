import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ThemeSwitcher from "@/components/ThemeSwitcher.vue";
import { useUIStore } from "@/store/ui";

// コンポーネントテストの雛形: Vuetify を plugin として差し込み、Pinia は setActivePinia で有効化して mount する
// （mdi アイコンは <i class="mdi-xxx"> として描画されるので class で判定する）
function mountSwitcher() {
  const vuetify = createVuetify({
    components,
    directives,
    theme: {
      defaultTheme: "light",
      themes: { cyberpunk: { dark: true, colors: {} }, forest: { dark: false, colors: {} } },
    },
  });
  const wrapper = mount(ThemeSwitcher, { global: { plugins: [vuetify] } });
  return { wrapper, vuetify };
}

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("現在のテーマに対応するアイコンを表示する", () => {
    const { wrapper } = mountSwitcher();
    expect(wrapper.find(".v-icon").classes()).toContain("mdi-white-balance-sunny");
  });

  it("ストアのテーマ変更が Vuetify のテーマに同期される", async () => {
    const { wrapper, vuetify } = mountSwitcher();
    useUIStore().setTheme("cyberpunk");
    await wrapper.vm.$nextTick();
    expect(vuetify.theme.global.name.value).toBe("cyberpunk");
    expect(wrapper.find(".v-icon").classes()).toContain("mdi-robot");
  });
});
