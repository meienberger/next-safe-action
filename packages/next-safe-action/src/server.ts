import type { z } from "zod";
import type { ActionServerFn, ClientCaller, MaybePromise } from "./types";
import { DEFAULT_SERVER_ERROR, isError, isNextNotFoundError, isNextRedirectError } from "./utils";

/**
 * Initialize a new action client.
 * @param createOpts Options for creating a new action client.
 * @returns {Function} A function that creates a new action, to be used in server files.
 *
 * {@link https://github.com/TheEdoRan/next-safe-action/tree/main/packages/next-safe-action#project-configuration See an example}
 */
export const createSafeActionClient = <Context extends object>(createOpts?: {
	buildContext?: () => Promise<Context>;
	handleReturnedServerError?: (e: Error) => Promise<{ serverError: string }>;
	serverErrorLogFunction?: (e: Error) => MaybePromise<void>;
}) => {
	// If log function is not provided, default to `console.error` for logging
	// server error messages.
	const serverErrorLogFunction =
		createOpts?.serverErrorLogFunction ||
		((e) => {
			console.error("Action error:", (e as Error).message);
		});

	// If `handleReturnedServerError` is provided, use it to handle server error
	// messages returned on the client.
	// Otherwise mask the error and use a generic message.
	const handleReturnedServerError =
		createOpts?.handleReturnedServerError || (async () => ({ serverError: DEFAULT_SERVER_ERROR }));

	// `action` is the server function that creates a new action.
	// It expects an input validator and a definition function, so the action knows
	// what to do on the server when called by the client.
	// It returns a function callable by the client.
	const action = <const IV extends z.ZodTypeAny, const Data>(
		inputValidator: IV,
		serverFunction: ActionServerFn<IV, Data, Context>
	): ClientCaller<IV, Data> => {
		// This is the function called by client. If `input` fails the validator
		// parsing, the function will return a `validationError` object, containing
		// all the invalid fields provided.
		return async (clientInput) => {
			try {
				const parsedInput = inputValidator.safeParse(clientInput);

				if (!parsedInput.success) {
					const fieldErrors = parsedInput.error.flatten().fieldErrors as Partial<
						Record<keyof z.input<typeof inputValidator>, string[]>
					>;

					return {
						validationError: fieldErrors,
					};
				}

				// Get the context if `buildContext` is provided, otherwise use an
				// empty object.
				const ctx = (await createOpts?.buildContext?.()) ?? {};

				return { data: await serverFunction(parsedInput.data, ctx as Context) };
			} catch (e: unknown) {
				// next/navigation functions work by throwing an error that will be
				// processed internally by Next.js. So, in this case we need to rethrow it.
				if (isNextRedirectError(e) || isNextNotFoundError(e)) {
					throw e;
				}

				// If error cannot be handled, warn the user and return a generic message.
				if (!isError(e)) {
					console.warn("Could not handle server error. Not an instance of Error: ", e);
					return { serverError: DEFAULT_SERVER_ERROR };
				}

				// eslint-disable-next-line
				serverErrorLogFunction(e as Error);

				return await handleReturnedServerError(e as Error);
			}
		};
	};

	return action;
};
