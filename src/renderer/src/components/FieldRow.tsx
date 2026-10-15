import { memo } from 'react'
import { Info } from 'lucide-react'
import type { EnumDef, FieldDef, FieldGenerator, GeneratorKind, TimestampUnit } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { GENERATORS, isTextField, switchKind, UNIT_CONVERSIONS, formatLive } from '@/lib/fields'
import { cn } from '@/lib/utils'

interface Props {
  field: FieldDef
  gen: FieldGenerator
  en?: EnumDef
  live: unknown
  onChange: (name: string, gen: FieldGenerator) => void
}

function NumInput({
  label,
  value,
  onChange,
  className,
  placeholder
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  className?: string
  placeholder?: string
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{label}</span>
      <Input
        className="h-8 text-xs"
        inputMode="decimal"
        placeholder={placeholder}
        defaultValue={value ?? ''}
        key={String(value)}
        onBlur={(e) => {
          const t = e.target.value.trim()
          const n = t === '' ? undefined : Number(t)
          if (n === undefined || Number.isFinite(n)) onChange(n)
          else e.target.value = String(value ?? '')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

function TextInput({
  label,
  value,
  onCommit,
  maxLength,
  placeholder,
  className
}: {
  label: string
  value: string
  onCommit: (v: string) => void
  maxLength?: number
  placeholder?: string
  className?: string
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{label}</span>
      <Input
        className="h-8 text-xs"
        defaultValue={value}
        key={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

function BitmaskPicker({ en, value, onChange }: { en: EnumDef; value: number; onChange: (v: number) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          flags…
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-96 w-96 overflow-auto p-2" align="start">
        <div className="text-muted-foreground mb-2 px-1 text-xs">{en.name}</div>
        {en.entries.map((e) => {
          const on = e.value !== 0 && (value & e.value) === e.value
          return (
            <label key={e.name} className="hover:bg-accent flex cursor-pointer items-start gap-2 rounded px-1 py-1.5">
              <Checkbox
                checked={on}
                className="mt-0.5"
                onCheckedChange={(c) => onChange(c ? (value | e.value) >>> 0 : (value & ~e.value) >>> 0)}
              />
              <span className="min-w-0">
                <span className="block text-xs">
                  {e.name} <span className="text-muted-foreground">= {e.value}</span>
                </span>
                {e.description && <span className="text-muted-foreground block text-xs">{e.description}</span>}
              </span>
            </label>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function ConstantEditor({ field, gen, en, set }: { field: FieldDef; gen: FieldGenerator; en?: EnumDef; set: (g: Partial<FieldGenerator>) => void }) {
  const value = gen.value ?? ''
  if (isTextField(field)) {
    return (
      <TextInput
        className="flex-1"
        label={`text (max ${field.arrayLength}, {n} = counter)`}
        value={value}
        maxLength={field.arrayLength + 8}
        onCommit={(v) => set({ value: v })}
      />
    )
  }
  if (en && !field.arrayLength) {
    if (en.bitmask) {
      const num = Number(value) || 0
      return (
        <div className="flex flex-1 items-end gap-3">
          <TextInput className="w-40" label="value" value={value} onCommit={(v) => set({ value: v })} />
          <BitmaskPicker en={en} value={num} onChange={(v) => set({ value: String(v) })} />
        </div>
      )
    }
    const known = en.entries.some((e) => String(e.value) === value)
    return (
      <div className="flex flex-1 items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{en.name}</span>
          <Select value={known ? value : ''} onValueChange={(v) => set({ value: v })}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder={value ? `custom: ${value}` : 'choose…'} />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-80">
              {en.entries.map((e) => (
                <SelectItem key={e.name} value={String(e.value)} className="text-xs">
                  {e.value} · {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <TextInput className="w-24" label="raw" value={value} onCommit={(v) => set({ value: v })} />
      </div>
    )
  }
  return (
    <TextInput
      className="flex-1"
      label={field.arrayLength ? `values (comma separated, one value fills all ${field.arrayLength})` : 'value'}
      value={value}
      placeholder={field.arrayLength ? '0, 0, 0 …' : '0'}
      onCommit={(v) => set({ value: v })}
    />
  )
}

function GeneratorParams({ field, gen, en, set }: { field: FieldDef; gen: FieldGenerator; en?: EnumDef; set: (g: Partial<FieldGenerator>) => void }) {
  switch (gen.kind) {
    case 'constant':
      return <ConstantEditor field={field} gen={gen} en={en} set={set} />
    case 'uniform':
      return (
        <>
          <NumInput label="min" value={gen.min} onChange={(min) => set({ min })} className="flex-1" />
          <NumInput label="max" value={gen.max} onChange={(max) => set({ max })} className="flex-1" />
        </>
      )
    case 'randomWalk':
      return (
        <>
          <NumInput label="start" value={gen.start} onChange={(start) => set({ start })} className="flex-1" />
          <NumInput label="min" value={gen.min} onChange={(min) => set({ min })} className="flex-1" />
          <NumInput label="max" value={gen.max} onChange={(max) => set({ max })} className="flex-1" />
          <NumInput label="± step" value={gen.step} onChange={(step) => set({ step })} className="flex-1" />
        </>
      )
    case 'sine':
      return (
        <>
          <NumInput label="min" value={gen.min} onChange={(min) => set({ min })} className="flex-1" />
          <NumInput label="max" value={gen.max} onChange={(max) => set({ max })} className="flex-1" />
          <NumInput label="period s" value={gen.period} onChange={(period) => set({ period })} className="w-20" />
          <NumInput label="phase °" value={gen.phase} onChange={(phase) => set({ phase })} className="w-20" />
        </>
      )
    case 'ramp':
      return (
        <>
          <NumInput label="min" value={gen.min} onChange={(min) => set({ min })} className="flex-1" />
          <NumInput label="max" value={gen.max} onChange={(max) => set({ max })} className="flex-1" />
          <NumInput label="period s" value={gen.period} onChange={(period) => set({ period })} className="w-20" />
        </>
      )
    case 'counter':
      return (
        <>
          <NumInput label="start" value={gen.start} onChange={(start) => set({ start })} className="flex-1" />
          <NumInput label="step" value={gen.step} onChange={(step) => set({ step })} className="flex-1" />
          <NumInput label="wrap after" value={gen.max} placeholder="never" onChange={(max) => set({ max })} className="flex-1" />
        </>
      )
    case 'timestamp':
      return (
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">unit</span>
          <Select value={gen.timestampUnit ?? 'boot_ms'} onValueChange={(v) => set({ timestampUnit: v as TimestampUnit })}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="boot_ms">ms since start (time_boot_ms)</SelectItem>
              <SelectItem value="boot_us">µs since start</SelectItem>
              <SelectItem value="unix_us">µs since Unix epoch (time_usec)</SelectItem>
              <SelectItem value="unix_ms">ms since Unix epoch</SelectItem>
              <SelectItem value="unix_s">s since Unix epoch</SelectItem>
            </SelectContent>
          </Select>
        </label>
      )
    case 'choice':
      return (
        <>
          <TextInput className="flex-1" label="values" value={gen.choices ?? ''} onCommit={(choices) => set({ choices })} />
          <label className="flex w-28 flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">order</span>
            <Select value={gen.choiceMode ?? 'random'} onValueChange={(v) => set({ choiceMode: v as 'random' | 'cycle' })}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="random">random</SelectItem>
                <SelectItem value="cycle">cycle</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </>
      )
  }
}

function FieldRowImpl({ field, gen, en, live, onChange }: Props) {
  const set = (patch: Partial<FieldGenerator>): void => onChange(field.name, { ...gen, ...patch })
  const conv = field.units ? UNIT_CONVERSIONS[field.units] : undefined
  const canScale = conv && gen.kind !== 'timestamp' && gen.kind !== 'choice' && !isTextField(field)
  const scaled = canScale && gen.scale === conv.scale
  const kinds = isTextField(field) || field.isMavlinkVersion ? GENERATORS.filter((g) => g.kind === 'constant') : GENERATORS

  return (
    <div className="hover:bg-muted/30 grid grid-cols-[minmax(0,1fr)_160px_minmax(120px,190px)] items-end gap-x-4 gap-y-3 border-b px-6 py-4 @4xl:grid-cols-[minmax(180px,240px)_160px_1fr_minmax(130px,190px)]">
      <div className="min-w-0 self-center">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{field.name}</span>
          {field.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="text-muted-foreground size-3.5 shrink-0" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">{field.description}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">{field.rawType}</span>
          {field.units && <Badge variant="secondary" className="h-4 px-1 text-[11px]">{field.units}</Badge>}
          {field.isExtension && <Badge variant="outline" className="h-4 px-1 text-[11px]">ext</Badge>}
          {field.enum && (
            <span className="text-info max-w-full truncate text-[11px]" title={field.enum}>
              {field.enum}
            </span>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">source</span>
        {field.isMavlinkVersion ? (
          <div className="text-muted-foreground flex h-8 items-center text-xs">auto (dialect version)</div>
        ) : (
          <Select value={gen.kind} onValueChange={(k) => onChange(field.name, switchKind(field, gen, k as GeneratorKind, en))}>
            <SelectTrigger size="sm" className={cn('w-full text-xs', gen.kind !== 'constant' && 'border-primary/50 text-primary')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {kinds.map((g) => (
                <SelectItem key={g.kind} value={g.kind} className="text-xs">
                  <span>{g.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </label>

      <div className="order-4 col-span-3 flex min-w-0 items-end gap-3 empty:hidden @4xl:order-3 @4xl:col-span-1">
        {!field.isMavlinkVersion && <GeneratorParams field={field} gen={gen} en={en} set={set} />}
        {canScale && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={scaled ? 'secondary' : 'ghost'}
                size="sm"
                className={cn('h-8 shrink-0 px-2 text-xs', scaled && 'text-primary')}
                onClick={() => set({ scale: scaled ? undefined : conv.scale })}
              >
                {scaled ? conv.label : field.units}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {scaled
                ? `Entering ${conv.label}; sent as ${field.units} (×${conv.scale}). Click to enter raw ${field.units}.`
                : `Entering raw ${field.units}. Click to enter ${conv.label} instead.`}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        className={cn(
          'bg-muted/40 order-3 flex h-8 items-center truncate rounded px-2 text-xs @4xl:order-4',
          gen.kind !== 'constant' ? 'text-primary' : 'text-muted-foreground'
        )}
        title={formatLive(live, field, en, scaled ? gen.scale : undefined)}
      >
        {formatLive(live, field, en, scaled ? gen.scale : undefined)}
      </div>
    </div>
  )
}

export const FieldRow = memo(FieldRowImpl)
