import { useState } from 'react'
import { AlertTriangle, ChevronsUpDown, FileCode2, FolderOpen, Package, RefreshCw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { DialectSummary } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

export async function importFiles(paths?: string[]): Promise<void> {
  const r = paths ? await window.api.importPaths(paths) : await window.api.importDialog()
  if (r.canceled) return
  if (!r.dialects.length) {
    toast.error('No MAVLink XML files found')
    return
  }
  const store = useStore.getState()
  await store.refreshDialects()
  const first = r.dialects[0]
  await store.selectDialect(first.id)
  for (const d of r.dialects) {
    if (d.errors.length) toast.warning(`${d.rootFile}: ${d.errors.length} problem(s)`, { description: d.errors[0] })
    else toast.success(`Loaded ${d.rootFile}`, { description: `${d.messageCount} messages · ${d.files.map((f) => f.name).join(', ')}` })
  }
}

function DialectRow({ d, active, onPick, onDetails }: { d: DialectSummary; active: boolean; onPick: () => void; onDetails: () => void }) {
  return (
    <div
      className={cn('group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5', active ? 'bg-accent' : 'hover:bg-accent/50')}
      onClick={onPick}
    >
      {d.builtin ? <Package className="text-muted-foreground size-4 shrink-0" /> : <FileCode2 className="text-primary size-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{d.rootFile}</div>
        {!d.builtin && <div className="text-muted-foreground truncate text-[11px]">{d.sourcePath}</div>}
      </div>
      <span className="text-muted-foreground text-[11px]">{d.messageCount}</span>
      {(d.errors.length > 0 || d.warnings.length > 0) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDetails()
          }}
        >
          <AlertTriangle className={cn('size-3.5', d.errors.length ? 'text-destructive' : 'text-warning')} />
        </button>
      )}
    </div>
  )
}

export function DialectDetails({ d, open, onOpenChange }: { d: DialectSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!d) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{d.rootFile}</DialogTitle>
          <DialogDescription className="break-all">{d.sourcePath}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-auto text-sm">
          <div>
            <h4 className="text-muted-foreground mb-1 text-xs font-semibold uppercase">Files</h4>
            {d.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 py-0.5 text-xs">
                <span>{f.name}</span>
                <Badge variant="outline" className="h-4 px-1 text-[11px]">
                  {f.origin === 'source' ? 'your file' : f.origin === 'bundled' ? 'bundled official' : 'cached copy'}
                </Badge>
                <span className="text-muted-foreground truncate">{f.path}</span>
              </div>
            ))}
          </div>
          <div className="text-muted-foreground text-xs">
            {d.messageCount} messages · {d.enumCount} enums · version {d.version ?? '–'} · loaded {new Date(d.loadedAt).toLocaleTimeString()}
          </div>
          {d.errors.length > 0 && (
            <div>
              <h4 className="text-destructive mb-1 text-xs font-semibold uppercase">Errors ({d.errors.length})</h4>
              <ul className="space-y-1 text-xs">
                {d.errors.map((e, i) => (
                  <li key={i} className="bg-destructive/10 rounded px-2 py-1">{e}</li>
                ))}
              </ul>
            </div>
          )}
          {d.warnings.length > 0 && (
            <div>
              <h4 className="text-warning mb-1 text-xs font-semibold uppercase">Warnings ({d.warnings.length})</h4>
              <ul className="space-y-1 text-xs">
                {d.warnings.map((e, i) => (
                  <li key={i} className="bg-warning/10 rounded px-2 py-1">{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DialectSwitcher() {
  const dialects = useStore((s) => s.dialects)
  const active = useStore((s) => s.dialect)
  const selectDialect = useStore((s) => s.selectDialect)
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState<DialectSummary | null>(null)
  const user = dialects.filter((d) => !d.builtin)
  const builtin = dialects.filter((d) => d.builtin)
  const activeSummary = dialects.find((d) => d.id === active?.id)

  const reload = async (): Promise<void> => {
    if (!active) return
    const d = await window.api.reloadDialect(active.id)
    await useStore.getState().refreshDialects()
    await selectDialect(active.id)
    if (d?.errors.length) toast.warning(`Reloaded with ${d.errors.length} problem(s)`, { description: d.errors[0] })
    else toast.success(`Reloaded ${d?.rootFile}`, { description: `${d?.messageCount} messages` })
  }

  const remove = async (): Promise<void> => {
    if (!active || active.builtin) return
    await window.api.removeDialect(active.id)
    await useStore.getState().refreshDialects()
    await selectDialect(null)
    void window.api.setSettings({ activeDialectId: undefined })
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 w-56 justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              {active ? (
                active.builtin ? <Package className="text-muted-foreground" /> : <FileCode2 className="text-primary" />
              ) : (
                <FolderOpen className="text-muted-foreground" />
              )}
              <span className="truncate text-xs">{active ? active.rootFile : 'Select definitions…'}</span>
              {active && <span className="text-muted-foreground text-[11px]">{active.messageCount} msgs</span>}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-2" align="start">
          <Button
            className="mb-2 w-full"
            size="sm"
            onClick={() => {
              setOpen(false)
              void importFiles()
            }}
          >
            <Upload /> Import XML files…
          </Button>
          {user.length > 0 && (
            <>
              <div className="text-muted-foreground px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wider uppercase">Your definitions</div>
              {user.map((d) => (
                <DialectRow
                  key={d.id}
                  d={d}
                  active={d.id === active?.id}
                  onPick={() => {
                    void selectDialect(d.id)
                    setOpen(false)
                  }}
                  onDetails={() => setDetails(d)}
                />
              ))}
            </>
          )}
          <div className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">Bundled official</div>
          <div className="max-h-64 overflow-auto">
            {builtin.map((d) => (
              <DialectRow
                key={d.id}
                d={d}
                active={d.id === active?.id}
                onPick={() => {
                  void selectDialect(d.id)
                  setOpen(false)
                }}
                onDetails={() => setDetails(d)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {activeSummary && (activeSummary.errors.length > 0 || activeSummary.warnings.length > 0) && (
        <Button variant="ghost" size="sm" className="h-8" onClick={() => setDetails(activeSummary)}>
          <AlertTriangle className={activeSummary.errors.length ? 'text-destructive' : 'text-warning'} />
          <span className="text-xs">{activeSummary.errors.length || activeSummary.warnings.length}</span>
        </Button>
      )}
      {active && (
        <>
          <Button variant="ghost" size="icon-sm" title="Reload from disk (also happens automatically when the file changes)" onClick={reload}>
            <RefreshCw />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Definition details" onClick={() => setDetails(activeSummary ?? null)}>
            <FileCode2 />
          </Button>
          {!active.builtin && (
            <Button variant="ghost" size="icon-sm" title="Remove from app (does not delete the file)" onClick={remove}>
              <Trash2 />
            </Button>
          )}
        </>
      )}
      <DialectDetails d={details} open={!!details} onOpenChange={(o) => !o && setDetails(null)} />
    </div>
  )
}
