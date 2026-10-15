import { useEffect, useState } from 'react'
import { MousePointerClick, Upload } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DialectSwitcher, importFiles } from '@/components/DialectSwitcher'
import { LinkBar } from '@/components/LinkBar'
import { MessageEditor } from '@/components/MessageEditor'
import { MessageList } from '@/components/MessageList'
import { StreamsPanel } from '@/components/StreamsPanel'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Welcome } from '@/components/Welcome'
import { useSelectedMessage, useStore } from '@/store'

function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
    }
    const leave = (): void => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent): void => e.preventDefault()
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map((f) => window.api.pathForFile(f))
        .filter(Boolean)
      if (paths.length) void importFiles(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return dragging
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const dialect = useStore((s) => s.dialect)
  const msg = useSelectedMessage()
  const dragging = useFileDrop()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
          <div className="flex items-center gap-2 pr-2">
            <div className="bg-primary/15 text-primary grid size-7 place-items-center rounded-md text-xs font-bold">ME</div>
            <span className="hidden text-sm font-semibold tracking-tight whitespace-nowrap xl:inline">MAVLink Ephemeral</span>
          </div>
          <DialectSwitcher />
          <div className="flex-1" />
          <LinkBar />
          <div className="bg-border h-6 w-px" />
          <ThemeToggle />
        </header>

        <div className="flex min-h-0 flex-1">
          {dialect && (
            <aside className="w-72 shrink-0 border-r xl:w-80">
              <MessageList />
            </aside>
          )}
          <main className="min-w-0 flex-1">
            {!ready ? null : !dialect ? (
              <Welcome />
            ) : msg ? (
              <MessageEditor key={`${dialect.id}/${msg.name}`} msg={msg} />
            ) : (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-sm">
                <MousePointerClick className="size-6 opacity-50" />
                Select a message from {dialect.rootFile} to configure and stream it.
              </div>
            )}
          </main>
          <aside className="w-72 shrink-0 border-l xl:w-80">
            <StreamsPanel />
          </aside>
        </div>
      </div>

      {dragging && (
        <div className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="border-primary text-primary flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-16 py-12">
            <Upload className="size-8" />
            <div className="text-sm font-medium">Drop MAVLink XML files to import</div>
          </div>
        </div>
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
