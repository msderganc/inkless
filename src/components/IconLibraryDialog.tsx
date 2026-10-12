"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  categoryLabel,
  DEFAULT_ICON_WEIGHT,
  filterIcons,
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
}: {
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
  const [category, setCategory] = useState<string>();
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

  const mine = category === MINE;
  const results = useMemo(() => {
    if (!all || mine) return [];
    return searchIcons(filterIcons(all, { category, letter }), query, SHOWN);
  }, [all, mine, category, letter, query]);
  const total = useMemo(
    () => (all && !mine ? filterIcons(all, { category, letter }).length : 0),
    [all, mine, category, letter],
  );
  const count = query.trim() ? results.length : total;

  const savedShown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (saved ?? []).filter((i) => {
      const n = i.name.toLowerCase();
      return (
        (!q || q.split(/\s+/).every((t) => n.includes(t))) &&
        (!letter || (letter === "#" ? /^[0-9]/.test(n) : n.startsWith(letter)))
      );
    });
  }, [saved, query, letter]);

  const remove = async (icon: SavedIcon) => {
    if (!window.confirm(`Delete "${icon.name}" from My icons?`)) return;
    await store.deleteIcon(icon.id);
    loadSaved();
  };

  return (
    <Modal title="Icon library" onClose={onClose} wide>
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
          className="flex max-h-24 flex-wrap gap-1 overflow-y-auto"
        >
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
                    <button
                      type="button"
                      title={icon.name}
                      aria-label={`Add saved icon: ${icon.name}`}
                      className="bg-paper flex w-full flex-col items-center gap-1 rounded border border-neutral-200 p-2 text-[10px] hover:border-sky-500"
                      onClick={() => onPickSaved(icon)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, no optimisation needed */}
                      <img src={savedSrc(icon)} alt="" className="size-12" />
                      <span
                        className="w-full truncate text-center"
                        style={{ color: "#525252" }}
                      >
                        {icon.name}
                      </span>
                    </button>
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
