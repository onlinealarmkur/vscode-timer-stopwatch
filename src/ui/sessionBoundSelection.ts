export interface DisposableLike {
  dispose(): void;
}

export interface CancellationSourceLike<Token> extends DisposableLike {
  readonly token: Token;
  cancel(): void;
}

export interface SessionBoundSelectionOptions<Session, Item, Token> {
  readonly expectedSession: Session;
  readonly currentSession: () => Session | undefined;
  readonly onDidChangeSession: (
    listener: () => void,
  ) => DisposableLike;
  readonly createCancellationSource: () => CancellationSourceLike<Token>;
  readonly select: (token: Token) => PromiseLike<Item | undefined>;
}

export async function selectWhileSessionIsCurrent<Session, Item, Token>(
  options: SessionBoundSelectionOptions<Session, Item, Token>,
): Promise<Item | undefined> {
  const cancellation = options.createCancellationSource();
  const state = { stale: false };
  const isStale = (): boolean => state.stale;

  const cancelIfStale = (): void => {
    if (
      !isStale() &&
      options.currentSession() !== options.expectedSession
    ) {
      state.stale = true;
      cancellation.cancel();
    }
  };

  const sessionChangeSubscription =
    options.onDidChangeSession(cancelIfStale);

  try {
    cancelIfStale();
    if (isStale()) {
      return undefined;
    }

    try {
      const selected = await options.select(cancellation.token);
      cancelIfStale();
      return isStale() ? undefined : selected;
    } catch (error: unknown) {
      cancelIfStale();
      if (!isStale()) {
        throw error;
      }
      return undefined;
    }
  } finally {
    sessionChangeSubscription.dispose();
    cancellation.dispose();
  }
}
