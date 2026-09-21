import assert from 'node:assert/strict';
import { resolveArtifactReviewTransition } from '../src/services/projectDataService.js';

const cases = [
  ['requirements', true, 'qa', 'qa_engineer'],
  ['test_plan', true, 'done', 'architect'],
  ['architecture', true, 'todo', 'developer'],
  ['requirements', false, 'backlog', 'requirements_analyst'],
  ['test_plan', false, 'qa', 'qa_engineer'],
  ['architecture', false, 'in_review', 'architect'],
];
for (const [type, approved, status, assignee] of cases) {
  const result = resolveArtifactReviewTransition(type, approved);
  assert.equal(result.status, status);
  assert.equal(result.assigneeAgentName, assignee);
}
assert.equal(resolveArtifactReviewTransition('custom', true), null);
console.log('artifact review transition tests: ok');
