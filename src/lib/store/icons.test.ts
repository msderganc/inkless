// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_SAVED_ICONS, type SavedIcon, Store } from "./store";

let store: Store;

beforeEach(async () => {
  store = await Store.open(`icons-${crypto.randomUUID()}`);
});

afterEach(() => store.close());

const svgIcon = (id: string, createdAt = 1, data?: string): SavedIcon => ({
  id,
  name: `icon ${id}`,
  createdAt,
  type: "svg",
  data:
    data ??
    '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#000"/></svg>',
});

describe("My icons", () => {
  it("saves, lists newest first and deletes", async () => {
    await store.saveIcon(svgIcon("a", 1));
    await store.saveIcon(svgIcon("b", 2));
    await store.saveIcon({
      id: "p",
      name: "picture",
      createdAt: 3,
      type: "png",
      data: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect((await store.listIcons()).map((i) => i.id)).toEqual(["p", "b", "a"]);
    await store.deleteIcon("b");
    expect((await store.listIcons()).map((i) => i.id)).toEqual(["p", "a"]);
  });

  it("sanitises SVGs and rejects non-PNG pictures", async () => {
    await store.saveIcon(
      svgIcon(
        "x",
        1,
        '<svg viewBox="0 0 100 100"><script>alert(1)</script><rect width="50" height="50" fill="red" onclick="x()"/></svg>',
      ),
    );
    const [saved] = await store.listIcons();
    expect(saved!.data).not.toMatch(/script|onclick|red/);
    await expect(
      store.saveIcon({
        id: "bad",
        name: "bad",
        createdAt: 1,
        type: "png",
        data: "javascript:alert(1)",
      }),
    ).rejects.toThrow();
  });

  it("stops at the limit but still allows replacing an existing icon", async () => {
    for (let i = 0; i < MAX_SAVED_ICONS; i++)
      await store.saveIcon(svgIcon(`i${i}`, i));
    await expect(store.saveIcon(svgIcon("extra"))).rejects.toThrow(/full/);
    await store.saveIcon({ ...svgIcon("i0"), name: "renamed" });
    expect(await store.listIcons()).toHaveLength(MAX_SAVED_ICONS);
  }, 60_000);

  it("round-trips through backups; older backups without icons still import", async () => {
    await store.saveIcon(svgIcon("keep", 5));
    const backup = await store.exportBackup();
    expect(backup.icons).toHaveLength(1);

    const other = await Store.open(`icons-${crypto.randomUUID()}`);
    try {
      await other.importBackup(JSON.parse(JSON.stringify(backup)));
      expect((await other.listIcons()).map((i) => i.id)).toEqual(["keep"]);
      const old: Partial<typeof backup> = { ...backup };
      delete old.icons;
      await other.importBackup(old);
    } finally {
      other.close();
    }
  });
});
