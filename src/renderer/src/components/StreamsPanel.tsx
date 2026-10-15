import { Activity, Radio, Square, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg px-3 py-2">
      <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
  )
}

export function StreamsPanel() {
  const stats = useStore((s) => s.stats)
  const dialects = useStore((s) => s.dialects)
  const activeDialect = useStore((s) => s.dialect?.id)
  const selectDialect = useStore((s) => s.selectDialect)
  const selectMessage = useStore((s) => s.selectMessage)
  const heartbeat = useStore((s) => s.link.heartbeat.enabled)
  const link = stats?.link
  const streams = stats?.streams ?? []
  const totalHz = streams.reduce((n, s) => n + s.actualHz, 0)

  const jump = async (dialectId: string, name: string): Promise<void> => {
    if (dialectId !== activeDialect) await selectDialect(dialectId)
    selectMessage(name)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="space-y-4 border-b p-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              link?.open ? (link.error ? 'bg-warning' : 'bg-primary shadow-[0_0_8px] shadow-primary') : 'bg-muted-foreground/40'
            )}
          />
          <span className="text-sm font-medium">{link?.open ? 'Link open' : 'Disconnected'}</span>
          {link?.open && heartbeat && <span className="text-muted-foreground ml-auto text-[11px]">♥ heartbeat on</span>}
        </div>
        {link?.open && <div className="text-muted-foreground text-xs break-all">{link.state}</div>}
        {link?.error && <div className="text-warning text-xs break-all">{link.error}</div>}
        <div className="grid grid-cols-2 gap-2">
          <Stat label="sent" value={formatBytes(link?.bytesSent ?? 0)} />
          <Stat label="received" value={formatBytes(link?.bytesReceived ?? 0)} />
          <Stat label="frames" value={String(link?.framesSent ?? 0)} />
          <Stat label="msg/s" value={totalHz.toFixed(1)} />
        </div>
        {link?.open && (
          <div>
            <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
              <Users className="size-3" /> Talking back
            </div>
            {link.remoteSystems.length === 0 ? (
              <p className="text-muted-foreground text-xs">No MAVLink received yet. A GCS usually sends its own heartbeat (sysid 255) once it sees us.</p>
            ) : (
              <div className="space-y-1">
                {link.remoteSystems.map((r) => (
                  <div key={`${r.systemId}/${r.componentId}`} className="flex justify-between text-xs">
                    <span>
                      sys {r.systemId} / comp {r.componentId}
                      {r.systemId === 255 && <span className="text-primary"> · GCS</span>}
                    </span>
                    <span className="text-muted-foreground">{r.msgCount} msgs</span>
                  </div>
                ))}
              </div>
            )}
            {link.peers.length > 0 && (
              <div className="text-muted-foreground mt-1 text-[11px]">peers: {link.peers.join(', ')}</div>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
          <Radio className="size-3" /> Active streams ({streams.length})
        </div>
        {streams.length > 0 && (
          <Button variant="ghost" size="xs" className="text-destructive" onClick={() => window.api.stopAllStreams()}>
            Stop all
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 pb-4">
        {streams.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-xs">
            <Activity className="size-5 opacity-50" />
            Pick a message, set its fields and press Start. Several messages can stream at once.
          </div>
        )}
        {streams.map((s) => {
          const d = dialects.find((x) => x.id === s.spec.dialectId)
          const ratio = s.spec.rateHz ? s.actualHz / s.spec.rateHz : 1
          return (
            <div
              key={s.id}
              className="group hover:bg-accent/40 cursor-pointer rounded-lg border p-3 transition-colors"
              onClick={() => jump(s.spec.dialectId, s.spec.messageName)}
            >
              <div className="flex items-center gap-2">
                <span className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.spec.messageName}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.api.stopStream(s.id)
                  }}
                >
                  <Square className="fill-current" />
                </Button>
              </div>
              <div className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
                <span className={cn(ratio < 0.9 && s.sent > s.spec.rateHz * 3 && 'text-warning')}>
                  {s.actualHz.toFixed(1)} / {s.spec.rateHz} Hz
                </span>
                <span>{s.sent} sent</span>
              </div>
              {d && d.id !== activeDialect && <div className="text-muted-foreground mt-0.5 truncate text-[11px]">{d.rootFile}</div>}
              {s.error && <div className="text-destructive mt-1 text-xs">{s.error}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
