/* global fetch, WebSocket */

import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DEBUGGING_URL =
  process.env.VSCODE_DEBUGGING_URL ?? 'http://127.0.0.1:9333';
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const targets = await (await fetch(`${DEBUGGING_URL}/json/list`)).json();
const page = targets.find((target) => target.type === 'page');
if (page?.webSocketDebuggerUrl === undefined) {
  throw new Error('No VS Code workbench debugging target is available.');
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id === undefined) {
    return;
  }
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (request === undefined) {
    return;
  }
  if (message.error !== undefined) {
    request.reject(new Error(message.error.message));
  } else {
    request.resolve(message.result);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const key = async (keyName, code, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: keyName,
    code,
    modifiers,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: keyName,
    code,
    modifiers,
  });
};

const confirm = async () => {
  const enter = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 36,
  };
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...enter,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...enter,
  });
};

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
};

const command = async (label) => {
  await key('p', 'KeyP', 12);
  await delay(400);
  await send('Input.insertText', { text: label });
  await delay(400);
  const point = await evaluate(`(() => {
    const entries = [...document.querySelectorAll(
      '.quick-input-list-entry'
    )].filter((entry) => entry.offsetParent !== null);
    const exactLabel = ${JSON.stringify(label)};
    const entry = entries.find((candidate) => {
      const name = candidate.querySelector('.label-name')?.textContent
        ?.replace(/\\s+/gu, ' ').trim();
      return name === exactLabel;
    });
    if (entry === undefined) {
      return undefined;
    }
    const rect = entry.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (point === undefined) {
    throw new Error(`Command was not found: ${label}`);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  });
  await delay(700);
};

const ensurePartHidden = async (selector, toggleCommand) => {
  const isVisible = async () =>
    evaluate(`(() => {
      const part = document.querySelector(${JSON.stringify(selector)});
      return part !== null && part.offsetParent !== null;
    })()`);

  if (await isVisible()) {
    await command(toggleCommand);
  }
  if (await isVisible()) {
    throw new Error(`Workbench part remained visible: ${selector}`);
  }
};

const addMarketingAnnotation = async (expectedIcon, annotation) =>
  evaluate(`(() => {
    const config = ${JSON.stringify(annotation)};
    const expectedIcon = ${JSON.stringify(expectedIcon)};
    document.getElementById('timer-stopwatch-marketplace-annotation')?.remove();

    const statusItem = [...document.querySelectorAll(
      '.part.statusbar .statusbar-item'
    )].find((item) =>
      item.offsetParent !== null &&
      item.querySelector('.codicon-' + expectedIcon) !== null &&
      /[0-9]+:[0-9]{2}/u.test(item.textContent ?? '')
    );
    if (statusItem === undefined) {
      throw new Error('The annotated status item is unavailable.');
    }

    const statusRect = statusItem.getBoundingClientRect();
    const time = statusItem.textContent?.match(/[0-9]+:[0-9]{2}/u)?.[0];
    if (time === undefined) {
      throw new Error('The annotated status time is unavailable.');
    }

    const host = document.createElement('div');
    host.id = 'timer-stopwatch-marketplace-annotation';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.append(host);

    const create = (tagName, text) => {
      const element = document.createElement(tagName);
      if (text !== undefined) {
        element.textContent = text;
      }
      return element;
    };
    const apply = (element, styles) => Object.assign(element.style, styles);
    const fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif';
    const accent = '#ff594d';

    const hero = create('section');
    apply(hero, {
      position: 'fixed',
      left: '82px',
      top: '188px',
      width: '520px',
      boxSizing: 'border-box',
      padding: '24px 26px 25px',
      color: '#f4f4f5',
      background: 'rgba(28, 28, 30, 0.96)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '12px',
      boxShadow: '0 18px 48px rgba(0, 0, 0, 0.38)',
      fontFamily,
    });

    const eyebrow = create('div', config.eyebrow);
    apply(eyebrow, {
      marginBottom: '10px',
      color: accent,
      fontSize: '13px',
      fontWeight: '750',
      letterSpacing: '1.4px',
    });
    hero.append(eyebrow);

    const title = create('div', config.title);
    apply(title, {
      maxWidth: '470px',
      fontSize: '34px',
      fontWeight: '700',
      letterSpacing: '-0.7px',
      lineHeight: '1.12',
    });
    hero.append(title);

    const body = create('div', config.body);
    apply(body, {
      marginTop: '12px',
      color: '#c9c9ce',
      fontSize: '17px',
      lineHeight: '1.45',
    });
    hero.append(body);

    const steps = create('div');
    apply(steps, {
      display: 'flex',
      gap: '6px',
      marginTop: '18px',
      flexWrap: 'nowrap',
    });
    config.steps.forEach((label, index) => {
      const step = create('div');
      apply(step, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 8px 6px 7px',
        color: '#eeeeef',
        background: 'rgba(255, 255, 255, 0.065)',
        border: '1px solid rgba(255, 255, 255, 0.11)',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: '600',
        whiteSpace: 'nowrap',
      });
      const number = create('span', String(index + 1));
      apply(number, {
        display: 'grid',
        width: '20px',
        height: '20px',
        placeItems: 'center',
        color: '#ffffff',
        background: accent,
        borderRadius: '50%',
        fontSize: '11px',
        fontWeight: '800',
      });
      step.append(number, create('span', label));
      steps.append(step);
    });
    hero.append(steps);
    shadow.append(hero);

    const callout = create('section');
    apply(callout, {
      position: 'fixed',
      left: '82px',
      bottom: '70px',
      width: '360px',
      boxSizing: 'border-box',
      padding: '15px 18px 16px',
      color: '#ffffff',
      background: 'rgba(37, 24, 21, 0.97)',
      border: '2px solid ' + accent,
      borderRadius: '11px',
      boxShadow: '0 12px 34px rgba(0, 0, 0, 0.45)',
      fontFamily,
    });
    const location = create('div', 'STATUS BAR  ·  BOTTOM LEFT');
    apply(location, {
      color: accent,
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '1.2px',
    });
    const metric = create('div', time + '  ' + config.metricLabel);
    apply(metric, {
      marginTop: '5px',
      fontSize: '24px',
      fontWeight: '750',
      letterSpacing: '-0.25px',
    });
    const calloutBody = create(
      'div',
      'Click it anytime to pause, reset, or stop.',
    );
    apply(calloutBody, {
      marginTop: '5px',
      color: '#d7d3d2',
      fontSize: '14px',
    });
    callout.append(location, metric, calloutBody);
    shadow.append(callout);

    const focus = create('div');
    const focusLeft = Math.max(1, statusRect.left - 5);
    const focusTop = Math.max(1, statusRect.top - 4);
    const focusWidth = statusRect.width + 10;
    const focusHeight = Math.min(
      statusRect.height + 8,
      window.innerHeight - focusTop - 1,
    );
    apply(focus, {
      position: 'fixed',
      left: String(focusLeft) + 'px',
      top: String(focusTop) + 'px',
      width: String(focusWidth) + 'px',
      height: String(focusHeight) + 'px',
      boxSizing: 'border-box',
      border: '3px solid ' + accent,
      borderRadius: '6px',
      boxShadow:
        '0 0 0 2px rgba(0, 0, 0, 0.6), 0 0 18px rgba(255, 89, 77, 0.42)',
    });
    shadow.append(focus);

    const calloutRect = callout.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    apply(svg, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      overflow: 'visible',
    });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const startX = calloutRect.left + 42;
    const startY = calloutRect.bottom;
    const endX = statusRect.left + statusRect.width / 2;
    const endY = focusTop - 4;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'marker',
    );
    marker.setAttribute('id', 'timer-stopwatch-callout-arrowhead');
    marker.setAttribute('viewBox', '0 0 12 12');
    marker.setAttribute('markerWidth', '12');
    marker.setAttribute('markerHeight', '12');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '6');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    const arrowhead = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    arrowhead.setAttribute('d', 'M 0 0 L 12 6 L 0 12 Z');
    arrowhead.setAttribute('fill', accent);
    marker.append(arrowhead);
    defs.append(marker);
    path.setAttribute(
      'd',
      [
        'M',
        String(startX),
        String(startY),
        'C',
        String(startX),
        String(startY + 22),
        String(endX + 24),
        String(endY - 18),
        String(endX),
        String(endY),
      ].join(' '),
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', accent);
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute(
      'marker-end',
      'url(#timer-stopwatch-callout-arrowhead)',
    );
    svg.append(defs, path);
    shadow.prepend(svg);

    return {
      time,
      focus: {
        left: focusLeft,
        top: focusTop,
        width: focusWidth,
        height: focusHeight,
      },
    };
  })()`);

const capture = async (
  filename,
  expectedMode,
  expectedIcon,
  annotation,
) => {
  const ui = await evaluate(`(() => {
    const widget = [...document.querySelectorAll('.quick-input-widget')]
      .find((candidate) => candidate.offsetParent !== null);
    const statusItems = [...document.querySelectorAll(
      '.part.statusbar .statusbar-item'
    )]
      .filter((item) => item.offsetParent !== null)
      .map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          text: item.textContent?.replace(/\\s+/gu, ' ').trim() ?? '',
          icons: [...item.querySelectorAll('.codicon')]
            .flatMap((icon) => [...icon.classList])
            .filter((className) => className.startsWith('codicon-')),
          inLeftGroup: item.closest('.left-items') !== null,
          centerX: rect.left + rect.width / 2
        };
      });
    return {
      quickPickVisible: widget !== undefined,
      quickPickLabels: widget === undefined
        ? []
        : [...widget.querySelectorAll('.quick-input-list-entry')]
            .map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()),
      notifications: [...document.querySelectorAll(
        '.notifications-toasts .notification-list-item'
      )]
        .filter((item) => item.offsetParent !== null)
        .map((item) => item.textContent?.replace(/\\s+/gu, ' ').trim()),
      statusItems,
      viewportWidth: window.innerWidth
    };
  })()`);
  const statusItem = ui.statusItems.find(
    (item) =>
      item.icons.includes(`codicon-${expectedIcon}`) &&
      /\d+:\d{2}/u.test(item.text),
  );
  if (
    ui.quickPickVisible !== true ||
    !ui.quickPickLabels.some((label) => label?.includes('Pause')) ||
    !ui.quickPickLabels.some((label) => label?.includes('Reset')) ||
    !ui.quickPickLabels.some((label) => label?.includes('Stop'))
  ) {
    throw new Error(
      `Expected ${expectedMode} controls are not visible: ${JSON.stringify(ui)}`,
    );
  }
  if (ui.notifications.length > 0) {
    throw new Error(
      `Unexpected notification while ${expectedMode} is running: ${JSON.stringify(ui.notifications)}`,
    );
  }
  if (
    statusItem === undefined ||
    statusItem.inLeftGroup !== true ||
    statusItem.centerX >= ui.viewportWidth / 2
  ) {
    throw new Error(
      `Expected the ${expectedMode} ${expectedIcon} status item in the left half: ${JSON.stringify(ui.statusItems)}`,
    );
  }

  await addMarketingAnnotation(expectedIcon, annotation);
  await delay(150);
  try {
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
    });
    await writeFile(
      path.join(repositoryRoot, 'resources', filename),
      Buffer.from(screenshot.data, 'base64'),
    );
  } finally {
    await evaluate(
      "document.getElementById('timer-stopwatch-marketplace-annotation')?.remove()",
    );
  }
  return expectedIcon;
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await delay(700);

const viewport = await evaluate('({ width: innerWidth, height: innerHeight })');
if (viewport.width !== 1440 || viewport.height !== 900) {
  throw new Error(`Unexpected capture viewport: ${JSON.stringify(viewport)}`);
}

await command('View: Close All Editors');
await ensurePartHidden('.part.sidebar', 'View: Toggle Primary Side Bar Visibility');
await ensurePartHidden(
  '.part.auxiliarybar',
  'View: Toggle Secondary Side Bar Visibility',
);
await command('Timer & Stopwatch: Start Timer');
await evaluate(`(() => {
  const input = [...document.querySelectorAll('.quick-input-widget')]
    .find((candidate) => candidate.offsetParent !== null)
    ?.querySelector('input[type="text"]');
  input?.focus();
  return input?.value;
})()`);
await send('Input.insertText', { text: '25m' });
const countdownInput = await evaluate(
  `[...document.querySelectorAll('.quick-input-widget')]
    .find((candidate) => candidate.offsetParent !== null)
    ?.querySelector('input[type="text"]')?.value`,
);
if (countdownInput !== '25m') {
  throw new Error(`Countdown input was not populated: ${JSON.stringify(countdownInput)}`);
}
await confirm();
await delay(700);
const countdownStarted = await evaluate(`(() => {
  const icon = document.querySelector(
    '.part.statusbar .codicon-clockface'
  );
  return /\\d+:\\d{2}/u.test(
    icon?.closest('.statusbar-item')?.textContent ?? ''
  );
})()`);
if (countdownStarted !== true) {
  throw new Error('The timer command did not start a countdown.');
}
await command('Timer & Stopwatch: Start Stopwatch');
const countdownIcon = await capture(
  'marketplace-countdown.png',
  'countdown',
  'clockface',
  {
    eyebrow: 'COUNTDOWN TIMER',
    title: 'Start a timer in seconds',
    body: 'Your remaining time stays visible while you work.',
    steps: ['View > Command Palette', 'Search Start Timer', 'Enter 25m'],
    metricLabel: 'remaining',
  },
);

await key('Escape', 'Escape');
await command('Timer & Stopwatch: Show Controls');
await key('ArrowDown', 'ArrowDown');
await key('ArrowDown', 'ArrowDown');
await confirm();
await delay(500);

await command('Timer & Stopwatch: Start Stopwatch');
await delay(1_200);
await command('Timer & Stopwatch: Start Timer');
const stopwatchIcon = await capture(
  'marketplace-stopwatch.png',
  'stopwatch',
  'watch',
  {
    eyebrow: 'STOPWATCH',
    title: 'Track time without leaving your editor',
    body: 'Elapsed time stays visible while you work.',
    steps: ['Click Timer', 'Start Stopwatch', 'Keep working'],
    metricLabel: 'elapsed',
  },
);
if (countdownIcon === stopwatchIcon) {
  throw new Error('Countdown and stopwatch must use different status icons.');
}

socket.close();
