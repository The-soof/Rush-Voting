import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center p-8">
      <div className="flex flex-col items-center gap-8 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Chapter Bid Vote</h1>
        <div className="flex gap-4">
          <Link href="/admin" className="rounded-xl bg-amber-400 px-6 py-3 font-semibold text-black">Rush Chair</Link>
          <Link href="/vote" className="rounded-xl border border-white/20 px-6 py-3 font-semibold">Vote</Link>
        </div>
      </div>
    </main>
  );
}
