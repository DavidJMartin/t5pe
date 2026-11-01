// "Packed MS bit" encoding, protocol.md §3.1.
// Each 8-byte packet is a header byte followed by 7 data bytes with bit 7 cleared;
// bit i of the header is bit 7 of data byte i.

/** Unpack 7-bit MIDI data into 8-bit bytes. A trailing partial packet is unpacked as far as it goes. */
export function unpackMsb(packed: Uint8Array): Uint8Array {
  const fullPackets = Math.floor(packed.length / 8);
  const tail = packed.length % 8;
  const out = new Uint8Array(fullPackets * 7 + Math.max(0, tail - 1));
  let o = 0;
  for (let p = 0; p < packed.length; p += 8) {
    const header = packed[p];
    const end = Math.min(p + 8, packed.length);
    for (let i = 0; p + 1 + i < end; i++) {
      out[o++] = (packed[p + 1 + i] & 0x7f) | (((header >> i) & 1) << 7);
    }
  }
  return out;
}

/** Pack 8-bit bytes into 7-bit MIDI data. A trailing partial chunk becomes a short packet. */
export function packMsb(data: Uint8Array): Uint8Array {
  const fullChunks = Math.floor(data.length / 7);
  const tail = data.length % 7;
  const out = new Uint8Array(fullChunks * 8 + (tail > 0 ? tail + 1 : 0));
  let o = 0;
  for (let c = 0; c < data.length; c += 7) {
    const end = Math.min(c + 7, data.length);
    let header = 0;
    for (let i = 0; c + i < end; i++) header |= ((data[c + i] >> 7) & 1) << i;
    out[o++] = header;
    for (let i = c; i < end; i++) out[o++] = data[i] & 0x7f;
  }
  return out;
}
