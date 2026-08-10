import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="text-5xl">🧭</span>
      <h1 className="text-2xl font-extrabold">This page isn't here</h1>
      <p className="text-sm text-ink-400">Let's get back to today.</p>
      <Link to="/" className="btn-primary mt-2">
        Today's mission ❤️
      </Link>
    </div>
  )
}
