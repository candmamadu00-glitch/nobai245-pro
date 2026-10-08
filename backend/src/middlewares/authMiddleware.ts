import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Role } from '@prisma/client';

export type UserRole = 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN' | 'OPERATOR' | 'FINANCE';

export interface UserPayload extends JwtPayload {
  id: string;
  role: UserRole;
  status?: string;
  tokenVersion?: number;
  email?: string;
  phone?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
      admin?: {
        id: string;
        email: string;
        role: Role;
        name?: string;
      };
    }
  }
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || '';

if (IS_PRODUCTION && (!JWT_SECRET || JWT_SECRET === 'sua_chave_secreta_super_segura_com_mais_de_32_caracteres')) {
  console.error('🚨 [FATAL SECURITY ERROR] JWT_SECRET seguro não configurado nas variáveis de ambiente (.env)!');
}

const ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN', 'OPERATOR', 'FINANCE'];

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ 
      error: 'UNAUTHORIZED', 
      message: 'Token de autenticação ausente ou mal formatado.' 
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  const activeSecret = JWT_SECRET || 'sua_chave_secreta_super_segura_com_mais_de_32_caracteres';

  try {
    const decoded = jwt.verify(token, activeSecret, { algorithms: ['HS256'] }) as UserPayload;
    
    if (!decoded || typeof decoded === 'string' || !decoded.id || !decoded.role) {
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Payload do token inválido.'
      });
      return;
    }

    const userStatus = (decoded.status || '').toUpperCase();
    if (userStatus && ['SUSPENDED', 'REJECTED', 'BANNED', 'INACTIVE'].includes(userStatus)) {
      res.status(403).json({
        error: 'ACCOUNT_DISABLED',
        message: 'Acesso negado. Esta conta está suspensa ou inativa.'
      });
      return;
    }

    // Popula req.user para rotas genéricas (Passageiro / Motorista / API)
    req.user = decoded;

    // Popula req.admin APENAS se o papel for realmente administrativo
    if (ADMIN_ROLES.includes(decoded.role)) {
      req.admin = {
        id: decoded.id,
        email: decoded.email || '',
        role: decoded.role as Role
      };
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ 
        error: 'TOKEN_EXPIRED', 
        message: 'Sua sessão expirou. Por favor, faça login novamente.' 
      });
      return;
    }

    res.status(401).json({ 
      error: 'INVALID_TOKEN', 
      message: 'Token de acesso inválido, adulterado ou malformado.' 
    });
    return;
  }
};

/**
 * Middleware universal de autorização por papéis (Roles)
 */
export const authorizeRole = (allowedRoles: (UserRole | Role | string)[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const currentRole = req.user?.role || req.admin?.role;

    if (!currentRole) {
      res.status(401).json({ 
        error: 'UNAUTHORIZED', 
        message: 'Sessão inválida ou não autenticada.' 
      });
      return;
    }

    if (!allowedRoles.includes(currentRole as any)) {
      res.status(403).json({ 
        error: 'FORBIDDEN', 
        message: `Acesso negado. Permissões requeridas: ${allowedRoles.join(', ')}.` 
      });
      return;
    }

    next();
  };
};

export const authenticate = authMiddleware;
export default authMiddleware;