import express from "express"
import jwt from "jsonwebtoken"
import request from "supertest"

process.env.JWT_SECRET = "learnvault-secret"
process.env.STELLAR_SECRET_KEY = "test-secret-key"
process.env.SCHOLARSHIP_TREASURY_CONTRACT_ID =
	"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"
process.env.NODE_ENV = "test"

// Mock DB pool before importing anything that uses it
const mockQuery = jest.fn()
const mockClient = {
	query: jest.fn(),
	release: jest.fn(),
}
jest.mock("../db/index", () => ({
	pool: {
		query: mockQuery,
		connect: jest.fn().mockResolvedValue(mockClient),
	},
}))

// Mock Horizon verification so unit tests don't hit the network
jest.mock("../services/horizon-verify.service", () => ({
	verifyDepositTx: jest.fn().mockResolvedValue(true),
}))

jest.mock("../services/stellar-contract.service", () => ({
	stellarContractService: {
		submitScholarshipProposal: jest.fn().mockResolvedValue({
			txHash: "fake_tx_hash",
			simulated: true,
		}),
	},
}))

jest.mock("../services/escrow-timeout.service", () => ({
	trackEscrowTimeout: jest.fn().mockResolvedValue(undefined),
}))

import { scholarshipsRouter } from "../routes/scholarships.routes"
import { verifyDepositTx } from "../services/horizon-verify.service"

const JWT_SECRET = "learnvault-secret"
const DONOR_ADDRESS = "GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5JBFUKJQ2K5RQDDXYZ"
const VALID_TX_HASH = "a".repeat(64) // 64-char hex hash

function makeToken(address: string) {
	return jwt.sign({ sub: address }, JWT_SECRET)
}

const app = express()
app.use(express.json())
app.use("/api", scholarshipsRouter)

// ---------------------------------------------------------------------------
// POST /api/scholarships/:id/contribute
// ---------------------------------------------------------------------------

describe("POST /api/scholarships/:id/contribute", () => {
	beforeEach(() => {
		jest.clearAllMocks()

		// Default: proposal exists, is approved, and not yet fully funded
		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes("SELECT id, status, amount, current_funding")) {
				return Promise.resolve({
					rows: [{ id: 1, status: "approved", amount: "1000", current_funding: "0" }],
				})
			}
			return Promise.resolve({ rows: [] })
		})

		mockClient.query.mockImplementation((sql: string) => {
			if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
				return Promise.resolve({ rows: [] })
			}
			if (sql.includes("INSERT INTO scholarship_contributions")) {
				return Promise.resolve({ rows: [] })
			}
			if (sql.includes("UPDATE proposals")) {
				return Promise.resolve({
					rows: [{ current_funding: "500", amount: "1000" }],
				})
			}
			return Promise.resolve({ rows: [] })
		})
	})

	it("records a valid contribution and returns current_funding", async () => {
		const token = makeToken(DONOR_ADDRESS)

		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({
				donor_address: DONOR_ADDRESS,
				amount: 500,
				tx_hash: VALID_TX_HASH,
			})

		expect(res.status).toBe(200)
		expect(res.body).toHaveProperty("current_funding", 500)
		expect(res.body).toHaveProperty("fully_funded", false)
	})

	it("returns fully_funded: true when contribution completes the funding", async () => {
		mockClient.query.mockImplementation((sql: string) => {
			if (sql === "BEGIN" || sql === "COMMIT") return Promise.resolve({ rows: [] })
			if (sql.includes("INSERT INTO scholarship_contributions")) {
				return Promise.resolve({ rows: [] })
			}
			if (sql.includes("UPDATE proposals") && sql.includes("current_funding")) {
				return Promise.resolve({
					rows: [{ current_funding: "1000", amount: "1000" }],
				})
			}
			return Promise.resolve({ rows: [] })
		})

		const token = makeToken(DONOR_ADDRESS)
		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 1000, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(200)
		expect(res.body.fully_funded).toBe(true)
	})

	it("returns 401 when no auth token is provided", async () => {
		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.send({ donor_address: DONOR_ADDRESS, amount: 500, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(401)
	})

	it("returns 403 when donor_address does not match JWT", async () => {
		const token = makeToken("GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ")

		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 500, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(403)
	})

	it("returns 400 for invalid tx_hash length", async () => {
		const token = makeToken(DONOR_ADDRESS)

		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 500, tx_hash: "tooshort" })

		expect(res.status).toBe(400)
		expect(res.body).toHaveProperty("details.tx_hash")
	})

	it("returns 400 for non-positive amount", async () => {
		const token = makeToken(DONOR_ADDRESS)

		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: -10, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(400)
	})

	it("returns 404 when proposal does not exist", async () => {
		mockQuery.mockResolvedValue({ rows: [] })
		const token = makeToken(DONOR_ADDRESS)

		const res = await request(app)
			.post("/api/scholarships/999/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 100, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(404)
	})

	it("returns 409 when proposal is not in approved/queued state", async () => {
		mockQuery.mockResolvedValue({
			rows: [{ id: 1, status: "pending", amount: "1000", current_funding: "0" }],
		})
		const token = makeToken(DONOR_ADDRESS)

		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 100, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(409)
	})

	it("returns 422 when Horizon verification fails", async () => {
		;(verifyDepositTx as jest.Mock).mockResolvedValueOnce(false)
		const token = makeToken(DONOR_ADDRESS)

		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 100, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(422)
	})

	it("returns 409 for duplicate tx_hash", async () => {
		mockClient.query.mockImplementation((sql: string) => {
			if (sql === "BEGIN") return Promise.resolve({ rows: [] })
			if (sql.includes("INSERT INTO scholarship_contributions")) {
				const err = new Error(
					'duplicate key value violates unique constraint "scholarship_contributions_tx_hash_key"',
				)
				throw err
			}
			return Promise.resolve({ rows: [] })
		})

		const token = makeToken(DONOR_ADDRESS)
		const res = await request(app)
			.post("/api/scholarships/1/contribute")
			.set("Authorization", `Bearer ${token}`)
			.send({ donor_address: DONOR_ADDRESS, amount: 100, tx_hash: VALID_TX_HASH })

		expect(res.status).toBe(409)
		expect(res.body.error).toMatch(/already been recorded/)
	})
})

// ---------------------------------------------------------------------------
// GET /api/scholarships/:id/contributors
// ---------------------------------------------------------------------------

describe("GET /api/scholarships/:id/contributors", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("returns contributor list for a known proposal", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ id: 1, current_funding: "500", amount: "1000" }],
			})
			.mockResolvedValueOnce({
				rows: [
					{
						donor_address: DONOR_ADDRESS,
						amount: "500",
						tx_hash: VALID_TX_HASH,
						created_at: new Date().toISOString(),
					},
				],
			})

		const res = await request(app).get("/api/scholarships/1/contributors")

		expect(res.status).toBe(200)
		expect(res.body).toHaveProperty("contributors")
		expect(res.body.contributors).toHaveLength(1)
		expect(res.body.contributors[0]).toHaveProperty("donor_address", DONOR_ADDRESS)
		expect(res.body).toHaveProperty("current_funding", 500)
		expect(res.body).toHaveProperty("target_amount", 1000)
	})

	it("returns 404 for unknown proposal", async () => {
		mockQuery.mockResolvedValue({ rows: [] })
		const res = await request(app).get("/api/scholarships/999/contributors")
		expect(res.status).toBe(404)
	})

	it("returns empty contributors array when no contributions exist", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ id: 1, current_funding: "0", amount: "1000" }],
			})
			.mockResolvedValueOnce({ rows: [] })

		const res = await request(app).get("/api/scholarships/1/contributors")
		expect(res.status).toBe(200)
		expect(res.body.contributors).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// Unit tests for verifyDepositTx (testing the mock behaviour)
// ---------------------------------------------------------------------------

describe("verifyDepositTx", () => {
	it("resolves to true when the mock is configured", async () => {
		const result = await verifyDepositTx(VALID_TX_HASH, 100, DONOR_ADDRESS)
		expect(result).toBe(true)
	})

	it("resolves to false when the mock returns false", async () => {
		;(verifyDepositTx as jest.Mock).mockResolvedValueOnce(false)
		const result = await verifyDepositTx(VALID_TX_HASH, 100, DONOR_ADDRESS)
		expect(result).toBe(false)
	})
})
