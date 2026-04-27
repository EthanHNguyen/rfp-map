"use client";

import { useEffect, useMemo, useState } from "react";

type Opportunity = {
  id: string;
  title: string;
  agency: string;
  office: string;
  noticeType: string;
  setAside: string;
  naics: string;
  postedDate: string;
  responseDeadline: string;
  placeOfPerformance: string;
  description: string;
  url: string;
};

type MapNode = {
  id: string;
  label: string;
  count: number;
  marketValue: number;
  hotCount: number;
  soonCount: number;
  x: number;
  y: number;
  agency?: string;
  theme?: string;
  opportunity?: Opportunity;
};

type Tile = {
  level: number;
  agency: string | null;
  theme: string | null;
  scopedCount: number;
  nodes: MapNode[];
};

type TilePayload = {
  source: "sam.gov-bulk-csv";
  generatedAt: string;
  activeRows: number;
  tiles: Record<string, Tile>;
};

type Scope = { agency?: string; theme?: string; label: string };

function formatMoney(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function dueText(deadline: string) {
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return "Due date unknown";
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return "Recently closed";
  if (days === 0) return "Due today";
  return `Due in ${days} days`;
}

function tileKey(level: number, agency = "", theme = "") {
  return `${level}|${agency}|${theme}`;
}

function tileFor(payload: TilePayload | null, level: number, scope: Scope[]) {
  if (!payload) return null;
  const agency = scope.find((item) => item.agency)?.agency ?? "";
  const theme = scope.find((item) => item.theme)?.theme ?? "";
  return payload.tiles[tileKey(level, agency, theme)] ?? payload.tiles[tileKey(level, agency)] ?? payload.tiles[tileKey(1)];
}

export default function Home() {
  const [payload, setPayload] = useState<TilePayload | null>(null);
  const [level, setLevel] = useState(1);
  const [scope, setScope] = useState<Scope[]>([]);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    fetch("data/map-tiles.json")
      .then((response) => response.json())
      .then((data: TilePayload) => setPayload(data));
  }, []);

  const tile = tileFor(payload, level, scope);
  const nodes = useMemo(() => tile?.nodes ?? [], [tile]);
  const rankedNodes = useMemo(
    () => [...nodes].sort((a, b) => b.marketValue - a.marketValue || b.count - a.count || a.label.localeCompare(b.label)),
    [nodes],
  );
  const scopeLabel = scope.map((item) => item.label).join(" → ");

  function markInteracted() {
    setShowHint(false);
  }

  function drill(node: MapNode) {
    markInteracted();
    setSelected(null);
    if (level === 1 && node.agency) {
      setScope([{ agency: node.agency, label: node.label }]);
      setLevel(2);
      return;
    }
    if (node.opportunity) {
      setSelected(node);
      return;
    }
    if (level === 2 && node.theme) {
      const agencyScope = scope.find((item) => item.agency);
      setScope([...(agencyScope ? [agencyScope] : []), { theme: node.theme, label: node.label }]);
      setLevel(3);
    }
  }

  function back() {
    markInteracted();
    setSelected(null);
    setLevel((value) => {
      const next = Math.max(1, value - 1);
      setScope((items) => items.slice(0, Math.max(0, next - 1)));
      return next;
    });
  }

  function reset() {
    markInteracted();
    setSelected(null);
    setScope([]);
    setLevel(1);
  }

  if (!tile) return <LoadingScreen />;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#07090d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(16,185,129,0.22),transparent_32%),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:100%_100%,42px_42px,42px_42px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(59,130,246,0.13),transparent_26%),radial-gradient(circle_at_82%_72%,rgba(245,158,11,0.12),transparent_24%)]" />

      <header className="absolute left-3 right-3 top-[max(.8rem,env(safe-area-inset-top))] z-30 flex items-center justify-between gap-2">
        <button disabled={level === 1} onClick={back} className="h-11 w-11 rounded-full border border-white/10 bg-black/45 text-lg font-black shadow-xl backdrop-blur-xl disabled:opacity-25">‹</button>
        <div className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/45 px-4 py-2 text-center shadow-xl backdrop-blur-xl">
          <p className="truncate text-xs font-black uppercase tracking-[0.18em] text-emerald-200/80">{scopeLabel || "Federal Market"}</p>
          <p className="text-[11px] font-bold text-white/60">{tile.scopedCount.toLocaleString()} open contracts</p>
        </div>
        <button onClick={reset} className="h-11 rounded-full border border-white/10 bg-black/45 px-3 text-xs font-black uppercase tracking-wide text-white/75 shadow-xl backdrop-blur-xl">All</button>
      </header>

      <section
        aria-label="RFP map"
        className="absolute inset-x-0 bottom-0 top-24 select-none overflow-y-auto overscroll-contain px-3 pb-28 pt-2"
        style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
      >
        {level === 3 ? (
          <div className="mx-auto grid max-w-3xl gap-3">
            {rankedNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                aria-label={node.label}
                onClick={() => {
                  markInteracted();
                  setSelected(node);
                }}
                className="group rounded-[26px] border border-white/10 bg-white/[0.07] p-4 text-left shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-sm transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-base font-black leading-snug text-white">{node.label}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-white/45">{node.opportunity?.agency ?? scopeLabel}</p>
                  </div>
                  <div className="shrink-0 rounded-2xl bg-emerald-300 px-3 py-2 text-sm font-black text-black">~{formatMoney(node.marketValue)}</div>
                </div>
                <p className="mt-3 text-xs font-bold text-emerald-100/70">Tap for details → SAM.gov</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
            {rankedNodes.map((node, index) => (
              <button
                key={node.id}
                type="button"
                aria-label={node.label}
                onClick={() => drill(node)}
                className="relative flex aspect-square min-h-[148px] flex-col justify-between overflow-hidden rounded-[34px] border border-emerald-200/25 bg-emerald-300/[0.13] p-4 text-left shadow-[0_22px_70px_rgba(0,0,0,0.42)] backdrop-blur-sm transition active:scale-[0.98]"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.28),transparent_34%),radial-gradient(circle_at_72%_85%,rgba(16,185,129,0.34),transparent_42%)]" />
                <div className="relative z-10 flex items-start justify-between gap-2">
                  <span className="rounded-full bg-black/35 px-2 py-1 text-[10px] font-black text-white/55">#{index + 1}</span>
                  <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-black text-black">{node.count.toLocaleString()} opps</span>
                </div>
                <div className="relative z-10">
                  <p className="line-clamp-2 text-[13px] font-black uppercase tracking-wide text-white">{node.label}</p>
                  <p className="mt-2 text-2xl font-black leading-none text-emerald-100">~{formatMoney(node.marketValue)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {showHint ? (
        <div className="absolute bottom-[max(1.15rem,env(safe-area-inset-bottom))] left-3 right-3 z-30 rounded-[24px] border border-white/10 bg-black/55 px-4 py-3 text-sm font-black text-white/80 shadow-2xl backdrop-blur-xl">
          Tap a region → tap a market → tap an RFP
        </div>
      ) : null}

      {level > 1 && !selected ? (
        <button disabled={level === 1} onClick={back} className="absolute bottom-[max(1.15rem,env(safe-area-inset-bottom))] right-3 z-30 h-[68px] w-[68px] rounded-[24px] border border-white/15 bg-white text-2xl font-black text-black shadow-2xl disabled:bg-white/10 disabled:text-white/25">−</button>
      ) : null}

      {selected?.opportunity ? <OpportunityDetail node={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#07090d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(16,185,129,0.22),transparent_34%),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:100%_100%,42px_42px,42px_42px]" />
      <section className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-[32px] border border-white/10 bg-black/45 p-6 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-5 h-16 w-16 animate-pulse rounded-full border-2 border-emerald-300/40 bg-emerald-300/15 shadow-[0_0_60px_rgba(16,185,129,0.35)]" />
        <p className="text-xs font-black uppercase tracking-[0.32em] text-emerald-200/80">Loading SAM.gov market</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight">Building the radar</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-white/60">Fetching static map tiles for fast mobile exploration.</p>
      </section>
    </main>
  );
}

function OpportunityDetail({ node, onClose }: { node: MapNode; onClose: () => void }) {
  const item = node.opportunity;
  if (!item) return null;

  return (
    <section className="absolute inset-0 z-50 overflow-hidden bg-[#07090d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(16,185,129,0.2),transparent_32%),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:100%_100%,42px_42px,42px_42px]" />
      <div className="relative z-10 flex h-full flex-col">
        <header className="shrink-0 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <button onClick={onClose} className="h-12 w-12 rounded-full border border-white/10 bg-white/10 text-2xl font-black shadow-xl active:scale-95">‹</button>
            <p className="min-w-0 flex-1 truncate text-center text-xs font-black uppercase tracking-[0.22em] text-emerald-200/80">Opportunity</p>
            <button onClick={onClose} aria-label="Close opportunity" className="h-12 w-12 rounded-full border border-white/10 bg-white/10 text-2xl font-black shadow-xl active:scale-95">×</button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <article className="mx-auto max-w-2xl rounded-[34px] border border-white/10 bg-white/[0.07] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-300 text-xl font-black text-black">{item.naics.slice(0, 2) || "•"}</div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-white/45">{item.agency}</p>
                <h2 className="mt-2 text-2xl font-black leading-tight tracking-tight">{item.title}</h2>
                <p className="mt-3 text-sm font-bold text-amber-200">{dueText(item.responseDeadline)} · ~{formatMoney(node.marketValue)} est.</p>
              </div>
            </div>

            <a href={item.url} target="_blank" rel="noreferrer" className="mt-5 flex h-14 items-center justify-center rounded-2xl bg-white text-base font-black text-black shadow-xl active:scale-[0.99]">Open on SAM.gov</a>

            <div className="mt-5 grid gap-2 text-sm">
              <Info label="Office" value={item.office} />
              <Info label="Notice type" value={item.noticeType} />
              <Info label="NAICS" value={item.naics} />
              <Info label="Set-aside" value={item.setAside} />
              <Info label="Place" value={item.placeOfPerformance} />
              <Info label="Posted" value={item.postedDate} />
              <Info label="Deadline" value={item.responseDeadline} />
            </div>

            <div className="mt-5 rounded-[24px] bg-black/25 p-4">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/40">Description</p>
              <p className="text-sm leading-6 text-white/75">{item.description}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] px-4 py-3">
      <span className="text-white/45">{label}</span>
      <span className="truncate text-right text-white/85">{value}</span>
    </div>
  );
}
