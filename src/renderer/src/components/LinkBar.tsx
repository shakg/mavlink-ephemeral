import { HeartPulse, Plug, Unplug, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type { EnumDef, HeartbeatConfig, LinkProtocol } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DEFAULT_LINK, useStore } from '@/store'
import { cn } from '@/lib/utils'

const PROTOCOL_DEFAULTS: Record<LinkProtocol, { host: string; port: number }> = {
  udp: { host: '127.0.0.1', port: 14550 },
  'tcp-server': { host: '0.0.0.0', port: 5760 },
  'tcp-client': { host: '127.0.0.1', port: 5760 }
}

function NumField({ label, value, onChange, className, min, max }: { label: string; value: number; onChange: (n: number) => void; className?: string; min?: number; max?: number }) {
  return (
    <Input
      aria-label={label}
      title={label}
      className={cn('h-8 text-xs', className)}
      defaultValue={value}
      key={value}
      onBlur={(e) => {
        let n = Number(e.target.value)
        if (!Number.isFinite(n)) n = value
        if (min !== undefined) n = Math.max(min, n)
        if (max !== undefined) n = Math.min(max, n)
        if (n !== value) onChange(n)
        else e.target.value = String(value)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function EnumSelect({ en, value, onChange, fallback }: { en?: EnumDef; value: number; onChange: (v: number) => void; fallback: string }) {
  if (!en) return <NumField label={fallback} value={value} onChange={onChange} />
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {en.entries.map((e) => (
          <SelectItem key={e.name} value={String(e.value)} className="text-xs">
            {e.value} · {e.name.replace(/^MAV_(TYPE|AUTOPILOT|STATE)_/, '')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function HeartbeatSettings() {
  const link = useStore((s) => s.link)
  const setLink = useStore((s) => s.setLink)
  const enums = useStore((s) => s.dialect?.enums)
  const hb = link.heartbeat
  const set = (patch: Partial<HeartbeatConfig>): void => setLink({ heartbeat: { ...hb, ...patch } })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('h-8 gap-1.5', hb.enabled ? 'text-primary' : 'text-muted-foreground')}>
          <HeartPulse className={cn(hb.enabled && link && 'animate-pulse')} />
          <span className="text-xs">HB</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Automatic HEARTBEAT</div>
            <p className="text-muted-foreground text-xs">Most GCSs only show a vehicle after receiving heartbeats.</p>
          </div>
          <Switch checked={hb.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        </div>
        <div className={cn('mt-3 grid grid-cols-[90px_1fr] items-center gap-2', !hb.enabled && 'pointer-events-none opacity-50')}>
          <Label className="text-xs">Rate (Hz)</Label>
          <NumField label="rate" value={hb.rateHz} onChange={(rateHz) => set({ rateHz })} min={0.1} max={50} />
          <Label className="text-xs">type</Label>
          <EnumSelect en={enums?.MAV_TYPE} value={hb.type} onChange={(type) => set({ type })} fallback="type" />
          <Label className="text-xs">autopilot</Label>
          <EnumSelect en={enums?.MAV_AUTOPILOT} value={hb.autopilot} onChange={(autopilot) => set({ autopilot })} fallback="autopilot" />
          <Label className="text-xs">system_status</Label>
          <EnumSelect en={enums?.MAV_STATE} value={hb.systemStatus} onChange={(systemStatus) => set({ systemStatus })} fallback="status" />
          <Label className="text-xs">base_mode</Label>
          <NumField label="base_mode" value={hb.baseMode} onChange={(baseMode) => set({ baseMode })} min={0} max={255} />
          <Label className="text-xs">custom_mode</Label>
          <NumField label="custom_mode" value={hb.customMode} onChange={(customMode) => set({ customMode })} min={0} />
        </div>
        <p className="text-muted-foreground mt-3 text-xs">base_mode 81 = custom mode + armed-safety off; 209 = armed.</p>
      </PopoverContent>
    </Popover>
  )
}

export function LinkBar() {
  const link = useStore((s) => s.link)
  const setLink = useStore((s) => s.setLink)
  const status = useStore((s) => s.stats?.link)
  const open = status?.open ?? false

  const toggle = async (): Promise<void> => {
    try {
      if (open) await window.api.closeLink()
      else await window.api.openLink(link)
    } catch (e) {
      toast.error(`Link error: ${(e as Error).message}`)
    }
  }

  const setProtocol = (protocol: LinkProtocol): void => {
    setLink({ protocol, ...PROTOCOL_DEFAULTS[protocol] })
  }

  const hostLabel = link.protocol === 'tcp-server' ? 'Bind address' : link.protocol === 'udp' ? 'Target host' : 'Server host'

  return (
    <div className="flex items-center gap-2">
      <Select value={link.protocol} onValueChange={(v) => setProtocol(v as LinkProtocol)}>
        <SelectTrigger size="sm" className="w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="udp">UDP</SelectItem>
          <SelectItem value="tcp-server">TCP server</SelectItem>
          <SelectItem value="tcp-client">TCP client</SelectItem>
        </SelectContent>
      </Select>
      <Input
        aria-label={hostLabel}
        title={hostLabel}
        className="h-8 w-28 text-xs"
        defaultValue={link.host}
        key={link.host}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== link.host && setLink({ host: e.target.value.trim() })}
      />
      <span className="text-muted-foreground">:</span>
      <NumField label="Port" value={link.port} onChange={(port) => setLink({ port })} className="w-20" min={1} max={65535} />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" title="Link settings">
            <Settings2 />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <Label className="text-xs">MAVLink</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={String(link.mavlinkVersion)}
              onValueChange={(v) => v && setLink({ mavlinkVersion: Number(v) as 1 | 2 })}
            >
              <ToggleGroupItem value="1" className="px-3 text-xs">v1</ToggleGroupItem>
              <ToggleGroupItem value="2" className="px-3 text-xs">v2</ToggleGroupItem>
            </ToggleGroup>
            <Label className="text-xs">System ID</Label>
            <NumField label="System ID" value={link.systemId} onChange={(systemId) => setLink({ systemId })} min={1} max={255} />
            <Label className="text-xs">Component ID</Label>
            <NumField label="Component ID" value={link.componentId} onChange={(componentId) => setLink({ componentId })} min={0} max={255} />
            {link.protocol === 'udp' && (
              <>
                <Label className="text-xs">Local UDP port</Label>
                <NumField label="Local port (0 = any)" value={link.localPort} onChange={(localPort) => setLink({ localPort })} min={0} max={65535} />
              </>
            )}
          </div>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            QGroundControl listens on UDP 14550 by default. For a TCP link in the GCS, use “TCP server” here and connect the GCS to
            this machine on port 5760.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setLink({ ...DEFAULT_LINK })}>
            Reset to defaults
          </Button>
        </PopoverContent>
      </Popover>

      <HeartbeatSettings />

      <Button size="sm" variant={open ? 'secondary' : 'default'} className="h-8 min-w-28" onClick={toggle}>
        {open ? <Unplug /> : <Plug />}
        {open ? 'Disconnect' : 'Connect'}
      </Button>
    </div>
  )
}
