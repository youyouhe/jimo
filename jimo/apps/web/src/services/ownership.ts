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
