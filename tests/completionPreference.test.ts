import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completionNotificationUpdateTarget } from '../src/ui/completionPreference.js';

describe('completion notification preference', () => {
  it('uses the global target when no workspace value exists', () => {
    assert.equal(completionNotificationUpdateTarget(undefined), 'global');
    assert.equal(
      completionNotificationUpdateTarget({ workspaceValue: undefined }),
      'global',
    );
  });

  it('uses the workspace target for either boolean workspace value', () => {
    assert.equal(
      completionNotificationUpdateTarget({ workspaceValue: true }),
      'workspace',
    );
    assert.equal(
      completionNotificationUpdateTarget({ workspaceValue: false }),
      'workspace',
    );
  });
});
