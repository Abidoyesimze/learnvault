import React, { useState } from "react"
import { type ContributorRecord, type ProposalRecord, useContribute } from "../hooks/useProposals"
import { useWallet } from "../hooks/useWallet"
import {
	SCHOLARSHIP_TREASURY_CONTRACT_ID,
	createScholarshipTreasuryContract,
} from "../util/scholarshipTreasury"
import { useToast } from "./Toast/ToastProvider"

const USDC_CONTRACT_ID =
	(import.meta.env.VITE_USDC_CONTRACT_ID as string | undefined) ?? ""

const shortenAddress = (addr: string) =>
	`${addr.slice(0, 6)}...${addr.slice(-4)}`

function FundingBar({
	current,
	target,
}: {
	current: number
	target: number
}) {
	const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
	return (
		<div className="mb-4">
			<div className="flex justify-between text-xs font-black uppercase tracking-widest mb-2 text-white/60">
				<span>{current.toLocaleString()} USDC raised</span>
				<span>{pct}% of {target.toLocaleString()}</span>
			</div>
			<div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
				<div
					className="h-full bg-brand-cyan transition-all duration-500"
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	)
}

function ContributorList({ contributors }: { contributors: ContributorRecord[] }) {
	if (contributors.length === 0) {
		return (
			<p className="text-xs text-white/30 text-center py-4">
				No contributions yet — be the first!
			</p>
		)
	}

	return (
		<ul className="space-y-2 max-h-48 overflow-auto pr-1">
			{contributors.map((c) => (
				<li
					key={c.tx_hash}
					className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-xs"
				>
					<span className="font-mono text-white/60" title={c.donor_address}>
						{shortenAddress(c.donor_address)}
					</span>
					<span className="text-brand-cyan font-black">
						+{c.amount.toLocaleString()} USDC
					</span>
				</li>
			))}
		</ul>
	)
}

interface Props {
	proposal: ProposalRecord
}

export const CoFundingSection: React.FC<Props> = ({ proposal }) => {
	const { address, signTransaction, networkPassphrase } = useWallet()
	const { showSuccess, showError } = useToast()
	const contributeMutation = useContribute()

	const [amount, setAmount] = useState("")
	const [isSigning, setIsSigning] = useState(false)

	const isEligible =
		proposal.status === "approved" || proposal.status === "queued"

	if (!isEligible) return null

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value
		// Allow only positive numbers with up to 2 decimal places
		if (val === "" || /^\d+(\.\d{0,2})?$/.test(val)) {
			setAmount(val)
		}
	}

	const handleQuickAmount = (value: number) => setAmount(value.toString())

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!address) {
			showError("Connect your wallet to co-fund this proposal")
			return
		}
		const numericAmount = parseFloat(amount)
		if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
			showError("Enter a valid USDC amount")
			return
		}
		if (!USDC_CONTRACT_ID) {
			showError("USDC contract is not configured in this environment")
			return
		}
		const contractId = SCHOLARSHIP_TREASURY_CONTRACT_ID
		if (!contractId) {
			showError("Scholarship treasury contract is not configured")
			return
		}

		setIsSigning(true)
		try {
			// 1. Build + sign + send the on-chain deposit transaction
			const contract = createScholarshipTreasuryContract(contractId, address)
			const txHash = await contract.deposit(amount, USDC_CONTRACT_ID, signTransaction)

			// 2. Tell the backend to verify and record the contribution
			await contributeMutation.mutateAsync({
				proposalId: proposal.id,
				donor_address: address,
				amount: numericAmount,
				tx_hash: txHash,
			})

			setAmount("")
			showSuccess(
				`Contributed ${numericAmount.toLocaleString()} USDC — thank you!`,
			)
		} catch (err) {
			showError(
				err instanceof Error ? err.message : "Contribution failed — please try again",
			)
		} finally {
			setIsSigning(false)
		}
	}

	const isSubmitting = isSigning || contributeMutation.isPending
	const fullyFunded = proposal.currentFunding >= proposal.amount

	return (
		<section className="mt-8 rounded-[2rem] border border-brand-cyan/20 bg-brand-cyan/5 p-8">
			<h3 className="text-lg font-black uppercase tracking-widest text-brand-cyan mb-1">
				Co-fund this Proposal
			</h3>
			<p className="text-xs text-white/40 mb-6">
				Top up the treasury allocation for this approved proposal.
			</p>

			<FundingBar current={proposal.currentFunding} target={proposal.amount} />

			{fullyFunded ? (
				<div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 text-center mb-6">
					<p className="text-sm font-black text-emerald-300 uppercase tracking-widest">
						Fully Funded
					</p>
				</div>
			) : (
				<form onSubmit={(e) => void handleSubmit(e)} className="mb-6">
					<div className="flex flex-wrap gap-2 mb-4">
						{[50, 100, 500, 1000].map((v) => (
							<button
								key={v}
								type="button"
								onClick={() => handleQuickAmount(v)}
								className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${
									amount === v.toString()
										? "bg-brand-cyan text-black border-brand-cyan"
										: "border-white/10 bg-white/5 text-white/40 hover:border-brand-cyan/40 hover:text-white"
								}`}
							>
								${v}
							</button>
						))}
					</div>

					<div className="flex gap-3">
						<input
							type="number"
							min="1"
							step="0.01"
							value={amount}
							onChange={handleAmountChange}
							placeholder="Amount in USDC"
							className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-brand-cyan/50 focus:outline-none"
						/>
						<button
							type="submit"
							disabled={!address || !amount || isSubmitting}
							className="px-6 py-3 rounded-xl bg-brand-cyan text-black text-sm font-black uppercase tracking-widest transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
						>
							{isSubmitting ? "Sending..." : "Co-fund"}
						</button>
					</div>

					{!address && (
						<p className="mt-3 text-xs text-white/30">
							Connect your wallet to contribute.
						</p>
					)}
				</form>
			)}

			<div>
				<h4 className="text-xs font-black uppercase tracking-widest text-white/50 mb-3">
					Contributors
				</h4>
				<ContributorList contributors={proposal.contributors} />
			</div>
		</section>
	)
}
