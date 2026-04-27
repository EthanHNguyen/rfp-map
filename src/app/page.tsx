"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
type PointerPoint = { x: number; y: number };

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

function distance(a: PointerPoint, b: PointerPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function Home() {
  const [payload, setPayload] = useState<TilePayload | null>(null);
  const [level, setLevel] = useState(1);
  const [scope, setScope] = useState<Scope[]>([]);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showHint, setShowHint] = useState(true);
  const lastTouchDrag = useRef<PointerPoint | null>(null);
  const lastTouchPinch = useRef<number | null>(null);
  const lastZoomAction = useRef(0);

  useEffect(() => {
    fetch("data/map-tiles.json")
      .then((response) => response.json())
      .then((data: TilePayload) => setPayload(data));
  }, []);

  const tile = tileFor(payload, level, scope);
  const nodes = useMemo(() => tile?.nodes ?? [], [tile]);
  const scopeLabel = scope.map((item) => item.label).join(" → ");

  function markInteracted() {
    setShowHint(false);
  }

  function drill(node: MapNode) {
    markInteracted();
    setSelected(null);
    setPan({ x: 0, y: 0 });
    if (level === 1 && node.agency) {
      setScope([{ agency: node.agency, label: node.label }]);
      setLevel(2);
      return;
    }
    if (level === 2 && node.theme) {
      const agencyScope = scope.find((item) => item.agency);
      setScope([...(agencyScope ? [agencyScope] : []), { theme: node.theme, label: node.label }]);
      setLevel(3);
      return;
    }
    if (node.opportunity) {
      setSelected(node);
      setSheetOpen(false);
    }
  }

  function back() {
    markInteracted();
    setSelected(null);
    setPan({ x: 0, y: 0 });
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
    setPan({ x: 0, y: 0 });
    setLevel(1);
  }

  function zoom(delta: 1 | -1) {
    const now = Date.now();
    if (now - lastZoomAction.current < 550) return;
    lastZoomAction.current = now;
    if (delta < 0) back();
  }

  function handleTouchStart(event: React.TouchEvent<HTMLElement>) {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      lastTouchDrag.current = { x: touch.clientX, y: touch.clientY };
      lastTouchPinch.current = null;
    }
    if (event.touches.length === 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      lastTouchPinch.current = distance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY });
      lastTouchDrag.current = null;
    }
  }

  function handleTouchMove(event: React.TouchEvent<HTMLElement>) {
    event.preventDefault();
    if (event.touches.length === 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      const next = distance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY });
      const prev = lastTouchPinch.current ?? next;
      if (Math.abs(next - prev) > 34) {
        markInteracted();
        zoom(next > prev ? 1 : -1);
        lastTouchPinch.current = next;
      }
      return;
    }
    if (event.touches.length === 1 && lastTouchDrag.current) {
      const touch = event.touches[0];
      const dx = touch.clientX - lastTouchDrag.current.x;
      const dy = touch.clientY - lastTouchDrag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) markInteracted();
      setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
      lastTouchDrag.current = { x: touch.clientX, y: touch.clientY };
    }
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
        className="absolute inset-0 touch-none select-none overscroll-none pt-24"
        style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => {
          lastTouchDrag.current = null;
          lastTouchPinch.current = null;
        }}
      >
        <div className="absolute inset-0 transition-transform duration-200" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          {nodes.map((node) => {
            const size = level === 3 ? 62 : Math.min(148, 78 + Math.sqrt(node.count) * 12);
            return (
              <button
                key={node.id}
                type="button"
                aria-label={node.label}
                onClick={() => drill(node)}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-white/45 text-center text-[12px] font-black text-white shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-sm transition active:scale-95"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  width: size,
                  height: size,
                  background: "radial-gradient(circle at 35% 25%, rgba(255,255,255,0.45), rgba(52,211,153,0.9))",
                }}
              >
                {level === 3 ? (
                  <>
                    <span className="text-lg leading-none">{formatMoney(node.marketValue)}</span>
                    <span className="mt-1 text-[10px] font-black uppercase tracking-wide text-white/85">RFP</span>
                  </>
                ) : (
                  <>
                    <span className="max-w-[84%] truncate">{node.label}</span>
                    <span className="text-xl leading-none">~{formatMoney(node.marketValue)}</span>
                    <span className="max-w-[82%] truncate text-[10px] font-bold text-white/85">{node.count.toLocaleString()} opps</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {showHint ? (
        <div className="absolute bottom-[max(1.15rem,env(safe-area-inset-bottom))] left-3 right-3 z-30 rounded-[24px] border border-white/10 bg-black/55 px-4 py-3 text-sm font-black text-white/80 shadow-2xl backdrop-blur-xl">
          Tap a region → tap a market → tap an RFP
        </div>
      ) : null}

      {level > 1 && !selected ? (
        <button disabled={level === 1} onClick={back} className="absolute bottom-[max(1.15rem,env(safe-area-inset-bottom))] right-3 z-30 h-[68px] w-[68px] rounded-[24px] border border-white/15 bg-white text-2xl font-black text-black shadow-2xl disabled:bg-white/10 disabled:text-white/25">−</button>
      ) : null}

      {selected?.opportunity ? <BottomSheet node={selected} open={sheetOpen} setOpen={setSheetOpen} onClose={() => setSelected(null)} /> : null}
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

function BottomSheet({ node, open, setOpen, onClose }: { node: MapNode; open: boolean; setOpen: (open: boolean) => void; onClose: () => void }) {
  const item = node.opportunity;
  if (!item) return null;

  return (
    <section className={`absolute inset-x-0 bottom-0 z-40 rounded-t-[28px] border border-white/10 bg-[#101318]/95 p-4 pb-6 shadow-[0_-24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-transform duration-300 ${open ? "translate-y-0" : "translate-y-[36%]"}`}>
      <button aria-label={open ? "Collapse details" : "Expand details"} onClick={() => setOpen(!open)} className="mx-auto mb-3 block h-6 w-20 rounded-full before:mx-auto before:block before:h-1.5 before:w-12 before:rounded-full before:bg-white/25" />
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-lg font-black text-black">{item.naics.slice(0, 2) || "•"}</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/55">{item.agency}</p>
          <h2 className="line-clamp-2 text-lg font-bold leading-snug">{item.title}</h2>
          <p className="mt-1 text-sm text-amber-200">{dueText(item.responseDeadline)} · ~{formatMoney(node.marketValue)} est.</p>
        </div>
        <button onClick={onClose} className="h-11 w-11 rounded-full bg-white/10 text-xl active:scale-95">×</button>
      </div>
      <a href={item.url} target="_blank" rel="noreferrer" className="mt-4 flex h-14 items-center justify-center rounded-2xl bg-white text-base font-black text-black">Open SAM.gov</a>
      {open ? (
        <div className="mt-4 grid gap-2 text-sm">
          <Info label="Office" value={item.office} />
          <Info label="NAICS" value={item.naics} />
          <Info label="Set-aside" value={item.setAside} />
          <p className="rounded-2xl bg-white/[0.06] px-4 py-3 leading-6 text-white/70">{item.description}</p>
        </div>
      ) : null}
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
