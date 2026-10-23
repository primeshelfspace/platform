import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodSchema, ZodTypeDef } from 'zod';

/**
 * Zod is the validation layer for the whole stack (TSD-001 §3.5): the same
 * schema validates the form in the browser and the payload here. Nest's default
 * ValidationPipe would mean a second, class-decorator-based definition of every
 * shape — one more thing to drift.
 *
 *   @Post()
 *   create(@Body(zodPipe(invoiceDraftSchema)) body: InvoiceDraftInput) { … }
 */
export class ZodValidationPipe<
  TOut,
  TDef extends ZodTypeDef = ZodTypeDef,
  TIn = unknown,
> implements PipeTransform<TIn, TOut> {
  constructor(private readonly schema: ZodSchema<TOut, TDef, TIn>) {}

  transform(value: TIn, _metadata: ArgumentMetadata): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // Field-level detail, so the client can attach messages to inputs rather
    // than showing one opaque "invalid request".
    throw new BadRequestException({
      message: 'validation failed',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
}

export function zodPipe<TOut, TDef extends ZodTypeDef = ZodTypeDef, TIn = unknown>(
  schema: ZodSchema<TOut, TDef, TIn>,
): ZodValidationPipe<TOut, TDef, TIn> {
  return new ZodValidationPipe(schema);
}
