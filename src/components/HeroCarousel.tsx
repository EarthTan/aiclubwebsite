import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface HeroAction {
  label: string
  to: string
  /** Filled button instead of an outlined one. */
  primary?: boolean
}

export interface HeroSlide {
  /** Stable React key. */
  id: string
  /** Background photograph. */
  image: string
  /** Small uppercase line above the headline. */
  kicker: string
  /** The headline itself. */
  title: string
  subtitle?: string
  actions?: HeroAction[]
}

const AUTOPLAY_MS = 6000
const SWIPE_THRESHOLD = 48

/** Accessible name for the carousel; the visible caption describes each slide. */
const SECTION_LABEL = 'Highlights from the club archive'

/**
 * Full-bleed photograph carousel for the top of the home page. Slides cross-fade
 * in place; the caption, the counter and the arrows all describe the slide that
 * is currently visible.
 */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const count = slides.length
  const [index, setIndex] = useState(0)
  // Held back for one frame so the first slide's slow zoom animates in as well.
  const [ready, setReady] = useState(false)
  const touchStart = useRef<number | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const go = useCallback(
    (next: number) => setIndex(count ? ((next % count) + count) % count : 0),
    [count],
  )

  // The slide list can shrink under us when the event library reloads.
  useEffect(() => {
    setIndex((i) => (i < count ? i : 0))
  }, [count])

  // Advance on a timer. Nothing but a backgrounded tab holds it back, so the
  // carousel keeps moving even while the pointer or keyboard focus rests on it.
  useEffect(() => {
    if (count < 2) return
    let timer = 0
    const tick = () => setIndex((i) => (i + 1) % count)
    const start = () => {
      window.clearInterval(timer)
      timer = window.setInterval(tick, AUTOPLAY_MS)
    }
    start()
    const onVisibility = () => (document.hidden ? window.clearInterval(timer) : start())
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [count])

  useEffect(() => {
    if (count < 2) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') go(index - 1)
      if (event.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, go, index])

  if (count === 0) return null

  const active = slides[index]
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <section
      className="relative isolate -mt-16 overflow-hidden bg-neutral-950 text-white"
      aria-roledescription="carousel"
      aria-label={SECTION_LABEL}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current
        touchStart.current = null
        if (start === null) return
        const delta = (e.changedTouches[0]?.clientX ?? start) - start
        if (Math.abs(delta) > SWIPE_THRESHOLD) go(index + (delta < 0 ? 1 : -1))
      }}
    >
      {/* Roughly three quarters of the viewport, on every screen size. */}
      <div className="relative h-[74vh] min-h-[26rem] w-full sm:h-[80vh]">
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            aria-hidden={i !== index}
            className={cn(
              'absolute inset-0 transition-opacity [transition-duration:900ms] ease-out motion-reduce:transition-none',
              i === index ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <img
              src={slide.image}
              alt=""
              loading={i === 0 ? 'eager' : 'lazy'}
              className={cn(
                'h-full w-full object-cover transition-transform [transition-duration:7000ms] ease-out will-change-transform motion-reduce:transition-none',
                i === index && ready ? 'scale-[1.06]' : 'scale-100',
              )}
            />
          </div>
        ))}

        {/* Two scrims: one under the navigation bar, one under the caption. The
            top one has to hold white text over bright posters as well as photos. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/75 via-black/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4/5 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
      </div>

      {/* Slide counter, aligned to the page gutter. */}
      {count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-0">
          <div className="mx-auto flex max-w-6xl justify-end px-5 pt-24 sm:px-8 sm:pt-28">
            <span className="text-[0.6875rem] font-semibold tabular-nums uppercase tracking-[0.22em] text-white/85 drop-shadow-md">
              {pad(index + 1)} / {pad(count)}
            </span>
          </div>
        </div>
      )}

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="absolute left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/25 text-white/85 backdrop-blur-sm transition-colors hover:border-white/80 hover:bg-black/50 hover:text-white sm:flex lg:left-6"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="absolute right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/25 text-white/85 backdrop-blur-sm transition-colors hover:border-white/80 hover:bg-black/50 hover:text-white sm:flex lg:right-6"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Caption — keyed on the slide so it animates back in on every change. It
          ignores the pointer so the arrows stay clickable behind the text. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
          <div
            key={active.id}
            className="max-w-3xl animate-in fade-in slide-in-from-bottom-3 duration-700 motion-reduce:animate-none"
          >
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.24em] text-white/80 drop-shadow-md">
              {active.kicker}
            </span>
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.06] tracking-tight drop-shadow-md sm:text-5xl lg:text-6xl">
              {active.title}
            </h1>
            {active.subtitle && (
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/80 drop-shadow-md">
                {active.subtitle}
              </p>
            )}
            {active.actions && active.actions.length > 0 && (
              <div className="pointer-events-auto mt-8 flex flex-wrap gap-3">
                {active.actions.map((action) => (
                  <Link
                    key={action.to + action.label}
                    to={action.to}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors',
                      action.primary
                        ? 'bg-white text-neutral-900 hover:bg-white/90'
                        : 'border border-white/40 text-white hover:border-white hover:bg-white/10',
                    )}
                  >
                    {action.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
