// CRC-16/MCRF4XX (X.25) as used by MAVLink.

export const CRC_INIT = 0xffff

export function crcAccumulate(byte: number, crc: number): number {
  let tmp = (byte ^ (crc & 0xff)) & 0xff
  tmp = (tmp ^ (tmp << 4)) & 0xff
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

export function crcAccumulateBuffer(buf: Uint8Array, crc = CRC_INIT): number {
  for (let i = 0; i < buf.length; i++) crc = crcAccumulate(buf[i], crc)
  return crc
}

export function crcAccumulateString(s: string, crc = CRC_INIT): number {
  for (let i = 0; i < s.length; i++) crc = crcAccumulate(s.charCodeAt(i) & 0xff, crc)
  return crc
}
