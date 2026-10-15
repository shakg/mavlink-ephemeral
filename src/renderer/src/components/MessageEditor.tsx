import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, RotateCcw, Send, Square, Shuffle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { FieldGenerator, MessageDef } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FieldRow } from '@/components/FieldRow'
import { defaultGenerator, isTextField, switchKind } from '@/lib/fields'
import { configKey, specFor, streamFor, useStore, type MessageConfig } from '@/store'
import { cn } from '@/lib/utils'

const RATE_PRESETS = [1, 2, 5, 10, 50]

export function MessageEditor({ msg }: { msg: MessageDef }) {
  const dialect = useStore((s) => s.dialect)!
  const stored = useStore((s) => s.configs[configKey(dialect.id, msg.name)])
  const setConfig = useStore((s) => s.setConfig)
  const linkOpen = useStore((s) => s.stats?.link.open ?? false)
  const mavlinkVersion = useStore((s) => s.link.mavlinkVersion)
  const stream = useStore((s) => streamFor(s.stats, dialect.id, msg.name))
  const [preview, setPreview] = useState<{ hex: string; values: Record<string, unknown>; error?: string }>()
  const [busy, setBusy] = useState(false)

  const cfg: MessageConfig = useMemo(() => {
    const fields: Record<string, FieldGenerator> = {}
    for (const f of msg.fields) fields[f.name] = stored?.fields[f.name] ?? defaultGenerator(f)
    return { rateHz: stored?.rateHz ?? 1, fields }
  }, [stored, msg])

  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const streamId = stream?.id
  const updateTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const commit = useCallback(
    (next: MessageConfig) => {
      setConfig(msg.name, next)
      if (streamId) {
        clearTimeout(updateTimer.current)
        updateTimer.current = setTimeout(() => {
          window.api.updateStream(streamId, specFor(dialect.id, msg.name, next)).catch((e) => toast.error(String(e.message ?? e)))
        }, 150)
      }
    },
    [setConfig, msg.name, streamId, dialect.id]
  )

  const onFieldChange = useCallback(
    (name: string, gen: FieldGenerator) => {
      const c = cfgRef.current
      commit({ ...c, fields: { ...c.fields, [name]: gen } })
    },
    [commit]
  )

  // Sample one message for the live column while not streaming.
  useEffect(() => {
    if (stream) return
    let cancelled = false
    const t = setTimeout(() => {
      window.api.preview(specFor(dialect.id, msg.name, cfg)).then((p) => !cancelled && setPreview(p))
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [cfg, dialect.id, msg.name, stream, mavlinkVersion])

  const live = stream ? stream.lastValues : preview?.values
  const hex = stream ? stream.lastFrameHex : preview?.hex

  const ensureLink = async (): Promise<boolean> => {
    if (useStore.getState().stats?.link.open) return true
    try {
      await window.api.openLink(useStore.getState().link)
      return true
    } catch (e) {
      toast.error(`Could not open link: ${(e as Error).message}`)
      return false
    }
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      if (!(await ensureLink())) return
      await window.api.startStream(specFor(dialect.id, msg.name, cfg))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    if (stream) await window.api.stopStream(stream.id)
  }

  const sendOnce = async (): Promise<void> => {
    try {
      if (!(await ensureLink())) return
      const r = await window.api.sendOnce(specFor(dialect.id, msg.name, cfg))
      toast.success(`Sent ${msg.name}`, { description: r.hex.slice(0, 60) + (r.hex.length > 60 ? '…' : '') })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const reset = (): void => {
    const fields: Record<string, FieldGenerator> = {}
    for (const f of msg.fields) fields[f.name] = defaultGenerator(f)
    commit({ ...cfg, fields })
  }

  const randomizeAll = (): void => {
    const fields: Record<string, FieldGenerator> = { ...cfg.fields }
    for (const f of msg.fields) {
      if (isTextField(f) || f.isMavlinkVersion) continue
      const en = f.enum ? dialect.enums[f.enum] : undefined
      if (/time_boot_ms|time_usec|timestamp|time_ms/.test(f.name)) fields[f.name] = switchKind(f, fields[f.name], 'timestamp')
      else if (en && !en.bitmask) fields[f.name] = switchKind(f, fields[f.name], 'choice', en)
      else if (!en) fields[f.name] = switchKind(f, fields[f.name], 'randomWalk')
    }
    commit({ ...cfg, fields })
  }

  const setRate = (rateHz: number): void => {
    if (!Number.isFinite(rateHz) || rateHz <= 0) return
    commit({ ...cfg, rateHz: Math.min(1000, rateHz) })
  }

  const v1Blocked = mavlinkVersion === 1 && msg.id > 255
  const extCount = msg.fields.filter((f) => f.isExtension).length

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="border-b px-6 pt-6 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{msg.name}</h2>
              <Badge variant="secondary">#{msg.id}</Badge>
              {msg.wip && <Badge variant="outline" className="border-warning/50 text-warning">WIP</Badge>}
              {msg.deprecated && <Badge variant="outline" className="border-destructive/50 text-destructive">deprecated</Badge>}
              {stream && (
                <Badge className="bg-primary/15 text-primary gap-1.5">
                  <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                  streaming
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-2 line-clamp-2 max-w-3xl text-sm leading-relaxed">{msg.description}</p>
            <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span>{msg.file}</span>
              <span>crc_extra {msg.crcExtra}</span>
              <span>
                payload {msg.baseLength}
                {extCount ? `–${msg.maxLength}` : ''} B
              </span>
              <span>{msg.fields.length} fields{extCount ? ` (${extCount} ext)` : ''}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-sm">Rate</span>
            <Input
              className="h-8 w-20 text-xs"
              defaultValue={cfg.rateHz}
              key={cfg.rateHz}
              onBlur={(e) => setRate(Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span className="text-muted-foreground text-xs">Hz</span>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={String(cfg.rateHz)}
              onValueChange={(v) => v && setRate(Number(v))}
            >
              {RATE_PRESETS.map((r) => (
                <ToggleGroupItem key={r} value={String(r)} className="h-8 px-2.5 text-xs">
                  {r}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={randomizeAll}>
                <Shuffle /> Randomize all
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Random walk for numbers, random enum values, timestamps for time fields</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={sendOnce} disabled={v1Blocked}>
            <Send /> Send once
          </Button>
          {stream ? (
            <Button size="sm" variant="destructive" onClick={stop} className="min-w-28">
              <Square className="fill-current" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={start} disabled={busy || v1Blocked} className="min-w-28">
              <Play className="fill-current" /> {linkOpen ? 'Start stream' : 'Connect & start'}
            </Button>
          )}
        </div>
        {v1Blocked && <p className="text-warning mt-2 text-xs">Message id {msg.id} needs MAVLink 2. Switch the link to v2.</p>}
        {stream?.error && <p className="text-destructive mt-2 text-xs">{stream.error}</p>}
      </div>

      <div className="text-muted-foreground bg-muted/20 hidden grid-cols-[minmax(180px,240px)_160px_1fr_minmax(130px,190px)] gap-4 border-b px-6 py-2 text-[11px] font-semibold tracking-wider uppercase @4xl:grid">
        <span>Field</span>
        <span>Source</span>
        <span>Parameters</span>
        <span>{stream ? 'Last sent' : 'Preview'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {msg.fields.map((f, i) => (
          <div key={f.name}>
            {f.isExtension && !msg.fields[i - 1]?.isExtension && (
              <div className="text-muted-foreground bg-muted/40 border-b px-6 py-2 text-[11px] font-semibold tracking-wider uppercase">
                Extension fields (MAVLink 2 only)
              </div>
            )}
            <FieldRow
              field={f}
              gen={cfg.fields[f.name]}
              en={f.enum ? dialect.enums[f.enum] : undefined}
              live={live?.[f.name]}
              onChange={onFieldChange}
            />
          </div>
        ))}
      </div>

      <div className="bg-muted/30 flex items-center gap-4 border-t px-6 py-3">
        <span className="text-muted-foreground shrink-0 text-[11px] font-semibold tracking-wider uppercase">
          Frame v{mavlinkVersion}
        </span>
        <code className={cn('min-w-0 flex-1 truncate font-mono text-xs', preview?.error ? 'text-destructive' : 'text-muted-foreground')}>
          {preview?.error && !stream ? preview.error : hex || '–'}
        </code>
        {hex && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              void navigator.clipboard.writeText(hex)
              toast('Frame hex copied')
            }}
          >
            <Copy />
          </Button>
        )}
      </div>
    </div>
  )
}
