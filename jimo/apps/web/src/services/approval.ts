import request from './request';

export interface ApprovalTask {
  taskId: string;
  taskName: string;
  taskDefinitionKey: string;
  processInstanceId: string;
  assignee: string;
  createTime: number;
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

export async function getMyTasks(): Promise<{ list: ApprovalTask[]; total: number }> {
  return request.get('/approvals/my-tasks');
}

export async function getMyInitiated(): Promise<{ list: MyInitiatedItem[]; total: number }> {
  return request.get('/approvals/my-initiated');
}

export async function approveTask(
  processInstanceId: string,
  body: { approved: boolean; comment?: string },
): Promise<any> {
  return request.post(`/approvals/${processInstanceId}/approve`, body);
}
