import { expect, test, describe } from "bun:test";
import { JsonCloneStrategy, StructuredCloneStrategy } from "./CloneStrategy";

describe("CloneStrategy", () => {
  const testData = {
    a: 1,
    b: "string",
    c: { d: true, e: [1, 2, 3] },
    f: null,
  };

  describe("JsonCloneStrategy", () => {
    const strategy = new JsonCloneStrategy<any>();

    test("should perform deep clone", () => {
      const cloned = strategy.clone(testData);
      expect(cloned).toEqual(testData);
      expect(cloned).not.toBe(testData);
      expect(cloned.c).not.toBe(testData.c);
      expect(cloned.c.e).not.toBe(testData.c.e);
    });

    test("should lose non-JSON types", () => {
      const complexData = {
        date: new Date(),
        undef: undefined,
      };
      const cloned = strategy.clone(complexData);
      expect(typeof cloned.date).toBe("string"); // Date becomes ISO string
      expect(cloned.undef).toBeUndefined(); // undefined is removed by stringify (or becomes undefined in parsed object if key was missing)
      expect(Object.keys(cloned)).not.toContain("undef");
    });
  });

  describe("StructuredCloneStrategy", () => {
    const strategy = new StructuredCloneStrategy<any>();

    test("should perform deep clone", () => {
      const cloned = strategy.clone(testData);
      expect(cloned).toEqual(testData);
      expect(cloned).not.toBe(testData);
      expect(cloned.c).not.toBe(testData.c);
    });

    test("should preserve complex types", () => {
      const date = new Date();
      const map = new Map([["key", "value"]]);
      const complexData = {
        date,
        map,
      };
      const cloned = strategy.clone(complexData);
      expect(cloned.date).toBeInstanceOf(Date);
      expect(cloned.date.getTime()).toBe(date.getTime());
      expect(cloned.map).toBeInstanceOf(Map);
      expect(cloned.map.get("key")).toBe("value");
    });
  });
});
