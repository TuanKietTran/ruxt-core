/**
 * Minimal orchestrated saga: steps run in order against a shared context; when
 * a step fails, the compensations of every completed step run in reverse.
 */
export interface SagaStep<TContext> {
   name: string;
   run(context: TContext): Promise<void>;
   /** Semantically undo `run`. Omit for read-only steps and the final step. */
   compensate?(context: TContext): Promise<void>;
}

export interface SagaCompensationFailure {
   step: string;
   error: string;
}

/**
 * Keeps the failed step's message so transport status mapping is unchanged,
 * and reports which compensations ran or could not run.
 */
export class SagaError extends Error {
   constructor(
      readonly saga: string,
      readonly failedStep: string,
      readonly cause: unknown,
      readonly compensated: string[],
      readonly compensationFailures: SagaCompensationFailure[],
   ) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.name = "SagaError";
   }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runSaga<TContext>(name: string, steps: SagaStep<TContext>[], context: TContext): Promise<TContext> {
   const completed: SagaStep<TContext>[] = [];
   for (const step of steps) {
      try {
         await step.run(context);
         completed.push(step);
      } catch (cause) {
         const compensated: string[] = [];
         const compensationFailures: SagaCompensationFailure[] = [];
         for (const done of completed.reverse()) {
            if (!done.compensate) continue;
            try {
               await done.compensate(context);
               compensated.push(done.name);
            } catch (error) {
               compensationFailures.push({ step: done.name, error: messageOf(error) });
            }
         }
         throw new SagaError(name, step.name, cause, compensated, compensationFailures);
      }
   }
   return context;
}
