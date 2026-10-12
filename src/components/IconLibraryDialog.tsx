"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ICON_WEIGHT,
  type LibraryIcon,
  loadIconLibrary,
  lucideToSvg,
  searchIcons,
} from "~/lib/icons";
import { svgToDataUrl } from "~/lib/svg";
import { Modal } from "./Modal";

/** Searchable offline icon library (Lucide). Picking an icon adds it to the label. */
export function IconLibraryDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (svg: string, name: string, key: string, weight: number) => void;
}) {
  const [all, setAll] = useState<LibraryIcon[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [weight, setWeight] = useState(DEFAULT_ICON_WEIGHT);

  useEffect(() => {
    loadIconLibrary()
      .then(setAll)
      .catch(() => setError("The icon library could not be loaded."));
  }, []);

  const results = useMemo(
    () => (all ? searchIcons(all, query, 160) : []),
    [all, query],
  );

  return (
    <Modal title="Icon library" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            data-autofocus
            type="search"
            placeholder="Search icons (e.g. heart, star, cat, home)"
            aria-label="Search icons"
            className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
        </div>
        <p className="text-xs text-neutral-500">
          {all ? `${all.length} icons, works offline.` : "Loading…"} Heavier
          lines print more reliably at small sizes.
        </p>
        {error && <p className="text-sm text-red-700">{error}</p>}
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
            No icons match “{query}”. Try the AI generator.
          </p>
        )}
      </div>
    </Modal>
  );
}
