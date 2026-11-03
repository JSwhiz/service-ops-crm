import assert from 'node:assert/strict';

/** Historical operations must remain pending until a different leader decides. */
export async function approvePendingFinancialChange(response: Response, baseUrl: string, approverCookie: string): Promise<void> {
  const body = await response.clone().json() as {status?: string; approvalRequestId?: string; approvalType?: string; id?: string};
  const approvalId = body.approvalRequestId ?? (body.approvalType && body.status === 'pending' ? body.id : undefined);
  if (!approvalId) return;
  assert.equal(body.status, 'pending');
  const decision = await fetch(`${baseUrl}/api/v1/approvals/${approvalId}/approve`, {method: 'POST', headers: {Cookie: approverCookie, 'Content-Type': 'application/json'}, body: JSON.stringify({comment: 'Independent approval for historical regression fixture'})});
  assert.equal(decision.status, 200, await decision.clone().text());
}
