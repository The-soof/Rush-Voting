"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Check, X, Minus, Hourglass, CheckCircle2, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRemainingSeconds, useServerOffset } from "@/lib/hooks";
import type { Candidate, Choice, VotingSession } from "@/lib/types";

const supabase = createClient();

function getDeviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("deviceId", id);
  }
  return id;
}

const noopSubscribe = () => () => {};

export default function VotePage() {
  const offset = useServerOffset();
  // localStorage is an external store: null on the server, the real id on the client.
  const deviceId = useSyncExternalStore(noopSubscribe, getDeviceId, () => null);
  const [session, setSession] = useState<VotingSession | null>(null);
  const [candidateRow, setCandidateRow] = useState<Candidate | null>(null);
  const [votedIds, setVotedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = useRemainingSeconds(session?.status === "open" ? session.ends_at : null, offset);
  const isOpen = session?.status === "open" && remaining > 0;

  // `session` is null during SSR/first render, so localStorage is never read on the server.
  const voted =
    !!session &&
    (votedIds.includes(session.id) || localStorage.getItem(`voted:${session.id}`) !== null);
  const candidate = candidateRow && candidateRow.id === session?.candidate_id ? candidateRow : null;

  const loadLatest = useCallback(async () => {
    const { data } = await supabase
      .from("voting_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) setSession(data[0] as VotingSession);
  }, []);

  useEffect(() => {
    const first = setTimeout(loadLatest, 0);
    const channel = supabase
      .channel("voter-sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "voting_sessions" }, (p) => {
        const row = p.new as VotingSession;
        setSession((cur) => (!cur || row.id === cur.id || p.eventType === "INSERT" ? row : cur));
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") loadLatest();
      });
    const onVisible = () => document.visibilityState === "visible" && loadLatest();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [loadLatest]);

  const candidateId = session?.candidate_id;
  useEffect(() => {
    if (!candidateId) return;
    supabase
      .from("candidates")
      .select("*")
      .eq("id", candidateId)
      .single()
      .then(({ data }) => setCandidateRow((data as Candidate) ?? null));
  }, [candidateId]);

  async function submit(choice: Choice) {
    if (!session || !deviceId || voted || submitting || !isOpen) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase
      .from("votes")
      .insert({ session_id: session.id, device_id: deviceId, choice });
    setSubmitting(false);
    // 23505 = unique violation: this device already voted; treat as received.
    if (error && error.code !== "23505") {
      setError("Couldn't record your ballot. Please try again.");
      return;
    }
    localStorage.setItem(`voted:${session.id}`, choice);
    setVotedIds((ids) => [...ids, session.id]);
  }

  if (!isOpen) {
    const closed = session?.status === "closed" || (session?.status === "open" && remaining <= 0);
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="pop-in flex flex-col items-center gap-6">
          <div className="grid h-24 w-24 place-items-center rounded-full border border-white/10 bg-white/5">
            <Hourglass size={44} className="animate-pulse text-amber-300" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Deliberation in progress...</h1>
          <p className="max-w-xs text-white/50">
            {closed ? "Voting has closed for this candidate." : "Voting will open shortly. Keep this page open."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col gap-5 p-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-amber-300/80">Now voting</p>
          <h1 className="text-2xl font-bold tracking-tight">{candidate?.name ?? "Candidate"}</h1>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 font-mono text-xl font-bold tabular-nums">
          <Timer size={18} />
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </div>
      </header>

      {voted ? (
        <div className="pop-in grid flex-1 place-items-center text-center" role="status">
          <div className="flex flex-col items-center gap-5">
            <CheckCircle2 size={96} className="text-emerald-400" />
            <h2 className="text-4xl font-bold">Ballot Received</h2>
            <p className="text-white/50">Thank you. Results will appear on the projector.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          {error && <p role="alert" className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200">{error}</p>}
          <VoteButton id="vote-yes" label="YES" icon={<Check size={44} />} cls="bg-emerald-500 active:bg-emerald-600" onClick={() => submit("yes")} disabled={submitting} />
          <VoteButton id="vote-no" label="NO" icon={<X size={44} />} cls="bg-red-500 active:bg-red-600" onClick={() => submit("no")} disabled={submitting} />
          <VoteButton id="vote-abstain" label="ABSTAIN" icon={<Minus size={44} />} cls="bg-slate-500 active:bg-slate-600" onClick={() => submit("abstain")} disabled={submitting} />
        </div>
      )}
    </main>
  );
}

function VoteButton({
  id, label, icon, cls, onClick, disabled,
}: {
  id: string; label: string; icon: React.ReactNode; cls: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-3xl text-4xl font-extrabold tracking-wide text-white shadow-lg transition active:scale-[0.97] disabled:opacity-50 ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}
