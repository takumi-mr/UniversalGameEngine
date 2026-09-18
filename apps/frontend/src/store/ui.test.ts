import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUIStore } from "@/store/ui";

describe("useUIStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("保存された設定がなければ既定値（light / ja）", () => {
    const store = useUIStore();
    expect(store.theme).toBe("light");
    expect(store.locale).toBe("ja");
  });

  it("setTheme / setLocale は状態を更新し localStorage に永続化する", () => {
    const store = useUIStore();
    store.setTheme("dark");
    store.setLocale("en");
    expect(store.theme).toBe("dark");
    expect(store.locale).toBe("en");
    expect(localStorage.getItem("user-theme")).toBe("dark");
    expect(localStorage.getItem("user-locale")).toBe("en");
  });

  it("localStorage の値を初期状態として読み込む", () => {
    localStorage.setItem("user-theme", "cyberpunk");
    localStorage.setItem("user-locale", "en");
    const store = useUIStore();
    expect(store.theme).toBe("cyberpunk");
    expect(store.locale).toBe("en");
  });
});
