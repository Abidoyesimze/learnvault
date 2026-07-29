/**
 * Verifies that a submitted Stellar transaction is a genuine deposit()
 * call to the ScholarshipTreasury contract for the expected donor and amount.
 *
 * Uses the Horizon REST API (not Soroban RPC) so verification never requires
 * a local secret key and works even when the RPC node is unavailable.
 *
 * Time complexity : O(n) where n = number of operations in the tx (always small).
 * Space complexity: O(1) — no accumulation; we exit as soon as a match is found.
 */

import { logger } from "../lib/logger"

const log = logger.child({ module: "horizon-verify" })

const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet"
const SCHOLARSHIP_TREASURY_CONTRACT_ID =
	process.env.SCHOLARSHIP_TREASURY_CONTRACT_ID ?? ""

const USDC_DECIMALS = 7
const AMOUNT_TOLERANCE_ATOMIC = 1n // 1 stroop — covers rounding in unit conversion

function getHorizonBaseUrl(): string {
	return STELLAR_NETWORK === "mainnet"
		? "https://horizon.stellar.org"
		: "https://horizon-testnet.stellar.org"
}

/**
 * Converts a USDC amount (human-readable, up to 7 decimal places) to
 * atomic/stroop units as a BigInt.
 *
 * "100"    → 1_000_000_000n
 * "100.5"  → 1_005_000_000n
 */
function usdcToAtomic(amountUsdc: number): bigint {
	const str = amountUsdc.toFixed(USDC_DECIMALS)
	const dotIndex = str.indexOf(".")
	const whole = str.slice(0, dotIndex)
	const frac = str.slice(dotIndex + 1).padEnd(USDC_DECIMALS, "0")
	return BigInt(whole) * 10_000_000n + BigInt(frac)
}

/**
 * Decodes a Stellar account ScAddress to its G-prefixed strkey.
 * Works only for account-type addresses (donor wallets).
 */
function decodeAccountAddress(
	addr: import("@stellar/stellar-sdk").xdr.ScAddress,
	StrKey: typeof import("@stellar/stellar-sdk").StrKey,
): string | null {
	if (addr.switch().name !== "scAddressTypeAccount") return null
	const rawKey = addr.accountId().ed25519()
	return StrKey.encodeEd25519PublicKey(rawKey)
}

/**
 * Decodes a Stellar contract ScAddress to its C-prefixed strkey.
 */
function decodeContractAddress(
	addr: import("@stellar/stellar-sdk").xdr.ScAddress,
	StrKey: typeof import("@stellar/stellar-sdk").StrKey,
): string | null {
	if (addr.switch().name !== "scAddressTypeContract") return null
	return StrKey.encodeContract(addr.contractId())
}

/**
 * Decodes a signed 128-bit integer ScVal to a positive BigInt.
 * For USDC deposit amounts, the value is always non-negative.
 */
function decodeI128(
	val: import("@stellar/stellar-sdk").xdr.ScVal,
): bigint | null {
	if (val.switch().name !== "scvI128") return null
	const i128 = val.i128()
	const hi = BigInt(i128.hi().toString())
	const lo = BigInt(i128.lo().toString())
	// Combine high and low 64-bit parts; for positive amounts hi === 0n
	return (hi << 64n) | lo
}

interface HorizonTxRecord {
	envelope_xdr: string
	successful: boolean
}

/**
 * Fetches a transaction record from Horizon by hash.
 * Throws on network errors or when the transaction is not found / not successful.
 */
async function fetchHorizonTx(txHash: string): Promise<HorizonTxRecord> {
	const url = `${getHorizonBaseUrl()}/transactions/${encodeURIComponent(txHash)}`
	const response = await fetch(url)

	if (response.status === 404) {
		throw new Error("Transaction not found on the Stellar network")
	}
	if (!response.ok) {
		throw new Error(`Horizon returned HTTP ${response.status} for tx ${txHash}`)
	}

	const record = (await response.json()) as HorizonTxRecord
	if (!record.successful) {
		throw new Error("Transaction was not successful on-chain")
	}

	return record
}

/**
 * Verifies that `txHash` is a `deposit(donor, amount, asset)` call on the
 * ScholarshipTreasury contract for exactly `expectedDonor` depositing
 * `expectedAmountUsdc` USDC.
 *
 * Returns `true` when a matching operation is found, `false` otherwise.
 * Throws only on network / configuration errors (not on mis-match).
 */
export async function verifyDepositTx(
	txHash: string,
	expectedAmountUsdc: number,
	expectedDonor: string,
): Promise<boolean> {
	if (!SCHOLARSHIP_TREASURY_CONTRACT_ID) {
		throw new Error(
			"SCHOLARSHIP_TREASURY_CONTRACT_ID not configured — cannot verify deposit",
		)
	}

	const { xdr, StrKey } = await import("@stellar/stellar-sdk")

	const record = await fetchHorizonTx(txHash)
	const envelope = xdr.TransactionEnvelope.fromXDR(record.envelope_xdr, "base64")

	// Soroban transactions always use v1 envelopes
	if (envelope.switch().name !== "envelopeTypeTx") {
		log.warn({ txHash }, "Unexpected envelope type — not a v1 transaction")
		return false
	}

	const ops = envelope.v1().tx().operations()
	const expectedAtomic = usdcToAtomic(expectedAmountUsdc)

	for (const op of ops) {
		const body = op.body()

		// Only care about Soroban host function invocations
		if (body.switch().name !== "invokeHostFunction") continue

		const hf = body.invokeHostFunction().hostFunction()
		if (hf.switch().name !== "hostFunctionTypeInvokeContract") continue

		const invokeArgs = hf.invokeContract()

		// 1. Contract address must be the scholarship treasury
		const contractStrkey = decodeContractAddress(
			invokeArgs.contractAddress(),
			StrKey,
		)
		if (contractStrkey !== SCHOLARSHIP_TREASURY_CONTRACT_ID) continue

		// 2. Function name must be "deposit"
		if (invokeArgs.functionName().toString() !== "deposit") continue

		const args = invokeArgs.args()
		// deposit(donor: Address, amount: i128, asset: Address) — needs at least 2 args
		if (args.length < 2) continue

		// 3. arg[0]: donor address must match
		const donorAddress = decodeAccountAddress(args[0].address(), StrKey)
		if (donorAddress !== expectedDonor) continue

		// 4. arg[1]: amount must match within tolerance
		const onChainAtomic = decodeI128(args[1])
		if (onChainAtomic === null) continue

		const diff =
			onChainAtomic >= expectedAtomic
				? onChainAtomic - expectedAtomic
				: expectedAtomic - onChainAtomic

		if (diff > AMOUNT_TOLERANCE_ATOMIC) continue

		return true
	}

	return false
}
