import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StatusBarPresentation } from '../src/core/formatting.js';
import type { ActiveSession } from '../src/core/model.js';
import {
  StatusBarBinding,
  type StatusBarController,
  type StatusBarEvent,
  type StatusBarPreferences,
  type StatusBarSink,
} from '../src/ui/statusBarBinding.js';

class FakeEventSource<T> {
  private readonly listeners = new Set<(event: T) => void>();
  public disposals = 0;

  public constructor(
    private readonly label: string,
    private readonly disposalOrder: string[],
  ) {}

  public readonly event: StatusBarEvent<T> = (listener) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.disposals += 1;
        this.disposalOrder.push(this.label);
        this.listeners.delete(listener);
      },
    };
  };

  public fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeController implements StatusBarController {
  public readonly changes: FakeEventSource<void>;
  public readonly ticks: FakeEventSource<number>;
  public readonly onDidChangeSession: StatusBarEvent<void>;
  public readonly onDidTick: StatusBarEvent<number>;

  public constructor(
    public currentSession: ActiveSession | undefined,
    disposalOrder: string[] = [],
  ) {
    this.changes = new FakeEventSource('session', disposalOrder);
    this.ticks = new FakeEventSource('tick', disposalOrder);
    this.onDidChangeSession = this.changes.event;
    this.onDidTick = this.ticks.event;
  }

  public session(): ActiveSession | undefined {
    return this.currentSession;
  }
}

interface Configuration {
  readonly name: string;
  readonly command: string;
}

class RecordingSink implements StatusBarSink {
  public readonly configurations: Configuration[] = [];
  public readonly presentations: StatusBarPresentation[] = [];
  public shows = 0;
  public disposals = 0;

  public constructor(private readonly disposalOrder: string[] = []) {}

  public configure(name: string, command: string): void {
    this.configurations.push({ name, command });
  }

  public render(presentation: StatusBarPresentation): void {
    this.presentations.push(presentation);
  }

  public show(): void {
    this.shows += 1;
  }

  public dispose(): void {
    this.disposals += 1;
    this.disposalOrder.push('sink');
  }
}

const countdown = (): ActiveSession => ({
  mode: 'countdown',
  status: 'running',
  startedAt: 1_000,
  accumulatedMs: 0,
  durationMs: 60_000,
});

const stopwatch = (): ActiveSession => ({
  mode: 'stopwatch',
  status: 'running',
  startedAt: 1_000,
  accumulatedMs: 0,
});

describe('status bar binding', () => {
  it('configures, renders, and shows the idle status bar on construction', () => {
    const controller = new FakeController(undefined);
    const sink = new RecordingSink();

    new StatusBarBinding(controller, sink, () => 10_000);

    assert.deepEqual(sink.configurations, [
      {
        name: 'Timer & Stopwatch',
        command: 'timerStopwatch.showControls',
      },
    ]);
    assert.deepEqual(sink.presentations, [
      {
        text: '$(clockface) Timer',
        tooltip: 'Timer & Stopwatch. Select to start.',
      },
    ]);
    assert.equal(sink.shows, 1);
  });

  it('re-reads the session and current time after a session change', () => {
    const controller = new FakeController(undefined);
    const sink = new RecordingSink();
    let now = 1_000;
    let clockCalls = 0;
    new StatusBarBinding(controller, sink, () => {
      clockCalls += 1;
      return now;
    });

    controller.currentSession = countdown();
    now = 11_001;
    controller.changes.fire(undefined);

    assert.equal(clockCalls, 2);
    assert.deepEqual(sink.presentations.at(-1), {
      text: '$(clockface) 0:50',
      tooltip: 'Countdown. Select for controls.',
    });
  });

  it('uses the supplied tick time without reading the current clock', () => {
    const controller = new FakeController(stopwatch());
    const sink = new RecordingSink();
    let clockCalls = 0;
    new StatusBarBinding(controller, sink, () => {
      clockCalls += 1;
      return 1_000;
    });

    controller.ticks.fire(66_000);

    assert.equal(clockCalls, 1);
    assert.deepEqual(sink.presentations.at(-1), {
      text: '$(watch) 1:05',
      tooltip: 'Stopwatch. Select for controls.',
    });
  });

  it('forwards countdown and stopwatch refreshes to the sink', () => {
    const controller = new FakeController(countdown());
    const sink = new RecordingSink();
    let now = 1_000;
    new StatusBarBinding(controller, sink, () => now);

    controller.ticks.fire(31_000);
    controller.currentSession = stopwatch();
    now = 61_000;
    controller.changes.fire(undefined);

    assert.equal(sink.presentations[1]?.text, '$(clockface) 0:30');
    assert.equal(sink.presentations[2]?.text, '$(watch) 1:00');
    assert.notEqual(
      sink.presentations[1]?.text.split(' ')[0],
      sink.presentations[2]?.text.split(' ')[0],
    );
  });

  it('does not repaint identical status-bar content', () => {
    const controller = new FakeController(countdown());
    const sink = new RecordingSink();
    new StatusBarBinding(controller, sink, () => 1_000);

    controller.changes.fire(undefined);
    controller.ticks.fire(1_000);

    assert.equal(sink.presentations.length, 1);
  });

  it('updates the idle label immediately without hiding active time', () => {
    const controller = new FakeController(undefined);
    const sink = new RecordingSink();
    const changes = new FakeEventSource<void>('preferences', []);
    let showIdleLabel = true;
    const preferences: StatusBarPreferences = {
      showIdleLabel: () => showIdleLabel,
      onDidChange: changes.event,
    };
    new StatusBarBinding(controller, sink, () => 1_000, preferences);

    showIdleLabel = false;
    changes.fire(undefined);
    assert.equal(sink.presentations.at(-1)?.text, '$(clockface)');

    controller.currentSession = countdown();
    controller.changes.fire(undefined);
    assert.equal(sink.presentations.at(-1)?.text, '$(clockface) 1:00');
  });

  it('disposes subscriptions before the sink and prevents later renders', () => {
    const disposalOrder: string[] = [];
    const controller = new FakeController(undefined, disposalOrder);
    const sink = new RecordingSink(disposalOrder);
    const binding = new StatusBarBinding(controller, sink, () => 1_000);

    binding.dispose();

    assert.equal(controller.changes.disposals, 1);
    assert.equal(controller.ticks.disposals, 1);
    assert.equal(controller.changes.listenerCount(), 0);
    assert.equal(controller.ticks.listenerCount(), 0);
    assert.equal(sink.disposals, 1);
    assert.deepEqual(disposalOrder, ['session', 'tick', 'sink']);

    controller.currentSession = countdown();
    controller.changes.fire(undefined);
    controller.ticks.fire(30_000);
    assert.equal(sink.presentations.length, 1);
  });
});
