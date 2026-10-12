import { describe, expect, it } from "vitest";
import { alignGroup } from "./align";
import { findLabel } from "./catalogue";
import { designUsesBatch, emptyDesign, newText } from "./design";
import {
  categoryLabel,
  filterIcons,
  guessCategories,
  iconDisplayName,
  loadIconCatalog,
  lucideToSvg,
  searchIcons,
} from "./icons";
import { ICON_CATEGORIES } from "./icon-categories";
import { boxLines, snapMove, unionBox } from "./snap";

describe("snapMove", () => {
  it("snaps the nearest anchor (edge or centre) within the threshold and reports the guide", () => {
    const r = snapMove({ x: 10.4, y: 3, w: 10, h: 4 }, [15.5], [20], 0.75);
    expect(r.x).toBeCloseTo(10.5); // centre 15.4 → 15.5
    expect(r.guidesX).toEqual([15.5]);
    expect(r.y).toBe(3); // nothing near
    expect(r.guidesY).toEqual([]);
  });

  it("does not snap beyond the threshold", () => {
    expect(
      snapMove({ x: 0, y: 0, w: 4, h: 4 }, [10], [10], 0.75),
    ).toMatchObject({ x: 0, y: 0 });
  });

  it("box helpers", () => {
    expect(boxLines([{ x: 0, y: 0, w: 4, h: 2 }])).toEqual({
      xs: [0, 2, 4],
      ys: [0, 1, 2],
    });
    expect(
      unionBox([
        { x: 1, y: 1, w: 2, h: 2 },
        { x: 5, y: 0, w: 1, h: 1 },
      ]),
    ).toEqual({ x: 1, y: 0, w: 5, h: 3 });
  });
});

describe("alignGroup", () => {
  it("centres the group's bounding box and keeps the arrangement", () => {
    const spec = findLabel("round-31")!;
    const a = newText(2, 5, 6, 4);
    const b = newText(10, 9, 6, 4);
    const [ca, cb] = alignGroup([a, b], spec, "hcenter");
    const left = ca!.x;
    const right = cb!.x + cb!.w;
    expect((left + right) / 2).toBeCloseTo(15.5, 2);
    expect(cb!.x - ca!.x).toBeCloseTo(8, 5);
    expect(ca!.y).toBe(5);
  });
});

describe("icon library helpers", () => {
  it("converts a Lucide node to black-stroke SVG at the chosen weight", () => {
    const svg = lucideToSvg(
      [["circle", { cx: 12, cy: 12, r: 10, key: "k" }]],
      3,
    );
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('<circle cx="12" cy="12" r="10"/>');
    expect(svg).not.toContain("key=");
  });

  it("names and searches icons", () => {
    expect(iconDisplayName("ShoppingCart")).toBe("shopping cart");
    expect(iconDisplayName("Volume2")).toBe("volume2");
    const all = ["Heart", "HeartCrack", "Cat", "ShoppingCart", "Cart"].map(
      (k) => ({
        key: k,
        name: iconDisplayName(k),
        node: [],
        categories: k === "Cat" ? ["animals"] : ["shopping"],
        tags: k === "Cat" ? ["kitten", "feline"] : [],
      }),
    );
    expect(searchIcons(all, "heart").map((i) => i.key)).toEqual([
      "Heart",
      "HeartCrack",
    ]);
    expect(searchIcons(all, "cart").map((i) => i.key)[0]).toBe("Cart");
    expect(searchIcons(all, "")).toHaveLength(5);
    expect(searchIcons(all, "kitten").map((i) => i.key)).toEqual(["Cat"]);
    expect(filterIcons(all, { category: "animals" }).map((i) => i.key)).toEqual(
      ["Cat"],
    );
    expect(filterIcons(all, { letter: "h" })).toHaveLength(2);
    expect(
      filterIcons(all, { category: "shopping", letter: "c" }).map((i) => i.key),
    ).toEqual(["Cart"]);
  });

  it("loads the real catalogue with categories and tags", async () => {
    const { icons, categories } = await loadIconCatalog();
    expect(categories).toContain("animals");
    const cat = icons.find((i) => i.key === "Cat");
    expect(cat?.categories).toContain("animals");
    expect(cat?.tags).toContain("kitten");
    // Nearly every icon has a category; old alias names inherit theirs.
    const missing = icons.filter((i) => i.categories.length === 0).length;
    expect(missing / icons.length).toBeLessThan(0.02);
    const alias = icons.find((i) => i.key === "AlertCircle");
    expect(alias?.alias).toBe(true);
    expect(alias?.categories.length).toBeGreaterThan(0);
    expect(icons.find((i) => i.key === "CircleAlert")?.alias).toBeUndefined();
    expect(categoryLabel("food-beverage")).toBe("Food & beverage");
    expect(guessCategories(icons, "sleeping cat")).toContain("animals");
    expect(guessCategories(icons, "coffee cup")).toContain("food-beverage");
    expect(guessCategories(icons, "xq zz")).toEqual([]);
    // The list in the AI prompt matches the library's.
    expect([...ICON_CATEGORIES]).toEqual(categories);
  });
});

describe("designUsesBatch", () => {
  it("treats every {today…} form as a date, not a batch placeholder", () => {
    const d = (text: string) => ({
      ...emptyDesign("x"),
      elements: [{ ...newText(0, 0, 5, 5), text }],
    });
    expect(
      designUsesBatch(d("{today} {today+7} {today - 3} {TODAY + 1}")),
    ).toBe(false);
    expect(designUsesBatch(d("{name} {today}"))).toBe(true);
  });
});
