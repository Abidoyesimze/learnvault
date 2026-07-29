import { Router } from "express"

import {
	applyForScholarship,
	getScholarshipMetrics,
} from "../controllers/scholarships.controller"
import { authMiddleware } from "../middleware/auth.middleware"
import { scholarshipApplyLimiter, writeLimiter } from "../middleware/rate-limit.middleware"

export const scholarshipsRouter = Router()

/**
 * @openapi
 * /api/scholarships/metrics:
 *   get:
 *     summary: Scholarship program health metrics
 *     tags: [Scholarships]
 *     responses:
 *       200:
 *         description: Aggregated scholarship metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 active_scholarships:
 *                   type: integer
 *                 total_scholars:
 *                   type: integer
 *                 completion_rate:
 *                   type: number
 *                 avg_milestones_per_scholar:
 *                   type: number
 *                 dropout_rate:
 *                   type: number
 *                 total_usdc_disbursed:
 *                   type: number
 */
scholarshipsRouter.get("/scholarships/metrics", (req, res) => {
	void getScholarshipMetrics(req, res)
})

/**
 * @openapi
 * /api/scholarships/apply:
 *   post:
 *     tags: [Scholarships]
 *     summary: Submit a scholarship application
 *     description: |
 *       Creates a scholarship proposal on-chain via the ScholarshipTreasury contract
 *       and records it in the database. Generates a 3-milestone program automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ScholarshipApplication'
 *           example:
 *             applicant_address: "GABCD123456789..."
 *             full_name: "Jane Doe"
 *             course_id: "stellar-basics"
 *             motivation: "I want to learn blockchain development to build solutions for my community."
 *             evidence_url: "https://github.com/janedoe/portfolio"
 *             amount: 1000
 *     responses:
 *       201:
 *         description: Scholarship application submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 proposal_id:
 *                   type: integer
 *                   description: Database ID of the created proposal
 *                 tx_hash:
 *                   type: string
 *                   description: On-chain transaction hash
 *                 simulated:
 *                   type: boolean
 *                   description: Whether the transaction was simulated (no secret key configured)
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: object
 *                   description: Field-level validation errors
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
scholarshipsRouter.post(
	"/scholarships/apply",
	scholarshipApplyLimiter,
	(req, res) => {
		void applyForScholarship(req, res)
	},
)

/**
 * @openapi
 * /api/scholarships/{id}/contribute:
 *   post:
 *     tags: [Scholarships]
 *     summary: Co-fund an approved scholarship proposal
 *     description: |
 *       Records a verified on-chain USDC deposit against an approved or queued
 *       proposal. The Stellar transaction is confirmed via Horizon before any
 *       database write occurs.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Proposal ID to co-fund
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [donor_address, amount, tx_hash]
 *             properties:
 *               donor_address:
 *                 type: string
 *                 description: Stellar G-address of the donor (must match JWT)
 *               amount:
 *                 type: number
 *                 description: USDC amount contributed
 *               tx_hash:
 *                 type: string
 *                 description: 64-character hex hash of the on-chain deposit transaction
 *     responses:
 *       200:
 *         description: Contribution recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 current_funding:
 *                   type: number
 *                 fully_funded:
 *                   type: boolean
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       409:
 *         description: Transaction already recorded or proposal not co-fundable
 *       422:
 *         description: On-chain verification failed
 */
scholarshipsRouter.post(
	"/scholarships/:id/contribute",
	authMiddleware,
	writeLimiter,
	(req, res) => {
		void contributeToScholarship(req, res)
	},
)

/**
 * @openapi
 * /api/scholarships/{id}/contributors:
 *   get:
 *     tags: [Scholarships]
 *     summary: List verified contributors for a proposal
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Contributor list with funding totals
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
scholarshipsRouter.get("/scholarships/:id/contributors", (req, res) => {
	void getProposalContributors(req, res)
})
