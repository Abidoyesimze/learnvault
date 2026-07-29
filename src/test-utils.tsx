import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderOptions } from "@testing-library/react"
import React, { type ReactElement } from "react"
import { BrowserRouter } from "react-router-dom"
import { ToastProvider } from "./components/Toast/ToastProvider"
import { WalletProvider, WalletContext } from "./providers/WalletProvider"

/**
 * Centralized render helper used across the repo.
 * Wraps UI with routing, react‑query, wallet, and toast contexts.
 */
export function renderWithProviders(
	ui: ReactElement,
	{
		wallet = {
			address: "GADMINADDRESS",
			isAdmin: true,
			balances: {},
			isPending: false,
			isReconnecting: false,
			signTransaction: async () => ({ signedTxXdr: "" }),
			updateBalances: async () => {},
			network: "TESTNET",
			networkPassphrase: "Test SDF Network ; September 2015",
		},
		...options
	}: {
		wallet?: any
		queryClient?: QueryClient
	} & RenderOptions = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})

	const Wrapper = ({ children }: { children: React.ReactNode }) => (
		<BrowserRouter>
			<QueryClientProvider client={queryClient}>
				<WalletContext.Provider value={wallet}>
					<ToastProvider>{children}</ToastProvider>
				</WalletContext.Provider>
			</QueryClientProvider>
		</BrowserRouter>
	)

	return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) }
}
