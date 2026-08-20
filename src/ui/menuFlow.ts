import type { SessionStartResult } from '../core/coordinator.js';
import type { ActiveSession } from '../core/model.js';
import { parseDuration } from '../core/parsing.js';
import { buildControlItems, type ControlItem } from './controls.js';
import {
  selectWhileSessionIsCurrent,
  type CancellationSourceLike,
} from './sessionBoundSelection.js';

export interface MenuController {
  session(): ActiveSession | undefined;
  startCountdown(durationMs: number): Promise<SessionStartResult>;
  startStopwatch(): Promise<SessionStartResult>;
  pause(expected?: ActiveSession): Promise<void>;
  resume(expected?: ActiveSession): Promise<void>;
  reset(expected?: ActiveSession): Promise<void>;
  stop(expected?: ActiveSession): Promise<void>;
  onDidChangeSession(listener: () => void): { dispose(): void };
}

export interface MenuHost<Token> {
  showQuickPick(
    items: ControlItem[],
    token: Token,
  ): PromiseLike<ControlItem | undefined>;
  showDurationInput(): PromiseLike<string | undefined>;
  createCancellationSource: () => CancellationSourceLike<Token>;
}

async function handleStartResult<Token>(
  result: SessionStartResult,
  controller: MenuController,
  host: MenuHost<Token>,
): Promise<void> {
  if (result === 'busy') {
    const session = controller.session();
    if (session !== undefined) {
      await showActiveControls(controller, host, session);
    }
  }
}

async function pickControlItem<Token>(
  controller: MenuController,
  host: MenuHost<Token>,
  session: ActiveSession | undefined,
): Promise<ControlItem | undefined> {
  return selectWhileSessionIsCurrent({
    expectedSession: session,
    currentSession: () => controller.session(),
    onDidChangeSession: (listener) =>
      controller.onDidChangeSession(listener),
    createCancellationSource: () => host.createCancellationSource(),
    select: async (token) =>
      host.showQuickPick(buildControlItems(session), token),
  });
}

async function showActiveControls<Token>(
  controller: MenuController,
  host: MenuHost<Token>,
  session: ActiveSession,
): Promise<void> {
  const selected = await pickControlItem(controller, host, session);

  switch (selected?.action) {
    case 'pause':
      await controller.pause(session);
      break;
    case 'resume':
      await controller.resume(session);
      break;
    case 'reset':
      await controller.reset(session);
      break;
    case 'stop':
      await controller.stop(session);
      break;
    case 'startCountdown':
    case 'startStopwatch':
    case undefined:
      break;
  }
}

async function requireIdle<Token>(
  controller: MenuController,
  host: MenuHost<Token>,
): Promise<boolean> {
  const session = controller.session();
  if (session === undefined) {
    return true;
  }
  await showActiveControls(controller, host, session);
  return false;
}

export async function promptForCountdown<Token>(
  controller: MenuController,
  host: MenuHost<Token>,
): Promise<void> {
  if (!(await requireIdle(controller, host))) {
    return;
  }
  const input = await host.showDurationInput();
  if (input === undefined) {
    return;
  }
  const durationMs = parseDuration(input);
  if (durationMs !== undefined) {
    const result = await controller.startCountdown(durationMs);
    await handleStartResult(result, controller, host);
  }
}

export async function startStopwatch<Token>(
  controller: MenuController,
  host: MenuHost<Token>,
): Promise<void> {
  if (await requireIdle(controller, host)) {
    const result = await controller.startStopwatch();
    await handleStartResult(result, controller, host);
  }
}

export async function showControls<Token>(
  controller: MenuController,
  host: MenuHost<Token>,
): Promise<void> {
  const session = controller.session();
  if (session !== undefined) {
    await showActiveControls(controller, host, session);
    return;
  }

  const selected = await pickControlItem(controller, host, undefined);

  switch (selected?.action) {
    case 'startCountdown':
      await promptForCountdown(controller, host);
      break;
    case 'startStopwatch':
      await startStopwatch(controller, host);
      break;
    case 'pause':
    case 'resume':
    case 'reset':
    case 'stop':
    case undefined:
      break;
  }
}
