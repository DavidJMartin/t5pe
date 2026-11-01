// Incoming NRPN state machine, protocol.md §5.1.
// CC99 = param MSB, CC98 = param LSB, CC6 = value MSB, CC38 = value LSB (commits).
// CC96/97 = data increment/decrement. CC101/100 select an RPN, which deselects the NRPN.

export const CC = {
  DataEntryMsb: 6,
  DataEntryLsb: 38,
  DataIncrement: 96,
  DataDecrement: 97,
  NrpnLsb: 98,
  NrpnMsb: 99,
  RpnLsb: 100,
  RpnMsb: 101,
} as const;

export type NrpnEvent =
  | { kind: 'value'; channel: number; param: number; value: number }
  | { kind: 'increment' | 'decrement'; channel: number; param: number; amount: number };

interface ChannelState {
  paramMsb: number | null;
  paramLsb: number | null;
  valueMsb: number | null;
}

export class NrpnDecoder {
  private state = new Map<number, ChannelState>();

  /** Feed a control change. Returns an event when an NRPN value is committed. */
  controlChange(channel: number, controller: number, value: number): NrpnEvent | null {
    const s = this.channel(channel);
    switch (controller) {
      case CC.NrpnMsb:
        s.paramMsb = value;
        s.valueMsb = null;
        return null;
      case CC.NrpnLsb:
        s.paramLsb = value;
        s.valueMsb = null;
        return null;
      case CC.RpnMsb:
      case CC.RpnLsb:
        s.paramMsb = s.paramLsb = s.valueMsb = null;
        return null;
      case CC.DataEntryMsb:
        s.valueMsb = value;
        return null;
      case CC.DataEntryLsb: {
        const param = this.param(s);
        if (param === null || s.valueMsb === null) return null;
        return { kind: 'value', channel, param, value: (s.valueMsb << 7) | value };
      }
      case CC.DataIncrement:
      case CC.DataDecrement: {
        const param = this.param(s);
        if (param === null) return null;
        return { kind: controller === CC.DataIncrement ? 'increment' : 'decrement', channel, param, amount: value };
      }
      default:
        return null;
    }
  }

  /** True if this controller number is part of the NRPN protocol. */
  static isNrpnController(controller: number): boolean {
    return Object.values(CC).includes(controller as (typeof CC)[keyof typeof CC]);
  }

  /** The parameter currently selected on a channel, if any. */
  selected(channel: number): number | null {
    return this.param(this.channel(channel));
  }

  private param(s: ChannelState): number | null {
    return s.paramMsb === null || s.paramLsb === null ? null : (s.paramMsb << 7) | s.paramLsb;
  }

  private channel(channel: number): ChannelState {
    let s = this.state.get(channel);
    if (!s) this.state.set(channel, (s = { paramMsb: null, paramLsb: null, valueMsb: null }));
    return s;
  }
}

/** Encode an NRPN as the four CCs we always send (protocol.md §5.1). Channel is 0-based. */
export function encodeNrpn(channel: number, param: number, value: number): Uint8Array[] {
  const status = 0xb0 | (channel & 0x0f);
  return [
    Uint8Array.of(status, CC.NrpnMsb, (param >> 7) & 0x7f),
    Uint8Array.of(status, CC.NrpnLsb, param & 0x7f),
    Uint8Array.of(status, CC.DataEntryMsb, (value >> 7) & 0x7f),
    Uint8Array.of(status, CC.DataEntryLsb, value & 0x7f),
  ];
}
