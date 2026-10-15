import { useMemo, useState } from 'react'
import { Search, Star } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { configKey, useStore } from '@/store'
import { cn } from '@/lib/utils'

export function MessageList() {
  const dialect = useStore((s) => s.dialect)
  const selected = useStore((s) => s.selected)
  const selectMessage = useStore((s) => s.selectMessage)
  const configs = useStore((s) => s.configs)
  const storedFavorites = useStore((s) => s.settings.favorites)
  const favorites = storedFavorites ?? []
  const streams = useStore((s) => s.stats?.streams)
  const [q, setQ] = useState('')
  const [fileFilter, setFileFilter] = useState<string | null>(null)

  const running = useMemo(
    () => new Set((streams ?? []).filter((s) => s.spec.dialectId === dialect?.id).map((s) => s.spec.messageName)),
    [streams, dialect?.id]
  )

  const list = useMemo(() => {
    if (!dialect) return []
    const needle = q.trim().toLowerCase()
    return dialect.messages.filter((m) => {
      if (fileFilter && m.file !== fileFilter) return false
      if (!needle) return true
      return m.name.toLowerCase().includes(needle) || String(m.id) === needle || m.fields.some((f) => f.name.toLowerCase() === needle)
    })
  }, [dialect, q, fileFilter])

  if (!dialect) return null

  const toggleFavorite = (name: string): void => {
    const key = configKey(dialect.id, name)
    const favs = favorites.includes(key) ? favorites.filter((f) => f !== key) : [...favorites, key]
    useStore.setState((s) => ({ settings: { ...s.settings, favorites: favs } }))
    void window.api.setSettings({ favorites: favs })
  }

  const isFav = (name: string): boolean => favorites.includes(configKey(dialect.id, name))
  const sorted = [...list.filter((m) => isFav(m.name)), ...list.filter((m) => !isFav(m.name))]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            className="h-9 pl-8 text-sm"
            placeholder={`Search ${dialect.messages.length} messages…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        {dialect.files.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {[null, ...dialect.files.map((f) => f.name)].map((f) => (
              <button
                key={f ?? 'all'}
                onClick={() => setFileFilter(f)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs transition-colors',
                  fileFilter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {f ?? 'all'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {sorted.map((m) => {
          const configured = !!configs[configKey(dialect.id, m.name)]
          const fav = isFav(m.name)
          return (
            <div
              key={m.name}
              role="button"
              tabIndex={0}
              onClick={() => selectMessage(m.name)}
              onKeyDown={(e) => e.key === 'Enter' && selectMessage(m.name)}
              className={cn(
                'group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 outline-none',
                selected === m.name ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 focus-visible:bg-accent/50'
              )}
            >
              <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">{m.id}</span>
              <span className={cn('min-w-0 flex-1 truncate text-[13px]', m.deprecated && 'text-muted-foreground line-through')}>
                {m.name}
              </span>
              {running.has(m.name) && <span className="bg-primary size-2 shrink-0 animate-pulse rounded-full" title="streaming" />}
              {!running.has(m.name) && configured && <span className="bg-muted-foreground/40 size-1.5 shrink-0 rounded-full" title="configured" />}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFavorite(m.name)
                }}
                className={cn('shrink-0', fav ? 'text-warning' : 'text-muted-foreground opacity-0 group-hover:opacity-100')}
                title={fav ? 'Unpin' : 'Pin to top'}
              >
                <Star className={cn('size-3.5', fav && 'fill-current')} />
              </button>
            </div>
          )
        })}
        {!sorted.length && <p className="text-muted-foreground p-4 text-center text-xs">No messages match “{q}”.</p>}
      </div>
    </div>
  )
}
