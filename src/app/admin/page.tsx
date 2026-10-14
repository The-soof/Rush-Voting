"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Gavel, Play, Square, Users, Timer, ShieldCheck, ShieldAlert, RotateCcw,
  History, ListOrdered, Plus, MonitorPlay,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRemainingSeconds, useServerOffset } from "@/lib/hooks";
import { AddRusheeDialog } from "@/components/AddRusheeDialog";
import {
  computeVerdict, QUORUM_REQUIRED, type Candidate, type Tally, type Verdict, type VotingSession,
} from "@/lib/types";

const supabase = createClient();
const noopSubscribe = () => () => {};

interface HistoryEntry {
  candidateId: string;
  sessionId: string;
  tally: Tally;
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function parseTally(data: unknown): Tally {
  const r = (data as { yes_count: number; no_count: number; abstain_count: number }[] | null)?.[0];
  return { yes: Number(r?.yes_count ?? 0), no: Number(r?.no_count ?? 0), abstain: Number(r?.abstain_count ?? 0) };
}

function badgeText(v: Verdict) {
  const pct = Math.round(v.pct);
  if (v.kind === "extended") return `BID EXTENDED - ${pct}%`;
  if (v.kind === "denied") return `DENIED - ${pct}%`;
  return `QUORUM FAILED - ${v.total}/${v.quorum}`;
}

export default function AdminPage() {
  const offset = useServerOffset();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [session, setSession] = useState<VotingSession | null>(null);
  const [tallyRow, setTallyRow] = useState<{ sessionId: string; tally: Tally } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [timerSecs, setTimerSecs] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const closing = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The QR code always points at whatever origin this page was loaded from.
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const voteUrl = origin ? `${origin}/vote` : "";

  const remaining = useRemainingSeconds(session?.status === "open" ? session.ends_at : null, offset);
  const tally = session?.status === "closed" && tallyRow?.sessionId === session.id ? tallyRow.tally : null;

  const loadCandidates = useCallback(async () => {
    const { data, error } = await supabase.from("candidates").select("*").order("created_at");
    if (error) return setError(error.message);
    setCandidates((data as Candidate[]) ?? []);
  }, []);

  // Initial load + realtime
  useEffect(() => {
    const first = setTimeout(async () => {
      loadCandidates();
      const { data } = await supabase
        .from("voting_sessions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      if (data?.[0]) {
        const row = data[0] as VotingSession;
        setSession(row);
        setTimerSecs(row.timer_seconds);
      }
    }, 0);

    const channel = supabase
      .channel("admin-sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "voting_sessions" }, (p) => {
        const row = p.new as VotingSession;
        setSession((cur) => (!cur || row.id === cur.id || p.eventType === "INSERT" ? row : cur));
      })
      .subscribe();
    return () => {
      clearTimeout(first);
      supabase.removeChannel(channel);
    };
  }, [loadCandidates]);

  // Breakdown for the active session, only after it closes
  useEffect(() => {
    if (session?.status !== "closed") return;
    const sessionId = session.id;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_tally", { p_session_id: sessionId });
      if (cancelled) return;
      if (error) return setError(error.message);
      setTallyRow({ sessionId, tally: parseTally(data) });
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.id, session?.status]);

  // Voted history: latest closed session per candidate. Refreshes whenever a session changes.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("voting_sessions")
        .select("*")
        .eq("status", "closed")
        .order("created_at", { ascending: false });
      if (cancelled || !data) return;
      const latest = new Map<string, VotingSession>();
      for (const s of data as VotingSession[]) {
        if (s.candidate_id && !latest.has(s.candidate_id)) latest.set(s.candidate_id, s);
      }
      const entries = await Promise.all(
        [...latest.values()].map(async (s) => {
          const { data: tallyData } = await supabase.rpc("get_tally", { p_session_id: s.id });
          return {
            candidateId: s.candidate_id!,
            sessionId: s.id,
            tally: parseTally(tallyData),
          };
        }),
      );
      if (!cancelled) setHistory(entries);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [session?.id, session?.status]);

  const closeVoting = useCallback(async () => {
    if (!session || closing.current) return;
    closing.current = true;
    const { error } = await supabase
      .from("voting_sessions")
      .update({ status: "closed" })
      .eq("id", session.id)
      .eq("status", "open");
    if (error) setError(error.message);
    closing.current = false;
  }, [session]);

  // Auto-close exactly when the server-clock deadline passes.
  const openEndsAt = session?.status === "open" ? session.ends_at : null;
  useEffect(() => {
    if (!openEndsAt) return;
    const delay = Math.max(0, new Date(openEndsAt).getTime() - (Date.now() + offset));
    const t = setTimeout(closeVoting, delay + 100);
    return () => clearTimeout(t);
  }, [openEndsAt, offset, closeVoting]);

  /** Puts a candidate in the center panel with a fresh session (also used for Revote). */
  async function present(c: Candidate) {
    if (session?.status === "open") return;
    setError(null);
    const { data, error } = await supabase
      .from("voting_sessions")
      .insert({ candidate_id: c.id, status: "idle", timer_seconds: timerSecs, quorum_required: QUORUM_REQUIRED })
      .select()
      .single();
    if (error) return setError(error.message);
    setSession(data as VotingSession);
  }

  async function startVoting() {
    if (!session) return;
    setError(null);
    const startMs = Date.now() + offset;
    const { error } = await supabase
      .from("voting_sessions")
      .update({
        status: "open",
        timer_seconds: timerSecs,
        quorum_required: QUORUM_REQUIRED,
        started_at: new Date(startMs).toISOString(),
        ends_at: new Date(startMs + timerSecs * 1000).toISOString(),
      })
      .eq("id", session.id)
      .eq("status", "idle");
    if (error) setError(error.message);
  }

  const candidate = candidates.find((c) => c.id === session?.candidate_id) ?? null;
  const status = session?.status ?? "idle";
  const verdict = tally && session ? computeVerdict(tally) : null;
  const locked = status === "open";

  const historyById = new Map(history.map((h) => [h.candidateId, h]));
  const votedCandidates = history
    .map((h) => candidates.find((c) => c.id === h.candidateId))
    .filter((c): c is Candidate => !!c && c.id !== candidate?.id);
  const upcoming = candidates.filter((c) => !historyById.has(c.id) && c.id !== candidate?.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-5 p-5 lg:p-8">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-black">
            <Gavel size={20} />
          </span>
          Chapter Bid Vote
        </h1>
        <StatusPill status={status} />
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {verdict && <VerdictBanner verdict={verdict} />}

      <section className="grid flex-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* LEFT: voted history */}
        <aside className="glass order-2 flex flex-col gap-3 rounded-3xl p-5 lg:order-1" aria-label="Voted history">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-white/50">
            <History size={16} /> Voted ({votedCandidates.length})
          </h2>
          {votedCandidates.length === 0 && <p className="text-sm text-white/30">No completed votes yet.</p>}
          {votedCandidates.map((c) => {
            const h = historyById.get(c.id)!;
            const v = computeVerdict(h.tally);
            const tone =
              v.kind === "extended"
                ? "bg-emerald-500/20 text-emerald-300"
                : v.kind === "denied"
                  ? "bg-red-500/20 text-red-300"
                  : "bg-amber-400/20 text-amber-200";
            return (
              <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-3">
                  <Avatar c={c} size={40} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-white/40">{c.hometown}</div>
                  </div>
                </div>
                <div className={`mt-3 rounded-lg px-2 py-1.5 text-center text-xs font-bold tracking-wide ${tone}`}>
                  {badgeText(v)}
                </div>
                <button
                  id={`revote-${c.id}`}
                  disabled={locked}
                  onClick={() => present(c)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCcw size={14} /> Revote
                </button>
              </div>
            );
          })}
        </aside>

        {/* CENTER: active presentation */}
        <div className="order-1 flex min-w-0 flex-col gap-5 lg:order-2">
          <div
            className="glass pop-in relative flex flex-col overflow-hidden rounded-3xl md:flex-row"
            key={candidate?.id ?? "none"}
          >
            {candidate ? (
              <>
                {candidate.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={candidate.photo_url}
                    alt={candidate.name}
                    className="h-72 w-full object-cover md:h-auto md:w-[38%]"
                  />
                ) : (
                  <div className="grid h-72 w-full place-items-center bg-gradient-to-br from-indigo-500/30 to-amber-500/20 text-8xl font-bold text-white/70 md:h-auto md:w-[38%]">
                    {initials(candidate.name)}
                  </div>
                )}
                <div className="flex flex-1 flex-col justify-between gap-6 p-7 lg:p-10">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-amber-300/80">Candidate</p>
                    <h2 className="mt-2 text-4xl font-bold tracking-tight lg:text-6xl">{candidate.name}</h2>
                    <dl className="mt-5 grid grid-cols-2 gap-4">
                      {[
                        ["Year", candidate.year],
                        ["Hometown", candidate.hometown],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-xs uppercase tracking-widest text-white/40">{k}</dt>
                          <dd className="mt-1 text-lg font-medium">{v ?? "—"}</dd>
                        </div>
                      ))}
                    </dl>
                    {candidate.bio && (
                      <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">{candidate.bio}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    {status === "open" && (
                      <>
                        <div
                          className={`flex items-center gap-3 rounded-2xl px-5 py-3 font-mono text-5xl font-bold tabular-nums ${
                            remaining <= 10 ? "bg-red-500/20 text-red-300" : "bg-white/10"
                          }`}
                        >
                          <Timer size={32} /> {fmt(remaining)}
                        </div>
                        <div className="pulse-ring flex items-center gap-3 rounded-2xl bg-emerald-400/15 px-5 py-3 text-emerald-200">
                          <Users size={28} />
                          <span className="font-mono text-4xl font-bold tabular-nums" data-testid="ballot-count">
                            {session?.total_ballots ?? 0}
                          </span>
                          <span className="text-xs uppercase tracking-widest">ballots cast</span>
                        </div>
                      </>
                    )}
                    {status === "closed" && tally && (
                      <div className="grid grid-cols-4 gap-3 text-center">
                        {[
                          ["Yes", tally.yes, "text-emerald-300"],
                          ["No", tally.no, "text-red-300"],
                          ["Abstain", tally.abstain, "text-slate-300"],
                          ["Total", tally.yes + tally.no + tally.abstain, "text-amber-200"],
                        ].map(([l, n, c]) => (
                          <div key={l as string} className="glass rounded-2xl px-4 py-2">
                            <div className={`font-mono text-3xl font-bold ${c}`}>{n}</div>
                            <div className="text-xs uppercase tracking-widest text-white/40">{l}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid min-h-[360px] w-full place-items-center p-10 text-center text-white/50">
                <div>
                  <MonitorPlay className="mx-auto mb-4" size={48} />
                  <p className="text-2xl">Pick a rushee from the queue to present.</p>
                </div>
              </div>
            )}
          </div>

          {/* QR + voting controls */}
          <div className="grid gap-5 md:grid-cols-[auto_1fr]">
            <div className="glass flex items-center gap-5 rounded-3xl p-5">
              <div className="rounded-2xl bg-white p-3">
                {voteUrl && <QRCodeSVG value={voteUrl} size={150} level="M" />}
              </div>
              <div>
                <p className="text-sm uppercase tracking-widest text-white/50">Scan to vote</p>
                <p className="mt-1 max-w-[200px] break-all font-mono text-xs text-white/40" id="vote-url">
                  {voteUrl}
                </p>
              </div>
            </div>

            <div className="glass flex flex-col gap-4 rounded-3xl p-5">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs uppercase tracking-widest text-white/40">
                  Timer (s)
                  <input
                    id="timer-input"
                    type="number"
                    min={10}
                    max={600}
                    value={timerSecs}
                    disabled={locked}
                    onChange={(e) => setTimerSecs(Math.max(10, Number(e.target.value) || 90))}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-base text-white"
                  />
                </label>
              </div>

              {status === "open" ? (
                <button
                  id="close-voting"
                  onClick={closeVoting}
                  className="flex items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-4 text-lg font-semibold transition hover:bg-red-400 active:scale-[0.98]"
                >
                  <Square size={20} /> Close Voting
                </button>
              ) : status === "closed" ? (
                <button
                  id="reset-session"
                  onClick={() => candidate && present(candidate)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/20 px-4 py-4 text-lg font-semibold transition hover:bg-white/10"
                >
                  <RotateCcw size={20} /> Re-run this candidate
                </button>
              ) : (
                <button
                  id="start-voting"
                  disabled={!session?.candidate_id}
                  onClick={startVoting}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-emerald-600 px-4 py-4 text-lg font-semibold text-black transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={20} /> Start Voting
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: upcoming queue */}
        <aside className="glass order-3 flex flex-col gap-3 rounded-3xl p-5" aria-label="Upcoming queue">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-white/50">
              <ListOrdered size={16} /> Upcoming ({upcoming.length})
            </h2>
            <button
              id="add-rushee"
              onClick={() => dialogRef.current?.showModal()}
              className="flex items-center gap-1 rounded-lg bg-amber-300 px-3 py-1.5 text-sm font-semibold text-black transition hover:brightness-110"
            >
              <Plus size={14} /> Add Rushee
            </button>
          </div>
          {upcoming.length === 0 && <p className="text-sm text-white/30">Queue is empty. Add a rushee.</p>}
          {upcoming.map((c) => (
            <button
              key={c.id}
              id={`present-${c.id}`}
              disabled={locked}
              onClick={() => present(c)}
              className="flex items-center gap-3 rounded-2xl border border-white/10 p-3 text-left transition hover:border-amber-300/50 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Avatar c={c} size={44} />
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-xs text-white/40">
                  {c.hometown}
                </div>
              </div>
            </button>
          ))}
        </aside>
      </section>

      <AddRusheeDialog dialogRef={dialogRef} onAdded={loadCandidates} />
    </main>
  );
}

function Avatar({ c, size }: { c: Candidate; size: number }) {
  return c.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.photo_url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500/40 to-amber-500/30 text-sm font-bold"
      style={{ width: size, height: size }}
    >
      {initials(c.name)}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    idle: "bg-white/10 text-white/70",
    open: "bg-emerald-400/20 text-emerald-300",
    closed: "bg-amber-400/20 text-amber-200",
  };
  return (
    <span className={`rounded-full px-4 py-1.5 text-sm font-semibold uppercase tracking-widest ${map[status]}`}>
      {status === "open" && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" />}
      {status}
    </span>
  );
}

function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const pct = Math.round(verdict.pct);
  const cfg = {
    extended: {
      cls: "from-emerald-500 to-emerald-700 text-white",
      text: `BID EXTENDED - ${pct}% Yes`,
      icon: <ShieldCheck size={56} />,
    },
    denied: {
      cls: "from-red-500 to-red-800 text-white",
      text: `BID DENIED - ${pct}% Yes`,
      icon: <ShieldAlert size={56} />,
    },
    quorum_failed: {
      cls: "from-amber-400 to-amber-600 text-black",
      text: `QUORUM FAILED - ${verdict.total}/${verdict.quorum} Present`,
      icon: <ShieldAlert size={56} />,
    },
  }[verdict.kind];

  return (
    <div
      role="status"
      id="verdict-banner"
      className={`pop-in flex items-center justify-center gap-6 rounded-3xl bg-gradient-to-r px-8 py-8 text-center text-4xl font-extrabold tracking-tight shadow-2xl lg:text-6xl ${cfg.cls}`}
    >
      {cfg.icon}
      <span>{cfg.text}</span>
    </div>
  );
}
