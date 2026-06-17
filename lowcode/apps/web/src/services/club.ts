import request from './request';

export interface Club {
  id: string;
  name: string;
  description: string | null;
  founded_date: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ClubListParams {
  page?: number;
  pageSize?: number;
    name?: string;
}

export interface ClubListResult {
  list: Club[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateClubDto {
    name: string;
    description?: string;
    founded_date?: string;
}

export interface UpdateClubDto {
    name?: string;
    description?: string;
    founded_date?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated clubs list.
 */
export async function getClubsList(params?: ClubListParams): Promise<ClubListResult> {
  return request.get('/lc/clubs', { params });
}

/**
 * Get a single club by ID.
 */
export async function getClub(id: string): Promise<Club> {
  return request.get(`/lc/clubs/${id}`);
}

/**
 * Create a new club.
 */
export async function createClub(dto: CreateClubDto): Promise<Club> {
  return request.post('/lc/clubs', dto);
}

/**
 * Update an existing club.
 */
export async function updateClub(id: string, dto: UpdateClubDto): Promise<Club> {
  return request.patch(`/lc/clubs/${id}`, dto);
}

/**
 * Delete a club by ID (soft delete).
 */
export async function deleteClub(id: string): Promise<void> {
  return request.delete(`/lc/clubs/${id}`);
}

/**
 * Batch delete clubs by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteClubs(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/clubs/batch', { data: { ids } });
}

