"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // (opzionale) log lato client
  // console.error(error);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="text-lg font-semibold">Si è verificato un errore</h2>
      <p className="mt-2 text-sm text-slate-600">
        {error?.message || "Qualcosa è andato storto durante il caricamento della pagina."}
      </p>
      <div className="mt-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
        >
          Riprova
        </button>
      </div>
    </div>
  );
}
