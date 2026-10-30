#!/usr/bin/env node
/**
 * x402.js — pay the Agent Bounty Feed paid trust layer (0.01 USDC on Base) and print
 * bounties enriched with payout history, competition counts, and verification evidence.
 *
 * Implements the x402 "exact" scheme on Base with EIP-3009 transferWithAuthorization:
 *   1. GET -> 402 with accepts[] (asset, payTo, maxAmountRequired, extra.name/version)
 *   2. Build EIP-712 domain { name, version, chainId:8453, verifyingContract:asset }
 *      and message { from, to, value, validAfter, validBefore, nonce }
 *   3. Sign with the wallet key; base64 the payment payload into X-PAYMENT
 *   4. Retry the GET with the header; server settles and returns 200 + data.
 *
 * Requires: WALLET_KEY (hex private key with USDC on Base) and `viem` for EIP-712 signing.
 *   npm i viem
 *   WALLET_KEY=0x... node x402.js --limit 20 --min_usd 1
 */
import { createWalletClient, http, getAddress, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import crypto from 'node:crypto';

const BASE_URL = process.env.ABF_BASE || 'https://agent-bounty-feed.dailydollar.workers.dev';

function nowSeconds() { return Math.floor(Date.now() / 1000); }

async function main() {
  const key = process.env.WALLET_KEY;
  if (!key) { console.error('Set WALLET_KEY to a hex private key funded with USDC on Base.'); process.exit(2); }

  const qs = new URLSearchParams();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { qs.set(k, v); i++; } }
  }
  const url = `${BASE_URL}/v1/bounties${qs.toString() ? '?' + qs.toString() : ''}`;

  // 1. Initial request — expect 402
  const first = await fetch(url, { headers: { Accept: 'application/json' } });
  if (first.status === 200) { console.log(await first.text()); return; }
  if (first.status !== 402) { console.error('Unexpected status', first.status, (await first.text()).slice(0, 300)); process.exit(1); }

  const challenge = await first.json();
  const accept = (challenge.accepts || []).find(a => /8453|base/.test(String(a.network)) && a.scheme === 'exact');
  if (!accept) { console.error('No Base/exact payment option offered.'); process.exit(1); }

  const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key);
  const chainId = 8453;
  const domain = { name: accept.extra?.name || 'USD Coin', version: accept.extra?.version || '2', chainId, verifyingContract: getAddress(accept.asset) };
  const value = BigInt(accept.maxAmountRequired);
  const validAfter = 0n;
  const validBefore = BigInt(nowSeconds() + (accept.maxTimeoutSeconds || 120));
  const nonce = toHex(crypto.randomBytes(32));

  const message = {
    from: account.address,
    to: getAddress(accept.payTo),
    value,
    validAfter,
    validBefore,
    nonce,
  };

  const wallet = createWalletClient({ account, chain: base, transport: http() });
  const signature = await wallet.signTypedData({
    account, domain,
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: accept.network,
    payload: {
      signature,
      authorization: {
        from: account.address, to: message.to, value: value.toString(),
        validAfter: validAfter.toString(), validBefore: validBefore.toString(), nonce,
      },
    },
  };
  const header = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  console.error(`Signing ${(Number(value) / 1e6).toFixed(4)} USDC from ${account.address} -> ${message.to}`);
  const paid = await fetch(url, { headers: { Accept: 'application/json', 'X-PAYMENT': header } });
  if (paid.status !== 200) { console.error('Payment request failed', paid.status, (await paid.text()).slice(0, 500)); process.exit(1); }
  const settle = paid.headers.get('x-payment-response') || paid.headers.get('payment-response');
  if (settle) console.error('Settlement:', settle);
  console.log(await paid.text());
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
