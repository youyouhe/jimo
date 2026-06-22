import request from './request';

export interface ApprovalTask {
  taskId: string;
  taskName: string;
  taskDefinitionKey: string;
  processInstanceId: string;
  assignee: string;
  createTime: number;
  /** Enriched from lc_business_approvals (matched by processInstanceId). */
  businessType?: string | null;
  businessId?: string | null;
  status?: string | null;
  /** The full business record (fetched from lc_<businessType>), for inline detail. */
  record?: Record<string, unknown> | null;
}

export interface MyInitiatedItem {
  businessType: string;
  businessId: string;
  status: string;
  executor: string;
  processInstanceId: string | null;
  initiatorId: string | null;
  approverId: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A task I've already acted on (已办). businessType/businessId/status are
 *  enriched by NestJS from lc_business_approvals; action comes from BPM. */
export interface DoneTask {
  taskId: string;
  taskName: string;
  taskDefinitionKey?: string;
  processInstanceId: string;
  endTime: number;
  /** APPROVED | REJECTED | null (null when no action comment was found) */
  action: string | null;
  comment: string | null;
  businessType: string | null;
  businessId: string | null;
  status: string | null;
  /** The full business record (fetched from lc_<businessType>), for inline detail. */
  record?: Record<string, unknown> | null;
}

/** A finalized (approved/rejected) approval I'm involved in (办结). */
export interface FinalizedItem {
  businessType: string;
  businessId: string;
  status: string;
  processInstanceId: string | null;
  initiatorId: string | null;
  approverId: string | null;
  comment: string | null;
  updatedAt: string;
}

/** One of my unsubmitted / returned business records (我的起草). */
export interface DraftItem {
  businessType: string;
  businessName: string;
  businessId: string;
  /** DRAFT (未提交) | REJECTED (已退回) */
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function getMyTasks(): Promise<{ list: ApprovalTask[]; total: number }> {
  return request.get('/approvals/my-tasks');
}

export async function getMyInitiated(): Promise<{ list: MyInitiatedItem[]; total: number }> {
  return request.get('/approvals/my-initiated');
}

export async function getMyDone(): Promise<{ list: DoneTask[]; total: number }> {
  return request.get('/approvals/my-done');
}

export async function getFinalized(): Promise<{ list: FinalizedItem[]; total: number }> {
  return request.get('/approvals/finalized');
}

export async function getMyDrafts(): Promise<{ list: DraftItem[]; total: number }> {
  return request.get('/approvals/my-drafts');
}

export async function approveTask(
  processInstanceId: string,
  body: { approved: boolean; comment?: string },
): Promise<any> {
  return request.post(`/approvals/${processInstanceId}/approve`, body);
}
