import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createServer, Socket, type Server } from 'node:net'
import type { LinkConfig, LinkStatus } from '@shared/types'

interface RemoteSystem {
  systemId: number
  componentId: number
  lastSeen: number
  msgCount: number
}

/**
 * A single outgoing MAVLink link (UDP, TCP server or TCP client).
 * Incoming bytes are scanned for frame headers so the UI can show which systems (e.g. the GCS) are talking back.
 */
export class Link {
  private udp?: UdpSocket
  private server?: Server
  private clients = new Set<Socket>()
  private client?: Socket
  private reconnectTimer?: NodeJS.Timeout
  private config?: LinkConfig
  private seq = 0
  private rxBuf: Buffer = Buffer.alloc(0)
  private remote = new Map<string, RemoteSystem>()
  /** UDP peers that sent us something; we answer them too (like a vehicle would). */
  private udpPeers = new Map<string, { address: string; port: number }>()

  status: LinkStatus = this.emptyStatus()

  private emptyStatus(): LinkStatus {
    return { open: false, state: 'closed', bytesSent: 0, bytesReceived: 0, framesSent: 0, peers: [], remoteSystems: [] }
  }

  get isOpen(): boolean {
    return this.status.open
  }

  get linkConfig(): LinkConfig | undefined {
    return this.config
  }

  nextSeq(): number {
    const s = this.seq
    this.seq = (this.seq + 1) & 0xff
    return s
  }

  /** Updates ids / heartbeat settings without reopening sockets. */
  updateConfig(config: LinkConfig): void {
    if (!this.config) {
      this.config = config
      return
    }
    const endpointChanged =
      config.protocol !== this.config.protocol ||
      config.host !== this.config.host ||
      config.port !== this.config.port ||
      config.localPort !== this.config.localPort
    this.config = config
    if (endpointChanged && this.isOpen) {
      this.close()
      void this.open(config)
    }
  }

  async open(config: LinkConfig): Promise<LinkStatus> {
    this.close()
    this.config = config
    this.status = { ...this.emptyStatus(), open: true, state: 'opening' }
    try {
      if (config.protocol === 'udp') await this.openUdp(config)
      else if (config.protocol === 'tcp-server') await this.openTcpServer(config)
      else this.openTcpClient(config)
    } catch (e) {
      this.close()
      this.status.error = (e as Error).message
      this.status.state = 'error'
      throw e
    }
    return this.status
  }

  private openUdp(config: LinkConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createSocket({ type: config.host.includes(':') ? 'udp6' : 'udp4', reuseAddr: true })
      sock.once('error', reject)
      sock.on('message', (data, rinfo) => {
        const key = `${rinfo.address}:${rinfo.port}`
        // Replies from the destination itself are already covered by the configured target.
        if (!this.udpPeers.has(key) && rinfo.port !== config.port) {
          this.udpPeers.set(key, { address: rinfo.address, port: rinfo.port })
        }
        this.onData(data)
      })
      sock.bind(config.localPort || 0, () => {
        sock.removeListener('error', reject)
        sock.on('error', (e) => (this.status.error = e.message))
        try {
          sock.setBroadcast(true)
        } catch {
          /* ignore */
        }
        this.udp = sock
        const local = sock.address()
        this.status.state = `UDP ${local.port} → ${config.host}:${config.port}`
        resolve()
      })
    })
  }

  private openTcpServer(config: LinkConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((sock) => {
        sock.setNoDelay(true)
        this.clients.add(sock)
        sock.on('data', (d) => this.onData(d as Buffer))
        sock.on('error', () => undefined)
        sock.on('close', () => this.clients.delete(sock))
      })
      server.once('error', reject)
      server.listen(config.port, config.host || '0.0.0.0', () => {
        server.removeListener('error', reject)
        server.on('error', (e) => (this.status.error = e.message))
        this.server = server
        this.status.state = `TCP server listening on ${config.host || '0.0.0.0'}:${config.port}`
        resolve()
      })
    })
  }

  private openTcpClient(config: LinkConfig): void {
    const connect = (): void => {
      if (!this.status.open) return
      const sock = new Socket()
      this.status.state = `connecting to ${config.host}:${config.port}…`
      sock.setNoDelay(true)
      sock.connect(config.port, config.host, () => {
        this.client = sock
        this.status.error = undefined
        this.status.state = `TCP connected to ${config.host}:${config.port}`
      })
      sock.on('data', (d) => this.onData(d as Buffer))
      sock.on('error', (e) => (this.status.error = e.message))
      sock.on('close', () => {
        if (this.client === sock) this.client = undefined
        if (this.status.open) {
          this.status.state = `disconnected, retrying ${config.host}:${config.port}…`
          this.reconnectTimer = setTimeout(connect, 1000)
        }
      })
    }
    connect()
  }

  close(): void {
    this.status.open = false
    clearTimeout(this.reconnectTimer)
    this.udp?.close()
    this.udp = undefined
    for (const c of this.clients) c.destroy()
    this.clients.clear()
    this.server?.close()
    this.server = undefined
    this.client?.destroy()
    this.client = undefined
    this.udpPeers.clear()
    this.remote.clear()
    this.rxBuf = Buffer.alloc(0)
    this.status.state = 'closed'
    this.status.peers = []
  }

  send(frame: Uint8Array): void {
    const c = this.config
    if (!c || !this.status.open) return
    let sent = false
    if (this.udp) {
      this.udp.send(frame, c.port, c.host)
      for (const p of this.udpPeers.values()) this.udp.send(frame, p.port, p.address)
      sent = true
    } else if (this.server) {
      for (const s of this.clients) {
        // Drop frames for slow consumers instead of buffering without bound.
        if (s.writableLength < 1 << 20) s.write(frame)
      }
      sent = this.clients.size > 0
    } else if (this.client) {
      if (this.client.writableLength < 1 << 20) this.client.write(frame)
      sent = true
    }
    if (sent) {
      this.status.bytesSent += frame.length
      this.status.framesSent++
    }
  }

  private onData(data: Buffer): void {
    this.status.bytesReceived += data.length
    this.rxBuf = this.rxBuf.length ? Buffer.concat([this.rxBuf, data]) : data
    let i = 0
    const b = this.rxBuf
    while (i < b.length) {
      if (b[i] === 0xfd && i + 10 <= b.length) {
        const len = b[i + 1]
        const total = 12 + len + (b[i + 2] & 1 ? 13 : 0)
        if (i + total > b.length) break
        this.noteRemote(b[i + 5], b[i + 6])
        i += total
      } else if (b[i] === 0xfe && i + 6 <= b.length) {
        const total = 8 + b[i + 1]
        if (i + total > b.length) break
        this.noteRemote(b[i + 3], b[i + 4])
        i += total
      } else if ((b[i] === 0xfd || b[i] === 0xfe) && b.length - i < 10) {
        break
      } else i++
    }
    this.rxBuf = b.subarray(i)
    if (this.rxBuf.length > 4096) this.rxBuf = Buffer.alloc(0)
  }

  private noteRemote(systemId: number, componentId: number): void {
    const key = `${systemId}/${componentId}`
    const r = this.remote.get(key) ?? { systemId, componentId, lastSeen: 0, msgCount: 0 }
    r.lastSeen = Date.now()
    r.msgCount++
    this.remote.set(key, r)
  }

  snapshot(): LinkStatus {
    const peers = this.server
      ? [...this.clients].map((s) => `${s.remoteAddress}:${s.remotePort}`)
      : [...this.udpPeers.keys()]
    const now = Date.now()
    return {
      ...this.status,
      peers,
      remoteSystems: [...this.remote.values()].filter((r) => now - r.lastSeen < 10000)
    }
  }
}
