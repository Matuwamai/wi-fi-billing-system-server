import jwt from "jsonwebtoken";
// import logger from "../utils/logger";

const JWT_SECRET = process.env.JWT_SECRET;

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check if authorization header exists
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: "AUTH_NO_TOKEN",
      message: "No authorization token provided",
    });
  }

  // Validate Bearer token format
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "AUTH_INVALID_FORMAT",
      message: "Authorization header must start with 'Bearer '",
    });
  }

  const token = authHeader.split(" ")[1];

  // Check if token exists after Bearer prefix
  if (!token || token.trim() === "") {
    return res.status(401).json({
      success: false,
      error: "AUTH_EMPTY_TOKEN",
      message: "Token is empty",
    });
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET || "supersecret");

    // Validate decoded payload structure
    if (!decoded || typeof decoded !== "object") {
      return res.status(403).json({
        success: false,
        error: "AUTH_INVALID_PAYLOAD",
        message: "Invalid token payload",
      });
    }

    // Ensure user ID exists in token (basic requirement)
    if (!decoded.userId && !decoded.id && !decoded.sub) {
      return res.status(403).json({
        success: false,
        error: "AUTH_NO_IDENTITY",
        message: "Token does not contain user identity",
      });
    }

    // Attach user to request with normalized property names
    req.user = {
      id: decoded.userId || decoded.id || decoded.sub,
      role: decoded.role || "USER", // Default to USER if role not specified
      ...decoded, // Spread any additional token claims
    };

    next();
  } catch (err) {
    // Handle specific JWT errors
    let statusCode = 403;
    let errorCode = "AUTH_INVALID_TOKEN";
    let message = "Invalid token";

    if (err.name === "TokenExpiredError") {
      statusCode = 401; // 401 for expired tokens (client should get new token)
      errorCode = "AUTH_TOKEN_EXPIRED";
      message = "Token has expired";
    } else if (err.name === "JsonWebTokenError") {
      errorCode = "AUTH_MALFORMED_TOKEN";
      message = "Malformed token";
    } else if (err.name === "NotBeforeError") {
      errorCode = "AUTH_TOKEN_NOT_ACTIVE";
      message = "Token not yet active";
    }

    return res.status(statusCode).json({
      success: false,
      error: errorCode,
      message: message,
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

/**
 * Role-based authorization middleware factory
 * Creates middleware for specific roles
 */
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // Check if user exists (must be used after authenticate middleware)
    if (!req.user) {
      return res.status(500).json({
        success: false,
        error: "AUTH_MIDDLEWARE_ORDER",
        message:
          "Authentication middleware must be called before authorization",
      });
    }

    // Check if user has a role
    if (!req.user.role) {
      return res.status(403).json({
        success: false,
        error: "AUTH_NO_ROLE",
        message: "User role not defined",
      });
    }

    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        role: req.user.role,
        success: false,
        error: "AUTH_INSUFFICIENT_PERMISSIONS",
        message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
        requiredRoles: allowedRoles,
        userRole: req.user.role,
      });
    }

    next();
  };
};

/**
 * Self-or-admin authorization middleware
 * Allows users to access their own resources or admins to access any
 */
export const authorizeSelfOrAdmin = (userIdParam = "id") => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(500).json({
        success: false,
        error: "AUTH_MIDDLEWARE_ORDER",
        message: "Authentication middleware must be called first",
      });
    }

    // Get user ID from request params or body
    const targetUserId = req.params[userIdParam] || req.body.userId;

    // Admin can access any resource
    if (req.user.role === "ADMIN") {
      return next();
    }

    // User can only access their own resource
    if (req.user.id === targetUserId) {
      return next();
    }

    // Deny access
    return res.status(403).json({
      success: false,
      error: "AUTH_NOT_OWNER",
      message: "You can only access your own resources",
      requiredId: targetUserId,
      yourId: req.user.id,
    });
  };
};
