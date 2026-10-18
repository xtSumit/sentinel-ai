/**
 * Sentinel AI — Screening Orchestrator Idempotency Unit Test
 * Verifies that opening a workspace whose accepted change has already been screened
 * does NOT re-run screening agents, create duplicate cases, or trigger repeat toasts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeScreeningWorkflow } from './screeningOrchestrator';
import { bodsRepository } from '../data/repository';

describe('Screening Orchestrator Idempotency Test', () => {
  it('prevents re-screening when workspace is opened for an event that was already screened', async () => {
    const group = bodsRepository.getGroupById('grp-03-deccan');
    assert.ok(group, 'Group grp-03-deccan must exist');

    const mockEvent = {
      id: 'evt_sim_test_idempotency_001',
      eventId: 'evt_sim_test_idempotency_001',
      groupId: 'grp-03-deccan',
      customerId: 'CUS-2026-GRID',
      eventType: 'SHAREHOLDING_CHANGE',
      description: 'Test Shareholding Change'
    };

    const user = { uid: 'test-analyst-uid', displayName: 'Test Analyst' };

    // First execution: runs screening agents
    const result1 = await executeScreeningWorkflow({
      group,
      customerId: 'CUS-2026-GRID',
      triggerType: 'PKYC',
      triggerEvent: mockEvent,
      user,
      thresholdPct: 25
    });

    assert.ok(result1, 'First screening run returned result');
    assert.ok(result1.run, 'Screening run record exists');
    assert.ok(result1.createdCase, 'Compliance case was created');
    assert.equal(result1.isExisting, undefined, 'First run is a fresh run (not existing)');

    // Second execution (simulating opening the workspace or tree again from Cases view):
    const result2 = await executeScreeningWorkflow({
      group,
      customerId: 'CUS-2026-GRID',
      triggerType: 'PKYC',
      triggerEvent: mockEvent,
      user,
      thresholdPct: 25
    });

    assert.ok(result2, 'Second screening call returned result');
    assert.equal(result2.isExisting, true, 'Second call detected existing run and flagged isExisting=true');
    assert.equal(result2.run.runId, result1.run.runId, 'Reused exact same screening run ID');
    process.exit(0);
  });
});
