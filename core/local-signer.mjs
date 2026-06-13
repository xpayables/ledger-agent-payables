// Local viem account adapter used by tests to exercise the Ledger signing path.
import { parseSignature } from "viem";

export function localEip191App(account) {
  return {
    async getAddress() {
      return { address: account.address };
    },
    async signPersonalMessage(_derivationPath, messageHex) {
      const signatureHex = await account.signMessage({ message: { raw: `0x${messageHex}` } });
      const { r, s, yParity } = parseSignature(signatureHex);
      return { r: r.slice(2), s: s.slice(2), v: 27 + yParity };
    },
  };
}
