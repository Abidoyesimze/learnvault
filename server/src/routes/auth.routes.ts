import { type Request, type Response, Router } from "express"

import { createAuthControllers } from "../controllers/auth.controller"
import { createRequireAuth } from "../middleware/auth.middleware"
import { nonceRateLimiter } from "../middleware/nonce-rate-limit.middleware"
import { authVerifyLimiter } from "../middleware/rate-limit.middleware"
import { type AuthService } from "../services/auth.service"
import { type JwtService } from "../services/jwt.service"

export function createAuthRouter(
	authService: AuthService,
	jwtService: JwtService,
): Router {
	const router = Router()
	const requireAuth = createRequireAuth(jwtService)
	const {
		getNonce,
		postVerify,
		getChallenge,
		postChallengeVerify,
		postRefresh,
	} = createAuthControllers(authService)

	async function postLogout(req: Request, res: Response): Promise<void> {
		const header = req.headers.authorization
		if (header?.startsWith("Bearer ")) {
			const token = header.slice("Bearer ".length).trim()
			try {
				await jwtService.revokeToken(token)
			} catch {
				// Best-effort revocation
			}
		}
		res.status(200).json({ message: "Logged out" })
	}

	router.get("/challenge", nonceRateLimiter, (req, res) => {
		void getChallenge(req, res)
	})

	router.post("/challenge/verify", (req, res) => {
		void postChallengeVerify(req, res)
	})

	router.get("/nonce", nonceRateLimiter, (req, res) => {
		void getNonce(req, res)
	})

	router.post("/verify", authVerifyLimiter, (req, res) => {
		void postVerify(req, res)
	})
	router.post("/refresh", authVerifyLimiter, (req, res) => {
		void postRefresh(req, res)
	})

	router.post("/logout", requireAuth, (req, res) => {
		void postLogout(req, res)
	})

	return router
}
