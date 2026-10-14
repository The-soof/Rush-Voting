export type SessionStatus = "idle" | "open" | "closed";
export type Choice = "yes" | "no" | "abstain";

export interface Candidate {
  id: string;
  name: string;
  year: string | null;
  major: string | null;
  hometown: string | null;
  bio: string | null;
  photo_url: string | null;
}

export interface VotingSession {
  id: string;
  candidate_id: string | null;
  status: SessionStatus;
  timer_seconds: number;
  quorum_required: number;
  started_at: string | null;
  ends_at: string | null;
  total_ballots: number;
  created_at: string;
}

export interface Tally {
  yes: number;
  no: number;
  abstain: number;
}

export type Verdict =
  | { kind: "extended"; pct: number; total: number; quorum: number }
  | { kind: "denied"; pct: number; total: number; quorum: number }
  | { kind: "quorum_failed"; pct: number; total: number; quorum: number };

/** Charter Verdict Engine. Abstentions count toward quorum but not approval. */
export function computeVerdict(t: Tally, quorumRequired: number): Verdict {
  const total = t.yes + t.no + t.abstain;
  const decided = t.yes + t.no;
  const pct = decided === 0 ? 0 : (t.yes / decided) * 100;
  const quorumMet = total >= quorumRequired;
  if (!quorumMet)
    return { kind: "quorum_failed", pct, total, quorum: quorumRequired };
  // Charter: approval requires Yes / (Yes + No) >= 70%. Abstentions only count toward quorum.
  // Integer comparison avoids floating-point error (e.g. 7 of 10).
  return decided > 0 && t.yes * 10 >= decided * 7
    ? { kind: "extended", pct, total, quorum: quorumRequired }
    : { kind: "denied", pct, total, quorum: quorumRequired };
}
