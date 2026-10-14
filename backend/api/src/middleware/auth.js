import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is missing.");
}

/**
 * Sign a short-lived access token for a user.
 *
 * `familyId` ties this access token to the refresh-token family that issued
 * it (see sessionsRepository.js) so we know which session to look at on
 * refresh/logout. It isn't a secret and isn't used for authorization by
 * itself — role/userId checks still happen on every request.
 */
export function signToken(user, familyId) {
  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      role: user.role,
      familyId,
    },
    JWT_SECRET,
    {
      expiresIn: "15m",
      algorithm: "HS256",
    }
  );
}

/**
 * Middleware: requires a valid Bearer token.
 * Attaches `req.user = { userId, email, role }`
 */
export function requireAuth(req, res, next) {
  // Allow both cookie and Authorization header (for backward compatibility / worker scripts)
  const header = req.headers.authorization;
  const cookieToken = req.cookies?.token;

  const token = cookieToken || (header && header.startsWith("Bearer ") ? header.slice(7) : null);

  if (!token) {
    return res.status(401).json({ error: "MISSING_TOKEN" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      familyId: payload.familyId,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

/**
 * Optional: only allow the owner of the resource (or admin)
 * Usage after requireAuth: requireSelfOrAdmin("userId")
 */
export function requireSelfOrAdmin(paramName = "userId") {
  return (req, res, next) => {
    const targetId = req.params[paramName];
    if (req.user.role === "admin" || req.user.userId === targetId) {
      return next();
    }
    return res.status(403).json({ error: "FORBIDDEN" });
  };
}

/**
 * Middleware: only allow specific roles
 * Usage: requireRole(["admin", "worker"])
 */
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    next();
  };
}
