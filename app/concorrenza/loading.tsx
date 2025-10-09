export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6 py-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded-lg bg-slate-200" />
        <div className="h-24 rounded-2xl bg-slate-200" />
        <div className="h-40 rounded-2xl bg-slate-200" />
      </div>
    </div>
  );
}
