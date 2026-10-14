"use client";

import { useState } from "react";
import { X, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const field =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-base text-white outline-none focus:border-amber-300/60";

export function AddRusheeDialog({
  dialogRef,
  onAdded,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onAdded: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const val = (k: string) => String(fd.get(k) ?? "").trim() || null;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("candidates").insert({
      name: val("name"),
      hometown: val("hometown"),
      major: val("major"),
      year: val("year"),
      bio: val("bio"),
      photo_url: val("photo_url"),
    });
    setSaving(false);
    if (error) return setError(error.message);
    form.reset();
    dialogRef.current?.close();
    onAdded();
  }

  return (
    <dialog
      ref={dialogRef}
      id="add-rushee-dialog"
      className="m-auto w-[min(520px,92vw)] rounded-3xl border border-white/10 bg-[#0d1220] p-0 text-white backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-7">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <UserPlus size={20} className="text-amber-300" /> Add Rushee
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <label className="text-xs uppercase tracking-widest text-white/40">
          Name *
          <input name="name" required className={field} autoComplete="off" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs uppercase tracking-widest text-white/40">
            Hometown
            <input name="hometown" className={field} autoComplete="off" />
          </label>
          <label className="text-xs uppercase tracking-widest text-white/40">
            Major
            <input name="major" className={field} autoComplete="off" />
          </label>
        </div>
        <label className="text-xs uppercase tracking-widest text-white/40">
          Year
          <input name="year" placeholder="Freshman, Sophomore..." className={field} autoComplete="off" />
        </label>
        <label className="text-xs uppercase tracking-widest text-white/40">
          Notes
          <textarea name="bio" rows={3} className={field} />
        </label>
        <label className="text-xs uppercase tracking-widest text-white/40">
          Photo URL
          <input name="photo_url" type="url" placeholder="https://..." className={field} autoComplete="off" />
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-amber-300 to-amber-500 px-4 py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add to queue"}
        </button>
      </form>
    </dialog>
  );
}
