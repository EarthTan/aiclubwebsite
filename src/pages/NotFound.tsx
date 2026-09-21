import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-32 text-center sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">404</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        The page you asked for does not exist. The event archive is the best place to start.
      </p>
      <Link
        to="/events"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
      >
        Go to events
      </Link>
    </div>
  )
}
