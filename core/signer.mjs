// Signer adapters and verifier dispatch for authority signatures.
import crypto from "node:crypto";
import {
  policyMessage,
  policyMessageHex,
  approvalMessage,
  approvalMessageHex,
} from "./policy-message.mjs";

function mockAddressFromPublicKeyPem(publicKeyPem) {
  return "0xmock" + crypto.createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

export class MockSignerAdapter {
  signatureType = "mock-secp256k1";
  #privateKey;
  #publicKey;
  #address;

  constructor() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
    });
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
    this.#address = mockAddressFromPublicKeyPem(
      this.#publicKey.export({ type: "spki", format: "pem" }),
    );
  }

  async getAddress() {
    return this.#address;
  }

  #signMessage(message) {
    const signer = crypto.createSign("sha256");
    signer.update(message);
    signer.end();
    return {
      signature: signer.sign(this.#privateKey, "base64"),
      signatureType: this.signatureType,
      signer: this.#address,
      publicKey: this.#publicKey.export({ type: "spki", format: "pem" }),
    };
  }

  async signPolicy(policy) {
    return this.#signMessage(policyMessage(policy));
  }

  async signApproval(exception) {
    return this.#signMessage(approvalMessage(exception));
  }
}

export class LedgerSignerAdapter {
  signatureType = "ledger-eip191";
  #app;
  #derivationPath;
  #address;

  constructor({ app, derivationPath = "44'/60'/0'/0/0", address } = {}) {
    if (!app || typeof app.signPersonalMessage !== "function") {
      throw new Error("LedgerSignerAdapter requires an injected app with signPersonalMessage.");
    }
    this.#app = app;
    this.#derivationPath = derivationPath;
    this.#address = address;
  }

  async getAddress() {
    if (this.#address) return this.#address;
    const result = await this.#app.getAddress(this.#derivationPath, true);
    this.#address = result.address;
    return this.#address;
  }

  async #signMessageHex(message, hex) {
    const sig = await this.#app.signPersonalMessage(this.#derivationPath, hex);
    return {
      signature: { r: `0x${sig.r}`, s: `0x${sig.s}`, v: Number(sig.v) },
      signatureType: this.signatureType,
      signer: await this.getAddress(),
      message,
    };
  }

  async signPolicy(policy) {
    return this.#signMessageHex(policyMessage(policy), policyMessageHex(policy));
  }

  async signApproval(exception) {
    return this.#signMessageHex(approvalMessage(exception), approvalMessageHex(exception));
  }
}

async function verifySignedMessage(message, signed) {
  const { signature, signatureType, signer, publicKey } = signed;
  if (signatureType === "mock-secp256k1") {
    if (!publicKey || signer !== mockAddressFromPublicKeyPem(publicKey)) return false;
    const verifier = crypto.createVerify("sha256");
    verifier.update(message);
    verifier.end();
    return verifier.verify(publicKey, signature, "base64");
  }
  if (signatureType === "ledger-eip191") {
    const { verifyLedgerSignedMessage } = await import("./ledger-verify.mjs");
    return verifyLedgerSignedMessage(message, signed);
  }
  throw new Error(`verifySignedMessage: unsupported signatureType "${signatureType}"`);
}

export async function verifyPolicySignature(policy, signed) {
  return verifySignedMessage(policyMessage(policy), signed);
}

export async function verifyApprovalSignature(exception, signed) {
  return verifySignedMessage(approvalMessage(exception), signed);
}
