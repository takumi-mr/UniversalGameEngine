import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SoundDriver } from "@/sound/SoundDriver";

// jsdom には AudioContext が無いので、再生に必要な最小限のモックを入れる
class FakeGain {
  gain = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
}
const created: { sources: FakeSource[]; gains: FakeGain[] } = { sources: [], gains: [] };
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createGain() {
    const g = new FakeGain();
    created.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    created.sources.push(s);
    return s;
  }
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
    if (data.byteLength === 0) throw new Error("decode failed");
    return { duration: 1 };
  });
}

const okResponse = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
const notFound = () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

describe("SoundDriver", () => {
  let driver: SoundDriver;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created.sources = [];
    created.gains = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    fetchMock = vi.fn(async (url: string) => (url.includes("missing") ? notFound() : okResponse()));
    vi.stubGlobal("fetch", fetchMock);
    driver = new SoundDriver();
  });

  afterEach(() => {
    driver.resetForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preload した効果音を鳴らせる。同じ src は 1 回しかロードしない", async () => {
    await driver.preload({
      a: { src: "/sounds/x.mp3" },
      b: { src: "/sounds/x.mp3" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(driver.playSE("a")).toBe(true);
    expect(driver.playSE("b")).toBe(true);
    expect(created.sources.length).toBe(2);
    expect(created.sources[0].start).toHaveBeenCalledWith(0);
  });

  it("delayMs は AudioContext の時刻でスケジュールされる", async () => {
    await driver.preload({ a: { src: "/sounds/x.mp3" } });
    driver.playSE("a", 250);
    expect(created.sources[0].start).toHaveBeenCalledWith(0.25);
  });

  it("未登録キー・未ロードでは何もしない", async () => {
    expect(driver.playSE("nope")).toBe(false);
    await driver.preload({ a: { src: "/sounds/x.mp3" } });
    expect(driver.playSE("nope")).toBe(false);
  });

  it("音源が無いときは src ごとに 1 回だけ警告して無音にする", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await driver.preload({ a: { src: "/sounds/missing.mp3" }, b: { src: "/sounds/missing.mp3" } });
    await driver.preload({ c: { src: "/sounds/missing.mp3" } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(driver.playSE("a")).toBe(false);
    expect(driver.playSE("c")).toBe(false);
  });

  it("クールダウン中は鳴らさない", async () => {
    const now = vi.spyOn(performance, "now");
    await driver.preload({ a: { src: "/sounds/x.mp3", cooldownMs: 100 } });
    now.mockReturnValue(1000);
    expect(driver.playSE("a")).toBe(true);
    now.mockReturnValue(1050);
    expect(driver.playSE("a")).toBe(false);
    now.mockReturnValue(1100);
    expect(driver.playSE("a")).toBe(true);
  });

  it("同時発音数を超えると捨て、再生が終わると枠が空く", async () => {
    await driver.preload({ a: { src: "/sounds/x.mp3", maxPolyphony: 2 } });
    expect(driver.playSE("a")).toBe(true);
    expect(driver.playSE("a")).toBe(true);
    expect(driver.playSE("a")).toBe(false);
    created.sources[0].onended?.();
    expect(driver.playSE("a")).toBe(true);
  });

  it("音量は master / se の GainNode に反映され、ミュートで master が 0 になる", async () => {
    await driver.preload({ a: { src: "/sounds/x.mp3" } });
    // 最初に作られる 2 つが master / se
    const [master, se] = created.gains;
    driver.setVolumes({ master: 0.5, se: 0.25, bgm: 1, muted: false });
    expect(master.gain.value).toBe(0.5);
    expect(se.gain.value).toBe(0.25);
    driver.setVolumes({ master: 0.5, se: 0.25, bgm: 1, muted: true });
    expect(master.gain.value).toBe(0);
  });

  it("unloadAll で登録が消え、AudioContext が無い環境では何もしない", async () => {
    await driver.preload({ a: { src: "/sounds/x.mp3" } });
    driver.unloadAll();
    expect(driver.hasSE("a")).toBe(false);
    expect(driver.playSE("a")).toBe(false);

    vi.stubGlobal("AudioContext", undefined);
    const bare = new SoundDriver();
    expect(bare.available).toBe(false);
    await bare.preload({ a: { src: "/sounds/x.mp3" } });
    expect(bare.playSE("a")).toBe(false);
  });
});
