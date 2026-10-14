import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import {
  createUser,
  getUserById,
  getUserByEmail,
  verifyPassword,
  recordFailedLogin,
  resetFailedLogin,
} from "../../../database/src/usersRepository.js";
import {
  createSession,
  getSession,
  markSessionUsed,
  revokeFamily,
} from "../../../database/src/sessionsRepository.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import rateLimit from "express-rate-limit";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 30 seconds blocking
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many authentication attempts, please try again later." },
});

const registerSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    name: z.string().min(1)
  })
};

const loginSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })
};

// A real bcrypt hash of a value nobody will ever type. Used to run a
// same-cost compare when the email doesn't exist at all, so "unknown email"
// and "wrong password" take the same amount of time and a timing attack
// can't be used to enumerate registered accounts.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8i6t9AC5hRcQywkK0RkK6dv9c9A9Wm";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const isProd = () => process.env.NODE_ENV === "production";

/** Set the short-lived access-token cookie and the longer-lived refresh-token cookie. */
function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie("token", accessToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60 * 1000, // matches the JWT's own 15m expiry
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    // Scoped to /auth so this cookie is never sent on ordinary API calls —
    // only to the refresh/logout endpoints that need it.
    path: "/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearAuthCookies(res) {
  res.clearCookie("token", { path: "/" });
  res.clearCookie("refreshToken", { path: "/auth" });
}

/** POST /auth/register */
router.post("/register", authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // Role is explicitly omitted so it defaults to "user" in the repository
    const user = await createUser({ email, password, name });

    const { refreshToken, familyId } = await createSession(user.userId);
    const accessToken = signToken(user, familyId);

    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/login */
router.post("/login", authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    // Account exists but is currently locked out from too many failed
    // attempts. Still run a bcrypt compare (against the real hash, cost is
    // the same either way) so this branch takes the same time as a normal
    // wrong-password rejection below — a timing difference here would leak
    // "this account is locked" to anyone probing emails.
    if (user && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      await bcrypt.compare(password, user.passwordHash);
      return res.status(401).json({ error: "ACCOUNT_LOCKED" });
    }

    // Unknown email: compare against a dummy hash instead of short-circuiting,
    // so "no such user" and "wrong password" are indistinguishable by timing.
    const valid = user
      ? await verifyPassword(user, password)
      : await bcrypt.compare(password, DUMMY_HASH);

    if (!user || !valid) {
      if (user) await recordFailedLogin(user.userId, MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS);
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }

    if (user.failedAttempts > 0 || user.lockedUntil) {
      await resetFailedLogin(user.userId);
    }

    const { passwordHash, failedAttempts, lockedUntil, ...safeUser } = user;

    const { refreshToken, familyId } = await createSession(safeUser.userId);
    const accessToken = signToken(safeUser, familyId);

    setAuthCookies(res, accessToken, refreshToken);
    res.json({ user: safeUser });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/refresh
 * Exchanges a valid, not-yet-used refresh token for a new 15-minute access
 * token and a freshly rotated refresh token. Called by the frontend
 * automatically when an API request comes back 401 (see api.js).
 */
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "MISSING_REFRESH_TOKEN" });
    }

    const session = await getSession(refreshToken);
    if (!session) {
      return res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
    }

    if (session.revoked) {
      return res.status(401).json({ error: "SESSION_REVOKED" });
    }

    // This exact token was already rotated once before. Someone presenting
    // it again means it was copied/stolen — kill the whole family (including
    // whatever legitimate session is currently using the newest token in the
    // chain) and force a real re-login.
    if (session.used) {
      await revokeFamily(session.familyId);
      return res.status(401).json({ error: "REUSE_DETECTED" });
    }

    if (session.expiresAt < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: "SESSION_EXPIRED" });
    }

    await markSessionUsed(refreshToken);
    const { refreshToken: newRefreshToken } = await createSession(session.userId, session.familyId);

    // Re-derive the user fresh from the DB rather than trusting anything
    // client-supplied, in case role/email changed since the original login.
    const user = await getUserById(session.userId);
    if (!user) {
      return res.status(401).json({ error: "USER_NOT_FOUND" });
    }

    const accessToken = signToken(user, session.familyId);
    setAuthCookies(res, accessToken, newRefreshToken);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/logout */
router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    const session = await getSession(refreshToken);
    if (session) {
      await revokeFamily(session.familyId);
    }
  }
  clearAuthCookies(res);
  res.json({ message: "Logged out" });
});

/** GET /auth/me  – returns the current user from the token */
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    res.json({ user: req.user });
  } catch (err) {
    next(err);
  }
});

export default router;
