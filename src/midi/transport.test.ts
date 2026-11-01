import { describe, expect, it } from 'vitest';
import { encodeNrpn } from '../core/nrpn/decoder';
import { UnsafeSendError } from '../core/safety';
import { requestProgram } from '../core/sysex/messages';
import { fakeProgramDump } from '../core/sysex/testdata';
import { request, RequestTimeout } from './request';
import { WebMidiTransport, type MidiInputPort, type MidiOutputPort } from './transport';

function fakePorts() {
  const sent: { msg: number[]; at: number }[] = [];
  const input: MidiInputPort = { name: 'Take 5', onmidimessage: null };
  const output: MidiOutputPort = { name: 'Take 5', send: (data) => void sent.push({ msg: [...data], at: Date.now() }) };
  const receive = (...chunks: number[][]) => chunks.forEach((c) => input.onmidimessage?.({ data: Uint8Array.from(c) }));
  return { input, output, sent, receive };
}

describe('WebMidiTransport', () => {
  it('allows only reads by default', async () => {
    const { input, output, sent } = fakePorts();
    const t = new WebMidiTransport(input, output, { minGapMs: 0 });
    await t.send(requestProgram(0, 0));
    await expect(t.send(fakeProgramDump(0, 0, 'x'))).rejects.toBeInstanceOf(UnsafeSendError);
    await expect(t.send(encodeNrpn(0, 29, 1)[0])).rejects.toBeInstanceOf(UnsafeSendError);
    await expect(t.send(Uint8Array.of(0xc0, 1))).rejects.toBeInstanceOf(UnsafeSendError);
    expect(sent.map((s) => s.msg)).toEqual([[...requestProgram(0, 0)]]);
  });

  it('sends volatile messages only when allowed, and never program dumps', async () => {
    const { input, output, sent } = fakePorts();
    const t = new WebMidiTransport(input, output, { minGapMs: 0, allow: ['read', 'volatile'] });
    for (const m of encodeNrpn(0, 29, 512)) await t.send(m);
    for (const m of encodeNrpn(0, 4106, 0).slice(0, 2)) await t.send(m); // selecting a global is harmless…
    await expect(t.send(encodeNrpn(0, 4106, 0)[2])).rejects.toBeInstanceOf(UnsafeSendError); // …setting it is not
    await expect(t.send(fakeProgramDump(0, 0, 'x'))).rejects.toBeInstanceOf(UnsafeSendError);
    expect(sent.length).toBe(6);
  });

  it('hands the output a plain array (some Node libraries reject typed arrays)', async () => {
    let arg: unknown;
    const t = new WebMidiTransport({ onmidimessage: null }, { send: (d) => void (arg = d) }, { minGapMs: 0 });
    await t.send(requestProgram(1, 2));
    expect(Array.isArray(arg)).toBe(true);
  });

  it('holds sends until both ports are open', async () => {
    const order: string[] = [];
    let openInput!: () => void;
    const input: MidiInputPort = { onmidimessage: null, open: () => new Promise<void>((r) => (openInput = r)).then(() => void order.push('open')) };
    const t = new WebMidiTransport(input, { send: () => void order.push('send') }, { minGapMs: 0 });
    const sent = t.send(requestProgram(0, 0));
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]);
    openInput();
    await sent;
    expect(order).toEqual(['open', 'send']);
  });

  it('allows extra levels only while allowDuring runs', async () => {
    const { input, output, sent } = fakePorts();
    const t = new WebMidiTransport(input, output, { minGapMs: 0 });
    const dump = fakeProgramDump(0, 0, 'x');
    await t.allowDuring(['persistent'], () => t.send(dump));
    await expect(t.send(dump)).rejects.toBeInstanceOf(UnsafeSendError);
    expect(sent.length).toBe(1);
  });

  it('spaces out sends by minGapMs', async () => {
    const { input, output, sent } = fakePorts();
    const t = new WebMidiTransport(input, output, { minGapMs: 15 });
    await Promise.all([0, 1, 2].map((p) => t.send(requestProgram(0, p))));
    expect(sent[1].at - sent[0].at).toBeGreaterThanOrEqual(14);
    expect(sent[2].at - sent[1].at).toBeGreaterThanOrEqual(14);
  });

  it('reassembles fragmented SysEx and traces both directions', async () => {
    const { input, output, receive } = fakePorts();
    const trace: string[] = [];
    const t = new WebMidiTransport(input, output, { minGapMs: 0, trace: (dir, m) => trace.push(`${dir}:${m.length}`) });
    const got: number[][] = [];
    t.onMessage((m) => got.push([...m]));
    await t.send(requestProgram(0, 0));
    receive([0xf0, 1, 2], [3, 0xf7], [0x90, 60, 1]);
    expect(got).toEqual([[0xf0, 1, 2, 3, 0xf7], [0x90, 60, 1]]);
    expect(trace).toEqual(['out:7', 'in:5', 'in:3']);
  });
});

describe('request', () => {
  it('resolves with the first matching reply', async () => {
    const { input, output, receive } = fakePorts();
    const t = new WebMidiTransport(input, output, { minGapMs: 0 });
    const pending = request(t, requestProgram(0, 0), (m) => (m[0] === 0xf0 ? m.length : null), 500);
    await Promise.resolve();
    receive([0x90, 1, 1], [0xf0, 9, 0xf7]);
    await expect(pending).resolves.toMatchObject({ value: 3 });
  });

  it('times out', async () => {
    const { input, output } = fakePorts();
    const t = new WebMidiTransport(input, output, { minGapMs: 0 });
    await expect(request(t, requestProgram(0, 0), () => null, 30)).rejects.toBeInstanceOf(RequestTimeout);
  });
});
