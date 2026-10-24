import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { forbidden, unauthorized } from './errors';

export const ROLES = ['admin', 'landlord', 'accountant', 'tenant'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser, secret: string, expiresIn = '8h'): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret, {
    expiresIn,
  } as jwt.SignOptions);
}

/** Verifies the Bearer JWT and sets req.user. Every service verifies tokens itself. */
export function requireAuth(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(unauthorized());
    try {
      const payload = jwt.verify(header.slice(7), secret) as jwt.JwtPayload;
      req.user = { id: String(payload.sub), email: payload.email, role: payload.role };
      return next();
    } catch {
      return next(unauthorized('Invalid or expired token'));
    }
  };
}

/** Parses token if present, setting req.user, but continues without error if absent. */
export function optionalAuth(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();
    try {
      const payload = jwt.verify(header.slice(7), secret) as jwt.JwtPayload;
      req.user = { id: String(payload.sub), email: payload.email, role: payload.role };
    } catch {
      // ignore invalid token for optional auth
    }
    return next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

/** Use after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
