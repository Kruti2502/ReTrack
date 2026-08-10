/** Shown instead of a blank screen when the .env file has not been filled in. */
export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-10">
      <div className="text-center">
        <span className="text-4xl">🔧</span>
        <h1 className="mt-2 text-2xl font-extrabold">Almost there</h1>
        <p className="mt-1 text-sm text-ink-400">
          Copy <code className="font-bold">.env.example</code> to{' '}
          <code className="font-bold">.env</code> and fill in these values, then restart the dev
          server.
        </p>
      </div>

      <ul className="card space-y-1.5 p-4 font-mono text-sm">
        {missing.map((name) => (
          <li key={name} className="text-blush-700">
            {name}
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-ink-400">
        The README walks through the Supabase and Cloudinary setup step by step.
      </p>
    </div>
  )
}
