import request from './request';

export interface ReassignResult {
  businessType: string;
  newOwnerId: string;
  reassigned: number;
  skipped: number;
  skippedIds: string[];
}

/**
 * Batch reassign records to a new owner.
 * The actor may reassign records they own, or ownerless records (owner_id NULL).
 * Records owned by someone else are skipped (returned in skippedIds).
 */
export async function reassignRecords(
  businessType: string,
  ids: string[],
  newOwnerId: string,
): Promise<ReassignResult> {
  return request.post('/ownership/reassign', { businessType, ids, newOwnerId });
}

export interface ShareResult {
  businessType: string;
  shared: number;
  skipped: number;
  skippedIds: string[];
  userIds: string[];
}

/**
 * Share multiple records with users (batch, owner-only). Replaces each row's
 * shared_with. Non-owner records are skipped (returned in skippedIds).
 * Only meaningful under the 'shared' visibility strategy.
 */
export async function shareRecords(
  businessType: string,
  ids: string[],
  userIds: string[],
): Promise<ShareResult> {
  return request.post('/ownership/share', { businessType, businessIds: ids, userIds });
}
