import { FileCode2, Package, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { importFiles } from '@/components/DialectSwitcher'
import { useStore } from '@/store'

export function Welcome() {
  const dialects = useStore((s) => s.dialects)
  const selectDialect = useStore((s) => s.selectDialect)
  const user = dialects.filter((d) => !d.builtin)
  const builtin = dialects.filter((d) => d.builtin).slice(0, 6)

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Load your MAVLink definitions</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Import the XML you are working on, for example your edited <code className="bg-muted rounded px-1 py-0.5 font-sans">common.xml</code>. Included files such
          as <code className="bg-muted rounded px-1 py-0.5 font-sans">standard.xml</code> are picked up from the same folder, or from the bundled official set. The app
          watches your files and reloads them when you save.
        </p>

        <button
          onClick={() => importFiles()}
          className="border-border hover:border-primary/60 hover:bg-primary/5 group mt-6 flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors"
        >
          <Upload className="text-muted-foreground group-hover:text-primary size-8 transition-colors" />
          <div className="text-sm font-medium">Drop .xml files here or click to browse</div>
          <div className="text-muted-foreground text-xs">You can select several files at once</div>
        </button>

        {user.length > 0 && (
          <div className="mt-8">
            <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">Recent</h3>
            <div className="grid gap-1.5">
              {user.map((d) => (
                <button
                  key={d.id}
                  onClick={() => selectDialect(d.id)}
                  className="hover:bg-accent flex items-center gap-3 rounded-lg border px-3 py-2 text-left"
                >
                  <FileCode2 className="text-primary size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs">{d.rootFile}</div>
                    <div className="text-muted-foreground truncate text-xs">{d.sourcePath}</div>
                  </div>
                  <span className="text-muted-foreground text-xs">{d.messageCount} msgs</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">Or start from the official definitions</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {builtin.map((d) => (
              <Button key={d.id} variant="outline" className="justify-start text-xs" onClick={() => selectDialect(d.id)}>
                <Package className="text-muted-foreground" /> {d.rootFile}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
