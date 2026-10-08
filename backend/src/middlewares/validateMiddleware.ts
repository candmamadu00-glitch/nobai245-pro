import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';

export interface ValidationTargets {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export const validate = (schemas: ZodSchema | ValidationTargets) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if ('parseAsync' in schemas && typeof schemas.parseAsync === 'function') {
        req.body = await schemas.parseAsync(req.body);
      } else {
        const targets = schemas as ValidationTargets;
        if (targets.body) {
          req.body = await targets.body.parseAsync(req.body);
        }
        if (targets.params) {
          req.params = (await targets.params.parseAsync(req.params)) as ParamsDictionary;
        }
        if (targets.query) {
          req.query = (await targets.query.parseAsync(req.query)) as ParsedQs;
        }
      }

      next();
    } catch (error: any) {
      if (error instanceof ZodError || error?.name === 'ZodError') {
        const issues = error.errors || error.issues || [];

        res.status(400).json({
          error: 'INVALID_INPUT',
          message: 'Dados de requisição inválidos.',
          details: issues.map((err: any) => ({
            field: Array.isArray(err.path) && err.path.length > 0 ? err.path.join('.') : 'campo_desconhecido',
            message: err.message,
          })),
        });
        return;
      }

      console.error('Erro interno no validador:', error);
      res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao validar dados da requisição.',
      });
      return;
    }
  };
};