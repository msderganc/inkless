"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  categoryLabel,
  DEFAULT_ICON_WEIGHT,
  filterIcons,
  popularIcons,
  guessCategories,
  type LibraryIcon,
  loadIconCatalog,
  lucideToSvg,
  searchIcons,
} from "~/lib/icons";
import { type SavedIcon } from "~/lib/store/store";
import { svgToDataUrl } from "~/lib/svg";
import { useApp } from "./app-context";
import { Modal } from "./Modal";

const MINE = "mine";
/** Everyday label icons; the default view. */
const POPULAR = "popular";
const LETTERS = ["#", ..."abcdefghijklmnopqrstuvwxyz"];
const SHOWN = 240;

const chip = (active: boolean) =>
  `rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap ${
    active
      ? "border-sky-600 bg-sky-600 text-on-accent"
      : "border-neutral-300 hover:bg-neutral-100"
  }`;

const savedSrc = (i: SavedIcon) =>
  i.type === "svg" ? svgToDataUrl(i.data) : i.data;

/**
 * Icon picker: your saved icons ("My icons") plus the offline Lucide library, filterable by
 * category and first letter, searchable by name and tags.
 */
export function IconLibraryDialog({
  onClose,
  onPick,
  onPickSaved,
  initialMine = false,
}: {
  /** Open on the "My icons" tab. */
  initialMine?: boolean;
  onClose: () => void;
  onPick: (svg: string, name: string, key: string, weight: number) => void;
  onPickSaved: (icon: SavedIcon) => void;
}) {
  const { store } = useApp();
  const [all, setAll] = useState<LibraryIcon[]>();
  const [categories, setCategories] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedIcon[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | undefined>(
    initialMine ? MINE : POPULAR,
  );
  const [letter, setLetter] = useState<string>();
  const [weight, setWeight] = useState(DEFAULT_ICON_WEIGHT);

  useEffect(() => {
    loadIconCatalog()
      .then((c) => {
        setAll(c.icons.filter((i) => !i.alias));
        setCategories(c.categories);
      })
      .catch(() => setError("The icon library could not be loaded."));
  }, []);

  const loadSaved = useCallback(
    () =>
      void store
        .listIcons()
        .then(setSaved)
        .catch(() => setSaved([])),
    [store],
  );
  useEffect(loadSaved, [loadSaved]);

  // Icons saved before categories existed: tag them once from their names.
  useEffect(() => {
    if (!all || !saved) return;
    const untagged = saved.filter((i) => i.categories.length === 0);
    const updates = untagged
      .map((i) => ({ ...i, categories: guessCategories(all, i.name) }))
      .filter((i) => i.categories.length > 0);
    if (updates.length === 0) return;
    void Promise.all(updates.map((i) => store.saveIcon(i)))
      .then(loadSaved)
      .catch(() => undefined);
  }, [all, saved, store, loadSaved]);

  const mine = category === MINE;
  const popular = category === POPULAR;
  // Searching from Popular searches everything; otherwise within the category.
  const libraryCategory = popular || mine ? undefined : category;
  const pool = useMemo(() => {
    if (!all || mine) return [];
    const base =
      popular && !query.trim()
        ? popularIcons(all)
        : filterIcons(all, { category: libraryCategory });
    return filterIcons(base, { letter });
  }, [all, mine, popular, query, libraryCategory, letter]);
  const results = useMemo(() => searchIcons(pool, query, SHOWN), [pool, query]);
  const total = pool.length;
  const count = query.trim() ? results.length : total;

  const savedShown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (saved ?? []).filter((i) => {
      const n = i.name.toLowerCase();
      return (
        (!libraryCategory || i.categories.includes(libraryCategory)) &&
        (!q || q.split(/\s+/).every((t) => n.includes(t))) &&
        (!letter || (letter === "#" ? /^[0-9]/.test(n) : n.startsWith(letter)))
      );
    });
  }, [saved, query, letter, libraryCategory]);

  const savedButton = (icon: SavedIcon, size = "size-12") => (
    <button
      type="button"
      title={
        icon.categories.length
          ? `${icon.name} (${icon.categories.map(categoryLabel).join(", ")})`
          : icon.name
      }
      aria-label={`Add saved icon: ${icon.name}`}
      className="bg-paper flex w-full flex-col items-center gap-1 rounded border border-neutral-200 p-2 text-[10px] hover:border-sky-500"
      onClick={() => onPickSaved(icon)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, no optimisation needed */}
      <img src={savedSrc(icon)} alt="" className={size} />
      <span
        className="w-full truncate text-center"
        style={{ color: "#525252" }}
      >
        {icon.name}
      </span>
    </button>
  );

  const remove = async (icon: SavedIcon) => {
    if (!window.confirm(`Delete "${icon.name}" from My icons?`)) return;
    await store.deleteIcon(icon.id);
    loadSaved();
  };

  return (
    <Modal title="Icon library" onClose={onClose} wide="xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            data-autofocus
            type="search"
            placeholder="Search icons (e.g. heart, kitten, home)"
            aria-label="Search icons"
            className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!mine && (
            <label className="flex items-center gap-2 text-sm">
              Line weight
              <input
                type="range"
                min={1.5}
                max={4}
                step={0.25}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
              />
            </label>
          )}
        </div>

        <div
          role="group"
          aria-label="Category"
          className="flex flex-wrap gap-1"
        >
          <button
            type="button"
            className={chip(popular)}
            aria-pressed={popular}
            onClick={() => setCategory(POPULAR)}
          >
            Popular
          </button>
          <button
            type="button"
            className={chip(!category)}
            aria-pressed={!category}
            onClick={() => setCategory(undefined)}
          >
            All
          </button>
          <button
            type="button"
            className={chip(mine)}
            aria-pressed={mine}
            onClick={() => setCategory(MINE)}
          >
            My icons{saved ? ` (${saved.length})` : ""}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={chip(category === c)}
              aria-pressed={category === c}
              onClick={() => setCategory(category === c ? undefined : c)}
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="First letter"
          className="flex flex-wrap gap-0.5"
        >
          <button
            type="button"
            className={`${chip(!letter)} px-2`}
            aria-pressed={!letter}
            onClick={() => setLetter(undefined)}
          >
            Any
          </button>
          {LETTERS.map((l) => (
            <button
              key={l}
              type="button"
              aria-label={
                l === "#"
                  ? "Starts with a number"
                  : `Starts with ${l.toUpperCase()}`
              }
              aria-pressed={letter === l}
              className={`min-w-6 rounded px-1 py-0.5 text-xs uppercase ${
                letter === l
                  ? "text-on-accent bg-sky-600"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
              onClick={() => setLetter(letter === l ? undefined : l)}
            >
              {l}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        {mine ? (
          <>
            <p className="text-xs text-neutral-500">
              Icons you saved from the AI generator (or a selected AI icon).
              They are included in backups.
            </p>
            {saved && savedShown.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {saved.length === 0
                  ? "No saved icons yet. Use the bookmark button under an AI icon to save it here."
                  : "No saved icons match."}
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                {savedShown.map((icon) => (
                  <li key={icon.id} className="relative">
                    {savedButton(icon)}
                    <button
                      type="button"
                      title="Delete from My icons"
                      aria-label={`Delete saved icon: ${icon.name}`}
                      className="absolute top-1 right-1 rounded bg-white/90 p-0.5 text-red-700 hover:bg-red-50"
                      onClick={() => void remove(icon)}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {savedShown.length > 0 && (
              <section aria-label="My icons" className="space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                    My icons
                  </h3>
                  {savedShown.length > 10 && (
                    <button
                      type="button"
                      className="text-xs text-sky-700 underline"
                      onClick={() => setCategory(MINE)}
                    >
                      Show all {savedShown.length}
                    </button>
                  )}
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
                  {savedShown.slice(0, 10).map((icon) => (
                    <li key={icon.id}>{savedButton(icon, "size-10")}</li>
                  ))}
                </ul>
                <h3 className="pt-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                  Library
                </h3>
              </section>
            )}
            <p className="text-xs text-neutral-500">
              {all
                ? `${count} icon${count === 1 ? "" : "s"}${
                    !query.trim() && total > SHOWN
                      ? ` (showing ${SHOWN}; filter or search to narrow)`
                      : ""
                  }, works offline.`
                : "Loading…"}{" "}
              Heavier lines print more reliably at small sizes.
            </p>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
              {results.map((icon) => {
                const svg = lucideToSvg(icon.node, weight);
                return (
                  <li key={icon.key}>
                    <button
                      type="button"
                      title={icon.name}
                      aria-label={`Add icon: ${icon.name}`}
                      className="bg-paper flex w-full flex-col items-center gap-1 rounded border border-neutral-200 p-2 text-[10px] text-neutral-700 hover:border-sky-500"
                      onClick={() => onPick(svg, icon.name, icon.key, weight)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, no optimisation needed */}
                      <img src={svgToDataUrl(svg)} alt="" className="size-10" />
                      <span
                        className="w-full truncate text-center text-neutral-600"
                        style={{ color: "#525252" }}
                      >
                        {icon.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {all && results.length === 0 && (
              <p className="text-sm text-neutral-500">
                No icons match. Try another filter or the AI generator.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
